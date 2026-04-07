import { query, run } from "../db/client.js";

const normalizeBinding = (row) => {
  if (!row) return null;
  return {
    ...row,
    roleId: String(row.roleId || row.gameAccountId || "").trim(),
    region: String(row.region || "").trim(),
    roleIndex: String(row.roleIndex ?? "").trim(),
    accountIdentity: String(row.accountIdentity || "").trim(),
    accountSeed: String(row.accountSeed || "").trim(),
    accountSignature: String(row.accountSignature || "").trim(),
    isActive: Number(row.isActive) === 1,
  };
};

export const tokenActivationRepository = {
  existsByAccountIdentityForOtherUser({ accountIdentity, userId }) {
    const normalizedAccountIdentity = String(accountIdentity || "").trim();
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedAccountIdentity || !normalizedUserId) {
      return false;
    }
    const rows = query(
      `SELECT id
       FROM token_activation_bindings
       WHERE account_identity = $accountIdentity
         AND user_id != $userId
       LIMIT 1`,
      {
        $accountIdentity: normalizedAccountIdentity,
        $userId: normalizedUserId,
      },
    );
    return Boolean(rows[0]);
  },

  findByAccountIdentity({ accountIdentity }) {
    const normalizedAccountIdentity = String(accountIdentity || "").trim();
    if (!normalizedAccountIdentity) {
      return null;
    }
    const rows = query(
       `SELECT
         id,
         token_id as tokenId,
         game_account_id as roleId,
         game_account_id as gameAccountId,
         role_name as roleName,
         region as region,
         role_index as roleIndex,
         account_identity as accountIdentity,
         account_seed as accountSeed,
         account_signature as accountSignature,
         user_id as userId,
         activation_code_id as activationCodeId,
         bound_at as boundAt,
         expires_at as expiresAt,
         is_active as isActive,
         updated_at as updatedAt,
         created_at as createdAt
       FROM token_activation_bindings
       WHERE account_identity = $accountIdentity
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      {
        $accountIdentity: normalizedAccountIdentity,
      },
    );
    return normalizeBinding(rows[0]);
  },

  findByTokenAndAccountIdentity({ tokenId, accountIdentity }) {
    const normalizedTokenId = String(tokenId || "").trim();
    const normalizedAccountIdentity = String(accountIdentity || "").trim();
    if (!normalizedTokenId || !normalizedAccountIdentity) {
      return null;
    }
    const rows = query(
      `SELECT
         id,
         token_id as tokenId,
         game_account_id as roleId,
         game_account_id as gameAccountId,
         role_name as roleName,
         region as region,
         role_index as roleIndex,
         account_identity as accountIdentity,
         account_seed as accountSeed,
         account_signature as accountSignature,
         user_id as userId,
         activation_code_id as activationCodeId,
         bound_at as boundAt,
         expires_at as expiresAt,
         is_active as isActive,
         updated_at as updatedAt,
         created_at as createdAt
       FROM token_activation_bindings
       WHERE token_id = $tokenId
         AND account_identity = $accountIdentity
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      {
        $tokenId: normalizedTokenId,
        $accountIdentity: normalizedAccountIdentity,
      },
    );
    return normalizeBinding(rows[0]);
  },

  findByRoleId({ roleId, gameAccountId }) {
    const normalizedRoleId = String(roleId || gameAccountId || "").trim();
    const rows = query(
       `SELECT
         id,
         token_id as tokenId,
         game_account_id as roleId,
         game_account_id as gameAccountId,
         role_name as roleName,
         region as region,
         role_index as roleIndex,
         account_identity as accountIdentity,
         account_seed as accountSeed,
         account_signature as accountSignature,
         user_id as userId,
         activation_code_id as activationCodeId,
         bound_at as boundAt,
         expires_at as expiresAt,
         is_active as isActive,
         updated_at as updatedAt,
         created_at as createdAt
       FROM token_activation_bindings
       WHERE game_account_id = $gameAccountId
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      {
        $gameAccountId: normalizedRoleId,
      },
    );
    return normalizeBinding(rows[0]);
  },

  findByRoleIdAndRegion({ roleId, gameAccountId, region, roleIndex }) {
    const normalizedRoleId = String(roleId || gameAccountId || "").trim();
    const normalizedRegion = String(region || "").trim();
    const normalizedRoleIndex = String(roleIndex ?? "").trim();
    if (!normalizedRoleId || !normalizedRegion) {
      return null;
    }
    const exactSql = `SELECT
         id,
         token_id as tokenId,
         game_account_id as roleId,
         game_account_id as gameAccountId,
         role_name as roleName,
         region as region,
         role_index as roleIndex,
         account_identity as accountIdentity,
         account_seed as accountSeed,
         account_signature as accountSignature,
         user_id as userId,
         activation_code_id as activationCodeId,
         bound_at as boundAt,
         expires_at as expiresAt,
         is_active as isActive,
         updated_at as updatedAt,
         created_at as createdAt
       FROM token_activation_bindings
       WHERE game_account_id = $gameAccountId
         AND region = $region
         AND role_index = $roleIndex
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`;
    const fallbackSql = `SELECT
         id,
         token_id as tokenId,
         game_account_id as roleId,
         game_account_id as gameAccountId,
         role_name as roleName,
         region as region,
         role_index as roleIndex,
         account_identity as accountIdentity,
         account_seed as accountSeed,
         account_signature as accountSignature,
         user_id as userId,
         activation_code_id as activationCodeId,
         bound_at as boundAt,
         expires_at as expiresAt,
         is_active as isActive,
         updated_at as updatedAt,
         created_at as createdAt
       FROM token_activation_bindings
       WHERE game_account_id = $gameAccountId
         AND region = $region
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`;

    let rows = [];
    if (normalizedRoleIndex) {
      rows = query(
        exactSql,
        {
          $gameAccountId: normalizedRoleId,
          $region: normalizedRegion,
          $roleIndex: normalizedRoleIndex,
        },
      );
    }
    if (!rows[0]) {
      rows = query(
        fallbackSql,
        {
          $gameAccountId: normalizedRoleId,
          $region: normalizedRegion,
        },
      );
    }
    return normalizeBinding(rows[0]);
  },

  findByTokenId({ tokenId }) {
    const normalizedTokenId = String(tokenId || "").trim();
    if (!normalizedTokenId) {
      return null;
    }
    const rows = query(
       `SELECT
         id,
         token_id as tokenId,
         game_account_id as roleId,
         game_account_id as gameAccountId,
         role_name as roleName,
         region as region,
         role_index as roleIndex,
         account_identity as accountIdentity,
         account_seed as accountSeed,
         account_signature as accountSignature,
         user_id as userId,
         activation_code_id as activationCodeId,
         bound_at as boundAt,
         expires_at as expiresAt,
         is_active as isActive,
         updated_at as updatedAt,
         created_at as createdAt
       FROM token_activation_bindings
       WHERE token_id = $tokenId
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      {
        $tokenId: normalizedTokenId,
      },
    );
    return normalizeBinding(rows[0]);
  },

  findLatestByActivationCodeId({ activationCodeId }) {
    const normalizedActivationCodeId = String(activationCodeId || "").trim();
    if (!normalizedActivationCodeId) {
      return null;
    }
    const rows = query(
      `SELECT
         b.id,
         b.token_id as tokenId,
         b.game_account_id as roleId,
         b.game_account_id as gameAccountId,
         b.role_name as roleName,
         b.region as region,
         b.role_index as roleIndex,
         b.account_identity as accountIdentity,
         b.account_seed as accountSeed,
         b.account_signature as accountSignature,
         b.user_id as userId,
         b.activation_code_id as activationCodeId,
         b.bound_at as boundAt,
         b.expires_at as expiresAt,
         b.is_active as isActive,
         b.updated_at as updatedAt,
         b.created_at as createdAt,
         u.username as bindingUsername
       FROM token_activation_bindings b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.activation_code_id = $activationCodeId
       ORDER BY datetime(b.updated_at) DESC
       LIMIT 1`,
      {
        $activationCodeId: normalizedActivationCodeId,
      },
    );
    return normalizeBinding(rows[0]);
  },

  create({
    id,
    tokenId,
    roleId,
    gameAccountId,
    roleName,
    region,
    roleIndex,
    accountIdentity,
    accountSeed,
    accountSignature,
    userId,
    activationCodeId,
    boundAt,
    expiresAt,
    createdAt,
  }) {
    run(
      `INSERT INTO token_activation_bindings (
         id, token_id, game_account_id, role_name, region, role_index,
         account_identity, account_seed, account_signature, user_id,
         activation_code_id, bound_at, expires_at,
         is_active, updated_at, created_at
       ) VALUES (
         $id, $tokenId, $gameAccountId, $roleName, $region, $roleIndex,
         $accountIdentity, $accountSeed, $accountSignature, $userId,
         $activationCodeId, $boundAt, $expiresAt,
         1, $boundAt, $createdAt
       )`,
      {
        $id: String(id || "").trim(),
        $tokenId: String(tokenId || "").trim(),
        $gameAccountId: String(roleId || gameAccountId || "").trim(),
        $roleName: String(roleName || "").trim(),
        $region: String(region || "").trim(),
        $roleIndex: String(roleIndex ?? "").trim(),
        $accountIdentity: String(accountIdentity || "").trim(),
        $accountSeed: String(accountSeed || "").trim(),
        $accountSignature: String(accountSignature || "").trim(),
        $userId: String(userId || "").trim(),
        $activationCodeId: String(activationCodeId || "").trim(),
        $boundAt: String(boundAt || "").trim(),
        $expiresAt: String(expiresAt || "").trim(),
        $createdAt: String(createdAt || "").trim(),
      },
    );
  },

  updateById({
    id,
    tokenId,
    userId,
    roleName,
    region,
    roleIndex,
    accountIdentity,
    accountSeed,
    accountSignature,
    activationCodeId,
    boundAt,
    expiresAt,
  }) {
    run(
      `UPDATE token_activation_bindings
       SET token_id = $tokenId,
           user_id = $userId,
           role_name = $roleName,
           region = $region,
           role_index = $roleIndex,
           account_identity = $accountIdentity,
           account_seed = $accountSeed,
           account_signature = $accountSignature,
           activation_code_id = $activationCodeId,
           bound_at = $boundAt,
           expires_at = $expiresAt,
           is_active = 1,
           updated_at = $boundAt
       WHERE id = $id`,
      {
        $id: String(id || "").trim(),
        $tokenId: String(tokenId || "").trim(),
        $userId: String(userId || "").trim(),
        $roleName: String(roleName || "").trim(),
        $region: String(region || "").trim(),
        $roleIndex: String(roleIndex ?? "").trim(),
        $accountIdentity: String(accountIdentity || "").trim(),
        $accountSeed: String(accountSeed || "").trim(),
        $accountSignature: String(accountSignature || "").trim(),
        $activationCodeId: String(activationCodeId || "").trim(),
        $boundAt: String(boundAt || "").trim(),
        $expiresAt: String(expiresAt || "").trim(),
      },
    );
  },

  listByUser(userId) {
    const rows = query(
       `SELECT
         id,
         token_id as tokenId,
         game_account_id as roleId,
         game_account_id as gameAccountId,
         role_name as roleName,
         region as region,
         role_index as roleIndex,
         account_identity as accountIdentity,
         account_seed as accountSeed,
         account_signature as accountSignature,
         user_id as userId,
         activation_code_id as activationCodeId,
         bound_at as boundAt,
         expires_at as expiresAt,
         is_active as isActive,
         updated_at as updatedAt,
         created_at as createdAt
       FROM token_activation_bindings
       WHERE user_id = $userId
       ORDER BY updated_at DESC`,
      {
        $userId: String(userId || "").trim(),
      },
    );
    return rows.map((row) => normalizeBinding(row));
  },

  deleteByActivationCodeId({ activationCodeId }) {
    const result = run(
      `DELETE FROM token_activation_bindings
       WHERE activation_code_id = $activationCodeId`,
      {
        $activationCodeId: String(activationCodeId || "").trim(),
      },
    );
    return Number(result?.changes || 0);
  },

  deleteAll() {
    const result = run(`DELETE FROM token_activation_bindings`);
    return Number(result?.changes || 0);
  },
};
