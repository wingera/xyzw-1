<template>
  <div class="wechat-contact-page">
    <div class="wechat-contact-page__bg" aria-hidden="true"></div>

    <div class="container wechat-contact-page__container">
      <button class="wechat-contact-page__back" type="button" @click="router.push('/pricing')">
        返回价格菜单
      </button>

      <n-spin :show="loading">
        <section v-if="status === 'ready' && contact" class="wechat-contact-card">
          <span class="wechat-contact-card__eyebrow">微信联系</span>
          <h1>{{ contact.title }}</h1>
          <p v-if="contact.subtitle" class="wechat-contact-card__subtitle">{{ contact.subtitle }}</p>

          <template v-if="contact.contactType === 'landing_qr'">
            <div class="wechat-contact-card__qr-shell">
              <img alt="微信二维码" :src="contact.qrImageDataUrl">
            </div>
            <div class="wechat-contact-card__info">
              <div class="info-row">
                <span>微信号</span>
                <strong>{{ contact.wechatId || "未提供" }}</strong>
              </div>
            </div>
            <div class="wechat-contact-card__actions">
              <n-button
                type="primary"
                :disabled="!contact.wechatId"
                @click="copyWechatId"
              >
                复制微信号
              </n-button>
              <n-button @click="router.push('/pricing')">返回价格菜单</n-button>
            </div>
          </template>

          <template v-else-if="contact.contactType === 'external_url'">
            <div class="wechat-contact-card__redirect">
              <strong>即将离开本站</strong>
              <p>目标站点：{{ targetHostname || "链接解析失败" }}</p>
            </div>
            <div class="wechat-contact-card__actions">
              <n-button
                type="primary"
                :disabled="!safeTargetUrl"
                @click="goToTarget"
              >
                继续前往
              </n-button>
              <n-button @click="router.push('/pricing')">返回价格菜单</n-button>
            </div>
          </template>

          <template v-else>
            <div class="wechat-contact-card__redirect">
              <strong>正在跳转到联系入口...</strong>
              <p>如果没有自动跳转，请点击下方按钮继续。</p>
            </div>
            <div class="wechat-contact-card__actions">
              <n-button type="primary" @click="goToTarget">立即跳转</n-button>
              <n-button @click="router.push('/pricing')">返回价格菜单</n-button>
            </div>
          </template>
        </section>

        <section v-else-if="status === 'missing'" class="wechat-contact-card">
          <span class="wechat-contact-card__eyebrow">微信联系</span>
          <h1>联系人不存在或已停用</h1>
          <p class="wechat-contact-card__subtitle">这个联系入口可能已被下线，请返回价格菜单查看最新入口。</p>
          <div class="wechat-contact-card__actions">
            <n-button type="primary" @click="router.push('/pricing')">返回价格菜单</n-button>
          </div>
        </section>

        <section v-else-if="status === 'error'" class="wechat-contact-card">
          <span class="wechat-contact-card__eyebrow">微信联系</span>
          <h1>联系人加载失败</h1>
          <p class="wechat-contact-card__subtitle">{{ errorText || "请稍后再试" }}</p>
          <div class="wechat-contact-card__actions">
            <n-button type="primary" @click="loadContact">重试</n-button>
            <n-button @click="router.push('/pricing')">返回价格菜单</n-button>
          </div>
        </section>
      </n-spin>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useMessage } from "naive-ui/es";
import { useRoute, useRouter } from "vue-router";
import api from "@/api";

const route = useRoute();
const router = useRouter();
const message = useMessage();

const loading = ref(false);
const status = ref("loading");
const errorText = ref("");
const contact = ref(null);

const safeTargetUrl = computed(() => {
  const raw = String(contact.value?.targetUrl || "").trim();
  if (!raw) {
    return "";
  }
  try {
    return new URL(raw).toString();
  } catch {
    return "";
  }
});

const targetHostname = computed(() => {
  if (!safeTargetUrl.value) {
    return "";
  }
  try {
    return new URL(safeTargetUrl.value).hostname || "";
  } catch {
    return "";
  }
});

const copyText = async (text) => {
  if (!text) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
};

const goToTarget = () => {
  const targetUrl = safeTargetUrl.value;
  if (!targetUrl) {
    message.error("目标链接无效");
    return;
  }
  window.location.href = targetUrl;
};

const maybeRedirect = () => {
  const current = contact.value;
  if (!current) {
    return;
  }
  if (current.contactType === "wecom_kf_link") {
    goToTarget();
  }
};

const loadContact = async () => {
  const slug = String(route.params.slug || "").trim();
  if (!slug) {
    status.value = "missing";
    contact.value = null;
    return;
  }

  loading.value = true;
  errorText.value = "";
  try {
    const res = await api.publicWechat.detail(slug);
    if (!res?.success || !res?.data) {
      status.value = "error";
      errorText.value = res?.message || "联系人加载失败";
      return;
    }
    contact.value = res.data;
    status.value = "ready";
    maybeRedirect();
  } catch (error) {
    const messageText = String(error?.message || "");
    contact.value = null;
    if (messageText.includes("不存在")) {
      status.value = "missing";
      return;
    }
    status.value = "error";
    errorText.value = messageText || "联系人加载失败";
  } finally {
    loading.value = false;
  }
};

const copyWechatId = async () => {
  const wechatId = String(contact.value?.wechatId || "").trim();
  if (!wechatId) {
    message.error("当前联系人没有填写微信号");
    return;
  }
  try {
    const ok = await copyText(wechatId);
    if (!ok) {
      message.error("复制失败，请手动复制");
      return;
    }
    message.success("微信号已复制");
  } catch (error) {
    message.error(error?.message || "复制失败，请手动复制");
  }
};

watch(
  () => route.params.slug,
  () => {
    loadContact();
  },
);

onMounted(() => {
  loadContact();
});
</script>

<style scoped lang="scss">
.wechat-contact-page {
  min-height: 100dvh;
  position: relative;
  overflow: clip;
  padding: 32px 0;
}

.wechat-contact-page__bg {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(circle at 12% 18%, rgba(15, 107, 255, 0.22), transparent 34%),
    radial-gradient(circle at 88% 80%, rgba(0, 163, 137, 0.24), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0));
  pointer-events: none;
}

.wechat-contact-page__container {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 18px;
}

.wechat-contact-page__back {
  width: fit-content;
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.wechat-contact-card {
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  padding: 26px;
  border-radius: 28px;
  background: var(--surface-glass-strong);
  border: 1px solid var(--surface-glass-border);
  box-shadow: var(--shadow-light);
  backdrop-filter: blur(12px);
  display: grid;
  gap: 18px;
  text-align: center;
}

.wechat-contact-card__eyebrow {
  display: inline-flex;
  margin: 0 auto;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(15, 107, 255, 0.1);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.wechat-contact-card h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 40px);
}

.wechat-contact-card__subtitle,
.wechat-contact-card__redirect p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.wechat-contact-card__qr-shell {
  width: min(320px, 72vw);
  margin: 0 auto;
  padding: 14px;
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 34px rgba(15, 107, 255, 0.12);
}

.wechat-contact-card__qr-shell img {
  width: 100%;
  display: block;
  object-fit: contain;
}

.wechat-contact-card__info {
  display: grid;
  gap: 10px;
}

.info-row {
  display: grid;
  gap: 6px;
}

.info-row span {
  font-size: 12px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.info-row strong,
.wechat-contact-card__redirect strong {
  font-size: 18px;
}

.wechat-contact-card__actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .wechat-contact-page {
    padding: 18px 0 28px;
  }

  .wechat-contact-card {
    padding: 20px;
    border-radius: 22px;
  }
}
</style>
