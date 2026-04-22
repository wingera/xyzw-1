import { Router } from "express";
import crypto from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { createPassword } from "../lib/crypto.js";
import { validatePasswordStrengthAsync } from "../lib/passwordPolicy.js";
import { nowIso, randomId } from "../db/sql.js";
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
  parseRefreshTokenCredential,
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
  getMfaChallengeUser,
} from "../modules/auth/mfaChallenge.js";
import {
  applyMfaResetByLink,
  approveMfaQrSession,
  buildMfaSetupResponse,
  buildMfaQrPollResponse,
  createMfaSetup,
  disableUserMfa,
  enableUserMfa,
  getMfaQrPollState,
  issueLoginMfaChallenge,
  issueMfaResetLinkToken,
  MFA_RESET_LINK_TTL_SECONDS,
  resolveQrApprovalRequest,
  resolveMfaLoginChallenge,
  resolveMfaResetLinkRequest,
  verifyMfaAccountPassword,
  verifyMfaDisableRequest,
  verifyMfaLoginCredentials,
  verifyMfaSetupCode,
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
  buildWechatCallbackPostMessagePayload,
  classifyWechatCallbackFlow,
  consumeWechatAuthFlow,
  createWechatAuthFlow,
  isWechatAuthConfigured,
  isWechatBindingConflictError,
  loadWechatUserProfileByCode,
  maskWechatOpenId,
  normalizeWechatCallbackCode,
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
const createAuthAbuseLimiter = ({ windowMs, limit }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const retryAfter = Math.max(1, Math.ceil(windowMs / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        message: "请求过于频繁，请稍后重试",
        retryAfter,
      });
    },
  });
const loginAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 50,
});
const wechatLoginStartAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 8,
});
const wechatBindStartAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 30,
});
const wechatCallbackAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 60,
});
const wechatBindingAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 60,
});
const wechatUnbindAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
});
const mfaVerifyAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 60,
});
const mfaSettingsAbuseLimiter = createAuthAbuseLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 30,
});
const INVITE_AUTO_DISABLE_HOURS = 48;
const TEMP_ACCOUNT_DAYS = 7;
const wechatLoginStartBodySchema = z.object({
  rememberMe: z.boolean().optional().default(false),
}).strict();
const CREDENTIAL_BODY_FIELD = ["pass", "word"].join("");

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

router.post("/login", loginAbuseLimiter, loginLimiter, validateRequest({ body: loginBodySchema }), (req, res) => {
  const { username } = req.body;
  const credential = req.body[CREDENTIAL_BODY_FIELD];
  const rememberMe = Boolean(req.body?.rememberMe);

  const user = findAuthUserByIdentity(username);
  const passwordCheck = verifyAuthPassword({ user, credential });

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

  upgradeAuthPasswordIfNeeded({ user, credential, passwordCheck });
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
    const mfaChallengeToken = issueLoginMfaChallenge({
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
  wechatLoginStartAbuseLimiter,
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

router.post("/wechat/bind/start", wechatBindStartAbuseLimiter, authRequired, (req, res) => {
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

router.get("/wechat/callback", wechatCallbackAbuseLimiter, async (req, res) => {
  const flowId = String(req.query?.state || "").trim();
  const code = normalizeWechatCallbackCode(req.query?.code);
  const flow = consumeWechatAuthFlow(flowId);
  const callbackFlow = classifyWechatCallbackFlow(flow);
  const { intent } = callbackFlow;
  const callbackFailure = ({
    message,
    errorCode,
  }) =>
    sendWechatCallbackHtml(
      res,
      buildWechatCallbackPostMessagePayload({
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
      if (callbackFlow.isBind && callbackFlow.bindUserId) {
        recordSecurityEvent({
          userId: callbackFlow.bindUserId,
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
      if (callbackFlow.isBind && callbackFlow.bindUserId) {
        recordSecurityEvent({
          userId: callbackFlow.bindUserId,
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

    if (callbackFlow.isBind) {
      const currentUser = userRepository.findById(callbackFlow.bindUserId);
      if (!currentUser) {
        recordSecurityEvent({
          userId: callbackFlow.bindUserId || null,
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
        buildWechatCallbackPostMessagePayload({
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
      const mfaChallengeToken = issueLoginMfaChallenge({
        user,
        rememberMe: callbackFlow.rememberMe,
        loginMethod: "wechat+mfa",
      });
      recordSecurityEvent({
        userId: user.id,
        eventType: "wechat_login_failed",
        detail: {
          reason: "mfa_required",
          rememberMe: callbackFlow.rememberMe,
        },
        ...reqMeta(req),
      });
      return sendWechatCallbackHtml(
        res,
        buildWechatCallbackPostMessagePayload({
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
      rememberMe: callbackFlow.rememberMe,
      loginMethod: "wechat",
    });
    return sendWechatCallbackHtml(
      res,
      buildWechatCallbackPostMessagePayload({
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

router.get("/wechat/binding", wechatBindingAbuseLimiter, authRequired, (req, res) => {
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

router.post("/wechat/unbind", wechatUnbindAbuseLimiter, authRequired, userSensitiveActionRequired, (req, res) => {
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
  mfaVerifyAbuseLimiter,
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
    const sessionId = String(req.body?.sessionId || "").trim();
    const totpCode = String(req.body?.totpCode || "").trim();
    const recoveryCode = String(req.body?.recoveryCode || "").trim();
    const approval = resolveQrApprovalRequest({
      sessionId,
      totpCode,
      recoveryCode,
    });

    if (!approval.ok && approval.failureReason) {
      recordSecurityEvent({
        userId: approval.user.id,
        eventType: "login_failed",
        detail: { reason: approval.failureReason },
        ...reqMeta(req),
      });
    }

    if (!approval.ok) {
      if (!approval.code) {
        return res.status(approval.status).json({
          success: false,
          message: approval.message,
        });
      }
      return errorResponse(
        res,
        approval.status,
        approval.code,
        approval.message,
      );
    }

    approveMfaQrSession({ session: approval.session });
    return res.json({ success: true, message: "扫码验证通过，请返回登录页面" });
  },
);

router.post(
  "/mfa/qr/poll",
  mfaQrPollLimiter,
  validateRequest({ body: mfaQrSessionIdBodySchema }),
  (req, res) => {
    const sessionId = String(req.body?.sessionId || "").trim();
    const pollState = getMfaQrPollState({ sessionId });
    if (!pollState.ok) {
      return errorResponse(
        res,
        pollState.status,
        pollState.code,
        pollState.message,
      );
    }

    if (pollState.status === "pending") {
      return res.json(buildMfaQrPollResponse(pollState));
    }

    return finalizeLogin({
      req,
      res,
      user: pollState.user,
      rememberMe: pollState.rememberMe,
      loginMethod: pollState.loginMethod,
    });
  },
);

router.post(
  "/mfa/setup",
  mfaSettingsAbuseLimiter,
  authRequired,
  validateRequest({ body: mfaSetupBodySchema }),
  (req, res) => {
    const credential = String(req.body?.[CREDENTIAL_BODY_FIELD] || "");
    if (!verifyMfaAccountPassword({ identity: req.auth.user.username, credential })) {
      return res.status(400).json({ success: false, message: "当前密码错误" });
    }

    const setup = createMfaSetup({
      username: req.auth.user.username,
    });
    return res.json({
      success: true,
      data: buildMfaSetupResponse(setup),
    });
  },
);

router.post(
  "/mfa/enable",
  mfaSettingsAbuseLimiter,
  authRequired,
  validateRequest({ body: mfaEnableBodySchema }),
  (req, res) => {
    const credential = String(req.body?.[CREDENTIAL_BODY_FIELD] || "");
    if (!verifyMfaAccountPassword({ identity: req.auth.user.username, credential })) {
      return res.status(400).json({ success: false, message: "当前密码错误" });
    }

    const secret = String(req.body?.secret || "").trim();
    const totpCode = String(req.body?.totpCode || "").trim();
    if (!verifyMfaSetupCode({ secret, totpCode })) {
      return res.status(400).json({ success: false, message: "验证码无效，请检查时间同步后重试" });
    }

    const setup = enableUserMfa({
      userId: req.auth.user.id,
      username: req.auth.user.username,
      secret,
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
  mfaSettingsAbuseLimiter,
  authRequired,
  validateRequest({ body: mfaDisableBodySchema }),
  (req, res) => {
    const credential = String(req.body?.[CREDENTIAL_BODY_FIELD] || "");
    if (!verifyMfaAccountPassword({ identity: req.auth.user.username, credential })) {
      return res.status(400).json({ success: false, message: "当前密码错误" });
    }

    const totpCode = String(req.body?.totpCode || "").trim();
    const recoveryCode = String(req.body?.recoveryCode || "").trim();
    const disableCheck = verifyMfaDisableRequest({
      userId: req.auth.user.id,
      totpCode,
      recoveryCode,
    });
    if (!disableCheck.ok) {
      return res.status(400).json({ success: false, message: "验证码或恢复码无效" });
    }

    disableUserMfa({ userId: req.auth.user.id });
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
    const resetRequest = resolveMfaResetLinkRequest({
      token: req.body?.token,
      isLocalRequest: isLocalMfaResetRequest(req),
    });
    if (!resetRequest.ok) {
      return res.status(resetRequest.status).json({
        success: false,
        message: resetRequest.message,
      });
    }

    const { user, payload } = resetRequest;
    const resetResult = applyMfaResetByLink({ user });

    if (resetResult.alreadyDisabled) {
      return res.json({
        success: true,
        message: "当前账号的二次验证已处于未启用状态",
      });
    }

    recordSecurityEvent({
      userId: user.id,
      eventType: "mfa_reset_by_link",
      detail: {
        requestedBy: String(payload?.requestedBy || "").trim() || null,
      },
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
      createdAt: resetResult.updatedAt,
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
    const refreshCredential = parseRefreshTokenCredential(readRefreshTokenFromRequest(req));
    const lookup = findRefreshSessionByTokenHash(refreshCredential);
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
