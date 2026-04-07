import assert from "node:assert/strict";
import test from "node:test";

import { initDatabase } from "../src/db/database.js";
import { nowIso } from "../src/db/sql.js";
import { run } from "../src/db/client.js";
import { createPassword } from "../src/lib/crypto.js";
import { activationCodeRepository } from "../src/repositories/activationCodeRepository.js";
import { tokenActivationRepository } from "../src/repositories/tokenActivationRepository.js";
import { resolveTokenActivationForExecution } from "../src/services/taskControlSchedulerService.js";

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

test("backend scheduler resolves activation by saved roleId when the rescanned token has a new tokenId", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const user = {
    id: `scheduler_user_${suffix}`,
    username: `scheduler_user_${suffix}`,
    password: "Scheduler1234!Aa",
  };
  const activationCodeId = `scheduler_code_${suffix}`;
  const oldTokenId = `token_old_${suffix}`;
  const newTokenId = `token_new_${suffix}`;
  const roleId = "123456";
  const roleName = "测试角色";
  const region = "测试大区";

  insertUser(user);
  activationCodeRepository.create({
    id: activationCodeId,
    code: `SCHED${suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`,
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
    roleIndex: "0",
    accountIdentity: `sess-old-${suffix}|${roleId}|${region}|${roleName}`,
    accountSeed: `seed_${suffix}`,
    accountSignature: `sig_${suffix}`,
    userId: user.id,
    activationCodeId,
    boundAt: nowIso(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: nowIso(),
  });

  t.after(() => {
    run(`DELETE FROM token_activation_bindings WHERE user_id = $userId`, {
      $userId: user.id,
    });
    run(`DELETE FROM activation_codes WHERE id = $id`, { $id: activationCodeId });
    run(`DELETE FROM users WHERE id = $id`, { $id: user.id });
  });

  const result = await resolveTokenActivationForExecution({
    user,
    row: {
      tokenRoleIdMap: {
        [newTokenId]: roleId,
      },
    },
    tokenId: newTokenId,
  });

  assert.equal(result.active, true);
  assert.equal(result.binding?.tokenId, oldTokenId);
  assert.equal(result.binding?.roleId, roleId);
});
