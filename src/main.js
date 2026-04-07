import "@arco-design/web-vue/dist/arco.css";
import "virtual:uno.css";
import "./assets/styles/global.scss";

import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import App from "./App.vue";
import { useAuthStore } from "@/stores/auth";
import { i18n, initializeI18n } from "@/i18n";
import { setupRouterGuards } from "@/router/guards";
import { useTheme } from "@/composables/useTheme";
import { APP_MOTION_STORAGE_KEY } from "@/constants/ui";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(i18n);

const CHUNK_RECOVERY_STORAGE_KEY = "xyzw:chunk-recovery";
const CHUNK_RECOVERY_COOLDOWN_MS = 15_000;

const isRecoverableChunkLoadError = (error) => {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "importing a module script failed",
    "unable to preload css for",
  ].some(fragment => message.includes(fragment));
};

const getChunkRecoveryRecord = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const setChunkRecoveryRecord = (record) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      CHUNK_RECOVERY_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    // ignore sessionStorage write failures
  }
};

const clearChunkRecoveryRecord = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(CHUNK_RECOVERY_STORAGE_KEY);
  } catch {
    // ignore sessionStorage cleanup failures
  }
};

const normalizeRecoveryTarget = (targetPath) => {
  if (typeof window === "undefined") {
    return "/";
  }
  if (typeof targetPath === "string" && targetPath.startsWith("/")) {
    return targetPath;
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

const recoverFromChunkLoadError = (error, targetPath) => {
  if (!isRecoverableChunkLoadError(error) || typeof window === "undefined") {
    return false;
  }

  const nextTarget = normalizeRecoveryTarget(targetPath);
  const lastAttempt = getChunkRecoveryRecord();
  const now = Date.now();
  const attemptedRecently = lastAttempt
    && lastAttempt.target === nextTarget
    && now - Number(lastAttempt.timestamp || 0) < CHUNK_RECOVERY_COOLDOWN_MS;

  if (attemptedRecently) {
    return false;
  }

  setChunkRecoveryRecord({
    target: nextTarget,
    timestamp: now,
  });
  window.location.assign(nextTarget);
  return true;
};

const renderBootstrapError = (error) => {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  const message = String(error?.message || "应用初始化失败，请刷新后重试");
  root.replaceChildren();

  const shell = document.createElement("div");
  shell.style.minHeight = "100vh";
  shell.style.position = "relative";
  shell.style.overflow = "hidden";
  shell.style.padding = "32px 20px";
  shell.style.background =
    "radial-gradient(circle at 18% 18%, rgba(101, 142, 255, 0.18), transparent 30%), radial-gradient(circle at 82% 22%, rgba(64, 193, 255, 0.16), transparent 28%), linear-gradient(180deg, #f7fbff 0%, #f9fafb 52%, #f5f7fb 100%)";
  shell.style.fontFamily = "'Avenir Next','PingFang SC','Microsoft YaHei',sans-serif";
  shell.style.color = "#101828";

  const gridMask = document.createElement("div");
  gridMask.style.position = "absolute";
  gridMask.style.inset = "0";
  gridMask.style.pointerEvents = "none";
  gridMask.style.opacity = "0.4";
  gridMask.style.backgroundImage =
    "linear-gradient(rgba(121, 136, 168, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(121, 136, 168, 0.08) 1px, transparent 1px)";
  gridMask.style.backgroundSize = "32px 32px";

  const layout = document.createElement("div");
  layout.style.position = "relative";
  layout.style.zIndex = "1";
  layout.style.minHeight = "calc(100vh - 64px)";
  layout.style.display = "flex";
  layout.style.flexDirection = "column";
  layout.style.justifyContent = "space-between";
  layout.style.maxWidth = "1200px";
  layout.style.margin = "0 auto";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "16px";

  const brand = document.createElement("div");
  brand.style.display = "flex";
  brand.style.alignItems = "center";
  brand.style.gap = "12px";
  brand.style.cursor = "pointer";
  brand.addEventListener("click", () => {
    window.location.href = "/";
  });

  const brandLogo = document.createElement("img");
  brandLogo.src = "/icons/xiaoyugan.png";
  brandLogo.alt = "XYZW";
  brandLogo.style.width = "40px";
  brandLogo.style.height = "40px";
  brandLogo.style.borderRadius = "14px";
  brandLogo.style.boxShadow = "0 10px 24px rgba(63, 119, 173, 0.22)";

  const brandCopy = document.createElement("div");
  brandCopy.style.display = "flex";
  brandCopy.style.flexDirection = "column";

  const brandTitle = document.createElement("strong");
  brandTitle.style.fontSize = "18px";
  brandTitle.style.letterSpacing = "0.04em";
  brandTitle.textContent = "XYZW";

  const brandSubtitle = document.createElement("span");
  brandSubtitle.style.fontSize = "13px";
  brandSubtitle.style.color = "#667085";
  brandSubtitle.textContent = "游戏管理系统";

  brandCopy.append(brandTitle, brandSubtitle);
  brand.append(brandLogo, brandCopy);

  const headerActions = document.createElement("div");
  headerActions.style.display = "flex";
  headerActions.style.flexWrap = "wrap";
  headerActions.style.justifyContent = "flex-end";
  headerActions.style.gap = "10px";

  const createGhostButton = (label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.height = "40px";
    button.style.padding = "0 18px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid rgba(63, 119, 173, 0.24)";
    button.style.background = "rgba(255,255,255,0.72)";
    button.style.color = "#21517c";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    button.style.backdropFilter = "blur(12px)";
    button.addEventListener("click", onClick);
    return button;
  };

  headerActions.append(
    createGhostButton("登录", () => {
      window.location.href = "/login";
    }),
    createGhostButton("使用邀请码注册", () => {
      window.location.href = "/register";
    }),
  );
  header.append(brand, headerActions);

  const center = document.createElement("div");
  center.style.display = "flex";
  center.style.alignItems = "center";
  center.style.justifyContent = "center";
  center.style.padding = "36px 0";

  const card = document.createElement("div");
  card.style.maxWidth = "620px";
  card.style.width = "100%";
  card.style.background = "rgba(255,255,255,0.76)";
  card.style.border = "1px solid rgba(216, 223, 236, 0.92)";
  card.style.borderRadius = "32px";
  card.style.padding = "32px";
  card.style.backdropFilter = "blur(18px)";
  card.style.boxShadow = "0 26px 60px rgba(33, 81, 124, 0.14)";

  const badge = document.createElement("div");
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.gap = "8px";
  badge.style.padding = "8px 12px";
  badge.style.marginBottom = "16px";
  badge.style.borderRadius = "999px";
  badge.style.background = "rgba(235, 245, 255, 0.9)";
  badge.style.color = "#21517c";
  badge.style.fontSize = "13px";
  badge.style.fontWeight = "600";
  badge.textContent = "启动异常";

  const title = document.createElement("h1");
  title.style.margin = "0 0 12px";
  title.style.fontSize = "clamp(28px, 4vw, 42px)";
  title.style.lineHeight = "1.08";
  title.style.letterSpacing = "-0.04em";
  title.textContent = "应用启动失败";

  const description = document.createElement("p");
  description.style.margin = "0 0 20px";
  description.style.lineHeight = "1.75";
  description.style.fontSize = "16px";
  description.style.color = "#475467";
  description.textContent =
    "页面没能顺利完成初始化。你可以先刷新一次，如果问题还在，再回到首页或重新登录。";

  const detail = document.createElement("div");
  detail.style.padding = "16px 18px";
  detail.style.marginBottom = "22px";
  detail.style.borderRadius = "20px";
  detail.style.background = "rgba(247, 249, 252, 0.96)";
  detail.style.border = "1px solid rgba(228, 231, 236, 0.96)";

  const detailLabel = document.createElement("strong");
  detailLabel.style.display = "block";
  detailLabel.style.marginBottom = "8px";
  detailLabel.style.fontSize = "13px";
  detailLabel.style.color = "#21517c";
  detailLabel.textContent = "错误信息";

  const detailText = document.createElement("p");
  detailText.style.margin = "0";
  detailText.style.whiteSpace = "pre-wrap";
  detailText.style.wordBreak = "break-word";
  detailText.style.lineHeight = "1.7";
  detailText.style.fontSize = "14px";
  detailText.style.color = "#344054";
  detailText.textContent = message;
  detail.append(detailLabel, detailText);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.flexWrap = "wrap";
  actions.style.gap = "12px";

  const primaryButton = document.createElement("button");
  primaryButton.type = "button";
  primaryButton.style.height = "46px";
  primaryButton.style.padding = "0 20px";
  primaryButton.style.border = "none";
  primaryButton.style.borderRadius = "14px";
  primaryButton.style.background = "linear-gradient(135deg, #3f77ad 0%, #2a84d6 100%)";
  primaryButton.style.color = "#fff";
  primaryButton.style.fontWeight = "600";
  primaryButton.style.cursor = "pointer";
  primaryButton.style.boxShadow = "0 18px 32px rgba(63, 119, 173, 0.24)";
  primaryButton.textContent = "刷新页面";
  primaryButton.addEventListener("click", () => {
    window.location.reload();
  });

  const secondaryButton = createGhostButton("回到首页", () => {
    window.location.href = "/";
  });
  secondaryButton.style.height = "46px";
  secondaryButton.style.borderRadius = "14px";

  actions.append(primaryButton, secondaryButton);
  card.append(badge, title, description, detail, actions);
  center.append(card);

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.alignItems = "center";
  footer.style.justifyContent = "space-between";
  footer.style.gap = "12px";
  footer.style.flexWrap = "wrap";
  footer.style.paddingTop = "8px";
  footer.style.color = "#667085";
  footer.style.fontSize = "13px";

  const footerText = document.createElement("span");
  footerText.textContent = "如果你刚刚退出登录，返回首页后可以重新进入登录或注册流程。";

  const footerMeta = document.createElement("span");
  const version = String(import.meta.env.VITE_APP_VERSION || "").trim();
  const buildId = String(import.meta.env.VITE_BUILD_ID || "").trim();
  footerMeta.textContent = [version ? `v${version}` : "", buildId ? `build ${buildId}` : ""]
    .filter(Boolean)
    .join(" · ");

  footer.append(footerText, footerMeta);
  layout.append(header, center, footer);
  shell.append(gridMask, layout);
  root.append(shell);
};

const applyMotionPreference = () => {
  const preference = localStorage.getItem(APP_MOTION_STORAGE_KEY) || "force";
  if (preference === "force") {
    document.documentElement.setAttribute("data-motion", "force");
  } else {
    document.documentElement.removeAttribute("data-motion");
  }
};

const bootstrap = async () => {
  applyMotionPreference();

  const { initializeThemeState } = useTheme();
  initializeThemeState();

  if (typeof window !== "undefined") {
    window.addEventListener("vite:preloadError", (event) => {
      if (recoverFromChunkLoadError(event.payload)) {
        event.preventDefault();
      }
    });

    window.addEventListener("unhandledrejection", (event) => {
      if (recoverFromChunkLoadError(event.reason)) {
        event.preventDefault();
      }
    });
  }

  router.onError((error, to) => {
    if (recoverFromChunkLoadError(error, to?.fullPath)) {
      return;
    }
    console.error("[router] navigation failed:", error);
  });

  await initializeI18n();
  const authStore = useAuthStore();
  await authStore.initializeAuth();
  setupRouterGuards(router);
  app.use(router);
  await router.isReady();
  clearChunkRecoveryRecord();
  app.mount("#app");
};

bootstrap().catch((error) => {
  console.error("[bootstrap] failed:", error);
  renderBootstrapError(error);
});
