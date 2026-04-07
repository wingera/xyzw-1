<template>
  <div class="referral-center-page">
    <div class="container referral-center-page__container">
      <div class="page-header">
        <div>
          <h1>{{ t("referralCenter.title") }}</h1>
          <p>{{ t("referralCenter.subtitle") }}</p>
        </div>
        <div class="page-header__actions">
          <n-button :loading="loading" @click="refreshAll">
            {{ t("referralCenter.actions.refresh") }}
          </n-button>
          <n-button
            v-if="!overview.profile"
            type="primary"
            :loading="generating"
            @click="generateReferralProfile"
          >
            {{ t("referralCenter.actions.generate") }}
          </n-button>
          <n-button
            v-else
            type="primary"
            @click="copyShareUrl"
          >
            {{ t("referralCenter.actions.copyLink") }}
          </n-button>
        </div>
      </div>

      <div class="summary-grid">
        <n-card embedded class="summary-card">
          <span>{{ t("referralCenter.summary.code") }}</span>
          <strong>{{ overview.profile?.referralCode || t("referralCenter.summary.notGenerated") }}</strong>
          <small>{{ t("referralCenter.summary.codeHint") }}</small>
        </n-card>
        <n-card embedded class="summary-card">
          <span>{{ t("referralCenter.summary.invitedUsers") }}</span>
          <strong>{{ overview.invitedUsersCount }}</strong>
          <small>{{ t("referralCenter.summary.invitedUsersHint") }}</small>
        </n-card>
        <n-card embedded class="summary-card">
          <span>{{ t("referralCenter.summary.pending") }}</span>
          <strong>{{ formatAmount(overview.pendingAmountCents) }}</strong>
          <small>{{ t("referralCenter.summary.pendingHint") }}</small>
        </n-card>
        <n-card embedded class="summary-card">
          <span>{{ t("referralCenter.summary.paid") }}</span>
          <strong>{{ formatAmount(overview.paidAmountCents) }}</strong>
          <small>{{ t("referralCenter.summary.paidHint") }}</small>
        </n-card>
      </div>

      <n-card embedded class="share-card">
        <div class="share-card__head">
          <div>
            <h2>{{ t("referralCenter.share.title") }}</h2>
            <p>{{ t("referralCenter.share.subtitle") }}</p>
          </div>
          <n-button
            v-if="overview.profile?.shareUrl"
            tertiary
            type="primary"
            @click="copyShareUrl"
          >
            {{ t("referralCenter.actions.copyLink") }}
          </n-button>
        </div>
        <div class="share-card__value">
          {{ overview.profile?.shareUrl || t("referralCenter.share.empty") }}
        </div>
        <div class="share-card__tips">
          <p>{{ t("referralCenter.rules.firstPurchase") }}</p>
          <p>{{ t("referralCenter.rules.renewal") }}</p>
          <p>{{ t("referralCenter.rules.claim") }}</p>
        </div>
      </n-card>

      <n-card embedded class="list-card">
        <div class="list-card__head">
          <h2>{{ t("referralCenter.list.title") }}</h2>
          <span>{{ t("referralCenter.list.count", { count: conversions.length }) }}</span>
        </div>
        <n-data-table
          :columns="columns"
          :data="conversions"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
        ></n-data-table>
      </n-card>
    </div>
  </div>
</template>

<script setup>
import { computed, h, onMounted, reactive, ref } from "vue";
import { NTag, useMessage } from "naive-ui/es";
import { useI18n } from "vue-i18n";
import api from "@/api";

const message = useMessage();
const { locale, t } = useI18n();

const loading = ref(false);
const generating = ref(false);
const conversions = ref([]);
const overview = reactive({
  profile: null,
  invitedUsersCount: 0,
  pendingAmountCents: 0,
  paidAmountCents: 0,
});

const formatAmount = (amountCents) => {
  const amount = Math.max(0, Number(amountCents) || 0) / 100;
  return new Intl.NumberFormat(locale.value === "en" ? "en-US" : "zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatDurationLabel = (value) => {
  const numeric = Number(value);
  if (numeric === 0) {
    return locale.value === "en" ? "1 day" : "1天";
  }
  return `${Math.max(1, numeric || 1)}${t("referralCenter.columns.monthUnit")}`;
};

const formatTime = (value) =>
  value ? new Date(value).toLocaleString(locale.value === "en" ? "en-US" : "zh-CN") : "-";

const conversionTypeLabel = (value) =>
  t(`referralCenter.conversionTypes.${String(value || "").trim() || "renewal_le_2m"}`);

const rewardStatusLabel = (value) =>
  t(`referralCenter.rewardStatus.${String(value || "").trim() || "pending"}`);

const settlementChannelLabel = (value) =>
  t(`referralCenter.settlementChannels.${String(value || "").trim() || "other"}`);

const loadOverview = async () => {
  const res = await api.user.getReferralOverview();
  if (!res?.success) {
    throw new Error(res?.message || t("referralCenter.messages.loadFailed"));
  }
  overview.profile = res.data?.profile || null;
  overview.invitedUsersCount = Number(res.data?.invitedUsersCount || 0);
  overview.pendingAmountCents = Number(res.data?.pendingAmountCents || 0);
  overview.paidAmountCents = Number(res.data?.paidAmountCents || 0);
};

const loadConversions = async () => {
  const res = await api.user.getReferralConversions();
  if (!res?.success) {
    throw new Error(res?.message || t("referralCenter.messages.loadFailed"));
  }
  conversions.value = Array.isArray(res.data) ? res.data : [];
};

const refreshAll = async () => {
  loading.value = true;
  try {
    await Promise.all([loadOverview(), loadConversions()]);
  } catch (error) {
    message.error(error?.message || t("referralCenter.messages.loadFailed"));
  } finally {
    loading.value = false;
  }
};

const generateReferralProfile = async () => {
  generating.value = true;
  try {
    const res = await api.user.generateReferralProfile();
    if (!res?.success) {
      message.error(res?.message || t("referralCenter.messages.generateFailed"));
      return;
    }
    message.success(t("referralCenter.messages.generated"));
    await refreshAll();
  } catch (error) {
    message.error(error?.message || t("referralCenter.messages.generateFailed"));
  } finally {
    generating.value = false;
  }
};

const copyText = async (text) => {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
};

const copyShareUrl = async () => {
  try {
    const ok = await copyText(overview.profile?.shareUrl || "");
    if (!ok) {
      message.error(t("referralCenter.messages.copyFailed"));
      return;
    }
    message.success(t("referralCenter.messages.copied"));
  } catch (error) {
    message.error(error?.message || t("referralCenter.messages.copyFailed"));
  }
};

const columns = computed(() => [
  {
    title: t("referralCenter.columns.user"),
    key: "referredUsername",
    render: (row) => row.referredUsername || "-",
  },
  {
    title: t("referralCenter.columns.type"),
    key: "conversionType",
    render: (row) => conversionTypeLabel(row.conversionType),
  },
  {
    title: t("referralCenter.columns.duration"),
    key: "durationMonths",
    render: (row) => formatDurationLabel(row.durationMonths),
  },
  {
    title: t("referralCenter.columns.gross"),
    key: "grossAmountCents",
    render: (row) => formatAmount(row.grossAmountCents),
  },
  {
    title: t("referralCenter.columns.reward"),
    key: "rewardAmountCents",
    render: (row) => formatAmount(row.rewardAmountCents),
  },
  {
    title: t("referralCenter.columns.status"),
    key: "rewardStatus",
    render: (row) =>
      h(NTag, { size: "small", type: row.rewardStatus === "paid" ? "success" : row.rewardStatus === "pending" ? "warning" : "default" }, {
        default: () => rewardStatusLabel(row.rewardStatus),
      }),
  },
  {
    title: t("referralCenter.columns.settlementChannel"),
    key: "settlementChannel",
    render: (row) => row.settlementChannel ? settlementChannelLabel(row.settlementChannel) : "-",
  },
  {
    title: t("referralCenter.columns.settledAt"),
    key: "settledAt",
    render: (row) => formatTime(row.settledAt),
  },
  {
    title: t("referralCenter.columns.createdAt"),
    key: "createdAt",
    render: (row) => formatTime(row.createdAt),
  },
]);

onMounted(() => {
  refreshAll();
});
</script>

<style scoped lang="scss">
.referral-center-page {
  padding: var(--spacing-lg);
}

.referral-center-page__container {
  display: grid;
  gap: 18px;
}

.page-header,
.share-card,
.list-card {
  display: grid;
  gap: 14px;
}

.page-header {
  grid-template-columns: 1fr auto;
  align-items: start;
}

.page-header h1,
.share-card h2,
.list-card h2 {
  margin: 0;
}

.page-header p,
.share-card p {
  margin: 0;
  color: var(--text-secondary);
}

.page-header__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}

.summary-card {
  display: grid;
  gap: 8px;
}

.summary-card span,
.summary-card small {
  color: var(--text-secondary);
}

.summary-card strong {
  font-size: 28px;
}

.share-card__head,
.list-card__head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: start;
}

.share-card__value {
  padding: 14px;
  border-radius: 16px;
  background: rgba(15, 107, 255, 0.08);
  word-break: break-all;
}

.share-card__tips {
  display: grid;
  gap: 6px;
}

.share-card__tips p {
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .referral-center-page {
    padding: var(--spacing-md);
  }

  .page-header,
  .share-card__head,
  .list-card__head {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}
</style>
