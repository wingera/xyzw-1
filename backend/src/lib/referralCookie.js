import crypto from "node:crypto";
import { env } from "../config/env.js";
import { parseCookies } from "./cookies.js";
import { resolveCookieSecure } from "./cookieSecurity.js";

export const REFERRAL_COOKIE_NAME = "xyzw_referral";
export const REFERRAL_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]+$/;

const resolveReferralCookieSecret = () =>
  String(env.referralCookieSecret || env.jwtSecret || "").trim();

const signPayload = (payloadBase64Url) =>
  crypto
    .createHmac("sha256", resolveReferralCookieSecret())
    .update(String(payloadBase64Url || ""))
    .digest("hex");

const referralCookieOptions = (req, maxAge = REFERRAL_COOKIE_TTL_MS) => ({
  httpOnly: true,
  secure: resolveCookieSecure(req, false),
  sameSite: "lax",
  path: "/",
  maxAge,
});

export const clearReferralCookie = (req, res) => {
  res.clearCookie(REFERRAL_COOKIE_NAME, referralCookieOptions(req, 0));
};

export const setReferralCookie = (req, res, referralCode) => {
  const code = String(referralCode || "").trim().toUpperCase();
  if (!code) {
    clearReferralCookie(req, res);
    return "";
  }
  const exp = Date.now() + REFERRAL_COOKIE_TTL_MS;
  const payloadBase64Url = Buffer.from(
    JSON.stringify({ code, exp }),
    "utf8",
  ).toString("base64url");
  const token = `${payloadBase64Url}.${signPayload(payloadBase64Url)}`;
  res.cookie(REFERRAL_COOKIE_NAME, token, referralCookieOptions(req));
  return token;
};

export const verifyReferralCookieValue = (cookieValue) => {
  const raw = String(cookieValue || "").trim();
  if (!raw) {
    return { ok: false, reason: "missing" };
  }
  const [payloadBase64Url, signature] = raw.split(".", 2);
  if (!payloadBase64Url || !signature) {
    return { ok: false, reason: "invalid" };
  }

  const expectedSignature = signPayload(payloadBase64Url);
  const normalizedExpected = Buffer.from(expectedSignature, "utf8");
  const normalizedReceived = Buffer.from(String(signature || ""), "utf8");
  if (
    normalizedExpected.length !== normalizedReceived.length
    || !crypto.timingSafeEqual(normalizedExpected, normalizedReceived)
  ) {
    return { ok: false, reason: "invalid" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64Url, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const code = String(payload?.code || "").trim().toUpperCase();
  const exp = Number(payload?.exp || 0);
  if (!code || !REFERRAL_CODE_PATTERN.test(code) || !Number.isFinite(exp)) {
    return { ok: false, reason: "invalid" };
  }
  if (exp <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    code,
    exp,
  };
};

export const readReferralCookieFromRequest = (req) => {
  const cookies = parseCookies(req.headers?.cookie || "");
  return verifyReferralCookieValue(cookies[REFERRAL_COOKIE_NAME]);
};
