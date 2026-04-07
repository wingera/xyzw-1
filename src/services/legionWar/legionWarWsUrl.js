import { sanitizeWsUrl } from "../../utils/securitySanitizer.js";

const LEGION_WAR_WS_BASE_URL = "wss://xxz-xyzw-new.hortorgames.com/agent";

const getParseResult = (tokenString, parseBase64Token) => {
  try {
    return parseBase64Token(tokenString) || { success: false };
  } catch (error) {
    return {
      success: false,
      error: error?.message || "Token解析失败",
    };
  }
};

export const resolveLegionWarActualToken = ({
  tokenString,
  parseBase64Token,
  validateToken,
}) => {
  const parseResult = getParseResult(tokenString, parseBase64Token);

  if (parseResult.success && parseResult.data?.actualToken) {
    return parseResult.data.actualToken;
  }

  if (validateToken(tokenString)) {
    return tokenString;
  }

  const parseError = String(parseResult.error || "").trim();
  throw new Error(parseError ? `Token无效: ${parseError}` : "Token无效");
};

export const buildLegionWarWsUrl = ({
  tokenString,
  sid,
  parseBase64Token,
  validateToken,
}) => {
  const normalizedSid = String(sid ?? "").trim();
  if (!normalizedSid) {
    throw new Error("战场sid无效");
  }

  const actualToken = resolveLegionWarActualToken({
    tokenString,
    parseBase64Token,
    validateToken,
  });
  const wsUrl = `${LEGION_WAR_WS_BASE_URL}?p=${encodeURIComponent(actualToken)}&e=x&sid2=${normalizedSid}&lang=chinese&sid2=${normalizedSid}`;

  return {
    actualToken,
    wsUrl,
    wsUrlDisplay: sanitizeWsUrl(wsUrl),
  };
};
