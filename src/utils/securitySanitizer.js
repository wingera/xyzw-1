const DEFAULT_MASK = "***";

const SENSITIVE_KEY_PATTERN = /(token|authorization|cookie|secret|password|passwd|actualToken|gameToken|userToken)/i;
const URL_KEY_PATTERN = /(url|uri|endpoint|wsUrl)/i;
const WS_URL_SENSITIVE_PARAM_NAMES = "p|sid2|token|access_token|auth|authorization|bearer";
const URL_TOKEN_PARAM_PATTERN = new RegExp(`^(${WS_URL_SENSITIVE_PARAM_NAMES})$`, "i");
const SOURCE_URL_SENSITIVE_PARAM_PATTERN = /^(p|token|access_token|auth|authorization|bearer|code|ticket|secret|password|passwd)$/i;
const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const WS_URL_SENSITIVE_PARAM_FALLBACK_PATTERN = new RegExp(`[?&](?:${WS_URL_SENSITIVE_PARAM_NAMES})=`, "i");
const SOURCE_URL_SENSITIVE_PARAM_FALLBACK_PATTERN = /[?&](?:p|token|access_token|auth|authorization|bearer|code|ticket|secret|password|passwd)=/i;

export const maskToken = (raw, startLen = 4, endLen = 4) => {
  const token = String(raw || "").trim();
  if (!token)
    return "";
  if (token.length <= startLen + endLen)
    return DEFAULT_MASK;
  return `${token.slice(0, startLen)}${DEFAULT_MASK}${token.slice(-endLen)}`;
};

const maskBearer = (text) => {
  return String(text || "").replace(/(Bearer\s+)(\S+)/gi, (_, prefix, token) => {
    return `${prefix}${maskToken(token, 3, 3) || DEFAULT_MASK}`;
  });
};

const maskUrlTokenParams = (text) => {
  return String(text || "").replace(
    new RegExp(`([?&](?:${WS_URL_SENSITIVE_PARAM_NAMES})=)([^&\\s]+)`, "gi"),
    (_, prefix, value) => `${prefix}${maskToken(value, 3, 3) || DEFAULT_MASK}`,
  );
};

const maskSourceUrlParamsFallback = (text) => {
  return String(text || "").replace(
    /([?&](?:p|token|access_token|auth|authorization|bearer|code|ticket|secret|password|passwd)=)([^&\s]+)/gi,
    (_, prefix, value) => `${prefix}${maskToken(value, 3, 3) || DEFAULT_MASK}`,
  );
};

const parseSourceUrl = (rawUrl) => {
  const value = String(rawUrl || "").trim();
  if (!value)
    return null;

  try {
    if (ABSOLUTE_URL_PATTERN.test(value)) {
      return {
        parsed: new URL(value),
        isAbsolute: true,
      };
    }
    const base = typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost";
    return {
      parsed: new URL(value, base),
      isAbsolute: false,
    };
  } catch {
    return null;
  }
};

export const hasSensitiveSourceUrlParams = (rawUrl) => {
  const parsed = parseSourceUrl(rawUrl);
  if (!parsed) {
    return SOURCE_URL_SENSITIVE_PARAM_FALLBACK_PATTERN.test(
      String(rawUrl || ""),
    );
  }

  return Array.from(parsed.parsed.searchParams.keys()).some((key) =>
    SOURCE_URL_SENSITIVE_PARAM_PATTERN.test(key),
  );
};

export const hasSensitiveWsUrlParams = (rawUrl) => {
  const value = String(rawUrl || "").trim();
  if (!value)
    return false;

  try {
    const url = new URL(value);
    return Array.from(url.searchParams.keys()).some((key) =>
      URL_TOKEN_PARAM_PATTERN.test(key),
    );
  } catch {
    return WS_URL_SENSITIVE_PARAM_FALLBACK_PATTERN.test(value);
  }
};

export const sanitizeSourceUrlForDisplay = (rawUrl) => {
  const value = String(rawUrl || "").trim();
  if (!value)
    return "";

  const parsed = parseSourceUrl(value);
  if (!parsed) {
    return maskSourceUrlParamsFallback(value);
  }

  const { parsed: url, isAbsolute } = parsed;
  Array.from(url.searchParams.keys()).forEach((key) => {
    if (!SOURCE_URL_SENSITIVE_PARAM_PATTERN.test(key))
      return;
    const current = url.searchParams.get(key) || "";
    url.searchParams.set(key, maskToken(current, 3, 3) || DEFAULT_MASK);
  });

  const query = url.search ? url.search : "";
  const hash = url.hash || "";
  return isAbsolute
    ? `${url.origin}${url.pathname}${query}${hash}`
    : `${url.pathname}${query}${hash}`;
};

export const sanitizeText = (text) => {
  if (typeof text !== "string")
    return text;
  return maskUrlTokenParams(maskBearer(text));
};

export const sanitizeWsUrl = (rawUrl) => {
  const value = String(rawUrl || "").trim();
  if (!value)
    return "";

  try {
    const url = new URL(value);
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (URL_TOKEN_PARAM_PATTERN.test(key)) {
        const current = url.searchParams.get(key) || "";
        url.searchParams.set(key, maskToken(current, 3, 3) || DEFAULT_MASK);
      }
    });
    return url.toString();
  } catch {
    return maskUrlTokenParams(value);
  }
};

export const sanitizeErrorForDisplay = (error) => {
  if (!error)
    return "";
  if (typeof error === "string")
    return sanitizeText(error);
  if (error instanceof Error)
    return sanitizeText(error.message || String(error));
  return sanitizeText(String(error));
};

export const sanitizeForLog = (input, depth = 0, seen = new WeakSet()) => {
  if (input == null)
    return input;

  if (typeof input === "string") {
    return sanitizeText(input);
  }

  if (typeof input !== "object")
    return input;

  if (seen.has(input))
    return "[Circular]";

  if (depth >= 4)
    return "[MaxDepth]";

  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForLog(item, depth + 1, seen));
  }

  const out = {};
  Object.entries(input).forEach(([key, value]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = maskToken(value, 4, 4) || DEFAULT_MASK;
      return;
    }

    if (/sourceurl/i.test(String(key || "")) && typeof value === "string") {
      out[key] = sanitizeSourceUrlForDisplay(value);
      return;
    }

    if (URL_KEY_PATTERN.test(key) && typeof value === "string") {
      out[key] = sanitizeWsUrl(value);
      return;
    }

    out[key] = sanitizeForLog(value, depth + 1, seen);
  });

  return out;
};
