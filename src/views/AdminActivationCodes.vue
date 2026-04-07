<template>
  <div v-if="canAccess" class="admin-activation-codes-page">
    <div class="container">
      <div class="page-header">
        <div class="page-header__main">
          <h1>激活码管理</h1>
          <p>为 token 生成一次性激活码，管理绑定账号与有效期。</p>
        </div>

        <div class="activation-creator">
          <div class="activation-creator__field">
            <span class="activation-creator__label">生成数量</span>
            <n-input-number
              v-model:value="createCount"
              :max="100"
              :min="1"
            ></n-input-number>
          </div>
          <div class="activation-creator__field">
            <span class="activation-creator__label">有效时长</span>
            <n-select
              v-model:value="durationMonths"
              :options="durationOptions"
            ></n-select>
          </div>
          <div class="activation-creator__field">
            <span class="activation-creator__label">版本类型</span>
            <n-select
              v-model:value="featureScope"
              :options="featureScopeOptions"
            ></n-select>
          </div>
          <div class="activation-creator__field">
            <span class="activation-creator__label">售价（元）</span>
            <n-input-number
              v-model:value="saleAmountYuan"
              :disabled="isOneDayDuration"
              :min="0"
              :precision="2"
              :step="1"
            ></n-input-number>
            <span class="activation-creator__hint">{{ saleAmountHint }}</span>
          </div>
          <NButton class="activation-creator__button" type="primary" :loading="creating" @click="createCodes">
            生成激活码
          </NButton>
          <NButton
            class="activation-creator__button"
            type="warning"
            :loading="loading"
            @click="unbindAllCodes"
          >
            清空全部绑定
          </NButton>
        </div>
      </div>

      <n-card v-if="!isMobile" embedded>
        <n-data-table
          class="activation-codes-table"
          :columns="columns"
          :data="codes"
          :loading="loading"
          :pagination="{ pageSize: 12 }"
        ></n-data-table>
      </n-card>

      <div v-else class="mobile-list">
        <n-card
          v-for="row in codes"
          :key="row.id"
          embedded
          class="mobile-code-card"
          size="small"
        >
          <div class="mobile-code-top">
            <div class="mobile-code-value">{{ row.code }}</div>
            <NTag size="small" :type="statusTag(row).type">{{ statusTag(row).text }}</NTag>
          </div>
          <div class="mobile-meta-grid">
            <div class="meta-row">
              <span class="meta-label">版本类型</span>
              <span>{{ getFeatureScopeLabel(row.featureScope) }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">时长</span>
              <span>{{ formatDurationLabel(row.durationMonths) }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">售价</span>
              <span>{{ formatSale(row.saleAmountCents, row.saleCurrency) }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">绑定信息</span>
              <span>{{ row.bindingRoleName || "-" }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">到期时间</span>
              <span>{{ formatTime(row.bindingExpiresAt) }}</span>
            </div>
          </div>
          <div class="mobile-actions">
            <NButton
              v-if="canUnbind(row)"
              tertiary
              size="small"
              type="warning"
              @click="unbindCode(row)"
            >
              解绑
            </NButton>
            <NButton tertiary size="small" type="error" @click="deleteCode(row)">删除</NButton>
            <NButton
              v-if="row.isActive && !row.usedAt"
              tertiary
              size="small"
              type="warning"
              @click="disableCode(row)"
            >
              禁用
            </NButton>
          </div>
        </n-card>
        <n-empty
          v-if="!loading && !codes.length"
          description="暂无激活码"
        ></n-empty>
      </div>

      <n-modal
        class="created-codes-modal"
        preset="card"
        title="一次性激活码"
        :mask-closable="false"
        :show="showCreatedCodesModal"
        @update:show="handleCreatedCodesModalUpdate"
      >
        <div class="created-codes-modal__body">
          <p class="created-codes-modal__hint">
            完整激活码只会在创建当次显示一次，关闭后列表里只保留打码值。
          </p>
          <div class="created-codes-modal__list">
            <code
              v-for="code in createdCodesPlaintext"
              :key="code"
              class="created-codes-modal__item"
            >{{ code }}</code>
          </div>
        </div>
        <template #footer>
          <div class="created-codes-modal__actions">
            <NButton tertiary @click="copyCreatedCodes">
              复制
            </NButton>
            <NButton type="primary" @click="closeCreatedCodesModal">
              我已保存
            </NButton>
          </div>
        </template>
      </n-modal>
    </div>
  </div>
</template>

<script setup>
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NButton, NInput, NTag, useDialog, useMessage } from "naive-ui/es";
import { useRouter } from "vue-router";
import api from "@/api";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const authStore = useAuthStore();

const canAccess = computed(() => authStore.isAuthenticated && authStore.user?.isAdmin);
const loading = ref(false);
const creating = ref(false);
const createCount = ref(1);
const durationMonths = ref(1);
const featureScope = ref("full");
const saleAmountYuan = ref(0);
const codes = ref([]);
const isMobile = ref(false);
const MOBILE_BREAKPOINT = 768;
const sensitiveConfirmToken = ref("");
const sensitiveConfirmExpiresAt = ref(0);
const showCreatedCodesModal = ref(false);
const createdCodesPlaintext = ref([]);
const ONE_DAY_DURATION_MONTHS = 0;

const durationOptions = [
  { label: "1天", value: ONE_DAY_DURATION_MONTHS },
  { label: "1个月", value: 1 },
  { label: "1季度", value: 3 },
  { label: "半年", value: 6 },
  { label: "一年", value: 12 },
];
const ACTIVATION_SALE_PRICE_PRESETS = Object.freeze({
  task_control_only: Object.freeze({
    0: 0,
    1: 6,
    3: 16,
    6: 30,
    12: 58,
  }),
  full: Object.freeze({
    0: 0,
    1: 30,
    3: 85,
    6: 165,
    12: 300,
  }),
});
const featureScopeOptions = [
  { label: "全功能", value: "full" },
  { label: "普通版本", value: "task_control_only" },
];

const getFeatureScopeLabel = (value) =>
  String(value || "").trim() === "task_control_only" ? "普通版本" : "全功能";

const normalizeDurationValue = (value) =>
  Number(value) === ONE_DAY_DURATION_MONTHS ? ONE_DAY_DURATION_MONTHS : Number(value) || 1;

const formatDurationLabel = (value) => {
  const normalized = normalizeDurationValue(value);
  if (normalized === ONE_DAY_DURATION_MONTHS) {
    return "1天";
  }
  return `${Math.max(1, normalized)}个月`;
};

const formatYuan = (value) => {
  const amount = Number(value) || 0;
  if (Number.isInteger(amount)) {
    return `¥${amount}`;
  }
  return `¥${amount.toFixed(2)}`;
};

const getPresetSaleAmountYuan = (scope, months) => {
  const scopeKey = String(scope || "").trim() === "task_control_only" ? "task_control_only" : "full";
  const monthKey = normalizeDurationValue(months);
  return Number(ACTIVATION_SALE_PRICE_PRESETS[scopeKey]?.[monthKey] || 0);
};

const isOneDayDuration = computed(() => normalizeDurationValue(durationMonths.value) === ONE_DAY_DURATION_MONTHS);
const presetPriceSummary = computed(() =>
  durationOptions
    .map((option) => `${formatDurationLabel(option.value)} ${formatYuan(getPresetSaleAmountYuan(featureScope.value, option.value))}`)
    .join(" / "));
const saleAmountHint = computed(() =>
  isOneDayDuration.value
    ? "1天激活码固定 ¥0"
    : `${getFeatureScopeLabel(featureScope.value)}：${presetPriceSummary.value}`);

const formatTime = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleString();
};

const formatSale = (amountCents, currency = "CNY") => {
  const amount = Math.max(0, Number(amountCents) || 0) / 100;
  return `¥${amount.toFixed(2)} ${String(currency || "CNY").trim() || "CNY"}`;
};

const statusTag = (row) => {
  if (row.usedAt) {
    return { type: "success", text: "已使用" };
  }
  if (!row.isActive) {
    return { type: "warning", text: "已禁用" };
  }
  return { type: "info", text: "可用" };
};

const canUnbind = (row) =>
  Boolean(
    row?.bindingId
    || row?.bindingTokenId
    || row?.bindingRoleId
    || row?.usedAt,
  );

const formatBindingAccount = (row) => {
  const roleName = String(row?.bindingRoleName || "").trim();
  const region = String(row?.bindingRegion || "").trim();
  const roleId = String(row?.bindingRoleId || row?.boundGameAccountId || "").trim();
  const sessId = String(row?.bindingSessId || row?.bindingSessionId || "").trim();
  if (!roleName && !region && !roleId) return "-";
  return [
    sessId || "无SessID",
    roleId || "-",
    region || "未知大区",
    roleName || "未命名角色",
  ].join(" / ");
};

const getCachedSensitiveConfirmToken = () => {
  if (
    sensitiveConfirmToken.value
    && Number.isFinite(sensitiveConfirmExpiresAt.value)
    && sensitiveConfirmExpiresAt.value > Date.now() + 3000
  ) {
    return sensitiveConfirmToken.value;
  }
  return "";
};

const clearSensitiveConfirmToken = () => {
  sensitiveConfirmToken.value = "";
  sensitiveConfirmExpiresAt.value = 0;
};

const promptSensitiveCredential = ({ actionLabel = "高危操作" } = {}) =>
  new Promise((resolve) => {
    const mfaEnabled = Boolean(authStore.user?.mfaEnabled);
    const password = ref("");
    const totpCode = ref("");
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || null);
    };

    dialog.warning({
      title: "安全确认",
      positiveText: "确认",
      negativeText: "取消",
      content: () =>
        h("div", { style: "display:flex;flex-direction:column;gap:12px;" }, [
          h(
            "div",
            { style: "line-height:1.6;" },
            mfaEnabled
              ? `执行“${actionLabel}”前，请输入认证器当前显示的 6 位动态验证码完成二次验证`
              : `执行“${actionLabel}”前，请输入当前管理员密码完成二次验证`,
          ),
          h(NInput, {
            type: mfaEnabled ? "text" : "password",
            showPasswordOn: mfaEnabled ? undefined : "click",
            value: mfaEnabled ? totpCode.value : password.value,
            maxlength: mfaEnabled ? 6 : undefined,
            placeholder: mfaEnabled ? "输入 6 位动态验证码" : "输入当前管理员密码",
            autofocus: true,
            onUpdateValue: (value) => {
              if (mfaEnabled) {
                totpCode.value = String(value || "").replace(/\D/g, "");
                return;
              }
              password.value = String(value || "");
            },
          }),
        ]),
      onPositiveClick: () => {
        if (mfaEnabled) {
          const normalized = String(totpCode.value || "").replace(/\D/g, "");
          if (!normalized) {
            message.warning("请输入 6 位动态验证码");
            return false;
          }
          finish({ totpCode: normalized });
          return true;
        }
        const normalized = String(password.value || "").trim();
        if (!normalized) {
          message.warning("请输入当前管理员密码");
          return false;
        }
        finish({ password: normalized });
        return true;
      },
      onNegativeClick: () => finish(null),
      onClose: () => finish(null),
    });
  });

const ensureSensitiveActionConfirmed = async (actionLabel = "高危操作") => {
  const cached = getCachedSensitiveConfirmToken();
  if (cached) return cached;

  const credential = await promptSensitiveCredential({ actionLabel });
  if (!credential) {
    message.warning("已取消二次验证");
    return "";
  }
  try {
    const res = await api.admin.confirmSensitiveAction(credential);
    if (!res?.success || !res?.data?.token) {
      message.error(res?.message || "二次验证失败");
      return "";
    }
    const expiresTs = new Date(res.data.expiresAt || "").getTime();
    sensitiveConfirmToken.value = String(res.data.token || "");
    sensitiveConfirmExpiresAt.value = Number.isFinite(expiresTs)
      ? expiresTs
      : Date.now() + 5 * 60 * 1000;
    message.success("二次验证通过（5分钟内有效）");
    return sensitiveConfirmToken.value;
  } catch (error) {
    message.error(error.message || "二次验证失败");
    return "";
  }
};

const disableCode = async (row) => {
  try {
    const confirmToken = await ensureSensitiveActionConfirmed("禁用激活码");
    if (!confirmToken) return;
    const res = await api.admin.disableActivationCode(row.id, confirmToken);
    if (!res?.success) {
      message.error(res?.message || "禁用失败");
      return;
    }
    message.success(res.message || "已禁用");
    await loadCodes();
  } catch (error) {
    if (Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403) {
      clearSensitiveConfirmToken();
    }
    message.error(error.message || "禁用失败");
  }
};

const deleteCode = async (row) => {
  const ok = window.confirm(`确认删除激活码 ${row.code} 吗？`);
  if (!ok) return;
  try {
    const confirmToken = await ensureSensitiveActionConfirmed("删除激活码");
    if (!confirmToken) return;
    const res = await api.admin.deleteActivationCode(row.id, confirmToken);
    if (!res?.success) {
      message.error(res?.message || "删除失败");
      return;
    }
    message.success(res.message || "已删除");
    await loadCodes();
  } catch (error) {
    if (Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403) {
      clearSensitiveConfirmToken();
    }
    message.error(error.message || "删除失败");
  }
};

const unbindCode = async (row) => {
  const ok = window.confirm(`确认解绑激活码 ${row.code} 的账号绑定吗？`);
  if (!ok) return;
  try {
    const confirmToken = await ensureSensitiveActionConfirmed("解绑激活码绑定");
    if (!confirmToken) return;
    const res = await api.admin.unbindActivationCode(row.id, confirmToken);
    if (!res?.success) {
      message.error(res?.message || "解绑失败");
      return;
    }
    message.success(res.message || "已解绑");
    if (Number(res?.data?.voidedConversions || 0) > 0) {
      message.info("相关返佣台账已同步作废");
    }
    await loadCodes();
  } catch (error) {
    if (Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403) {
      clearSensitiveConfirmToken();
    }
    message.error(error.message || "解绑失败");
  }
};

const unbindAllCodes = async () => {
  const ok = window.confirm("确认清空全部账号的激活码绑定吗？该操作会重置所有已绑定状态。");
  if (!ok) return;
  try {
    const confirmToken = await ensureSensitiveActionConfirmed("清空全部激活码绑定");
    if (!confirmToken) return;
    const res = await api.admin.unbindAllActivationCodes(confirmToken);
    if (!res?.success) {
      message.error(res?.message || "清空失败");
      return;
    }
    const deletedBindings = Number(res?.data?.deletedBindings || 0);
    const resetCodes = Number(res?.data?.resetCodes || 0);
    const voidedConversions = Number(res?.data?.voidedConversions || 0);
    message.success(`已清空绑定：解绑记录 ${deletedBindings} 条，重置激活码 ${resetCodes} 条，作废返佣 ${voidedConversions} 条`);
    await loadCodes();
  } catch (error) {
    if (Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403) {
      clearSensitiveConfirmToken();
    }
    message.error(error.message || "清空失败");
  }
};

const columns = computed(() => [
  {
    title: "激活码",
    key: "code",
    width: 220,
    render: (row) =>
      h("span", { class: "table-code-cell", title: row.code }, row.code),
  },
  {
    title: "状态",
    key: "status",
    width: 130,
    render: (row) => {
      const tag = statusTag(row);
      return h("div", { class: "table-stack-cell" }, [
        h(NTag, { size: "small", type: tag.type }, { default: () => tag.text }),
        h(
          "span",
          { class: "table-subtext-cell" },
          `${getFeatureScopeLabel(row.featureScope)} · ${formatDurationLabel(row.durationMonths)} · ${formatSale(row.saleAmountCents, row.saleCurrency)}`,
        ),
      ]);
    },
  },
  {
    title: "绑定信息",
    key: "bindingInfo",
    minWidth: 220,
    render: (row) => {
      const value = String(row.bindingRoleName || "").trim() || "-";
      return h("span", { class: "table-text-cell", title: value }, value);
    },
  },
  {
    title: "到期时间",
    key: "timeInfo",
    width: 180,
    render: (row) => {
      const expiresAt = formatTime(row.bindingExpiresAt);
      return h("span", { class: "table-text-cell", title: expiresAt }, expiresAt);
    },
  },
  {
    title: "操作",
    key: "actions",
    width: 220,
    render: (row) => {
      const buttons = [
        h(
          NButton,
          {
            size: "small",
            tertiary: true,
            type: "error",
            onClick: () => deleteCode(row),
          },
          { default: () => "删除" },
        ),
      ];
      if (canUnbind(row)) {
        buttons.push(
          h(
            NButton,
            {
              size: "small",
              tertiary: true,
              type: "warning",
              onClick: () => unbindCode(row),
            },
            { default: () => "解绑" },
          ),
        );
      }
      if (row.isActive && !row.usedAt) {
        buttons.push(
          h(
            NButton,
            {
              size: "small",
              tertiary: true,
              type: "warning",
              onClick: () => disableCode(row),
            },
            { default: () => "禁用" },
          ),
        );
      }
      return h("div", { class: "table-actions-cell" }, buttons);
    },
  },
]);

const updateMobileState = () => {
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
};

const loadCodes = async () => {
  if (!canAccess.value) {
    router.replace("/admin/dashboard");
    return;
  }
  loading.value = true;
  try {
    const res = await api.admin.listActivationCodes();
    if (!res?.success) {
      message.error(res?.message || "加载失败");
      return;
    }
    codes.value = Array.isArray(res.data) ? res.data : [];
  } catch (error) {
    message.error(error.message || "加载失败");
  } finally {
    loading.value = false;
  }
};

const createCodes = async () => {
  creating.value = true;
  try {
    const confirmToken = await ensureSensitiveActionConfirmed("生成激活码");
    if (!confirmToken) return;
    const res = await api.admin.createActivationCodes({
      count: Math.max(1, Math.min(100, Number(createCount.value) || 1)),
      featureScope: featureScope.value,
      durationMonths: normalizeDurationValue(durationMonths.value),
      saleAmountCents: isOneDayDuration.value
        ? 0
        : Math.max(0, Math.round((Number(saleAmountYuan.value) || 0) * 100)),
    }, confirmToken);
    if (!res?.success) {
      message.error(res?.message || "生成失败");
      return;
    }
    createdCodesPlaintext.value = (res.data || [])
      .map((item) => String(item?.code || "").trim())
      .filter(Boolean);
    showCreatedCodesModal.value = createdCodesPlaintext.value.length > 0;
    message.success(res.message || "生成成功");
    await loadCodes();
  } catch (error) {
    if (Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403) {
      clearSensitiveConfirmToken();
    }
    message.error(error.message || "生成失败");
  } finally {
    creating.value = false;
  }
};

const copyCreatedCodes = async () => {
  const list = createdCodesPlaintext.value.join("\n");
  if (!list) {
    message.warning("暂无可复制的激活码");
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(list);
      message.success("激活码已复制");
      return;
    }
  } catch {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = list;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (copied) {
      message.success("激活码已复制");
      return;
    }
  } catch {}

  message.error("复制失败，请手动复制");
};

const closeCreatedCodesModal = () => {
  showCreatedCodesModal.value = false;
  createdCodesPlaintext.value = [];
};

const handleCreatedCodesModalUpdate = (show) => {
  if (show) {
    showCreatedCodesModal.value = true;
    return;
  }
  closeCreatedCodesModal();
};

watch(
  [featureScope, durationMonths],
  ([nextFeatureScope, nextDurationMonths]) => {
    saleAmountYuan.value = getPresetSaleAmountYuan(nextFeatureScope, nextDurationMonths);
  },
  { immediate: true },
);

onMounted(() => {
  updateMobileState();
  window.addEventListener("resize", updateMobileState);
  loadCodes();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateMobileState);
});
</script>

<style scoped>
.admin-activation-codes-page {
  padding: 20px;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.created-codes-modal {
  max-width: 640px;
}

.created-codes-modal__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.created-codes-modal__hint {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.created-codes-modal__list {
  display: grid;
  gap: 10px;
  max-height: 360px;
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--surface-glass-border);
  border-radius: var(--border-radius-lg);
  background: rgba(15, 23, 42, 0.04);
}

.created-codes-modal__item {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.6;
  word-break: break-all;
}

.created-codes-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: var(--spacing-lg);
  border: 1px solid var(--surface-glass-border);
  border-radius: var(--border-radius-xl);
  background: var(--surface-glass);
  box-shadow: var(--shadow-light);
  backdrop-filter: blur(12px);
}

.page-header__main h1 {
  margin: 0;
}

.page-header__main p {
  margin: 4px 0 0;
  color: var(--text-secondary);
}

.activation-creator {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.activation-creator__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
}

.activation-creator__label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.activation-creator__hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.activation-creator__button {
  flex-shrink: 0;
}

.activation-codes-table :deep(.n-data-table-th),
.activation-codes-table :deep(.n-data-table-td) {
  white-space: normal;
}

.activation-codes-table :deep(.n-data-table-td) {
  vertical-align: middle;
}

.table-stack-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.table-code-cell,
.table-text-cell {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.table-code-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-weight: 600;
}

.table-subtext-cell {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-actions-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-code-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-code-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mobile-code-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.mobile-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}

.meta-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.meta-label {
  color: var(--text-secondary);
}

.mobile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 768px) {
  .admin-activation-codes-page {
    padding: 12px;
  }

  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .activation-creator {
    flex-direction: column;
    gap: 8px;
  }

  .activation-creator__field,
  .activation-creator__button {
    width: 100%;
  }

  .mobile-meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
