import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { signJwt } from "../../lib/crypto.js";

export const ACCESS_TOKEN_TTL_SECONDS = env.accessTokenTtlSeconds;
export const REFRESH_TOKEN_SHORT_TTL_MS = env.refreshTokenShortTtlDays * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_LONG_TTL_MS = env.refreshTokenLongTtlDays * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_BYTES = 48;

export const makeRefreshTokenValue = (tokenId) =>
  `${tokenId}.${crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url")}`;

export const buildAccessToken = (user) =>
  signJwt(
    {
      sub: user.id,
      username: user.username,
      ver: Number(user.tokenVersion ?? 0),
    },
    ACCESS_TOKEN_TTL_SECONDS,
  );

export const resolveRefreshTokenTtlMs = (rememberMe) =>
  rememberMe
    ? REFRESH_TOKEN_LONG_TTL_MS
    : REFRESH_TOKEN_SHORT_TTL_MS;

export const inferRememberMeFromRefreshRecord = (record) => {
  const createdTs = new Date(record?.createdAt || "").getTime();
  const expiresTs = new Date(record?.expiresAt || "").getTime();
  if (!Number.isFinite(createdTs) || !Number.isFinite(expiresTs) || expiresTs <= createdTs) {
    return true;
  }
  const ttlMs = expiresTs - createdTs;
  const threshold = (REFRESH_TOKEN_SHORT_TTL_MS + REFRESH_TOKEN_LONG_TTL_MS) / 2;
  return ttlMs >= threshold;
};
