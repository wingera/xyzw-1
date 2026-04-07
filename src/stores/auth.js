import { defineStore } from "pinia";
import { computed, ref } from "vue";
import api from "@/api";
import { useLocalTokenStore } from "./localTokenManager";

export const useAuthStore = defineStore("auth", () => {
  const user = ref(null);
  const token = ref(null);
  const isLoading = ref(false);
  const isInitialized = ref(false);
  let initPromise = null;
  const localTokenStore = useLocalTokenStore();

  const isAuthenticated = computed(() => !!user.value);
  const userInfo = computed(() => user.value);

  const clearLocalSession = () => {
    user.value = null;
    token.value = null;
    api.user.clearSensitiveConfirmToken();
    localStorage.removeItem("activeUserId");
    localStorage.removeItem("gameRoles");
    localTokenStore.clearUserToken();
    localTokenStore.clearAllGameTokens();
  };

  const setSessionToken = (nextToken) => {
    token.value = nextToken;
  };

  const hydrateUserFromMe = async (options = {}) => {
    const res = await api.auth.getMe(options);
    if (!res.success || !res.data)
      return false;
    user.value = res.data;
    if (user.value?.id) {
      localStorage.setItem("activeUserId", user.value.id);
    }
    return true;
  };

  const ensureCsrfToken = async () => {
    try {
      return await api.auth.ensureCsrf();
    } catch {
      // ignore, request interceptor will attach token if cookie exists
      return null;
    }
  };

  const login = async (credentials) => {
    try {
      isLoading.value = true;
      await ensureCsrfToken();
      const res = await api.auth.login({
        username: credentials?.username,
        password: credentials?.password,
        rememberMe: Boolean(credentials?.rememberMe),
      });

      if (!res.success) {
        return { success: false, message: res.message || "登录失败" };
      }

      if (res?.data?.mfaRequired && res?.data?.mfaChallengeToken) {
        return {
          success: true,
          mfaRequired: true,
          mfaChallengeToken: res.data.mfaChallengeToken,
        };
      }

      setSessionToken(res?.data?.token || null);
      const hydrated = await fetchUserInfo();
      if (!hydrated) {
        clearLocalSession();
        return { success: false, message: "登录状态校验失败，请重试" };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.message || "登录失败",
        code: String(error?.code || ""),
        status: Number(error?.status) || 0,
        retryAfter: Math.max(0, Number(error?.retryAfter) || 0),
      };
    } finally {
      isLoading.value = false;
    }
  };

  const verifyMfaLogin = async ({ mfaChallengeToken, totpCode, recoveryCode }) => {
    try {
      isLoading.value = true;
      await ensureCsrfToken();
      const res = await api.auth.verifyMfa({
        mfaChallengeToken,
        ...(totpCode ? { totpCode } : {}),
        ...(recoveryCode ? { recoveryCode } : {}),
      });
      if (!res?.success) {
        return { success: false, message: res?.message || "二步验证失败" };
      }
      setSessionToken(res?.data?.token || null);
      const hydrated = await fetchUserInfo();
      if (!hydrated) {
        clearLocalSession();
        return { success: false, message: "登录状态校验失败，请重试" };
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message || "二步验证失败" };
    } finally {
      isLoading.value = false;
    }
  };

  const createMfaQrSession = async ({ mfaChallengeToken }) => {
    try {
      await ensureCsrfToken();
      const res = await api.auth.createMfaQrSession({ mfaChallengeToken });
      if (!res?.success) {
        return { success: false, message: res?.message || "二维码初始化失败" };
      }
      return {
        success: true,
        data: {
          sessionId: String(res?.data?.sessionId || ""),
          expiresAt: String(res?.data?.expiresAt || ""),
        },
      };
    } catch (error) {
      return { success: false, message: error.message || "二维码初始化失败" };
    }
  };

  const verifyMfaQrLogin = async ({ sessionId }) => {
    try {
      isLoading.value = true;
      await ensureCsrfToken();
      const res = await api.auth.pollMfaQr({ sessionId });
      if (!res?.success) {
        return { success: false, message: res?.message || "扫码验证失败" };
      }
      if (res?.data?.status === "pending") {
        return { success: true, pending: true };
      }
      setSessionToken(res?.data?.token || null);
      const hydrated = await fetchUserInfo();
      if (!hydrated) {
        clearLocalSession();
        return { success: false, message: "登录状态校验失败，请重试" };
      }
      return { success: true, pending: false };
    } catch (error) {
      return { success: false, message: error.message || "扫码验证失败" };
    } finally {
      isLoading.value = false;
    }
  };

  const register = async (payload) => {
    try {
      isLoading.value = true;
      await ensureCsrfToken();
      const res = await api.auth.register(payload);
      return {
        success: !!res.success,
        message: res.message || (res.success ? "注册成功" : "注册失败"),
        data: res.data || null,
        code: String(res?.code || ""),
        status: 200,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || "注册失败",
        code: String(error?.code || ""),
        status: Number(error?.status) || 0,
      };
    } finally {
      isLoading.value = false;
    }
  };

  const resetPasswordWithShortCode = async (payload) => {
    try {
      isLoading.value = true;
      await ensureCsrfToken();
      const res = await api.auth.resetPassword(payload);
      return {
        success: !!res.success,
        message: res.message || (res.success ? "密码重置成功" : "密码重置失败"),
      };
    } catch (error) {
      return { success: false, message: error.message || "密码重置失败" };
    } finally {
      isLoading.value = false;
    }
  };

  const logout = async () => {
    try {
      await ensureCsrfToken();
      await api.auth.logout();
    } catch {
      // 忽略登出接口异常，始终清理本地状态
    }
    clearLocalSession();
  };

  const fetchUserInfo = async () => {
    try {
      return await hydrateUserFromMe();
    } catch {
      clearLocalSession();
      return false;
    }
  };

  const refreshAccessToken = async () => {
    try {
      const csrfState = await ensureCsrfToken();
      if (csrfState?.success && csrfState?.data?.hasRefreshTokenCookie === false) {
        return false;
      }
      const refreshed = await api.auth.refreshToken();
      if (!refreshed?.success) {
        return false;
      }
      setSessionToken(refreshed?.data?.token || null);
      return true;
    } catch {
      return false;
    }
  };

  const initializeAuth = async () => {
    if (isInitialized.value) {
      return;
    }
    if (initPromise) {
      await initPromise;
      return;
    }

    initPromise = (async () => {
      localTokenStore.initTokenManager();
      let recovered = false;
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        try {
          recovered = await hydrateUserFromMe({ skipAuthHandling: true });
        } catch {
          recovered = false;
        }
      }

      if (!recovered) {
        clearLocalSession();
      }
      isInitialized.value = true;
    })();

    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  };

  const initAuth = async () => {
    await initializeAuth();
  };

  const handleUnauthorized = () => {
    clearLocalSession();
  };

  return {
    user,
    token,
    isLoading,
    isInitialized,
    isAuthenticated,
    userInfo,
    login,
    register,
    verifyMfaLogin,
    createMfaQrSession,
    verifyMfaQrLogin,
    resetPasswordWithShortCode,
    logout,
    handleUnauthorized,
    fetchUserInfo,
    refreshAccessToken,
    initializeAuth,
    initAuth,
  };
});
