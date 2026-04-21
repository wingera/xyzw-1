import { normalizeHttpOrigin } from "../../lib/origin.js";

export const PASSWORD_RESET_GENERIC_MESSAGE = "如果信息正确，密码已重置，请使用新密码登录";
const LOG_CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;
const PASSWORD_RESET_LOG_REASONS = new Set([
  "user_not_found",
  "invalid_or_inactive_code",
  "expired_code",
]);

export const isLocalMfaResetRequest = (req) => {
  const origin = normalizeHttpOrigin(String(req.get("origin") || "").trim());
  const refererRaw = String(req.get("referer") || "").trim();
  let referer = null;
  try {
    referer = refererRaw ? normalizeHttpOrigin(new URL(refererRaw).origin) : null;
  } catch {
    referer = null;
  }
  const host = String(req.hostname || "").trim().toLowerCase();
  return (
    host === "127.0.0.1"
    || origin?.hostname === "127.0.0.1"
    || referer?.hostname === "127.0.0.1"
  );
};

export const toLogSafeText = (value, fallback = "unknown") => {
  const text = String(value || "")
    .replace(LOG_CONTROL_CHARS_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
};

export const maskIdentity = (identity) => {
  const text = String(identity || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= 2) {
    return "*".repeat(text.length);
  }
  return `${text.slice(0, 2)}***`;
};

export const logPasswordResetMaskedReason = (identity, reason) => {
  const reasonText = toLogSafeText(reason, "unknown");
  const safeReason = PASSWORD_RESET_LOG_REASONS.has(reasonText)
    ? reasonText
    : "unknown";
  const safeIdentity = String(identity || "").trim() ? "masked" : "unknown";
  // eslint-disable-next-line no-console
  console.warn(`[auth] password reset masked reason: ${safeReason} (identity=${safeIdentity})`);
};
