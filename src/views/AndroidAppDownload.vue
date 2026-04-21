<template>
  <div class="android-app-page public-brand-page">
    <div aria-hidden="true" class="android-app-page__bg public-brand-bg">
      <span class="android-app-page__orb android-app-page__orb--a public-brand-orb public-brand-orb--a"></span>
      <span class="android-app-page__orb android-app-page__orb--b public-brand-orb public-brand-orb--b"></span>
      <span class="public-brand-grid"></span>
    </div>

    <main class="android-app-page__main">
      <section class="android-app-page__hero public-brand-glass-card">
        <div aria-hidden="true" class="android-app-page__hero-glow"></div>
        <div class="container android-app-page__hero-inner">
          <div class="android-app-page__copy">
            <span class="android-app-page__eyebrow">
              <n-icon>
                <LogoAndroid></LogoAndroid>
              </n-icon>
              {{ t("androidAppPage.eyebrow") }}
            </span>
            <h1>{{ t("androidAppPage.title") }}</h1>
            <p class="android-app-page__subtitle">
              {{ t("androidAppPage.subtitle") }}
            </p>

            <div class="android-app-page__status-row">
              <div
                class="android-app-page__status"
                :class="{ 'android-app-page__status--pending': !downloadConfig.isConfigured }"
              >
                <n-icon>
                  <component :is="downloadConfig.isConfigured ? DownloadOutline : ShieldCheckmark"></component>
                </n-icon>
                <span>
                  {{
                    downloadConfig.isConfigured
                      ? t("androidAppPage.status.ready")
                      : t("androidAppPage.status.pending")
                  }}
                </span>
              </div>
              <span class="android-app-page__release-pill">
                {{ t("androidAppPage.preview.release") }}
              </span>
            </div>

            <div class="android-app-page__actions">
              <n-button
                class="android-app-page__download-button"
                size="large"
                type="primary"
                :disabled="!downloadConfig.isConfigured"
                @click="handleDownload"
              >
                <template #icon>
                  <n-icon>
                    <DownloadOutline></DownloadOutline>
                  </n-icon>
                </template>
                {{ t("androidAppPage.actions.download") }}
              </n-button>
              <n-button
                ghost
                class="android-app-page__secondary-button"
                size="large"
                type="primary"
                @click="router.push('/')"
              >
                {{ t("androidAppPage.actions.backHome") }}
              </n-button>
            </div>

            <p class="android-app-page__meta">
              {{
                downloadConfig.isConfigured
                  ? t("androidAppPage.status.readyHint", { url: downloadConfig.downloadUrl })
                  : t("androidAppPage.status.unavailableHint")
              }}
            </p>

            <div aria-label="Android App highlights" class="android-app-page__highlight-grid">
              <article
                v-for="item in highlightCards"
                :key="item.id"
                class="android-app-page__highlight-item"
              >
                <span>{{ item.value }}</span>
                <strong>{{ item.label }}</strong>
              </article>
            </div>
          </div>

          <div aria-label="Android App preview" class="android-app-page__visual">
            <div class="android-app-page__floating-card android-app-page__floating-card--download">
              <n-icon>
                <DownloadOutline></DownloadOutline>
              </n-icon>
              <div>
                <span>{{ t("androidAppPage.preview.packageLabel") }}</span>
                <strong>{{ t("androidAppPage.preview.packageValue") }}</strong>
              </div>
            </div>

            <div class="android-app-page__phone-shell">
              <div class="android-app-page__phone-bezel">
                <div class="android-app-page__phone-screen">
                  <div class="android-app-page__phone-status">
                    <span>9:41</span>
                    <span></span>
                  </div>
                  <div class="android-app-page__phone-top">
                    <div>
                      <span>{{ t("androidAppPage.preview.kicker") }}</span>
                      <strong>{{ t("androidAppPage.preview.title") }}</strong>
                    </div>
                    <div class="android-app-page__phone-logo">
                      <LogoAndroid></LogoAndroid>
                    </div>
                  </div>
                  <div class="android-app-page__phone-card android-app-page__phone-card--primary">
                    <span>{{ t("androidAppPage.preview.sessionLabel") }}</span>
                    <strong>{{ t("androidAppPage.preview.sessionValue") }}</strong>
                  </div>
                  <div class="android-app-page__phone-row">
                    <span>{{ t("androidAppPage.preview.apiLabel") }}</span>
                    <strong>{{ t("androidAppPage.preview.apiValue") }}</strong>
                  </div>
                  <div class="android-app-page__phone-row">
                    <span>{{ t("androidAppPage.preview.wsLabel") }}</span>
                    <strong>{{ t("androidAppPage.preview.wsValue") }}</strong>
                  </div>
                  <div class="android-app-page__phone-bottom">
                    <span></span>
                  </div>
                </div>
              </div>
            </div>

            <div class="android-app-page__floating-card android-app-page__floating-card--secure">
              <n-icon>
                <ShieldCheckmark></ShieldCheckmark>
              </n-icon>
              <div>
                <span>{{ t("androidAppPage.preview.secureLabel") }}</span>
                <strong>{{ t("androidAppPage.preview.secureValue") }}</strong>
              </div>
            </div>

            <div class="android-app-page__panel public-brand-soft-card">
              <div class="android-app-page__panel-head">
                <strong>{{ t("androidAppPage.panel.title") }}</strong>
                <span>{{ t("androidAppPage.panel.badge") }}</span>
              </div>

              <div class="android-app-page__feature-list">
                <article
                  v-for="item in featureCards"
                  :key="item.id"
                  class="android-app-page__feature-item"
                >
                  <div class="android-app-page__feature-icon">
                    <component :is="item.icon"></component>
                  </div>
                  <div>
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.description }}</p>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, markRaw } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { getAndroidAppDownloadConfig } from "@/utils/androidAppDownload";
import {
  DownloadOutline,
  Flash,
  LogoAndroid,
  PhonePortraitOutline,
  ShieldCheckmark,
} from "@vicons/ionicons5";

const router = useRouter();
const { t } = useI18n();

const downloadConfig = computed(() => getAndroidAppDownloadConfig(import.meta.env));
const highlightCards = computed(() => [
  {
    id: "package",
    value: t("androidAppPage.highlights.package.value"),
    label: t("androidAppPage.highlights.package.label"),
  },
  {
    id: "session",
    value: t("androidAppPage.highlights.session.value"),
    label: t("androidAppPage.highlights.session.label"),
  },
  {
    id: "realtime",
    value: t("androidAppPage.highlights.realtime.value"),
    label: t("androidAppPage.highlights.realtime.label"),
  },
]);
const featureCards = computed(() => [
  {
    id: "native",
    icon: markRaw(PhonePortraitOutline),
    title: t("androidAppPage.features.native.title"),
    description: t("androidAppPage.features.native.description"),
  },
  {
    id: "session",
    icon: markRaw(ShieldCheckmark),
    title: t("androidAppPage.features.session.title"),
    description: t("androidAppPage.features.session.description"),
  },
  {
    id: "sync",
    icon: markRaw(Flash),
    title: t("androidAppPage.features.sync.title"),
    description: t("androidAppPage.features.sync.description"),
  },
]);

const handleDownload = () => {
  if (!downloadConfig.value.isConfigured || typeof window === "undefined") {
    return;
  }

  if (downloadConfig.value.isExternal) {
    window.open(downloadConfig.value.downloadUrl, "_blank", "noopener,noreferrer");
    return;
  }

  window.location.assign(downloadConfig.value.downloadUrl);
};
</script>

<style scoped lang="scss">
.android-app-page {
  min-height: 100dvh;
  position: relative;
  overflow: clip;
  --android-blue: #2563eb;
  --android-cyan: #0891b2;
  --android-orange: #f97316;
  --android-ink: #0f172a;
  --android-muted: #526070;
  --android-card: rgba(255, 255, 255, 0.84);
}

.android-app-page__bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.android-app-page__orb--a {
  left: -12vw;
  top: -4vh;
  opacity: 0.72;
}

.android-app-page__orb--b {
  right: -10vw;
  top: 10vh;
  opacity: 0.64;
}

.android-app-page__bg::after {
  content: "";
  position: absolute;
  right: 8vw;
  bottom: -20vh;
  width: 46vw;
  height: 46vw;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(249, 115, 22, 0.18), transparent 68%);
  filter: blur(28px);
}

.android-app-page__main {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 54px 24px 76px;
}

.android-app-page__hero {
  position: relative;
  margin: 0 auto;
  width: min(1240px, 100%);
  border-radius: 38px;
  overflow: hidden;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.7) 46%, rgba(232, 242, 255, 0.88)),
    radial-gradient(circle at 82% 18%, rgba(37, 99, 235, 0.16), transparent 32%);
  box-shadow:
    0 34px 90px rgba(15, 23, 42, 0.14),
    0 12px 38px rgba(37, 99, 235, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.android-app-page__hero::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(37, 99, 235, 0.05) 1px, transparent 1px),
    linear-gradient(180deg, rgba(37, 99, 235, 0.05) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: linear-gradient(90deg, transparent, #000 28%, #000 78%, transparent);
  opacity: 0.48;
}

.android-app-page__hero-glow {
  position: absolute;
  right: -8%;
  top: -18%;
  width: 540px;
  height: 540px;
  pointer-events: none;
  border-radius: 999px;
  background:
    radial-gradient(circle, rgba(37, 99, 235, 0.22), transparent 62%),
    radial-gradient(circle at 30% 70%, rgba(8, 145, 178, 0.18), transparent 58%);
  filter: blur(6px);
  animation: android-download-breathe 8s ease-in-out infinite alternate;
}

.android-app-page__hero-inner {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(460px, 1.1fr);
  gap: clamp(34px, 5vw, 68px);
  align-items: center;
  min-height: 600px;
  padding: clamp(42px, 6vw, 76px);
}

.android-app-page__copy {
  display: grid;
  align-content: center;
  gap: 18px;
  min-width: 0;
  max-width: 560px;
  animation: android-download-rise 520ms ease-out both;
}

.android-app-page__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(15, 107, 255, 0.18);
  background: rgba(255, 255, 255, 0.78);
  color: var(--android-blue);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.02em;
  box-shadow: 0 10px 26px rgba(37, 99, 235, 0.1);
}

[data-theme="dark"] .android-app-page__eyebrow {
  background: rgba(9, 22, 40, 0.76);
}

.android-app-page__eyebrow :deep(svg) {
  width: 16px;
  height: 16px;
}

.android-app-page h1 {
  margin: 0;
  max-width: 10ch;
  color: var(--android-ink);
  font-size: clamp(3.1rem, 5.1vw, 5.95rem);
  line-height: 0.94;
  letter-spacing: -0.065em;
  text-wrap: balance;
}

.android-app-page__subtitle {
  margin: 0;
  max-width: 560px;
  color: var(--android-muted);
  font-size: 17px;
  line-height: 1.86;
}

.android-app-page__status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.android-app-page__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  border: 1px solid rgba(37, 99, 235, 0.18);
  color: var(--android-blue);
  font-weight: 800;
}

.android-app-page__status--pending {
  background: rgba(148, 163, 184, 0.14);
  border-color: rgba(148, 163, 184, 0.22);
  color: var(--text-secondary);
}

.android-app-page__release-pill {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  color: #9a3412;
  background: rgba(249, 115, 22, 0.13);
  border: 1px solid rgba(249, 115, 22, 0.18);
  font-size: 13px;
  font-weight: 800;
}

.android-app-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 2px;
}

.android-app-page__download-button {
  min-width: 238px;
  box-shadow: 0 16px 32px rgba(37, 99, 235, 0.25);
}

.android-app-page__secondary-button {
  min-width: 126px;
}

.android-app-page__meta {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}

.android-app-page__highlight-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;
}

.android-app-page__highlight-item {
  min-height: 84px;
  padding: 14px;
  border: 1px solid rgba(37, 99, 235, 0.12);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.android-app-page__highlight-item span {
  display: block;
  margin-bottom: 4px;
  color: var(--android-blue);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.android-app-page__highlight-item strong {
  color: var(--android-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}

.android-app-page__visual {
  position: relative;
  min-height: 530px;
  animation: android-download-rise 620ms 80ms ease-out both;
}

.android-app-page__phone-shell {
  position: absolute;
  z-index: 1;
  right: clamp(78px, 10vw, 150px);
  top: 4px;
  width: 286px;
  transform: rotate(-4deg);
  filter: drop-shadow(0 32px 48px rgba(15, 23, 42, 0.2));
}

.android-app-page__phone-bezel {
  padding: 12px;
  border-radius: 42px;
  background:
    linear-gradient(145deg, #0f172a, #1f2a44),
    #0f172a;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    inset 0 -10px 24px rgba(255, 255, 255, 0.04);
}

.android-app-page__phone-screen {
  display: grid;
  gap: 14px;
  min-height: 514px;
  padding: 18px;
  border-radius: 32px;
  overflow: hidden;
  background:
    radial-gradient(circle at 76% 12%, rgba(59, 130, 246, 0.26), transparent 30%),
    radial-gradient(circle at 20% 92%, rgba(249, 115, 22, 0.16), transparent 34%),
    linear-gradient(180deg, #f8fbff 0%, #e9f1ff 100%);
}

.android-app-page__phone-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #1e293b;
  font-size: 12px;
  font-weight: 800;
}

.android-app-page__phone-status span:last-child {
  width: 52px;
  height: 18px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.1);
}

.android-app-page__phone-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-top: 10px;
}

.android-app-page__phone-top span,
.android-app-page__phone-card span,
.android-app-page__phone-row span,
.android-app-page__floating-card span {
  display: block;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.android-app-page__phone-top strong {
  display: block;
  margin-top: 4px;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.04;
  letter-spacing: -0.04em;
}

.android-app-page__phone-logo {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(135deg, var(--android-blue), var(--android-cyan));
  box-shadow: 0 14px 28px rgba(37, 99, 235, 0.22);
}

.android-app-page__phone-logo :deep(svg) {
  width: 24px;
  height: 24px;
}

.android-app-page__phone-card,
.android-app-page__phone-row {
  border: 1px solid rgba(37, 99, 235, 0.12);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 12px 28px rgba(37, 99, 235, 0.08);
}

.android-app-page__phone-card {
  margin-top: 10px;
  padding: 18px;
  border-radius: 24px;
}

.android-app-page__phone-card strong {
  display: block;
  margin-top: 6px;
  color: #0f172a;
  font-size: 18px;
  line-height: 1.25;
}

.android-app-page__phone-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 18px;
}

.android-app-page__phone-row strong {
  color: var(--android-blue);
  font-size: 13px;
}

.android-app-page__phone-bottom {
  display: grid;
  place-items: center;
  margin-top: auto;
  padding-top: 10px;
}

.android-app-page__phone-bottom span {
  width: 92px;
  height: 5px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.18);
}

.android-app-page__floating-card {
  position: absolute;
  z-index: 3;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;
  min-width: 206px;
  padding: 14px 16px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.14);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.android-app-page__floating-card :deep(.n-icon) {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(135deg, var(--android-blue), var(--android-cyan));
}

.android-app-page__floating-card strong {
  display: block;
  margin-top: 3px;
  color: #0f172a;
  font-size: 14px;
}

.android-app-page__floating-card--download {
  left: 0;
  top: 56px;
  animation: android-download-float 5.6s ease-in-out infinite;
}

.android-app-page__floating-card--secure {
  z-index: 5;
  right: -4px;
  top: 96px;
  animation: android-download-float 6.4s 600ms ease-in-out infinite;
}

.android-app-page__panel {
  position: absolute;
  z-index: 4;
  left: 0;
  right: 32px;
  bottom: 0;
  display: grid;
  gap: 14px;
  align-content: start;
  padding: 20px;
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(248, 251, 255, 0.9)),
    rgba(255, 255, 255, 0.94);
  box-shadow: 0 24px 54px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
}

.android-app-page__panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
}

.android-app-page__panel-head strong {
  font-size: 18px;
}

.android-app-page__panel-head span {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.1);
  color: var(--android-blue);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.android-app-page__feature-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.android-app-page__feature-item {
  display: grid;
  gap: 12px;
  align-items: start;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(37, 99, 235, 0.12);
  background: rgba(255, 255, 255, 0.88);
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease;
}

.android-app-page__feature-item:hover {
  transform: translateY(-3px);
  border-color: rgba(37, 99, 235, 0.22);
  box-shadow: 0 16px 32px rgba(37, 99, 235, 0.1);
}

[data-theme="dark"] .android-app-page__feature-item {
  background: rgba(8, 19, 34, 0.72);
}

.android-app-page__feature-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  color: #fff;
  background: linear-gradient(135deg, var(--android-blue), var(--android-cyan));
}

.android-app-page__feature-icon :deep(svg) {
  width: 22px;
  height: 22px;
}

.android-app-page__feature-item strong {
  display: block;
  margin-bottom: 6px;
  font-size: 15px;
  line-height: 1.3;
}

.android-app-page__feature-item p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.58;
  font-size: 13px;
}

[data-theme="dark"] .android-app-page {
  --android-ink: #f8fafc;
  --android-muted: #cbd5e1;
}

[data-theme="dark"] .android-app-page__hero {
  background:
    linear-gradient(145deg, rgba(8, 22, 41, 0.94), rgba(8, 22, 41, 0.72) 48%, rgba(15, 23, 42, 0.9)),
    radial-gradient(circle at 82% 18%, rgba(96, 165, 250, 0.16), transparent 32%);
}

[data-theme="dark"] .android-app-page__highlight-item,
[data-theme="dark"] .android-app-page__panel,
[data-theme="dark"] .android-app-page__floating-card {
  background: rgba(8, 22, 41, 0.74);
  border-color: rgba(148, 163, 184, 0.18);
}

[data-theme="dark"] .android-app-page__floating-card strong {
  color: #f8fafc;
}

@keyframes android-download-rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes android-download-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-10px);
  }
}

@keyframes android-download-breathe {
  from {
    transform: scale(0.96);
    opacity: 0.74;
  }

  to {
    transform: scale(1.04);
    opacity: 1;
  }
}

@media (max-width: 1120px) {
  .android-app-page__hero-inner {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .android-app-page__copy {
    max-width: none;
  }

  .android-app-page h1 {
    max-width: 12ch;
  }

  .android-app-page__visual {
    min-height: auto;
    display: grid;
    gap: 18px;
  }

  .android-app-page__phone-shell,
  .android-app-page__floating-card,
  .android-app-page__panel {
    position: relative;
    inset: auto;
  }

  .android-app-page__phone-shell {
    justify-self: center;
    transform: none;
  }

  .android-app-page__floating-card {
    justify-self: stretch;
  }

  .android-app-page__feature-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .android-app-page__main {
    padding: 20px 0 40px;
  }

  .android-app-page__hero {
    width: min(100%, calc(100% - 4px));
    border-radius: 28px;
  }

  .android-app-page__hero-inner {
    gap: 18px;
    padding: 26px 18px;
  }

  .android-app-page h1 {
    max-width: 11ch;
    font-size: clamp(2.45rem, 14vw, 3.4rem);
  }

  .android-app-page__subtitle {
    font-size: 15px;
  }

  .android-app-page__actions {
    flex-direction: column;
  }

  .android-app-page__download-button,
  .android-app-page__actions :deep(.n-button) {
    width: 100%;
  }

  .android-app-page__highlight-grid {
    grid-template-columns: 1fr;
  }

  .android-app-page__phone-shell {
    width: min(286px, 100%);
  }

  .android-app-page__panel {
    padding: 18px;
  }

  .android-app-page__panel-head {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .android-app-page__copy,
  .android-app-page__visual,
  .android-app-page__hero-glow,
  .android-app-page__floating-card {
    animation: none;
  }

  .android-app-page__feature-item {
    transition: none;
  }
}

/* Public refactor v2 */
@media (min-width: 981px) {
  .android-app-page {
    background:
      radial-gradient(circle at 10% 16%, rgba(37, 99, 235, 0.12), transparent 30%),
      radial-gradient(circle at 88% 14%, rgba(8, 145, 178, 0.1), transparent 28%),
      linear-gradient(180deg, #edf5ff 0%, #f8fafc 52%, #f2eee7 100%);
  }

  .android-app-page__main {
    padding: 52px 32px 76px;
  }

  .android-app-page__hero {
    width: min(1160px, 100%);
    min-height: 640px;
    border-radius: 32px;
    background:
      linear-gradient(115deg, rgba(255, 253, 248, 0.98) 0%, rgba(255, 255, 255, 0.94) 56%, rgba(239, 246, 255, 0.98) 100%);
    border: 1px solid #d8e2ef;
    box-shadow:
      0 28px 70px rgba(15, 23, 42, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }

  .android-app-page__hero-inner {
    grid-template-columns: minmax(0, 0.92fr) minmax(430px, 1fr);
    min-height: 640px;
    padding: 54px;
  }

  .android-app-page h1 {
    max-width: 10ch;
    color: #101828;
    font-size: clamp(3.15rem, 5vw, 5.65rem);
    line-height: 0.94;
    letter-spacing: -0.075em;
  }

  .android-app-page__subtitle {
    max-width: 560px;
    color: #475569;
    font-size: 17px;
    line-height: 1.84;
  }

  .android-app-page__phone-shell {
    right: 116px;
    transform: rotate(-2deg);
  }

  .android-app-page__panel,
  .android-app-page__floating-card,
  .android-app-page__highlight-item {
    border: 1px solid #d8e2ef;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 20px 48px rgba(15, 23, 42, 0.1);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .android-app-page__feature-item {
    background: #ffffff;
  }
}
</style>
