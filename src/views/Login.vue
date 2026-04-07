<template>
  <div class="login-page" :class="{ 'login-page--ready': isPageReady }">
    <div aria-hidden="true" class="login-bg">
      <span class="bg-orb orb-a"></span>
      <span class="bg-orb orb-b"></span>
      <span class="bg-orb orb-c"></span>
      <span class="grid-mask"></span>
    </div>

    <div class="login-shell">
      <aside class="intro-panel reveal-up">
        <div class="intro-brand">
          <img alt="XYZW" class="brand-logo" src="/icons/xiaoyugan.png">
          <div>
            <p class="intro-kicker">XYZW</p>
            <h1>{{ t("login.title") }}</h1>
          </div>
        </div>

        <p class="intro-text">{{ t("login.subtitle") }}</p>

        <div class="features-list">
          <article
            v-for="feature in features"
            :key="feature.id"
            class="feature-item"
          >
            <div class="feature-icon">
              <component :is="feature.icon"></component>
            </div>
            <div class="feature-content">
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.description }}</p>
            </div>
          </article>
        </div>
      </aside>

      <section class="login-card reveal-up reveal-delay-2">
        <header class="card-header">
          <h2>{{ t("login.cardTitle") }}</h2>
          <p>{{ t("login.cardDesc") }}</p>
        </header>

        <n-form
          ref="loginFormRef"
          size="large"
          :aria-busy="authStore.isLoading ? 'true' : 'false'"
          :model="loginForm"
          :rules="loginRules"
          :show-label="false"
        >
          <p
            aria-atomic="true"
            aria-live="polite"
            class="sr-only"
            role="status"
          >
            {{ screenReaderStatusText }}
          </p>
          <p
            ref="formErrorRef"
            aria-atomic="true"
            aria-live="assertive"
            class="sr-only"
            role="alert"
            tabindex="-1"
          >
            {{ formErrorMessage }}
          </p>
          <p v-if="loginCooldownSeconds > 0 && !isMfaPending" class="rate-limit-hint">
            {{ t("login.messages.rateLimitCooldown", { seconds: loginCooldownSeconds }) }}
          </p>

          <n-form-item path="username">
            <n-input
              v-model:value="loginForm.username"
              :disabled="isMfaPending"
              :input-props="{
                'autocomplete': 'username',
                'name': 'username',
                'aria-label': t('login.usernamePlaceholder'),
              }"
              :placeholder="t('login.usernamePlaceholder')"
            >
              <template #prefix>
                <n-icon><PersonCircle></PersonCircle></n-icon>
              </template>
            </n-input>
          </n-form-item>

          <n-form-item path="password">
            <n-input
              type="password"
              v-model:value="loginForm.password"
              :disabled="isMfaPending"
              :input-props="{
                'autocomplete': 'current-password',
                'name': 'password',
                'aria-label': t('login.passwordPlaceholder'),
              }"
              :placeholder="t('login.passwordPlaceholder')"
              @keydown.enter="isMfaPending ? handleVerifyMfa() : handleLogin()"
            >
              <template #prefix>
                <n-icon><LockClosed></LockClosed></n-icon>
              </template>
            </n-input>
          </n-form-item>

          <div v-if="!isMfaPending" class="form-options">
            <n-checkbox v-model:checked="loginForm.rememberMe">
              {{ t("login.rememberMe") }}
            </n-checkbox>
            <n-button
              text
              class="text-action-btn"
              type="primary"
              @click="router.push('/forgot-password')"
            >
              {{ t("login.forgotPassword") }}
            </n-button>
          </div>

          <template v-if="isMfaPending">
            <div class="mfa-panel">
              <p class="mfa-title">{{ t("login.mfa.title") }}</p>
              <template v-if="isMfaQrMode">
                <p class="mfa-hint">{{ t("login.mfa.qrHint") }}</p>
                <div class="mfa-qr-wrap">
                  <img
                    v-if="mfaQrDataUrl"
                    class="mfa-qr-image"
                    :alt="t('profile.messages.twoFactorQrAlt')"
                    :src="mfaQrDataUrl"
                  >
                  <p v-else class="mfa-qr-status">{{ t("login.mfa.qrLoading") }}</p>
                  <p class="mfa-qr-status">{{ mfaQrStatusText }}</p>
                </div>
              </template>
              <template v-else>
                <p class="mfa-hint">
                  {{
                    t(
                      isRecoveryMode
                        ? "login.mfa.recoveryHint"
                        : "login.mfa.totpHint",
                    )
                  }}
                </p>
                <n-input
                  v-model:value="mfaCode"
                  :input-props="{
                    'autocomplete': isRecoveryMode ? 'one-time-code' : 'one-time-code',
                    'inputmode': isRecoveryMode ? 'text' : 'numeric',
                    'name': isRecoveryMode ? 'mfa-recovery-code' : 'mfa-totp-code',
                    'aria-label': t(
                      isRecoveryMode
                        ? 'login.mfa.recoveryPlaceholder'
                        : 'login.mfa.totpPlaceholder',
                    ),
                  }"
                  :placeholder="
                    t(
                      isRecoveryMode
                        ? 'login.mfa.recoveryPlaceholder'
                        : 'login.mfa.totpPlaceholder',
                    )
                  "
                  @keydown.enter="handleVerifyMfa"
                >
                  <template #prefix>
                    <n-icon><LockClosed></LockClosed></n-icon>
                  </template>
                </n-input>
              </template>
              <div class="mfa-actions">
                <n-button
                  text
                  class="text-action-btn"
                  type="primary"
                  @click="toggleMfaMethod"
                >
                  {{
                    t(
                      isMfaQrMode
                        ? "login.mfa.useCode"
                        : "login.mfa.useQr",
                    )
                  }}
                </n-button>
                <n-button
                  v-if="!isMfaQrMode"
                  text
                  class="text-action-btn"
                  type="primary"
                  @click="toggleMfaMode"
                >
                  {{
                    t(
                      isRecoveryMode
                        ? "login.mfa.useAuthenticator"
                        : "login.mfa.useRecoveryCode",
                      )
                  }}
                </n-button>
                <n-button
                  v-if="isMfaQrMode"
                  text
                  class="text-action-btn"
                  type="primary"
                  @click="startMfaQrFlow"
                >
                  {{ t("login.mfa.qrRefresh") }}
                </n-button>
                <n-button
                  text
                  class="text-action-btn"
                  type="default"
                  @click="cancelMfa"
                >
                  {{ t("login.mfa.backToLogin") }}
                </n-button>
              </div>
            </div>
          </template>

          <n-button
            block
            class="login-button"
            size="large"
            type="primary"
            :aria-disabled="isSubmitDisabled || authStore.isLoading ? 'true' : 'false'"
            :disabled="isSubmitDisabled"
            :loading="authStore.isLoading"
            @click="isMfaPending ? handleVerifyMfa() : handleLogin()"
          >
            {{ isMfaPending ? t("login.mfa.verifySubmit") : t("login.submit") }}
          </n-button>
        </n-form>

        <template v-if="!isMfaPending">
          <n-divider><span class="divider-text">{{ t("login.otherMethods") }}</span></n-divider>

          <div class="social-login">
            <n-button
              class="social-button"
              size="large"
              @click="handleSocialLogin('qq')"
            >
              <template #icon>
                <n-icon><ChatbubbleEllipses></ChatbubbleEllipses></n-icon>
              </template>
              {{ t("login.qqLogin") }}
            </n-button>
            <n-button
              class="social-button"
              size="large"
              @click="handleSocialLogin('wechat')"
            >
              <template #icon>
                <n-icon><LogoWechat></LogoWechat></n-icon>
              </template>
              {{ t("login.wechatLogin") }}
            </n-button>
          </div>

          <div class="register-prompt">
            <span>{{ t("login.noAccount") }}</span>
            <n-button
              text
              class="text-action-btn"
              type="primary"
              @click="router.push('/register')"
            >
              {{ t("login.registerNow") }}
            </n-button>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useDialog, useMessage } from "naive-ui/es";
import { useI18n } from "vue-i18n";
import { toDataURL as qrToDataURL } from "qrcode";
import { useAuthStore } from "@/stores/auth";
import { getDefaultAuthenticatedPath } from "@/utils/accessScope";
import {
  ChatbubbleEllipses,
  Cube,
  LockClosed,
  LogoWechat,
  PersonCircle,
  Ribbon,
  Settings,
} from "@vicons/ionicons5";

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const authStore = useAuthStore();
const { t } = useI18n();
const loginFormRef = ref(null);
const isPageReady = ref(false);
const mfaChallengeToken = ref("");
const mfaCode = ref("");
const isRecoveryMode = ref(false);
const mfaMethod = ref("code");
const mfaQrSessionId = ref("");
const mfaQrDataUrl = ref("");
const mfaQrStatus = ref("idle");
const loginCooldownSeconds = ref(0);
const formErrorRef = ref(null);
const formErrorMessage = ref("");
let mfaQrPollingTimer = null;
let loginCooldownTimer = null;
const isMfaPending = computed(() => !!mfaChallengeToken.value);
const isMfaQrMode = computed(() => isMfaPending.value && mfaMethod.value === "qr");
const isSubmitDisabled = computed(() =>
  (isMfaPending.value && isMfaQrMode.value)
  || (!isMfaPending.value && loginCooldownSeconds.value > 0),
);
const mfaQrStatusText = computed(() => {
  if (mfaQrStatus.value === "loading")
    return t("login.mfa.qrLoading");
  if (mfaQrStatus.value === "pending")
    return t("login.mfa.qrPending");
  if (mfaQrStatus.value === "expired")
    return t("login.mfa.qrExpired");
  return "";
});
const screenReaderStatusText = computed(() => {
  if (authStore.isLoading) {
    return isMfaPending.value
      ? t("login.mfa.verifySubmit")
      : t("login.submit");
  }
  if (loginCooldownSeconds.value > 0 && !isMfaPending.value) {
    return t("login.messages.rateLimitCooldown", { seconds: loginCooldownSeconds.value });
  }
  if (isMfaPending.value && isMfaQrMode.value) {
    return mfaQrStatusText.value || t("login.mfa.qrLoading");
  }
  return "";
});

const loginForm = reactive({
  username: "",
  password: "",
  rememberMe: false,
});

const loginRules = computed(() => ({
  username: [
    {
      required: true,
      message: t("login.validation.usernameRequired"),
      trigger: ["input", "blur"],
    },
  ],
  password: [
    {
      required: true,
      message: t("login.validation.passwordRequired"),
      trigger: ["input", "blur"],
    },
  ],
}));

const features = computed(() => [
  {
    id: 1,
    icon: PersonCircle,
    title: t("login.features.roles.title"),
    description: t("login.features.roles.desc"),
  },
  {
    id: 2,
    icon: Cube,
    title: t("login.features.automation.title"),
    description: t("login.features.automation.desc"),
  },
  {
    id: 3,
    icon: Ribbon,
    title: t("login.features.analytics.title"),
    description: t("login.features.analytics.desc"),
  },
  {
    id: 4,
    icon: Settings,
    title: t("login.features.settings.title"),
    description: t("login.features.settings.desc"),
  },
]);

const stopMfaQrPolling = () => {
  if (mfaQrPollingTimer) {
    clearInterval(mfaQrPollingTimer);
    mfaQrPollingTimer = null;
  }
};

const clearLoginCooldown = () => {
  if (loginCooldownTimer) {
    clearInterval(loginCooldownTimer);
    loginCooldownTimer = null;
  }
  loginCooldownSeconds.value = 0;
};

const startLoginCooldown = (seconds) => {
  const normalized = Math.max(0, Number(seconds) || 0);
  if (normalized <= 0) {
    clearLoginCooldown();
    return;
  }
  if (loginCooldownTimer) {
    clearInterval(loginCooldownTimer);
    loginCooldownTimer = null;
  }
  loginCooldownSeconds.value = normalized;
  loginCooldownTimer = setInterval(() => {
    if (loginCooldownSeconds.value <= 1) {
      clearLoginCooldown();
      return;
    }
    loginCooldownSeconds.value -= 1;
  }, 1000);
};

const resetMfaQrState = () => {
  stopMfaQrPolling();
  mfaQrSessionId.value = "";
  mfaQrDataUrl.value = "";
  mfaQrStatus.value = "idle";
};

const resetMfaState = () => {
  resetMfaQrState();
  mfaChallengeToken.value = "";
  mfaCode.value = "";
  isRecoveryMode.value = false;
  mfaMethod.value = "code";
};

const focusNamedInput = (name) => {
  if (typeof document === "undefined")
    return;
  const el = document.querySelector(`input[name="${name}"], textarea[name="${name}"]`);
  if (el && typeof el.focus === "function") {
    el.focus();
  }
};

const announceFormError = async (messageText, focusFieldName = "") => {
  formErrorMessage.value = String(messageText || "").trim();
  await nextTick();
  if (focusFieldName) {
    focusNamedInput(focusFieldName);
    return;
  }
  if (formErrorRef.value && typeof formErrorRef.value.focus === "function") {
    formErrorRef.value.focus();
  }
};

const markPostLoginMfaSuggestion = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem("xyzw:post-login-mfa-suggestion", "1");
};

const isRecoverableChunkLoadError = (error) => {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "importing a module script failed",
    "unable to preload css for",
  ].some(fragment => message.includes(fragment));
};

const finishLogin = () => {
  formErrorMessage.value = "";
  message.success(t("login.messages.success"));
  markPostLoginMfaSuggestion();
  const rawRedirect = String(router.currentRoute.value.query.redirect || "");
  const defaultPath = getDefaultAuthenticatedPath(authStore.user);
  const redirect
    = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : defaultPath;
  dialog.info({
    title: t("login.notice.title"),
    content: t("login.notice.content"),
    positiveText: t("login.notice.confirm"),
    onPositiveClick: () => {
      router.push(redirect).catch((error) => {
        if (isRecoverableChunkLoadError(error) && typeof window !== "undefined") {
          window.location.assign(redirect);
          return;
        }
        console.error("[login] redirect failed:", error);
        message.error(error?.message || "跳转失败，请刷新后重试");
      });
    },
  });
};

const handleLogin = async () => {
  if (!loginFormRef.value)
    return;
  if (loginCooldownSeconds.value > 0) {
    await announceFormError(
      t("login.messages.rateLimitCooldown", { seconds: loginCooldownSeconds.value }),
    );
    message.warning(t("login.messages.rateLimitCooldown", { seconds: loginCooldownSeconds.value }));
    return;
  }

  try {
    await loginFormRef.value.validate();
    formErrorMessage.value = "";

    const result = await authStore.login({
      username: loginForm.username,
      password: loginForm.password,
      rememberMe: loginForm.rememberMe,
    });

    if (result.success && result.mfaRequired) {
      clearLoginCooldown();
      mfaChallengeToken.value = String(result.mfaChallengeToken || "");
      mfaCode.value = "";
      isRecoveryMode.value = false;
      mfaMethod.value = "code";
      resetMfaQrState();
      message.info(t("login.messages.mfaCodePrompt"));
      await nextTick();
      focusNamedInput("mfa-totp-code");
      return;
    }

    if (result.success) {
      clearLoginCooldown();
      resetMfaState();
      finishLogin();
    } else {
      resetMfaState();
      if (Number(result?.retryAfter) > 0) {
        startLoginCooldown(result.retryAfter);
      }
      await announceFormError(result.message || t("login.messages.mfaFailed"));
      message.error(result.message);
    }
  } catch (error) {
    await announceFormError(t("login.messages.mfaFailed"), "username");
    console.error("Login validation failed:", error);
  }
};

const handleVerifyMfa = async () => {
  if (!isMfaPending.value) {
    return;
  }
  if (isMfaQrMode.value) {
    return;
  }

  const rawCode = String(mfaCode.value || "").trim();
  if (!rawCode) {
    await announceFormError(t("login.messages.mfaCodePrompt"), isRecoveryMode.value ? "mfa-recovery-code" : "mfa-totp-code");
    message.warning(t("login.messages.mfaCancelled"));
    return;
  }

  const verifyResult = await authStore.verifyMfaLogin({
    mfaChallengeToken: mfaChallengeToken.value,
    ...(isRecoveryMode.value ? { recoveryCode: rawCode } : { totpCode: rawCode }),
  });

  if (!verifyResult.success) {
    await announceFormError(
      verifyResult.message || t("login.messages.mfaFailed"),
      isRecoveryMode.value ? "mfa-recovery-code" : "mfa-totp-code",
    );
    message.error(verifyResult.message || t("login.messages.mfaFailed"));
    return;
  }

  formErrorMessage.value = "";
  resetMfaState();
  message.success(t("login.messages.mfaSuccess"));
  finishLogin();
};

const toggleMfaMode = () => {
  isRecoveryMode.value = !isRecoveryMode.value;
  mfaCode.value = "";
  nextTick(() => {
    focusNamedInput(isRecoveryMode.value ? "mfa-recovery-code" : "mfa-totp-code");
  });
};

const handleMfaQrPoll = async () => {
  if (!mfaQrSessionId.value || !isMfaPending.value || !isMfaQrMode.value) {
    return;
  }

  const verifyResult = await authStore.verifyMfaQrLogin({
    sessionId: mfaQrSessionId.value,
  });
  if (!verifyResult.success) {
    mfaQrStatus.value = "expired";
    stopMfaQrPolling();
    announceFormError(verifyResult.message || t("login.messages.mfaFailed"));
    message.error(verifyResult.message || t("login.messages.mfaFailed"));
    return;
  }
  if (verifyResult.pending) {
    mfaQrStatus.value = "pending";
    return;
  }

  resetMfaState();
  formErrorMessage.value = "";
  message.success(t("login.messages.mfaSuccess"));
  finishLogin();
};

const startMfaQrFlow = async () => {
  if (!isMfaPending.value) {
    return;
  }
  mfaMethod.value = "qr";
  mfaQrStatus.value = "loading";
  stopMfaQrPolling();

  const sessionResult = await authStore.createMfaQrSession({
    mfaChallengeToken: mfaChallengeToken.value,
  });
  if (!sessionResult.success || !sessionResult?.data?.sessionId) {
    mfaQrStatus.value = "expired";
    await announceFormError(sessionResult.message || t("login.messages.mfaFailed"));
    message.error(sessionResult.message || t("login.messages.mfaFailed"));
    return;
  }

  mfaQrSessionId.value = String(sessionResult.data.sessionId || "");
  const approvalUrl = `${window.location.origin}/mfa-qr-approve#sid=${encodeURIComponent(mfaQrSessionId.value)}`;
  try {
    mfaQrDataUrl.value = await qrToDataURL(approvalUrl, {
      width: 220,
      margin: 1,
    });
  } catch {
    mfaQrDataUrl.value = "";
  }

  mfaQrStatus.value = "pending";
  await handleMfaQrPoll();
  if (!isMfaPending.value || !isMfaQrMode.value || !mfaQrSessionId.value) {
    return;
  }
  mfaQrPollingTimer = setInterval(() => {
    handleMfaQrPoll();
  }, 1800);
};

const toggleMfaMethod = () => {
  if (!isMfaPending.value) {
    return;
  }
  if (isMfaQrMode.value) {
    mfaMethod.value = "code";
    resetMfaQrState();
    return;
  }
  startMfaQrFlow();
};

const cancelMfa = () => {
  resetMfaState();
  formErrorMessage.value = "";
  message.warning(t("login.messages.mfaCancelled"));
};

const handleSocialLogin = (provider) => {
  message.info(
    provider === "qq"
      ? t("login.messages.qqPending")
      : t("login.messages.wechatPending"),
  );
};

onMounted(() => {
  requestAnimationFrame(() => {
    isPageReady.value = true;
  });
  if (authStore.isAuthenticated) {
    router.push(getDefaultAuthenticatedPath(authStore.user));
  }
});

onBeforeUnmount(() => {
  clearLoginCooldown();
  stopMfaQrPolling();
});
</script>

<style scoped lang="scss">
.login-page {
  min-height: 100dvh;
  position: relative;
  overflow: hidden;
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.bg-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(72px);
}

.orb-a {
  width: 36vw;
  height: 36vw;
  min-width: 260px;
  min-height: 260px;
  top: -10vh;
  left: -10vw;
  background: radial-gradient(
    circle,
    rgba(15, 107, 255, 0.24),
    transparent 70%
  );
}

.orb-b {
  width: 34vw;
  height: 34vw;
  min-width: 240px;
  min-height: 240px;
  right: -10vw;
  bottom: -12vh;
  background: radial-gradient(circle, rgba(0, 163, 137, 0.2), transparent 72%);
}

.orb-c {
  width: 28vw;
  height: 28vw;
  min-width: 200px;
  min-height: 200px;
  right: 20vw;
  top: 10vh;
  background: radial-gradient(circle, rgba(14, 116, 144, 0.16), transparent 74%);
}

.grid-mask {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(15, 107, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 107, 255, 0.06) 1px, transparent 1px);
  background-size: 44px 44px;
  opacity: 0.26;
  mask-image: radial-gradient(circle at center, black 30%, transparent 86%);
}

.login-shell {
  width: min(1120px, 100%);
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 18px;
  position: relative;
  z-index: 2;
}

.reveal-up {
  opacity: 0;
  transform: translateY(18px);
}

.login-page--ready .reveal-up {
  animation: login-reveal-up 0.7s cubic-bezier(0.2, 0.7, 0.1, 1) forwards;
}

.login-page--ready .reveal-delay-2 {
  animation-delay: 0.14s;
}

.intro-panel,
.login-card {
  border: 1px solid var(--border-light);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-medium);
}

[data-theme="dark"] .intro-panel,
[data-theme="dark"] .login-card {
  background: rgba(8, 22, 41, 0.78);
}

.intro-panel {
  padding: 28px;
}

.intro-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
}

.intro-kicker {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--primary-color);
  margin-bottom: 3px;
}

.intro-brand h1 {
  font-size: 28px;
  line-height: 1.1;
}

.intro-text {
  margin: 16px 0 20px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.features-list {
  display: grid;
  gap: 10px;
}

.feature-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.66);
  opacity: 0;
  transform: translateY(12px);
}

[data-theme="dark"] .feature-item {
  background: rgba(7, 21, 39, 0.7);
}

.login-page--ready .feature-item {
  animation: login-reveal-up 0.55s ease forwards;
}

.login-page--ready .feature-item:nth-child(1) {
  animation-delay: 0.22s;
}

.login-page--ready .feature-item:nth-child(2) {
  animation-delay: 0.3s;
}

.login-page--ready .feature-item:nth-child(3) {
  animation-delay: 0.38s;
}

.login-page--ready .feature-item:nth-child(4) {
  animation-delay: 0.46s;
}

.feature-icon {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(
    135deg,
    var(--primary-color),
    var(--secondary-color)
  );
}

.feature-icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.feature-content h3 {
  font-size: 15px;
  margin-bottom: 2px;
}

.feature-content p {
  font-size: 13px;
  color: var(--text-secondary);
}

.login-card {
  padding: 28px;
}

.card-header {
  margin-bottom: 18px;
}

.card-header h2 {
  font-size: 28px;
  margin-bottom: 6px;
}

.card-header p {
  color: var(--text-secondary);
}

.form-options {
  margin: 2px 0 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.rate-limit-hint {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 124, 51, 0.32);
  background: rgba(255, 124, 51, 0.08);
  color: #b44c16;
  font-size: 13px;
}

.login-button {
  margin-top: 2px;
}

.mfa-panel {
  margin: 4px 0 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-light);
  background: rgba(15, 107, 255, 0.06);
  display: grid;
  gap: 10px;
}

[data-theme="dark"] .mfa-panel {
  background: rgba(15, 107, 255, 0.14);
}

.mfa-title {
  font-size: 15px;
  font-weight: 600;
}

.mfa-hint {
  color: var(--text-secondary);
  font-size: 13px;
}

.mfa-actions {
  margin-top: -2px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.mfa-qr-wrap {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.mfa-qr-image {
  width: 220px;
  max-width: 100%;
  border-radius: 12px;
  border: 1px solid var(--border-light);
  background: #fff;
  padding: 8px;
}

.mfa-qr-status {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.divider-text {
  color: var(--text-tertiary);
  font-size: 13px;
}

.social-login {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.social-button {
  border-radius: 10px;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.social-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 18px rgba(15, 107, 255, 0.16);
}

.register-prompt {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.register-prompt--muted {
  margin-top: 4px;
  color: var(--text-tertiary);
}

.text-action-btn {
  min-height: 40px;
  padding: 8px 10px;
}

@keyframes login-reveal-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 980px) {
  .login-shell {
    grid-template-columns: 1fr;
  }

  .intro-panel {
    order: 2;
  }
}

@media (max-width: 680px) {
  .login-page {
    padding: 12px;
  }

  .intro-panel,
  .login-card {
    padding: 18px;
    border-radius: 16px;
  }

  .card-header h2,
  .intro-brand h1 {
    font-size: 24px;
  }

  .social-login {
    grid-template-columns: 1fr;
  }
}
</style>
