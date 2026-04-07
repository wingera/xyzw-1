import express from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validate.js";
import { createPassword, verifyPassword } from "../lib/crypto.js";
import { validatePasswordStrengthAsync } from "../lib/passwordPolicy.js";
import { nowIso } from "../db/sql.js";
import { referralAttributionRepository } from "../repositories/referralAttributionRepository.js";
import { referralConversionRepository } from "../repositories/referralConversionRepository.js";
import { referralProfileRepository } from "../repositories/referralProfileRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { refreshTokenRepository } from "../repositories/refreshTokenRepository.js";
import { securityEventRepository } from "../repositories/securityEventRepository.js";
import { disconnectUserSockets } from "../services/wsHub.js";
import { parseSecurityEventDetail, recordSecurityEvent } from "../services/securityEventService.js";
import {
  issueUserSensitiveActionToken,
  USER_SENSITIVE_ACTION_TTL_SECONDS,
} from "../middleware/userSensitiveAction.js";
import {
  decryptMfaSecret,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "../services/mfaService.js";
import {
  buildReferralShareUrl,
  generateReferralProfileForUser,
} from "../services/referralService.js";

const updateProfileBodySchema = z.object({
  email: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  nickname: z.string().trim().max(64).optional().default(""),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-()\s]*$/, "phone 格式无效")
    .max(32)
    .optional()
    .default(""),
}).strict();

const updatePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
}).strict();
const confirmPasswordBodySchema = z.object({
  password: z.string().trim().max(128).optional(),
  totpCode: z.string().trim().max(32).optional(),
  recoveryCode: z.string().trim().max(64).optional(),
}).strict();
const securityEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  eventType: z.string().trim().max(64).optional().default(""),
});
const referralConversionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
});

export function createUserRoutes() {
  const router = express.Router();
  const userConfirmLimiter = createRateLimiter({
    scope: "user_confirm_password",
    windowMs: 5 * 60 * 1000,
    max: 20,
    blockMs: 10 * 60 * 1000,
    keyGenerator: (req) => `${req.auth?.user?.id || "anonymous"}:${req.ip || "anonymous"}`,
  });

  router.post(
    "/confirm-password",
    authRequired,
    userConfirmLimiter,
    validateRequest({ body: confirmPasswordBodySchema }),
    (req, res) => {
      const password = String(req.body?.password || "").trim();
      const totpCode = String(req.body?.totpCode || "").trim();
      const recoveryCode = String(req.body?.recoveryCode || "").trim();
      const userPassword = userRepository.findPasswordById(req.auth.user.id);
      const currentUser = userRepository.findById(req.auth.user.id);
      const canUseMfa = Boolean(currentUser?.mfaEnabled);

      let ok = false;
      let method = "";
      let reason = "";

      if (canUseMfa) {
        if (!(totpCode || recoveryCode)) {
          reason = "mfa_required";
        } else {
          const secret = decryptMfaSecret(currentUser?.mfaTotpSecretEnc || "");
          if (totpCode) {
            ok = Boolean(secret && verifyTotpCode({ secret, code: totpCode }));
            method = ok ? "totp" : "";
            reason = ok ? "" : "mfa_totp_invalid";
          } else if (recoveryCode) {
            const recoveryResult = verifyAndConsumeRecoveryCode({
              inputCode: recoveryCode,
              recoveryCodeHashesJson: currentUser?.mfaRecoveryCodesHash || "[]",
            });
            ok = Boolean(recoveryResult?.ok);
            if (ok) {
              method = "recovery_code";
              userRepository.updateMfaRecoveryCodesHash({
                id: req.auth.user.id,
                mfaRecoveryCodesHash: recoveryResult.nextRecoveryCodeHashesJson,
                updatedAt: nowIso(),
              });
            } else {
              reason = "mfa_recovery_invalid";
            }
          }
        }
      } else if (password) {
        ok = Boolean(userPassword && verifyPassword(password, userPassword.passwordSalt, userPassword.passwordHash));
        if (ok) {
          method = "password";
        } else {
          reason = "password_mismatch";
        }
      }

      if (!ok && !canUseMfa && !password && !totpCode && !recoveryCode) {
        reason = "credential_missing";
      }

      if (!ok) {
        recordSecurityEvent({
          userId: req.auth.user.id,
          eventType: "user_confirm_failed",
          detail: {
            reason: reason || "confirm_failed",
            hasPassword: Boolean(password),
            hasTotpCode: Boolean(totpCode),
            hasRecoveryCode: Boolean(recoveryCode),
          },
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        });
        return res.status(400).json({ success: false, message: "二次确认失败，请检查凭证后重试" });
      }

      const token = issueUserSensitiveActionToken(req.auth.user);
      const expiresAt = new Date(Date.now() + USER_SENSITIVE_ACTION_TTL_SECONDS * 1000).toISOString();
      recordSecurityEvent({
        userId: req.auth.user.id,
        eventType: "user_confirm_success",
        detail: {
          method: method || "password",
          expiresAt,
        },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      });
      return res.json({
        success: true,
        message: "二次确认通过",
        data: {
          token,
          expiresAt,
        },
      });
    },
  );

  router.get("/profile", authRequired, (req, res) => {
    res.json({ success: true, data: req.auth.user });
  });

  router.put(
    "/profile",
    authRequired,
    validateRequest({ body: updateProfileBodySchema }),
    (req, res) => {
      const email = String(req.body?.email || "").trim();
      const nickname = String(req.body?.nickname || "").trim();
      const phone = String(req.body?.phone || "").trim();

      if (email) {
        const duplicated = userRepository.findByEmailExcludingId(
          email,
          req.auth.user.id,
        );
        if (duplicated) {
          return res
            .status(409)
            .json({ success: false, message: "邮箱已被其他账号使用" });
        }
      }

      userRepository.updateProfile({
        id: req.auth.user.id,
        email,
        nickname,
        phone,
        updatedAt: nowIso(),
      });

      const updated = userRepository.findById(req.auth.user.id);

      res.json({
        success: true,
        message: "资料更新成功",
        data: {
          ...updated,
          avatar: "/icons/xiaoyugan.png",
        },
      });
    },
  );

  router.put(
    "/password",
    authRequired,
    validateRequest({ body: updatePasswordBodySchema }),
    async (req, res) => {
      const currentPassword = req.body.currentPassword;
      const newPassword = req.body.newPassword;
      const passwordCheck = await validatePasswordStrengthAsync(newPassword, {
        mfaEnabled: Boolean(req.auth?.user?.mfaEnabled),
      });
      if (!passwordCheck.valid) {
        return res
          .status(400)
          .json({ success: false, message: passwordCheck.message });
      }

      const user = userRepository.findPasswordById(req.auth.user.id);
      if (
        !user
        || !verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)
      ) {
        return res.status(400).json({ success: false, message: "当前密码错误" });
      }

      const meta = createPassword(newPassword);
      const ts = nowIso();
      userRepository.updatePassword({
        id: req.auth.user.id,
        passwordSalt: meta.salt,
        passwordHash: meta.hash,
        updatedAt: ts,
      });
      userRepository.bumpTokenVersion({
        id: req.auth.user.id,
        updatedAt: ts,
      });
      refreshTokenRepository.revokeAllByUserId({
        userId: req.auth.user.id,
        revokedAt: ts,
      });
      disconnectUserSockets(req.auth.user.id, "Password changed");

      res.json({ success: true, message: "密码更新成功" });
    },
  );

  router.get("/stats", authRequired, (_req, res) => {
    res.json({
      success: true,
      data: {
        totalRoles: 0,
        totalTaskRuns: 0,
      },
    });
  });

  router.get("/referral-profile", authRequired, (req, res) => {
    const profile = referralProfileRepository.findByUserId(req.auth.user.id);
    if (!profile) {
      return res.json({
        success: true,
        data: null,
      });
    }

    return res.json({
      success: true,
      data: {
        ...profile,
        shareUrl: buildReferralShareUrl(profile.referralCode),
      },
    });
  });

  router.post("/referral-profile/generate", authRequired, (req, res) => {
    const profile = generateReferralProfileForUser(req.auth.user.id);
    return res.json({
      success: true,
      message: "推广链接已准备好",
      data: profile,
    });
  });

  router.get("/referral-overview", authRequired, (req, res) => {
    const profile = referralProfileRepository.findByUserId(req.auth.user.id);
    const invitedUsersCount = referralAttributionRepository.countByReferrerUserId(req.auth.user.id);
    const pendingAmountCents = referralConversionRepository.sumPendingRewardAmountByReferrerUserId(req.auth.user.id);
    const paidAmountCents = referralConversionRepository.sumPaidRewardAmountByReferrerUserId(req.auth.user.id);

    return res.json({
      success: true,
      data: {
        profile: profile
          ? {
              ...profile,
              shareUrl: buildReferralShareUrl(profile.referralCode),
            }
          : null,
        invitedUsersCount,
        pendingAmountCents,
        paidAmountCents,
      },
    });
  });

  router.get(
    "/referral-conversions",
    authRequired,
    validateRequest({ query: referralConversionsQuerySchema }),
    (req, res) => {
      const limit = Number(req.query?.limit) || 200;
      const rows = referralConversionRepository
        .listByReferrerUserId(req.auth.user.id)
        .slice(0, limit);

      return res.json({
        success: true,
        data: rows,
      });
    },
  );

  router.get(
    "/security-events",
    authRequired,
    validateRequest({ query: securityEventsQuerySchema }),
    (req, res) => {
      const limit = Number(req.query?.limit) || 50;
      const eventType = String(req.query?.eventType || "").trim();
      const rows = securityEventRepository.listByUser({
        userId: req.auth.user.id,
        limit,
        eventType,
      });

      return res.json({
        success: true,
        data: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          eventType: row.eventType,
          detail: parseSecurityEventDetail(row.detailJson),
          ip: row.ip,
          userAgent: row.userAgent,
          createdAt: row.createdAt,
        })),
      });
    },
  );

  return router;
}
