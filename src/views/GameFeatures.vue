<template>
  <div class="game-features-page app-page">
    <section class="app-page__hero">
      <div class="app-page__hero-copy">
        <span class="app-page__eyebrow">游戏工作区</span>
        <h1 class="app-page__title">{{ t("gameFeatures.title") }}</h1>
        <p class="app-page__description">
          {{ selectedTokenDescription }}
        </p>
        <div class="app-chip-row">
          <span class="app-inline-stat">
            <strong>{{ tokenStore.selectedToken?.name || t("gameFeatures.connection.notSelected") }}</strong>
            当前角色
          </span>
          <span class="app-inline-stat">
            <strong>{{ connectionStatusText }}</strong>
            WebSocket
          </span>
          <span class="app-inline-stat">
            <strong>{{ tokenStore.gameTokens.length }}</strong>
            已导入角色
          </span>
          <span v-if="lastActivity" class="app-inline-stat">
            <strong>{{ lastActivity }}</strong>
            最近状态变更
          </span>
        </div>
      </div>

      <div class="app-page__actions game-features-page__actions">
        <div class="connection-pill" :class="connectionStatus">
          <n-icon>
            <CloudDone></CloudDone>
          </n-icon>
          <span>{{ connectionStatusText }}</span>
        </div>
        <n-button
          size="large"
          :type="isConnected ? 'default' : 'primary'"
          @click="toggleConnection"
        >
          {{
            isConnected
              ? t("gameFeatures.connection.disconnect")
              : t("gameFeatures.connection.reconnect")
          }}
        </n-button>
        <n-button
          v-if="!tokenStore.selectedToken"
          secondary
          size="large"
          type="primary"
          @click="router.push('/tokens')"
        >
          前往 Token 管理
        </n-button>
      </div>
    </section>

    <div class="app-page__summary">
      <article v-for="card in summaryCards" :key="card.label" class="app-summary-card">
        <span class="app-summary-card__label">{{ card.label }}</span>
        <strong class="app-summary-card__value">{{ card.value }}</strong>
        <span class="app-summary-card__meta">{{ card.meta }}</span>
      </article>
    </div>

    <n-grid item-responsive responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item span="24">
        <section class="app-section-card game-features-panel">
          <div class="section-head">
            <div>
              <h2>功能面板</h2>
            </div>
          </div>
          <GameStatus></GameStatus>
        </section>
      </n-grid-item>

      <n-grid-item span="24">
        <section class="app-section-card connection-card">
          <div class="section-head">
            <div>
              <h2>{{ t("gameFeatures.connection.title") }}</h2>
            </div>
          </div>

          <div class="status-list">
            <div class="status-row">
              <span>{{ t("gameFeatures.connection.websocketStatus") }}</span>
              <strong :class="connectionClass">{{ connectionStatusText }}</strong>
            </div>
            <div class="status-row">
              <span>{{ t("gameFeatures.connection.currentToken") }}</span>
              <strong>{{ tokenStore.selectedToken?.name || t("gameFeatures.connection.notSelected") }}</strong>
            </div>
            <div class="status-row">
              <span>角色服务器</span>
              <strong>{{ tokenStore.selectedToken?.server || "待选择" }}</strong>
            </div>
            <div class="status-row">
              <span>{{ t("gameFeatures.connection.lastActivity") }}</span>
              <strong>{{ lastActivity || "暂无" }}</strong>
            </div>
          </div>
        </section>

      </n-grid-item>
    </n-grid>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useMessage } from "naive-ui/es";
import { useI18n } from "vue-i18n";
import GameStatus from "@/components/GameStatus.vue";
import { useGameFeatureActions } from "@/composables/useGameFeatureActions";
import { useTokenStore } from "@/stores/tokenStore";
import { CloudDone } from "@vicons/ionicons5";

const router = useRouter();
const message = useMessage();
const tokenStore = useTokenStore();
const { t } = useI18n();

const lastActivity = ref(null);

const connectionStatus = computed(() => {
  if (!tokenStore.selectedToken) {
    return "disconnected";
  }
  const status = tokenStore.getWebSocketStatus(tokenStore.selectedToken.id);
  return status === "connected" ? "connected" : "disconnected";
});

const connectionStatusText = computed(() => {
  if (!tokenStore.selectedToken) {
    return t("gameFeatures.connection.notSelected");
  }
  const status = tokenStore.getWebSocketStatus(tokenStore.selectedToken.id);
  return status === "connected"
    ? t("gameFeatures.connection.connected")
    : t("gameFeatures.connection.disconnected");
});

const connectionClass = computed(() => {
  return connectionStatus.value === "connected"
    ? "status-connected"
    : "status-disconnected";
});

const isConnected = computed(() => connectionStatus.value === "connected");

const selectedTokenDescription = computed(() => {
  if (!tokenStore.selectedToken) {
    return "还没有选中角色，先去 Token 管理页导入并选择角色，再回到这里拉起连接。";
  }

  return `${tokenStore.selectedToken.name} · ${tokenStore.selectedToken.server || "未知服务器"}`;
});

const summaryCards = computed(() => [
  {
    label: "当前角色",
    value: tokenStore.selectedToken?.name || "未选择",
    meta: tokenStore.selectedToken?.server || "去 Token 管理页完成导入与选择",
  },
  {
    label: "连接状态",
    value: connectionStatusText.value,
    meta: isConnected.value ? "可直接使用功能面板" : "可在右侧重新建立连接",
  },
  {
    label: "角色总数",
    value: String(tokenStore.gameTokens.length),
    meta: "当前账号已导入角色数量",
  },
  {
    label: "当前建议",
    value: tokenStore.selectedToken ? "检查连接状态" : "先导入 Token",
    meta: tokenStore.selectedToken ? "保持连接稳定后再执行功能" : "导入后再进入本页",
  },
]);

const {
  connectWebSocket,
  initializeGameData,
  toggleConnection: toggleGameFeatureConnection,
} = useGameFeatureActions({
  message,
  router,
  t,
  tokenStore,
});

const updateLastActivity = () => {
  lastActivity.value = new Date().toLocaleString();
};

const toggleConnection = async () => {
  await toggleGameFeatureConnection(connectionStatus.value);
  updateLastActivity();
};

onMounted(() => {
  if (!tokenStore.hasUsableWorkbenchToken) {
    message.warning("当前没有已激活且未过期的 Token，请先前往 Token 管理完成激活");
    router.replace("/tokens");
    return;
  }
  if (tokenStore.selectedToken) {
    const status = tokenStore.getWebSocketStatus(tokenStore.selectedToken.id);
    if (status !== "connected") {
      connectWebSocket();
    } else {
      initializeGameData();
    }
    updateLastActivity();
  }
});

watch(
  () => {
    if (!tokenStore.selectedToken) {
      return { status: "disconnected", lastError: null };
    }
    const conn = tokenStore.wsConnections[tokenStore.selectedToken.id];
    return { status: conn?.status, lastError: conn?.lastError };
  },
  (cur, prev) => {
    if (!cur) {
      return;
    }

    if (cur.status !== prev?.status) {
      updateLastActivity();
    }

    if (cur.status === "error" && cur.lastError) {
      const err = String(cur.lastError.error || "").toLowerCase();
      if (err.includes("token") && err.includes("expired")) {
        const importMethod = tokenStore.selectedToken?.importMethod;
        if (
          importMethod === "url"
          || importMethod === "bin"
          || importMethod === "wxQrcode"
        ) {
          message.warning(t("gameFeatures.messages.tokenExpiredRefreshing"));
          return;
        }
        message.error(t("gameFeatures.messages.tokenExpiredReimport"));
        router.push("/tokens");
      }
    }
  },
  { deep: true },
);
</script>

<style scoped lang="scss">
.game-features-page {
  min-height: 100dvh;
  padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));
  animation: gf-fade-in 0.42s ease;
}

.game-features-page__actions {
  align-items: flex-start;
}

.game-features-panel,
.connection-card,
.tips-card {
  padding: clamp(18px, 2vw, 24px);
}

.game-features-panel {
  padding: clamp(12px, 1.4vw, 18px);
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);

  h2 {
    margin: 0 0 6px;
    font-size: var(--font-size-xl);
    color: var(--text-primary);
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.6;
  }
}

.connection-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 10px 14px;
  border-radius: 999px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  border: 1px solid transparent;
  background: rgba(32, 128, 240, 0.08);

  &.connected {
    color: var(--success-color);
    background: rgba(24, 160, 88, 0.1);
    border-color: rgba(24, 160, 88, 0.24);
  }

  &.disconnected {
    color: var(--error-color);
    background: rgba(208, 48, 80, 0.1);
    border-color: rgba(208, 48, 80, 0.24);
  }
}

.status-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  padding: 14px 0;
  border-bottom: 1px solid var(--border-light);

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  span {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }

  strong {
    color: var(--text-primary);
    text-align: right;
    font-size: var(--font-size-sm);
    font-family: var(--font-family-mono);
    font-variant-numeric: tabular-nums;
    word-break: break-word;
  }
}

.status-connected {
  color: var(--success-color) !important;
}

.status-disconnected {
  color: var(--error-color) !important;
}

.tips-card {
  margin-top: 16px;
}

.tips-list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  display: grid;
  gap: 10px;
  line-height: 1.6;
}

@media (max-width: 959px) {
  .game-features-panel,
  .connection-card,
  .tips-card {
    padding: var(--spacing-lg);
  }

  .tips-card {
    margin-top: 0;
  }
}

@media (max-width: 640px) {
  .game-features-page :deep(.n-button) {
    min-height: 40px;
  }

  .status-row {
    flex-direction: column;
    align-items: flex-start;

    strong {
      text-align: left;
    }
  }
}

@keyframes gf-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
