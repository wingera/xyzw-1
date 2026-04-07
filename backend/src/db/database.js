import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { env } from "../config/env.js";

let db;

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

export const initDatabase = () => {
  ensureDir(env.dbPath);

  // better-sqlite3 如果文件不存在会自动创建
  db = new Database(env.dbPath);
  db.pragma("foreign_keys = ON");

  // 性能优化设置
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  createSchema();
  db.pragma("foreign_keys = ON");

  return db;
};

const tableExists = (tableName) => {
  const normalized = String(tableName || "").trim();
  if (!normalized) {
    return false;
  }
  const row = db.prepare(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name = ?`,
  ).get(normalized);
  return Boolean(row?.name);
};

const normalizeForeignKeyAction = (value) =>
  String(value || "")
    .trim()
    .toUpperCase() || "NO ACTION";

const getForeignKeyList = (tableName) => {
  const normalized = String(tableName || "").trim();
  if (!normalized || !tableExists(normalized)) {
    return [];
  }
  return db.prepare(`PRAGMA foreign_key_list(${normalized})`).all().map((row) => ({
    table: String(row.table || "").trim(),
    from: String(row.from || "").trim(),
    to: String(row.to || "").trim(),
    onDelete: normalizeForeignKeyAction(row.on_delete),
    onUpdate: normalizeForeignKeyAction(row.on_update),
  }));
};

const EXPECTED_REFERRAL_FOREIGN_KEYS = {
  referral_profiles: [
    { table: "users", from: "user_id", to: "id", onDelete: "RESTRICT" },
  ],
  referral_attributions: [
    { table: "users", from: "referrer_user_id", to: "id", onDelete: "RESTRICT" },
    { table: "users", from: "referred_user_id", to: "id", onDelete: "RESTRICT" },
    { table: "referral_profiles", from: "referral_profile_id", to: "id", onDelete: "RESTRICT" },
    { table: "invite_codes", from: "invite_code_id", to: "id", onDelete: "SET NULL" },
  ],
  referral_conversions: [
    { table: "users", from: "referrer_user_id", to: "id", onDelete: "RESTRICT" },
    { table: "users", from: "referred_user_id", to: "id", onDelete: "RESTRICT" },
    { table: "referral_attributions", from: "referral_attribution_id", to: "id", onDelete: "RESTRICT" },
    { table: "activation_codes", from: "activation_code_id", to: "id", onDelete: "RESTRICT" },
    { table: "token_activation_bindings", from: "token_activation_id", to: "id", onDelete: "SET NULL" },
    { table: "users", from: "paid_by", to: "id", onDelete: "SET NULL" },
  ],
};

const matchesExpectedForeignKeys = (tableName, expectedList) => {
  const actual = getForeignKeyList(tableName);
  if (actual.length !== expectedList.length) {
    return false;
  }
  return expectedList.every((expected) =>
    actual.some((row) =>
      row.table === expected.table
      && row.from === expected.from
      && row.to === expected.to
      && row.onDelete === expected.onDelete));
};

const needsReferralForeignKeyRebuild = () =>
  Object.entries(EXPECTED_REFERRAL_FOREIGN_KEYS).some(([tableName, expectedList]) =>
    tableExists(tableName) && !matchesExpectedForeignKeys(tableName, expectedList));

const ensureReferralIndexes = () => {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_profiles_user_id ON referral_profiles(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_profiles_referral_code ON referral_profiles(referral_code);
    CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer_user_id ON referral_attributions(referrer_user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_attributions_referred_user_id ON referral_attributions(referred_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_attributions_referral_profile_id ON referral_attributions(referral_profile_id);
    CREATE INDEX IF NOT EXISTS idx_referral_attributions_registered_at ON referral_attributions(registered_at);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_referrer_user_id ON referral_conversions(referrer_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_referred_user_id ON referral_conversions(referred_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_referral_attribution_id ON referral_conversions(referral_attribution_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_activation_code_id ON referral_conversions(activation_code_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_reward_status ON referral_conversions(reward_status);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_created_at ON referral_conversions(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_settlements_conversion_id ON referral_settlements(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_referral_settlements_settled_at ON referral_settlements(settled_at);
    CREATE INDEX IF NOT EXISTS idx_referral_settlements_settled_by ON referral_settlements(settled_by);
  `);
};

const rebuildReferralTablesWithSafeForeignKeys = () => {
  const foreignKeysWereEnabled = Number(db.pragma("foreign_keys", { simple: true }) || 0) === 1;
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS referral_conversions_new;
        DROP TABLE IF EXISTS referral_attributions_new;
        DROP TABLE IF EXISTS referral_profiles_new;

        CREATE TABLE referral_profiles_new (
          id TEXT PRIMARY KEY,
          user_id TEXT UNIQUE NOT NULL,
          referral_code TEXT UNIQUE NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
        );

        INSERT INTO referral_profiles_new (
          id, user_id, referral_code, created_at, updated_at, generated_at
        )
        SELECT
          id, user_id, referral_code, created_at, updated_at, generated_at
        FROM referral_profiles;

        CREATE TABLE referral_attributions_new (
          id TEXT PRIMARY KEY,
          referrer_user_id TEXT NOT NULL,
          referred_user_id TEXT UNIQUE NOT NULL,
          referral_profile_id TEXT NOT NULL,
          referral_code_snapshot TEXT NOT NULL,
          invite_code_id TEXT,
          invite_code_mask TEXT,
          registered_at TEXT NOT NULL,
          register_ip TEXT,
          register_user_agent TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY (referral_profile_id) REFERENCES referral_profiles_new(id) ON DELETE RESTRICT,
          FOREIGN KEY (invite_code_id) REFERENCES invite_codes(id) ON DELETE SET NULL
        );

        INSERT INTO referral_attributions_new (
          id, referrer_user_id, referred_user_id, referral_profile_id,
          referral_code_snapshot, invite_code_id, invite_code_mask,
          registered_at, register_ip, register_user_agent, created_at, updated_at
        )
        SELECT
          id, referrer_user_id, referred_user_id, referral_profile_id,
          referral_code_snapshot, invite_code_id, invite_code_mask,
          registered_at, register_ip, register_user_agent, created_at, updated_at
        FROM referral_attributions;

        CREATE TABLE referral_conversions_new (
          id TEXT PRIMARY KEY,
          referrer_user_id TEXT NOT NULL,
          referred_user_id TEXT NOT NULL,
          referral_attribution_id TEXT NOT NULL,
          activation_code_id TEXT NOT NULL,
          token_activation_id TEXT,
          conversion_type TEXT NOT NULL,
          feature_scope TEXT NOT NULL,
          duration_months INTEGER NOT NULL,
          gross_amount_cents INTEGER NOT NULL DEFAULT 0,
          reward_rate_bps INTEGER NOT NULL DEFAULT 0,
          reward_amount_cents INTEGER NOT NULL DEFAULT 0,
          reward_status TEXT NOT NULL DEFAULT 'pending',
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          paid_at TEXT,
          paid_by TEXT,
          FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY (referral_attribution_id) REFERENCES referral_attributions_new(id) ON DELETE RESTRICT,
          FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id) ON DELETE RESTRICT,
          FOREIGN KEY (token_activation_id) REFERENCES token_activation_bindings(id) ON DELETE SET NULL,
          FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL
        );

        INSERT INTO referral_conversions_new (
          id, referrer_user_id, referred_user_id, referral_attribution_id,
          activation_code_id, token_activation_id, conversion_type, feature_scope,
          duration_months, gross_amount_cents, reward_rate_bps, reward_amount_cents,
          reward_status, note, created_at, updated_at, paid_at, paid_by
        )
        SELECT
          id, referrer_user_id, referred_user_id, referral_attribution_id,
          activation_code_id, token_activation_id, conversion_type, feature_scope,
          duration_months, gross_amount_cents, reward_rate_bps, reward_amount_cents,
          reward_status, note, created_at, updated_at, paid_at, paid_by
        FROM referral_conversions;

        DROP TABLE referral_conversions;
        DROP TABLE referral_attributions;
        DROP TABLE referral_profiles;

        ALTER TABLE referral_profiles_new RENAME TO referral_profiles;
        ALTER TABLE referral_attributions_new RENAME TO referral_attributions;
        ALTER TABLE referral_conversions_new RENAME TO referral_conversions;
      `);
    })();
  } finally {
    if (foreignKeysWereEnabled) {
      db.pragma("foreign_keys = ON");
    }
  }

  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    throw new Error("Referral foreign key rebuild failed integrity check");
  }

  ensureReferralIndexes();
};

const createSchema = () => {
  const hasColumn = (tableName, columnName) => {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return rows.some((row) => String(row.name || "").toLowerCase() === String(columnName).toLowerCase());
  };
  const buildAccountSeed = () => {
    const raw = crypto.randomBytes(8).toString("hex").toUpperCase();
    return raw.match(/.{1,4}/g)?.join("-") || raw;
  };
  const buildUserAccountDisplayId = () => {
    const raw = crypto.randomBytes(8).toString("hex").toUpperCase();
    return raw.match(/.{1,4}/g)?.join("-") || raw;
  };
  const buildRoleIndex = (roleIndex) => {
    const text = String(roleIndex ?? "").trim();
    if (!text) return "";
    const num = Number(text);
    if (!Number.isFinite(num)) return "";
    return String(Math.max(0, Math.floor(num)));
  };
  const buildAccountIdentity = ({ sessId, region, roleId, roleName }) => {
    const normalizedSessId = String(sessId || "").trim().slice(0, 256);
    const normalizedRegion = String(region || "").trim() || "未知大区";
    const normalizedRoleId = String(roleId || "").trim();
    const normalizedRoleName = String(roleName || "").trim() || "未命名角色";
    return `${normalizedSessId}|${normalizedRoleId}|${normalizedRegion}|${normalizedRoleName}`;
  };
  const buildAccountSignature = ({ accountIdentity, accountSeed }) =>
    crypto.createHash("sha256").update(`${accountIdentity}|${accountSeed}`).digest("hex");
  const normalizeSecretCode = (value) => String(value || "").trim().toUpperCase();
  const hmacCode = (pepper, value) =>
    crypto.createHmac("sha256", String(pepper || ""))
      .update(normalizeSecretCode(value))
      .digest("hex");
  const codeSuffix = (value) => normalizeSecretCode(value).slice(-4);
  const maskedCode = (value, prefixFallback) => {
    const normalized = normalizeSecretCode(value);
    if (!normalized) return `${prefixFallback}-****`;
    const [prefixRaw] = normalized.split("-", 1);
    const prefix = String(prefixRaw || prefixFallback).trim() || prefixFallback;
    return `${prefix}-****-${codeSuffix(normalized) || "****"}`;
  };
  const backfillCodeSecrets = ({
    tableName,
    pepper,
    prefixFallback,
    codeColumn = "code",
  }) => {
    const selectSql = `
      SELECT id, ${codeColumn} as legacyCode, code_hmac as codeHmac
      FROM ${tableName}
    `;
    const rows = db.prepare(selectSql).all();
    const updateStmt = db.prepare(`
      UPDATE ${tableName}
      SET code = $storedCode,
          code_hmac = $codeHmac,
          code_suffix = $codeSuffix,
          code_mask = $codeMask
      WHERE id = $id
    `);

    rows.forEach((row) => {
      const legacyCode = String(row.legacyCode || "").trim();
      const existingHmac = String(row.codeHmac || "").trim();
      if (!legacyCode || legacyCode.includes("-redacted:")) {
        return;
      }
      const computedHmac = hmacCode(pepper, legacyCode);
      if (existingHmac === computedHmac) {
        updateStmt.run({
          id: row.id,
          storedCode: `${prefixFallback.toLowerCase()}-redacted:${row.id}`,
          codeHmac: computedHmac,
          codeSuffix: codeSuffix(legacyCode),
          codeMask: maskedCode(legacyCode, prefixFallback),
        });
        return;
      }
      updateStmt.run({
        id: row.id,
        storedCode: `${prefixFallback.toLowerCase()}-redacted:${row.id}`,
        codeHmac: computedHmac,
        codeSuffix: codeSuffix(legacyCode),
        codeMask: maskedCode(legacyCode, prefixFallback),
      });
    });
  };

  // better-sqlite3 的 exec 用于运行多条语句
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      mfa_totp_secret_enc TEXT,
      mfa_recovery_codes_hash TEXT,
      account_display_id TEXT,
      access_scope TEXT NOT NULL DEFAULT 'full',
      token_bind_limit INTEGER NOT NULL DEFAULT 999,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      server TEXT NOT NULL,
      profession TEXT NOT NULL,
      level INTEGER NOT NULL,
      account_enc TEXT,
      note_enc TEXT,
      avatar TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      exp INTEGER NOT NULL DEFAULT 0,
      gold INTEGER NOT NULL DEFAULT 1000,
      vip INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      task_key TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_execute INTEGER NOT NULL DEFAULT 0,
      delay_seconds INTEGER NOT NULL DEFAULT 0,
      notification INTEGER NOT NULL DEFAULT 1,
      cron_expr TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(role_id, task_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      task_config_id TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      run_at TEXT NOT NULL,
      source TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (task_config_id) REFERENCES task_configs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      code_hmac TEXT UNIQUE,
      code_suffix TEXT,
      code_mask TEXT,
      created_by TEXT NOT NULL,
      used_by TEXT,
      used_at TEXT,
      expires_at TEXT,
      feature_scope TEXT NOT NULL DEFAULT 'full',
      bind_account_limit INTEGER NOT NULL DEFAULT 1,
      bind_account_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT NOT NULL,
      pref_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, pref_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resource_change_logs (
      user_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, scope_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_control_states (
      user_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_control_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT,
      task_name TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      code_hmac TEXT UNIQUE,
      code_suffix TEXT,
      code_mask TEXT,
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      detail_json TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS security_rate_limits (
      scope_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at TEXT NOT NULL,
      block_until TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_note TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_version INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      replaced_by_id TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      created_ip TEXT,
      created_user_agent TEXT,
      last_used_ip TEXT,
      last_used_user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bin_download_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_ip TEXT,
      used_user_agent TEXT,
      created_ip TEXT,
      created_user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bin_download_audits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL,
      message TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS security_event_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_type TEXT NOT NULL,
      detail_json TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS activation_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      code_hmac TEXT UNIQUE,
      code_suffix TEXT,
      code_mask TEXT,
      created_by TEXT NOT NULL,
      feature_scope TEXT NOT NULL DEFAULT 'full',
      duration_months INTEGER NOT NULL,
      sale_amount_cents INTEGER NOT NULL DEFAULT 0,
      sale_currency TEXT NOT NULL DEFAULT 'CNY',
      used_by TEXT,
      used_at TEXT,
      bound_token_id TEXT,
      bound_game_account_id TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS token_activation_bindings (
      id TEXT PRIMARY KEY,
      token_id TEXT NOT NULL,
      game_account_id TEXT NOT NULL,
      role_name TEXT,
      region TEXT,
      role_index TEXT,
      account_identity TEXT,
      account_seed TEXT,
      account_signature TEXT,
      user_id TEXT NOT NULL,
      activation_code_id TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(token_id, game_account_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS referral_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      referral_code TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS referral_attributions (
      id TEXT PRIMARY KEY,
      referrer_user_id TEXT NOT NULL,
      referred_user_id TEXT UNIQUE NOT NULL,
      referral_profile_id TEXT NOT NULL,
      referral_code_snapshot TEXT NOT NULL,
      invite_code_id TEXT,
      invite_code_mask TEXT,
      registered_at TEXT NOT NULL,
      register_ip TEXT,
      register_user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (referral_profile_id) REFERENCES referral_profiles(id) ON DELETE RESTRICT,
      FOREIGN KEY (invite_code_id) REFERENCES invite_codes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS referral_conversions (
      id TEXT PRIMARY KEY,
      referrer_user_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      referral_attribution_id TEXT NOT NULL,
      activation_code_id TEXT NOT NULL,
      token_activation_id TEXT,
      conversion_type TEXT NOT NULL,
      feature_scope TEXT NOT NULL,
      duration_months INTEGER NOT NULL,
      gross_amount_cents INTEGER NOT NULL DEFAULT 0,
      reward_rate_bps INTEGER NOT NULL DEFAULT 0,
      reward_amount_cents INTEGER NOT NULL DEFAULT 0,
      reward_status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paid_at TEXT,
      paid_by TEXT,
      FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (referral_attribution_id) REFERENCES referral_attributions(id) ON DELETE RESTRICT,
      FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id) ON DELETE RESTRICT,
      FOREIGN KEY (token_activation_id) REFERENCES token_activation_bindings(id) ON DELETE SET NULL,
      FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS referral_settlements (
      id TEXT PRIMARY KEY,
      conversion_id TEXT NOT NULL UNIQUE,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      channel TEXT NOT NULL,
      settlement_ref TEXT,
      note TEXT,
      settled_by TEXT,
      settled_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversion_id) REFERENCES referral_conversions(id) ON DELETE RESTRICT,
      FOREIGN KEY (settled_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS wechat_contacts (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      contact_type TEXT NOT NULL,
      target_url TEXT,
      wechat_id TEXT,
      qr_image_data_url TEXT,
      show_in_pricing INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_roles_user_id ON roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_role_id ON task_configs(role_id);
    CREATE INDEX IF NOT EXISTS idx_task_runs_role_id ON task_runs(role_id);
    CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);
    CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
    CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
    CREATE INDEX IF NOT EXISTS idx_resource_change_logs_user_id ON resource_change_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_task_control_logs_user_id ON task_control_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_task_control_logs_created_at ON task_control_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_id ON password_reset_codes(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_codes_code ON password_reset_codes(code);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_user_id ON admin_audit_logs(admin_user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_security_rate_limits_reset_at ON security_rate_limits(reset_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_items_user_id ON feedback_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_items_status ON feedback_items(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_items_created_at ON feedback_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_notifications_is_read ON user_notifications(is_read);
    CREATE INDEX IF NOT EXISTS idx_user_notifications_created_at ON user_notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked_at ON refresh_tokens(revoked_at);
    CREATE INDEX IF NOT EXISTS idx_bin_download_tickets_user_id ON bin_download_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_bin_download_tickets_token_id ON bin_download_tickets(token_id);
    CREATE INDEX IF NOT EXISTS idx_bin_download_tickets_expires_at ON bin_download_tickets(expires_at);
    CREATE INDEX IF NOT EXISTS idx_bin_download_tickets_used_at ON bin_download_tickets(used_at);
    CREATE INDEX IF NOT EXISTS idx_bin_download_audits_user_id ON bin_download_audits(user_id);
    CREATE INDEX IF NOT EXISTS idx_bin_download_audits_token_id ON bin_download_audits(token_id);
    CREATE INDEX IF NOT EXISTS idx_bin_download_audits_created_at ON bin_download_audits(created_at);
    CREATE INDEX IF NOT EXISTS idx_security_event_logs_user_id ON security_event_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_security_event_logs_event_type ON security_event_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_security_event_logs_created_at ON security_event_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON activation_codes(code);
    CREATE INDEX IF NOT EXISTS idx_activation_codes_created_by ON activation_codes(created_by);
    CREATE INDEX IF NOT EXISTS idx_activation_codes_used_by ON activation_codes(used_by);
    CREATE INDEX IF NOT EXISTS idx_activation_codes_created_at ON activation_codes(created_at);
    CREATE INDEX IF NOT EXISTS idx_token_activation_bindings_user_id ON token_activation_bindings(user_id);
    CREATE INDEX IF NOT EXISTS idx_token_activation_bindings_token_id ON token_activation_bindings(token_id);
    CREATE INDEX IF NOT EXISTS idx_token_activation_bindings_game_account_id ON token_activation_bindings(game_account_id);
    CREATE INDEX IF NOT EXISTS idx_token_activation_bindings_expires_at ON token_activation_bindings(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_profiles_user_id ON referral_profiles(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_profiles_referral_code ON referral_profiles(referral_code);
    CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer_user_id ON referral_attributions(referrer_user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_attributions_referred_user_id ON referral_attributions(referred_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_attributions_referral_profile_id ON referral_attributions(referral_profile_id);
    CREATE INDEX IF NOT EXISTS idx_referral_attributions_registered_at ON referral_attributions(registered_at);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_referrer_user_id ON referral_conversions(referrer_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_referred_user_id ON referral_conversions(referred_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_referral_attribution_id ON referral_conversions(referral_attribution_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_activation_code_id ON referral_conversions(activation_code_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_reward_status ON referral_conversions(reward_status);
    CREATE INDEX IF NOT EXISTS idx_referral_conversions_created_at ON referral_conversions(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_settlements_conversion_id ON referral_settlements(conversion_id);
    CREATE INDEX IF NOT EXISTS idx_referral_settlements_settled_at ON referral_settlements(settled_at);
    CREATE INDEX IF NOT EXISTS idx_referral_settlements_settled_by ON referral_settlements(settled_by);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wechat_contacts_slug ON wechat_contacts(slug);
    CREATE INDEX IF NOT EXISTS idx_wechat_contacts_is_active ON wechat_contacts(is_active);
    CREATE INDEX IF NOT EXISTS idx_wechat_contacts_show_in_pricing ON wechat_contacts(show_in_pricing);
    CREATE INDEX IF NOT EXISTS idx_wechat_contacts_sort_order ON wechat_contacts(sort_order);
  `);

  // 兼容旧库：补充管理员字段。
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN nickname TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN trial_expires_at TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE activation_codes ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_activation_codes_is_deleted ON activation_codes(is_deleted);`);
  } catch {
    // ignore: may fail on very old/inconsistent dbs
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'full';`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN token_bind_limit INTEGER NOT NULL DEFAULT 999;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN mfa_totp_secret_enc TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN mfa_recovery_codes_hash TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("users", "mfa_enabled")) {
    db.exec(`ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!hasColumn("users", "mfa_totp_secret_enc")) {
    db.exec(`ALTER TABLE users ADD COLUMN mfa_totp_secret_enc TEXT;`);
  }
  if (!hasColumn("users", "mfa_recovery_codes_hash")) {
    db.exec(`ALTER TABLE users ADD COLUMN mfa_recovery_codes_hash TEXT;`);
  }
  try {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN feature_scope TEXT NOT NULL DEFAULT 'full';`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN bind_account_limit INTEGER NOT NULL DEFAULT 1;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN bind_account_count INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN code_hmac TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN code_suffix TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE invite_codes ADD COLUMN code_mask TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE password_reset_codes ADD COLUMN code_hmac TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE password_reset_codes ADD COLUMN code_suffix TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE password_reset_codes ADD COLUMN code_mask TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE activation_codes ADD COLUMN code_hmac TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE activation_codes ADD COLUMN code_suffix TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE activation_codes ADD COLUMN code_mask TEXT;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE activation_codes ADD COLUMN feature_scope TEXT NOT NULL DEFAULT 'full';`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE activation_codes ADD COLUMN sale_amount_cents INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE activation_codes ADD COLUMN sale_currency TEXT NOT NULL DEFAULT 'CNY';`);
  } catch {
    // ignore: column already exists
  }
  try {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN role_name TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("token_activation_bindings", "role_name")) {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN role_name TEXT;`);
  }
  try {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN region TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("token_activation_bindings", "region")) {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN region TEXT;`);
  }
  try {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN role_index TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("token_activation_bindings", "role_index")) {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN role_index TEXT;`);
  }
  try {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN account_identity TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("token_activation_bindings", "account_identity")) {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN account_identity TEXT;`);
  }
  try {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN account_seed TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("token_activation_bindings", "account_seed")) {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN account_seed TEXT;`);
  }
  try {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN account_signature TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("token_activation_bindings", "account_signature")) {
    db.exec(`ALTER TABLE token_activation_bindings ADD COLUMN account_signature TEXT;`);
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN account_display_id TEXT;`);
  } catch {
    // ignore: column already exists
  }
  if (!hasColumn("users", "account_display_id")) {
    db.exec(`ALTER TABLE users ADD COLUMN account_display_id TEXT;`);
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_token_activation_bindings_account_identity ON token_activation_bindings(account_identity);`);
  } catch {
    // ignore: may fail on very old/inconsistent dbs
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_display_id ON users(account_display_id);`);
  } catch {
    // ignore: may fail on very old/inconsistent dbs
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_token_activation_bindings_region ON token_activation_bindings(region);`);
  } catch {
    // ignore: may fail on very old/inconsistent dbs
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_token_activation_bindings_role_index ON token_activation_bindings(role_index);`);
  } catch {
    // ignore: may fail on very old/inconsistent dbs
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_code_hmac_unique ON invite_codes(code_hmac);`);
  } catch {
    // ignore
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_codes_code_hmac_unique ON password_reset_codes(code_hmac);`);
  } catch {
    // ignore
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_codes_code_hmac_unique ON activation_codes(code_hmac);`);
  } catch {
    // ignore
  }

  if (needsReferralForeignKeyRebuild()) {
    rebuildReferralTablesWithSafeForeignKeys();
  } else {
    ensureReferralIndexes();
  }

  backfillCodeSecrets({
    tableName: "invite_codes",
    pepper: env.inviteCodePepper,
    prefixFallback: "INV",
  });
  backfillCodeSecrets({
    tableName: "password_reset_codes",
    pepper: env.passwordResetCodePepper,
    prefixFallback: "RST",
  });
  backfillCodeSecrets({
    tableName: "activation_codes",
    pepper: env.activationCodePepper,
    prefixFallback: "ACT",
  });

  const activationRows = db.prepare(
    `SELECT id, game_account_id, role_name, region, role_index, account_identity, account_seed
     FROM token_activation_bindings`,
  ).all();
  const updateActivationBindingStmt = db.prepare(
    `UPDATE token_activation_bindings
     SET role_name = @roleName,
         region = @region,
         role_index = @roleIndex,
         account_identity = @accountIdentity,
         account_seed = @accountSeed,
         account_signature = @accountSignature
     WHERE id = @id`,
  );
  for (const row of activationRows) {
    const roleName = String(row.role_name || "").trim() || "未命名角色";
    const region = String(row.region || "").trim() || "未知大区";
    const roleId = String(row.game_account_id || "").trim();
    const roleIndex = buildRoleIndex(row.role_index);
    const accountIdentity = buildAccountIdentity({
      sessId: "",
      region,
      roleId,
      roleName,
    });
    const accountSeed = String(row.account_seed || "").trim() || buildAccountSeed();
    const accountSignature = buildAccountSignature({ accountIdentity, accountSeed });
    updateActivationBindingStmt.run({
      id: String(row.id || "").trim(),
      roleName,
      region,
      roleIndex,
      accountIdentity,
      accountSeed,
      accountSignature,
    });
  }

  const userRows = db.prepare(
    `SELECT id, account_display_id
     FROM users`,
  ).all();
  const updateUserAccountDisplayIdStmt = db.prepare(
    `UPDATE users
     SET account_display_id = @accountDisplayId
     WHERE id = @id`,
  );
  for (const row of userRows) {
    if (String(row.account_display_id || "").trim()) {
      continue;
    }
    updateUserAccountDisplayIdStmt.run({
      id: String(row.id || "").trim(),
      accountDisplayId: buildUserAccountDisplayId(),
    });
  }
};

export const getDb = () => {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
};

// better-sqlite3 自动持久化到磁盘，不再需要手动调用 persist
export const persist = () => {};

export const withTransaction = (fn) => {
  const currentDb = getDb();
  return currentDb.transaction(fn)(currentDb);
};
