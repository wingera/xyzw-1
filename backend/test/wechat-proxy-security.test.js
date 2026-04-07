import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createApp } from "../src/app/createApp.js";
import { initDatabase } from "../src/db/database.js";
import { run } from "../src/db/client.js";
import { createPassword, signJwt } from "../src/lib/crypto.js";
import { nowIso } from "../src/db/sql.js";
import { env } from "../src/config/env.js";

const makeBaseUrl = (server) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
};

const createServer = async () => {
  const { app } = createApp();
  const server = await new Promise((resolve, reject) => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
  return server;
};

const createUser = ({ id, username, password }) => {
  const ts = nowIso();
  const meta = createPassword(password);
  run(
    `INSERT INTO users (
      id, username, email, password_salt, password_hash, token_version, created_at, updated_at
    ) VALUES (
      $id, $username, NULL, $salt, $hash, 0, $createdAt, $updatedAt
    )`,
    {
      $id: id,
      $username: username,
      $salt: meta.salt,
      $hash: meta.hash,
      $createdAt: ts,
      $updatedAt: ts,
    },
  );
};

const requestLocal = ({ url, method, headers = {}, body = "" }) => {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
};

test("POST /wechat-proxy/hortor-login rejects requests without allowed Origin/Referer", async (t) => {
  await initDatabase();
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);

  let upstreamCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalls += 1;
    return new Response("ok", { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);
  });

  const response = await requestLocal({
    url: `${makeBaseUrl(server)}/api/v1/wechat-proxy/hortor-login`,
    method: "POST",
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
    body: "payload",
  });

  assert.equal(response.status, 403);
  assert.equal(upstreamCalls, 0);
});

test("POST /wechat-proxy/hortor-login forwards header deviceUniqueId to upstream", async (t) => {
  await initDatabase();
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);

  let upstreamUrl = "";
  let upstreamMethod = "";
  let upstreamBody = "";
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    upstreamUrl = String(url);
    upstreamMethod = String(options.method || "");
    upstreamBody = String(options.body || "");
    return new Response('{"meta":{"errCode":0},"data":{"combUser":{"id":"u1"}}}', {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);
  });

  const response = await requestLocal({
    url:
      `${makeBaseUrl(server)}/api/v1/wechat-proxy/hortor-login` +
      "?gameId=xyzwapp" +
      "&timestamp=1700000000000&version=android-4.2.1-cn-release" +
      "&cryptVersion=1.1.0&gameTp=app&system=android" +
      "&packageName=com.hortorgames.xyzw",
    method: "POST",
    headers: {
      origin: env.corsOrigins[0],
      referer: `${env.corsOrigins[0]}/login`,
      "content-type": "text/plain; charset=utf-8",
      "x-xyzw-device-unique-id": "DID-test_123",
    },
    body: "encoded-payload",
  });

  assert.equal(response.status, 200);
  assert.equal(upstreamMethod, "POST");
  assert.equal(upstreamBody, "encoded-payload");

  const target = new URL(upstreamUrl);
  assert.equal(
    target.toString().includes("deviceUniqueId=DID-test_123"),
    true,
  );
  assert.equal(target.searchParams.get("deviceUniqueId"), "DID-test_123");
  assert.equal(target.searchParams.get("gameId"), "xyzwapp");
  assert.equal(target.searchParams.get("packageName"), "com.hortorgames.xyzw");
});

test("POST /wechat-proxy/hortor-login rejects query deviceUniqueId before upstream", async (t) => {
  await initDatabase();
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);

  let upstreamCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalls += 1;
    return new Response("ok", { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);
  });

  const response = await requestLocal({
    url: `${makeBaseUrl(server)}/api/v1/wechat-proxy/hortor-login?gameId=xyzwapp&deviceUniqueId=abc`,
    method: "POST",
    headers: {
      origin: env.corsOrigins[0],
      referer: `${env.corsOrigins[0]}/login`,
      "content-type": "text/plain; charset=utf-8",
      "x-xyzw-device-unique-id": "DID-test_123",
    },
    body: "payload",
  });

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
  assert.equal(response.body.includes("deviceUniqueId"), true);
});

test("POST /wechat-proxy/hortor-login can enforce guest-only mode", async (t) => {
  await initDatabase();
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = `wechat_proxy_user_${suffix}`;
  const username = `wechat_proxy_user_${suffix}`;
  const password = "WechatProxy123!Aa";
  createUser({ id: userId, username, password });

  const prevGuestOnly = env.wechatProxyHortorLoginGuestOnly;
  env.wechatProxyHortorLoginGuestOnly = true;
  t.after(() => {
    env.wechatProxyHortorLoginGuestOnly = prevGuestOnly;
  });

  const originalFetch = global.fetch;
  global.fetch = async () => new Response("ok", { status: 200 });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM users WHERE id = $userId`, { $userId: userId });
    run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);
  });

  const token = signJwt({ sub: userId, username, ver: 0 }, 10 * 60);
  const response = await requestLocal({
    url: `${makeBaseUrl(server)}/api/v1/wechat-proxy/hortor-login`,
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      origin: env.corsOrigins[0],
      referer: `${env.corsOrigins[0]}/login`,
      "content-type": "text/plain; charset=utf-8",
    },
    body: "payload",
  });

  assert.equal(response.status, 403);
});

test("POST /wechat-proxy/qrstatus forwards body uuid to upstream", async (t) => {
  await initDatabase();
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);

  let upstreamUrl = "";
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    upstreamUrl = String(url);
    return new Response("ok", { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);
  });

  const response = await requestLocal({
    url: `${makeBaseUrl(server)}/api/v1/wechat-proxy/qrstatus`,
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ uuid: "wx_uuid_123" }),
  });

  assert.equal(response.status, 200);
  const target = new URL(upstreamUrl);
  assert.equal(target.searchParams.get("uuid"), "wx_uuid_123");
  assert.equal(target.searchParams.get("f"), "url");
  assert.equal(Boolean(target.searchParams.get("_")), true);
});

test("POST /wechat-proxy/qrstatus rejects query uuid before upstream", async (t) => {
  await initDatabase();
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);

  let upstreamCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    upstreamCalls += 1;
    return new Response("ok", { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);
  });

  const response = await requestLocal({
    url: `${makeBaseUrl(server)}/api/v1/wechat-proxy/qrstatus?uuid=wx_uuid_123`,
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ uuid: "wx_uuid_123" }),
  });

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
});

test("GET /wechat-proxy/qrconnect is rate limited", async (t) => {
  await initDatabase();
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    const html = "<html><body>ok</body></html>";
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'wechat_proxy_%'`);
  });

  const baseUrl = makeBaseUrl(server);
  let status = 200;
  for (let i = 0; i < 61; i += 1) {
    const response = await requestLocal({
      url: `${baseUrl}/api/v1/wechat-proxy/qrconnect?appid=test&state=${i}`,
      method: "GET",
    });
    status = response.status;
  }

  assert.equal(status, 429);
});
