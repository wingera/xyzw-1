import { normalizeHttpOrigin } from "../../lib/origin.js";

export const PASSWORD_RESET_GENERIC_MESSAGE = "如果信息正确，密码已重置，请使用新密码登录";

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

export const logPasswordResetMaskedReason = (identity, reason) => {
  // eslint-disable-next-line no-console
  console.warn(`[auth] password reset masked reason: ${reason} (identity=${identity || "unknown"})`);
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
