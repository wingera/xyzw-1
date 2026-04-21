import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import {
  createPassword,
  verifyPassword,
} from "../lib/crypto.js";
import { validatePasswordStrengthAsync } from "../lib/passwordPolicy.js";
import { nowIso, randomId, secureId } from "../db/sql.js";
import { authRequired } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validate.js";
import { errorResponse } from "../lib/httpResponse.js";
import { userSensitiveActionRequired } from "../middleware/userSensitiveAction.js";
import { inviteCodeRepository } from "../repositories/inviteCodeRepository.js";
import { referralProfileRepository } from "../repositories/referralProfileRepository.js";
import { refreshTokenRepository } from "../repositories/refreshTokenRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { transaction } from "../db/client.js";
import { env } from "../config/env.js";
import {
  clearReferralCookie,
  readReferralCookieFromRequest,
} from "../lib/referralCookie.js";
import { clearCsrfCookies } from "../middleware/csrf.js";
import { ACCESS_SCOPE_TASK_CONTROL_ONLY } from "../constants/accessScope.js";
import { disconnectUserSockets } from "../services/wsHub.js";
import { redactUrl } from "../lib/logRedactor.js";
import {
  loginBodySchema,
  mfaDisableBodySchema,
  mfaEnableBodySchema,
  mfaQrApproveBodySchema,
  mfaQrSessionCreateBodySchema,
  mfaQrSessionIdBodySchema,
  mfaResetLinkBodySchema,
  mfaSetupBodySchema,
  mfaVerifyBodySchema,
  passwordResetBodySchema,
  registerBodySchema,
} from "../modules/auth/authSchemas.js";
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
import {
  buildAccessToken,
  inferRememberMeFromRefreshRecord,
} from "../modules/auth/tokens.js";
import {
  clearAccessCookie,
  clearRefreshCookie,
  readRefreshTokenFromRequest,
  refreshCookieOptions,
  setAccessCookie,
} from "../modules/auth/cookies.js";
import {
  buildAuthUserPayload,
  issueLoginSession,
  reqMeta,
} from "../modules/auth/session.js";
import {
  findAuthUserByIdentity,
  getAuthLoginBlockedError,
  upgradeAuthPasswordIfNeeded,
  verifyAuthPassword,
} from "../modules/auth/authService.js";
import {
  assertRefreshSessionUsable,
  assertTokenVersionCurrent,
  assertTrialActive,
  findRefreshSessionByTokenHash,
  getSessionUser,
  rotateRefreshSession,
} from "../modules/auth/sessionService.js";
import {
  cleanupExpiredMfaQrSessions,
  createMfaQrSession,
  deleteMfaQrSession,
  getMfaChallengeUser,
  getMfaQrSession,
  saveMfaQrSession,
  verifyMfaCredentials,
} from "../modules/auth/mfaChallenge.js";
import {
  createMfaLoginChallenge,
  issueMfaResetLinkToken,
  MFA_RESET_LINK_TTL_SECONDS,
  parseMfaResetLinkToken,
  resolveMfaLoginChallenge,
  verifyMfaLoginCredentials,
} from "../modules/auth/mfaService.js";
import {
  isLocalMfaResetRequest,
  logPasswordResetMaskedReason,
  maskIdentity,
  PASSWORD_RESET_GENERIC_MESSAGE,
} from "../modules/auth/passwordReset.js";
import {
  applyPasswordReset,
  assertPasswordResetCodeUsable,
  findPasswordResetCode,
  findPasswordResetUser,
} from "../modules/auth/passwordResetService.js";
import { buildCsrfResponseData } from "../modules/auth/csrf.js";
import {
  buildWechatAuthorizeUrl,
  isWechatAuthConfigured,
  loadWechatUserProfileByCode,
} from "../modules/auth/wechatAuthService.js";

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
const refreshLimiter = createRateLimiter({
  scope: "auth_refresh",
  windowMs: 5 * 60 * 1000,
  max: 20,
  blockMs: 10 * 60 * 1000,
  keyGenerator: (req) => req.ip || "anonymous",
});
const INVITE_AUTO_DISABLE_HOURS = 48;
const TEMP_ACCOUNT_DAYS = 7;
const wechatLoginStartBodySchema = z.object({
  rememberMe: z.boolean().optional().default(false),
}).strict();
const WECHAT_AUTH_FLOW_TTL_MS = 5 * 60 * 1000;
const MAX_WECHAT_AUTH_FLOW_COUNT = 500;
const WECHAT_AUTH_CALLBACK_SOURCE = "xyzw-wechat-auth";
const wechatAuthFlowStore = new Map();

const createAccountDisplayId = () => {
  const raw = crypto.randomBytes(8).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") || raw;
};

const referralRegisterError = (req, res, code, message) => {
  clearReferralCookie(req, res);
  return res.status(400).json({
    success: false,
    code,
    message,
  });
};

const cleanupExpiredWechatAuthFlows = () => {
  const now = Date.now();
  for (const [flowId, flow] of wechatAuthFlowStore.entries()) {
    if (!flow || Number(flow.expiresAtMs || 0) <= now) {
      wechatAuthFlowStore.delete(flowId);
    }
  }
  if (wechatAuthFlowStore.size <= MAX_WECHAT_AUTH_FLOW_COUNT) {
    return;
  }
  const flows = Array.from(wechatAuthFlowStore.entries()).sort(
    (a, b) => Number(a?.[1]?.createdAtMs || 0) - Number(b?.[1]?.createdAtMs || 0),
  );
  const removeCount = Math.max(0, flows.length - MAX_WECHAT_AUTH_FLOW_COUNT);
  for (let i = 0; i < removeCount; i += 1) {
    wechatAuthFlowStore.delete(String(flows[i]?.[0] || ""));
  }
};

const createWechatAuthFlow = ({ intent, rememberMe = false, userId = null }) => {
  cleanupExpiredWechatAuthFlows();
  const createdAtMs = Date.now();
  const flowId = secureId("wxflow");
  wechatAuthFlowStore.set(flowId, {
    id: flowId,
    intent: String(intent || "").trim(),
    rememberMe: Boolean(rememberMe),
    userId: String(userId || "").trim() || null,
    createdAtMs,
    expiresAtMs: createdAtMs + WECHAT_AUTH_FLOW_TTL_MS,
  });
  return {
    flowId,
    authorizeUrl: buildWechatAuthorizeUrl({ state: flowId }),
  };
};

const consumeWechatAuthFlow = (flowId) => {
  cleanupExpiredWechatAuthFlows();
  const safeFlowId = String(flowId || "").trim();
  const flow = wechatAuthFlowStore.get(safeFlowId);
  if (!flow) {
    return null;
  }
  wechatAuthFlowStore.delete(safeFlowId);
  return flow;
};

const maskWechatOpenId = (openId) => {
  const value = String(openId || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= 6) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
};

const createWechatCallbackPayload = ({
  intent,
  success,
  flowId,
  message,
  errorCode = "",
  mfaRequired = false,
  mfaChallengeToken = "",
}) => {
  const payload = {
    source: WECHAT_AUTH_CALLBACK_SOURCE,
    intent: String(intent || "").trim() || "login",
    success: Boolean(success),
    flowId: String(flowId || "").trim(),
    message: String(message || "").trim(),
  };
  if (!payload.success && errorCode) {
    payload.errorCode = String(errorCode || "").trim();
  }
  if (mfaRequired) {
    payload.mfaRequired = true;
    payload.mfaChallengeToken = String(mfaChallengeToken || "").trim();
  }
  return payload;
};

const sendWechatCallbackHtml = (res, payload) => {
  const serializedPayload = encodeURIComponent(JSON.stringify(payload || {}));
  return res
    .status(200)
    .type("html")
    .send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>微信登录</title>
</head>
<body>
  <p id="message">处理中...</p>
  <script>
    const payload = JSON.parse(decodeURIComponent("${serializedPayload}"));
    const fallback = payload.message || (payload.success ? "操作成功，请返回原页面继续。" : "操作失败，请返回原页面重试。");
    const messageEl = document.getElementById("message");
    if (messageEl) {
      messageEl.textContent = fallback;
    }
    try {
      if (window.opener) {
        window.opener.postMessage(payload, window.location.origin);
      }
    } catch (error) {
      console.error(error);
    }
    try {
      window.close();
    } catch (error) {
      console.error(error);
    }
  </script>
</body>
</html>`);
};

const isWechatBindingConflictError = (error) => {
  const message = String(error?.message || "");
  return (
    message.includes("idx_users_wechat_open_id")
    || message.includes("idx_users_wechat_union_id")
    || message.includes("users.wechat_open_id")
    || message.includes("users.wechat_union_id")
  );
};

const finalizeLogin = ({
  req,
  res,
  user,
  rememberMe = false,
  loginMethod = "password",
}) => {
  const session = issueLoginSession({
    req,
    res,
    user,
    rememberMe,
    loginMethod,
  });

  return res.json({
    success: true,
    message: "登录成功",
    data: {
      ...(env.accessTokenExposeInBody ? { token: session.token } : {}),
      user: buildAuthUserPayload(user, {
        lastLoginAt: session.lastLoginAt,
      }),
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

  const user = findAuthUserByIdentity(username);
  const passwordCheck = verifyAuthPassword({ user, password });

  if (!user || !passwordCheck.ok) {
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

  upgradeAuthPasswordIfNeeded({ user, password, passwordCheck });
  const blocked = getAuthLoginBlockedError(user);
  if (blocked) {
    recordSecurityEvent({
      userId: user.id,
      eventType: "login_failed",
      detail: { reason: blocked.reason },
      ...reqMeta(req),
    });
    return errorResponse(
      res,
      blocked.status,
      blocked.code,
      blocked.message,
    );
  }

  if (user.mfaEnabled) {
    const mfaChallengeToken = createMfaLoginChallenge({
      user,
      rememberMe,
      loginMethod: "password+mfa",
    });
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

  return finalizeLogin({
    req,
    res,
    user,
    rememberMe,
    loginMethod: "password",
  });
});

router.post(
  "/wechat/login/start",
  validateRequest({ body: wechatLoginStartBodySchema }),
  (req, res) => {
    if (!isWechatAuthConfigured()) {
      return errorResponse(
        res,
        503,
        "AUTH_WECHAT_NOT_CONFIGURED",
        "微信登录暂未配置",
      );
    }

    const { flowId, authorizeUrl } = createWechatAuthFlow({
      intent: "login",
      rememberMe: Boolean(req.body?.rememberMe),
    });
    return res.json({
      success: true,
      data: {
        authorizeUrl,
        flowId,
      },
    });
  },
);

router.post("/wechat/bind/start", authRequired, (req, res) => {
  if (!isWechatAuthConfigured()) {
    return errorResponse(
      res,
      503,
      "AUTH_WECHAT_NOT_CONFIGURED",
      "微信绑定暂未配置",
    );
  }

  const { flowId, authorizeUrl } = createWechatAuthFlow({
    intent: "bind",
    userId: req.auth.user.id,
  });
  return res.json({
    success: true,
    data: {
      authorizeUrl,
      flowId,
    },
  });
});

router.get("/wechat/callback", async (req, res) => {
  const flowId = String(req.query?.state || "").trim();
  const code = String(req.query?.code || "").trim();
  const flow = consumeWechatAuthFlow(flowId);
  const intent = String(flow?.intent || "login").trim() || "login";
  const callbackFailure = ({
    message,
    errorCode,
  }) =>
    sendWechatCallbackHtml(
      res,
      createWechatCallbackPayload({
        intent,
        success: false,
        flowId,
        message,
        errorCode,
      }),
    );

  try {
    if (!isWechatAuthConfigured()) {
      return callbackFailure({
        message: "微信登录暂未配置",
        errorCode: "AUTH_WECHAT_NOT_CONFIGURED",
      });
    }

    if (!flow) {
      return callbackFailure({
        message: "微信登录状态已失效，请重新发起操作",
        errorCode: "AUTH_WECHAT_FLOW_INVALID",
      });
    }

    if (!code) {
      if (intent === "bind" && flow.userId) {
        recordSecurityEvent({
          userId: flow.userId,
          eventType: "wechat_bind_failed",
          detail: { reason: "missing_code" },
          ...reqMeta(req),
        });
      } else {
        recordSecurityEvent({
          userId: null,
          eventType: "wechat_login_failed",
          detail: { reason: "missing_code" },
          ...reqMeta(req),
        });
      }
      return callbackFailure({
        message: "缺少微信授权结果，请重新扫码后重试",
        errorCode: "AUTH_WECHAT_CODE_MISSING",
      });
    }

    let profile;
    try {
      profile = await loadWechatUserProfileByCode(code);
    } catch (error) {
      if (intent === "bind" && flow.userId) {
        recordSecurityEvent({
          userId: flow.userId,
          eventType: "wechat_bind_failed",
          detail: {
            reason: "upstream_error",
            errorCode: String(error?.code || "AUTH_WECHAT_UPSTREAM_ERROR"),
          },
          ...reqMeta(req),
        });
      } else {
        recordSecurityEvent({
          userId: null,
          eventType: "wechat_login_failed",
          detail: {
            reason: "upstream_error",
            errorCode: String(error?.code || "AUTH_WECHAT_UPSTREAM_ERROR"),
          },
          ...reqMeta(req),
        });
      }
      return callbackFailure({
        message: error?.message || "微信登录失败，请重新扫码后重试",
        errorCode: String(error?.code || "AUTH_WECHAT_UPSTREAM_ERROR"),
      });
    }

    if (intent === "bind") {
      const currentUser = userRepository.findById(flow.userId);
      if (!currentUser) {
        recordSecurityEvent({
          userId: flow.userId || null,
          eventType: "wechat_bind_failed",
          detail: { reason: "user_not_found" },
          ...reqMeta(req),
        });
        return callbackFailure({
          message: "当前账号不存在或已失效",
          errorCode: "AUTH_USER_NOT_FOUND",
        });
      }

      const existingBinding = userRepository.findWechatBindingByUserId(currentUser.id);
      const existingUser = userRepository.findByWechatIdentity(profile);
      if (existingUser && existingUser.id !== currentUser.id) {
        recordSecurityEvent({
          userId: currentUser.id,
          eventType: "wechat_bind_failed",
          detail: { reason: "already_bound" },
          ...reqMeta(req),
        });
        return callbackFailure({
          message: "该微信已绑定其他账号",
          errorCode: "AUTH_WECHAT_ALREADY_BOUND",
        });
      }

      const boundAt = existingUser?.id === currentUser.id
        && String(existingBinding?.openId || "").trim() === String(profile.openId || "").trim()
        && String(existingBinding?.unionId || "").trim() === String(profile.unionId || "").trim()
        ? existingBinding?.boundAt || nowIso()
        : nowIso();

      try {
        userRepository.bindWechat({
          id: currentUser.id,
          openId: profile.openId,
          unionId: profile.unionId,
          appId: profile.appId,
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
          boundAt,
          updatedAt: boundAt,
        });
      } catch (error) {
        if (isWechatBindingConflictError(error)) {
          recordSecurityEvent({
            userId: currentUser.id,
            eventType: "wechat_bind_failed",
            detail: { reason: "already_bound" },
            ...reqMeta(req),
          });
          return callbackFailure({
            message: "该微信已绑定其他账号",
            errorCode: "AUTH_WECHAT_ALREADY_BOUND",
          });
        }
        throw error;
      }

      recordSecurityEvent({
        userId: currentUser.id,
        eventType: "wechat_bind_success",
        detail: {
          hasUnionId: Boolean(profile.unionId),
        },
        ...reqMeta(req),
      });
      return sendWechatCallbackHtml(
        res,
        createWechatCallbackPayload({
          intent: "bind",
          success: true,
          flowId,
          message: "微信绑定成功",
        }),
      );
    }

    const user = userRepository.findByWechatIdentity(profile);
    if (!user) {
      recordSecurityEvent({
        userId: null,
        eventType: "wechat_login_failed",
        detail: {
          reason: "not_bound",
          maskedOpenId: maskWechatOpenId(profile.openId),
        },
        ...reqMeta(req),
      });
      return callbackFailure({
        message: "该微信未绑定站内账号，请先使用账号密码登录后到个人中心绑定微信",
        errorCode: "AUTH_WECHAT_NOT_BOUND",
      });
    }

    const blocked = getAuthLoginBlockedError(user);
    if (blocked) {
      recordSecurityEvent({
        userId: user.id,
        eventType: "wechat_login_failed",
        detail: { reason: blocked.reason },
        ...reqMeta(req),
      });
      return callbackFailure({
        message: blocked.message,
        errorCode: blocked.code,
      });
    }

    if (user.mfaEnabled) {
      const mfaChallengeToken = createMfaLoginChallenge({
        user,
        rememberMe: Boolean(flow.rememberMe),
        loginMethod: "wechat+mfa",
      });
      recordSecurityEvent({
        userId: user.id,
        eventType: "wechat_login_failed",
        detail: {
          reason: "mfa_required",
          rememberMe: Boolean(flow.rememberMe),
        },
        ...reqMeta(req),
      });
      return sendWechatCallbackHtml(
        res,
        createWechatCallbackPayload({
          intent: "login",
          success: true,
          flowId,
          message: "需要二步验证",
          mfaRequired: true,
          mfaChallengeToken,
        }),
      );
    }

    issueLoginSession({
      req,
      res,
      user,
      rememberMe: Boolean(flow.rememberMe),
      loginMethod: "wechat",
    });
    return sendWechatCallbackHtml(
      res,
      createWechatCallbackPayload({
        intent: "login",
        success: true,
        flowId,
        message: "微信登录成功",
      }),
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[auth-wechat-callback] failed:", error);
    return callbackFailure({
      message: "微信登录失败，请稍后重试",
      errorCode: String(error?.code || "AUTH_WECHAT_CALLBACK_FAILED"),
    });
  }
});

router.get("/wechat/binding", authRequired, (req, res) => {
  if (!isWechatAuthConfigured()) {
    return errorResponse(
      res,
      503,
      "AUTH_WECHAT_NOT_CONFIGURED",
      "微信绑定暂未配置",
    );
  }

  const binding = userRepository.findWechatBindingByUserId(req.auth.user.id);
  const bound = Boolean(binding?.openId || binding?.unionId);
  return res.json({
    success: true,
    data: {
      bound,
      nickname: binding?.nickname || "",
      avatarUrl: binding?.avatarUrl || "",
      boundAt: binding?.boundAt || null,
      lastLoginAt: binding?.lastLoginAt || null,
      maskedOpenId: bound ? maskWechatOpenId(binding?.openId) : "",
    },
  });
});

router.post("/wechat/unbind", authRequired, userSensitiveActionRequired, (req, res) => {
  if (!isWechatAuthConfigured()) {
    return errorResponse(
      res,
      503,
      "AUTH_WECHAT_NOT_CONFIGURED",
      "微信绑定暂未配置",
    );
  }

  const binding = userRepository.findWechatBindingByUserId(req.auth.user.id);
  const updatedAt = nowIso();
  userRepository.clearWechatBinding({
    id: req.auth.user.id,
    updatedAt,
  });
  recordSecurityEvent({
    userId: req.auth.user.id,
    eventType: "wechat_unbind_success",
    detail: {
      hadBinding: Boolean(binding?.openId || binding?.unionId),
    },
    ...reqMeta(req),
  });
  return res.json({
    success: true,
    message: "微信解绑成功",
  });
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

    const challengeCheck = resolveMfaLoginChallenge(mfaChallengeToken);
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

    const passed = verifyMfaLoginCredentials({
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
      loginMethod: String(challengeCheck.payload?.loginMethod || "password+mfa"),
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

    const session = createMfaQrSession({
      userId: challengeCheck.user.id,
      mfaChallengeToken,
    });

    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        expiresAt: new Date(session.expiresAtMs).toISOString(),
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

    const session = getMfaQrSession(sessionId);
    if (!session) {
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (session.consumedAtMs) {
      deleteMfaQrSession(sessionId);
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (Date.now() > Number(session.expiresAtMs || 0)) {
      deleteMfaQrSession(sessionId);
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已过期，请刷新二维码后重试");
    }

    const challengeCheck = getMfaChallengeUser(session.mfaChallengeToken);
    if (!challengeCheck.ok) {
      deleteMfaQrSession(sessionId);
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
    saveMfaQrSession(session);
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
    const session = getMfaQrSession(sessionId);
    if (!session) {
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (session.consumedAtMs) {
      deleteMfaQrSession(sessionId);
      return errorResponse(res, 410, "AUTH_MFA_QR_SESSION_EXPIRED", "二维码会话已失效，请刷新二维码后重试");
    }
    if (Date.now() > Number(session.expiresAtMs || 0)) {
      deleteMfaQrSession(sessionId);
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
      deleteMfaQrSession(sessionId);
      return errorResponse(
        res,
        challengeCheck.status,
        challengeCheck.code,
        challengeCheck.message,
      );
    }

    session.consumedAtMs = Date.now();
    saveMfaQrSession(session);
    deleteMfaQrSession(sessionId);
    return finalizeLogin({
      req,
      res,
      user: challengeCheck.user,
      rememberMe: Boolean(challengeCheck.payload?.rememberMe),
      loginMethod: String(challengeCheck.payload?.loginMethod || "password+mfa"),
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

  const user = findPasswordResetUser(identity);
  if (!user) {
    logPasswordResetMaskedReason(identity, "user_not_found");
    return res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  }

  const now = Date.now();
  const codeRow = findPasswordResetCode({
    userId: user.id,
    shortCode,
  });

  const codeCheck = assertPasswordResetCodeUsable({ codeRow, nowMs: now });
  if (!codeCheck.ok) {
    logPasswordResetMaskedReason(identity, codeCheck.reason);
    return res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  }

  applyPasswordReset({
    user,
    codeRow,
    newPassword,
  });
  disconnectUserSockets(user.id, "Password reset");

  clearAccessCookie(req, res);
  clearRefreshCookie(req, res);
  clearCsrfCookies(req, res);
  return res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
});

const refreshSessionMetaFromRequest = (req) => ({
  ip: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
  lastUsedIp: req.ip || null,
  lastUsedUserAgent: req.headers["user-agent"] || null,
});

const sendRefreshSessionError = (req, res, error) => {
  clearRefreshCookie(req, res);
  clearAccessCookie(req, res);
  return errorResponse(
    res,
    Number(error?.status || 401),
    String(error?.code || "AUTH_REFRESH_INVALID"),
    String(error?.message || "刷新令牌无效，请重新登录"),
  );
};

router.post("/refresh", refreshLimiter, (req, res) => {
  try {
    const refreshTokenRaw = readRefreshTokenFromRequest(req);
    if (!refreshTokenRaw) {
      return sendRefreshSessionError(req, res, {
        status: 401,
        code: "AUTH_REFRESH_MISSING",
        message: "缺少刷新令牌，请重新登录",
      });
    }

    const lookup = findRefreshSessionByTokenHash(refreshTokenRaw);
    if (!lookup.ok) {
      return sendRefreshSessionError(req, res, lookup.error);
    }

    const sessionMeta = refreshSessionMetaFromRequest(req);
    const usable = assertRefreshSessionUsable({
      refreshTokenRecord: lookup.record,
      revokeMeta: sessionMeta,
    });
    if (!usable.ok) {
      return sendRefreshSessionError(req, res, usable.error);
    }

    const sessionUser = getSessionUser(lookup.record.userId);
    if (!sessionUser.ok) {
      return sendRefreshSessionError(req, res, sessionUser.error);
    }

    const user = sessionUser.user;
    const versionCheck = assertTokenVersionCurrent({
      refreshTokenRecord: lookup.record,
      user,
      revokeMeta: sessionMeta,
    });
    if (!versionCheck.ok) {
      return sendRefreshSessionError(req, res, versionCheck.error);
    }

    const trialCheck = assertTrialActive(user);
    if (!trialCheck.ok) {
      return sendRefreshSessionError(req, res, trialCheck.error);
    }

    const lastLoginAt = nowIso();
    userRepository.updateLastLogin({
      id: user.id,
      lastLoginAt,
      updatedAt: lastLoginAt,
    });

    const nextRefresh = rotateRefreshSession({
      currentTokenId: lookup.record.id,
      user,
      rememberMe: inferRememberMeFromRefreshRecord(lookup.record),
      meta: sessionMeta,
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
    data: buildCsrfResponseData(req),
  });
});

export default router;
