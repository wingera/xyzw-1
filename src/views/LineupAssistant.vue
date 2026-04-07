<template>
  <div class="lineup-assistant-page app-page">
    <section class="app-page__hero">
      <div class="app-page__hero-copy">
        <span class="app-page__eyebrow">阵容助手</span>
        <h1 class="app-page__title">独立阵容管理界面</h1>
        <p class="app-page__description">
          {{ selectedTokenDescription }}
        </p>
        <div class="app-chip-row">
          <span class="app-inline-stat">
            <strong>{{ tokenStore.selectedToken?.name || "未选择" }}</strong>
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
          <span class="app-inline-stat">
            <strong>{{ tokenStore.selectedToken?.server || "待选择" }}</strong>
            服务器
          </span>
        </div>
      </div>

      <div class="app-page__actions lineup-assistant-page__actions">
        <n-button
          size="large"
          type="primary"
          @click="handleToggleConnection"
        >
          <template #icon>
            <n-icon>
              <CloudDone></CloudDone>
            </n-icon>
          </template>
          {{ isConnected ? "断开连接" : "连接 / 重连" }}
        </n-button>

        <n-button
          size="large"
          :disabled="!tokenStore.selectedToken"
          @click="refreshWorkbenchContext"
        >
          <template #icon>
            <n-icon>
              <Refresh></Refresh>
            </n-icon>
          </template>
          刷新基础数据
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

    <n-alert
      v-if="!tokenStore.selectedToken"
      class="lineup-assistant-alert"
      type="warning"
      :show-icon="false"
    >
      当前还没有选中角色。先到 Token 管理页选择角色，再回来读取、保存或应用阵容。
    </n-alert>

    <n-alert
      v-else-if="!isConnected"
      class="lineup-assistant-alert"
      type="warning"
      :show-icon="false"
    >
      当前 WebSocket 未连接。连接成功后，本页会自动拉取阵容、武将、鱼灵和科技数据。
    </n-alert>

    <n-alert
      v-else
      class="lineup-assistant-alert"
      type="success"
      :show-icon="false"
    >
      连接正常，可以直接刷新当前阵容、保存本地方案、导入导出 JSON，并一键应用到当前阵容槽位。
    </n-alert>

    <div class="lineup-assistant-shell">
      <Unlimitedlineup></Unlimitedlineup>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { NIcon, useMessage } from "naive-ui/es";
import { CloudDone, Refresh } from "@vicons/ionicons5";
import Unlimitedlineup from "@/components/cards/Unlimitedlineup.vue";
import { useGameFeatureActions } from "@/composables/useGameFeatureActions";
import { useTokenStore } from "@/stores/tokenStore";

const router = useRouter();
const message = useMessage();
const tokenStore = useTokenStore();
const { t } = useI18n();

const connectionStatus = computed(() => {
  if (!tokenStore.selectedToken) {
    return "disconnected";
  }
  return tokenStore.getWebSocketStatus(tokenStore.selectedToken.id) || "disconnected";
});

const connectionStatusText = computed(() => {
  if (!tokenStore.selectedToken) {
    return "未选择角色";
  }

  switch (connectionStatus.value) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "error":
      return "连接异常";
    default:
      return "未连接";
  }
});

const isConnected = computed(() => connectionStatus.value === "connected");

const selectedTokenDescription = computed(() => {
  if (!tokenStore.selectedToken) {
    return "先在 Token 管理页选择角色，再进入这里统一管理阵容保存、导入导出和快速应用。";
  }

  if (!isConnected.value) {
    return `${tokenStore.selectedToken.name} · ${tokenStore.selectedToken.server || "未知服务器"}，当前角色已选中，但还没有建立 WebSocket 连接。`;
  }

  return `${tokenStore.selectedToken.name} · ${tokenStore.selectedToken.server || "未知服务器"}，当前可以直接读取阵容、保存配置并应用阵容方案。`;
});

const summaryCards = computed(() => [
  {
    label: "当前角色",
    value: tokenStore.selectedToken?.name || "未选择",
    meta: tokenStore.selectedToken?.server || "请先去 Token 管理页选择角色",
  },
  {
    label: "连接状态",
    value: connectionStatusText.value,
    meta: isConnected.value ? "可直接操作阵容" : "先建立连接再读取数据",
  },
  {
    label: "角色总数",
    value: String(tokenStore.gameTokens.length),
    meta: "当前账号下已导入的角色数量",
  },
  {
    label: "当前建议",
    value: tokenStore.selectedToken ? (isConnected.value ? "刷新后开始使用" : "先连接 WebSocket") : "先选择角色",
    meta: tokenStore.selectedToken
      ? (isConnected.value ? "建议先点一次刷新基础数据" : "连接成功后会自动初始化必要数据")
      : "没有当前角色时无法读取阵容信息",
  },
]);

const {
  connectWebSocket,
  initializeGameData,
  toggleConnection,
} = useGameFeatureActions({
  message,
  router,
  t,
  tokenStore,
});

const refreshWorkbenchContext = async () => {
  if (!tokenStore.selectedToken) {
    message.warning("请先选择 Token");
    router.push("/tokens");
    return;
  }

  if (!isConnected.value) {
    connectWebSocket();
    return;
  }

  await initializeGameData();
  message.success("基础数据已刷新");
};

const handleToggleConnection = async () => {
  await toggleConnection(connectionStatus.value);
};

onMounted(() => {
  if (!tokenStore.hasUsableWorkbenchToken) {
    message.warning("当前没有已激活且未过期的 Token，请先前往 Token 管理完成激活");
    router.replace("/tokens");
    return;
  }

  if (!tokenStore.selectedToken) {
    return;
  }

  if (connectionStatus.value === "connected") {
    initializeGameData();
    return;
  }

  if (connectionStatus.value !== "connecting") {
    connectWebSocket();
  }
});

watch(
  () => tokenStore.selectedToken?.id,
  (tokenId, oldTokenId) => {
    if (!tokenId || tokenId === oldTokenId) {
      return;
    }

    const status = tokenStore.getWebSocketStatus(tokenId);
    if (status === "connected") {
      initializeGameData();
    }
  },
);

watch(connectionStatus, (status, oldStatus) => {
  if (status === "connected" && oldStatus !== "connected") {
    initializeGameData();
  }
});
</script>

<style scoped lang="scss">
.lineup-assistant-page__actions {
  align-items: flex-start;
}

.lineup-assistant-alert {
  margin-bottom: 16px;
}

.lineup-assistant-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lineup-assistant-page :deep(.lineup-saver) {
  min-height: auto;
}

@media (max-width: 768px) {
  .lineup-assistant-page__actions {
    width: 100%;
  }
}
</style>
