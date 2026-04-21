import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app/createApp.js";
import { env } from "../src/config/env.js";
import { initDatabase } from "../src/db/database.js";
import { query, run } from "../src/db/client.js";
import { nowIso } from "../src/db/sql.js";
import { createPassword, verifyPassword } from "../src/lib/crypto.js";
import { issueMfaResetLinkToken, MFA_RESET_LINK_TTL_SECONDS } from "../src/routes/auth.js";
import authRoutes from "../src/routes/auth.js";
import { userRepository } from "../src/repositories/userRepository.js";
import { encryptMfaSecret, generateTotpCode } from "../src/services/mfaService.js";
import { PASSWORD_RESET_GENERIC_MESSAGE } from "../src/modules/auth/passwordReset.js";

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
      mfa_enabled, mfa_totp_secret_enc, mfa_recovery_codes_hash, created_at, updated_at
    ) VALUES (
      $id, $username, $email, $salt, $hash, $tokenVersion, $isAdmin,
      $mfaEnabled, $mfaTotpSecretEnc, $mfaRecoveryCodesHash, $createdAt, $updatedAt
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
  userRepository.createPasswordResetCode({
    id: `route_reset_code_${suffix}`,
    userId: user.id,
    code: "RSTT1234",
    createdBy: user.id,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    createdAt: nowIso(),
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

  const response = await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: toCookieHeader(loginResult.cookies),
      "user-agent": "auth-route-characterization",
    },
    body: JSON.stringify({
      identity: user.username,
      shortCode: "RSTT1234",
      newPassword: user.nextPassword,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: PASSWORD_RESET_GENERIC_MESSAGE,
  });
  const cookies = response.headers.getSetCookie();
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

  const missingUserResponse = await fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "auth-route-characterization",
    },
    body: JSON.stringify({
      identity: `missing_${suffix}`,
      shortCode: "RSTT1234",
      newPassword: "AnotherReset123!Aa",
    }),
  });
  assert.equal(missingUserResponse.status, 200);
  assert.deepEqual(await missingUserResponse.json(), {
    success: true,
    message: PASSWORD_RESET_GENERIC_MESSAGE,
  });
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
