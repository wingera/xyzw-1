import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app/createApp.js";
import { env } from "../src/config/env.js";
import { initDatabase } from "../src/db/database.js";
import { query, run } from "../src/db/client.js";
import { nowIso } from "../src/db/sql.js";
import { createPassword } from "../src/lib/crypto.js";
import authRoutes from "../src/routes/auth.js";
import { encryptMfaSecret, generateTotpCode } from "../src/services/mfaService.js";

const WECHAT_MOCK_PROFILES = {
  bind_a: {
    openId: "wx-open-bind-a",
    unionId: "wx-union-bind-a",
    nickname: "Bind A",
    avatarUrl: "https://example.com/bind-a.png",
  },
  login_bound: {
    openId: "wx-open-login-bound-char",
    unionId: "wx-union-login-bound-char",
    nickname: "Bound Login",
    avatarUrl: "https://example.com/login-bound.png",
  },
  login_mfa: {
    openId: "wx-open-login-mfa-char",
    unionId: "wx-union-login-mfa-char",
    nickname: "MFA Login",
    avatarUrl: "https://example.com/login-mfa.png",
  },
  login_unbound: {
    openId: "wx-open-login-unbound-char",
    unionId: "wx-union-login-unbound-char",
    nickname: "Unbound Login",
    avatarUrl: "https://example.com/login-unbound.png",
  },
  blocked: {
    openId: "wx-open-blocked-char",
    unionId: "wx-union-blocked-char",
    nickname: "Blocked Login",
    avatarUrl: "https://example.com/blocked.png",
  },
};

const makeBaseUrl = (server) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
};

let forwardedForCounter = 1;
const nextForwardedFor = () => {
  forwardedForCounter += 1;
  return `10.41.${Math.floor(forwardedForCounter / 200)}.${(forwardedForCounter % 200) + 1}`;
};

const createServer = async () => {
  const { app } = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
};

const createAuthRouteOnlyServer = async () => {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
};

const closeServer = (server) => new Promise((resolve) => server.close(resolve));

const mergeCookieHeader = (...chunks) => {
  const cookieMap = new Map();
  for (const chunk of chunks) {
    if (!chunk) continue;
    const values = Array.isArray(chunk) ? chunk : String(chunk).split(";");
    values
      .map((line) => String(line || "").split(";")[0].trim())
      .filter(Boolean)
      .forEach((pair) => {
        const idx = pair.indexOf("=");
        if (idx <= 0) return;
        cookieMap.set(pair.slice(0, idx), pair.slice(idx + 1));
      });
  }
  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
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
    cookieHeader: mergeCookieHeader(cookieHeader, response.headers.getSetCookie()),
  };
};

const readResponsePayload = async (response) => {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return {
    success: false,
    message: await response.text(),
  };
};

const extractWechatCallbackPayload = (html) => {
  const matched = String(html || "").match(/decodeURIComponent\("([^"]+)"\)/);
  assert.ok(matched?.[1], "expected encoded callback payload in html");
  return JSON.parse(decodeURIComponent(matched[1]));
};

const assertPayloadKeys = (payload, keys) => {
  assert.deepEqual(Object.keys(payload).sort(), [...keys].sort());
};

const assertCallbackHtmlDoesNotLeak = (html, forbiddenValues = []) => {
  const text = String(html || "");
  for (const value of forbiddenValues) {
    const raw = String(value || "").trim();
    if (raw) {
      assert.equal(text.includes(raw), false, `callback html leaked ${raw}`);
    }
  }
  assert.equal(text.includes("access-"), false);
  assert.equal(text.includes("refresh-"), false);
  assert.equal(text.includes(env.accessCookieName), false);
  assert.equal(text.includes(env.refreshCookieName), false);
  assert.equal(text.includes("passwordHash"), false);
  assert.equal(text.includes("sessionId"), false);
};

const useIsolatedPaths = (t) => {
  const previousDbPath = env.dbPath;
  const previousBinStoragePath = env.binStoragePath;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xyzw-wechat-route-"));
  env.dbPath = path.join(tempRoot, "test.sqlite.bin");
  env.binStoragePath = path.join(tempRoot, "test-bin");
  t.after(() => {
    env.dbPath = previousDbPath;
    env.binStoragePath = previousBinStoragePath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
};

const useWechatEnv = (t, configured = true) => {
  const previous = {
    wechatOpenAppId: env.wechatOpenAppId,
    wechatOpenAppSecret: env.wechatOpenAppSecret,
    wechatOpenRedirectUri: env.wechatOpenRedirectUri,
  };
  env.wechatOpenAppId = configured ? "wx-test-app" : "";
  env.wechatOpenAppSecret = configured ? "wx-test-secret" : "";
  env.wechatOpenRedirectUri = configured
    ? "http://127.0.0.1/api/v1/auth/wechat/callback"
    : "";
  t.after(() => {
    env.wechatOpenAppId = previous.wechatOpenAppId;
    env.wechatOpenAppSecret = previous.wechatOpenAppSecret;
    env.wechatOpenRedirectUri = previous.wechatOpenRedirectUri;
  });
};

const useWechatFetchMock = (t, profilesByCode) => {
  const originalFetch = global.fetch;
  const requestedCodes = [];
  global.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (
      url.hostname === "api.weixin.qq.com"
      && url.pathname === "/sns/oauth2/access_token"
    ) {
      const code = String(url.searchParams.get("code") || "");
      requestedCodes.push(code);
      const profile = profilesByCode[code];
      if (!profile) {
        return Response.json({
          errcode: 40029,
          errmsg: "invalid code",
        });
      }
      return Response.json({
        access_token: `access-${code}`,
        expires_in: 7200,
        refresh_token: `refresh-${code}`,
        openid: profile.openId,
        scope: "snsapi_login",
        unionid: profile.unionId,
      });
    }

    if (
      url.hostname === "api.weixin.qq.com"
      && url.pathname === "/sns/userinfo"
    ) {
      const accessToken = String(url.searchParams.get("access_token") || "");
      const code = accessToken.replace(/^access-/, "");
      const profile = profilesByCode[code];
      if (!profile) {
        return Response.json({
          errcode: 40003,
          errmsg: "invalid openid",
        });
      }
      return Response.json({
        openid: profile.openId,
        unionid: profile.unionId,
        nickname: profile.nickname,
        headimgurl: profile.avatarUrl,
      });
    }

    return originalFetch(input, init);
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  return requestedCodes;
};

const createUser = ({
  id,
  username,
  password,
  trialExpiresAt = null,
  mfaEnabled = false,
  mfaSecret = "",
}) => {
  const ts = nowIso();
  const passwordMeta = createPassword(password);
  run(`DELETE FROM refresh_tokens WHERE user_id = $id`, { $id: id });
  run(`DELETE FROM security_event_logs WHERE user_id = $id`, { $id: id });
  run(`DELETE FROM users WHERE id = $id OR username = $username`, {
    $id: id,
    $username: username,
  });
  run(
    `INSERT INTO users (
      id, username, email, password_salt, password_hash, token_version,
      mfa_enabled, mfa_totp_secret_enc, mfa_recovery_codes_hash,
      trial_expires_at, created_at, updated_at
    ) VALUES (
      $id, $username, NULL, $salt, $hash, 0,
      $mfaEnabled, $mfaTotpSecretEnc, $mfaRecoveryCodesHash,
      $trialExpiresAt, $createdAt, $updatedAt
    )`,
    {
      $id: id,
      $username: username,
      $salt: passwordMeta.salt,
      $hash: passwordMeta.hash,
      $mfaEnabled: mfaEnabled ? 1 : 0,
      $mfaTotpSecretEnc: mfaEnabled ? encryptMfaSecret(mfaSecret) : null,
      $mfaRecoveryCodesHash: mfaEnabled ? "[]" : null,
      $trialExpiresAt: trialExpiresAt,
      $createdAt: ts,
      $updatedAt: ts,
    },
  );
};

const seedWechatBinding = ({ userId, profile }) => {
  const ts = nowIso();
  run(
    `UPDATE users
     SET wechat_open_id = $openId,
         wechat_union_id = $unionId,
         wechat_app_id = $appId,
         wechat_nickname = $nickname,
         wechat_avatar_url = $avatarUrl,
         wechat_bound_at = $boundAt,
         updated_at = $updatedAt
     WHERE id = $id`,
    {
      $id: userId,
      $openId: profile.openId,
      $unionId: profile.unionId,
      $appId: "wx-test-app",
      $nickname: profile.nickname,
      $avatarUrl: profile.avatarUrl,
      $boundAt: ts,
      $updatedAt: ts,
    },
  );
};

const loginWithPassword = async ({ baseUrl, username, password }) => {
  const csrf = await fetchCsrfContext(baseUrl);
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrf.cookieHeader,
      [env.csrfHeaderName]: csrf.csrfToken,
    },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  return {
    response,
    payload,
    cookieHeader: mergeCookieHeader(csrf.cookieHeader, response.headers.getSetCookie()),
  };
};

const startWechatFlow = async ({
  baseUrl,
  pathName,
  cookieHeader = "",
  body = {},
  forwardedFor = "",
}) => {
  const csrf = await fetchCsrfContext(baseUrl, cookieHeader);
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrf.cookieHeader,
      [env.csrfHeaderName]: csrf.csrfToken,
      "x-forwarded-for": forwardedFor || nextForwardedFor(),
    },
    body: JSON.stringify(body),
  });
  const payload = await readResponsePayload(response);
  return {
    response,
    payload,
    cookieHeader: csrf.cookieHeader,
  };
};

const startWechatFlowWithoutCsrf = async ({
  baseUrl,
  forwardedFor,
}) => {
  const headers = {
    "content-type": "application/json",
  };
  if (forwardedFor) {
    headers["x-forwarded-for"] = forwardedFor;
  }
  const response = await fetch(`${baseUrl}/api/v1/auth/wechat/login/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ rememberMe: false }),
  });
  return {
    response,
    payload: await readResponsePayload(response),
  };
};

const callWechatCallback = async ({
  baseUrl,
  code = "",
  flowId = "",
  includeCode = true,
  includeState = true,
  cookieHeader = "",
  forwardedFor = "",
}) => {
  const url = new URL(`${baseUrl}/api/v1/auth/wechat/callback`);
  if (includeCode) {
    url.searchParams.set("code", code);
  }
  if (includeState) {
    url.searchParams.set("state", flowId);
  }
  const headers = {};
  if (cookieHeader) headers.cookie = cookieHeader;
  headers["x-forwarded-for"] = forwardedFor || nextForwardedFor();
  const response = await fetch(url, { headers });
  const html = await response.text();
  return {
    response,
    html,
    payload: extractWechatCallbackPayload(html),
  };
};

const getWechatBinding = async ({ baseUrl, cookieHeader }) => {
  const response = await fetch(`${baseUrl}/api/v1/auth/wechat/binding`, {
    headers: {
      cookie: cookieHeader,
    },
  });
  return {
    response,
    payload: await response.json(),
  };
};

const confirmSensitiveAction = async ({ baseUrl, cookieHeader, password }) => {
  const csrf = await fetchCsrfContext(baseUrl, cookieHeader);
  const response = await fetch(`${baseUrl}/api/v1/user/confirm-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrf.cookieHeader,
      [env.csrfHeaderName]: csrf.csrfToken,
    },
    body: JSON.stringify({ password }),
  });
  const payload = await readResponsePayload(response);
  return {
    response,
    payload,
    cookieHeader: csrf.cookieHeader,
  };
};

const callWechatUnbind = async ({
  baseUrl,
  cookieHeader,
  confirmToken = "",
}) => {
  const csrf = await fetchCsrfContext(baseUrl, cookieHeader);
  const headers = {
    "content-type": "application/json",
    cookie: csrf.cookieHeader,
    [env.csrfHeaderName]: csrf.csrfToken,
  };
  if (confirmToken) {
    headers["x-user-confirm-token"] = confirmToken;
  }
  const response = await fetch(`${baseUrl}/api/v1/auth/wechat/unbind`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  return {
    response,
    payload: await readResponsePayload(response),
  };
};

const callMfaVerify = async ({
  baseUrl,
  mfaChallengeToken,
  totpCode,
}) => {
  const csrf = await fetchCsrfContext(baseUrl);
  const response = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: csrf.cookieHeader,
      [env.csrfHeaderName]: csrf.csrfToken,
    },
    body: JSON.stringify({
      mfaChallengeToken,
      totpCode,
    }),
  });
  return {
    response,
    payload: await response.json(),
    cookieHeader: mergeCookieHeader(csrf.cookieHeader, response.headers.getSetCookie()),
  };
};

test("wechat login start preserves configured and unconfigured response behavior", async (t) => {
  useIsolatedPaths(t);
  useWechatEnv(t);
  await initDatabase();
  const server = await createServer();
  t.after(() => closeServer(server));
  const baseUrl = makeBaseUrl(server);

  const first = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
    body: { rememberMe: true },
  });
  const second = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
    body: { rememberMe: false },
  });

  for (const started of [first, second]) {
    assert.equal(started.response.status, 200);
    assert.equal(started.payload?.success, true);
    assert.equal(typeof started.payload?.data?.authorizeUrl, "string");
    assert.equal(typeof started.payload?.data?.flowId, "string");
    const authorizeUrl = new URL(started.payload.data.authorizeUrl);
    assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://open.weixin.qq.com/connect/qrconnect");
    assert.equal(authorizeUrl.searchParams.get("appid"), env.wechatOpenAppId);
    assert.equal(authorizeUrl.searchParams.get("redirect_uri"), env.wechatOpenRedirectUri);
    assert.equal(authorizeUrl.searchParams.get("response_type"), "code");
    assert.equal(authorizeUrl.searchParams.get("scope"), "snsapi_login");
    assert.equal(authorizeUrl.searchParams.get("state"), started.payload.data.flowId);
  }

  useWechatEnv(t, false);
  const unconfigured = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
  });
  assert.equal(unconfigured.response.status, 503);
  assert.deepEqual(unconfigured.payload, {
    success: false,
    message: "微信登录暂未配置",
    error: {
      code: "AUTH_WECHAT_NOT_CONFIGURED",
      message: "微信登录暂未配置",
    },
  });
});

test("wechat callback validation preserves state consumption, code normalization, and payload safety", async (t) => {
  useIsolatedPaths(t);
  useWechatEnv(t);
  const requestedCodes = useWechatFetchMock(t, WECHAT_MOCK_PROFILES);
  await initDatabase();
  const server = await createServer();
  t.after(() => closeServer(server));
  const baseUrl = makeBaseUrl(server);

  const missingState = await callWechatCallback({
    baseUrl,
    code: "login_unbound",
    includeState: false,
  });
  assert.equal(missingState.response.status, 200);
  assert.equal(missingState.payload.success, false);
  assert.equal(missingState.payload.errorCode, "AUTH_WECHAT_FLOW_INVALID");
  assertPayloadKeys(missingState.payload, ["source", "intent", "success", "flowId", "message", "errorCode"]);
  assertCallbackHtmlDoesNotLeak(missingState.html, ["login_unbound", WECHAT_MOCK_PROFILES.login_unbound.openId]);

  const missingCodeFlow = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
  });
  const missingCode = await callWechatCallback({
    baseUrl,
    flowId: missingCodeFlow.payload.data.flowId,
    includeCode: false,
  });
  assert.equal(missingCode.payload.errorCode, "AUTH_WECHAT_CODE_MISSING");

  const malformedCodeFlow = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
  });
  const malformedCode = await callWechatCallback({
    baseUrl,
    flowId: malformedCodeFlow.payload.data.flowId,
    code: "bad\ncode",
  });
  assert.equal(malformedCode.payload.errorCode, "AUTH_WECHAT_CODE_MISSING");
  assert.equal(requestedCodes.includes("bad\ncode"), false);

  const replayFlow = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
  });
  const firstUse = await callWechatCallback({
    baseUrl,
    flowId: replayFlow.payload.data.flowId,
    code: "login_unbound",
  });
  const replay = await callWechatCallback({
    baseUrl,
    flowId: replayFlow.payload.data.flowId,
    code: "login_unbound",
  });
  assert.equal(firstUse.payload.errorCode, "AUTH_WECHAT_NOT_BOUND");
  assert.equal(replay.payload.errorCode, "AUTH_WECHAT_FLOW_INVALID");
});

test("wechat callback login and MFA branches preserve payload and cookie boundaries", async (t) => {
  useIsolatedPaths(t);
  useWechatEnv(t);
  useWechatFetchMock(t, WECHAT_MOCK_PROFILES);
  await initDatabase();

  const normalUser = {
    id: `wechat_char_login_${Date.now()}`,
    username: `wechat_char_login_${Date.now()}`,
    password: "WechatLoginChar123!Aa",
  };
  const mfaUser = {
    id: `wechat_char_mfa_${Date.now()}`,
    username: `wechat_char_mfa_${Date.now()}`,
    password: "WechatMfaChar123!Aa",
    secret: "JBSWY3DPEHPK3PXP",
  };
  createUser(normalUser);
  createUser({
    ...mfaUser,
    mfaEnabled: true,
    mfaSecret: mfaUser.secret,
  });
  seedWechatBinding({ userId: normalUser.id, profile: WECHAT_MOCK_PROFILES.login_bound });
  seedWechatBinding({ userId: mfaUser.id, profile: WECHAT_MOCK_PROFILES.login_mfa });

  const server = await createServer();
  t.after(() => closeServer(server));
  const baseUrl = makeBaseUrl(server);

  const loginStart = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
    body: { rememberMe: true },
  });
  const loginCallback = await callWechatCallback({
    baseUrl,
    flowId: loginStart.payload.data.flowId,
    code: "login_bound",
  });
  assert.equal(loginCallback.response.status, 200);
  assertPayloadKeys(loginCallback.payload, ["source", "intent", "success", "flowId", "message"]);
  assert.deepEqual(loginCallback.payload, {
    source: "xyzw-wechat-auth",
    intent: "login",
    success: true,
    flowId: loginStart.payload.data.flowId,
    message: "微信登录成功",
  });
  assertCallbackHtmlDoesNotLeak(loginCallback.html, [
    "login_bound",
    WECHAT_MOCK_PROFILES.login_bound.openId,
    WECHAT_MOCK_PROFILES.login_bound.unionId,
  ]);
  const loginCookies = mergeCookieHeader(loginCallback.response.headers.getSetCookie());
  assert.match(loginCookies, new RegExp(`${env.accessCookieName}=`));
  assert.match(loginCookies, new RegExp(`${env.refreshCookieName}=`));

  const mfaStart = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
    body: { rememberMe: true },
  });
  const mfaCallback = await callWechatCallback({
    baseUrl,
    flowId: mfaStart.payload.data.flowId,
    code: "login_mfa",
  });
  assert.equal(mfaCallback.response.status, 200);
  assertPayloadKeys(mfaCallback.payload, [
    "source",
    "intent",
    "success",
    "flowId",
    "message",
    "mfaRequired",
    "mfaChallengeToken",
  ]);
  assert.equal(mfaCallback.payload.mfaRequired, true);
  assert.equal(typeof mfaCallback.payload.mfaChallengeToken, "string");
  assert.equal(mfaCallback.payload.mfaChallengeToken.length > 0, true);
  const mfaCallbackCookies = mergeCookieHeader(mfaCallback.response.headers.getSetCookie());
  assert.equal(mfaCallbackCookies.includes(`${env.accessCookieName}=`), false);
  assert.equal(mfaCallbackCookies.includes(`${env.refreshCookieName}=`), false);

  const verified = await callMfaVerify({
    baseUrl,
    mfaChallengeToken: mfaCallback.payload.mfaChallengeToken,
    totpCode: generateTotpCode({ secret: mfaUser.secret }),
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.payload?.success, true);
  assert.equal(verified.payload?.message, "登录成功");
  assert.equal(verified.payload?.data?.user?.id, mfaUser.id);
  assert.match(verified.cookieHeader, new RegExp(`${env.accessCookieName}=`));
  assert.match(verified.cookieHeader, new RegExp(`${env.refreshCookieName}=`));
});

test("wechat bind flow uses server-side intent and user id boundaries", async (t) => {
  useIsolatedPaths(t);
  useWechatEnv(t);
  useWechatFetchMock(t, WECHAT_MOCK_PROFILES);
  await initDatabase();

  const userA = {
    id: `wechat_bind_a_${Date.now()}`,
    username: `wechat_bind_a_${Date.now()}`,
    password: "WechatBindA123!Aa",
  };
  const userB = {
    id: `wechat_bind_b_${Date.now()}`,
    username: `wechat_bind_b_${Date.now()}`,
    password: "WechatBindB123!Aa",
  };
  createUser(userA);
  createUser(userB);

  const server = await createServer();
  t.after(() => closeServer(server));
  const baseUrl = makeBaseUrl(server);
  const loginA = await loginWithPassword({
    baseUrl,
    username: userA.username,
    password: userA.password,
  });
  const loginB = await loginWithPassword({
    baseUrl,
    username: userB.username,
    password: userB.password,
  });

  const bindStart = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/bind/start",
    cookieHeader: loginA.cookieHeader,
  });
  const bindCallback = await callWechatCallback({
    baseUrl,
    flowId: bindStart.payload.data.flowId,
    code: "bind_a",
    cookieHeader: loginB.cookieHeader,
  });
  assert.equal(bindCallback.payload.success, true);
  assert.equal(bindCallback.payload.intent, "bind");

  const bindingA = await getWechatBinding({ baseUrl, cookieHeader: loginA.cookieHeader });
  const bindingB = await getWechatBinding({ baseUrl, cookieHeader: loginB.cookieHeader });
  assert.equal(bindingA.payload?.data?.bound, true);
  assert.equal(bindingA.payload?.data?.nickname, WECHAT_MOCK_PROFILES.bind_a.nickname);
  assert.equal(bindingB.payload?.data?.bound, false);

  const loginFlow = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
  });
  const loginCallback = await callWechatCallback({
    baseUrl,
    flowId: loginFlow.payload.data.flowId,
    code: "bind_a",
    cookieHeader: loginB.cookieHeader,
  });
  assert.equal(loginCallback.payload.success, true);
  assert.equal(loginCallback.payload.intent, "login");
  const loginFlowCookies = mergeCookieHeader(loginCallback.response.headers.getSetCookie());
  const me = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { cookie: loginFlowCookies },
  });
  assert.equal(me.status, 200);
  const mePayload = await me.json();
  assert.equal(mePayload?.data?.id, userA.id);

  const bindingBAfterLoginFlow = await getWechatBinding({ baseUrl, cookieHeader: loginB.cookieHeader });
  assert.equal(bindingBAfterLoginFlow.payload?.data?.bound, false);
});

test("wechat binding query and unbind preserve response and sensitive-action boundaries", async (t) => {
  useIsolatedPaths(t);
  useWechatEnv(t);
  await initDatabase();

  const user = {
    id: `wechat_unbind_gate_${Date.now()}`,
    username: `wechat_unbind_gate_${Date.now()}`,
    password: "WechatUnbindGate123!Aa",
  };
  createUser(user);
  seedWechatBinding({ userId: user.id, profile: WECHAT_MOCK_PROFILES.bind_a });

  const server = await createServer();
  t.after(() => closeServer(server));
  const baseUrl = makeBaseUrl(server);
  const login = await loginWithPassword({
    baseUrl,
    username: user.username,
    password: user.password,
  });
  assert.equal(login.response.status, 200);

  const binding = await getWechatBinding({ baseUrl, cookieHeader: login.cookieHeader });
  assert.equal(binding.response.status, 200);
  assertPayloadKeys(binding.payload.data, [
    "bound",
    "nickname",
    "avatarUrl",
    "boundAt",
    "lastLoginAt",
    "maskedOpenId",
  ]);
  assert.equal(binding.payload.data.bound, true);
  assert.equal(binding.payload.data.nickname, WECHAT_MOCK_PROFILES.bind_a.nickname);
  assert.equal(binding.payload.data.maskedOpenId.includes("***"), true);
  assert.equal(binding.payload.data.maskedOpenId.includes(WECHAT_MOCK_PROFILES.bind_a.openId), false);

  const deniedUnbind = await callWechatUnbind({
    baseUrl,
    cookieHeader: login.cookieHeader,
  });
  assert.equal(deniedUnbind.response.status, 403);
  const afterDenied = await getWechatBinding({ baseUrl, cookieHeader: login.cookieHeader });
  assert.equal(afterDenied.payload.data.bound, true);

  const confirmed = await confirmSensitiveAction({
    baseUrl,
    cookieHeader: login.cookieHeader,
    password: user.password,
  });
  assert.equal(confirmed.response.status, 200);
  const allowedUnbind = await callWechatUnbind({
    baseUrl,
    cookieHeader: confirmed.cookieHeader,
    confirmToken: String(confirmed.payload?.data?.token || ""),
  });
  assert.equal(allowedUnbind.response.status, 200);
  assert.deepEqual(allowedUnbind.payload, {
    success: true,
    message: "微信解绑成功",
  });
  const afterAllowed = await getWechatBinding({ baseUrl, cookieHeader: login.cookieHeader });
  assert.equal(afterAllowed.payload.data.bound, false);
});

test("wechat callback preserves blocked login and expired flow behavior", async (t) => {
  useIsolatedPaths(t);
  useWechatEnv(t);
  useWechatFetchMock(t, WECHAT_MOCK_PROFILES);
  await initDatabase();

  const blockedUser = {
    id: `wechat_blocked_${Date.now()}`,
    username: `wechat_blocked_${Date.now()}`,
    password: "WechatBlocked123!Aa",
  };
  createUser({
    ...blockedUser,
    trialExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  seedWechatBinding({ userId: blockedUser.id, profile: WECHAT_MOCK_PROFILES.blocked });

  const server = await createServer();
  t.after(() => closeServer(server));
  const baseUrl = makeBaseUrl(server);

  const blockedFlow = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
  });
  const blockedCallback = await callWechatCallback({
    baseUrl,
    flowId: blockedFlow.payload.data.flowId,
    code: "blocked",
  });
  assert.equal(blockedCallback.response.status, 200);
  assert.equal(blockedCallback.payload.success, false);
  assert.equal(blockedCallback.payload.errorCode, "AUTH_TRIAL_EXPIRED");
  assert.equal(blockedCallback.payload.message, "账号试用已到期，请联系管理员");

  const expiringFlow = await startWechatFlow({
    baseUrl,
    pathName: "/api/v1/auth/wechat/login/start",
  });
  const realNow = Date.now;
  const nowMock = t.mock.method(Date, "now", () => realNow() + 6 * 60 * 1000);
  const expiredCallback = await callWechatCallback({
    baseUrl,
    flowId: expiringFlow.payload.data.flowId,
    code: "login_unbound",
  });
  nowMock.mock.restore();
  assert.equal(expiredCallback.response.status, 200);
  assert.equal(expiredCallback.payload.success, false);
  assert.equal(expiredCallback.payload.errorCode, "AUTH_WECHAT_FLOW_INVALID");
});

test("wechat auth flow max count keeps oldest excess flows invalid", async (t) => {
  useWechatEnv(t);
  const originalInfo = console.info;
  console.info = () => {};
  t.after(() => {
    console.info = originalInfo;
  });

  const server = await createAuthRouteOnlyServer();
  t.after(() => closeServer(server));
  const baseUrl = makeBaseUrl(server);
  let oldestFlowId = "";
  let newestFlowId = "";

  for (let i = 0; i < 501; i += 1) {
    const started = await startWechatFlowWithoutCsrf({
      baseUrl,
      forwardedFor: `10.28.${Math.floor(i / 255)}.${(i % 255) + 1}`,
    });
    assert.equal(started.response.status, 200);
    const flowId = String(started.payload?.data?.flowId || "");
    assert.ok(flowId, "expected flow id");
    if (i === 0) {
      oldestFlowId = flowId;
    }
    newestFlowId = flowId;
  }

  const oldest = await callWechatCallback({
    baseUrl,
    flowId: oldestFlowId,
    code: "login_unbound",
    forwardedFor: "10.99.0.1",
  });
  assert.equal(oldest.payload.errorCode, "AUTH_WECHAT_FLOW_INVALID");

  const newest = await callWechatCallback({
    baseUrl,
    flowId: newestFlowId,
    includeCode: false,
    forwardedFor: "10.99.0.2",
  });
  assert.equal(newest.payload.errorCode, "AUTH_WECHAT_CODE_MISSING");
});
