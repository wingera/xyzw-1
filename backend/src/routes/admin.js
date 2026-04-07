import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { createPassword, verifyPassword } from "../lib/crypto.js";
import { authRequired } from "../middleware/auth.js";
import { adminRequired } from "../middleware/admin.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validate.js";
import { makeSensitiveAction } from "../middleware/sensitiveAction.js";
import { nowIso, randomId } from "../db/sql.js";
import { transaction } from "../db/client.js";
import { env } from "../config/env.js";
import {
  isAllowedActivationDurationMonths,
  isOneDayActivationDuration,
  normalizeActivationDurationMonths,
} from "../lib/activationCodeDuration.js";
import { countBinFilesForUser } from "../services/binStorageService.js";
import { validatePasswordStrengthAsync } from "../lib/passwordPolicy.js";
import { recordAdminAudit } from "../services/adminAuditService.js";
import { createUserNotification } from "../services/notificationService.js";
import { inviteCodeRepository } from "../repositories/inviteCodeRepository.js";
import { activationCodeRepository } from "../repositories/activationCodeRepository.js";
import { referralConversionRepository } from "../repositories/referralConversionRepository.js";
import { tokenActivationRepository } from "../repositories/tokenActivationRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { userPreferenceRepository } from "../repositories/userPreferenceRepository.js";
import { adminAuditRepository } from "../repositories/adminAuditRepository.js";
import { refreshTokenRepository } from "../repositories/refreshTokenRepository.js";
import { taskControlRepository } from "../repositories/taskControlRepository.js";
import { securityEventRepository } from "../repositories/securityEventRepository.js";
import { parseSecurityEventDetail } from "../services/securityEventService.js";
import {
  decryptMfaSecret,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "../services/mfaService.js";
import {
  issueMfaResetLinkToken,
  MFA_RESET_LINK_TTL_SECONDS,
} from "./auth.js";
import {
  ACCESS_SCOPE_FULL,
  ACCESS_SCOPE_TASK_CONTROL_ONLY,
  normalizeAccessScope,
} from "../constants/accessScope.js";

const router = Router();
const INVITE_AUTO_DISABLE_HOURS = 48;
const RESET_CODE_DEFAULT_MINUTES = 15;
const RESET_CODE_MAX_MINUTES = 120;
const SENSITIVE_ACTION_TTL_SECONDS = 5 * 60;
const SENSITIVE_ACTION_TOKEN_HEADER = "x-admin-confirm-token";
const SENSITIVE_ACTION_TOKEN_PURPOSE = "admin-sensitive-action";
const adminSensitiveAction = makeSensitiveAction({
  purpose: SENSITIVE_ACTION_TOKEN_PURPOSE,
  ttlSeconds: SENSITIVE_ACTION_TTL_SECONDS,
  headerName: SENSITIVE_ACTION_TOKEN_HEADER,
  codePrefix: "ADMIN_CONFIRM",
  requiredMessage: "高危操作需要二次确认，请先验证当前密码",
});
const issueSensitiveActionToken = (user) => adminSensitiveAction.issue(user);
const sensitiveActionRequired = adminSensitiveAction.required;
const userIdParamSchema = z.object({
  id: z.string().trim().min(1).max(64),
});
const confirmPasswordBodySchema = z.object({
  password: z.string().trim().max(128).optional(),
  totpCode: z.string().trim().max(32).optional(),
  recoveryCode: z.string().trim().max(64).optional(),
}).strict();
const updateAdminFlagBodySchema = z.object({
  isAdmin: z.boolean(),
}).strict();
const updateUserAccessScopeBodySchema = z.object({
  accessScope: z.enum([ACCESS_SCOPE_FULL, ACCESS_SCOPE_TASK_CONTROL_ONLY]),
}).strict();
const updateTokenBindLimitBodySchema = z.object({
  tokenBindLimit: z.coerce.number().int().min(1).max(999),
}).strict();
const updateTokenRefreshSecondVerifyBodySchema = z.object({
  enabled: z.boolean(),
}).strict();
const resetUserPasswordBodySchema = z.object({
  password: z.string().min(1).max(128),
}).strict();
const createPasswordResetCodeBodySchema = z.object({
  expiresInMinutes: z.coerce.number().int().min(1).max(RESET_CODE_MAX_MINUTES).optional(),
}).strict();
const createMfaResetLinkBodySchema = z.object({}).strict();
const createInviteCodesBodySchema = z.object({
  count: z.coerce.number().int().min(1).max(20).optional().default(1),
  expiresAt: z.union([z.string().datetime({ offset: true }), z.null(), z.literal("")]).optional(),
  isTemporary: z.boolean().optional().default(false),
  featureScope: z.enum([ACCESS_SCOPE_FULL, ACCESS_SCOPE_TASK_CONTROL_ONLY]).optional().default(ACCESS_SCOPE_FULL),
  bindAccountLimit: z.coerce.number().int().min(1).max(999).optional().default(1),
}).strict();
const createActivationCodesBodySchema = z.object({
  count: z.coerce.number().int().min(1).max(100).optional().default(1),
  featureScope: z.enum([ACCESS_SCOPE_FULL, ACCESS_SCOPE_TASK_CONTROL_ONLY]).optional().default(ACCESS_SCOPE_FULL),
  durationMonths: z.coerce.number().int().refine((value) => isAllowedActivationDurationMonths(value), {
    message: "durationMonths must be one of 0/1/3/6/12",
  }),
  saleAmountCents: z.coerce.number().int().min(0).max(10_000_000).optional().default(0),
}).strict();
const adminTaskControlLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional().default(500),
  username: z.string().trim().max(64).optional().default(""),
  taskName: z.string().trim().max(64).optional().default(""),
  status: z.enum(["", "info", "success", "warning", "error"]).optional().default(""),
  taskId: z.string().trim().max(128).optional().default(""),
  message: z.string().trim().max(200).optional().default(""),
});
const adminChangelogNotifyBodySchema = z.object({
  version: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(120).optional(),
  content: z.string().trim().min(1).max(240).optional(),
  path: z.string().trim().max(120).optional().default("/changelog"),
}).strict();
const adminSecurityEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  eventType: z.string().trim().max(64).optional().default(""),
  userId: z.string().trim().max(64).optional().default(""),
});
const adminRateKey = (req) => `${req.auth?.user?.id || "anonymous"}:${req.ip || "anonymous"}`;
const REFRESH_SECOND_VERIFY_PREF_KEY = "security.token_refresh_second_verify_enabled";
const adminApiLimiter = createRateLimiter({
  scope: "admin_api",
  windowMs: 60 * 1000,
  max: 120,
  blockMs: 5 * 60 * 1000,
  keyGenerator: adminRateKey,
});
const adminWriteLimiter = createRateLimiter({
  scope: "admin_write",
  windowMs: 60 * 1000,
  max: 40,
  blockMs: 10 * 60 * 1000,
  keyGenerator: adminRateKey,
});
const adminConfirmLimiter = createRateLimiter({
  scope: "admin_confirm_password",
  windowMs: 5 * 60 * 1000,
  max: 20,
  blockMs: 10 * 60 * 1000,
  keyGenerator: adminRateKey,
});

router.use(authRequired, adminRequired);
router.use(adminApiLimiter);

const generateCode = () => {
  const random = crypto.randomBytes(6).toString("base64url").toUpperCase();
  return `INV-${random}`;
};
const generateResetCode = () => {
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RST-${random}`;
};
const generateActivationCode = () => {
  const random = crypto.randomBytes(8).toString("base64url").toUpperCase();
  return `ACT-${random}`;
};

const inviteAutoDisableAt = (createdAt) =>
  new Date(new Date(createdAt).getTime() + INVITE_AUTO_DISABLE_HOURS * 60 * 60 * 1000).toISOString();

const reqMeta = (req) => ({
  ip: String(req.ip || ""),
  userAgent: String(req.headers["user-agent"] || ""),
});

const USER_DELETE_REFERRAL_BLOCK_CODE = "USER_DELETE_BLOCKED_BY_REFERRAL_HISTORY";
const USER_DELETE_REFERRAL_BLOCK_MESSAGE = "该用户存在推广归因/返佣历史，不能直接删除；请改为停用或保留账号";
const isForeignKeyConstraintError = (error) => {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").trim();
  return (
    code === "SQLITE_CONSTRAINT_FOREIGNKEY"
    || message.includes("FOREIGN KEY constraint failed")
  );
};
const userDeleteBlockedByReferralHistory = (res) =>
  res.status(409).json({
    success: false,
    code: USER_DELETE_REFERRAL_BLOCK_CODE,
    message: USER_DELETE_REFERRAL_BLOCK_MESSAGE,
  });

const resolvePublicAppOrigin = () => env.publicAppOrigin;
const resolveAdminAppOrigin = () => env.adminAppOrigin || env.publicAppOrigin;

const isDefaultAdminAccount = (userRow) => {
  const identities = new Set(env.protectedAdminIdentities || []);
  const username = String(userRow?.username || "").trim().toLowerCase();
  const email = String(userRow?.email || "").trim().toLowerCase();
  return identities.has(username) || identities.has(email);
};

router.post(
  "/confirm-password",
  adminConfirmLimiter,
  validateRequest({ body: confirmPasswordBodySchema }),
  (req, res) => {
    const password = String(req.body?.password || "");
    const totpCode = String(req.body?.totpCode || "").trim();
    const recoveryCode = String(req.body?.recoveryCode || "").trim();
    const userPassword = userRepository.findPasswordById(req.auth.user.id);
    const currentUser = userRepository.findById(req.auth.user.id);
    const mfaEnabled = Boolean(currentUser?.mfaEnabled);

    let ok = false;
    let method = "";
    let reason = "";

    if (mfaEnabled) {
      if (!(totpCode || recoveryCode)) {
        reason = "mfa_required";
      } else {
        const secret = decryptMfaSecret(currentUser?.mfaTotpSecretEnc || "");
        if (totpCode) {
          ok = Boolean(secret && verifyTotpCode({ secret, code: totpCode }));
          if (ok) {
            method = "totp";
          } else {
            reason = "mfa_totp_invalid";
          }
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
    } else {
      reason = "password_missing";
    }

    if (!ok) {
      recordAdminAudit({
        adminUserId: req.auth.user.id,
        action: "confirm_sensitive_action_failed",
        targetType: "self",
        targetId: req.auth.user.id,
        detail: {
          reason: reason || "confirm_failed",
          hasPassword: Boolean(password),
          hasTotpCode: Boolean(totpCode),
          hasRecoveryCode: Boolean(recoveryCode),
        },
        ...reqMeta(req),
      });
      return res.status(400).json({ success: false, message: "二次确认失败，请检查凭证后重试" });
    }

    const token = issueSensitiveActionToken(req.auth.user);
    const expiresAt = new Date(Date.now() + SENSITIVE_ACTION_TTL_SECONDS * 1000).toISOString();
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "confirm_sensitive_action",
      targetType: "self",
      targetId: req.auth.user.id,
      detail: {
        method: method || "password",
        expiresAt,
      },
      ...reqMeta(req),
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

router.get("/users", (req, res) => {
  const rows = userRepository.listUsersWithRoleInviteStats();

  return res.json({
    success: true,
    data: rows.map((row) => {
      const binCount = countBinFilesForUser({
        user: {
          id: row.id,
          username: row.username,
        },
      });

      const refreshVerifyPref = userPreferenceRepository.findByUserAndKey({
        userId: row.id,
        key: REFRESH_SECOND_VERIFY_PREF_KEY,
      });
      let refreshSecondVerifyEnabled = true;
      try {
        if (refreshVerifyPref) {
          refreshSecondVerifyEnabled = JSON.parse(refreshVerifyPref.valueJson) !== false;
        }
      } catch {
        refreshSecondVerifyEnabled = true;
      }

      return {
        ...row,
        roleCount: binCount > 0 ? binCount : Number(row.roleCount) || 0,
        inviteCount: Number(row.inviteCount) || 0,
        tokenBindLimit: Math.max(1, Math.min(999, Number(row.tokenBindLimit) || 999)),
        refreshSecondVerifyEnabled,
        isCurrentUser: row.id === req.auth.user.id,
      };
    }),
  });
});

router.get(
  "/users/:id/token-activations",
  validateRequest({ params: userIdParamSchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const nowTs = Date.now();
    const rows = tokenActivationRepository.listByUser(target.id);
    const data = rows.map((row) => {
      const expiresTs = new Date(row.expiresAt || "").getTime();
      const active = Boolean(row.isActive) && Number.isFinite(expiresTs) && expiresTs > nowTs;
      const safeRow = { ...row };
      delete safeRow.accountSeed;
      delete safeRow.accountSignature;
      return {
        ...safeRow,
        active,
      };
    });

    return res.json({
      success: true,
      data: {
        userId: target.id,
        username: target.username,
        total: data.length,
        activeCount: data.filter((item) => item.active).length,
        expiredCount: data.filter((item) => !item.active).length,
        items: data,
      },
    });
  },
);

router.patch(
  "/users/:id/admin",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema, body: updateAdminFlagBodySchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);

    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const nextIsAdmin = Boolean(req.body?.isAdmin);
    if (target.id === req.auth.user.id && !nextIsAdmin) {
      return res.status(400).json({ success: false, message: "不能取消自己的管理员权限" });
    }

    userRepository.updateAdminFlag({
      id: target.id,
      isAdmin: nextIsAdmin,
      updatedAt: nowIso(),
    });
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: nextIsAdmin ? "grant_admin" : "revoke_admin",
      targetType: "user",
      targetId: target.id,
      detail: {
        targetUsername: target.username,
        isAdmin: nextIsAdmin,
      },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: nextIsAdmin ? "已授予管理员权限" : "已移除管理员权限",
    });
  },
);

router.patch(
  "/users/:id/access-scope",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema, body: updateUserAccessScopeBodySchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const nextAccessScope = normalizeAccessScope(req.body?.accessScope);
    const ts = nowIso();
    userRepository.updateAccessScope({
      id: target.id,
      accessScope: nextAccessScope,
      updatedAt: ts,
    });
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "update_user_access_scope",
      targetType: "user",
      targetId: target.id,
      detail: {
        targetUsername: target.username,
        accessScope: nextAccessScope,
      },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message:
        nextAccessScope === ACCESS_SCOPE_FULL
          ? `已将 ${target.username} 设置为全功能账号`
          : `已将 ${target.username} 设置为普通版账号`,
      data: {
        id: target.id,
        accessScope: nextAccessScope,
      },
    });
  },
);

router.patch(
  "/users/:id/token-bind-limit",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema, body: updateTokenBindLimitBodySchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const tokenBindLimit = Math.max(1, Math.min(999, Number(req.body?.tokenBindLimit) || 1));
    const ts = nowIso();
    userRepository.updateTokenBindLimit({
      id: target.id,
      tokenBindLimit,
      updatedAt: ts,
    });
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "update_user_token_bind_limit",
      targetType: "user",
      targetId: target.id,
      detail: {
        targetUsername: target.username,
        tokenBindLimit,
      },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: `已更新 ${target.username} 的Token上限`,
      data: {
        id: target.id,
        tokenBindLimit,
      },
    });
  },
);

router.patch(
  "/users/:id/token-refresh-second-verify",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema, body: updateTokenRefreshSecondVerifyBodySchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const enabled = req.body?.enabled !== false;
    const ts = nowIso();
    userPreferenceRepository.upsert({
      userId: target.id,
      key: REFRESH_SECOND_VERIFY_PREF_KEY,
      valueJson: JSON.stringify(enabled),
      createdAt: ts,
      updatedAt: ts,
    });

    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "update_user_token_refresh_second_verify",
      targetType: "user",
      targetId: target.id,
      detail: {
        targetUsername: target.username,
        enabled,
      },
      ...reqMeta(req),
    });

    createUserNotification({
      userId: target.id,
      type: "security",
      title: enabled ? "管理员已开启刷新 Token 二次验证" : "管理员已关闭刷新 Token 二次验证",
      content: enabled
        ? "后续刷新 Token 读取 BIN 时，将继续要求安全确认。"
        : "管理员已为你关闭刷新 Token 二次验证。请注意，这会提高 Token 被盗后的风险。",
      payload: {
        key: REFRESH_SECOND_VERIFY_PREF_KEY,
        value: enabled,
        updatedBy: req.auth.user.id,
      },
    });

    return res.json({
      success: true,
      message: enabled
        ? `已为 ${target.username} 开启刷新 Token 二次验证`
        : `已为 ${target.username} 关闭刷新 Token 二次验证`,
      data: {
        id: target.id,
        refreshSecondVerifyEnabled: enabled,
      },
    });
  },
);

router.patch(
  "/users/:id/password",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema, body: resetUserPasswordBodySchema }),
  async (req, res) => {
    const target = userRepository.findById(req.params.id);

    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const password = String(req.body?.password || "");
    const passwordCheck = await validatePasswordStrengthAsync(password, {
      mfaEnabled: Boolean(target?.mfaEnabled),
    });
    if (!passwordCheck.valid) {
      return res.status(400).json({ success: false, message: passwordCheck.message });
    }

    const meta = createPassword(password);
    const ts = nowIso();
    userRepository.updatePassword({
      id: target.id,
      passwordSalt: meta.salt,
      passwordHash: meta.hash,
      updatedAt: ts,
    });
    userRepository.bumpTokenVersion({
      id: target.id,
      updatedAt: ts,
    });
    refreshTokenRepository.revokeAllByUserId({
      userId: target.id,
      revokedAt: ts,
    });
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "reset_user_password",
      targetType: "user",
      targetId: target.id,
      detail: { targetUsername: target.username },
      ...reqMeta(req),
    });

    return res.json({ success: true, message: `已重置 ${target.username} 的密码` });
  },
);

router.post(
  "/users/:id/revoke-sessions",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    const ts = nowIso();
    userRepository.bumpTokenVersion({
      id: target.id,
      updatedAt: ts,
    });
    refreshTokenRepository.revokeAllByUserId({
      userId: target.id,
      revokedAt: ts,
    });
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "revoke_user_sessions",
      targetType: "user",
      targetId: target.id,
      detail: { targetUsername: target.username },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: `已强制 ${target.username} 全部设备下线`,
    });
  },
);

router.post(
  "/users/:id/password-reset-code",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema, body: createPasswordResetCodeBodySchema }),
  (req, res) => {
  const target = userRepository.findAdminUserBasic(req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: "用户不存在" });
  }
  if (isDefaultAdminAccount(target)) {
    return res.status(403).json({
      success: false,
      message: "默认管理员账号不允许生成短时验证码",
    });
  }

  const ttlMinutes = Math.max(
    1,
    Math.min(
      RESET_CODE_MAX_MINUTES,
      Number(req.body?.expiresInMinutes) || RESET_CODE_DEFAULT_MINUTES,
    ),
  );
  const createdAt = nowIso();
  const expiresAt = new Date(
    Date.now() + ttlMinutes * 60 * 1000,
  ).toISOString();

  userRepository.deactivateActivePasswordResetCodesByUser(target.id);

  let code = generateResetCode();
  while (userRepository.existsPasswordResetCode(code)) {
    code = generateResetCode();
  }

  const id = randomId("rst");
  userRepository.createPasswordResetCode({
    id,
    userId: target.id,
    code,
    createdBy: req.auth.user.id,
    expiresAt,
    createdAt,
  });
  recordAdminAudit({
    adminUserId: req.auth.user.id,
    action: "create_password_reset_code",
    targetType: "user",
    targetId: target.id,
    detail: {
      targetUsername: target.username,
      expiresAt,
      expiresInMinutes: ttlMinutes,
    },
    ...reqMeta(req),
  });

  return res.json({
    success: true,
    message: `已为 ${target.username} 生成短时验证码`,
    data: {
      userId: target.id,
      username: target.username,
      email: target.email || "",
      shortCode: code,
      expiresAt,
      expiresInMinutes: ttlMinutes,
    },
  });
},
);

router.post(
  "/users/:id/mfa-reset-link",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema, body: createMfaResetLinkBodySchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }
    if (!target.mfaEnabled) {
      return res.status(400).json({
        success: false,
        message: "该账号当前未开启二次验证，无需生成重置链接",
      });
    }

    const token = issueMfaResetLinkToken(target, { requestedBy: req.auth.user.id });
    const expiresInMinutes = Math.floor(MFA_RESET_LINK_TTL_SECONDS / 60);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    const appOrigin = target.isAdmin ? resolveAdminAppOrigin() : resolvePublicAppOrigin();
    const resetPath = `/mfa-reset#token=${encodeURIComponent(token)}`;
    const resetUrl = appOrigin ? `${appOrigin}${resetPath}` : resetPath;

    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "create_mfa_reset_link",
      targetType: "user",
      targetId: target.id,
      detail: {
        targetUsername: target.username,
        expiresAt,
      },
      ...reqMeta(req),
    });

    createUserNotification({
      userId: target.id,
      type: "security",
      title: "管理员已为你生成二次验证重置链接",
      content: "如需重新绑定认证器，请向管理员索取重置链接并在有效期内完成操作。",
      payload: {
        path: "/admin/feedback",
        expiresAt,
      },
    });

    return res.json({
      success: true,
      message: `已为 ${target.username} 生成二次验证重置链接`,
      data: {
        userId: target.id,
        username: target.username,
        resetUrl,
        resetPath,
        expiresAt,
        expiresInMinutes,
      },
    });
  },
);

router.delete(
  "/users/:id",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (req, res) => {
    const target = userRepository.findAdminUserBasic(req.params.id);

    if (!target) {
      return res.status(404).json({ success: false, message: "用户不存在" });
    }

    if (target.id === req.auth.user.id) {
      return res.status(400).json({ success: false, message: "不能删除当前登录账号" });
    }

    if (userRepository.hasBlockingReferralHistory(target.id)) {
      return userDeleteBlockedByReferralHistory(res);
    }

    try {
      userRepository.deleteById(target.id);
    } catch (error) {
      if (isForeignKeyConstraintError(error)) {
        return userDeleteBlockedByReferralHistory(res);
      }
      throw error;
    }

    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "delete_user",
      targetType: "user",
      targetId: target.id,
      detail: { targetUsername: target.username },
      ...reqMeta(req),
    });
    return res.json({ success: true, message: `已删除账号 ${target.username}` });
  },
);

router.get("/invite-codes", (req, res) => {
  const rows = inviteCodeRepository.listWithCreatorAndConsumer();

  const now = Date.now();
  const data = rows.map((row) => {
    const autoDisableAt = inviteAutoDisableAt(row.createdAt);
    const autoDisabled =
      !row.usedAt
      && row.isActive
      && Number.isFinite(new Date(autoDisableAt).getTime())
      && new Date(autoDisableAt).getTime() < now;

    if (autoDisabled) {
      inviteCodeRepository.markInactiveById(row.id);
    }

    return {
      ...row,
      code: String(row.codeMask || row.code || "").trim(),
      maskedCode: String(row.codeMask || row.code || "").trim(),
      isActive: autoDisabled ? false : row.isActive,
      autoDisableAt,
    };
  });

  return res.json({ success: true, data });
});

router.post(
  "/invite-codes/:id/reveal",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (_req, res) => {
    return res.status(410).json({
      success: false,
      message: "邀请码明码仅在创建时返回，创建后不可再次查看",
    });
  },
);

router.post(
  "/invite-codes",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ body: createInviteCodesBodySchema }),
  (req, res) => {
  const count = Number(req.body.count);
  const expiresAt = req.body.expiresAt ? String(req.body.expiresAt) : null;
  const isTemporary = Boolean(req.body.isTemporary);
  const featureScope = normalizeAccessScope(req.body?.featureScope);
  const bindAccountLimit = Math.max(1, Math.min(999, Number(req.body?.bindAccountLimit) || 1));
  const created = [];

  for (let i = 0; i < count; i += 1) {
    let code = generateCode();
    while (inviteCodeRepository.existsByCode(code)) {
      code = generateCode();
    }

    const id = randomId("invite");
    const createdAt = nowIso();

    inviteCodeRepository.create({
      id,
      code,
      createdBy: req.auth.user.id,
      expiresAt,
      isTemporary,
      featureScope,
      bindAccountLimit,
      createdAt,
    });

    created.push({
      id,
      code,
      expiresAt,
      createdAt,
      isTemporary,
      featureScope,
      bindAccountLimit,
      autoDisableAt: inviteAutoDisableAt(createdAt),
    });
  }
  recordAdminAudit({
    adminUserId: req.auth.user.id,
    action: "create_invite_codes",
    targetType: "invite_code",
    detail: {
      count: created.length,
      isTemporary,
      expiresAt,
      featureScope,
      bindAccountLimit,
    },
    ...reqMeta(req),
  });

  return res.json({ success: true, data: created, message: `已生成 ${created.length} 个邀请码` });
  },
);

router.patch(
  "/invite-codes/:id/disable",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (req, res) => {
  const row = inviteCodeRepository.findById(req.params.id);

  if (!row) {
    return res.status(404).json({ success: false, message: "邀请码不存在" });
  }

  if (row.usedAt) {
    return res.status(400).json({ success: false, message: "邀请码已被使用，不能禁用" });
  }

  inviteCodeRepository.markInactiveById(req.params.id);
  recordAdminAudit({
    adminUserId: req.auth.user.id,
    action: "disable_invite_code",
    targetType: "invite_code",
    targetId: req.params.id,
    ...reqMeta(req),
  });
  return res.json({ success: true, message: "邀请码已禁用" });
  },
);

router.get("/activation-codes", (_req, res) => {
  const rows = activationCodeRepository.listWithCreatorAndConsumer();

  return res.json({
    success: true,
    data: rows.map((row) => {
      const binding = tokenActivationRepository.findLatestByActivationCodeId({
        activationCodeId: row.id,
      });
      const activeBinding =
        binding && String(binding.expiresAt || "").trim()
          ? new Date(binding.expiresAt).getTime() > Date.now()
          : false;
      return {
        ...row,
        code: String(row.codeMask || row.code || "").trim(),
        maskedCode: String(row.codeMask || row.code || "").trim(),
        featureScope: normalizeAccessScope(row.featureScope),
        bindingId: binding?.id || null,
        bindingTokenId: binding?.tokenId || null,
        bindingSessId: String(binding?.accountIdentity || "").split("|")[0] || null,
        bindingRoleId: binding?.roleId || null,
        bindingRoleName: binding?.roleName || null,
        bindingRegion: binding?.region || null,
        bindingRoleIndex: String(binding?.roleIndex ?? "").trim() || null,
        bindingUserId: binding?.userId || null,
        bindingUsername: binding?.bindingUsername || null,
        bindingExpiresAt: binding?.expiresAt || null,
        bindingActive: Boolean(activeBinding),
        saleAmountCents: row.saleAmountCents,
        saleCurrency: row.saleCurrency,
      };
    }),
  });
});

router.post(
  "/activation-codes/:id/reveal",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (_req, res) => {
    return res.status(410).json({
      success: false,
      message: "激活码明码仅在创建时返回，创建后不可再次查看",
    });
  },
);

router.post(
  "/activation-codes/:id/unbind",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (req, res) => {
    const row = activationCodeRepository.findById(req.params.id);
    if (!row || row.isDeleted) {
      return res.status(404).json({ success: false, message: "激活码不存在" });
    }

    const result = transaction(() => {
      if (referralConversionRepository.existsPaidByActivationCodeId(req.params.id)) {
        return {
          blocked: true,
        };
      }
      const deletedBindings = tokenActivationRepository.deleteByActivationCodeId({
        activationCodeId: req.params.id,
      });
      const resetCodes = activationCodeRepository.resetBindingById(req.params.id);
      const voidedConversions = referralConversionRepository.voidByActivationCodeIdExcludingPaid({
        activationCodeId: req.params.id,
        note: "管理员解绑激活码，未结算推广返佣已作废",
        updatedAt: nowIso(),
      });
      return { deletedBindings, resetCodes, voidedConversions };
    });

    if (result?.blocked) {
      return res.status(409).json({
        success: false,
        message: "该激活码已有已结算返佣，不能解绑；如需补偿请创建新激活码",
      });
    }

    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "unbind_activation_code",
      targetType: "activation_code",
      targetId: req.params.id,
      detail: {
        deletedBindings: result.deletedBindings,
        resetCodes: result.resetCodes,
        voidedConversions: result.voidedConversions,
      },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: "绑定关系已清除，消费记录保留，旧激活码不会恢复可用；如需补偿请创建新激活码",
      data: result,
    });
  },
);

router.post(
  "/activation-codes/unbind-all",
  adminWriteLimiter,
  sensitiveActionRequired,
  (req, res) => {
    if (referralConversionRepository.existsAnyPaidConversion()) {
      return res.status(409).json({
        success: false,
        message: "存在已结算返佣记录，不能批量解绑；如需补偿请创建新激活码",
      });
    }

    const result = transaction(() => {
      const deletedBindings = tokenActivationRepository.deleteAll();
      const resetCodes = activationCodeRepository.resetAllConsumedBindings();
      const voidedConversions = referralConversionRepository.voidAllExcludingPaid({
        note: "管理员清空全部激活码绑定，未结算推广返佣已作废",
        updatedAt: nowIso(),
      });
      return { deletedBindings, resetCodes, voidedConversions };
    });

    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "unbind_all_activation_codes",
      targetType: "activation_code",
      detail: result,
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: "绑定关系已清除，消费记录保留，旧激活码不会恢复可用；如需补偿请创建新激活码",
      data: result,
    });
  },
);

router.post(
  "/activation-codes",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ body: createActivationCodesBodySchema }),
  (req, res) => {
    const count = Number(req.body?.count) || 1;
    const featureScope = normalizeAccessScope(req.body?.featureScope);
    const durationMonths = normalizeActivationDurationMonths(req.body?.durationMonths);
    const saleAmountCents = isOneDayActivationDuration(durationMonths)
      ? 0
      : Math.max(0, Number(req.body?.saleAmountCents) || 0);
    if (!isAllowedActivationDurationMonths(durationMonths)) {
      return res.status(400).json({ success: false, message: "激活时长仅支持 1天/1/3/6/12 个月" });
    }

    const created = [];
    for (let i = 0; i < count; i += 1) {
      let code = generateActivationCode();
      while (activationCodeRepository.existsByCode(code)) {
        code = generateActivationCode();
      }
      const id = randomId("actcode");
      const createdAt = nowIso();
      activationCodeRepository.create({
        id,
        code,
        createdBy: req.auth.user.id,
        featureScope,
        durationMonths,
        saleAmountCents,
        createdAt,
      });
      created.push({
        id,
        code,
        featureScope,
        durationMonths,
        saleAmountCents,
        saleCurrency: "CNY",
        createdAt,
      });
    }

    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "create_activation_codes",
      targetType: "activation_code",
      detail: {
        count: created.length,
        featureScope,
        durationMonths,
        saleAmountCents,
      },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: `已生成 ${created.length} 个激活码`,
      data: created,
    });
  },
);

router.patch(
  "/activation-codes/:id/disable",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (req, res) => {
    const row = activationCodeRepository.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, message: "激活码不存在" });
    }
    if (row.usedAt) {
      return res.status(400).json({ success: false, message: "激活码已使用，不能禁用" });
    }

    activationCodeRepository.markInactiveById(req.params.id);
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "disable_activation_code",
      targetType: "activation_code",
      targetId: req.params.id,
      ...reqMeta(req),
    });
    return res.json({ success: true, message: "激活码已禁用" });
  },
);

router.delete(
  "/activation-codes/:id",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: userIdParamSchema }),
  (req, res) => {
    const row = activationCodeRepository.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, message: "激活码不存在" });
    }

    activationCodeRepository.softDeleteById(req.params.id);
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "delete_activation_code",
      targetType: "activation_code",
      targetId: req.params.id,
      ...reqMeta(req),
    });
    return res.json({ success: true, message: "激活码已删除" });
  },
);

router.get("/audit-logs", (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
  const rows = adminAuditRepository.listRecent(limit);

  return res.json({
    success: true,
    data: rows.map((row) => {
      let detail = {};
      try {
        detail = row.detailJson ? JSON.parse(row.detailJson) : {};
      } catch {
        detail = {};
      }
      return {
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        detail,
        ip: row.ip || "",
        userAgent: row.userAgent || "",
        createdAt: row.createdAt,
        adminUsername: row.adminUsername,
      };
    }),
  });
});

router.get(
  "/security-events",
  validateRequest({ query: adminSecurityEventsQuerySchema }),
  (req, res) => {
    const limit = Number(req.query?.limit) || 100;
    const eventType = String(req.query?.eventType || "").trim();
    const userId = String(req.query?.userId || "").trim();
    const rows = securityEventRepository.listForAdmin({
      limit,
      eventType,
      userId,
    });

    return res.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        username: row.username || "",
        eventType: row.eventType,
        detail: parseSecurityEventDetail(row.detailJson),
        ip: row.ip || "",
        userAgent: row.userAgent || "",
        createdAt: row.createdAt,
      })),
    });
  },
);

router.get(
  "/task-control/logs",
  validateRequest({ query: adminTaskControlLogsQuerySchema }),
  (req, res) => {
    const rows = taskControlRepository.listLogsForAdmin({
      limit: req.query.limit,
      username: req.query.username,
      taskName: req.query.taskName,
      status: req.query.status,
      taskId: req.query.taskId,
      message: req.query.message,
      backendOnly: true,
    });
    return res.json({
      success: true,
      data: rows,
    });
  },
);

router.post(
  "/changelog/notify-all",
  adminWriteLimiter,
  validateRequest({ body: adminChangelogNotifyBodySchema }),
  (req, res) => {
    const version = String(req.body?.version || "").trim();
    const title = String(req.body?.title || "").trim() || `更新日志 ${version}`;
    const content = String(req.body?.content || "").trim() || `已发布 ${version} 版本，点击查看详情`;
    const rawPath = String(req.body?.path || "/changelog").trim() || "/changelog";
    const path = rawPath.startsWith("/") ? rawPath : "/changelog";
    const users = userRepository.listAllBasicUsers();

    let sentCount = 0;
    users.forEach((user) => {
      if (!user?.id) return;
      const id = createUserNotification({
        userId: user.id,
        type: "changelog",
        title,
        content,
        payload: {
          path,
          version,
          source: "changelog",
        },
      });
      if (id) sentCount += 1;
    });

    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "broadcast_changelog_notice",
      targetType: "user_notification",
      detail: {
        version,
        title,
        content,
        path,
        recipients: sentCount,
      },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: `已发送更新日志通知到 ${sentCount} 个账号`,
      data: {
        sentCount,
      },
    });
  },
);

export default router;
