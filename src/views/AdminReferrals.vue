<template>
  <div v-if="canAccess" class="admin-referrals-page">
    <div class="container admin-referrals-page__container">
      <div class="page-header">
        <div>
          <h1>{{ t("adminReferralsPage.title") }}</h1>
          <p>{{ t("adminReferralsPage.subtitle") }}</p>
        </div>
        <n-button :loading="loading" @click="refreshAll">
          {{ t("adminReferralsPage.actions.refresh") }}
        </n-button>
      </div>

      <n-card embedded class="list-card">
        <div class="list-card__head">
          <h2>{{ t("adminReferralsPage.attributions.title") }}</h2>
          <span>{{ t("adminReferralsPage.attributions.count", { count: attributions.length }) }}</span>
        </div>
        <n-data-table
          :columns="attributionColumns"
          :data="attributions"
          :loading="loading"
          :pagination="{ pageSize: 8 }"
        ></n-data-table>
      </n-card>

      <n-card embedded class="list-card">
        <div class="list-card__head">
          <h2>{{ t("adminReferralsPage.conversions.title") }}</h2>
          <span>{{ t("adminReferralsPage.conversions.count", { count: conversions.length }) }}</span>
        </div>
        <n-data-table
          :columns="conversionColumns"
          :data="conversions"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
        ></n-data-table>
      </n-card>
    </div>
  </div>
</template>

<script setup>
import { computed, h, onMounted, ref } from "vue";
import { NButton, NInput, NSelect, NTag, useDialog, useMessage } from "naive-ui/es";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import api from "@/api";

const message = useMessage();
const dialog = useDialog();
const authStore = useAuthStore();
const { locale, t } = useI18n();

const loading = ref(false);
const attributions = ref([]);
const conversions = ref([]);
const sensitiveConfirmToken = ref("");
const sensitiveConfirmExpiresAt = ref(0);
const canAccess = computed(
  () => authStore.isAuthenticated && Boolean(authStore.user?.isAdmin),
);
const settlementChannelOptions = computed(() => ([
  { label: t("adminReferralsPage.channels.wechatManual"), value: "wechat_manual" },
  { label: t("adminReferralsPage.channels.bank"), value: "bank" },
  { label: t("adminReferralsPage.channels.other"), value: "other" },
]));

const formatTime = (value) =>
  value ? new Date(value).toLocaleString(locale.value === "en" ? "en-US" : "zh-CN") : "-";

const formatAmount = (amountCents) => {
  const amount = Math.max(0, Number(amountCents) || 0) / 100;
  return new Intl.NumberFormat(locale.value === "en" ? "en-US" : "zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(amount);
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

const promptSensitiveCredential = ({ actionLabel = "" } = {}) =>
  new Promise((resolve) => {
    const mfaEnabled = Boolean(authStore.user?.mfaEnabled);
    const password = ref("");
    const totpCode = ref("");
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value || null);
    };

    dialog.warning({
      title: t("adminReferralsPage.confirm.title"),
      positiveText: t("adminReferralsPage.confirm.confirm"),
      negativeText: t("adminReferralsPage.confirm.cancel"),
      content: () =>
        h("div", { style: "display:flex;flex-direction:column;gap:12px;" }, [
          h(
            "div",
            { style: "line-height:1.6;" },
            mfaEnabled
              ? t("adminReferralsPage.confirm.mfaPrompt", { action: actionLabel })
              : t("adminReferralsPage.confirm.passwordPrompt", { action: actionLabel }),
          ),
          h(NInput, {
            type: mfaEnabled ? "text" : "password",
            value: mfaEnabled ? totpCode.value : password.value,
            placeholder: mfaEnabled
              ? t("adminReferralsPage.confirm.totpPlaceholder")
              : t("adminReferralsPage.confirm.passwordPlaceholder"),
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
            message.warning(t("adminReferralsPage.messages.confirmTotpRequired"));
            return false;
          }
          finish({ totpCode: normalized });
          return true;
        }
        const normalized = String(password.value || "").trim();
        if (!normalized) {
          message.warning(t("adminReferralsPage.messages.confirmPasswordRequired"));
          return false;
        }
        finish({ password: normalized });
        return true;
      },
      onNegativeClick: () => finish(null),
      onClose: () => finish(null),
    });
  });

const ensureSensitiveActionConfirmed = async (actionLabel) => {
  const cached = getCachedSensitiveConfirmToken();
  if (cached) {
    return cached;
  }

  const credential = await promptSensitiveCredential({ actionLabel });
  if (!credential) {
    message.warning(t("adminReferralsPage.messages.confirmCancelled"));
    return "";
  }

  try {
    const res = await api.admin.confirmSensitiveAction(credential);
    if (!res?.success || !res?.data?.token) {
      message.error(res?.message || t("adminReferralsPage.messages.confirmFailed"));
      return "";
    }
    sensitiveConfirmToken.value = String(res.data.token || "");
    sensitiveConfirmExpiresAt.value = new Date(res.data.expiresAt || "").getTime();
    message.success(t("adminReferralsPage.messages.confirmPassed"));
    return sensitiveConfirmToken.value;
  } catch (error) {
    message.error(error?.message || t("adminReferralsPage.messages.confirmFailed"));
    return "";
  }
};

const refreshAll = async () => {
  loading.value = true;
  try {
    const [attrRes, convRes] = await Promise.all([
      api.admin.listReferralAttributions(),
      api.admin.listReferralConversions(),
    ]);
    attributions.value = Array.isArray(attrRes?.data) ? attrRes.data : [];
    conversions.value = Array.isArray(convRes?.data) ? convRes.data : [];
  } catch (error) {
    message.error(error?.message || t("adminReferralsPage.messages.loadFailed"));
  } finally {
    loading.value = false;
  }
};

const promptNote = ({ title, placeholder, required = false }) =>
  new Promise((resolve) => {
    const note = ref("");
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    dialog.info({
      title,
      positiveText: t("adminReferralsPage.confirm.confirm"),
      negativeText: t("adminReferralsPage.confirm.cancel"),
      content: () =>
        h(NInput, {
          type: "textarea",
          rows: 4,
          value: note.value,
          placeholder,
          onUpdateValue: (value) => {
            note.value = String(value || "");
          },
        }),
      onPositiveClick: () => {
        const normalized = String(note.value || "").trim();
        if (required && !normalized) {
          message.warning(t("adminReferralsPage.messages.rejectNoteRequired"));
          return false;
        }
        finish(normalized);
        return true;
      },
      onNegativeClick: () => finish(null),
      onClose: () => finish(null),
    });
  });

const settlementChannelLabel = (value) =>
  t(`adminReferralsPage.channelLabels.${String(value || "").trim() || "other"}`);
const isSettlementRefRequired = (channel) =>
  ["wechat_manual", "bank"].includes(String(channel || "").trim());

const promptMarkPaidPayload = () =>
  new Promise((resolve) => {
    const form = ref({
      channel: "wechat_manual",
      settlementRef: "",
      note: "",
    });
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    dialog.info({
      title: t("adminReferralsPage.actions.markPaid"),
      positiveText: t("adminReferralsPage.confirm.confirm"),
      negativeText: t("adminReferralsPage.confirm.cancel"),
      content: () =>
        h("div", { style: "display:flex;flex-direction:column;gap:12px;" }, [
          h("label", { style: "font-weight:600;" }, t("adminReferralsPage.fields.channel")),
          h(NSelect, {
            value: form.value.channel,
            options: settlementChannelOptions.value,
            onUpdateValue: (value) => {
              form.value.channel = String(value || "wechat_manual");
            },
          }),
          h("label", { style: "font-weight:600;" }, t("adminReferralsPage.fields.settlementRef")),
          h(NInput, {
            value: form.value.settlementRef,
            placeholder: t("adminReferralsPage.messages.settlementRefPlaceholder"),
            onUpdateValue: (value) => {
              form.value.settlementRef = String(value || "");
            },
          }),
          h("label", { style: "font-weight:600;" }, t("adminReferralsPage.fields.note")),
          h(NInput, {
            type: "textarea",
            rows: 4,
            value: form.value.note,
            placeholder: t("adminReferralsPage.messages.optionalNote"),
            onUpdateValue: (value) => {
              form.value.note = String(value || "");
            },
          }),
        ]),
      onPositiveClick: () => {
        const channel = String(form.value.channel || "").trim();
        if (!channel) {
          message.warning(t("adminReferralsPage.messages.channelRequired"));
          return false;
        }
        const settlementRef = String(form.value.settlementRef || "").trim();
        if (isSettlementRefRequired(channel) && !settlementRef) {
          message.warning(t("adminReferralsPage.messages.settlementRefRequired"));
          return false;
        }
        finish({
          channel,
          settlementRef,
          note: String(form.value.note || "").trim(),
        });
        return true;
      },
      onNegativeClick: () => finish(null),
      onClose: () => finish(null),
    });
  });

const markPaid = async (row) => {
  const confirmToken = await ensureSensitiveActionConfirmed(t("adminReferralsPage.actions.markPaid"));
  if (!confirmToken) {
    return;
  }
  const payload = await promptMarkPaidPayload();
  if (!payload) {
    return;
  }
  try {
    const res = await api.admin.markReferralConversionPaid(row.id, payload, confirmToken);
    if (!res?.success) {
      message.error(res?.message || t("adminReferralsPage.messages.markPaidFailed"));
      return;
    }
    message.success(t("adminReferralsPage.messages.markPaidSuccess"));
    await refreshAll();
  } catch (error) {
    clearSensitiveConfirmToken();
    message.error(error?.message || t("adminReferralsPage.messages.markPaidFailed"));
  }
};

const rejectConversion = async (row) => {
  const confirmToken = await ensureSensitiveActionConfirmed(t("adminReferralsPage.actions.reject"));
  if (!confirmToken) {
    return;
  }
  const note = await promptNote({
    title: t("adminReferralsPage.actions.reject"),
    placeholder: t("adminReferralsPage.messages.rejectNotePlaceholder"),
    required: true,
  });
  if (note === null) {
    return;
  }
  try {
    const res = await api.admin.rejectReferralConversion(row.id, { note }, confirmToken);
    if (!res?.success) {
      message.error(res?.message || t("adminReferralsPage.messages.rejectFailed"));
      return;
    }
    message.success(t("adminReferralsPage.messages.rejectSuccess"));
    await refreshAll();
  } catch (error) {
    clearSensitiveConfirmToken();
    message.error(error?.message || t("adminReferralsPage.messages.rejectFailed"));
  }
};

const attributionColumns = computed(() => [
  {
    title: t("adminReferralsPage.columns.referrer"),
    key: "referrerUsername",
    render: (row) => row.referrerUsername || "-",
  },
  {
    title: t("adminReferralsPage.columns.referred"),
    key: "referredUsername",
    render: (row) => row.referredUsername || "-",
  },
  {
    title: t("adminReferralsPage.columns.referralCode"),
    key: "referralCodeSnapshot",
  },
  {
    title: t("adminReferralsPage.columns.inviteCode"),
    key: "inviteCodeMask",
    render: (row) => row.inviteCodeMask || "-",
  },
  {
    title: t("adminReferralsPage.columns.registeredAt"),
    key: "registeredAt",
    render: (row) => formatTime(row.registeredAt),
  },
]);

const rewardStatusTagType = (status) => {
  switch (status) {
    case "paid":
      return "success";
    case "pending":
      return "warning";
    case "rejected":
      return "error";
    case "void":
      return "default";
    default:
      return "info";
  }
};

const conversionColumns = computed(() => [
  {
    title: t("adminReferralsPage.columns.referrer"),
    key: "referrerUsername",
    render: (row) => row.referrerUsername || "-",
  },
  {
    title: t("adminReferralsPage.columns.referred"),
    key: "referredUsername",
    render: (row) => row.referredUsername || "-",
  },
  {
    title: t("adminReferralsPage.columns.type"),
    key: "conversionType",
    render: (row) => t(`referralCenter.conversionTypes.${row.conversionType}`),
  },
  {
    title: t("adminReferralsPage.columns.gross"),
    key: "grossAmountCents",
    render: (row) => formatAmount(row.grossAmountCents),
  },
  {
    title: t("adminReferralsPage.columns.reward"),
    key: "rewardAmountCents",
    render: (row) => formatAmount(row.rewardAmountCents),
  },
  {
    title: t("adminReferralsPage.columns.status"),
    key: "rewardStatus",
    render: (row) =>
      h(NTag, { size: "small", type: rewardStatusTagType(row.rewardStatus) }, {
        default: () => t(`referralCenter.rewardStatus.${row.rewardStatus}`),
      }),
  },
  {
    title: t("adminReferralsPage.columns.settlementChannel"),
    key: "settlementChannel",
    render: (row) => row.settlementChannel ? settlementChannelLabel(row.settlementChannel) : "-",
  },
  {
    title: t("adminReferralsPage.columns.settlementRef"),
    key: "settlementRef",
    render: (row) => row.settlementRef || "-",
  },
  {
    title: t("adminReferralsPage.columns.settledAt"),
    key: "settledAt",
    render: (row) => formatTime(row.settledAt),
  },
  {
    title: t("adminReferralsPage.columns.note"),
    key: "note",
    render: (row) => row.note || "-",
  },
  {
    title: t("adminReferralsPage.columns.actions"),
    key: "actions",
    width: 220,
    render: (row) => {
      if (row.rewardStatus !== "pending") {
        return "-";
      }
      return h("div", { class: "table-actions" }, [
        h(
          NButton,
          {
            size: "small",
            tertiary: true,
            type: "primary",
            onClick: () => markPaid(row),
          },
          { default: () => t("adminReferralsPage.actions.markPaid") },
        ),
        h(
          NButton,
          {
            size: "small",
            tertiary: true,
            type: "error",
            onClick: () => rejectConversion(row),
          },
          { default: () => t("adminReferralsPage.actions.reject") },
        ),
      ]);
    },
  },
]);

onMounted(() => {
  refreshAll();
});
</script>

<style scoped lang="scss">
.admin-referrals-page {
  padding: var(--spacing-lg);
}

.admin-referrals-page__container {
  display: grid;
  gap: 18px;
}

.page-header,
.list-card {
  display: grid;
  gap: 14px;
}

.page-header {
  grid-template-columns: 1fr auto;
  align-items: start;
}

.page-header h1,
.list-card h2 {
  margin: 0;
}

.page-header p {
  margin: 0;
  color: var(--text-secondary);
}

.list-card__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.table-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .admin-referrals-page {
    padding: var(--spacing-md);
  }

  .page-header,
  .list-card__head {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}
</style>
