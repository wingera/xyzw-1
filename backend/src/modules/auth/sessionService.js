import { userRepository } from "../../repositories/userRepository.js";
import { refreshTokenRepository } from "../../repositories/refreshTokenRepository.js";
import { nowIso, secureId } from "../../db/sql.js";
import { sha256Hex } from "../../lib/crypto.js";
import {
  makeRefreshTokenValue,
  resolveRefreshTokenTtlMs,
} from "./tokens.js";

const refreshSessionError = (status, code, message) => ({
  ok: false,
  error: {
    status,
    code,
    message,
  },
});

const refreshSessionOk = (data = {}) => ({
  ok: true,
  ...data,
});

export const getRefreshTokenId = (refreshTokenRaw) =>
  String(refreshTokenRaw || "").split(".")[0] || "";

export const findRefreshSessionByTokenHash = (refreshTokenRaw) => {
  const tokenId = getRefreshTokenId(refreshTokenRaw);
  if (!tokenId) {
    return refreshSessionError(
      401,
      "AUTH_REFRESH_INVALID",
      "刷新令牌无效，请重新登录",
    );
  }

  const record = refreshTokenRepository.findById(tokenId);
  const tokenHash = sha256Hex(refreshTokenRaw);
  if (!record || record.tokenHash !== tokenHash) {
    return refreshSessionError(
      401,
      "AUTH_REFRESH_INVALID",
      "刷新令牌无效，请重新登录",
    );
  }

  return refreshSessionOk({
    tokenId,
    record,
  });
};

export const revokeRefreshSession = ({
  id,
  revokedAt = nowIso(),
  replacedById = null,
  lastUsedAt = null,
  lastUsedIp = null,
  lastUsedUserAgent = null,
}) => {
  refreshTokenRepository.revokeById({
    id,
    revokedAt,
    replacedById,
    lastUsedAt,
    lastUsedIp,
    lastUsedUserAgent,
  });
};

export const assertRefreshSessionUsable = ({
  refreshTokenRecord,
  nowMs = Date.now(),
  revokeMeta = {},
}) => {
  if (refreshTokenRecord?.revokedAt) {
    return refreshSessionError(
      401,
      "AUTH_REFRESH_REVOKED",
      "登录状态已失效，请重新登录",
    );
  }

  const expiresTs = new Date(refreshTokenRecord?.expiresAt || "").getTime();
  if (!Number.isFinite(expiresTs) || expiresTs <= nowMs) {
    revokeRefreshSession({
      id: refreshTokenRecord.id,
      revokedAt: nowIso(),
      lastUsedAt: nowIso(),
      lastUsedIp: revokeMeta.lastUsedIp ?? null,
      lastUsedUserAgent: revokeMeta.lastUsedUserAgent ?? null,
    });
    return refreshSessionError(
      401,
      "AUTH_REFRESH_EXPIRED",
      "登录状态已过期，请重新登录",
    );
  }

  return refreshSessionOk({
    record: refreshTokenRecord,
  });
};

export const findSessionUserById = (userId) =>
  userRepository.findById(userId);

export const getSessionUser = (userId) => {
  const user = findSessionUserById(userId);
  if (!user) {
    return refreshSessionError(
      401,
      "AUTH_USER_NOT_FOUND",
      "用户不存在或已失效",
    );
  }
  return refreshSessionOk({ user });
};

export const isRefreshTokenVersionCurrent = ({ refreshTokenRecord, user }) =>
  Number(refreshTokenRecord?.tokenVersion ?? 0) === Number(user?.tokenVersion ?? 0);

export const assertTokenVersionCurrent = ({
  refreshTokenRecord,
  user,
  revokeMeta = {},
}) => {
  if (isRefreshTokenVersionCurrent({ refreshTokenRecord, user })) {
    return refreshSessionOk({
      record: refreshTokenRecord,
      user,
    });
  }

  revokeRefreshSession({
    id: refreshTokenRecord.id,
    revokedAt: nowIso(),
    lastUsedAt: nowIso(),
    lastUsedIp: revokeMeta.lastUsedIp ?? null,
    lastUsedUserAgent: revokeMeta.lastUsedUserAgent ?? null,
  });
  return refreshSessionError(
    401,
    "AUTH_REFRESH_REVOKED",
    "登录状态已失效，请重新登录",
  );
};

export const isSessionTrialExpired = (user) =>
  Boolean(
    user?.trialExpiresAt
      && Number.isFinite(new Date(user.trialExpiresAt).getTime())
      && new Date(user.trialExpiresAt).getTime() < Date.now(),
  );

export const assertTrialActive = (user) => {
  if (!isSessionTrialExpired(user)) {
    return refreshSessionOk({ user });
  }
  return refreshSessionError(
    403,
    "AUTH_TRIAL_EXPIRED",
    "账号试用已到期，请联系管理员",
  );
};

export const rotateRefreshSession = ({
  currentTokenId,
  user,
  rememberMe = false,
  meta = {},
}) => {
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
    createdIp: meta.ip ?? null,
    createdUserAgent: meta.userAgent ?? null,
  });

  revokeRefreshSession({
    id: currentTokenId,
    revokedAt: nowIso(),
    replacedById: tokenId,
    lastUsedAt: nowIso(),
    lastUsedIp: meta.ip ?? null,
    lastUsedUserAgent: meta.userAgent ?? null,
  });

  return {
    refreshToken,
    expiresAt,
    tokenId,
    ttlMs,
  };
};
