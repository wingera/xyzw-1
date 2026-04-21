import { env } from "../../config/env.js";
import { parseCookies } from "../../lib/cookies.js";
import { resolveCookieSecure } from "../../lib/cookieSecurity.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "./tokens.js";

const REFRESH_TOKEN_ID_RE = /^rft_[A-Za-z0-9_-]+$/;
const REFRESH_TOKEN_SECRET_RE = /^[A-Za-z0-9_-]{16,}$/;

export const readRefreshTokenFromRequest = (req) => {
  const cookies = parseCookies(req.headers?.cookie || "");
  return String(cookies[env.refreshCookieName] || "").trim();
};

export const parseRefreshTokenCredential = (refreshTokenRaw) => {
  const raw = String(refreshTokenRaw || "").trim();
  if (!raw) {
    return {
      ok: false,
      raw: "",
      tokenId: "",
      reason: "missing",
    };
  }

  const separator = raw.indexOf(".");
  const tokenId = separator > 0 ? raw.slice(0, separator) : "";
  const tokenSecret = separator > 0 ? raw.slice(separator + 1) : "";
  if (!REFRESH_TOKEN_ID_RE.test(tokenId) || !REFRESH_TOKEN_SECRET_RE.test(tokenSecret)) {
    return {
      ok: false,
      raw,
      tokenId: "",
      reason: "invalid",
    };
  }

  return {
    ok: true,
    raw,
    tokenId,
    reason: "",
  };
};

export const refreshCookieOptions = (req, maxAgeMs) => ({
  httpOnly: true,
  secure: resolveCookieSecure(req, env.refreshCookieSecure),
  sameSite: env.refreshCookieSameSite,
  path: env.refreshCookiePath,
  ...(env.refreshCookieDomain ? { domain: env.refreshCookieDomain } : {}),
  maxAge: maxAgeMs,
});

export const accessCookieOptions = (req, maxAgeMs) => ({
  httpOnly: true,
  secure: resolveCookieSecure(req, env.accessCookieSecure),
  sameSite: env.accessCookieSameSite,
  path: env.accessCookiePath,
  ...(env.accessCookieDomain ? { domain: env.accessCookieDomain } : {}),
  maxAge: maxAgeMs,
});

export const clearRefreshCookie = (req, res) => {
  res.clearCookie(env.refreshCookieName, refreshCookieOptions(req, 0));
  // Backward compatibility: also clear root-path cookie with same name.
  res.clearCookie(env.refreshCookieName, {
    ...refreshCookieOptions(req, 0),
    path: "/",
  });
};

export const setAccessCookie = (req, res, accessToken) => {
  res.cookie(
    env.accessCookieName,
    accessToken,
    accessCookieOptions(req, Math.max(0, ACCESS_TOKEN_TTL_SECONDS * 1000)),
  );
};

export const clearAccessCookie = (req, res) => {
  res.clearCookie(env.accessCookieName, accessCookieOptions(req, 0));
  // Backward compatibility: also clear root-path cookie with same name.
  if (env.accessCookiePath !== "/") {
    res.clearCookie(env.accessCookieName, {
      ...accessCookieOptions(req, 0),
      path: "/",
    });
  }
};
