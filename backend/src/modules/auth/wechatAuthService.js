import {
  buildAuthorizeUrl,
  exchangeCodeForAccessToken,
  fetchWechatUserProfile,
  isWechatOpenConfigured,
} from "../../services/wechatOpenAuthService.js";

export const isWechatAuthConfigured = () =>
  isWechatOpenConfigured();

export const buildWechatAuthorizeUrl = ({ state }) =>
  buildAuthorizeUrl({ state });

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
