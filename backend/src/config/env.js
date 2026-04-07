import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  LOOPBACK_HOST_ALLOWLIST,
  matchesAllowedHost,
  parseHostPatterns,
} from "../lib/hostAllowlist.js";
import { normalizeHttpOrigin } from "../lib/origin.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const backendRoot = path.resolve(currentDir, "..", "..");
const backendEnvPath = path.join(backendRoot, ".env");
dotenv.config({ path: backendEnvPath });

const resolveBackendPath = (input, fallback) => {
  const raw = String(input || "").trim();
  if (!raw) {
    return fallback;
  }
  return path.isAbsolute(raw) ? raw : path.resolve(backendRoot, raw);
};

const isBlank = (value) => String(value || "").trim().length === 0;
const parseTrustProxy = (input) => {
  const raw = String(input || "").trim();
  if (!raw) {
    return "loopback, linklocal, uniquelocal";
  }

  const normalized = raw.toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
};

const parseBoolean = (input, fallback = false) => {
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  return fallback;
};

const parseCsv = (input) =>
  String(input || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const parseProductionDefaultFalse = (input, developmentFallback = true) => {
  const raw = String(input || "").trim();
  if (!raw) {
    return (
      (process.env.NODE_ENV || "development") !== "production" &&
      developmentFallback
    );
  }
  return parseBoolean(raw, false);
};
const parseOptionalCookieDomain = (input) => {
  const value = String(input || "").trim();
  return value.length > 0 ? value : undefined;
};
const parseOptionalOrigin = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const normalized = normalizeHttpOrigin(raw);
  return normalized ? String(normalized.raw || "").replace(/\/+$/, "") : "";
};

const isLoopbackHostname = (hostname) => {
  const normalized = String(hostname || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
};

const validateProductionAppOrigin = (value, label) => {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(
      `${label} must be a valid absolute HTTPS origin in production.`,
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS in production.`);
  }

  if (isLoopbackHostname(url.hostname)) {
    throw new Error(
      `${label} must not use localhost/loopback hosts in production.`,
    );
  }
};

const parsePositiveIntInRange = (input, fallback, min, max) => {
  const value = Number(input);
  if (!Number.isInteger(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
};

const parseFileMode = (input, fallback) => {
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  if (!/^[0-7]{3,4}$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 8);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0o7777) {
    return fallback;
  }
  return parsed;
};

const parseSameSite = (input) => {
  const normalized = String(input || "")
    .trim()
    .toLowerCase();
  if (normalized === "strict") return "strict";
  if (normalized === "none") return "none";
  return "lax";
};

const JWT_PLACEHOLDERS = new Set([
  "replace-me-in-production",
  "replace-with-your-own-long-random-secret",
  "your-jwt-secret",
  "jwt-secret",
]);

const AES_PLACEHOLDERS = new Set([
  "replace-me-with-32-byte-key-material",
  "replace-with-your-own-long-random-secret",
  "your-aes-key",
  "aes-key",
]);

const rawJwtSecret = String(process.env.JWT_SECRET || "").trim();
const rawAesKey = String(process.env.AES_KEY || "").trim();
const rawCsrfSecret = String(process.env.CSRF_SECRET || "").trim();
const rawInviteCodePepper = String(process.env.INVITE_CODE_PEPPER || "").trim();
const rawActivationCodePepper = String(
  process.env.ACTIVATION_CODE_PEPPER || "",
).trim();
const rawPasswordResetCodePepper = String(
  process.env.PASSWORD_RESET_CODE_PEPPER || "",
).trim();
const rawReferralCookieSecret = String(
  process.env.REFERRAL_COOKIE_SECRET || "",
).trim();
const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const defaultCorsOrigins = ["http://localhost:3000"];
const rawTrustedImportApiHosts = String(
  process.env.TRUSTED_IMPORT_API_HOSTS || "",
);
const rawWechatContactExternalUrlAllowlist = String(
  process.env.WECHAT_CONTACT_EXTERNAL_URL_ALLOWLIST || "",
);
const trustedImportApiHostsExplicitlySet =
  rawTrustedImportApiHosts.trim().length > 0;
const defaultTrustedImportApiHosts = isProduction
  ? []
  : LOOPBACK_HOST_ALLOWLIST;
const defaultCspConnectSrc = [
  "https://*.hortorgames.com",
  "wss://*.hortorgames.com",
];
const corsOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const corsOriginsExplicitlySet = corsOrigins.length > 0;
const cspConnectSrc = String(process.env.CSP_CONNECT_SRC || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const trustedImportApiHosts = parseHostPatterns(rawTrustedImportApiHosts);
const wechatContactExternalUrlAllowlist = parseHostPatterns(
  rawWechatContactExternalUrlAllowlist,
);
const dbWriteSafetyParamsTables = parseCsv(
  process.env.DB_WRITE_SAFETY_PARAMS_TABLES,
).map((item) => item.toLowerCase());
const protectedAdminIdentities = String(
  process.env.PROTECTED_ADMIN_IDENTITIES || "",
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const dbPath = resolveBackendPath(
  process.env.DB_PATH,
  path.resolve(backendRoot, "data", "xyzw.sqlite.bin"),
);
const binStoragePath = resolveBackendPath(
  process.env.BIN_STORAGE_PATH,
  path.resolve(backendRoot, "data", "bin-storage"),
);
const backendErrorLogPath = resolveBackendPath(
  process.env.BACKEND_ERROR_LOG_PATH,
  path.resolve(backendRoot, "data", "backend-errors.log"),
);
const refreshCookieSecure = parseBoolean(
  process.env.REFRESH_COOKIE_SECURE,
  (process.env.NODE_ENV || "development") === "production",
);
const accessCookieDomain = parseOptionalCookieDomain(
  process.env.ACCESS_COOKIE_DOMAIN,
);
const refreshCookieDomain = parseOptionalCookieDomain(
  process.env.REFRESH_COOKIE_DOMAIN,
);
const csrfCookieDomain = parseOptionalCookieDomain(
  process.env.CSRF_COOKIE_DOMAIN,
);
let refreshCookieSameSite = parseSameSite(process.env.REFRESH_COOKIE_SAMESITE);
if (refreshCookieSameSite === "none" && !refreshCookieSecure) {
  refreshCookieSameSite = "lax";
  // eslint-disable-next-line no-console
  console.warn(
    "[startup-check] REFRESH_COOKIE_SAMESITE=none requires secure cookie, fallback to lax",
  );
}
const csrfCookieSecure = parseBoolean(
  process.env.CSRF_COOKIE_SECURE,
  refreshCookieSecure,
);
let csrfCookieSameSite = parseSameSite(process.env.CSRF_COOKIE_SAMESITE);
if (csrfCookieSameSite === "none" && !csrfCookieSecure) {
  csrfCookieSameSite = "lax";
  // eslint-disable-next-line no-console
  console.warn(
    "[startup-check] CSRF_COOKIE_SAMESITE=none requires secure cookie, fallback to lax",
  );
}

const defaultCsrfCookieName = csrfCookieSecure
  ? "__Host-xyzw_csrf_token"
  : "xyzw_csrf_token";
const defaultCsrfSessionCookieName = csrfCookieSecure
  ? "__Host-xyzw_csrf_session"
  : "xyzw_csrf_session";
const defaultAccessCookieName = refreshCookieSecure
  ? "__Host-xyzw_access_token"
  : "xyzw_access_token";
let csrfCookieName =
  String(process.env.CSRF_COOKIE_NAME || defaultCsrfCookieName).trim() ||
  defaultCsrfCookieName;
let csrfSessionCookieName =
  String(
    process.env.CSRF_SESSION_COOKIE_NAME || defaultCsrfSessionCookieName,
  ).trim() || defaultCsrfSessionCookieName;
const accessCookieSecure = parseBoolean(
  process.env.ACCESS_COOKIE_SECURE,
  refreshCookieSecure,
);
let accessCookieSameSite = parseSameSite(
  process.env.ACCESS_COOKIE_SAMESITE || refreshCookieSameSite,
);
if (accessCookieSameSite === "none" && !accessCookieSecure) {
  accessCookieSameSite = "lax";
  // eslint-disable-next-line no-console
  console.warn(
    "[startup-check] ACCESS_COOKIE_SAMESITE=none requires secure cookie, fallback to lax",
  );
}
let accessCookieName =
  String(process.env.ACCESS_COOKIE_NAME || defaultAccessCookieName).trim() ||
  defaultAccessCookieName;
const refreshCookieName =
  String(process.env.REFRESH_COOKIE_NAME || "xyzw_refresh_token").trim() ||
  "xyzw_refresh_token";
const accessCookiePath =
  String(process.env.ACCESS_COOKIE_PATH || "/").trim() || "/";
const refreshCookiePath =
  String(process.env.REFRESH_COOKIE_PATH || "/api/v1/auth").trim() ||
  "/api/v1/auth";
if (
  !csrfCookieSecure &&
  (csrfCookieName.startsWith("__Host-") ||
    csrfSessionCookieName.startsWith("__Host-"))
) {
  csrfCookieName = "xyzw_csrf_token";
  csrfSessionCookieName = "xyzw_csrf_session";
  // eslint-disable-next-line no-console
  console.warn(
    "[startup-check] __Host- cookie names require secure=true, fallback to non-prefixed csrf cookie names",
  );
}
if (!accessCookieSecure && accessCookieName.startsWith("__Host-")) {
  accessCookieName = "xyzw_access_token";
  // eslint-disable-next-line no-console
  console.warn(
    "[startup-check] __Host- access cookie name requires secure=true, fallback to xyzw_access_token",
  );
}
if (accessCookieDomain && accessCookieName.startsWith("__Host-")) {
  throw new Error(
    "ACCESS_COOKIE_DOMAIN cannot be used with __Host- prefixed ACCESS_COOKIE_NAME.",
  );
}
if (refreshCookieDomain && refreshCookieName.startsWith("__Host-")) {
  throw new Error(
    "REFRESH_COOKIE_DOMAIN cannot be used with __Host- prefixed REFRESH_COOKIE_NAME.",
  );
}
if (refreshCookieName.startsWith("__Host-") && refreshCookiePath !== "/") {
  throw new Error(
    "REFRESH_COOKIE_PATH must be '/' when REFRESH_COOKIE_NAME uses __Host- prefix.",
  );
}
if (
  csrfCookieDomain &&
  (csrfCookieName.startsWith("__Host-") ||
    csrfSessionCookieName.startsWith("__Host-"))
) {
  throw new Error(
    "CSRF_COOKIE_DOMAIN cannot be used with __Host- prefixed CSRF cookie names.",
  );
}
if (accessCookieName.startsWith("__Host-") && accessCookiePath !== "/") {
  throw new Error(
    "ACCESS_COOKIE_PATH must be '/' when ACCESS_COOKIE_NAME uses __Host- prefix.",
  );
}

export const env = {
  nodeEnv,
  port: Number(process.env.BACKEND_PORT || 8787),
  jwtSecret: rawJwtSecret,
  aesKey: rawAesKey,
  csrfSecret: rawCsrfSecret,
  inviteCodePepper: rawInviteCodePepper,
  activationCodePepper: rawActivationCodePepper,
  passwordResetCodePepper: rawPasswordResetCodePepper,
  referralCookieSecret: rawReferralCookieSecret,
  allowLegacyReferralBodyFallback: parseBoolean(
    process.env.ALLOW_LEGACY_REFERRAL_BODY_FALLBACK,
    false,
  ),
  corsOrigins: corsOrigins.length > 0 ? corsOrigins : defaultCorsOrigins,
  corsOriginsExplicitlySet,
  protectedAdminIdentities,
  publicAppOrigin: parseOptionalOrigin(process.env.PUBLIC_APP_ORIGIN),
  adminAppOrigin: parseOptionalOrigin(process.env.ADMIN_APP_ORIGIN),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  logRequests: (process.env.LOG_REQUESTS || "true") === "true",
  dbWriteSafetyLogEnabled: parseBoolean(
    process.env.DB_WRITE_SAFETY_LOG_ENABLED,
    true,
  ),
  dbWriteSafetyIncludeSql: parseBoolean(
    process.env.DB_WRITE_SAFETY_INCLUDE_SQL,
    false,
  ),
  dbWriteSafetyParamsTables,
  dbWriteSafetyParamMaxLen: parsePositiveIntInRange(
    process.env.DB_WRITE_SAFETY_PARAM_MAX_LEN,
    120,
    32,
    4096,
  ),
  appDbBackupEnabled: parseProductionDefaultFalse(
    process.env.APP_DB_BACKUP_ENABLED,
    true,
  ),
  dbPath,
  binStoragePath,
  backendErrorLogPath,
  backendErrorLogMaxBytes: parsePositiveIntInRange(
    process.env.BACKEND_ERROR_LOG_MAX_BYTES,
    5 * 1024 * 1024,
    64 * 1024,
    1024 * 1024 * 1024,
  ),
  backendErrorLogMaxFiles: parsePositiveIntInRange(
    process.env.BACKEND_ERROR_LOG_MAX_FILES,
    5,
    1,
    20,
  ),
  backendErrorLogFileMode: parseFileMode(
    process.env.BACKEND_ERROR_LOG_FILE_MODE,
    0o600,
  ),
  backendErrorLogDirMode: parseFileMode(
    process.env.BACKEND_ERROR_LOG_DIR_MODE,
    0o700,
  ),
  accessTokenTtlSeconds: parsePositiveIntInRange(
    process.env.ACCESS_TOKEN_TTL_SECONDS,
    10 * 60,
    10 * 60,
    15 * 60,
  ),
  accessTokenExposeInBody: parseBoolean(
    process.env.ACCESS_TOKEN_EXPOSE_IN_BODY,
    false,
  ),
  accessCookieName,
  accessCookiePath,
  accessCookieDomain,
  accessCookieSecure,
  accessCookieSameSite,
  refreshTokenTtlDays: parsePositiveIntInRange(
    process.env.REFRESH_TOKEN_TTL_DAYS,
    14,
    7,
    30,
  ),
  refreshTokenShortTtlDays: parsePositiveIntInRange(
    process.env.REFRESH_TOKEN_SHORT_TTL_DAYS,
    3,
    1,
    7,
  ),
  refreshTokenLongTtlDays: parsePositiveIntInRange(
    process.env.REFRESH_TOKEN_LONG_TTL_DAYS,
    14,
    7,
    30,
  ),
  refreshCookieName,
  refreshCookiePath,
  refreshCookieDomain,
  refreshCookieSecure,
  refreshCookieSameSite,
  csrfCookieName,
  csrfSessionCookieName,
  csrfCookieDomain,
  csrfCookieSecure,
  csrfCookieSameSite,
  csrfCookieTtlDays: parsePositiveIntInRange(
    process.env.CSRF_COOKIE_TTL_DAYS,
    14,
    1,
    30,
  ),
  csrfHeaderName:
    String(process.env.CSRF_HEADER_NAME || "x-csrf-token").trim() ||
    "x-csrf-token",
  trustedImportApiHosts:
    trustedImportApiHosts.length > 0
      ? trustedImportApiHosts
      : defaultTrustedImportApiHosts,
  wechatContactExternalUrlAllowlist,
  cspConnectSrc:
    cspConnectSrc.length > 0 ? cspConnectSrc : defaultCspConnectSrc,
  wechatProxyHortorLoginGuestOnly: parseBoolean(
    process.env.WECHAT_PROXY_HORTOR_LOGIN_GUEST_ONLY,
    false,
  ),
  logCleanupTaskControlDays: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_TASK_CONTROL_DAYS,
    30,
    1,
    3650,
  ),
  logCleanupTaskRunsDays: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_TASK_RUNS_DAYS,
    60,
    1,
    3650,
  ),
  logCleanupBinDownloadAuditsDays: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_BIN_DOWNLOAD_AUDITS_DAYS,
    90,
    1,
    3650,
  ),
  logCleanupBinDownloadTicketsDays: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_BIN_DOWNLOAD_TICKETS_DAYS,
    14,
    1,
    3650,
  ),
  logCleanupReadNotificationsDays: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_READ_NOTIFICATIONS_DAYS,
    90,
    1,
    3650,
  ),
  logCleanupSecurityEventsDays: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_SECURITY_EVENTS_DAYS,
    180,
    1,
    3650,
  ),
  logCleanupAdminAuditDays: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_ADMIN_AUDIT_DAYS,
    365,
    1,
    3650,
  ),
  logCleanupHour: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_HOUR,
    3,
    0,
    23,
  ),
  logCleanupMinute: parsePositiveIntInRange(
    process.env.LOG_CLEANUP_MINUTE,
    20,
    0,
    59,
  ),
};

if (isBlank(env.jwtSecret) || JWT_PLACEHOLDERS.has(env.jwtSecret)) {
  throw new Error(
    "JWT_SECRET is required in backend/.env and cannot use placeholder values.",
  );
}

if (isBlank(env.aesKey) || AES_PLACEHOLDERS.has(env.aesKey)) {
  throw new Error(
    "AES_KEY is required in backend/.env and cannot use placeholder values.",
  );
}

if (isBlank(env.csrfSecret)) {
  throw new Error(
    "CSRF_SECRET is required in backend/.env and must be set explicitly.",
  );
}

if (isBlank(env.inviteCodePepper)) {
  throw new Error(
    "INVITE_CODE_PEPPER is required in backend/.env and must be set explicitly.",
  );
}

if (isBlank(env.activationCodePepper)) {
  throw new Error(
    "ACTIVATION_CODE_PEPPER is required in backend/.env and must be set explicitly.",
  );
}

if (isBlank(env.passwordResetCodePepper)) {
  throw new Error(
    "PASSWORD_RESET_CODE_PEPPER is required in backend/.env and must be set explicitly.",
  );
}

if (
  env.nodeEnv === "production" &&
  new Set([
    env.jwtSecret,
    env.csrfSecret,
    env.inviteCodePepper,
    env.activationCodePepper,
    env.passwordResetCodePepper,
  ]).size !== 5
) {
  throw new Error(
    "JWT_SECRET, CSRF_SECRET, INVITE_CODE_PEPPER, ACTIVATION_CODE_PEPPER, and PASSWORD_RESET_CODE_PEPPER must all be distinct in production.",
  );
}

if (env.nodeEnv === "production" && !env.refreshCookieSecure) {
  throw new Error("REFRESH_COOKIE_SECURE must be true in production.");
}

if (env.nodeEnv === "production" && env.accessTokenExposeInBody) {
  throw new Error("ACCESS_TOKEN_EXPOSE_IN_BODY must be false in production.");
}

if (
  env.nodeEnv === "production" &&
  String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "").trim()
) {
  throw new Error(
    "BOOTSTRAP_ADMIN_PASSWORD must not be present in production runtime. Use one-time init scripts instead.",
  );
}

if (env.nodeEnv === "production" && !env.corsOriginsExplicitlySet) {
  throw new Error("CORS_ORIGINS must be explicitly set in production.");
}

if (env.nodeEnv === "production" && !env.publicAppOrigin) {
  throw new Error("PUBLIC_APP_ORIGIN must be explicitly set in production.");
}

if (env.nodeEnv === "production" && !env.adminAppOrigin) {
  throw new Error("ADMIN_APP_ORIGIN must be explicitly set in production.");
}

if (env.nodeEnv === "production") {
  validateProductionAppOrigin(env.publicAppOrigin, "PUBLIC_APP_ORIGIN");
  validateProductionAppOrigin(env.adminAppOrigin, "ADMIN_APP_ORIGIN");
}

if (
  env.nodeEnv === "production" &&
  env.corsOrigins.some((origin) =>
    /localhost|127\.0\.0\.1|\[::1\]/i.test(String(origin || "")),
  )
) {
  throw new Error(
    "CORS_ORIGINS must not include localhost/loopback origins in production.",
  );
}

if (
  env.nodeEnv === "production" &&
  trustedImportApiHostsExplicitlySet &&
  trustedImportApiHosts.some((pattern) =>
    LOOPBACK_HOST_ALLOWLIST.some((loopbackHost) =>
      matchesAllowedHost(loopbackHost, pattern),
    ),
  )
) {
  throw new Error(
    "TRUSTED_IMPORT_API_HOSTS must not include localhost/loopback hosts in production.",
  );
}

if (env.nodeEnv === "production" && !env.accessCookieSecure) {
  throw new Error("ACCESS_COOKIE_SECURE must be true in production.");
}

if (env.nodeEnv === "production" && !env.csrfCookieSecure) {
  throw new Error("CSRF_COOKIE_SECURE must be true in production.");
}

if (!fs.existsSync(env.dbPath)) {
  // eslint-disable-next-line no-console
  console.warn(
    `[startup-check] DB_PATH does not exist yet: ${env.dbPath} (a new database file will be initialized on first startup)`,
  );
}

if (!fs.existsSync(env.binStoragePath)) {
  fs.mkdirSync(env.binStoragePath, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(
    `[startup-check] BIN_STORAGE_PATH created: ${env.binStoragePath}`,
  );
}

if (env.corsOrigins.includes("*")) {
  throw new Error(
    "CORS_ORIGINS cannot contain '*' when credentials are enabled.",
  );
}
