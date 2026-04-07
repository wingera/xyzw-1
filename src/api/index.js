import axios from "axios";
import { useAuthStore } from "@/stores/auth";
import {
  REFRESH_SECOND_VERIFY_PREF_KEY,
  REMOTE_BIN_DOWNLOAD_PREF_KEY,
} from "@/constants/userPreferences";

let isHandlingUnauthorized = false;
let refreshPromise = null;
let csrfRefreshPromise = null;
const CSRF_COOKIE_NAMES = ["__Host-xyzw_csrf_token", "xyzw_csrf_token"];
const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
const USER_CONFIRM_HEADER_NAME = "X-User-Confirm-Token";
const SENSITIVE_USER_PREF_KEYS = new Set([
  REMOTE_BIN_DOWNLOAD_PREF_KEY,
  REFRESH_SECOND_VERIFY_PREF_KEY,
]);
let userConfirmTokenCache = "";
let userConfirmTokenExpiresAt = 0;
let userConfirmTokenIssuedAt = 0;
let userConfirmTokenCleanupTimer = null;

const readCookie = (name) => {
  const target = String(name || "").trim();
  if (!target || typeof document === "undefined") return "";
  const pairs = String(document.cookie || "").split(";");
  for (const segment of pairs) {
    const part = String(segment || "").trim();
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    if (key !== target) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
};

const normalizeUrl = (url) => String(url || "").toLowerCase();
const isRefreshRequest = (config) =>
  normalizeUrl(config?.url).includes("/auth/refresh");
const isCsrfRequest = (config) =>
  normalizeUrl(config?.url).includes("/auth/csrf");
const isUnsafeRequestMethod = (config) => {
  const method = String(config?.method || "get").toUpperCase();
  return !CSRF_SAFE_METHODS.has(method);
};
const isAuthBootstrapRequest = (config) => {
  const url = normalizeUrl(config?.url);
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/register") ||
    url.includes("/auth/password-reset") ||
    url.includes("/auth/mfa/verify") ||
    url.includes("/auth/mfa/qr/session") ||
    url.includes("/auth/mfa/qr/approve") ||
    url.includes("/auth/mfa/qr/poll") ||
    url.includes("/auth/csrf")
  );
};

const isCsrfFailure = (status, data) => {
  if (Number(status) !== 403) {
    return false;
  }
  const rawCode = String(data?.error?.code || data?.code || "").toUpperCase();
  const rawMessage = String(data?.error?.message || data?.message || "").toLowerCase();
  return rawCode.includes("CSRF") || rawMessage.includes("csrf");
};

const refreshTokenOnce = async () => {
  if (!refreshPromise) {
    const authStore = useAuthStore();
    refreshPromise = authStore.refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

const refreshCsrfTokenOnce = async () => {
  if (!csrfRefreshPromise) {
    csrfRefreshPromise = request
      .get("/auth/csrf", {
        skipAuthHandling: true,
        __skipCsrfRetry: true,
      })
      .then((res) => Boolean(res?.success !== false))
      .catch(() => false)
      .finally(() => {
        csrfRefreshPromise = null;
      });
  }
  return csrfRefreshPromise;
};

const createRequestError = (message, extra = {}) => {
  const err = new Error(message || "请求失败");
  Object.assign(err, {
    success: false,
    ...extra,
  });
  return err;
};

const getCachedUserConfirmToken = ({ maxAgeMs } = {}) => {
  const now = Date.now();
  const boundedByMaxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0;
  if (
    boundedByMaxAge
    && (!userConfirmTokenIssuedAt || now - userConfirmTokenIssuedAt > maxAgeMs)
  ) {
    return "";
  }
  if (
    userConfirmTokenCache
    && Number.isFinite(userConfirmTokenExpiresAt)
    && userConfirmTokenExpiresAt > now + 3000
  ) {
    return userConfirmTokenCache;
  }
  return "";
};

const setCachedUserConfirmToken = (token, expiresAt = "") => {
  userConfirmTokenCache = String(token || "").trim();
  userConfirmTokenIssuedAt = Date.now();
  const expiresTs = new Date(expiresAt || "").getTime();
  userConfirmTokenExpiresAt = Number.isFinite(expiresTs)
    ? expiresTs
    : Date.now() + 5 * 60 * 1000;

  if (userConfirmTokenCleanupTimer) {
    clearTimeout(userConfirmTokenCleanupTimer);
    userConfirmTokenCleanupTimer = null;
  }
  const delayMs = Math.max(0, userConfirmTokenExpiresAt - Date.now());
  userConfirmTokenCleanupTimer = setTimeout(() => {
    clearCachedUserConfirmToken();
  }, delayMs);
};

const clearCachedUserConfirmToken = () => {
  if (userConfirmTokenCleanupTimer) {
    clearTimeout(userConfirmTokenCleanupTimer);
    userConfirmTokenCleanupTimer = null;
  }
  userConfirmTokenCache = "";
  userConfirmTokenExpiresAt = 0;
  userConfirmTokenIssuedAt = 0;
};

const getCachedUserConfirmState = ({ maxAgeMs } = {}) => {
  const token = getCachedUserConfirmToken({ maxAgeMs });
  const now = Date.now();
  const expiresAt = Number.isFinite(userConfirmTokenExpiresAt) ? userConfirmTokenExpiresAt : 0;
  const remainingMs = token ? Math.max(0, expiresAt - now) : 0;
  return {
    token,
    active: Boolean(token),
    issuedAt: userConfirmTokenIssuedAt || 0,
    expiresAt,
    remainingMs,
  };
};

const decodeArrayBufferText = (value) => {
  if (typeof ArrayBuffer === "undefined") {
    return "";
  }
  if (value instanceof ArrayBuffer) {
    return new TextDecoder("utf-8").decode(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder("utf-8").decode(value);
  }
  return "";
};

const extractErrorMessage = (payload, fallback) => {
  if (typeof payload === "string") {
    return payload || fallback;
  }

  if (payload && typeof payload === "object") {
    return payload.error?.message || payload.message || fallback;
  }

  const decoded = decodeArrayBufferText(payload);
  if (!decoded) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(decoded);
    return parsed?.error?.message || parsed?.message || fallback;
  } catch {
    return decoded || fallback;
  }
};

// 创建axios实例
const request = axios.create({
  baseURL: "/api/v1",
  timeout: 10000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore();
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`;
    }
    const method = String(config.method || "get").toUpperCase();
    if (config.data == null) {
      config.data = undefined;
      if (config.headers) {
        delete config.headers["Content-Type"];
        delete config.headers["content-type"];
      }
    }
    if (!CSRF_SAFE_METHODS.has(method)) {
      const csrfToken = CSRF_COOKIE_NAMES.map((name) => readCookie(name)).find(
        (value) => String(value || "").trim().length > 0,
      );
      if (csrfToken) {
        config.headers[CSRF_HEADER_NAME] = csrfToken;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    const data = response.data;

    // 统一处理响应格式
    if (data.success !== undefined) {
      return data;
    }

    // 兼容不同的响应格式
    return {
      success: true,
      data,
      message: "success",
    };
  },
  async (error) => {
    const authStore = useAuthStore();
    const skipAuthHandling = Boolean(error?.config?.skipAuthHandling);
    const originalConfig = error?.config || {};

    // 处理HTTP错误
    if (error.response) {
      const { status, data } = error.response;
      const getMessage = (fallback) => extractErrorMessage(data, fallback);

      switch (status) {
        case 400:
          return Promise.reject(
            createRequestError(getMessage("请求失败"), {
              code: data?.error?.code || data?.code || "",
              status,
            }),
          );
        case 401:
          if (
            !skipAuthHandling &&
            !originalConfig.__retriedAfterRefresh &&
            !isRefreshRequest(originalConfig) &&
            !isAuthBootstrapRequest(originalConfig)
          ) {
            const refreshed = await refreshTokenOnce();
            if (refreshed) {
              originalConfig.__retriedAfterRefresh = true;
              return request(originalConfig);
            }
          }

          // 未授权：统一清理登录状态并回到登录页
          if (!skipAuthHandling && !isHandlingUnauthorized) {
            isHandlingUnauthorized = true;
            authStore.handleUnauthorized();
            window.location.href = "/login";
            setTimeout(() => {
              isHandlingUnauthorized = false;
            }, 1000);
          }
          return Promise.reject(
            createRequestError(getMessage("登录已过期，请重新登录"), {
              code: data?.error?.code || "AUTH_INVALID_TOKEN",
            }),
          );
        case 403:
          if (
            !skipAuthHandling
            && !originalConfig.__retriedAfterCsrf
            && !originalConfig.__skipCsrfRetry
            && !isCsrfRequest(originalConfig)
            && isUnsafeRequestMethod(originalConfig)
            && isCsrfFailure(status, data)
          ) {
            const refreshed = await refreshCsrfTokenOnce();
            if (refreshed) {
              originalConfig.__retriedAfterCsrf = true;
              return request(originalConfig);
            }
          }
          if (String(data?.error?.code || "").startsWith("USER_CONFIRM_")) {
            clearCachedUserConfirmToken();
          }
          return Promise.reject(
            createRequestError(getMessage("没有权限访问"), {
              code: data?.error?.code || data?.code || "AUTH_FORBIDDEN",
              status,
            }),
          );
        case 404:
          return Promise.reject(
            createRequestError(getMessage("请求的资源不存在"), {
              code: data?.error?.code || data?.code || "",
              status,
            }),
          );
        case 429:
          return Promise.reject(
            createRequestError(getMessage("请求过于频繁，请稍后重试"), {
              code: data?.error?.code || data?.code || "RATE_LIMITED",
              retryAfter: Number(data?.retryAfter) || 0,
              status,
            }),
          );
        case 500:
          return Promise.reject(
            createRequestError(getMessage("服务器内部错误")),
          );
        default:
          return Promise.reject(createRequestError(getMessage("请求失败")));
      }
    } else if (error.request) {
      // 网络错误
      return Promise.reject(createRequestError("网络连接失败，请检查网络"));
    } else {
      // 其他错误
      return Promise.reject(createRequestError(error.message || "未知错误"));
    }
  },
);

// API接口定义
const api = {
  system: {
    getVersion: () =>
      request.get("/version", {
        skipAuthHandling: true,
      }),
  },

  // 认证相关
  auth: {
    login: (credentials) => request.post("/auth/login", credentials),
    verifyMfa: (payload) => request.post("/auth/mfa/verify", payload),
    createMfaQrSession: (payload) => request.post("/auth/mfa/qr/session", payload),
    approveMfaQr: (payload) => request.post("/auth/mfa/qr/approve", payload),
    pollMfaQr: (payload) => request.post("/auth/mfa/qr/poll", payload),
    setupMfa: (payload) => request.post("/auth/mfa/setup", payload),
    enableMfa: (payload) => request.post("/auth/mfa/enable", payload),
    disableMfa: (payload) => request.post("/auth/mfa/disable", payload),
    resetMfaByLink: (payload) => request.post("/auth/mfa/reset-by-link", payload),
    register: (userInfo) => request.post("/auth/register", userInfo),
    resetPassword: (payload) => request.post("/auth/password-reset", payload),
    logout: () => request.post("/auth/logout", {}, { skipAuthHandling: true }),
    getUserInfo: () => request.get("/auth/user"),
    getMe: (config = {}) => request.get("/auth/me", config),
    ensureCsrf: () => request.get("/auth/csrf", { skipAuthHandling: true }),
    refreshToken: () =>
      request.post("/auth/refresh", {}, { skipAuthHandling: true }),
    logoutAll: () => request.post("/auth/logout-all"),
  },

  tokenImport: {
    proxyFetch: (url) =>
      request.post(
        "/token-import/proxy",
        { url },
        {
          headers: {
            Accept: "application/json",
          },
        },
      ),
  },

  publicReferral: {
    resolve: (code) =>
      request.get(`/public/referrals/${encodeURIComponent(code)}`, {
        skipAuthHandling: true,
      }),
    attach: (code) =>
      request.post(`/public/referrals/${encodeURIComponent(code)}/attach`, {}, {
        skipAuthHandling: true,
      }),
  },

  // 游戏角色相关
  gameRoles: {
    getList: () => request.get("/gamerole_list"),
    add: (roleData) => request.post("/gameroles", roleData),
    update: (roleId, roleData) => request.put(`/gameroles/${roleId}`, roleData),
    delete: (roleId) => request.delete(`/gameroles/${roleId}`),
    getDetail: (roleId) => request.get(`/gameroles/${roleId}`),
  },

  binFiles: {
    list: () => request.get("/bin-files"),
    save: (tokenId, arrayBuffer) =>
      request.put(`/bin-files/${tokenId}`, arrayBuffer, {
        headers: {
          "Content-Type": "application/octet-stream",
        },
      }),
    get: (tokenId, confirmToken = "") =>
      request.get(`/bin-files/${tokenId}`, {
        headers: {
          ...((confirmToken || getCachedUserConfirmToken())
            ? { [USER_CONFIRM_HEADER_NAME]: confirmToken || getCachedUserConfirmToken() }
            : {}),
        },
        responseType: "arraybuffer",
      }),
    download: (tokenId, ticket = "") =>
      request.post(
        `/bin-files/${tokenId}/download`,
        { ticket },
        {
          responseType: "arraybuffer",
        },
      ),
    createDownloadTicket: (tokenId, confirmToken = "") =>
      request.post(
        `/bin-files/${tokenId}/download-ticket`,
        {},
        {
          headers: (confirmToken || getCachedUserConfirmToken())
            ? { [USER_CONFIRM_HEADER_NAME]: confirmToken || getCachedUserConfirmToken() }
            : {},
        },
      ),
    delete: (tokenId) => request.delete(`/bin-files/${tokenId}`),
  },

  // 日常任务相关
  dailyTasks: {
    getList: (roleId) => request.get(`/daily-tasks?roleId=${roleId}`),
    getStatus: (roleId) => request.get(`/daily-tasks/status?roleId=${roleId}`),
    complete: (taskId, roleId) =>
      request.post(`/daily-tasks/${taskId}/complete`, { roleId }),
    update: (taskId, roleId, patch) =>
      request.put(`/daily-tasks/${taskId}`, { roleId, ...patch }),
    getHistory: (roleId, page = 1, limit = 20) =>
      request.get(
        `/daily-tasks/history?roleId=${roleId}&page=${page}&limit=${limit}`,
      ),
  },

  // 用户相关
  user: {
    getProfile: () => request.get("/user/profile"),
    updateProfile: (profileData) => request.put("/user/profile", profileData),
    changePassword: (passwordData) =>
      request.put("/user/password", passwordData),
    getStats: () => request.get("/user/stats"),
    getSecurityEvents: (options = {}) => {
      const search = new URLSearchParams();
      if (options.limit != null) search.set("limit", String(options.limit));
      if (options.eventType) search.set("eventType", String(options.eventType));
      const query = search.toString();
      return request.get(`/user/security-events${query ? `?${query}` : ""}`);
    },
    getPreference: (key) =>
      request.get(`/user/preferences/${encodeURIComponent(key)}`),
    setPreference: (key, value, options = {}) =>
      request.put(
        `/user/preferences/${encodeURIComponent(key)}`,
        { value },
        {
          headers:
            SENSITIVE_USER_PREF_KEYS.has(String(key || ""))
            && (options.confirmToken || getCachedUserConfirmToken())
              ? {
                  [USER_CONFIRM_HEADER_NAME]:
                    options.confirmToken || getCachedUserConfirmToken(),
                }
              : {},
        },
      ),
    confirmSensitiveAction: async (credential) => {
      const payload = typeof credential === "string"
        ? { password: credential }
        : { ...(credential || {}) };
      const res = await request.post("/user/confirm-password", payload);
      if (res?.success && res?.data?.token) {
        setCachedUserConfirmToken(res.data.token, res.data.expiresAt);
      }
      return res;
    },
    getCachedSensitiveConfirmToken: (options = {}) => getCachedUserConfirmToken(options),
    getCachedSensitiveConfirmState: (options = {}) => getCachedUserConfirmState(options),
    clearSensitiveConfirmToken: () => clearCachedUserConfirmToken(),
    getReferralProfile: () => request.get("/user/referral-profile"),
    generateReferralProfile: () => request.post("/user/referral-profile/generate"),
    getReferralOverview: () => request.get("/user/referral-overview"),
    getReferralConversions: (limit = 200) =>
      request.get(`/user/referral-conversions?limit=${Math.max(1, Number(limit) || 200)}`),
  },

  resourceChangeLogs: {
    list: () => request.get("/resource-change-logs"),
    save: (scopeKey, entry) =>
      request.put(`/resource-change-logs/${encodeURIComponent(scopeKey)}`, {
        entry,
      }),
    saveBulk: (entries) => request.put("/resource-change-logs", { entries }),
  },

  taskControl: {
    getState: () => request.get("/task-control/state"),
    saveState: (tasks) => request.put("/task-control/state", { tasks }),
    listLogs: (limit = 500) => request.get(`/task-control/logs?limit=${limit}`),
    appendLog: (payload) => request.post("/task-control/logs", payload),
    clearLogs: () => request.delete("/task-control/logs"),
  },

  feedback: {
    list: (status) =>
      request.get(
        `/feedbacks${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      ),
    create: (payload) => request.post("/feedbacks", payload),
    updateByAdmin: (id, payload) => request.patch(`/feedbacks/${id}`, payload),
  },

  publicWechat: {
    list: () =>
      request.get("/public/wechat-contacts", {
        skipAuthHandling: true,
      }),
    detail: (slug) =>
      request.get(`/public/wechat-contacts/${encodeURIComponent(slug)}`, {
        skipAuthHandling: true,
      }),
  },

  notifications: {
    list: (options = {}) => {
      const search = new URLSearchParams();
      if (options.unreadOnly) search.set("unreadOnly", "1");
      if (options.limit) search.set("limit", String(options.limit));
      const query = search.toString();
      return request.get(`/notifications${query ? `?${query}` : ""}`);
    },
    markRead: (id) => request.patch(`/notifications/${id}/read`),
    markAllRead: () => request.patch("/notifications/read-all"),
    clearAll: () => request.delete("/notifications"),
  },

  admin: {
    adminConfirmHeaders: (confirmToken = "") =>
      confirmToken
        ? { "X-Admin-Confirm-Token": confirmToken }
        : {},
    listInviteCodes: () => request.get("/admin/invite-codes"),
    createInviteCodes: (payload) =>
      request.post("/admin/invite-codes", payload),
    createInviteCodesWithConfirm: (payload, confirmToken = "") =>
      request.post("/admin/invite-codes", payload, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    disableInviteCode: (id, confirmToken = "") =>
      request.patch(`/admin/invite-codes/${id}/disable`, {}, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    listUsers: () => request.get("/admin/users"),
    listReferralAttributions: (limit = 200) =>
      request.get(`/admin/referrals/attributions?limit=${Math.max(1, Number(limit) || 200)}`),
    listReferralConversions: (limit = 200) =>
      request.get(`/admin/referrals/conversions?limit=${Math.max(1, Number(limit) || 200)}`),
    listWechatContacts: () => request.get("/admin/wechat-contacts"),
    createWechatContact: (payload, confirmToken = "") =>
      request.post("/admin/wechat-contacts", payload, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    updateWechatContact: (id, payload, confirmToken = "") =>
      request.put(`/admin/wechat-contacts/${id}`, payload, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    deleteWechatContact: (id, confirmToken = "") =>
      request.delete(`/admin/wechat-contacts/${id}`, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    listUserTokenActivations: (id) =>
      request.get(`/admin/users/${id}/token-activations`),
    listSecurityEvents: (options = {}) => {
      const search = new URLSearchParams();
      if (options.limit != null) search.set("limit", String(options.limit));
      if (options.eventType) search.set("eventType", String(options.eventType));
      if (options.userId) search.set("userId", String(options.userId));
      const query = search.toString();
      return request.get(`/admin/security-events${query ? `?${query}` : ""}`);
    },
    confirmSensitiveAction: (credential) =>
      request.post(
        "/admin/confirm-password",
        typeof credential === "string" ? { password: credential } : { ...(credential || {}) },
      ),
    updateUserAdmin: (id, isAdmin, confirmToken) =>
      request.patch(
        `/admin/users/${id}/admin`,
        { isAdmin },
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    updateUserAccessScope: (id, accessScope, confirmToken) =>
      request.patch(
        `/admin/users/${id}/access-scope`,
        { accessScope },
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    updateUserTokenBindLimit: (id, tokenBindLimit, confirmToken) =>
      request.patch(
        `/admin/users/${id}/token-bind-limit`,
        { tokenBindLimit },
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    updateUserRefreshSecondVerify: (id, enabled, confirmToken) =>
      request.patch(
        `/admin/users/${id}/token-refresh-second-verify`,
        { enabled },
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    resetUserPassword: (id, password, confirmToken) =>
      request.patch(
        `/admin/users/${id}/password`,
        { password },
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    createUserResetCode: (id, expiresInMinutes = 15, confirmToken) =>
      request.post(
        `/admin/users/${id}/password-reset-code`,
        {
          expiresInMinutes,
        },
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    createUserMfaResetLink: (id, confirmToken) =>
      request.post(
        `/admin/users/${id}/mfa-reset-link`,
        {},
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    deleteUser: (id, confirmToken) =>
      request.delete(`/admin/users/${id}`, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    revokeSessions: (id) => request.post(`/admin/users/${id}/revoke-sessions`),
    listTaskControlLogs: (params = {}) => {
      const search = new URLSearchParams();
      if (params.limit != null) search.set("limit", String(params.limit));
      if (params.username) search.set("username", String(params.username));
      if (params.taskName) search.set("taskName", String(params.taskName));
      if (params.status) search.set("status", String(params.status));
      if (params.taskId) search.set("taskId", String(params.taskId));
      if (params.message) search.set("message", String(params.message));
      const query = search.toString();
      return request.get(`/admin/task-control/logs${query ? `?${query}` : ""}`);
    },
    notifyChangelogToAll: (payload) =>
      request.post("/admin/changelog/notify-all", payload),
    listActivationCodes: () => request.get("/admin/activation-codes"),
    markReferralConversionPaid: (id, payload = {}, confirmToken = "") =>
      request.post(`/admin/referrals/conversions/${id}/mark-paid`, payload, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    rejectReferralConversion: (id, payload = {}, confirmToken = "") =>
      request.post(`/admin/referrals/conversions/${id}/reject`, payload, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    createActivationCodes: (payload, confirmToken = "") =>
      request.post("/admin/activation-codes", payload, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    unbindActivationCode: (id, confirmToken = "") =>
      request.post(
        `/admin/activation-codes/${id}/unbind`,
        {},
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    unbindAllActivationCodes: (confirmToken = "") =>
      request.post(
        "/admin/activation-codes/unbind-all",
        {},
        {
          headers: api.admin.adminConfirmHeaders(confirmToken),
        },
      ),
    disableActivationCode: (id, confirmToken = "") =>
      request.patch(`/admin/activation-codes/${id}/disable`, {}, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
    deleteActivationCode: (id, confirmToken = "") =>
      request.delete(`/admin/activation-codes/${id}`, {
        headers: api.admin.adminConfirmHeaders(confirmToken),
      }),
  },
  tokenActivation: {
    bind: (payload) => {
      const normalizedRoleIndex = String(payload?.roleIndex ?? "").trim();
      const bindPayload = {
        ...payload,
      };
      if (!normalizedRoleIndex) {
        delete bindPayload.roleIndex;
      } else {
        bindPayload.roleIndex = normalizedRoleIndex;
      }
      return request.post("/token-activations/bind", bindPayload);
    },
    getStatus: (tokenId, roleId, options = {}) => {
      const normalizedRoleIndex = String(options.roleIndex ?? "").trim();
      const payload = {
        tokenId,
        roleId,
        gameAccountId: roleId,
        sessId: String(options.sessId || "").trim(),
        roleName: options.roleName || "",
        region: options.region || options.server || "",
        server: options.server || options.region || "",
      };
      if (normalizedRoleIndex) {
        payload.roleIndex = normalizedRoleIndex;
      }
      return request.post("/token-activations/status", payload);
    },
    listMine: () => request.get("/token-activations/my"),
  },
};

export default api;
