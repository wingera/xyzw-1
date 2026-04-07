import assert from "node:assert/strict";
import test from "node:test";
import { initDatabase } from "../src/db/database.js";
import { nowIso } from "../src/db/sql.js";
import { createPassword } from "../src/lib/crypto.js";
import { query, run } from "../src/db/client.js";

const insertUser = ({ id, username, password }) => {
  const ts = nowIso();
  const meta = createPassword(password);
  run(
    `INSERT INTO users (
      id, username, email, password_salt, password_hash, token_version, is_admin, created_at, updated_at
    ) VALUES (
      $id, $username, NULL, $salt, $hash, 0, 0, $createdAt, $updatedAt
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

test("referral tables enable foreign keys and enforce safe delete strategies", async (t) => {
  const db = initDatabase();
  assert.equal(Number(db.pragma("foreign_keys", { simple: true }) || 0), 1);

  const profileFk = query(`PRAGMA foreign_key_list(referral_profiles)`);
  const attributionFk = query(`PRAGMA foreign_key_list(referral_attributions)`);
  const conversionFk = query(`PRAGMA foreign_key_list(referral_conversions)`);

  assert.equal(profileFk.find((row) => row.from === "user_id")?.on_delete, "RESTRICT");
  assert.equal(attributionFk.find((row) => row.from === "referrer_user_id")?.on_delete, "RESTRICT");
  assert.equal(attributionFk.find((row) => row.from === "referred_user_id")?.on_delete, "RESTRICT");
  assert.equal(attributionFk.find((row) => row.from === "referral_profile_id")?.on_delete, "RESTRICT");
  assert.equal(conversionFk.find((row) => row.from === "referral_attribution_id")?.on_delete, "RESTRICT");
  assert.equal(conversionFk.find((row) => row.from === "paid_by")?.on_delete, "SET NULL");

  assert.throws(() => {
    db.prepare(
      `INSERT INTO referral_profiles (
        id, user_id, referral_code, created_at, updated_at, generated_at
      ) VALUES (
        'refprof_invalid_fk', 'missing_user', 'MISSINGUSER', '2026-03-29T00:00:00.000Z',
        '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'
      )`,
    ).run();
  }, /FOREIGN KEY/);
});

test("referral schema migration is idempotent and preserves existing data", async (t) => {
  initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = `ref_db_user_${suffix}`;
  const profileId = `ref_db_profile_${suffix}`;
  const referralCode = `REFDB${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
  const ts = nowIso();

  insertUser({
    id: userId,
    username: `ref_db_${suffix}`,
    password: "Database1234!Aa",
  });
  run(
    `INSERT INTO referral_profiles (
      id, user_id, referral_code, created_at, updated_at, generated_at
    ) VALUES (
      $id, $userId, $referralCode, $createdAt, $updatedAt, $generatedAt
    )`,
    {
      $id: profileId,
      $userId: userId,
      $referralCode: referralCode,
      $createdAt: ts,
      $updatedAt: ts,
      $generatedAt: ts,
    },
  );

  t.after(() => {
    run(`DELETE FROM referral_profiles WHERE id = $id`, { $id: profileId });
    run(`DELETE FROM users WHERE id = $id`, { $id: userId });
  });

  initDatabase();
  const row = query(
    `SELECT id, user_id as userId, referral_code as referralCode
     FROM referral_profiles
     WHERE id = $id`,
    { $id: profileId },
  )[0];
  assert.equal(row?.userId, userId);
  assert.equal(row?.referralCode, referralCode);
});
