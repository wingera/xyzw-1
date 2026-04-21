import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../src/config/env.js";
import { parseCookies } from "../src/lib/cookies.js";
import { verifyJwt } from "../src/lib/crypto.js";
import { createMfaSetupPayload } from "../src/services/mfaService.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  buildAccessToken,
  inferRememberMeFromRefreshRecord,
  makeRefreshTokenValue,
  REFRESH_TOKEN_LONG_TTL_MS,
  REFRESH_TOKEN_SHORT_TTL_MS,
  resolveRefreshTokenTtlMs,
} from "../src/modules/auth/tokens.js";
import {
  accessCookieOptions,
  parseRefreshTokenCredential,
  readRefreshTokenFromRequest,
  refreshCookieOptions,
} from "../src/modules/auth/cookies.js";
import {
  buildAuthUserPayload,
  getLoginBlockedError,
} from "../src/modules/auth/session.js";
import {
  issueMfaChallengeToken,
  issueMfaResetLinkToken,
  MFA_CHALLENGE_PURPOSE,
  MFA_RESET_LINK_PURPOSE,
  parseMfaChallengeToken,
  parseMfaResetLinkToken,
  verifyMfaCredentials,
} from "../src/modules/auth/mfaChallenge.js";
import {
  isLocalMfaResetRequest,
  logPasswordResetMaskedReason,
  maskIdentity,
  PASSWORD_RESET_GENERIC_MESSAGE,
} from "../src/modules/auth/passwordReset.js";
import { buildCsrfResponseData } from "../src/modules/auth/csrf.js";

const makeReq = ({
  cookie = "",
  forwardedProto = "",
  secure = false,
  hostname = "example.com",
  origin = "",
  referer = "",
} = {}) => ({
  headers: {
    cookie,
    ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}),
  },
  secure,
  hostname,
  get(name) {
    const key = String(name || "").toLowerCase();
    if (key === "origin") return origin;
    if (key === "referer") return referer;
    return "";
  },
});

test("auth token helpers preserve access token and refresh ttl semantics", () => {
  const user = {
    id: "user_token_helper",
    username: "token-helper",
    tokenVersion: 7,
  };

  const accessToken = buildAccessToken(user);
  const payload = verifyJwt(accessToken);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.username, user.username);
  assert.equal(payload.ver, user.tokenVersion);
  assert.ok(payload.exp - payload.iat <= ACCESS_TOKEN_TTL_SECONDS);

  const refreshToken = makeRefreshTokenValue("rft_test");
  assert.match(refreshToken, /^rft_test\.[A-Za-z0-9_-]+$/);
  assert.equal(resolveRefreshTokenTtlMs(false), REFRESH_TOKEN_SHORT_TTL_MS);
  assert.equal(resolveRefreshTokenTtlMs(true), REFRESH_TOKEN_LONG_TTL_MS);

  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    inferRememberMeFromRefreshRecord({
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + REFRESH_TOKEN_SHORT_TTL_MS).toISOString(),
    }),
    false,
  );
  assert.equal(
    inferRememberMeFromRefreshRecord({
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + REFRESH_TOKEN_LONG_TTL_MS).toISOString(),
    }),
    true,
  );
  assert.equal(inferRememberMeFromRefreshRecord({ createdAt: "", expiresAt: "" }), true);
});

test("auth cookie helpers preserve refresh/access cookie options", () => {
  const plainReq = makeReq();
  const httpsReq = makeReq({ forwardedProto: "https" });

  assert.equal(
    readRefreshTokenFromRequest(makeReq({ cookie: `${env.refreshCookieName}=rft_1.value; other=1` })),
    "rft_1.value",
  );

  const refreshOptions = refreshCookieOptions(plainReq, 1234);
  assert.equal(refreshOptions.httpOnly, true);
  assert.equal(refreshOptions.path, env.refreshCookiePath);
  assert.equal(refreshOptions.sameSite, env.refreshCookieSameSite);
  assert.equal(refreshOptions.maxAge, 1234);
  if (env.refreshCookieDomain) {
    assert.equal(refreshOptions.domain, env.refreshCookieDomain);
  }

  const accessOptions = accessCookieOptions(plainReq, 5678);
  assert.equal(accessOptions.httpOnly, true);
  assert.equal(accessOptions.path, env.accessCookiePath);
  assert.equal(accessOptions.sameSite, env.accessCookieSameSite);
  assert.equal(accessOptions.maxAge, 5678);
  if (env.accessCookieDomain) {
    assert.equal(accessOptions.domain, env.accessCookieDomain);
  }

  assert.equal(refreshCookieOptions(httpsReq, 1).secure, true);
  assert.equal(accessCookieOptions(httpsReq, 1).secure, true);
});

test("auth cookie helpers classify refresh token credentials without trusting raw cookie shape", () => {
  assert.deepEqual(parseRefreshTokenCredential(""), {
    ok: false,
    raw: "",
    tokenId: "",
    reason: "missing",
  });
  assert.deepEqual(parseRefreshTokenCredential(".secret"), {
    ok: false,
    raw: ".secret",
    tokenId: "",
    reason: "invalid",
  });
  assert.deepEqual(parseRefreshTokenCredential("rft_bad.traversal/secret"), {
    ok: false,
    raw: "rft_bad.traversal/secret",
    tokenId: "",
    reason: "invalid",
  });
  assert.deepEqual(parseRefreshTokenCredential("rft_valid.ABCDEFGHIJKLMNOP"), {
    ok: true,
    raw: "rft_valid.ABCDEFGHIJKLMNOP",
    tokenId: "rft_valid",
    reason: "",
  });
});

test("auth cookie parser rejects prototype-polluting cookie names", () => {
  const cookies = parseCookies(
    `${env.refreshCookieName}=rft_1.value; __proto__=polluted; constructor=bad; prototype=bad`,
  );

  assert.equal(cookies[env.refreshCookieName], "rft_1.value");
  assert.equal(Object.getPrototypeOf(cookies), null);
  assert.equal(Object.hasOwn(cookies, "__proto__"), false);
  assert.equal(Object.hasOwn(cookies, "constructor"), false);
  assert.equal(Object.hasOwn(cookies, "prototype"), false);
  assert.equal({}.polluted, undefined);
});

test("auth session payload helper preserves frontend-visible user shape", () => {
  const user = {
    id: "user_payload",
    username: "payload-user",
    email: "payload@example.com",
    nickname: "Nick",
    phone: "123",
    trialExpiresAt: null,
    accessScope: "task_control_only",
    tokenBindLimit: 0,
    mfaEnabled: 1,
    lastLoginAt: "2026-01-01T00:00:00.000Z",
    wechatBound: 1,
    wechatBoundAt: "2026-01-02T00:00:00.000Z",
    isAdmin: 0,
    createdAt: "2026-01-03T00:00:00.000Z",
  };

  const payload = buildAuthUserPayload(user, {
    lastLoginAt: "2026-01-04T00:00:00.000Z",
  });
  assert.equal(payload.id, user.id);
  assert.equal(payload.username, user.username);
  assert.equal(payload.accessScope, "task_control_only");
  assert.equal(payload.isTaskControlOnly, true);
  assert.equal(payload.hasGameFeatureAccess, false);
  assert.equal(payload.tokenBindLimit, 999);
  assert.equal(payload.mfaEnabled, true);
  assert.equal(payload.lastLoginAt, "2026-01-04T00:00:00.000Z");
  assert.equal(payload.wechatBound, true);
  assert.equal(payload.avatar, "/icons/xiaoyugan.png");

  assert.equal(getLoginBlockedError({ trialExpiresAt: null }), null);
  assert.equal(getLoginBlockedError({ trialExpiresAt: "2000-01-01T00:00:00.000Z" })?.code, "AUTH_TRIAL_EXPIRED");
});

test("mfa challenge helpers preserve token purpose, version, and username checks", () => {
  const user = {
    id: "user_mfa_helper",
    username: "mfa-helper",
    tokenVersion: 3,
    mfaEnabled: true,
  };

  const challengeToken = issueMfaChallengeToken(user, {
    rememberMe: true,
    loginMethod: "wechat+mfa",
  });
  const challengePayload = parseMfaChallengeToken(challengeToken);
  assert.equal(challengePayload.sub, user.id);
  assert.equal(challengePayload.username, user.username);
  assert.equal(challengePayload.ver, user.tokenVersion);
  assert.equal(challengePayload.purpose, MFA_CHALLENGE_PURPOSE);
  assert.equal(challengePayload.rememberMe, true);
  assert.equal(challengePayload.loginMethod, "wechat+mfa");

  const resetToken = issueMfaResetLinkToken(user, { requestedBy: "admin_user" });
  const resetPayload = parseMfaResetLinkToken(resetToken);
  assert.equal(resetPayload.sub, user.id);
  assert.equal(resetPayload.username, user.username);
  assert.equal(resetPayload.ver, user.tokenVersion);
  assert.equal(resetPayload.purpose, MFA_RESET_LINK_PURPOSE);
  assert.equal(resetPayload.requestedBy, "admin_user");
  assert.equal(resetPayload.mfaEnabled, true);
});

test("mfa credential helper does not let blank totp shadow recovery codes", () => {
  const setup = createMfaSetupPayload({ username: "mfa-helper" });
  const user = {
    id: "user_mfa_recovery",
    mfaRecoveryCodesHash: JSON.stringify(setup.recoveryCodeHashes),
  };
  let consumedRecoveryCodes = "";

  const result = verifyMfaCredentials({
    user,
    secret: setup.secret,
    totpCode: "   ",
    recoveryCode: setup.recoveryCodes[0],
    updateMfaRecoveryCodesHash({ mfaRecoveryCodesHash }) {
      consumedRecoveryCodes = mfaRecoveryCodesHash;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.parse(consumedRecoveryCodes).length, setup.recoveryCodeHashes.length - 1);
});

test("password reset helpers preserve generic messaging and local reset detection", () => {
  assert.equal(PASSWORD_RESET_GENERIC_MESSAGE, "如果信息正确，密码已重置，请使用新密码登录");
  assert.equal(maskIdentity(""), "");
  assert.equal(maskIdentity("a"), "*");
  assert.equal(maskIdentity("ab"), "**");
  assert.equal(maskIdentity("abcdef"), "ab***");

  assert.equal(isLocalMfaResetRequest(makeReq({ hostname: "127.0.0.1" })), true);
  assert.equal(isLocalMfaResetRequest(makeReq({ origin: "http://127.0.0.1:3000" })), true);
  assert.equal(isLocalMfaResetRequest(makeReq({ referer: "http://127.0.0.1:3000/admin" })), true);
  assert.equal(isLocalMfaResetRequest(makeReq({ hostname: "example.com" })), false);
});

test("password reset masked reason logging is safe for plain-text logs", () => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => {
    calls.push(args.join(" "));
  };
  try {
    logPasswordResetMaskedReason("ab\r\n[INFO] forged\u0000entry", "expired_code");
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /[\r\n\u0000]/);
  assert.match(calls[0], /identity=ab/);
  assert.doesNotMatch(calls[0], /forged/);
});

test("csrf helper reports header name, token, and refresh cookie presence", () => {
  const data = buildCsrfResponseData({
    ...makeReq({ cookie: `${env.refreshCookieName}=rft_1.value` }),
    csrfToken: "csrf-token-value",
  });
  assert.deepEqual(data, {
    headerName: env.csrfHeaderName,
    token: "csrf-token-value",
    hasRefreshTokenCookie: true,
  });

  const emptyData = buildCsrfResponseData(makeReq());
  assert.equal(emptyData.headerName, env.csrfHeaderName);
  assert.equal(emptyData.token, null);
  assert.equal(emptyData.hasRefreshTokenCookie, false);
});
