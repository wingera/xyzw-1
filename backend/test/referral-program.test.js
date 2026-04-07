import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app/createApp.js";
import { createUserRoutes } from "../src/app/userRoutes.js";
import { initDatabase } from "../src/db/database.js";
import { query, run } from "../src/db/client.js";
import { env } from "../src/config/env.js";
import { nowIso } from "../src/db/sql.js";
import { createPassword, signJwt } from "../src/lib/crypto.js";
import authRoutes from "../src/routes/auth.js";
import adminRoutes from "../src/routes/admin.js";
import adminReferralsRoutes from "../src/routes/adminReferrals.js";
import publicReferralsRoutes from "../src/routes/publicReferrals.js";
import tokenActivationRoutes from "../src/routes/tokenActivations.js";
import { activationCodeRepository } from "../src/repositories/activationCodeRepository.js";
import { inviteCodeRepository } from "../src/repositories/inviteCodeRepository.js";
import { referralConversionRepository } from "../src/repositories/referralConversionRepository.js";
import { referralProfileRepository } from "../src/repositories/referralProfileRepository.js";
import { userRepository } from "../src/repositories/userRepository.js";
import {
  attachReferralAttributionOnRegister,
  generateReferralProfileForUser,
  maskReferrerDisplayName,
} from "../src/services/referralService.js";
import {
  createMfaSetupPayload,
  encryptMfaSecret,
  generateTotpCode,
} from "../src/services/mfaService.js";

const makeBaseUrl = (server) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
};

const extractCookiePair = (response, cookieName) => {
  const raw = String(response.headers.get("set-cookie") || "");
  const escapedName = String(cookieName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = raw.match(new RegExp(`${escapedName}=([^;]*)`));
  if (!matched) {
    return "";
  }
  return `${cookieName}=${matched[1]}`;
};

const countSettlementsByConversionId = (conversionId) => Number(query(
  `SELECT COUNT(*) as total
   FROM referral_settlements
   WHERE conversion_id = $conversionId`,
  { $conversionId: conversionId },
)[0]?.total || 0);

const createWorkflowServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/admin", adminRoutes);
  app.use("/api/v1/admin", adminReferralsRoutes);
  app.use("/api/v1", publicReferralsRoutes);
  app.use("/api/v1", tokenActivationRoutes);
  app.use("/api/v1/user", createUserRoutes());

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

const insertUser = ({ id, username, password, isAdmin = false, mfaEnabled = false }) => {
  const ts = nowIso();
  const meta = createPassword(password);
  let secretEnc = null;
  let recoveryHash = null;
  let mfaSecret = "";

  if (mfaEnabled) {
    const mfaSetup = createMfaSetupPayload({ username });
    secretEnc = encryptMfaSecret(mfaSetup.secret);
    recoveryHash = JSON.stringify(mfaSetup.recoveryCodeHashes);
    mfaSecret = mfaSetup.secret;
  }

  run(
    `INSERT INTO users (
      id, username, email, password_salt, password_hash, token_version, is_admin,
      mfa_enabled, mfa_totp_secret_enc, mfa_recovery_codes_hash, created_at, updated_at
    ) VALUES (
      $id, $username, NULL, $salt, $hash, 0, $isAdmin,
      $mfaEnabled, $secretEnc, $recoveryHash, $createdAt, $updatedAt
    )`,
    {
      $id: id,
      $username: username,
      $salt: meta.salt,
      $hash: meta.hash,
      $isAdmin: isAdmin ? 1 : 0,
      $mfaEnabled: mfaEnabled ? 1 : 0,
      $secretEnc: secretEnc,
      $recoveryHash: recoveryHash,
      $createdAt: ts,
      $updatedAt: ts,
    },
  );

  return { mfaSecret };
};

const authHeaders = ({ userId, id, username }) => {
  const subject = String(userId || id || "").trim();
  const token = signJwt({ sub: subject, username, ver: 0 }, 60 * 10);
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
};

const createInviteCode = ({ id, code, createdBy }) => {
  inviteCodeRepository.create({
    id,
    code,
    createdBy,
    createdAt: nowIso(),
  });
};

const clearRegisterRateLimit = () => {
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'auth_register:%'`);
};

const createActivationCode = ({
  id,
  code,
  createdBy,
  durationMonths,
  featureScope = "full",
  saleAmountCents = 0,
}) => {
  activationCodeRepository.create({
    id,
    code,
    createdBy,
    featureScope,
    durationMonths,
    saleAmountCents,
    createdAt: nowIso(),
  });
};

const bindActivationCode = async ({
  baseUrl,
  user,
  activationCode,
  tokenId,
  roleId,
  sessId,
  roleName = "测试角色",
  region = "测试大区",
}) => {
  const userSeed = String(user?.id || "referraluser")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-8)
    .toLowerCase() || "refuser";
  const resolvedTokenId = String(tokenId || `token_${userSeed}`).trim();
  const resolvedRoleId = String(roleId || `1${String(userSeed.length).padStart(5, "2")}`).replace(/\D/g, "").slice(0, 12).padEnd(6, "3");
  const resolvedSessId = String(sessId || `sess-${userSeed}`).trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/token-activations/bind`, {
      method: "POST",
      headers: authHeaders(user),
      body: JSON.stringify({
        tokenId: resolvedTokenId,
        sessId: resolvedSessId,
        roleId: resolvedRoleId,
        gameAccountId: resolvedRoleId,
        roleName,
        region,
        server: region,
        roleIndex: 0,
        activationCode,
      }),
    });

    const rawText = await response.text();
    let payload;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = { success: false, message: rawText };
    }

    if (response.status < 500 || attempt === 2) {
      return {
        status: response.status,
        payload,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
  }

  return {
    status: 500,
    payload: { success: false, message: "bind failed" },
  };
};

const fetchAdminConfirmToken = async ({ baseUrl, adminUser, mfaSecret }) => {
  const response = await fetch(`${baseUrl}/api/v1/admin/confirm-password`, {
    method: "POST",
    headers: authHeaders(adminUser),
    body: JSON.stringify({
      totpCode: generateTotpCode({ secret: mfaSecret }),
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  return String(payload?.data?.token || "");
};

const createReferralScenarioUsers = ({ suffix }) => {
  const referrer = {
    id: `referrer_${suffix}`,
    username: `referrer_${suffix}`,
    password: "Referrer1234!Aa",
  };
  const referred = {
    id: `referred_${suffix}`,
    username: `referred_${suffix}`,
    password: "Referred1234!Aa",
  };
  insertUser(referrer);
  insertUser(referred);
  const profile = generateReferralProfileForUser(referrer.id);
  attachReferralAttributionOnRegister({
    referralCode: profile.referralCode,
    referredUserId: referred.id,
    inviteCodeId: null,
    inviteCodeMask: null,
    registeredAt: nowIso(),
    registerIp: "127.0.0.1",
    registerUserAgent: "node-test",
  });
  return { referrer, referred, profile };
};

test("public referral route resolves without auth in full app", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referrer = {
    id: `public_ref_${suffix}`,
    username: `public_ref_${suffix}`,
    password: "Public1234!Aa",
  };

  run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
  run(`DELETE FROM users WHERE id = $userId`, { $userId: referrer.id });
  insertUser(referrer);
  const profile = generateReferralProfileForUser(referrer.id);

  const server = await createFullServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: referrer.id });
  });

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/public/referrals/${profile.referralCode}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload?.data?.referrerDisplayName, maskReferrerDisplayName(referrer.username));
  assert.equal(payload?.data?.referralCode, profile.referralCode);
  assert.doesNotMatch(String(response.headers.get("set-cookie") || ""), /xyzw_referral=/);
});

test("a user can generate referral profile only once", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `ref_profile_user_${suffix}`,
    username: `ref_profile_user_${suffix}`,
    password: "Profile1234!Aa",
  };

  run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: user.id });
  run(`DELETE FROM users WHERE id = $userId`, { $userId: user.id });
  insertUser(user);

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: user.id });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: user.id });
  });

  const baseUrl = makeBaseUrl(server);
  const first = await fetch(`${baseUrl}/api/v1/user/referral-profile/generate`, {
    method: "POST",
    headers: authHeaders(user),
    body: JSON.stringify({}),
  });
  assert.equal(first.status, 200);
  const firstPayload = await first.json();

  const second = await fetch(`${baseUrl}/api/v1/user/referral-profile/generate`, {
    method: "POST",
    headers: authHeaders(user),
    body: JSON.stringify({}),
  });
  assert.equal(second.status, 200);
  const secondPayload = await second.json();

  assert.equal(firstPayload?.data?.referralCode, secondPayload?.data?.referralCode);
  const rows = query(
    `SELECT COUNT(*) as total
     FROM referral_profiles
     WHERE user_id = $userId`,
    { $userId: user.id },
  );
  assert.equal(Number(rows[0]?.total || 0), 1);
});

test("generateReferralProfileForUser returns existing profile when user_id unique conflict happens concurrently", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `ref_profile_race_user_${suffix}`,
    username: `ref_profile_race_user_${suffix}`,
    password: "Profile1234!Aa",
  };
  insertUser(user);

  const originalFindByUserId = referralProfileRepository.findByUserId;
  const originalCreate = referralProfileRepository.create;
  const concurrentProfile = {
    id: `refprof_existing_${suffix}`,
    userId: user.id,
    referralCode: `RACEUSER${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-2).toUpperCase()}`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    generatedAt: nowIso(),
  };
  let findByUserIdCalls = 0;

  referralProfileRepository.findByUserId = (userId) => {
    findByUserIdCalls += 1;
    if (findByUserIdCalls === 1) {
      return null;
    }
    return {
      ...concurrentProfile,
      userId: String(userId || "").trim(),
    };
  };
  referralProfileRepository.create = () => {
    const error = new Error("UNIQUE constraint failed: referral_profiles.user_id");
    error.code = "SQLITE_CONSTRAINT_UNIQUE";
    throw error;
  };

  t.after(() => {
    referralProfileRepository.findByUserId = originalFindByUserId;
    referralProfileRepository.create = originalCreate;
  });
  t.after(() => {
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: user.id });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: user.id });
  });

  const profile = generateReferralProfileForUser(user.id);
  assert.equal(profile?.userId, user.id);
  assert.equal(profile?.referralCode, concurrentProfile.referralCode);
});

test("generateReferralProfileForUser retries when referral_code unique conflict happens during create", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `ref_profile_code_race_${suffix}`,
    username: `ref_profile_code_race_${suffix}`,
    password: "Profile1234!Aa",
  };
  insertUser(user);

  const originalCreate = referralProfileRepository.create;
  let createCalls = 0;
  referralProfileRepository.create = (payload) => {
    createCalls += 1;
    if (createCalls === 1) {
      const error = new Error("UNIQUE constraint failed: referral_profiles.referral_code");
      error.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw error;
    }
    return originalCreate(payload);
  };

  t.after(() => {
    referralProfileRepository.create = originalCreate;
  });
  t.after(() => {
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: user.id });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: user.id });
  });

  const profile = generateReferralProfileForUser(user.id);
  assert.ok(profile?.id);
  assert.equal(profile?.userId, user.id);
  assert.ok(String(profile?.referralCode || "").length > 0);
  assert.equal(createCalls, 2);
});

test("registering with body referralCode only does not attribute by default", async (t) => {
  await initDatabase();
  clearRegisterRateLimit();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referrer = {
    id: `reg_referrer_${suffix}`,
    username: `reg_referrer_${suffix}`,
    password: "Referrer1234!Aa",
  };
  const inviteCodeId = `invite_${suffix}`;
  const inviteCode = `INVREF${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const registerUsername = `new_user_${suffix}`;

  insertUser(referrer);
  createInviteCode({
    id: inviteCodeId,
    code: inviteCode,
    createdBy: referrer.id,
  });
  const profile = generateReferralProfileForUser(referrer.id);

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearRegisterRateLimit();
    run(`DELETE FROM referral_settlements WHERE conversion_id IN (SELECT id FROM referral_conversions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username))`, { $username: registerUsername });
    run(`DELETE FROM referral_conversions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM referral_attributions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM invite_codes WHERE id = $id`, { $id: inviteCodeId });
    run(`DELETE FROM users WHERE username = $username`, { $username: registerUsername });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: referrer.id });
  });

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "referral-register-test",
    },
    body: JSON.stringify({
      username: registerUsername,
      email: `${registerUsername}@example.com`,
      password: "Register1234!Aa",
      inviteCode,
      referralCode: profile.referralCode,
    }),
  });

  assert.equal(response.status, 200);
  const createdUser = userRepository.findByIdentity(registerUsername);
  assert.ok(createdUser?.id);
  const attributionRows = query(
    `SELECT COUNT(*) as total
     FROM referral_attributions
     WHERE referred_user_id = $referredUserId`,
    { $referredUserId: createdUser.id },
  );
  assert.equal(Number(attributionRows[0]?.total || 0), 0);
});

test("registering with referral cookie creates attribution and clears cookie", async (t) => {
  await initDatabase();
  clearRegisterRateLimit();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referrer = {
    id: `cookie_referrer_${suffix}`,
    username: `cookie_referrer_${suffix}`,
    password: "Referrer1234!Aa",
  };
  const inviteCodeId = `invite_cookie_${suffix}`;
  const inviteCode = `INVCK${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const registerUsername = `cookie_user_${suffix}`;

  insertUser(referrer);
  createInviteCode({
    id: inviteCodeId,
    code: inviteCode,
    createdBy: referrer.id,
  });
  const profile = generateReferralProfileForUser(referrer.id);

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearRegisterRateLimit();
    run(`DELETE FROM referral_settlements WHERE conversion_id IN (SELECT id FROM referral_conversions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username))`, { $username: registerUsername });
    run(`DELETE FROM referral_conversions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM referral_attributions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM invite_codes WHERE id = $id`, { $id: inviteCodeId });
    run(`DELETE FROM users WHERE username = $username`, { $username: registerUsername });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: referrer.id });
  });

  const baseUrl = makeBaseUrl(server);
  const resolveRes = await fetch(`${baseUrl}/api/v1/public/referrals/${profile.referralCode}`);
  assert.equal(resolveRes.status, 200);
  assert.equal(String(resolveRes.headers.get("set-cookie") || ""), "");
  const attachRes = await fetch(`${baseUrl}/api/v1/public/referrals/${profile.referralCode}/attach`, {
    method: "POST",
    headers: {
      origin: baseUrl,
    },
  });
  assert.equal(attachRes.status, 200);
  const referralCookie = extractCookiePair(attachRes, "xyzw_referral");
  assert.ok(referralCookie);

  const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: referralCookie,
      "user-agent": "referral-cookie-register-test",
    },
    body: JSON.stringify({
      username: registerUsername,
      email: `${registerUsername}@example.com`,
      password: "Register1234!Aa",
      inviteCode,
      referralCode: "",
    }),
  });

  assert.equal(registerRes.status, 200);
  assert.match(String(registerRes.headers.get("set-cookie") || ""), /xyzw_referral=;/);

  const createdUser = userRepository.findByIdentity(registerUsername);
  assert.ok(createdUser?.id);
  const attribution = query(
    `SELECT referral_code_snapshot as referralCodeSnapshot
     FROM referral_attributions
     WHERE referred_user_id = $referredUserId`,
    { $referredUserId: createdUser.id },
  )[0];
  assert.equal(attribution?.referralCodeSnapshot, profile.referralCode);
});

test("registering with invalid body referralCode only is ignored by default", async (t) => {
  await initDatabase();
  clearRegisterRateLimit();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const owner = {
    id: `invite_owner_${suffix}`,
    username: `invite_owner_${suffix}`,
    password: "Owner1234!Aa",
  };
  const inviteCodeId = `invite_bad_${suffix}`;
  const inviteCode = `INVBAD${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const registerUsername = `bad_ref_${suffix}`;

  insertUser(owner);
  createInviteCode({
    id: inviteCodeId,
    code: inviteCode,
    createdBy: owner.id,
  });

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearRegisterRateLimit();
    run(`DELETE FROM referral_attributions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM invite_codes WHERE id = $id`, { $id: inviteCodeId });
    run(`DELETE FROM users WHERE username = $username`, { $username: registerUsername });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: owner.id });
  });

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: registerUsername,
      email: `${registerUsername}@example.com`,
      password: "Register1234!Aa",
      inviteCode,
      referralCode: "INVALIDCODE",
    }),
  });

  assert.equal(response.status, 200);
  const rows = query(
    `SELECT COUNT(*) as total
     FROM referral_attributions
     WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`,
    { $username: registerUsername },
  );
  assert.equal(Number(rows[0]?.total || 0), 0);
});

test("registering with mismatched referral cookie and body returns 400", async (t) => {
  await initDatabase();
  clearRegisterRateLimit();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referrerA = {
    id: `referrer_a_${suffix}`,
    username: `referrer_a_${suffix}`,
    password: "Referrer1234!Aa",
  };
  const referrerB = {
    id: `referrer_b_${suffix}`,
    username: `referrer_b_${suffix}`,
    password: "Referrer1234!Aa",
  };
  const inviteCodeId = `invite_mismatch_${suffix}`;
  const inviteCode = `INVMIS${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const registerUsername = `mismatch_${suffix}`;

  insertUser(referrerA);
  insertUser(referrerB);
  createInviteCode({
    id: inviteCodeId,
    code: inviteCode,
    createdBy: referrerA.id,
  });
  const profileA = generateReferralProfileForUser(referrerA.id);
  const profileB = generateReferralProfileForUser(referrerB.id);

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearRegisterRateLimit();
    run(`DELETE FROM referral_attributions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM referral_profiles WHERE user_id IN ($a, $b)`, { $a: referrerA.id, $b: referrerB.id });
    run(`DELETE FROM invite_codes WHERE id = $id`, { $id: inviteCodeId });
    run(`DELETE FROM users WHERE username = $username`, { $username: registerUsername });
    run(`DELETE FROM users WHERE id IN ($a, $b)`, { $a: referrerA.id, $b: referrerB.id });
  });

  const baseUrl = makeBaseUrl(server);
  const resolveRes = await fetch(`${baseUrl}/api/v1/public/referrals/${profileA.referralCode}`);
  assert.equal(resolveRes.status, 200);
  const attachRes = await fetch(`${baseUrl}/api/v1/public/referrals/${profileA.referralCode}/attach`, {
    method: "POST",
    headers: {
      origin: baseUrl,
    },
  });
  assert.equal(attachRes.status, 200);
  const referralCookie = extractCookiePair(attachRes, "xyzw_referral");
  assert.ok(referralCookie);

  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: referralCookie,
    },
    body: JSON.stringify({
      username: registerUsername,
      email: `${registerUsername}@example.com`,
      password: "Register1234!Aa",
      inviteCode,
      referralCode: profileB.referralCode,
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload?.code, "REFERRAL_MISMATCH");
  assert.match(String(payload?.message || ""), /推广信息不一致/);
  assert.match(String(response.headers.get("set-cookie") || ""), /xyzw_referral=;/);
});

test("legacy body fallback can still attribute when explicitly enabled", async (t) => {
  await initDatabase();
  clearRegisterRateLimit();

  const previous = env.allowLegacyReferralBodyFallback;
  env.allowLegacyReferralBodyFallback = true;
  t.after(() => {
    env.allowLegacyReferralBodyFallback = previous;
  });

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referrer = {
    id: `legacy_referrer_${suffix}`,
    username: `legacy_referrer_${suffix}`,
    password: "Referrer1234!Aa",
  };
  const inviteCodeId = `invite_legacy_${suffix}`;
  const inviteCode = `INVLEG${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const registerUsername = `legacy_user_${suffix}`;

  insertUser(referrer);
  createInviteCode({
    id: inviteCodeId,
    code: inviteCode,
    createdBy: referrer.id,
  });
  const profile = generateReferralProfileForUser(referrer.id);

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearRegisterRateLimit();
    run(`DELETE FROM referral_attributions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM invite_codes WHERE id = $id`, { $id: inviteCodeId });
    run(`DELETE FROM users WHERE username = $username`, { $username: registerUsername });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: referrer.id });
  });

  const response = await fetch(`${makeBaseUrl(server)}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: registerUsername,
      email: `${registerUsername}@example.com`,
      password: "Register1234!Aa",
      inviteCode,
      referralCode: profile.referralCode,
    }),
  });

  assert.equal(response.status, 200);
  const rows = query(
    `SELECT COUNT(*) as total
     FROM referral_attributions
     WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`,
    { $username: registerUsername },
  );
  assert.equal(Number(rows[0]?.total || 0), 1);
});

test("stale referral cookie with missing profile returns invalid code and clears cookie", async (t) => {
  await initDatabase();
  clearRegisterRateLimit();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referrer = {
    id: `stale_referrer_${suffix}`,
    username: `stale_referrer_${suffix}`,
    password: "Referrer1234!Aa",
  };
  const inviteCodeId = `invite_stale_${suffix}`;
  const inviteCode = `INVSTA${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const registerUsername = `stale_user_${suffix}`;

  insertUser(referrer);
  createInviteCode({
    id: inviteCodeId,
    code: inviteCode,
    createdBy: referrer.id,
  });
  const profile = generateReferralProfileForUser(referrer.id);

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearRegisterRateLimit();
    run(`DELETE FROM referral_attributions WHERE referred_user_id = (SELECT id FROM users WHERE username = $username)`, { $username: registerUsername });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM invite_codes WHERE id = $id`, { $id: inviteCodeId });
    run(`DELETE FROM users WHERE username = $username`, { $username: registerUsername });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: referrer.id });
  });

  const baseUrl = makeBaseUrl(server);
  const attachRes = await fetch(`${baseUrl}/api/v1/public/referrals/${profile.referralCode}/attach`, {
    method: "POST",
    headers: {
      origin: baseUrl,
    },
  });
  assert.equal(attachRes.status, 200);
  const referralCookie = extractCookiePair(attachRes, "xyzw_referral");
  assert.ok(referralCookie);

  run(`DELETE FROM referral_profiles WHERE id = $id`, { $id: profile.id });

  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: referralCookie,
    },
    body: JSON.stringify({
      username: registerUsername,
      email: `${registerUsername}@example.com`,
      password: "Register1234!Aa",
      inviteCode,
      referralCode: "",
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload?.code, "REFERRAL_INVALID");
  assert.match(String(response.headers.get("set-cookie") || ""), /xyzw_referral=;/);
});

test("public referral attach requires trusted same-origin request", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const referrer = {
    id: `attach_ref_${suffix}`,
    username: `attach_ref_${suffix}`,
    password: "Public1234!Aa",
  };

  insertUser(referrer);
  const profile = generateReferralProfileForUser(referrer.id);

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM users WHERE id = $userId`, { $userId: referrer.id });
  });

  const baseUrl = makeBaseUrl(server);
  const trustedRes = await fetch(`${baseUrl}/api/v1/public/referrals/${profile.referralCode}/attach`, {
    method: "POST",
    headers: {
      origin: baseUrl,
    },
  });
  assert.equal(trustedRes.status, 200);
  assert.match(String(trustedRes.headers.get("set-cookie") || ""), /xyzw_referral=/);

  const untrustedRes = await fetch(`${baseUrl}/api/v1/public/referrals/${profile.referralCode}/attach`, {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
  });
  assert.equal(untrustedRes.status, 403);
  assert.equal(String(untrustedRes.headers.get("set-cookie") || ""), "");
});

test("activation conversions follow first purchase and renewal reward rules", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { referrer, referred } = createReferralScenarioUsers({ suffix });
  const codeCreator = referrer.id;
  const firstCode = `ACTFP${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const secondCode = `ACTRN${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const thirdCode = `ACTSH${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;

  createActivationCode({
    id: `act_first_${suffix}`,
    code: firstCode,
    createdBy: codeCreator,
    durationMonths: 1,
    saleAmountCents: 10000,
  });
  createActivationCode({
    id: `act_second_${suffix}`,
    code: secondCode,
    createdBy: codeCreator,
    durationMonths: 3,
    saleAmountCents: 9000,
  });
  createActivationCode({
    id: `act_third_${suffix}`,
    code: thirdCode,
    createdBy: codeCreator,
    durationMonths: 1,
    saleAmountCents: 3000,
  });

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_settlements WHERE conversion_id IN (SELECT id FROM referral_conversions WHERE referred_user_id = $userId)`, { $userId: referred.id });
    run(`DELETE FROM referral_conversions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_attributions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM token_activation_bindings WHERE user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM activation_codes WHERE created_by = $createdBy`, { $createdBy: codeCreator });
    run(`DELETE FROM users WHERE id IN ($referrerId, $referredId)`, {
      $referrerId: referrer.id,
      $referredId: referred.id,
    });
  });

  const baseUrl = makeBaseUrl(server);

  const firstBind = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: firstCode,
  });
  assert.equal(firstBind.status, 200);

  const secondBind = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: secondCode,
  });
  assert.equal(secondBind.status, 200);

  const thirdBind = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: thirdCode,
  });
  assert.equal(thirdBind.status, 200);

  const rows = referralConversionRepository.listByReferrerUserId(referrer.id);
  assert.equal(rows.length, 3);

  const byCode = new Map(rows.map((row) => [row.activationCodeId, row]));
  const firstActivation = byCode.get(`act_first_${suffix}`);
  const secondActivation = byCode.get(`act_second_${suffix}`);
  const thirdActivation = byCode.get(`act_third_${suffix}`);

  assert.equal(firstActivation?.conversionType, "first_purchase");
  assert.equal(firstActivation?.rewardStatus, "pending");
  assert.equal(firstActivation?.rewardRateBps, 5000);
  assert.equal(firstActivation?.rewardAmountCents, 5000);

  assert.equal(secondActivation?.conversionType, "renewal_gt_2m");
  assert.equal(secondActivation?.rewardStatus, "pending");
  assert.equal(secondActivation?.rewardRateBps, 2000);
  assert.equal(secondActivation?.rewardAmountCents, 1800);

  assert.equal(thirdActivation?.conversionType, "renewal_le_2m");
  assert.equal(thirdActivation?.rewardStatus, "not_eligible");
  assert.equal(thirdActivation?.rewardRateBps, 0);
  assert.equal(thirdActivation?.rewardAmountCents, 0);
});

test("first zero-amount activation does not consume first paid purchase reward", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { referrer, referred } = createReferralScenarioUsers({ suffix });
  createActivationCode({
    id: `act_zero_${suffix}`,
    code: `ACTZERO${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`,
    createdBy: referrer.id,
    durationMonths: 1,
    saleAmountCents: 0,
  });
  createActivationCode({
    id: `act_paid_${suffix}`,
    code: `ACTPAID${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`,
    createdBy: referrer.id,
    durationMonths: 3,
    saleAmountCents: 12000,
  });

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_settlements WHERE conversion_id IN (SELECT id FROM referral_conversions WHERE referred_user_id = $userId)`, { $userId: referred.id });
    run(`DELETE FROM referral_conversions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_attributions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM token_activation_bindings WHERE user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM activation_codes WHERE created_by = $createdBy`, { $createdBy: referrer.id });
    run(`DELETE FROM users WHERE id IN ($referrerId, $referredId)`, {
      $referrerId: referrer.id,
      $referredId: referred.id,
    });
  });

  const baseUrl = makeBaseUrl(server);
  const zeroBind = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: `ACTZERO${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`,
  });
  assert.equal(zeroBind.status, 200);

  const paidBind = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: `ACTPAID${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`,
  });
  assert.equal(paidBind.status, 200);

  const rows = referralConversionRepository.listByReferrerUserId(referrer.id);
  const paidRow = rows.find((row) => row.activationCodeId === `act_paid_${suffix}`);
  assert.equal(paidRow?.conversionType, "first_purchase");
  assert.equal(paidRow?.rewardRateBps, 5000);
  assert.equal(paidRow?.rewardAmountCents, 6000);
});

test("mark-paid requires settlementRef for wechat_manual and bank but allows empty ref for other", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { referrer, referred } = createReferralScenarioUsers({ suffix });
  const adminUser = {
    id: `admin_settlement_ref_${suffix}`,
    username: `admin_settlement_ref_${suffix}`,
    password: "Admin1234!Aa",
  };
  const { mfaSecret } = insertUser({
    ...adminUser,
    isAdmin: true,
    mfaEnabled: true,
  });
  createActivationCode({
    id: `act_paid_ref_${suffix}`,
    code: `ACTREF${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-7).toUpperCase()}`,
    createdBy: referrer.id,
    durationMonths: 1,
    saleAmountCents: 5000,
  });

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_settlements WHERE conversion_id IN (SELECT id FROM referral_conversions WHERE referred_user_id = $userId)`, { $userId: referred.id });
    run(`DELETE FROM referral_conversions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_attributions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM token_activation_bindings WHERE user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM activation_codes WHERE created_by = $createdBy`, { $createdBy: referrer.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id IN ($referrerId, $referredId, $adminId)`, {
      $referrerId: referrer.id,
      $referredId: referred.id,
      $adminId: adminUser.id,
    });
  });

  const baseUrl = makeBaseUrl(server);
  const bindRes = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: `ACTREF${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-7).toUpperCase()}`,
  });
  assert.equal(bindRes.status, 200);

  const pendingRow = referralConversionRepository.listByReferrerUserId(referrer.id)[0];
  assert.equal(pendingRow.rewardStatus, "pending");
  const confirmToken = await fetchAdminConfirmToken({
    baseUrl,
    adminUser,
    mfaSecret,
  });
  const headers = {
    ...authHeaders(adminUser),
    "x-admin-confirm-token": confirmToken,
  };

  const missingWechatRef = await fetch(`${baseUrl}/api/v1/admin/referrals/conversions/${pendingRow.id}/mark-paid`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: "wechat_manual",
      settlementRef: "",
      note: "缺少凭证",
    }),
  });
  assert.equal(missingWechatRef.status, 400);
  assert.match(String((await missingWechatRef.json())?.message || ""), /settlementRef/);

  const missingBankRef = await fetch(`${baseUrl}/api/v1/admin/referrals/conversions/${pendingRow.id}/mark-paid`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: "bank",
      settlementRef: "",
      note: "缺少银行卡凭证",
    }),
  });
  assert.equal(missingBankRef.status, 400);
  assert.match(String((await missingBankRef.json())?.message || ""), /settlementRef/);

  const otherWithoutRef = await fetch(`${baseUrl}/api/v1/admin/referrals/conversions/${pendingRow.id}/mark-paid`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: "other",
      settlementRef: "",
      note: "其他渠道无需单号",
    }),
  });
  assert.equal(otherWithoutRef.status, 200);

  const updated = referralConversionRepository.findById(pendingRow.id);
  assert.equal(updated?.rewardStatus, "paid");
  assert.equal(updated?.settlementChannel, "other");
  assert.equal(updated?.settlementRef, null);
});

test("admin can mark pending referral conversion as paid and settlement is created once", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { referrer, referred } = createReferralScenarioUsers({ suffix });
  const adminUser = {
    id: `admin_${suffix}`,
    username: `admin_${suffix}`,
    password: "Admin1234!Aa",
  };
  const { mfaSecret } = insertUser({
    ...adminUser,
    isAdmin: true,
    mfaEnabled: true,
  });
  createActivationCode({
    id: `act_paid_target_${suffix}`,
    code: `ACTPAY${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-7).toUpperCase()}`,
    createdBy: referrer.id,
    durationMonths: 1,
    saleAmountCents: 5000,
  });

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_settlements WHERE conversion_id IN (SELECT id FROM referral_conversions WHERE referred_user_id = $userId)`, { $userId: referred.id });
    run(`DELETE FROM referral_conversions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_attributions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM token_activation_bindings WHERE user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM activation_codes WHERE created_by = $createdBy`, { $createdBy: referrer.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id IN ($referrerId, $referredId, $adminId)`, {
      $referrerId: referrer.id,
      $referredId: referred.id,
      $adminId: adminUser.id,
    });
  });

  const baseUrl = makeBaseUrl(server);
  const bindRes = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: `ACTPAY${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-7).toUpperCase()}`,
  });
  assert.equal(bindRes.status, 200);

  const pendingRow = referralConversionRepository.listByReferrerUserId(referrer.id)[0];
  assert.equal(pendingRow.rewardStatus, "pending");

  const confirmToken = await fetchAdminConfirmToken({
    baseUrl,
    adminUser,
    mfaSecret,
  });
  const markPaidRes = await fetch(`${baseUrl}/api/v1/admin/referrals/conversions/${pendingRow.id}/mark-paid`, {
    method: "POST",
    headers: {
      ...authHeaders(adminUser),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({
      channel: "wechat_manual",
      settlementRef: "WX-SETTLE-001",
      note: "已线下打款",
    }),
  });
  assert.equal(markPaidRes.status, 200);

  const updated = referralConversionRepository.findById(pendingRow.id);
  assert.equal(updated?.rewardStatus, "paid");
  assert.equal(updated?.paidBy, adminUser.id);
  assert.equal(updated?.note, "已线下打款");
  assert.ok(updated?.paidAt);
  assert.equal(updated?.settlementChannel, "wechat_manual");
  assert.equal(updated?.settlementRef, "WX-SETTLE-001");
  assert.ok(updated?.settledAt);

  const settlement = query(
    `SELECT
      conversion_id as conversionId,
      channel,
      settlement_ref as settlementRef,
      amount_cents as amountCents
     FROM referral_settlements
     WHERE conversion_id = $conversionId`,
    { $conversionId: pendingRow.id },
  )[0];
  assert.equal(settlement?.conversionId, pendingRow.id);
  assert.equal(settlement?.channel, "wechat_manual");
  assert.equal(settlement?.settlementRef, "WX-SETTLE-001");
  assert.equal(Number(settlement?.amountCents || 0), pendingRow.rewardAmountCents);

  const duplicateMarkPaidRes = await fetch(`${baseUrl}/api/v1/admin/referrals/conversions/${pendingRow.id}/mark-paid`, {
    method: "POST",
    headers: {
      ...authHeaders(adminUser),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({
      channel: "bank",
      settlementRef: "BANK-SETTLE-002",
      note: "重复提交",
    }),
  });
  assert.equal(duplicateMarkPaidRes.status, 409);
  assert.equal(countSettlementsByConversionId(pendingRow.id), 1);

  const rejectAfterPaidRes = await fetch(`${baseUrl}/api/v1/admin/referrals/conversions/${pendingRow.id}/reject`, {
    method: "POST",
    headers: {
      ...authHeaders(adminUser),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({ note: "状态已变化后重复拒绝" }),
  });
  assert.equal(rejectAfterPaidRes.status, 409);
});

test("activation code unbind keeps paid codes immutable and consumed codes non-reusable", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { referrer, referred } = createReferralScenarioUsers({ suffix });
  const adminUser = {
    id: `unbind_admin_${suffix}`,
    username: `unbind_admin_${suffix}`,
    password: "Admin1234!Aa",
  };
  const { mfaSecret } = insertUser({
    ...adminUser,
    isAdmin: true,
    mfaEnabled: true,
  });

  const firstCodeId = `act_keep_paid_${suffix}`;
  const secondCodeId = `act_void_${suffix}`;
  const firstCode = `ACTKP${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const secondCode = `ACTVD${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;

  createActivationCode({
    id: firstCodeId,
    code: firstCode,
    createdBy: referrer.id,
    durationMonths: 1,
    saleAmountCents: 10000,
  });
  createActivationCode({
    id: secondCodeId,
    code: secondCode,
    createdBy: referrer.id,
    durationMonths: 1,
    saleAmountCents: 1000,
  });

  const server = await createWorkflowServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM referral_settlements WHERE conversion_id IN (SELECT id FROM referral_conversions WHERE referred_user_id = $userId)`, { $userId: referred.id });
    run(`DELETE FROM referral_conversions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_attributions WHERE referred_user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM referral_profiles WHERE user_id = $userId`, { $userId: referrer.id });
    run(`DELETE FROM token_activation_bindings WHERE user_id = $userId`, { $userId: referred.id });
    run(`DELETE FROM activation_codes WHERE created_by = $createdBy`, { $createdBy: referrer.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id IN ($referrerId, $referredId, $adminId)`, {
      $referrerId: referrer.id,
      $referredId: referred.id,
      $adminId: adminUser.id,
    });
  });

  const baseUrl = makeBaseUrl(server);
  assert.equal((await bindActivationCode({ baseUrl, user: referred, activationCode: firstCode })).status, 200);
  assert.equal((await bindActivationCode({ baseUrl, user: referred, activationCode: secondCode })).status, 200);

  const currentRows = referralConversionRepository.listByReferrerUserId(referrer.id);
  const firstConversion = currentRows.find((row) => row.activationCodeId === firstCodeId);
  const secondConversion = currentRows.find((row) => row.activationCodeId === secondCodeId);
  assert.equal(firstConversion?.rewardStatus, "pending");
  assert.equal(secondConversion?.rewardStatus, "not_eligible");

  const confirmToken = await fetchAdminConfirmToken({
    baseUrl,
    adminUser,
    mfaSecret,
  });
  const markPaidRes = await fetch(`${baseUrl}/api/v1/admin/referrals/conversions/${firstConversion.id}/mark-paid`, {
    method: "POST",
    headers: {
      ...authHeaders(adminUser),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({
      channel: "wechat_manual",
      settlementRef: "WX-UNBIND-001",
      note: "已结算首购返佣",
    }),
  });
  assert.equal(markPaidRes.status, 200);

  const unbindAllRes = await fetch(`${baseUrl}/api/v1/admin/activation-codes/unbind-all`, {
    method: "POST",
    headers: {
      ...authHeaders(adminUser),
      "x-admin-confirm-token": confirmToken,
    },
  });
  assert.equal(unbindAllRes.status, 409);

  const unbindSecondRes = await fetch(`${baseUrl}/api/v1/admin/activation-codes/${secondCodeId}/unbind`, {
    method: "POST",
    headers: {
      ...authHeaders(adminUser),
      "x-admin-confirm-token": confirmToken,
    },
  });
  assert.equal(unbindSecondRes.status, 200);

  const unbindFirstRes = await fetch(`${baseUrl}/api/v1/admin/activation-codes/${firstCodeId}/unbind`, {
    method: "POST",
    headers: {
      ...authHeaders(adminUser),
      "x-admin-confirm-token": confirmToken,
    },
  });
  assert.equal(unbindFirstRes.status, 409);

  const updatedFirst = referralConversionRepository.findById(firstConversion.id);
  const updatedSecond = referralConversionRepository.findById(secondConversion.id);
  assert.equal(updatedFirst?.rewardStatus, "paid");
  assert.equal(updatedSecond?.rewardStatus, "void");

  const secondCodeState = query(
    `SELECT
      used_by as usedBy,
      used_at as usedAt,
      bound_token_id as boundTokenId,
      bound_game_account_id as boundGameAccountId,
      is_active as isActive
     FROM activation_codes
     WHERE id = $id`,
    { $id: secondCodeId },
  )[0];
  assert.ok(String(secondCodeState?.usedBy || "").length > 0);
  assert.ok(String(secondCodeState?.usedAt || "").length > 0);
  assert.equal(secondCodeState?.boundTokenId, null);
  assert.equal(secondCodeState?.boundGameAccountId, null);
  assert.equal(Number(secondCodeState?.isActive || 0), 0);

  const secondRebindRes = await bindActivationCode({
    baseUrl,
    user: referred,
    activationCode: secondCode,
    tokenId: "token_ref_002",
    roleId: "123457",
    sessId: "sess-ref-002",
    roleName: "测试角色二号",
  });
  assert.equal(secondRebindRes.status, 400);
  assert.match(String(secondRebindRes.payload?.message || ""), /(已失效|已使用)/);
});
