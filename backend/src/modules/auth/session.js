import { ACCESS_SCOPE_FULL, ACCESS_SCOPE_TASK_CONTROL_ONLY, normalizeAccessScope } from "../../constants/accessScope.js";
import { refreshTokenRepository } from "../../repositories/refreshTokenRepository.js";
import { userRepository } from "../../repositories/userRepository.js";
import { nowIso, secureId } from "../../db/sql.js";
import { sha256Hex } from "../../lib/crypto.js";
import { recordSecurityEvent } from "../../services/securityEventService.js";
import { env } from "../../config/env.js";
import { refreshCookieOptions, setAccessCookie } from "./cookies.js";
import {
  buildAccessToken,
  makeRefreshTokenValue,
  resolveRefreshTokenTtlMs,
} from "./tokens.js";

export const reqMeta = (req) => ({
  ip: req.ip || null,
  userAgent: req.headers["user-agent"] || null,
});

export const issueRefreshToken = ({ user, req, rememberMe = false }) => {
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

export const rotateRefreshToken = ({ currentTokenId, user, req, rememberMe = false }) => {
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

export const buildAuthUserPayload = (user, { lastLoginAt = null } = {}) => ({
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
  lastLoginAt: lastLoginAt || user.lastLoginAt || null,
  wechatBound: Boolean(user.wechatBound),
  wechatBoundAt: user.wechatBoundAt || null,
  isAdmin: user.isAdmin,
  createdAt: user.createdAt,
  avatar: "/icons/xiaoyugan.png",
});

export const getLoginBlockedError = (user) => {
  if (
    user?.trialExpiresAt
    && Number.isFinite(new Date(user.trialExpiresAt).getTime())
    && new Date(user.trialExpiresAt).getTime() < Date.now()
  ) {
    return {
      status: 403,
      code: "AUTH_TRIAL_EXPIRED",
      message: "账号试用已到期，请联系管理员",
      reason: "trial_expired",
    };
  }
  return null;
};

export const issueLoginSession = ({
  req,
  res,
  user,
  rememberMe = false,
  loginMethod = "password",
}) => {
  const safeLoginMethod = String(loginMethod || "password").trim() || "password";
  const lastLoginAt = nowIso();
  userRepository.updateLastLogin({
    id: user.id,
    lastLoginAt,
    updatedAt: lastLoginAt,
  });
  if (safeLoginMethod.startsWith("wechat")) {
    userRepository.updateWechatLastLogin({
      id: user.id,
      wechatLastLoginAt: lastLoginAt,
      updatedAt: lastLoginAt,
    });
  }

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

  const loginDetail = {
    loginMethod: safeLoginMethod,
    isAdmin: Boolean(user.isAdmin),
    rememberMe: Boolean(rememberMe),
    refreshTtlDays: Math.round(refresh.ttlMs / (24 * 60 * 60 * 1000)),
  };
  recordSecurityEvent({
    userId: user.id,
    eventType: "login_success",
    detail: loginDetail,
    ...reqMeta(req),
  });
  if (safeLoginMethod.startsWith("wechat")) {
    recordSecurityEvent({
      userId: user.id,
      eventType: "wechat_login_success",
      detail: loginDetail,
      ...reqMeta(req),
    });
  }

  return {
    token,
    lastLoginAt,
    refresh,
  };
};
