import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app/createApp.js";
import { env } from "../src/config/env.js";
import { initDatabase } from "../src/db/database.js";
import { query, run } from "../src/db/client.js";
import { nowIso } from "../src/db/sql.js";
import { createPassword, signJwt, verifyPassword } from "../src/lib/crypto.js";
import { issueMfaResetLinkToken, MFA_RESET_LINK_TTL_SECONDS } from "../src/routes/auth.js";
import authRoutes from "../src/routes/auth.js";
import { userRepository } from "../src/repositories/userRepository.js";
import { encryptMfaSecret, generateTotpCode } from "../src/services/mfaService.js";
import { PASSWORD_RESET_GENERIC_MESSAGE } from "../src/modules/auth/passwordReset.js";
import { MFA_RESET_LINK_PURPOSE } from "../src/modules/auth/mfaChallenge.js";

const makeBaseUrl = (server) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
};

const createAuthServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);

  const server = await new Promise((resolve, reject) => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
  return server;
};

const createFullServer = async () => {
  const { app } = createApp();
  const server = await new Promise((resolve, reject) => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
  return server;
};

const closeServer = (server) => new Promise((resolve) => server.close(resolve));

const toCookieHeader = (setCookieValues = []) =>
  setCookieValues
    .map((line) => String(line || "").split(";")[0])
    .filter(Boolean)
    .join("; ");

const extractCookieValue = (setCookieValues = [], cookieName) => {
  const cookie = findSetCookie(setCookieValues, cookieName);
  const pair = String(cookie || "").split(";")[0] || "";
  const prefix = `${cookieName}=`;
  return pair.startsWith(prefix) ? pair.slice(prefix.length) : "";
};

const mergeCookieHeaders = (...headers) => {
  const pairs = new Map();
  for (const header of headers) {
    String(header || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const idx = pair.indexOf("=");
        if (idx <= 0) return;
        pairs.set(pair.slice(0, idx), pair.slice(idx + 1));
      });
  }
  return Array.from(pairs.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
};

const findSetCookie = (setCookieValues, cookieName) =>
  setCookieValues.find((line) => String(line || "").startsWith(`${cookieName}=`)) || "";

const assertClearedCookie = (setCookieValues, cookieName) => {
  const cookie = findSetCookie(setCookieValues, cookieName);
  assert.ok(cookie, `expected ${cookieName} clear cookie`);
  assert.match(cookie, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
};

const seedUser = ({
  userId,
  username,
  password,
  email = null,
  tokenVersion = 0,
  mfaEnabled = false,
  mfaSecret = "",
  isAdmin = false,
  trialExpiresAt = null,
}) => {
  const ts = nowIso();
  const passwordMeta = createPassword(password);
  run(`DELETE FROM refresh_tokens WHERE user_id = $userId`, { $userId: userId });
  run(`DELETE FROM password_reset_codes WHERE user_id = $userId`, { $userId: userId });
  run(`DELETE FROM users WHERE id = $id OR username = $username`, {
    $id: userId,
    $username: username,
  });
  run(
    `INSERT INTO users (
      id, username, email, password_salt, password_hash, token_version, is_admin,
      mfa_enabled, mfa_totp_secret_enc, mfa_recovery_codes_hash, trial_expires_at, created_at, updated_at
    ) VALUES (
      $id, $username, $email, $salt, $hash, $tokenVersion, $isAdmin,
      $mfaEnabled, $mfaTotpSecretEnc, $mfaRecoveryCodesHash, $trialExpiresAt, $createdAt, $updatedAt
    )`,
    {
      $id: userId,
      $username: username,
      $email: email,
      $salt: passwordMeta.salt,
      $hash: passwordMeta.hash,
      $tokenVersion: tokenVersion,
      $isAdmin: isAdmin ? 1 : 0,
      $mfaEnabled: mfaEnabled ? 1 : 0,
      $mfaTotpSecretEnc: mfaEnabled ? encryptMfaSecret(mfaSecret) : null,
      $mfaRecoveryCodesHash: mfaEnabled ? "[]" : null,
      $trialExpiresAt: trialExpiresAt,
      $createdAt: ts,
      $updatedAt: ts,
    },
  );
};

const cleanupUser = (userId) => {
  run(`DELETE FROM refresh_tokens WHERE user_id = $userId`, { $userId: userId });
  run(`DELETE FROM password_reset_codes WHERE user_id = $userId`, { $userId: userId });
  run(`DELETE FROM security_event_logs WHERE user_id = $userId`, { $userId: userId });
  run(`DELETE FROM users WHERE id = $id`, { $id: userId });
};

const login = async ({ baseUrl, username, password, rememberMe = false, cookieHeader = "", csrfToken = "" }) => {
  const headers = {
    "content-type": "application/json",
    "user-agent": "auth-route-characterization",
  };
  if (cookieHeader) headers.cookie = cookieHeader;
  if (csrfToken) headers[env.csrfHeaderName] = csrfToken;
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username, password, rememberMe }),
  });
  return {
    response,
    payload: await response.json(),
    cookies: response.headers.getSetCookie(),
  };
};

const fetchCsrfContext = async (baseUrl, cookieHeader = "") => {
  const response = await fetch(`${baseUrl}/api/v1/auth/csrf`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const csrfToken = String(payload?.data?.token || "").trim();
  assert.ok(csrfToken, "expected csrf token");
  return {
    csrfToken,
    cookieHeader: mergeCookieHeaders(cookieHeader, toCookieHeader(response.headers.getSetCookie())),
  };
};

const callRefresh = async ({ baseUrl, cookieHeader }) => {
  const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      "user-agent": "auth-route-characterization",
    },
    body: JSON.stringify({}),
  });
  return {
    response,
    payload: await response.json(),
    cookies: response.headers.getSetCookie(),
  };
};

const createPasswordResetCode = ({
  id,
  userId,
  code = "RSTT1234",
  expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  isActive = true,
  usedAt = null,
}) => {
  userRepository.createPasswordResetCode({
    id,
    userId,
    code,
    createdBy: userId,
    expiresAt,
    createdAt: nowIso(),
  });
  if (!isActive || usedAt) {
    run(
      `UPDATE password_reset_codes
       SET is_active = $isActive, used_at = $usedAt
       WHERE id = $id`,
      {
        $id: id,
        $isActive: isActive ? 1 : 0,
        $usedAt: usedAt,
      },
    );
  }
};

const callPasswordReset = async ({
  baseUrl,
  identity,
  shortCode = "RSTT1234",
  newPassword,
  cookieHeader = "",
}) => {
  const headers = {
    "content-type": "application/json",
    "user-agent": "auth-route-characterization",
  };
  if (cookieHeader) headers.cookie = cookieHeader;
  const response = await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      identity,
      shortCode,
      newPassword,
    }),
  });
  return {
    response,
    payload: await response.json(),
    cookies: response.headers.getSetCookie(),
  };
};

const callMfaResetByLink = async ({ baseUrl, token }) => {
  const response = await fetch(`${baseUrl}/api/v1/auth/mfa/reset-by-link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "auth-route-characterization",
    },
    body: JSON.stringify({ token }),
  });
  return {
    response,
    payload: await response.json(),
  };
};

test("POST /auth/login preserves success response shape and auth cookies", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_login_${suffix}`,
    username: `route_login_${suffix}`,
    email: `route_login_${suffix}@example.com`,
    password: "RouteLogin123!Aa",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    email: user.email,
    password: user.password,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });

  const result = await login({
    baseUrl: makeBaseUrl(server),
    username: user.username,
    password: user.password,
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.payload?.success, true);
  assert.equal(result.payload?.message, "登录成功");
  assert.equal(result.payload?.data?.mfaRequired, undefined);
  assert.equal(result.payload?.data?.user?.id, user.id);
  assert.equal(result.payload?.data?.user?.username, user.username);
  assert.equal(result.payload?.data?.user?.email, user.email);
  assert.equal(result.payload?.data?.user?.mfaEnabled, false);
  assert.equal(result.payload?.data?.user?.avatar, "/icons/xiaoyugan.png");
  if (env.accessTokenExposeInBody) {
    assert.equal(typeof result.payload?.data?.token, "string");
  } else {
    assert.equal(result.payload?.data?.token, undefined);
  }

  assert.ok(findSetCookie(result.cookies, env.accessCookieName), "expected access cookie");
  assert.ok(findSetCookie(result.cookies, env.refreshCookieName), "expected refresh cookie");
});

test("POST /auth/login preserves invalid credential error response", async (t) => {
  await initDatabase();
  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
  });

  const result = await login({
    baseUrl: makeBaseUrl(server),
    username: `missing_${Date.now()}`,
    password: "WrongPassword123!Aa",
  });

  assert.equal(result.response.status, 401);
  assert.deepEqual(result.payload, {
    success: false,
    message: "用户名或密码错误",
    error: {
      code: "AUTH_INVALID_CREDENTIALS",
      message: "用户名或密码错误",
    },
  });
});

test("POST /auth/refresh preserves missing and invalid refresh token failures", async (t) => {
  await initDatabase();
  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
  });
  const baseUrl = makeBaseUrl(server);

  const missingResponse = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(missingResponse.status, 401);
  const missingPayload = await missingResponse.json();
  assert.equal(missingPayload?.success, false);
  assert.equal(missingPayload?.error?.code, "AUTH_REFRESH_MISSING");
  assert.equal(missingPayload?.message, "缺少刷新令牌，请重新登录");
  assertClearedCookie(missingResponse.headers.getSetCookie(), env.accessCookieName);
  assertClearedCookie(missingResponse.headers.getSetCookie(), env.refreshCookieName);

  const invalidResponse = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${env.refreshCookieName}=not-a-refresh-token`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(invalidResponse.status, 401);
  const invalidPayload = await invalidResponse.json();
  assert.equal(invalidPayload?.success, false);
  assert.equal(invalidPayload?.error?.code, "AUTH_REFRESH_INVALID");
  assert.equal(invalidPayload?.message, "刷新令牌无效，请重新登录");
  assertClearedCookie(invalidResponse.headers.getSetCookie(), env.accessCookieName);
  assertClearedCookie(invalidResponse.headers.getSetCookie(), env.refreshCookieName);
});

test("POST /auth/refresh preserves successful rotation response and database state", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_refresh_success_${suffix}`,
    username: `route_refresh_success_${suffix}`,
    password: "RouteRefresh123!Aa",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });
  const baseUrl = makeBaseUrl(server);

  const loginResult = await login({
    baseUrl,
    username: user.username,
    password: user.password,
    rememberMe: true,
  });
  assert.equal(loginResult.response.status, 200);
  const initialRefreshToken = extractCookieValue(loginResult.cookies, env.refreshCookieName);
  const initialTokenId = initialRefreshToken.split(".")[0] || "";
  assert.ok(initialTokenId, "expected initial refresh token id");

  const refreshResult = await callRefresh({
    baseUrl,
    cookieHeader: toCookieHeader(loginResult.cookies),
  });

  assert.equal(refreshResult.response.status, 200);
  assert.equal(refreshResult.payload?.success, true);
  assert.deepEqual(Object.keys(refreshResult.payload?.data || {}).sort(), env.accessTokenExposeInBody ? ["token"] : []);
  assert.ok(findSetCookie(refreshResult.cookies, env.accessCookieName), "expected new access cookie");
  const nextRefreshToken = extractCookieValue(refreshResult.cookies, env.refreshCookieName);
  const nextTokenId = nextRefreshToken.split(".")[0] || "";
  assert.ok(nextTokenId, "expected rotated refresh token id");
  assert.notEqual(nextTokenId, initialTokenId);

  const initialRow = query(
    `SELECT revoked_at as revokedAt, replaced_by_id as replacedById, last_used_at as lastUsedAt
     FROM refresh_tokens WHERE id = $id`,
    { $id: initialTokenId },
  )[0];
  assert.ok(initialRow?.revokedAt, "expected old refresh token to be revoked");
  assert.equal(initialRow?.replacedById, nextTokenId);
  assert.ok(initialRow?.lastUsedAt, "expected old refresh token last_used_at to be written");

  const nextRows = query(
    `SELECT id FROM refresh_tokens WHERE id = $id AND user_id = $userId AND revoked_at IS NULL`,
    { $id: nextTokenId, $userId: user.id },
  );
  assert.equal(nextRows.length, 1, "expected rotated refresh token to be active");
});

test("POST /auth/refresh preserves revoked refresh token failure", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_refresh_revoked_${suffix}`,
    username: `route_refresh_revoked_${suffix}`,
    password: "RouteRefreshRevoked123!Aa",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });
  const baseUrl = makeBaseUrl(server);
  const loginResult = await login({
    baseUrl,
    username: user.username,
    password: user.password,
  });
  const refreshToken = extractCookieValue(loginResult.cookies, env.refreshCookieName);
  const tokenId = refreshToken.split(".")[0] || "";
  run(
    `UPDATE refresh_tokens SET revoked_at = $revokedAt WHERE id = $id`,
    { $id: tokenId, $revokedAt: nowIso() },
  );

  const result = await callRefresh({
    baseUrl,
    cookieHeader: toCookieHeader(loginResult.cookies),
  });

  assert.equal(result.response.status, 401);
  assert.equal(result.payload?.success, false);
  assert.equal(result.payload?.message, "登录状态已失效，请重新登录");
  assert.equal(result.payload?.error?.code, "AUTH_REFRESH_REVOKED");
  assertClearedCookie(result.cookies, env.accessCookieName);
  assertClearedCookie(result.cookies, env.refreshCookieName);
});

test("POST /auth/refresh preserves expired refresh token failure and revocation", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_refresh_expired_${suffix}`,
    username: `route_refresh_expired_${suffix}`,
    password: "RouteRefreshExpired123!Aa",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });
  const baseUrl = makeBaseUrl(server);
  const loginResult = await login({
    baseUrl,
    username: user.username,
    password: user.password,
  });
  const refreshToken = extractCookieValue(loginResult.cookies, env.refreshCookieName);
  const tokenId = refreshToken.split(".")[0] || "";
  run(
    `UPDATE refresh_tokens SET expires_at = $expiresAt, revoked_at = NULL WHERE id = $id`,
    {
      $id: tokenId,
      $expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  );

  const result = await callRefresh({
    baseUrl,
    cookieHeader: toCookieHeader(loginResult.cookies),
  });

  assert.equal(result.response.status, 401);
  assert.equal(result.payload?.success, false);
  assert.equal(result.payload?.message, "登录状态已过期，请重新登录");
  assert.equal(result.payload?.error?.code, "AUTH_REFRESH_EXPIRED");
  assertClearedCookie(result.cookies, env.accessCookieName);
  assertClearedCookie(result.cookies, env.refreshCookieName);
  const row = query(`SELECT revoked_at as revokedAt FROM refresh_tokens WHERE id = $id`, {
    $id: tokenId,
  })[0];
  assert.ok(row?.revokedAt, "expected expired refresh token to be revoked");
});

test("POST /auth/refresh preserves tokenVersion mismatch failure and revocation", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_refresh_version_${suffix}`,
    username: `route_refresh_version_${suffix}`,
    password: "RouteRefreshVersion123!Aa",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
    tokenVersion: 0,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });
  const baseUrl = makeBaseUrl(server);
  const loginResult = await login({
    baseUrl,
    username: user.username,
    password: user.password,
  });
  const refreshToken = extractCookieValue(loginResult.cookies, env.refreshCookieName);
  const tokenId = refreshToken.split(".")[0] || "";
  run(
    `UPDATE users SET token_version = 1, updated_at = $updatedAt WHERE id = $id`,
    { $id: user.id, $updatedAt: nowIso() },
  );

  const result = await callRefresh({
    baseUrl,
    cookieHeader: toCookieHeader(loginResult.cookies),
  });

  assert.equal(result.response.status, 401);
  assert.equal(result.payload?.success, false);
  assert.equal(result.payload?.message, "登录状态已失效，请重新登录");
  assert.equal(result.payload?.error?.code, "AUTH_REFRESH_REVOKED");
  assertClearedCookie(result.cookies, env.accessCookieName);
  assertClearedCookie(result.cookies, env.refreshCookieName);
  const row = query(`SELECT revoked_at as revokedAt FROM refresh_tokens WHERE id = $id`, {
    $id: tokenId,
  })[0];
  assert.ok(row?.revokedAt, "expected mismatched refresh token to be revoked");
});

test("POST /auth/refresh preserves trial expired failure without rotation", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_refresh_trial_${suffix}`,
    username: `route_refresh_trial_${suffix}`,
    password: "RouteRefreshTrial123!Aa",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });
  const baseUrl = makeBaseUrl(server);
  const loginResult = await login({
    baseUrl,
    username: user.username,
    password: user.password,
  });
  const refreshToken = extractCookieValue(loginResult.cookies, env.refreshCookieName);
  const tokenId = refreshToken.split(".")[0] || "";
  run(
    `UPDATE users SET trial_expires_at = $trialExpiresAt, updated_at = $updatedAt WHERE id = $id`,
    {
      $id: user.id,
      $trialExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      $updatedAt: nowIso(),
    },
  );

  const result = await callRefresh({
    baseUrl,
    cookieHeader: toCookieHeader(loginResult.cookies),
  });

  assert.equal(result.response.status, 403);
  assert.equal(result.payload?.success, false);
  assert.equal(result.payload?.message, "账号试用已到期，请联系管理员");
  assert.equal(result.payload?.error?.code, "AUTH_TRIAL_EXPIRED");
  assertClearedCookie(result.cookies, env.accessCookieName);
  assertClearedCookie(result.cookies, env.refreshCookieName);
  const rows = query(
    `SELECT id FROM refresh_tokens WHERE user_id = $userId AND id != $tokenId`,
    { $userId: user.id, $tokenId: tokenId },
  );
  assert.equal(rows.length, 0, "trial-expired refresh should not rotate a new refresh token");
});

test("POST /auth/logout preserves cookie cleanup response", async (t) => {
  await initDatabase();
  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
  });

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: [
        `${env.accessCookieName}=access-token`,
        `${env.refreshCookieName}=refresh-token`,
        `${env.csrfCookieName}=csrf-token`,
        `${env.csrfSessionCookieName}=csrf-session`,
      ].join("; "),
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "已退出登录",
  });
  const cookies = response.headers.getSetCookie();
  assertClearedCookie(cookies, env.accessCookieName);
  assertClearedCookie(cookies, env.refreshCookieName);
  assertClearedCookie(cookies, env.csrfCookieName);
  assertClearedCookie(cookies, env.csrfSessionCookieName);
});

test("POST /auth/login preserves CSRF mismatch response under app middleware", async (t) => {
  await initDatabase();
  const server = await createFullServer();
  t.after(async () => {
    await closeServer(server);
  });
  const baseUrl = makeBaseUrl(server);
  const csrf = await fetchCsrfContext(baseUrl);

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrf.cookieHeader,
      [env.csrfHeaderName]: "wrong-csrf-token",
    },
    body: JSON.stringify({
      username: "csrf_wrong_user",
      password: "csrf_wrong_password",
    }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "CSRF 校验失败，请刷新页面后重试",
  });
});

test("MFA login preserves challenge response before session issuance and verified login response after TOTP", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_mfa_${suffix}`,
    username: `route_mfa_${suffix}`,
    password: "RouteMfa123!Aa",
    secret: "JBSWY3DPEHPK3PXP",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
    mfaEnabled: true,
    mfaSecret: user.secret,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });
  const baseUrl = makeBaseUrl(server);

  const challenged = await login({
    baseUrl,
    username: user.username,
    password: user.password,
    rememberMe: true,
  });
  assert.equal(challenged.response.status, 200);
  assert.equal(challenged.payload?.success, true);
  assert.equal(challenged.payload?.message, "需要二步验证");
  assert.equal(challenged.payload?.data?.mfaRequired, true);
  assert.equal(typeof challenged.payload?.data?.mfaChallengeToken, "string");
  assert.equal(challenged.payload?.data?.user, undefined);
  assert.equal(Boolean(findSetCookie(challenged.cookies, env.accessCookieName)), false);
  assert.equal(Boolean(findSetCookie(challenged.cookies, env.refreshCookieName)), false);

  const verifiedResponse = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "auth-route-characterization",
    },
    body: JSON.stringify({
      mfaChallengeToken: challenged.payload.data.mfaChallengeToken,
      totpCode: generateTotpCode({ secret: user.secret }),
    }),
  });
  assert.equal(verifiedResponse.status, 200);
  const verifiedPayload = await verifiedResponse.json();
  assert.equal(verifiedPayload?.success, true);
  assert.equal(verifiedPayload?.message, "登录成功");
  assert.equal(verifiedPayload?.data?.user?.id, user.id);
  const verifiedCookies = verifiedResponse.headers.getSetCookie();
  assert.ok(findSetCookie(verifiedCookies, env.accessCookieName), "expected access cookie");
  assert.ok(findSetCookie(verifiedCookies, env.refreshCookieName), "expected refresh cookie");
});

test("POST /auth/password-reset preserves generic response while consuming valid reset code", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_reset_${suffix}`,
    username: `route_reset_${suffix}`,
    password: "RouteResetOld123!Aa",
    nextPassword: "RouteResetNew123!Aa",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
  });
  createPasswordResetCode({
    id: `route_reset_code_${suffix}`,
    userId: user.id,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });
  const baseUrl = makeBaseUrl(server);

  const loginResult = await login({
    baseUrl,
    username: user.username,
    password: user.password,
  });
  assert.equal(loginResult.response.status, 200);

  const response = await callPasswordReset({
    baseUrl,
    identity: user.username,
    newPassword: user.nextPassword,
    cookieHeader: toCookieHeader(loginResult.cookies),
  });

  assert.equal(response.response.status, 200);
  assert.deepEqual(response.payload, {
    success: true,
    message: PASSWORD_RESET_GENERIC_MESSAGE,
  });
  const cookies = response.cookies;
  assertClearedCookie(cookies, env.accessCookieName);
  assertClearedCookie(cookies, env.refreshCookieName);
  assertClearedCookie(cookies, env.csrfCookieName);
  assertClearedCookie(cookies, env.csrfSessionCookieName);

  const stored = query(
    `SELECT password_salt as passwordSalt, password_hash as passwordHash, token_version as tokenVersion
     FROM users WHERE id = $id`,
    { $id: user.id },
  )[0];
  assert.ok(verifyPassword(user.nextPassword, stored.passwordSalt, stored.passwordHash));
  assert.equal(Number(stored.tokenVersion), 1);
  const activeCodes = query(
    `SELECT id FROM password_reset_codes WHERE user_id = $userId AND is_active = 1 AND used_at IS NULL`,
    { $userId: user.id },
  );
  assert.equal(activeCodes.length, 0);
  const activeRefreshTokens = query(
    `SELECT id FROM refresh_tokens WHERE user_id = $userId AND revoked_at IS NULL`,
    { $userId: user.id },
  );
  assert.equal(activeRefreshTokens.length, 0);

  const missingUserResponse = await callPasswordReset({
    baseUrl,
    identity: `missing_${suffix}`,
    newPassword: "AnotherReset123!Aa",
  });
  assert.equal(missingUserResponse.response.status, 200);
  assert.deepEqual(missingUserResponse.payload, {
    success: true,
    message: PASSWORD_RESET_GENERIC_MESSAGE,
  });
});

test("POST /auth/password-reset preserves generic response for invalid, inactive, used, and expired codes", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const baseUser = {
    id: `route_reset_invalid_${suffix}`,
    username: `route_reset_invalid_${suffix}`,
    password: "RouteResetInvalid123!Aa",
  };
  const inactiveUser = {
    id: `route_reset_inactive_${suffix}`,
    username: `route_reset_inactive_${suffix}`,
    password: "RouteResetInactive123!Aa",
  };
  const usedUser = {
    id: `route_reset_used_${suffix}`,
    username: `route_reset_used_${suffix}`,
    password: "RouteResetUsed123!Aa",
  };
  const expiredUser = {
    id: `route_reset_expired_${suffix}`,
    username: `route_reset_expired_${suffix}`,
    password: "RouteResetExpired123!Aa",
  };

  [baseUser, inactiveUser, usedUser, expiredUser].forEach((user) => {
    seedUser({
      userId: user.id,
      username: user.username,
      password: user.password,
    });
  });
  createPasswordResetCode({
    id: `route_reset_inactive_code_${suffix}`,
    userId: inactiveUser.id,
    code: "RSTA1234",
    isActive: false,
  });
  createPasswordResetCode({
    id: `route_reset_used_code_${suffix}`,
    userId: usedUser.id,
    code: "RSTB1234",
    usedAt: nowIso(),
  });
  createPasswordResetCode({
    id: `route_reset_expired_code_${suffix}`,
    userId: expiredUser.id,
    code: "RSTC1234",
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    [baseUser, inactiveUser, usedUser, expiredUser].forEach((user) => {
      cleanupUser(user.id);
    });
  });
  const baseUrl = makeBaseUrl(server);

  const cases = [
    {
      user: baseUser,
      shortCode: "WRONG123",
      reason: "invalid code should not reveal account existence",
    },
    {
      user: inactiveUser,
      shortCode: "RSTA1234",
      reason: "inactive code should be masked",
    },
    {
      user: usedUser,
      shortCode: "RSTB1234",
      reason: "used code should be masked",
    },
    {
      user: expiredUser,
      shortCode: "RSTC1234",
      reason: "expired code should be masked and deactivated",
    },
  ];

  for (const item of cases) {
    const before = query(
      `SELECT password_hash as passwordHash, token_version as tokenVersion
       FROM users WHERE id = $id`,
      { $id: item.user.id },
    )[0];
    const result = await callPasswordReset({
      baseUrl,
      identity: item.user.username,
      shortCode: item.shortCode,
      newPassword: "MaskedReset123!Aa",
    });

    assert.equal(result.response.status, 200, item.reason);
    assert.deepEqual(result.payload, {
      success: true,
      message: PASSWORD_RESET_GENERIC_MESSAGE,
    });

    const after = query(
      `SELECT password_hash as passwordHash, token_version as tokenVersion
       FROM users WHERE id = $id`,
      { $id: item.user.id },
    )[0];
    assert.equal(after.passwordHash, before.passwordHash, item.reason);
    assert.equal(Number(after.tokenVersion), Number(before.tokenVersion), item.reason);
  }

  const expiredCode = query(
    `SELECT is_active as isActive, used_at as usedAt
     FROM password_reset_codes WHERE user_id = $userId`,
    { $userId: expiredUser.id },
  )[0];
  assert.equal(Number(expiredCode.isActive), 0);
  assert.equal(expiredCode.usedAt, null);
});

test("MFA reset link compatibility export preserves reset-by-link behavior", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `route_mfa_reset_${suffix}`,
    username: `route_mfa_reset_${suffix}`,
    password: "RouteMfaReset123!Aa",
    secret: "JBSWY3DPEHPK3PXP",
  };
  seedUser({
    userId: user.id,
    username: user.username,
    password: user.password,
    mfaEnabled: true,
    mfaSecret: user.secret,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(user.id);
  });

  assert.equal(MFA_RESET_LINK_TTL_SECONDS, 60 * 60);
  const resetToken = issueMfaResetLinkToken(
    {
      id: user.id,
      username: user.username,
      tokenVersion: 0,
      mfaEnabled: true,
    },
    { requestedBy: "admin_user" },
  );
  assert.equal(typeof resetToken, "string");

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/auth/mfa/reset-by-link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "auth-route-characterization",
    },
    body: JSON.stringify({ token: resetToken }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "二次验证已重置，请重新登录后完成绑定",
  });

  const row = query(
    `SELECT mfa_enabled as mfaEnabled, token_version as tokenVersion FROM users WHERE id = $id`,
    { $id: user.id },
  )[0];
  assert.equal(Number(row.mfaEnabled), 0);
  assert.equal(Number(row.tokenVersion), 1);
});

test("POST /auth/mfa/reset-by-link preserves invalid, expired, stale, and already-disabled responses", async (t) => {
  await initDatabase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const activeUser = {
    id: `route_mfa_reset_active_${suffix}`,
    username: `route_mfa_reset_active_${suffix}`,
    password: "RouteMfaResetActive123!Aa",
    secret: "JBSWY3DPEHPK3PXP",
  };
  const disabledUser = {
    id: `route_mfa_reset_disabled_${suffix}`,
    username: `route_mfa_reset_disabled_${suffix}`,
    password: "RouteMfaResetDisabled123!Aa",
  };
  seedUser({
    userId: activeUser.id,
    username: activeUser.username,
    password: activeUser.password,
    mfaEnabled: true,
    mfaSecret: activeUser.secret,
  });
  seedUser({
    userId: disabledUser.id,
    username: disabledUser.username,
    password: disabledUser.password,
    mfaEnabled: false,
  });

  const server = await createAuthServer();
  t.after(async () => {
    await closeServer(server);
    cleanupUser(activeUser.id);
    cleanupUser(disabledUser.id);
  });
  const baseUrl = makeBaseUrl(server);

  const invalidResult = await callMfaResetByLink({
    baseUrl,
    token: "not-a-valid-token",
  });
  assert.equal(invalidResult.response.status, 401);
  assert.deepEqual(invalidResult.payload, {
    success: false,
    message: "重置链接无效或已过期",
  });

  const expiredToken = signJwt(
    {
      sub: activeUser.id,
      username: activeUser.username,
      ver: 0,
      purpose: MFA_RESET_LINK_PURPOSE,
      requestedBy: "admin_user",
      mfaEnabled: true,
    },
    -60,
  );
  const expiredResult = await callMfaResetByLink({
    baseUrl,
    token: expiredToken,
  });
  assert.equal(expiredResult.response.status, 401);
  assert.deepEqual(expiredResult.payload, {
    success: false,
    message: "重置链接无效或已过期",
  });

  const staleToken = issueMfaResetLinkToken(
    {
      id: activeUser.id,
      username: activeUser.username,
      tokenVersion: 0,
      mfaEnabled: true,
    },
    { requestedBy: "admin_user" },
  );
  userRepository.bumpTokenVersion({
    id: activeUser.id,
    updatedAt: nowIso(),
  });
  const staleResult = await callMfaResetByLink({
    baseUrl,
    token: staleToken,
  });
  assert.equal(staleResult.response.status, 401);
  assert.deepEqual(staleResult.payload, {
    success: false,
    message: "重置链接无效或已失效",
  });
  const activeAfterStale = query(
    `SELECT mfa_enabled as mfaEnabled, token_version as tokenVersion FROM users WHERE id = $id`,
    { $id: activeUser.id },
  )[0];
  assert.equal(Number(activeAfterStale.mfaEnabled), 1);
  assert.equal(Number(activeAfterStale.tokenVersion), 1);

  const alreadyDisabledToken = issueMfaResetLinkToken(
    {
      id: disabledUser.id,
      username: disabledUser.username,
      tokenVersion: 0,
      mfaEnabled: false,
    },
    { requestedBy: "admin_user" },
  );
  const alreadyDisabledResult = await callMfaResetByLink({
    baseUrl,
    token: alreadyDisabledToken,
  });
  assert.equal(alreadyDisabledResult.response.status, 200);
  assert.deepEqual(alreadyDisabledResult.payload, {
    success: true,
    message: "当前账号的二次验证已处于未启用状态",
  });
  const disabledAfter = query(
    `SELECT mfa_enabled as mfaEnabled, token_version as tokenVersion FROM users WHERE id = $id`,
    { $id: disabledUser.id },
  )[0];
  assert.equal(Number(disabledAfter.mfaEnabled), 0);
  assert.equal(Number(disabledAfter.tokenVersion), 0);
});
