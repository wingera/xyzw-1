export const parseCookies = (rawCookieHeader) => {
  const pairs = String(rawCookieHeader || "").split(";");
  const result = new Map();
  const blockedCookieNames = new Set(["__proto__", "constructor", "prototype"]);
  pairs.forEach((segment) => {
    const part = String(segment || "").trim();
    if (!part) return;
    const separator = part.indexOf("=");
    if (separator <= 0) return;
    let key = part.slice(0, separator).trim();
    let value = part.slice(separator + 1).trim();
    try {
      key = decodeURIComponent(key);
      value = decodeURIComponent(value);
    } catch {
      // ignore malformed cookie encoding
    }
    if (blockedCookieNames.has(key)) {
      return;
    }
    if (!result.has(key)) {
      result.set(key, value);
    }
  });
  const cookies = Object.fromEntries(result);
  Object.setPrototypeOf(cookies, null);
  return cookies;
};
