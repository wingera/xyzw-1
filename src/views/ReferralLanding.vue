<template>
  <div class="referral-landing-page">
    <div class="referral-landing-card">
      <h1>{{ t("referralLanding.title") }}</h1>
      <p>{{ statusText }}</p>
      <n-spin :show="loading"></n-spin>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useMessage } from "naive-ui/es";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import api from "@/api";

const REFERRAL_CODE_STORAGE_KEY = "xyzw_referral_code";
const REFERRAL_AT_STORAGE_KEY = "xyzw_referral_at";

const route = useRoute();
const router = useRouter();
const message = useMessage();
const { t } = useI18n();

const loading = ref(false);
const statusText = computed(() =>
  loading.value ? t("referralLanding.loading") : t("referralLanding.redirecting"),
);

const clearStoredReferral = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
  window.localStorage.removeItem(REFERRAL_AT_STORAGE_KEY);
};

const persistReferral = (referralCode) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, String(referralCode || "").trim());
  window.localStorage.setItem(REFERRAL_AT_STORAGE_KEY, new Date().toISOString());
};

const handleResolve = async () => {
  const code = String(route.params.code || "").trim();
  if (!code) {
    clearStoredReferral();
    router.replace("/register");
    return;
  }

  loading.value = true;
  try {
    const res = await api.publicReferral.resolve(code);
    if (!res?.success || !res?.data?.referralCode) {
      clearStoredReferral();
      message.warning(t("referralLanding.invalid"));
      router.replace("/register");
      return;
    }

    const attachRes = await api.publicReferral.attach(res.data.referralCode);
    if (!attachRes?.success || !attachRes?.data?.referralCode) {
      clearStoredReferral();
      message.warning(attachRes?.message || t("referralLanding.invalid"));
      router.replace("/register");
      return;
    }

    persistReferral(attachRes.data.referralCode);
    router.replace(res.data.registerPath || `/register?ref=${encodeURIComponent(attachRes.data.referralCode)}`);
  } catch (error) {
    clearStoredReferral();
    message.warning(error?.message || t("referralLanding.invalid"));
    router.replace("/register");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  handleResolve();
});
</script>

<style scoped lang="scss">
.referral-landing-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.referral-landing-card {
  width: min(520px, 100%);
  padding: 28px;
  border-radius: 24px;
  background: var(--surface-glass-strong);
  border: 1px solid var(--surface-glass-border);
  box-shadow: var(--shadow-light);
  display: grid;
  gap: 14px;
  text-align: center;
}

.referral-landing-card h1,
.referral-landing-card p {
  margin: 0;
}

.referral-landing-card p {
  color: var(--text-secondary);
}
</style>
