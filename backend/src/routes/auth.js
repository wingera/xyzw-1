import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import {
  createPassword,
  isLegacyPasswordHash,
  sha256Hex,
  signJwt,
  verifyJwt,
  verifyPassword,
} from "../lib/crypto.js";
import { validatePasswordStrengthAsync } from "../lib/passwordPolicy.js";
import { nowIso, randomId, secureId } from "../db/sql.js";
import { authRequired } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validate.js";
import { errorResponse } from "../lib/httpResponse.js";
import { inviteCodeRepository } from "../repositories/inviteCodeRepository.js";
import { referralProfileRepository } from "../repositories/referralProfileRepository.js";
import { refreshTokenRepository } from "../repositories/refreshTokenRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { transaction } from "../db/client.js";
import { env } from "../config/env.js";
import { parseCookies } from "../lib/cookies.js";
import {
  clearReferralCookie,
  readReferralCookieFromRequest,
} from "../lib/referralCookie.js";
import { clearCsrfCookies } from "../middleware/csrf.js";
import { resolveCookieSecure } from "../lib/cookieSecurity.js";
import { normalizeHttpOrigin } from "../lib/origin.js";
import {
  ACCESS_SCOPE_FULL,
  ACCESS_SCOPE_TASK_CONTROL_ONLY,
  normalizeAccessScope,
} from "../constants/accessScope.js";
import { disconnectUserSockets } from "../services/wsHub.js";
import { redactUrl } from "../lib/logRedactor.js";
import {
  createMfaSetupPayload,
  decryptMfaSecret,
  encryptMfaSecret,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "../services/mfaService.js";
import { recordSecurityEvent } from "../services/securityEventService.js";
import {
  attachReferralAttributionOnRegister,
  normalizeReferralCode,
} from "../services/referralService.js";

const router = Router();
router.get("/temporary-invites", (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "公开临时邀请码接口已下线",
  });
});

const registerLimiter = createRateLimiter({
  scope: "auth_register",
  windowMs: 10 * 60 * 1000,
  max: 8,
  blockMs: 30 * 60 * 1000,
});
const loginLimiter = createRateLimiter({
  scope: "auth_login",
  windowMs: 10 * 60 * 1000,
  max: 10,
  blockMs: 30 * 60 * 1000,
  keyGenerator: (req) =>
    `${req.ip || "anonymous"}:${String(req.body?.username || "").toLowerCase()}`,
});
const resetPasswordLimiter = createRateLimiter({
  scope: "auth_password_reset",
  windowMs: 10 * 60 * 1000,
  max: 8,
  blockMs: 30 * 60 * 1000,
  keyGenerator: (req) =>
    `${req.ip || "anonymous"}:${String(req.body?.identity || "").toLowerCase()}`,
});
const mfaVerifyLimiter = createRateLimiter({
  scope: "auth_mfa_verify",
  windowMs: 5 * 60 * 1000,
  max: 12,
  blockMs: 15 * 60 * 1000,
  keyGenerator: (req) =>
    `${req.ip || "anonymous"}:${String(req.body?.mfaChallengeToken || "").slice(0, 24)}`,
});
const mfaQrPollLimiter = createRateLimiter({
  scope: "auth_mfa_qr_poll",
  windowMs: 5 * 60 * 1000,
  max: 240,
  blockMs: 2 * 60 * 1000,
  keyGenerator: (req) =>
    `${req.ip || "anonymous"}:${String(req.body?.sessionId || "").slice(0, 32)}`,
});
const INVITE_AUTO_DISABLE_HOURS = 48;
const TEMP_ACCOUNT_DAYS = 7;
const PASSWORD_RESET_GENERIC_MESSAGE = "如果信息正确，密码已重置，请使用新密码登录";
const ACCESS_TOKEN_TTL_SECONDS = env.accessTokenTtlSeconds;
const REFRESH_TOKEN_SHORT_TTL_MS = env.refreshTokenShortTtlDays * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_LONG_TTL_MS = env.refreshTokenLongTtlDays * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 48;
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const MFA_CHALLENGE_PURPOSE = "auth-mfa-challenge";
const MFA_RESET_LINK_TTL_SECONDS = 60 * 60;
const MFA_RESET_LINK_PURPOSE = "auth-mfa-reset-link";
const registerBodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  password: z.string().min(1).max(128),
  inviteCode: z.string().trim().min(1).max(64),
  referralCode: z.string().trim().max(32).optional().default(""),
}).strict();
const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional().default(false),
}).strict();
const passwordResetBodySchema = z.object({
  identity: z.string().trim().min(1).max(128),
  shortCode: z.string().trim().min(1).max(64),
  newPassword: z.string().min(1).max(128),
}).strict();
const mfaVerifyBodySchema = z.object({
  mfaChallengeToken: z.string().trim().min(1).max(2048),
  totpCode: z.string().trim().max(32).optional(),
  recoveryCode: z.string().trim().max(64).optional(),
}).strict();
const mfaQrSessionCreateBodySchema = z.object({
  mfaChallengeToken: z.string().trim().min(1).max(2048),
}).strict();
const mfaQrSessionIdBodySchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
}).strict();
const mfaQrApproveBodySchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  totpCode: z.string().trim().max(32).optional(),
  recoveryCode: z.string().trim().max(64).optional(),
}).strict();
const mfaSetupBodySchema = z.object({
  password: z.string().min(1).max(128),
}).strict();
const mfaEnableBodySchema = z.object({
  password: z.string().min(1).max(128),
  secret: z.string().trim().min(8).max(512),
  totpCode: z.string().trim().min(4).max(32),
}).strict();
const mfaDisableBodySchema = z.object({
  password: z.string().min(1).max(128),
  totpCode: z.string().trim().max(32).optional(),
  recoveryCode: z.string().trim().max(64).optional(),
}).strict();
const mfaResetLinkBodySchema = z.object({
  token: z.string().trim().min(1).max(4096),
}).strict();
const MFA_QR_SESSION_TTL_MS = MFA_CHALLENGE_TTL_SECONDS * 1000;
const MAX_MFA_QR_SESSION_COUNT = 500;
const mfaQrSessionStore = new Map();

const isLocalMfaResetRequest = (req) => {
  const origin = normalizeHttpOrigin(String(req.get("origin") || "").trim());
  const refererRaw = String(req.get("referer") || "").trim();
  let referer = null;
  try {
    referer = refererRaw ? normalizeHttpOrigin(new URL(refererRaw).origin) : null;
  } catch {
    referer = null;
  }
  const host = String(req.hostname || "").trim().toLowerCase();
  return (
    host === "127.0.0.1"
    || origin?.hostname === "127.0.0.1"
    || referer?.hostname === "127.0.0.1"
  );
};

const logPasswordResetMaskedReason = (identity, reason) => {
  // eslint-disable-next-line no-console
  console.warn(`[auth] password reset masked reason: ${reason} (identity=${identity || "unknown"})`);
};

const reqMeta = (req) => ({
  ip: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
});

const maskIdentity = (identity) => {
  const text = String(identity || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= 2) {
    return "*".repeat(text.length);
  }
  return `${text.slice(0, 2)}***`;
};

const readRefreshTokenFromRequest = (req) => {
  const cookies = parseCookies(req.headers?.cookie || "");
  return String(cookies[env.refreshCookieName] || "").trim();
};

const makeRefreshTokenValue = (tokenId) =>
  `${tokenId}.${crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url")}`;

const buildAccessToken = (user) =>
  signJwt(
    {
      sub: user.id,
      username: user.username,
      ver: Number(user.tokenVersion ?? 0),
    },
    ACCESS_TOKEN_TTL_SECONDS,
  );

const createAccountDisplayId = () => {
  const raw = crypto.randomBytes(8).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") || raw;
};

const refreshCookieOptions = (req, maxAgeMs) => ({
  httpOnly: true,
  secure: resolveCookieSecure(req, env.refreshCookieSecure),
  sameSite: env.refreshCookieSameSite,
  path: env.refreshCookiePath,
  ...(env.refreshCookieDomain ? { domain: env.refreshCookieDomain } : {}),
  maxAge: maxAgeMs,
});

const referralRegisterError = (req, res, code, message) => {
  clearReferralCookie(req, res);
  return res.status(400).json({
    success: false,
    code,
    message,
  });
};

const accessCookieOptions = (req, maxAgeMs) => ({
  httpOnly: true,
  secure: resolveCookieSecure(req, env.accessCookieSecure),
  sameSite: env.accessCookieSameSite,
  path: env.accessCookiePath,
  ...(env.accessCookieDomain ? { domain: env.accessCookieDomain } : {}),
  maxAge: maxAgeMs,
});

const clearRefreshCookie = (req, res) => {
  res.clearCookie(env.refreshCookieName, refreshCookieOptions(req, 0));
  // Backward compatibility: also clear root-path cookie with same name.
  res.clearCookie(env.refreshCookieName, {
    ...refreshCookieOptions(req, 0),
    path: "/",
  });
};

const setAccessCookie = (req, res, accessToken) => {
  res.cookie(
    env.accessCookieName,
    accessToken,
    accessCookieOptions(req, Math.max(0, ACCESS_TOKEN_TTL_SECONDS * 1000)),
  );
};

const clearAccessCookie = (req, res) => {
  res.clearCookie(env.accessCookieName, accessCookieOptions(req, 0));
  // Backward compatibility: also clear root-path cookie with same name.
  if (env.accessCookiePath !== "/") {
    res.clearCookie(env.accessCookieName, {
      ...accessCookieOptions(req, 0),
      path: "/",
    });
  }
};

const resolveRefreshTokenTtlMs = (rememberMe) =>
  rememberMe
    ? REFRESH_TOKEN_LONG_TTL_MS
    : REFRESH_TOKEN_SHORT_TTL_MS;

const inferRememberMeFromRefreshRecord = (record) => {
  const createdTs = new Date(record?.createdAt || "").getTime();
  const expiresTs = new Date(record?.expiresAt || "").getTime();
  if (!Number.isFinite(createdTs) || !Number.isFinite(expiresTs) || expiresTs <= createdTs) {
    return true;
  }
  const ttlMs = expiresTs - createdTs;
  const threshold = (REFRESH_TOKEN_SHORT_TTL_MS + REFRESH_TOKEN_LONG_TTL_MS) / 2;
  return ttlMs >= threshold;
};

const issueRefreshToken = ({ user, req, rememberMe = false }) => {
  const tokenId = secureId("rft");
  const refreshToken = makeRefreshTokenValue(tokenId);
  const ttlMs = resolveRefreshTokenTtlMs(rememberMe);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  refreshTokenRepository.create({
    id: tokenId,
    userId: user.id,
    tokenHash: sha256Hex(refreshToken),
    tokenVersion: Number(user.tokenVersion ?? 0),
    expiresAt,
    createdAt,
    createdIp: req.ip || null,
    createdUserAgent: req.headers["user-agent"] || null,
  });

  return {
    refreshToken,
    expiresAt,
    tokenId,
    ttlMs,
  };
};

const rotateRefreshToken = ({ currentTokenId, user, req, rememberMe = false }) => {
  const now = nowIso();
  const next = issueRefreshToken({ user, req, rememberMe });
  refreshTokenRepository.revokeById({
    id: currentTokenId,
    revokedAt: now,
    replacedById: next.tokenId,
    lastUsedAt: now,
    lastUsedIp: req.ip || null,
    lastUsedUserAgent: req.headers["user-agent"] || null,
  });
  return next;
};

const issueMfaChallengeToken = (user, { rememberMe = false } = {}) =>
  signJwt(
    {
      sub: user.id,
      username: user.username,
      ver: Number(user.tokenVersion ?? 0),
      purpose: MFA_CHALLENGE_PURPOSE,
      rememberMe: Boolean(rememberMe),
    },
    MFA_CHALLENGE_TTL_SECONDS,
  );

const issueMfaResetLinkToken = (user, { requestedBy = "" } = {}) =>
  signJwt(
    {
      sub: user.id,
      username: user.username,
      ver: Number(user.tokenVersion ?? 0),
      purpose: MFA_RESET_LINK_PURPOSE,
      requestedBy: String(requestedBy || "").trim() || null,
      mfaEnabled: Boolean(user.mfaEnabled),
    },
    MFA_RESET_LINK_TTL_SECONDS,
  );

const parseMfaChallengeToken = (challengeToken) => {
  const payload = verifyJwt(challengeToken);
  if (String(payload?.purpose || "") !== MFA_CHALLENGE_PURPOSE) {
    throw new Error("invalid_mfa_challenge");
  }
  return payload;
};

const parseMfaResetLinkToken = (token) => {
  const payload = verifyJwt(token);
  if (String(payload?.purpose || "") !== MFA_RESET_LINK_PURPOSE) {
    throw new Error("invalid_mfa_reset_link");
  }
  return payload;
};

const getMfaChallengeUser = (challengeToken) => {
  let payload;
  try {
    payload = parseMfaChallengeToken(challengeToken);
  } catch {
    return {
      ok: false,
      status: 401,
      code: "AUTH_MFA_CHALLENGE_INVALID",
      message: "MFA 挑战无效或已过期",
    };
  }

  const user = userRepository.findById(String(payload?.sub || ""));
  if (!user) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_USER_NOT_FOUND",
      message: "用户不存在或已失效",
    };
  }
  if (!user.mfaEnabled || !user.mfaTotpSecretEnc) {
    return {
      ok: false,
      status: 403,
      code: "AUTH_MFA_SETUP_REQUIRED",
      message: "账号尚未启用双重验证",
    };
  }
  if (Number(payload?.ver) !== Number(user.tokenVersion ?? 0)) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_MFA_CHALLENGE_INVALID",
      message: "MFA 挑战无效或已过期",
    };
  }
  if (String(payload?.username || "") !== String(user.username || "")) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_MFA_CHALLENGE_INVALID",
      message: "MFA 挑战无效或已过期",
    };
  }

  const secret = decryptMfaSecret(user.mfaTotpSecretEnc);
  if (!secret) {
    return {
      ok: false,
      status: 403,
      code: "AUTH_MFA_SETUP_REQUIRED",
      message: "账号尚未启用双重验证",
    };
  }

  return {
    ok: true,
    user,
    payload,
    secret,
  };
};

const verifyMfaCredentials = ({ user, secret, totpCode, recoveryCode }) => {
  if (totpCode) {
    return { ok: verifyTotpCode({ secret, code: totpCode }) };
  }

  if (!recoveryCode) {
    return { ok: false };
  }

  const recoveryResult = verifyAndConsumeRecoveryCode({
    inputCode: recoveryCode,
    recoveryCodeHashesJson: user.mfaRecoveryCodesHash || "[]",
  });

  if (!recoveryResult.ok) {
    return { ok: false };
  }

  userRepository.updateMfaRecoveryCodesHash({
    id: user.id,
    mfaRecoveryCodesHash: recoveryResult.nextRecoveryCodeHashesJson,
    updatedAt: nowIso(),
  });
  return { ok: true };
};

const cleanupExpiredMfaQrSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of mfaQrSessionStore.entries()) {
    if (!session || Number(session.expiresAtMs) <= now || session.consumedAtMs) {
      mfaQrSessionStore.delete(sessionId);
    }
  }
  if (mfaQrSessionStore.size <= MAX_MFA_QR_SESSION_COUNT) {
    return;
  }
  const sessions = Array.from(mfaQrSessionStore.entries()).sort(
    (a, b) => Number(a?.[1]?.createdAtMs || 0) - Number(b?.[1]?.createdAtMs || 0),
  );
  const removeCount = Math.max(0, sessions.length - MAX_MFA_QR_SESSION_COUNT);
  for (let i = 0; i < removeCount; i += 1) {
    mfaQrSessionStore.delete(String(sessions[i]?.[0] || ""));
  }
};

const finalizeLogin = ({ req, res, user, rememberMe = false }) => {
  const lastLoginAt = nowIso();
  userRepository.updateLastLogin({
    id: user.id,
    lastLoginAt,
    updatedAt: lastLoginAt,
  });

  const token = buildAccessToken(user);
  setAccessCookie(req, res, token);
  const refresh = issueRefreshToken({ user, req, rememberMe });
  const refreshMaxAge = Math.max(
    0,
    new Date(refresh.expiresAt).getTime() - Date.now(),
  );
  res.cookie(
    env.refreshCookieName,
    refresh.refreshToken,
    refreshCookieOptions(req, refreshMaxAge),
  );
  recordSecurityEvent({
    userId: user.id,
    eventType: "login_success",
    detail: {
      loginMethod: user.mfaEnabled ? "password+mfa" : "password",
      isAdmin: Boolean(user.isAdmin),
      rememberMe: Boolean(rememberMe),
      refreshTtlDays: Math.round(refresh.ttlMs / (24 * 60 * 60 * 1000)),
    },
    ...reqMeta(req),
  });

  return res.json({
    success: true,
    message: "登录成功",
    data: {
      ...(env.accessTokenExposeInBody ? { token } : {}),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        nickname: user.nickname || "",
        phone: user.phone || "",
        trialExpiresAt: user.trialExpiresAt || null,
        accessScope: normalizeAccessScope(user.accessScope),
        isTaskControlOnly:
          normalizeAccessScope(user.accessScope) === ACCESS_SCOPE_TASK_CONTROL_ONLY,
        hasGameFeatureAccess:
          normalizeAccessScope(user.accessScope) === ACCESS_SCOPE_FULL,
        tokenBindLimit: Math.max(1, Math.min(999, Number(user.tokenBindLimit) || 999)),
        mfaEnabled: !!user.mfaEnabled,
        lastLoginAt,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
        avatar: "/icons/xiaoyugan.png",
      },
    },
  });
};

router.post("/register", registerLimiter, validateRequest({ body: registerBodySchema }), async (req, res) => {
  const {
    username,
    email,
    password,
    inviteCode,
    referralCode,
  } = req.body;

  const passwordCheck = await validatePasswordStrengthAsync(password, { mfaEnabled: false });
  if (!passwordCheck.valid) {
    return res.status(400).json({ success: false, message: passwordCheck.message });
  }

  const exists = userRepository.findIdByUsernameOrEmail(username, email || null);

  if (exists) {
    return res
      .status(409)
      .json({ success: false, message: "用户名或邮箱已存在" });
  }

  const invite = inviteCodeRepository.findByCode(inviteCode);

  if (!invite) {
    return res.status(400).json({ success: false, message: "邀请码无效" });
  }
  if (!invite.isActive) {
    return res.status(400).json({ success: false, message: "邀请码已失效" });
  }
  if (invite.usedBy || invite.usedAt) {
    return res.status(400).json({ success: false, message: "邀请码已使用" });
  }
  if (
    invite.createdAt
    && Number.isFinite(new Date(invite.createdAt).getTime())
    && Date.now() - new Date(invite.createdAt).getTime() > INVITE_AUTO_DISABLE_HOURS * 60 * 60 * 1000
  ) {
    inviteCodeRepository.markInactiveById(invite.id);
    return res.status(400).json({ success: false, message: "邀请码超过48小时未使用，已自动禁用" });
  }
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return res.status(400).json({ success: false, message: "邀请码已过期" });
  }

  const normalizedReferralCode = normalizeReferralCode(referralCode);
  const referralCookieState = readReferralCookieFromRequest(req);
  let effectiveReferralCode = "";
  if (referralCookieState.ok) {
    if (
      normalizedReferralCode
      && normalizedReferralCode !== referralCookieState.code
    ) {
      return referralRegisterError(
        req,
        res,
        "REFERRAL_MISMATCH",
        "推广信息不一致，请重新通过推广链接进入",
      );
    }
    if (!referralProfileRepository.findByCode(referralCookieState.code)) {
      return referralRegisterError(
        req,
        res,
        "REFERRAL_INVALID",
        "推广链接已失效，请重新通过推广链接进入",
      );
    }
    effectiveReferralCode = referralCookieState.code;
  } else if (referralCookieState.reason === "expired") {
    return referralRegisterError(
      req,
      res,
      "REFERRAL_EXPIRED",
      "推广信息已过期，请重新通过推广链接进入",
    );
  } else if (referralCookieState.reason === "invalid") {
    return referralRegisterError(
      req,
      res,
      "REFERRAL_INVALID",
      "推广信息无效，请重新通过推广链接进入",
    );
  } else if (env.allowLegacyReferralBodyFallback && normalizedReferralCode) {
    if (!referralProfileRepository.findByCode(normalizedReferralCode)) {
      return res.status(400).json({
        success: false,
        code: "REFERRAL_INVALID",
        message: "推广信息无效，请重新通过推广链接进入",
      });
    }
    effectiveReferralCode = normalizedReferralCode;
  }

  const ts = nowIso();
  const userId = randomId("user");
  const passwordMeta = createPassword(password);
  const isTemporaryInvite = invite.isTemporary;
  const tokenBindLimit = Math.max(1, Math.min(999, Number(invite.bindAccountLimit) || 999));
  const trialExpiresAt = isTemporaryInvite
    ? new Date(Date.now() + TEMP_ACCOUNT_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;
  let referralAttribution = null;

  transaction(() => {
    userRepository.create({
      id: userId,
      username,
      email: email || null,
      passwordSalt: passwordMeta.salt,
      passwordHash: passwordMeta.hash,
      trialExpiresAt,
      accountDisplayId: createAccountDisplayId(),
      accessScope: ACCESS_SCOPE_TASK_CONTROL_ONLY,
      tokenBindLimit,
      isAdmin: false,
      createdAt: ts,
      updatedAt: ts,
    });

    inviteCodeRepository.consumeById({
      id: invite.id,
      usedBy: userId,
      usedAt: ts,
    });

    if (effectiveReferralCode) {
      referralAttribution = attachReferralAttributionOnRegister({
        referralCode: effectiveReferralCode,
        referredUserId: userId,
        inviteCodeId: invite.id,
        inviteCodeMask: invite.codeMask || invite.code || null,
        registeredAt: ts,
        registerIp: req.ip || null,
        registerUserAgent: req.headers["user-agent"] || null,
      });
    }
  });

  clearReferralCookie(req, res);

  return res.json({
    success: true,
    message: "注册成功",
    data: {
      isTemporaryInvite,
      trialExpiresAt,
      referralAttributed: Boolean(referralAttribution?.id),
    },
  });
});

router.post("/login", loginLimiter, validateRequest({ body: loginBodySchema }), (req, res) => {
  const { username, password } = req.body;
  const rememberMe = Boolean(req.body?.rememberMe);

  const user = userRepository.findByIdentity(username);

  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    recordSecurityEvent({
      userId: user?.id || null,
      eventType: "login_failed",
      detail: {
        reason: "invalid_credentials",
        identity: maskIdentity(username),
      },
      ...reqMeta(req),
    });
    return errorResponse(res, 401, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误");
  }

  if (isLegacyPasswordHash(user.passwordHash)) {
    const upgraded = createPassword(password);
    userRepository.updatePassword({
      id: user.id,
      passwordSalt: upgraded.salt,
      passwordHash: upgraded.hash,
      updatedAt: nowIso(),
    });
  }
  if (
    user.trialExpiresAt
    && Number.isFinite(new Date(user.trialExpiresAt).getTime())
    && new Date(user.trialExpiresAt).getTime() < Date.now()
  ) {
    recordSecurityEvent({
      userId: user.id,
      eventType: "login_failed",
      detail: { reason: "trial_expired" },
      ...reqMeta(req),
    });
    return errorResponse(
      res,
      403,
      "AUTH_TRIAL_EXPIRED",
      "账号试用已到期，请联系管理员",
    );
  }

  if (user.mfaEnabled) {
    const mfaChallengeToken = issueMfaChallengeToken(user, { rememberMe });
    recordSecurityEvent({
      userId: user.id,
      eventType: "login_failed",
      detail: { reason: "mfa_required" },
      ...reqMeta(req),
    });
    return res.json({
      success: true,
      message: "需要二步验证",
      data: {
        mfaRequired: true,
        mfaChallengeToken,
      },
    });
  }

  return finalizeLogin({ req, res, user, rememberMe });
});

router.post(
  "/mfa/verify",
  mfaVerifyLimiter,
  validateRequest({ body: mfaVerifyBodySchema }),
  (req, res) => {
    const mfaChallengeToken = String(req.body?.mfaChallengeToken || "").trim();
    const totpCode = String(req.body?.totpCode || "").trim();
    const recoveryCode = String(req.body?.recoveryCode || "").trim();
    if (!totpCode && !recoveryCode) {
      return res.status(400).json({ success: false, message: "请输入验证码或恢复码" });
    }

    const challengeCheck = getMfaChallengeUser(mfaChallengeToken);
    if (!challengeCheck.ok) {
      recordSecurityEvent({
        userId: null,
        eventType: "login_failed",
        detail: { reason: "mfa_challenge_invalid" },
        ...reqMeta(req),
      });
      return errorResponse(
        res,
        challengeCheck.status,
        challengeCheck.code,
        challengeCheck.message,
      );
    }

    const { user, secret } = challengeCheck;

    const passed = verifyMfaCredentials({
      user,
      secret,
      totpCode,
      recoveryCode,
    }).ok;

    if (!passed) {
      recordSecurityEvent({
        userId: user.id,
        eventType: "login_failed",
        detail: { reason: "mfa_verify_failed" },
        ...reqMeta(req),
      });
      return errorResponse(res, 401, "AUTH_MFA_INVALID_CODE", "双重验证失败，请重试");
    }

    return finalizeLogin({
      req,
      res,
      user,
      rememberMe: Boolean(challengeCheck.payload?.rememberMe),
    });
  },
);

router.post(
  "/mfa/qr/session",
  mfaVerifyLimiter,
  validateRequest({ body: mfaQrSessionCreateBodySchema }),
  (req, res) => {
    cleanupExpiredMfaQrSessions();

    const mfaChallengeToken = String(req.body?.mfaChallengeToken || "").trim();
    const challengeCheck = getMfaChallengeUser(mfaChallengeToken);
    if (!challengeCheck.ok) {
      return errorResponse(
        res,
        challengeCheck.status,
        challengeCheck.code,
        challengeCheck.message,
      );
    }

    const now = Date.now();
    const sessionId = secureId("mfaqr");
    mfaQrSessionStore.set(sessionId, {
      id: sessionId,
      userId: challengeCheck.user.id,
      mfaChallengeToken,
      createdAtMs: now,
      expiresAtMs: now + MFA_QR_SESSION_TTL_MS,
      approvedAtMs: 0,
      consumedAtMs: 0,
    });

    return res.json({
      success: true,
      data: {
        sessionId,
        expiresAt: new Date(now + MFA_QR_SESSION_TTL_MS).toISOString(),
      },
    });
  },
);

router.post(
  "/mfa/qr/approve",
  mfaVerifyLimiter,
  validateRequest({ body: mfaQrApproveBodySchema }),
  (req, res) => {
    cleanupExpiredMfaQrSessions();
    const sessionId = String(req.body?.sessionId || "").trim();
    const totpCode = String(req.body?.totpCode || "").trim();
    const recoveryCode = String(req.body?.recoveryCode || "").trim();
    if (!totpCode && !recoveryCode) {
      return res.status(400).json({ success: false, message: "请输入验证码或恢复码" });
    }

    const session = mfaQrSessionStore.get(sessionId);
    if (!session) {
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (session.consumedAtMs) {
      mfaQrSessionStore.delete(sessionId);
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (Date.now() > Number(session.expiresAtMs || 0)) {
      mfaQrSessionStore.delete(sessionId);
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已过期，请刷新二维码后重试");
    }

    const challengeCheck = getMfaChallengeUser(session.mfaChallengeToken);
    if (!challengeCheck.ok) {
      mfaQrSessionStore.delete(sessionId);
      return errorResponse(
        res,
        challengeCheck.status,
        challengeCheck.code,
        challengeCheck.message,
      );
    }

    const passed = verifyMfaCredentials({
      user: challengeCheck.user,
      secret: challengeCheck.secret,
      totpCode,
      recoveryCode,
    }).ok;

    if (!passed) {
      recordSecurityEvent({
        userId: challengeCheck.user.id,
        eventType: "login_failed",
        detail: { reason: "mfa_qr_verify_failed" },
        ...reqMeta(req),
      });
      return errorResponse(res, 401, "AUTH_MFA_INVALID_CODE", "双重验证失败，请重试");
    }

    session.approvedAtMs = Date.now();
    mfaQrSessionStore.set(sessionId, session);
    return res.json({ success: true, message: "扫码验证通过，请返回登录页面" });
  },
);

router.post(
  "/mfa/qr/poll",
  mfaQrPollLimiter,
  validateRequest({ body: mfaQrSessionIdBodySchema }),
  (req, res) => {
    cleanupExpiredMfaQrSessions();
    const sessionId = String(req.body?.sessionId || "").trim();
    const session = mfaQrSessionStore.get(sessionId);
    if (!session) {
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (session.consumedAtMs) {
      mfaQrSessionStore.delete(sessionId);
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (Date.now() > Number(session.expiresAtMs || 0)) {
      mfaQrSessionStore.delete(sessionId);
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已过期，请刷新二维码后重试");
    }
    if (!session.approvedAtMs) {
      return res.json({
        success: true,
        data: {
          status: "pending",
        },
      });
    }

    const challengeCheck = getMfaChallengeUser(session.mfaChallengeToken);
    if (!challengeCheck.ok) {
      mfaQrSessionStore.delete(sessionId);
      return errorResponse(
        res,
        challengeCheck.status,
        challengeCheck.code,
        challengeCheck.message,
      );
    }

    session.consumedAtMs = Date.now();
    mfaQrSessionStore.set(sessionId, session);
    mfaQrSessionStore.delete(sessionId);
    return finalizeLogin({
      req,
      res,
      user: challengeCheck.user,
      rememberMe: Boolean(challengeCheck.payload?.rememberMe),
    });
  },
);

router.post(
  "/mfa/setup",
  authRequired,
  validateRequest({ body: mfaSetupBodySchema }),
  (req, res) => {
    const userPwd = userRepository.findPasswordById(req.auth.user.id);
    const password = String(req.body?.password || "");
    const ok = Boolean(
      userPwd
      && verifyPassword(password, userPwd.passwordSalt, userPwd.passwordHash),
    );
    if (!ok) {
      return res.status(400).json({ success: false, message: "当前密码错误" });
    }

    const setup = createMfaSetupPayload({
      username: req.auth.user.username,
    });
    return res.json({
      success: true,
      data: {
        secret: setup.secret,
        otpauthUrl: setup.otpauthUrl,
      },
    });
  },
);

router.post(
  "/mfa/enable",
  authRequired,
  validateRequest({ body: mfaEnableBodySchema }),
  (req, res) => {
    const userPwd = userRepository.findPasswordById(req.auth.user.id);
    const password = String(req.body?.password || "");
    const ok = Boolean(
      userPwd
      && verifyPassword(password, userPwd.passwordSalt, userPwd.passwordHash),
    );
    if (!ok) {
      return res.status(400).json({ success: false, message: "当前密码错误" });
    }

    const secret = String(req.body?.secret || "").trim();
    const totpCode = String(req.body?.totpCode || "").trim();
    if (!verifyTotpCode({ secret, code: totpCode })) {
      return res.status(400).json({ success: false, message: "验证码无效，请检查时间同步后重试" });
    }

    const setup = createMfaSetupPayload({
      username: req.auth.user.username,
    });
    userRepository.updateMfaSettings({
      id: req.auth.user.id,
      mfaEnabled: true,
      mfaTotpSecretEnc: encryptMfaSecret(secret),
      mfaRecoveryCodesHash: JSON.stringify(setup.recoveryCodeHashes),
      updatedAt: nowIso(),
    });
    recordSecurityEvent({
      userId: req.auth.user.id,
      eventType: "mfa_enabled",
      detail: { method: "totp" },
      ...reqMeta(req),
    });

    return res.json({
      success: true,
      message: "双重验证已启用",
      data: {
        recoveryCodes: setup.recoveryCodes,
      },
    });
  },
);

router.post(
  "/mfa/disable",
  authRequired,
  validateRequest({ body: mfaDisableBodySchema }),
  (req, res) => {
    const userPwd = userRepository.findPasswordById(req.auth.user.id);
    const password = String(req.body?.password || "");
    const ok = Boolean(
      userPwd
      && verifyPassword(password, userPwd.passwordSalt, userPwd.passwordHash),
    );
    if (!ok) {
      return res.status(400).json({ success: false, message: "当前密码错误" });
    }

    const user = userRepository.findById(req.auth.user.id);
    const secret = decryptMfaSecret(user?.mfaTotpSecretEnc || "");
    let passed = false;
    const totpCode = String(req.body?.totpCode || "").trim();
    const recoveryCode = String(req.body?.recoveryCode || "").trim();
    if (totpCode && secret) {
      passed = verifyTotpCode({ secret, code: totpCode });
    } else if (recoveryCode) {
      const recoveryResult = verifyAndConsumeRecoveryCode({
        inputCode: recoveryCode,
        recoveryCodeHashesJson: user?.mfaRecoveryCodesHash || "[]",
      });
      passed = recoveryResult.ok;
    }
    if (!passed) {
      return res.status(400).json({ success: false, message: "验证码或恢复码无效" });
    }

    userRepository.disableMfa({
      id: req.auth.user.id,
      updatedAt: nowIso(),
    });
    recordSecurityEvent({
      userId: req.auth.user.id,
      eventType: "mfa_disabled",
      detail: { method: "totp_or_recovery" },
      ...reqMeta(req),
    });
    return res.json({ success: true, message: "双重验证已关闭" });
  },
);

router.post(
  "/mfa/reset-by-link",
  validateRequest({ body: mfaResetLinkBodySchema }),
  (req, res) => {
    let payload;
    try {
      payload = parseMfaResetLinkToken(String(req.body?.token || "").trim());
    } catch {
      return res.status(401).json({
        success: false,
        message: "重置链接无效或已过期",
      });
    }

    const user = userRepository.findById(String(payload?.sub || ""));
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "账号不存在",
      });
    }

    if (user.isAdmin && !isLocalMfaResetRequest(req)) {
      return res.status(403).json({
        success: false,
        message: "管理员账号的二次验证重置仅允许在本地 127.0.0.1 环境执行",
      });
    }

    if (Number(user.tokenVersion ?? 0) !== Number(payload?.ver ?? -1)) {
      return res.status(401).json({
        success: false,
        message: "重置链接无效或已失效",
      });
    }

    if (!user.mfaEnabled) {
      return res.json({
        success: true,
        message: "当前账号的二次验证已处于未启用状态",
      });
    }

    const ts = nowIso();
    userRepository.disableMfa({
      id: user.id,
      updatedAt: ts,
    });
    userRepository.bumpTokenVersion({
      id: user.id,
      updatedAt: ts,
    });
    refreshTokenRepository.revokeAllByUserId({
      userId: user.id,
      revokedAt: ts,
    });
    recordSecurityEvent({
      userId: user.id,
      eventType: "mfa_reset_by_link",
      detail: {
        requestedBy: String(payload?.requestedBy || "").trim() || null,
      },
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
      createdAt: ts,
    });

    return res.json({
      success: true,
      message: "二次验证已重置，请重新登录后完成绑定",
    });
  },
);

export {
  issueMfaResetLinkToken,
  MFA_RESET_LINK_TTL_SECONDS,
};

router.post("/logout", (req, res) => {
  const revokedAt = nowIso();
  const refreshTokenRaw = readRefreshTokenFromRequest(req);
  const tokenId = refreshTokenRaw.split(".")[0] || "";
  if (tokenId) {
    const record = refreshTokenRepository.findById(tokenId);
    if (record) {
      refreshTokenRepository.revokeById({
        id: tokenId,
        revokedAt,
        lastUsedAt: revokedAt,
        lastUsedIp: req.ip || null,
        lastUsedUserAgent: req.headers["user-agent"] || null,
      });
    }
  }
  clearRefreshCookie(req, res);
  clearAccessCookie(req, res);
  clearCsrfCookies(req, res);
  return res.json({ success: true, message: "已退出登录" });
});

router.post("/logout-all", authRequired, (req, res) => {
  const revokedAt = nowIso();
  const userId = req.auth.user.id;
  userRepository.bumpTokenVersion({
    id: userId,
    updatedAt: revokedAt,
  });
  refreshTokenRepository.revokeAllByUserId({
    userId,
    revokedAt,
  });
  disconnectUserSockets(userId, "Session revoked");
  clearRefreshCookie(req, res);
  clearAccessCookie(req, res);
  clearCsrfCookies(req, res);
  return res.json({ success: true, message: "已退出全部设备" });
});

router.post("/password-reset", resetPasswordLimiter, validateRequest({ body: passwordResetBodySchema }), async (req, res) => {
  const identity = req.body.identity;
  const shortCode = req.body.shortCode.toUpperCase();
  const newPassword = req.body.newPassword;
  const passwordCheck = await validatePasswordStrengthAsync(newPassword, { mfaEnabled: false });
  if (!passwordCheck.valid) {
    return res.status(400).json({ success: false, message: passwordCheck.message });
  }

  const user = userRepository.findByIdentity(identity);
  if (!user) {
    logPasswordResetMaskedReason(identity, "user_not_found");
    return res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  }

  const now = Date.now();
  const codeRow = userRepository.findLatestPasswordResetCode({
    userId: user.id,
    code: shortCode,
  });

  if (!codeRow || Number(codeRow.isActive) !== 1 || codeRow.usedAt) {
    logPasswordResetMaskedReason(identity, "invalid_or_inactive_code");
    return res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  }

  const expiresTs = new Date(codeRow.expiresAt).getTime();
  if (!Number.isFinite(expiresTs) || expiresTs < now) {
    userRepository.deactivatePasswordResetCode(codeRow.id);
    logPasswordResetMaskedReason(identity, "expired_code");
    return res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  }

  const meta = createPassword(newPassword);
  const ts = nowIso();
  transaction(() => {
    userRepository.updatePassword({
      id: user.id,
      passwordSalt: meta.salt,
      passwordHash: meta.hash,
      updatedAt: ts,
    });
    userRepository.bumpTokenVersion({
      id: user.id,
      updatedAt: ts,
    });
    refreshTokenRepository.revokeAllByUserId({
      userId: user.id,
      revokedAt: ts,
    });

    userRepository.usePasswordResetCode({
      id: codeRow.id,
      usedAt: ts,
    });
  });
  disconnectUserSockets(user.id, "Password reset");

  clearAccessCookie(req, res);
  clearRefreshCookie(req, res);
  clearCsrfCookies(req, res);
  return res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
});

router.post("/refresh", (req, res) => {
  try {
    const refreshTokenRaw = readRefreshTokenFromRequest(req);
    if (!refreshTokenRaw) {
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 401, "AUTH_REFRESH_MISSING", "缺少刷新令牌，请重新登录");
    }

    const [tokenId] = refreshTokenRaw.split(".");
    if (!tokenId) {
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 401, "AUTH_REFRESH_INVALID", "刷新令牌无效，请重新登录");
    }

    const record = refreshTokenRepository.findById(tokenId);
    const tokenHash = sha256Hex(refreshTokenRaw);
    if (!record || record.tokenHash !== tokenHash) {
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 401, "AUTH_REFRESH_INVALID", "刷新令牌无效，请重新登录");
    }

    if (record.revokedAt) {
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 401, "AUTH_REFRESH_REVOKED", "登录状态已失效，请重新登录");
    }

    const expiresTs = new Date(record.expiresAt).getTime();
    if (!Number.isFinite(expiresTs) || expiresTs <= Date.now()) {
      refreshTokenRepository.revokeById({
        id: record.id,
        revokedAt: nowIso(),
        lastUsedAt: nowIso(),
        lastUsedIp: req.ip || null,
        lastUsedUserAgent: req.headers["user-agent"] || null,
      });
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 401, "AUTH_REFRESH_EXPIRED", "登录状态已过期，请重新登录");
    }

    const user = userRepository.findById(record.userId);
    if (!user) {
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 401, "AUTH_USER_NOT_FOUND", "用户不存在或已失效");
    }
    if (Number(record.tokenVersion ?? 0) !== Number(user.tokenVersion ?? 0)) {
      refreshTokenRepository.revokeById({
        id: record.id,
        revokedAt: nowIso(),
        lastUsedAt: nowIso(),
        lastUsedIp: req.ip || null,
        lastUsedUserAgent: req.headers["user-agent"] || null,
      });
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 401, "AUTH_REFRESH_REVOKED", "登录状态已失效，请重新登录");
    }
    if (
      user.trialExpiresAt
      && Number.isFinite(new Date(user.trialExpiresAt).getTime())
      && new Date(user.trialExpiresAt).getTime() < Date.now()
    ) {
      clearRefreshCookie(req, res);
      clearAccessCookie(req, res);
      return errorResponse(res, 403, "AUTH_TRIAL_EXPIRED", "账号试用已到期，请联系管理员");
    }

    const lastLoginAt = nowIso();
    userRepository.updateLastLogin({
      id: user.id,
      lastLoginAt,
      updatedAt: lastLoginAt,
    });

    const nextRefresh = rotateRefreshToken({
      currentTokenId: record.id,
      user,
      req,
      rememberMe: inferRememberMeFromRefreshRecord(record),
    });
    const nextRefreshMaxAge = Math.max(
      0,
      new Date(nextRefresh.expiresAt).getTime() - Date.now(),
    );
    res.cookie(
      env.refreshCookieName,
      nextRefresh.refreshToken,
      refreshCookieOptions(req, nextRefreshMaxAge),
    );

    const token = buildAccessToken(user);
    setAccessCookie(req, res, token);
    const tokenPayload = env.accessTokenExposeInBody ? { token } : {};
    return res.json({ success: true, data: tokenPayload });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[auth-refresh] failed:", {
      message: error?.message || "unknown",
      stack: error?.stack || "",
      path: redactUrl(req.originalUrl || req.url || "/auth/refresh"),
      ip: req.ip || "unknown",
      userAgent: req.headers["user-agent"] || "",
    });
    clearRefreshCookie(req, res);
    clearAccessCookie(req, res);
    return errorResponse(res, 401, "AUTH_REFRESH_INVALID", "刷新令牌无效，请重新登录");
  }
});

router.get("/user", authRequired, (req, res) => {
  return res.json({ success: true, data: req.auth.user });
});

router.get("/me", authRequired, (req, res) => {
  return res.json({ success: true, data: req.auth.user });
});

router.get("/csrf", (req, res) => {
  return res.json({
    success: true,
    data: {
      headerName: env.csrfHeaderName,
      token: req.csrfToken || null,
      hasRefreshTokenCookie: Boolean(readRefreshTokenFromRequest(req)),
    },
  });
});

export default router;
