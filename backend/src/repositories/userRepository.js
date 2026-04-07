import { query, run } from "../db/client.js";
import { env } from "../config/env.js";
import { codeSuffix, hmacHex, maskedCode } from "../lib/crypto.js";

const passwordResetCodeHmac = (code) => hmacHex(env.passwordResetCodePepper, code);
const passwordResetCodeMask = (code) => maskedCode(code, "RST");
const redactStoredResetCode = (id) => `reset-redacted:${String(id || "").trim()}`;
import { normalizeAccessScope } from "../constants/accessScope.js";

const toBooleanAdmin = (row) => ({
  ...row,
  isAdmin: Number(row.isAdmin) === 1,
  mfaEnabled: Number(row.mfaEnabled) === 1,
  tokenVersion: Number(row.tokenVersion ?? 0) || 0,
  accessScope: normalizeAccessScope(row.accessScope),
  tokenBindLimit: Math.max(1, Math.min(999, Number(row.tokenBindLimit) || 999)),
});

export const userRepository = {
  findIdByUsernameOrEmail(username, email) {
    const rows = query(
      `SELECT id FROM users WHERE username = $username OR email = $email`,
      { $username: username, $email: email || null },
    );
    return rows[0] || null;
  },

  findByIdentity(identity) {
    const rows = query(
      `SELECT
         id,
         username,
         email,
         nickname,
         phone,
         account_display_id as accountDisplayId,
         trial_expires_at as trialExpiresAt,
         access_scope as accessScope,
         token_bind_limit as tokenBindLimit,
         is_admin as isAdmin,
         mfa_enabled as mfaEnabled,
         mfa_totp_secret_enc as mfaTotpSecretEnc,
         mfa_recovery_codes_hash as mfaRecoveryCodesHash,
         token_version as tokenVersion,
         password_salt as passwordSalt,
         password_hash as passwordHash,
         created_at as createdAt
       FROM users
       WHERE username = $identity OR email = $identity`,
      { $identity: identity },
    );
    if (!rows[0]) return null;
    return toBooleanAdmin(rows[0]);
  },

  findById(id) {
    const rows = query(
      `SELECT
         id,
         username,
         email,
         nickname,
         phone,
         account_display_id as accountDisplayId,
         trial_expires_at as trialExpiresAt,
         access_scope as accessScope,
         token_bind_limit as tokenBindLimit,
         is_admin as isAdmin,
         mfa_enabled as mfaEnabled,
         mfa_totp_secret_enc as mfaTotpSecretEnc,
         mfa_recovery_codes_hash as mfaRecoveryCodesHash,
         token_version as tokenVersion,
         created_at as createdAt
       FROM users
       WHERE id = $id`,
      { $id: id },
    );
    if (!rows[0]) return null;
    return toBooleanAdmin(rows[0]);
  },

  findPasswordById(id) {
    const rows = query(
      `SELECT password_salt as passwordSalt, password_hash as passwordHash
       FROM users
       WHERE id = $id`,
      { $id: id },
    );
    return rows[0] || null;
  },

  findByEmailExcludingId(email, id) {
    const rows = query(
      `SELECT id FROM users WHERE email = $email AND id != $id`,
      { $email: email, $id: id },
    );
    return rows[0] || null;
  },

  create({
    id,
    username,
    email,
    passwordSalt,
    passwordHash,
    trialExpiresAt = null,
    accessScope = "full",
    tokenBindLimit = 999,
    isAdmin = false,
    accountDisplayId = null,
    createdAt,
    updatedAt,
  }) {
    run(
      `INSERT INTO users (
        id, username, email, password_salt, password_hash, trial_expires_at, account_display_id, access_scope, token_bind_limit, is_admin, created_at, updated_at
      ) VALUES (
        $id, $username, $email, $salt, $hash, $trialExpiresAt, $accountDisplayId, $accessScope, $tokenBindLimit, $isAdmin, $createdAt, $updatedAt
      )`,
      {
        $id: id,
        $username: username,
        $email: email || null,
        $salt: passwordSalt,
        $hash: passwordHash,
        $trialExpiresAt: trialExpiresAt,
        $accountDisplayId: String(accountDisplayId || "").trim() || null,
        $accessScope: normalizeAccessScope(accessScope),
        $tokenBindLimit: Math.max(1, Math.min(999, Number(tokenBindLimit) || 999)),
        $isAdmin: isAdmin ? 1 : 0,
        $createdAt: createdAt,
        $updatedAt: updatedAt,
      },
    );
  },

  updatePassword({ id, passwordSalt, passwordHash, updatedAt }) {
    run(
      `UPDATE users
       SET password_salt = $salt,
           password_hash = $hash,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $salt: passwordSalt,
        $hash: passwordHash,
        $updatedAt: updatedAt,
      },
    );
  },

  bumpTokenVersion({ id, updatedAt }) {
    run(
      `UPDATE users
       SET token_version = COALESCE(token_version, 0) + 1,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $updatedAt: updatedAt,
      },
    );
  },

  updateLastLogin({ id, lastLoginAt, updatedAt }) {
    run(
      `UPDATE users
       SET last_login_at = $lastLoginAt,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $lastLoginAt: lastLoginAt,
        $updatedAt: updatedAt,
      },
    );
  },

  updateProfile({ id, email, nickname, phone, updatedAt }) {
    run(
      `UPDATE users
       SET email = $email,
           nickname = $nickname,
           phone = $phone,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $email: email || null,
        $nickname: nickname || null,
        $phone: phone || null,
        $updatedAt: updatedAt,
      },
    );
  },

  updateAdminFlag({ id, isAdmin, updatedAt }) {
    run(
      `UPDATE users SET is_admin = $isAdmin, updated_at = $updatedAt WHERE id = $id`,
      {
        $id: id,
        $isAdmin: isAdmin ? 1 : 0,
        $updatedAt: updatedAt,
      },
    );
  },

  updateTokenBindLimit({ id, tokenBindLimit, updatedAt }) {
    run(
      `UPDATE users
       SET token_bind_limit = $tokenBindLimit,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $tokenBindLimit: Math.max(1, Math.min(999, Number(tokenBindLimit) || 1)),
        $updatedAt: updatedAt,
      },
    );
  },

  updateAccessScope({ id, accessScope, updatedAt }) {
    run(
      `UPDATE users
       SET access_scope = $accessScope,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $accessScope: normalizeAccessScope(accessScope),
        $updatedAt: updatedAt,
      },
    );
  },

  updateMfaSettings({
    id,
    mfaEnabled,
    mfaTotpSecretEnc,
    mfaRecoveryCodesHash,
    updatedAt,
  }) {
    run(
      `UPDATE users
       SET mfa_enabled = $mfaEnabled,
           mfa_totp_secret_enc = $mfaTotpSecretEnc,
           mfa_recovery_codes_hash = $mfaRecoveryCodesHash,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $mfaEnabled: mfaEnabled ? 1 : 0,
        $mfaTotpSecretEnc: mfaTotpSecretEnc || null,
        $mfaRecoveryCodesHash: mfaRecoveryCodesHash || null,
        $updatedAt: updatedAt,
      },
    );
  },

  disableMfa({ id, updatedAt }) {
    run(
      `UPDATE users
       SET mfa_enabled = 0,
           mfa_totp_secret_enc = NULL,
           mfa_recovery_codes_hash = NULL,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $updatedAt: updatedAt,
      },
    );
  },

  updateMfaRecoveryCodesHash({ id, mfaRecoveryCodesHash, updatedAt }) {
    run(
      `UPDATE users
       SET mfa_recovery_codes_hash = $mfaRecoveryCodesHash,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $mfaRecoveryCodesHash: mfaRecoveryCodesHash || "[]",
        $updatedAt: updatedAt,
      },
    );
  },

  updateBootstrapAdmin({
    id,
    username,
    email,
    passwordSalt,
    passwordHash,
    updatedAt,
  }) {
    run(
      `UPDATE users
       SET username = $username,
           email = $email,
           password_salt = $salt,
           password_hash = $hash,
           is_admin = 1,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $username: username,
        $email: email,
        $salt: passwordSalt,
        $hash: passwordHash,
        $updatedAt: updatedAt,
      },
    );
  },

  deleteById(id) {
    run(`DELETE FROM users WHERE id = $id`, { $id: id });
  },

  hasBlockingReferralHistory(userId) {
    const rows = query(
      `SELECT CASE
         WHEN EXISTS(
           SELECT 1
           FROM referral_profiles
           WHERE user_id = $userId
         ) THEN 1
         WHEN EXISTS(
           SELECT 1
           FROM referral_attributions
           WHERE referrer_user_id = $userId OR referred_user_id = $userId
         ) THEN 1
         WHEN EXISTS(
           SELECT 1
           FROM referral_conversions
           WHERE referrer_user_id = $userId OR referred_user_id = $userId
         ) THEN 1
         ELSE 0
       END AS isBlocked`,
      { $userId: String(userId || "").trim() },
    );
    return Number(rows[0]?.isBlocked || 0) === 1;
  },

  deactivateActivePasswordResetCodesByUser(userId) {
    run(
      `UPDATE password_reset_codes
       SET is_active = 0
       WHERE user_id = $userId AND used_at IS NULL AND is_active = 1`,
      { $userId: userId },
    );
  },

  existsPasswordResetCode(code) {
    const rows = query(`SELECT id FROM password_reset_codes WHERE code_hmac = $codeHmac`, {
      $codeHmac: passwordResetCodeHmac(code),
    });
    return Boolean(rows[0]);
  },

  createPasswordResetCode({
    id,
    userId,
    code,
    createdBy,
    expiresAt,
    createdAt,
  }) {
    run(
      `INSERT INTO password_reset_codes
        (id, user_id, code, code_hmac, code_suffix, code_mask, created_by, expires_at, used_at, is_active, created_at)
       VALUES
        ($id, $userId, $storedCode, $codeHmac, $codeSuffix, $codeMask, $createdBy, $expiresAt, NULL, 1, $createdAt)`,
      {
        $id: id,
        $userId: userId,
        $storedCode: redactStoredResetCode(id),
        $codeHmac: passwordResetCodeHmac(code),
        $codeSuffix: codeSuffix(code),
        $codeMask: passwordResetCodeMask(code),
        $createdBy: createdBy,
        $expiresAt: expiresAt,
        $createdAt: createdAt,
      },
    );
  },

  findLatestPasswordResetCode({ userId, code }) {
    const rows = query(
      `SELECT
        id,
        expires_at as expiresAt,
        used_at as usedAt,
        is_active as isActive
      FROM password_reset_codes
      WHERE user_id = $userId AND code_hmac = $codeHmac
      ORDER BY created_at DESC
      LIMIT 1`,
      { $userId: userId, $codeHmac: passwordResetCodeHmac(code) },
    );
    return rows[0] || null;
  },

  deactivatePasswordResetCode(id) {
    run(
      `UPDATE password_reset_codes
       SET is_active = 0
       WHERE id = $id`,
      { $id: id },
    );
  },

  usePasswordResetCode({ id, usedAt }) {
    run(
      `UPDATE password_reset_codes
       SET used_at = $usedAt, is_active = 0
       WHERE id = $id`,
      { $id: id, $usedAt: usedAt },
    );
  },

  findAdminUserBasic(id) {
    const rows = query(
      `SELECT
         id,
         username,
         email,
         is_admin as isAdmin,
         access_scope as accessScope
       FROM users
       WHERE id = $id`,
      { $id: id },
    );
    if (!rows[0]) return null;
    return toBooleanAdmin(rows[0]);
  },

  findInviteCodeCreatorId() {
    const adminRows = query(
      `SELECT id
       FROM users
       WHERE is_admin = 1
       ORDER BY created_at ASC
       LIMIT 1`,
    );
    if (adminRows[0]?.id) {
      return String(adminRows[0].id);
    }

    const userRows = query(
      `SELECT id
       FROM users
       ORDER BY created_at ASC
       LIMIT 1`,
    );
    return userRows[0]?.id ? String(userRows[0].id) : "";
  },

  listUsersWithRoleInviteStats() {
    const rows = query(
      `SELECT
        u.id,
        u.username,
        u.email,
        u.is_admin as isAdmin,
        u.mfa_enabled as mfaEnabled,
        u.access_scope as accessScope,
        u.token_bind_limit as tokenBindLimit,
        u.created_at as createdAt,
        u.last_login_at as lastLoginAt,
        u.updated_at as updatedAt,
        COUNT(DISTINCT r.id) as roleCount,
        COUNT(DISTINCT ic.id) as inviteCount
      FROM users u
      LEFT JOIN roles r ON r.user_id = u.id
      LEFT JOIN invite_codes ic ON ic.created_by = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC`,
    );

    return rows.map((row) => ({
      ...row,
      isAdmin: Number(row.isAdmin) === 1,
      mfaEnabled: Number(row.mfaEnabled) === 1,
      accessScope: normalizeAccessScope(row.accessScope),
      tokenBindLimit: Math.max(1, Math.min(999, Number(row.tokenBindLimit) || 999)),
      roleCount: Number(row.roleCount) || 0,
      inviteCount: Number(row.inviteCount) || 0,
    }));
  },

  listAllBasicUsers() {
    return query(
      `SELECT id, username
       FROM users
       ORDER BY created_at DESC`,
    );
  },

  listAdminUsersWithoutMfa() {
    return query(
      `SELECT id, username, email
       FROM users
       WHERE is_admin = 1
         AND (mfa_enabled IS NULL OR mfa_enabled = 0)
       ORDER BY created_at ASC`,
    );
  },

  listExpiredTrialUsers(thresholdAt) {
    return query(
      `SELECT id, username, trial_expires_at as trialExpiresAt
       FROM users
       WHERE trial_expires_at IS NOT NULL
         AND trial_expires_at <= $thresholdAt`,
      { $thresholdAt: thresholdAt },
    );
  },
};
