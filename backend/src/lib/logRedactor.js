const REDACTED_TEXT = "[REDACTED]";
const SENSITIVE_QUERY_KEYS = [
  "token",
  "secret",
  "code",
  "password",
  "passwd",
  "authorization",
  "cookie",
  "ticket",
];
const EXACT_SENSITIVE_QUERY_KEYS = new Set([
  "p",
  "sessid",
  "sessionid",
  "sid2",
  "deviceuniqueid",
  "distinctid",
  "uuid",
]);
const EXACT_URL_CONTAINER_QUERY_KEYS = new Set([
  "url",
  "target",
  "upstream",
  "redirect_uri",
  "redirect",
]);

const isSensitiveHeaderKey = (key) => {
  const name = String(key || "").trim().toLowerCase();
  if (!name) {
    return false;
  }
  if (name === "authorization" || name === "cookie" || name === "set-cookie") {
    return true;
  }
  return /^x-.*token$/.test(name);
};

const maskValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(() => REDACTED_TEXT);
  }
  return REDACTED_TEXT;
};

export const redactHeaders = (headers = {}) => {
  const safe = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    safe[key] = isSensitiveHeaderKey(key) ? maskValue(value) : value;
  });
  return safe;
};

const shouldMaskQueryKey = (key) => {
  const normalized = String(key || "").toLowerCase();
  if (
    EXACT_SENSITIVE_QUERY_KEYS.has(normalized)
    || EXACT_URL_CONTAINER_QUERY_KEYS.has(normalized)
  ) {
    return true;
  }
  return SENSITIVE_QUERY_KEYS.some((segment) => normalized.includes(segment));
};

export const sanitizeForLog = (value) =>
  String(value ?? "")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");

export const redactUrl = (url) => {
  const rawUrl = String(url || "");
  if (!rawUrl) {
    return sanitizeForLog(rawUrl);
  }

  try {
    const parsed = new URL(rawUrl, "http://localhost");
    const params = new URLSearchParams(parsed.search);
    for (const key of params.keys()) {
      if (shouldMaskQueryKey(key)) {
        params.set(key, "***");
      }
    }

    const query = params.toString();
    const path = `${parsed.pathname}${query ? `?${query}` : ""}`;
    if (/^https?:\/\//i.test(rawUrl)) {
      return sanitizeForLog(`${parsed.origin}${path}`);
    }
    return sanitizeForLog(path);
  } catch {
    return sanitizeForLog(rawUrl);
  }
};
