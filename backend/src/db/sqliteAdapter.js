import fs from "fs";
import path from "path";
import process from "process";
import { env } from "../config/env.js";
import { getDb } from "./database.js";
import {
  SQLITE_OWNER_ONLY_DIR_MODE,
  SQLITE_OWNER_ONLY_FILE_MODE,
  ensureSqliteFileSecure,
  ensureSqliteRuntimePathsSecure,
  getSqliteBackupDir,
} from "./runtimeSecurity.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SENSITIVE_KEYWORDS = ["password", "token", "secret", "code", "cookie", "authorization"];
let backupTimer = null;
let backupHandle = null;

const getBackupDir = () => getSqliteBackupDir(env.dbPath);
const getWriteSafetyLogPath = () =>
  path.resolve(path.dirname(path.resolve(env.dbPath)), "db-write-safety.log");

const ensureDir = (filePath, mode = SQLITE_OWNER_ONLY_DIR_MODE) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode });
  }
};

const appendWriteSafetyLog = (entry) => {
  if (!env.dbWriteSafetyLogEnabled) {
    return;
  }

  const writeSafetyLogPath = getWriteSafetyLogPath();

  try {
    ensureDir(writeSafetyLogPath, SQLITE_OWNER_ONLY_DIR_MODE);
    if (!fs.existsSync(writeSafetyLogPath)) {
      fs.writeFileSync(writeSafetyLogPath, "", {
        encoding: "utf8",
        mode: SQLITE_OWNER_ONLY_FILE_MODE,
      });
    } else {
      const mode = fs.statSync(writeSafetyLogPath).mode & 0o777;
      if (mode !== SQLITE_OWNER_ONLY_FILE_MODE) {
        fs.chmodSync(writeSafetyLogPath, SQLITE_OWNER_ONLY_FILE_MODE);
      }
    }
    fs.appendFileSync(writeSafetyLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // ignore logging failure
  }
};

const isSensitiveKey = (key) => SENSITIVE_KEYWORDS.some((keyword) => key.includes(keyword));

const truncateString = (value) => {
  if (typeof value !== "string") return value;
  if (value.length <= env.dbWriteSafetyParamMaxLen) return value;
  return `${value.slice(0, env.dbWriteSafetyParamMaxLen)}...(truncated)`;
};

const sanitizeParamValue = (key, value) => {
  const normalizedKey = String(key || "").toLowerCase();
  if (isSensitiveKey(normalizedKey)) {
    return "[redacted]";
  }
  if (value === undefined || value === null) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return "[buffer]";
  }
  if (Array.isArray(value)) {
    return "[array]";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `[${typeof value}]`;
  }
  if (typeof value === "string") {
    return "[string]";
  }
  return "[object]";
};

const sanitizeParams = (params) => {
  if (params === undefined || params === null) {
    return null;
  }
  if (Array.isArray(params)) {
    return params.map((value, index) => sanitizeParamValue(String(index), value));
  }
  if (typeof params !== "object") {
    return sanitizeParamValue("value", params);
  }
  const out = {};
  Object.keys(params).forEach((key) => {
    out[key] = sanitizeParamValue(key, params[key]);
  });
  return out;
};

const extractWriteMeta = (sql = "") => {
  const source = String(sql || "").trim();
  const normalized = source.replace(/\s+/g, " ");
  const patterns = [
    { op: "insert", regex: /^insert\s+into\s+["`[]?([a-zA-Z0-9_$.]+)["`\]]?/i },
    { op: "update", regex: /^update\s+["`[]?([a-zA-Z0-9_$.]+)["`\]]?/i },
    { op: "delete", regex: /^delete\s+from\s+["`[]?([a-zA-Z0-9_$.]+)["`\]]?/i },
    { op: "replace", regex: /^replace\s+into\s+["`[]?([a-zA-Z0-9_$.]+)["`\]]?/i },
  ];

  for (const candidate of patterns) {
    const matched = normalized.match(candidate.regex);
    if (matched) {
      return { op: candidate.op, table: String(matched[1] || "").toLowerCase() || "unknown" };
    }
  }
  return { op: "write", table: "unknown" };
};

const shouldLogParamsForTable = (table) => {
  if (!table || table === "unknown") {
    return false;
  }
  return env.dbWriteSafetyParamsTables.includes(table);
};

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const normalizeBindingParams = (params) => {
  if (params === undefined || params === null) {
    return params;
  }
  if (Array.isArray(params)) {
    return params;
  }
  if (typeof params !== "object") {
    return params;
  }

  const normalized = {};
  Object.keys(params).forEach((key) => {
    const normalizedKey = String(key).replace(/^[$:@]/, "");
    normalized[normalizedKey] = params[key];
  });
  return normalized;
};

const shouldBindParams = (params) => {
  if (params === undefined || params === null) {
    return false;
  }
  if (Array.isArray(params)) {
    return params.length > 0;
  }
  if (typeof params === "object") {
    return Object.keys(params).length > 0;
  }
  return true;
};

export const backup = (reason = "manual") => {
  if (!env.appDbBackupEnabled) {
    return null;
  }
  if (!fs.existsSync(env.dbPath)) {
    return null;
  }

  const runtimePaths = ensureSqliteRuntimePathsSecure({
    dbPath: env.dbPath,
    binStoragePath: env.binStoragePath,
    appDbBackupEnabled: env.appDbBackupEnabled,
    nodeEnv: env.nodeEnv,
    platform: process.platform,
    fsModule: fs,
    consoleRef: console,
  });
  const targetPath = path.join(
    runtimePaths.backupDir,
    `xyzw-${reason}-${nowStamp()}.sqlite.bin`,
  );

  fs.copyFileSync(env.dbPath, targetPath);
  ensureSqliteFileSecure({
    targetPath,
    label: "SQLite 备份文件",
    nodeEnv: env.nodeEnv,
    platform: process.platform,
    fsModule: fs,
    consoleRef: console,
  });
  return targetPath;
};

export const scheduleDailyBackup = () => {
  if (!env.appDbBackupEnabled) {
    return null;
  }
  if (backupTimer) {
    return backupHandle;
  }

  backupTimer = setInterval(() => {
    try {
      backup("daily");
    } catch (error) {
      appendWriteSafetyLog({
        type: "backup-error",
        at: new Date().toISOString(),
        reason: "daily",
        message: error.message,
      });
    }
  }, DAY_MS);

  if (typeof backupTimer.unref === "function") {
    backupTimer.unref();
  }

  backupHandle = {
    stop: () => {
      if (!backupTimer) {
        return;
      }
      clearInterval(backupTimer);
      backupTimer = null;
      backupHandle = null;
    },
    isScheduled: () => Boolean(backupTimer),
  };

  return backupHandle;
};

export const query = (sql, params = {}) => {
  const db = getDb();
  try {
    const stmt = db.prepare(sql);
    const bindingParams = normalizeBindingParams(params);
    if (!shouldBindParams(bindingParams)) {
      return stmt.all();
    }
    return stmt.all(bindingParams);
  } catch (error) {
    console.error(`[db-query-error] SQL: ${sql}`, error);
    throw error;
  }
};

export const run = (sql, params = {}) => {
  const db = getDb();
  const at = new Date().toISOString();
  const { op, table } = extractWriteMeta(sql);
  const shouldLogParams = shouldLogParamsForTable(table);
  const entry = {
    type: "write-intent",
    at,
    op,
    table,
    paramCount: Array.isArray(params)
      ? params.length
      : (params && typeof params === "object" ? Object.keys(params).length : (params == null ? 0 : 1)),
  };
  if (env.dbWriteSafetyIncludeSql) {
    entry.sql = truncateString(String(sql || "").replace(/\s+/g, " ").trim());
  }
  if (shouldLogParams) {
    entry.params = sanitizeParams(params);
  }
  appendWriteSafetyLog(entry);

  try {
    const stmt = db.prepare(sql);
    const bindingParams = normalizeBindingParams(params);
    if (!shouldBindParams(bindingParams)) {
      const info = stmt.run();
      appendWriteSafetyLog({
        type: "write-success",
        at: new Date().toISOString(),
        op,
        table,
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid,
      });
      return { success: true, changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    }

    const info = stmt.run(bindingParams);
    appendWriteSafetyLog({
      type: "write-success",
      at: new Date().toISOString(),
      op,
      table,
      changes: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    });
    return { success: true, changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  } catch (error) {
    const failedEntry = {
      type: "write-failed",
      at: new Date().toISOString(),
      op,
      table,
      message: error.message,
    };
    if (env.dbWriteSafetyIncludeSql) {
      failedEntry.sql = truncateString(String(sql || "").replace(/\s+/g, " ").trim());
    }
    if (shouldLogParams) {
      failedEntry.params = sanitizeParams(params);
    }
    appendWriteSafetyLog(failedEntry);
    console.error(`[db-run-error] SQL: ${sql}`, error);
    throw error;
  }
};

export const transaction = (work) => {
  const db = getDb();
  return db.transaction(() => work({ query, run }))();
};

export const persist = () => {};
