import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { getDb, initDatabase } from "../src/db/database.js";
import { nowIso } from "../src/db/sql.js";
import { run } from "../src/db/client.js";
import { createPassword, signJwt } from "../src/lib/crypto.js";
import { env } from "../src/config/env.js";
import tokenActivationRoutes from "../src/routes/tokenActivations.js";
import { activationCodeRepository } from "../src/repositories/activationCodeRepository.js";
import { tokenActivationRepository } from "../src/repositories/tokenActivationRepository.js";

const makeBaseUrl = (server) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
};

const createServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", tokenActivationRoutes);
  const server = await new Promise((resolve, reject) => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
  return server;
};

const insertUser = ({ id, username, password, trialExpiresAt = null }) => {
  const ts = nowIso();
  const meta = createPassword(password);
  run(
    `INSERT INTO users (
      id, username, email, password_salt, password_hash, trial_expires_at, token_version, is_admin, created_at, updated_at
    ) VALUES (
      $id, $username, NULL, $salt, $hash, $trialExpiresAt, 0, 0, $createdAt, $updatedAt
    )`,
    {
      $id: id,
      $username: username,
      $salt: meta.salt,
      $hash: meta.hash,
      $trialExpiresAt: trialExpiresAt,
      $createdAt: ts,
      $updatedAt: ts,
    },
  );
};

const authHeaders = ({ userId, username }) => {
  const token = signJwt({ sub: userId, username, ver: 0 }, 60 * 10);
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
};

test("status falls back to same account binding when the rescanned token has a new tokenId", async (t) => {
  const originalDbPath = env.dbPath;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xyzw-status-test-"));
  env.dbPath = path.join(tempDir, "status.sqlite.bin");

  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `status_user_${suffix}`,
    username: `status_user_${suffix}`,
    password: "Status1234!Aa",
  };
  const activationCodeId = `status_code_${suffix}`;
  const oldTokenId = `token_old_${suffix}`;
  const newTokenId = `token_new_${suffix}`;
  const oldSessId = `sess-old-${suffix}`;
  const newSessId = `sess-new-${suffix}`;
  const roleId = "123456";
  const roleName = "测试角色";
  const region = "测试大区";
  const roleIndex = "0";

  insertUser(user);
  activationCodeRepository.create({
    id: activationCodeId,
    code: `ACTSTAT${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`,
    createdBy: user.id,
    durationMonths: 1,
    createdAt: nowIso(),
  });
  tokenActivationRepository.create({
    id: `binding_${suffix}`,
    tokenId: oldTokenId,
    roleId,
    roleName,
    region,
    roleIndex,
    accountIdentity: `${oldSessId}|${roleId}|${region}|${roleName}`,
    accountSeed: `seed_${suffix}`,
    accountSignature: `sig_${suffix}`,
    userId: user.id,
    activationCodeId,
    boundAt: nowIso(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: nowIso(),
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    getDb().close();
    env.dbPath = originalDbPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/token-activations/status`, {
    method: "POST",
    headers: authHeaders({ userId: user.id, username: user.username }),
    body: JSON.stringify({
      tokenId: newTokenId,
      roleId,
      gameAccountId: roleId,
      sessId: newSessId,
      roleName,
      region,
      server: region,
      roleIndex,
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload?.data?.active, true);
  assert.equal(payload?.data?.bound, true);
  assert.equal(payload?.data?.sessId, oldSessId);
  assert.equal(payload?.data?.accountIdentity, `${oldSessId}|${roleId}|${region}|${roleName}`);
});

test("status falls back to same role binding when rescanned token reports a different roleIndex", async (t) => {
  const originalDbPath = env.dbPath;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xyzw-status-roleindex-test-"));
  env.dbPath = path.join(tempDir, "status-roleindex.sqlite.bin");

  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `status_roleindex_user_${suffix}`,
    username: `status_roleindex_user_${suffix}`,
    password: "Status1234!Aa",
  };
  const activationCodeId = `status_roleindex_code_${suffix}`;
  const oldTokenId = `token_old_${suffix}`;
  const newTokenId = `token_new_${suffix}`;
  const roleId = "123456";
  const roleName = "测试角色";
  const region = "测试大区";

  insertUser(user);
  activationCodeRepository.create({
    id: activationCodeId,
    code: `ACTSTAT${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`,
    createdBy: user.id,
    durationMonths: 1,
    createdAt: nowIso(),
  });
  tokenActivationRepository.create({
    id: `binding_roleindex_${suffix}`,
    tokenId: oldTokenId,
    roleId,
    roleName,
    region,
    roleIndex: "0",
    accountIdentity: `|${roleId}|${region}|${roleName}`,
    accountSeed: `seed_${suffix}`,
    accountSignature: `sig_${suffix}`,
    userId: user.id,
    activationCodeId,
    boundAt: nowIso(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: nowIso(),
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    getDb().close();
    env.dbPath = originalDbPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/token-activations/status`, {
    method: "POST",
    headers: authHeaders({ userId: user.id, username: user.username }),
    body: JSON.stringify({
      tokenId: newTokenId,
      roleId,
      gameAccountId: roleId,
      sessId: `sess-new-${suffix}`,
      roleName,
      region,
      server: region,
      roleIndex: "1",
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload?.data?.active, true);
  assert.equal(payload?.data?.bound, true);
  assert.equal(payload?.data?.roleIndex, "0");
  assert.equal(payload?.data?.accountIdentity, `|${roleId}|${region}|${roleName}`);
});

test("one-day activation code can be used by regular users and expires in about one day", async (t) => {
  const originalDbPath = env.dbPath;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xyzw-one-day-activation-test-"));
  env.dbPath = path.join(tempDir, "one-day-activation.sqlite.bin");

  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const regularUser = {
    id: `oneday_regular_${suffix}`,
    username: `oneday_regular_${suffix}`,
    password: "Regular1234!Aa",
  };
  const activationCode = `ACT1D${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;

  insertUser(regularUser);
  activationCodeRepository.create({
    id: `oneday_code_${suffix}`,
    code: activationCode,
    createdBy: regularUser.id,
    durationMonths: 0,
    createdAt: nowIso(),
  });

  const server = await createServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    getDb().close();
    env.dbPath = originalDbPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const allowedResponse = await fetch(`${makeBaseUrl(server)}/api/v1/token-activations/bind`, {
    method: "POST",
    headers: authHeaders({ userId: regularUser.id, username: regularUser.username }),
    body: JSON.stringify({
      tokenId: `token_regular_${suffix}`,
      sessId: `sess-regular-${suffix}`,
      roleId: "123456",
      gameAccountId: "123456",
      roleName: "普通账号角色",
      region: "测试大区",
      server: "测试大区",
      roleIndex: "0",
      activationCode,
    }),
  });
  assert.equal(allowedResponse.status, 200);
  const allowedPayload = await allowedResponse.json();
  assert.equal(Number(allowedPayload?.data?.durationMonths), 0);
  const boundAtTs = new Date(allowedPayload?.data?.boundAt || "").getTime();
  const expiresAtTs = new Date(allowedPayload?.data?.expiresAt || "").getTime();
  const durationMs = expiresAtTs - boundAtTs;
  assert.ok(durationMs >= 23 * 60 * 60 * 1000, `expected one-day activation >= 23h, got ${durationMs}`);
  assert.ok(durationMs <= 25 * 60 * 60 * 1000, `expected one-day activation <= 25h, got ${durationMs}`);
});
