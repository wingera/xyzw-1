import {
  buildAuthorizeUrl,
  exchangeCodeForAccessToken,
  fetchWechatUserProfile,
  isWechatOpenConfigured,
} from "../../services/wechatOpenAuthService.js";
import { secureId } from "../../db/sql.js";

const WECHAT_CALLBACK_CODE_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const WECHAT_AUTH_FLOW_TTL_MS = 5 * 60 * 1000;
const MAX_WECHAT_AUTH_FLOW_COUNT = 500;
export const WECHAT_AUTH_CALLBACK_SOURCE = "xyzw-wechat-auth";
const wechatAuthFlowStore = new Map();

export const isWechatAuthConfigured = () =>
  isWechatOpenConfigured();

export const buildWechatAuthorizeUrl = ({ state }) =>
  buildAuthorizeUrl({ state });

export const enforceWechatAuthFlowLimit = () => {
  if (wechatAuthFlowStore.size <= MAX_WECHAT_AUTH_FLOW_COUNT) {
    return;
  }
  const flows = Array.from(wechatAuthFlowStore.entries()).sort(
    (a, b) => Number(a?.[1]?.createdAtMs || 0) - Number(b?.[1]?.createdAtMs || 0),
  );
  const removeCount = Math.max(0, flows.length - MAX_WECHAT_AUTH_FLOW_COUNT);
  for (let i = 0; i < removeCount; i += 1) {
    wechatAuthFlowStore.delete(String(flows[i]?.[0] || ""));
  }
};

export const cleanupExpiredWechatAuthFlows = () => {
  const now = Date.now();
  for (const [flowId, flow] of wechatAuthFlowStore.entries()) {
    if (!flow || Number(flow.expiresAtMs || 0) <= now) {
      wechatAuthFlowStore.delete(flowId);
    }
  }
  enforceWechatAuthFlowLimit();
};

export const createWechatAuthFlow = ({ intent, rememberMe = false, userId = null }) => {
  cleanupExpiredWechatAuthFlows();
  const createdAtMs = Date.now();
  const flowId = secureId("wxflow");
  wechatAuthFlowStore.set(flowId, {
    id: flowId,
    intent: String(intent || "").trim(),
    rememberMe: Boolean(rememberMe),
    userId: String(userId || "").trim() || null,
    createdAtMs,
    expiresAtMs: createdAtMs + WECHAT_AUTH_FLOW_TTL_MS,
  });
  return {
    flowId,
    authorizeUrl: buildWechatAuthorizeUrl({ state: flowId }),
  };
};

export const findWechatAuthFlow = (flowId) => {
  cleanupExpiredWechatAuthFlows();
  const safeFlowId = String(flowId || "").trim();
  return wechatAuthFlowStore.get(safeFlowId) || null;
};

export const consumeWechatAuthFlow = (flowId) => {
  const safeFlowId = String(flowId || "").trim();
  const flow = findWechatAuthFlow(safeFlowId);
  if (!flow) {
    return null;
  }
  wechatAuthFlowStore.delete(safeFlowId);
  return flow;
};

export const normalizeWechatCallbackCode = (value) => {
  const code = String(value || "").trim();
  return WECHAT_CALLBACK_CODE_PATTERN.test(code) ? code : "";
};

export const classifyWechatCallbackFlow = (flow, { fallbackIntent = "login" } = {}) => {
  const intent = String(flow?.intent || fallbackIntent).trim() || fallbackIntent;
  return {
    flow,
    intent,
    isBind: intent === "bind",
    isLogin: intent !== "bind",
    bindUserId: String(flow?.userId || "").trim() || null,
    rememberMe: Boolean(flow?.rememberMe),
  };
};

export const assertWechatFlowIntent = (flow, expectedIntent) =>
  classifyWechatCallbackFlow(flow).intent === String(expectedIntent || "").trim();

export const maskWechatOpenId = (openId) => {
  const value = String(openId || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= 6) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
};

export const buildWechatCallbackPostMessagePayload = ({
  intent,
  success,
  flowId,
  message,
  errorCode = "",
  mfaRequired = false,
  mfaChallengeToken = "",
}) => {
  const payload = {
    source: WECHAT_AUTH_CALLBACK_SOURCE,
    intent: String(intent || "").trim() || "login",
    success: Boolean(success),
    flowId: String(flowId || "").trim(),
    message: String(message || "").trim(),
  };
  if (!payload.success && errorCode) {
    payload.errorCode = String(errorCode || "").trim();
  }
  if (mfaRequired) {
    payload.mfaRequired = true;
    payload.mfaChallengeToken = String(mfaChallengeToken || "").trim();
  }
  return payload;
};

export const buildWechatCallbackHtmlModel = (input) =>
  buildWechatCallbackPostMessagePayload(input);

export const isWechatBindingConflictError = (error) => {
  const message = String(error?.message || "");
  return (
    message.includes("idx_users_wechat_open_id")
    || message.includes("idx_users_wechat_union_id")
    || message.includes("users.wechat_open_id")
    || message.includes("users.wechat_union_id")
  );
};

export const loadWechatUserProfileByCode = async (code) => {
  const exchanged = await exchangeCodeForAccessToken(code);
  const profile = await fetchWechatUserProfile({
    accessToken: exchanged.accessToken,
    openId: exchanged.openId,
  });
  return {
    openId: String(profile.openId || exchanged.openId || "").trim(),
    unionId: String(profile.unionId || exchanged.unionId || "").trim(),
    nickname: String(profile.nickname || "").trim(),
    avatarUrl: String(profile.avatarUrl || "").trim(),
    appId: String(profile.appId || "").trim(),
  };
};
