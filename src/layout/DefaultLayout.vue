<template>
  <n-layout has-sider class="app-shell">
    <n-layout-sider
      v-if="!isMobile"
      bordered
      class="app-shell__sider"
      collapse-mode="width"
      show-trigger="bar"
      :collapsed="isSiderCollapsed"
      :collapsed-width="APP_SIDER_COLLAPSED_WIDTH"
      :native-scrollbar="false"
      :width="APP_SIDER_WIDTH"
      @update:collapsed="isSiderCollapsed = $event"
    >
      <div class="app-shell__sider-inner">
        <button class="app-shell__brand" type="button" @click="router.push('/admin/dashboard')">
          <img alt="XYZW" class="app-shell__brand-logo" src="/icons/xiaoyugan.png">
          <div v-if="!isSiderCollapsed" class="app-shell__brand-copy">
            <strong>XYZW 控制台</strong>
            <span>{{ authStore.user?.username || "未登录" }}</span>
          </div>
        </button>

        <div v-if="!isSiderCollapsed" class="app-shell__context-card">
          <span class="app-shell__context-label">当前角色</span>
          <strong>{{ selectedToken?.name || "未选择 Token" }}</strong>
          <span class="app-shell__context-meta">{{ selectedToken?.server || "导入角色后即可开始" }}</span>
        </div>

        <n-menu
          class="app-shell__menu"
          :collapsed="isSiderCollapsed"
          :collapsed-icon-size="20"
          :collapsed-width="APP_SIDER_COLLAPSED_WIDTH"
          :indent="18"
          :options="menuOptions"
          :value="activeMenuValue"
          @update:value="handleMenuSelect"
        ></n-menu>

        <div v-if="!isSiderCollapsed" class="app-shell__sider-footer">
          <span class="app-shell__status-title">连接状态</span>
          <div class="app-shell__status-row">
            <span class="app-shell__status-dot" :class="`is-${selectedTokenStatus}`"></span>
            <span>{{ selectedTokenStatusText }}</span>
          </div>
          <div class="app-shell__version-list">
            <div class="app-shell__version-row">
              <span class="app-shell__version-label">前端版本</span>
              <strong>{{ frontendVersionText }}</strong>
            </div>
            <div class="app-shell__version-row">
              <span class="app-shell__version-label">后端版本</span>
              <strong>{{ backendVersionText }}</strong>
            </div>
          </div>
        </div>
      </div>
    </n-layout-sider>

    <n-layout class="app-shell__main">
      <n-layout-header bordered class="app-shell__header">
        <div class="app-shell__header-left">
          <n-button
            v-if="isMobile"
            circle
            quaternary
            size="large"
            @click="isMobileMenuOpen = true"
          >
            <template #icon>
              <NIcon>
                <Menu></Menu>
              </NIcon>
            </template>
          </n-button>

          <div class="app-shell__page-copy">
            <span class="app-shell__page-kicker">{{ currentPageGroup }}</span>
            <strong>{{ currentPageTitle }}</strong>
            <span class="app-shell__page-meta">{{ currentPageMeta }}</span>
          </div>
        </div>

        <div class="app-shell__header-right">
          <div class="app-shell__token-pill" :class="`is-${selectedTokenStatus}`">
            <span class="app-shell__token-pill-label">{{ selectedTokenStatusText }}</span>
            <strong>{{ selectedToken?.name || "未选择角色" }}</strong>
          </div>

          <n-popover placement="bottom-end" trigger="click" @update:show="handleNotifyPopover">
            <template #trigger>
              <button class="notify-trigger" type="button" @click="fetchNotifications">
                <n-badge :max="99" :show="unreadCount > 0" :value="unreadBadgeValue">
                  <NIcon>
                    <Notifications></Notifications>
                  </NIcon>
                </n-badge>
              </button>
            </template>
            <div class="notify-panel">
              <div class="notify-panel__head">
                <strong>站内通知</strong>
                <div class="notify-panel__head-actions">
                  <n-button
                    quaternary
                    size="tiny"
                    :disabled="!unreadCount"
                    @click="markAllNotificationsRead"
                  >
                    全部已读
                  </n-button>
                  <n-button
                    quaternary
                    size="tiny"
                    :disabled="!notifications.length"
                    @click="clearAllNotifications"
                  >
                    清空历史
                  </n-button>
                </div>
              </div>
              <div v-if="notifications.length" class="notify-panel__list">
                <button
                  v-for="item in notifications"
                  :key="item.id"
                  class="notify-panel__item"
                  type="button"
                  :class="{ 'notify-panel__item--unread': !item.isRead }"
                  @click="handleNotificationClick(item)"
                >
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.content }}</p>
                  <span>{{ formatDate(item.createdAt) }}</span>
                </button>
              </div>
              <n-empty v-else description="暂无通知" :show-icon="false"></n-empty>
            </div>
          </n-popover>

          <ThemeToggle></ThemeToggle>

          <n-dropdown :options="userMenuOptions" @select="handleUserAction">
            <button class="user-info" type="button">
              <n-avatar
                round
                fallback-src="/icons/xiaoyugan.png"
                size="medium"
                :src="selectedToken?.avatar || '/icons/xiaoyugan.png'"
              ></n-avatar>
              <div class="user-meta">
                <span class="username">{{ authStore.user?.username || "未登录" }}</span>
                <span class="token-hint">{{ selectedToken?.name || "进入 Token 管理" }}</span>
              </div>
              <NIcon>
                <ChevronDown></ChevronDown>
              </NIcon>
            </button>
          </n-dropdown>
        </div>
      </n-layout-header>

      <n-layout-content class="app-shell__content-layout" :native-scrollbar="false">
        <div class="app-shell__content">
          <router-view v-slot="{ Component, route }">
            <transition appear mode="out-in" name="page-panel">
              <component :is="Component" :key="route.fullPath"></component>
            </transition>
          </router-view>
        </div>
      </n-layout-content>
    </n-layout>
  </n-layout>

  <n-drawer placement="left" v-model:show="isMobileMenuOpen" :width="APP_DRAWER_WIDTH">
    <n-drawer-content closable title="工作区" :native-scrollbar="false">
      <div class="app-shell__drawer-head">
        <img alt="XYZW" class="app-shell__drawer-logo" src="/icons/xiaoyugan.png">
        <div>
          <strong>XYZW 控制台</strong>
          <p>{{ authStore.user?.username || "未登录" }}</p>
        </div>
      </div>

      <div class="app-shell__drawer-token">
        <span>当前角色</span>
        <strong>{{ selectedToken?.name || "未选择 Token" }}</strong>
      </div>

      <n-menu
        class="app-shell__drawer-menu"
        :options="menuOptions"
        :value="activeMenuValue"
        @update:value="handleMobileMenuSelect"
      ></n-menu>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import packageInfo from "../../package.json";
import { selectedToken, useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/auth";
import ThemeToggle from "@/components/Common/ThemeToggle.vue";
import api from "@/api";
import { useResponsive } from "@/composables/useResponsive";
import {
  APP_DRAWER_WIDTH,
  APP_SIDER_COLLAPSED_WIDTH,
  APP_SIDER_WIDTH,
} from "@/constants/ui";
import { isNowInLegionWarTime } from "@/utils/clubBattleUtils";
import { canAccessAdminCenter, hasGameFeatureAccess } from "@/utils/accessScope";
import {
  ChevronDown,
  Cube,
  Home,
  LockOpen,
  Megaphone,
  Menu,
  Notifications,
  People,
  PersonCircle,
  Receipt,
  Settings,
} from "@vicons/ionicons5";
import { NIcon, useDialog, useMessage } from "naive-ui/es";
import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

const tokenStore = useTokenStore();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();
const dialog = useDialog();
const message = useMessage();
const { t } = useI18n();
const { isMobile } = useResponsive();
const MFA_SUGGESTION_SESSION_KEY = "xyzw:post-login-mfa-suggestion";
const hasShownMfaSuggestion = ref(false);

const isMobileMenuOpen = ref(false);
const notifications = ref([]);
const notificationTimer = ref(null);
const unreadCount = computed(
  () => notifications.value.filter((item) => !item.isRead).length,
);
const canAccessGameFeatures = computed(() => hasGameFeatureAccess(authStore.user));
const canOpenAdminCenter = computed(() => canAccessAdminCenter(authStore.user));
const canOpenWorkbenchFeatures = computed(() => tokenStore.hasUsableWorkbenchToken);
const unreadBadgeValue = computed(() => (unreadCount.value > 99 ? "99+" : unreadCount.value));
const backendBuildInfo = ref(null);
const hasLoadedBuildInfo = ref(false);
const isSiderCollapsed = ref(
  typeof window !== "undefined" && window.localStorage.getItem("ui:sider-collapsed") === "true",
);
const frontendVersionText = computed(() => {
  const version = String(
    import.meta.env.VITE_APP_VERSION
    || packageInfo?.version
    || backendBuildInfo.value?.appVersion
    || "",
  ).trim();
  return version ? `v${version}` : "未提供";
});
const backendVersionText = computed(() => {
  const version = String(backendBuildInfo.value?.backendVersion || "").trim();
  if (version) {
    return `v${version}`;
  }
  return hasLoadedBuildInfo.value ? "未提供" : "读取中";
});

const selectedTokenStatus = computed(() => {
  if (!selectedToken.value) {
    return "idle";
  }
  return tokenStore.getWebSocketStatus(selectedToken.value.id) || "idle";
});

const selectedTokenStatusText = computed(() => {
  switch (selectedTokenStatus.value) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "error":
      return "连接异常";
    case "disconnected":
      return "未连接";
    default:
      return "待开始";
  }
});

const renderIcon = (icon) => () => h(NIcon, null, { default: () => h(icon) });

const workspaceMenuOptions = computed(() => {
  const options = [
    { label: "控制台", key: "/admin/dashboard", icon: renderIcon(Home) },
    { label: "Token 管理", key: "/tokens", icon: renderIcon(PersonCircle) },
    { label: "推广中心", key: "/admin/referral-center", icon: renderIcon(Megaphone) },
  ];

  if (canOpenWorkbenchFeatures.value) {
    options.push(
      { label: "游戏功能", key: "/admin/game-features", icon: renderIcon(Cube) },
      { label: "阵容助手", key: "/admin/lineup-assistant", icon: renderIcon(Cube) },
      { label: "任务控制", key: "/admin/task-control", icon: renderIcon(Settings) },
    );
  }

  if (canAccessGameFeatures.value && isNowInLegionWarTime()) {
    options.push({
      label: "实时盐场",
      key: "/admin/legion-war",
      icon: renderIcon(LockOpen),
    });
  }

  return options;
});

const supportMenuOptions = [
  { label: "个人设置", key: "/admin/profile", icon: renderIcon(Settings) },
  { label: "功能反馈", key: "/admin/feedback", icon: renderIcon(Megaphone) },
];

const adminMenuOptions = [
  { label: "账号管理", key: "/admin/admin-users", icon: renderIcon(People) },
  { label: "邀请码管理", key: "/admin/admin-invites", icon: renderIcon(People) },
  { label: "激活码管理", key: "/admin/activation-codes", icon: renderIcon(People) },
  { label: "推广邀请管理", key: "/admin/referrals", icon: renderIcon(Megaphone) },
  { label: "微信联系配置", key: "/admin/wechat-contacts", icon: renderIcon(People) },
  { label: "工单管理", key: "/admin/feedback-tickets", icon: renderIcon(Receipt) },
  { label: "后端任务日志", key: "/admin/task-control-logs", icon: renderIcon(Receipt) },
  { label: "更新日志广播", key: "/admin/changelog-broadcast", icon: renderIcon(Receipt) },
];

const menuOptions = computed(() => {
  const options = [
    {
      type: "group",
      label: "工作区",
      key: "workspace-group",
      children: workspaceMenuOptions.value,
    },
    {
      type: "group",
      label: "账户与帮助",
      key: "support-group",
      children: supportMenuOptions,
    },
  ];

  if (canOpenAdminCenter.value) {
    options.push({
      type: "group",
      label: "管理中心",
      key: "admin-group",
      children: adminMenuOptions,
    });
  }

  return options;
});

const flattenMenuOptions = (options, groupLabel = "") => {
  return options.flatMap((option) => {
    if (option.type === "group") {
      return flattenMenuOptions(option.children || [], option.label || groupLabel);
    }
    return [{ ...option, groupLabel }];
  });
};

const flatMenuOptions = computed(() => flattenMenuOptions(menuOptions.value));
const activeMenuValue = computed(() => route.path);
const activeMenuItem = computed(() => {
  return flatMenuOptions.value.find((item) => item.key === route.path) || null;
});
const currentPageTitle = computed(() => String(route.meta?.title || activeMenuItem.value?.label || "工作台"));
const currentPageGroup = computed(() => String(activeMenuItem.value?.groupLabel || "工作区"));
const currentPageMeta = computed(() => {
  const pieces = [authStore.user?.username || "未登录"];
  if (selectedToken.value?.name) {
    pieces.push(`当前角色：${selectedToken.value.name}`);
  }
  return pieces.join(" · ");
});

const userMenuOptions = [
  {
    label: "个人设置",
    key: "profile",
  },
  {
    label: "退出账号",
    key: "logout-account",
  },
  {
    label: "仅清除当前账号Token",
    key: "clear-tokens",
  },
];

const persistSiderState = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem("ui:sider-collapsed", String(isSiderCollapsed.value));
};

const handleMenuSelect = (path) => {
  if (typeof path === "string" && path) {
    router.push(path);
  }
};

const handleMobileMenuSelect = (path) => {
  handleMenuSelect(path);
  isMobileMenuOpen.value = false;
};

const handleUserAction = async (key) => {
  switch (key) {
    case "profile":
      router.push("/admin/profile");
      break;
    case "logout-account":
      await authStore.logout();
      message.success("已退出当前账号");
      if (typeof window !== "undefined") {
        window.location.replace("/");
      } else {
        router.replace("/");
      }
      break;
    case "clear-tokens":
      await tokenStore.clearAllTokens();
      message.success("已清除当前账号Token");
      router.push("/tokens");
      break;
  }
};

const shouldShowMfaSuggestion = () => {
  if (typeof window === "undefined") {
    return false;
  }
  if (hasShownMfaSuggestion.value) {
    return false;
  }
  if (!authStore.isAuthenticated || !authStore.user?.id) {
    return false;
  }
  if (authStore.user?.mfaEnabled) {
    window.sessionStorage.removeItem(MFA_SUGGESTION_SESSION_KEY);
    return false;
  }
  return window.sessionStorage.getItem(MFA_SUGGESTION_SESSION_KEY) === "1";
};

const maybeShowMfaSuggestion = () => {
  if (!shouldShowMfaSuggestion()) {
    return;
  }
  hasShownMfaSuggestion.value = true;
  window.sessionStorage.removeItem(MFA_SUGGESTION_SESSION_KEY);
  dialog.warning({
    title: t("login.mfaSuggestion.title"),
    content: t("login.mfaSuggestion.content"),
    positiveText: t("login.mfaSuggestion.confirm"),
    negativeText: t("login.mfaSuggestion.cancel"),
    onPositiveClick: () => {
      router.push("/admin/profile");
    },
  });
};

const formatDate = (value) => (value ? new Date(value).toLocaleString("zh-CN") : "-");

const fetchNotifications = async () => {
  if (!authStore.isAuthenticated) {
    notifications.value = [];
    return;
  }

  try {
    const res = await api.notifications.list({ limit: 8 });
    if (res.success) {
      notifications.value = Array.isArray(res.data) ? res.data : [];
    }
  } catch {
    // ignore
  }
};

const fetchBuildInfo = async () => {
  try {
    const res = await api.system.getVersion();
    if (res?.success && res?.data && typeof res.data === "object") {
      backendBuildInfo.value = res.data;
    }
  } catch {
    backendBuildInfo.value = null;
  } finally {
    hasLoadedBuildInfo.value = true;
  }
};

const handleNotifyPopover = (show) => {
  if (show) {
    fetchNotifications();
  }
};

const markAllNotificationsRead = async () => {
  try {
    const res = await api.notifications.markAllRead();
    if (!res.success) {
      message.error(res.message || "操作失败");
      return;
    }
    await fetchNotifications();
  } catch (error) {
    message.error(error.message || "操作失败");
  }
};

const clearAllNotifications = async () => {
  dialog.warning({
    title: "清空历史通知",
    content: "这会清除当前账号的全部站内通知记录，且无法恢复。确定继续吗？",
    positiveText: "清空",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        const res = await api.notifications.clearAll();
        if (!res.success) {
          message.error(res.message || "操作失败");
          return;
        }
        notifications.value = [];
        message.success(res.message || "历史通知已清除");
      } catch (error) {
        message.error(error.message || "操作失败");
      }
    },
  });
};

const handleNotificationClick = async (item) => {
  try {
    if (!item.isRead) {
      await api.notifications.markRead(item.id);
    }
  } catch {
    // ignore
  }
  fetchNotifications();
  const targetPath = String(item?.payload?.path || "").trim();
  if (targetPath.startsWith("/")) {
    router.push(targetPath);
    return;
  }
  if (canOpenAdminCenter.value) {
    router.push("/admin/feedback-tickets");
  } else {
    router.push("/admin/feedback");
  }
};

const startNotificationPolling = () => {
  if (notificationTimer.value) return;
  notificationTimer.value = setInterval(() => {
    fetchNotifications();
  }, 45000);
};

const stopNotificationPolling = () => {
  if (notificationTimer.value) {
    clearInterval(notificationTimer.value);
    notificationTimer.value = null;
  }
};

watch(
  () => authStore.isAuthenticated,
  (authed) => {
    if (authed) {
      fetchNotifications();
      startNotificationPolling();
    } else {
      notifications.value = [];
      stopNotificationPolling();
    }
  },
  { immediate: true },
);

watch(
  () => route.path,
  () => {
    isMobileMenuOpen.value = false;
  },
);

watch(
  () => isSiderCollapsed.value,
  () => {
    persistSiderState();
  },
);

watch(
  () => [authStore.user?.id, authStore.user?.mfaEnabled, route.fullPath],
  () => {
    maybeShowMfaSuggestion();
  },
);

watch(
  () => isMobile.value,
  (mobile) => {
    if (mobile) {
      isMobileMenuOpen.value = false;
    }
  },
  { immediate: true },
);

onMounted(() => {
  fetchBuildInfo();
  if (authStore.isAuthenticated) {
    maybeShowMfaSuggestion();
    fetchNotifications();
    startNotificationPolling();
  }
});

onUnmounted(() => {
  stopNotificationPolling();
});
</script>

<style scoped lang="scss">
.app-shell {
  min-height: 100vh;
  background: transparent;
}

.app-shell__sider {
  backdrop-filter: blur(16px);
}

.app-shell__sider-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px 14px 18px;
  gap: 14px;
}

.app-shell__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 16px;
  width: 100%;
  text-align: left;
  color: var(--text-primary);
  transition: background var(--transition-fast), transform var(--transition-fast);
}

.app-shell__brand:hover {
  background: rgba(63, 119, 173, 0.08);
  transform: translateY(-1px);
}

.app-shell__brand-logo,
.app-shell__drawer-logo {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  box-shadow: var(--shadow-light);
}

.app-shell__brand-copy,
.app-shell__drawer-head div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-shell__brand-copy strong,
.app-shell__drawer-head strong {
  font-size: 16px;
  line-height: 1.2;
}

.app-shell__brand-copy span,
.app-shell__drawer-head p {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.4;
  margin: 0;
}

.app-shell__context-card {
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--surface-glass-strong);
  border: 1px solid var(--surface-glass-border);
  box-shadow: var(--shadow-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.app-shell__context-label,
.app-shell__status-title,
.app-shell__page-kicker {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  font-weight: 600;
}

.app-shell__context-card strong {
  color: var(--text-primary);
  font-size: 15px;
}

.app-shell__context-meta {
  color: var(--text-secondary);
  font-size: 13px;
}

.app-shell__menu {
  flex: 1;
  min-height: 0;
}

.app-shell__sider-footer {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(63, 119, 173, 0.08);
  border: 1px solid rgba(63, 119, 173, 0.16);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-shell__status-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.app-shell__version-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid rgba(63, 119, 173, 0.12);
}

.app-shell__version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.app-shell__version-label {
  color: var(--text-tertiary);
}

.app-shell__version-row strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.app-shell__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--text-tertiary);
}

.app-shell__status-dot.is-connected {
  background: var(--success-color);
}

.app-shell__status-dot.is-connecting {
  background: var(--warning-color);
}

.app-shell__status-dot.is-error,
.app-shell__status-dot.is-disconnected {
  background: var(--error-color);
}

.app-shell__header {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px);
}

[data-theme="dark"] .app-shell__header {
  background: rgba(12, 25, 45, 0.78);
}

.app-shell__header,
.app-shell__content {
  width: min(100%, var(--app-shell-max-width));
  margin: 0 auto;
}

.app-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
}

.app-shell__header-left,
.app-shell__header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-shell__header-left {
  min-width: 0;
  flex: 1;
}

.app-shell__page-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.app-shell__page-copy strong {
  font-size: 22px;
  line-height: 1.1;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-shell__page-meta {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-shell__content-layout {
  background: transparent;
}

.app-shell__content {
  padding: 24px;
}

.app-shell__token-pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(63, 119, 173, 0.08);
  border: 1px solid rgba(63, 119, 173, 0.12);
  max-width: min(340px, 40vw);
}

.app-shell__token-pill strong {
  color: var(--text-primary);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-shell__token-pill-label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.app-shell__token-pill.is-connected {
  background: rgba(24, 160, 88, 0.08);
  border-color: rgba(24, 160, 88, 0.2);
}

.app-shell__token-pill.is-error,
.app-shell__token-pill.is-disconnected {
  background: rgba(188, 90, 113, 0.08);
  border-color: rgba(188, 90, 113, 0.2);
}

.app-shell__token-pill.is-connecting {
  background: rgba(201, 149, 77, 0.08);
  border-color: rgba(201, 149, 77, 0.2);
}

.notify-trigger,
.user-info {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-primary);
  transition: all var(--transition-fast);
}

.notify-trigger {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.notify-trigger:hover,
.user-info:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-light);
}

.notify-panel {
  width: min(360px, calc(100vw - 32px));
}

.notify-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.notify-panel__list {
  display: grid;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}

.notify-panel__item {
  border: 1px solid var(--border-light);
  background: var(--surface-glass-strong);
  border-radius: 12px;
  padding: 10px 12px;
  text-align: left;
  transition: all var(--transition-fast);
}

.notify-panel__item:hover {
  border-color: rgba(15, 107, 255, 0.28);
  transform: translateY(-1px);
}

.notify-panel__item--unread {
  border-color: rgba(15, 107, 255, 0.3);
  background: rgba(15, 107, 255, 0.08);
}

.notify-panel__item strong {
  font-size: 13px;
  color: var(--text-primary);
}

.notify-panel__item p {
  margin: 4px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.notify-panel__item span {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-family-mono);
  font-variant-numeric: tabular-nums;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 14px;
}

.user-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
}

.username {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.token-hint {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.app-shell__drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.app-shell__drawer-token {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(63, 119, 173, 0.08);
  border: 1px solid rgba(63, 119, 173, 0.16);
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.app-shell__drawer-token span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  font-weight: 600;
}

.app-shell__drawer-token strong {
  color: var(--text-primary);
}

@media (max-width: 1279px) {
  .app-shell__token-pill {
    display: none;
  }
}

@media (max-width: 959px) {
  .app-shell__header {
    padding: 12px 16px;
  }

  .app-shell__content {
    padding: 16px;
  }

  .user-meta {
    display: none;
  }

  .user-info {
    padding: 6px;
  }

  .app-shell__page-copy strong {
    font-size: 18px;
  }

  .app-shell__page-meta {
    font-size: 13px;
  }
}

@media (max-width: 640px) {
  .notify-trigger {
    width: 44px;
    height: 44px;
  }

  .app-shell__header-right {
    gap: 8px;
  }

  .app-shell__page-kicker,
  .app-shell__page-meta {
    display: none;
  }

  .app-shell__page-copy strong {
    font-size: 17px;
  }
}
</style>
