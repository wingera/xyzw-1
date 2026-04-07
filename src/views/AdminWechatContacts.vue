<template>
  <div v-if="canAccess" class="admin-wechat-page">
    <div class="container admin-wechat-page__container">
      <div class="page-header">
        <div>
          <h1>微信联系配置</h1>
          <p>管理价格菜单里的微信联系人入口，支持二维码落地页、企业微信客服链接和外部链接。</p>
        </div>
        <div class="page-header__actions">
          <n-button :loading="loading" @click="fetchContacts">刷新</n-button>
          <n-button type="primary" @click="openCreateModal">新增联系人</n-button>
        </div>
      </div>

      <div class="summary-bar">
        <span>共 {{ contacts.length }} 条</span>
        <span>展示中 {{ visibleCount }} 条</span>
        <span>启用中 {{ activeCount }} 条</span>
      </div>

      <n-spin :show="loading">
        <div v-if="contacts.length" class="contact-list">
          <n-card
            v-for="row in contacts"
            :key="row.id"
            embedded
            class="contact-card"
          >
            <div class="contact-card__head">
              <div>
                <div class="contact-card__title-row">
                  <h2>{{ row.title }}</h2>
                  <span class="slug-chip">{{ row.slug }}</span>
                </div>
                <p v-if="row.subtitle" class="contact-card__subtitle">{{ row.subtitle }}</p>
              </div>
              <div class="contact-card__tags">
                <span class="type-chip">{{ contactTypeLabelMap[row.contactType] || row.contactType }}</span>
                <span class="status-chip" :class="{ 'status-chip--off': !row.isActive }">
                  {{ row.isActive ? "已启用" : "已停用" }}
                </span>
                <span class="status-chip" :class="{ 'status-chip--off': !row.showInPricing }">
                  {{ row.showInPricing ? "价格菜单可见" : "价格菜单隐藏" }}
                </span>
              </div>
            </div>

            <div class="contact-card__meta">
              <div class="meta-item">
                <span>类型</span>
                <strong>{{ contactTypeLabelMap[row.contactType] || row.contactType }}</strong>
              </div>
              <div class="meta-item">
                <span>排序</span>
                <strong>{{ row.sortOrder }}</strong>
              </div>
              <div class="meta-item">
                <span>更新时间</span>
                <strong>{{ formatDate(row.updatedAt) }}</strong>
              </div>
            </div>

            <div v-if="row.contactType !== 'landing_qr' && row.targetUrl" class="contact-card__target">
              <span>目标链接</span>
              <a :href="row.targetUrl" rel="noreferrer" target="_blank">{{ row.targetUrl }}</a>
            </div>

            <div v-if="row.contactType === 'landing_qr'" class="contact-card__landing">
              <div v-if="row.qrImageDataUrl" class="contact-card__preview">
                <img alt="二维码预览" :src="row.qrImageDataUrl">
              </div>
              <div class="contact-card__landing-meta">
                <span>微信号</span>
                <strong>{{ row.wechatId || "未填写" }}</strong>
              </div>
            </div>

            <div class="contact-card__toggles">
              <label class="toggle-item">
                <span>启用状态</span>
                <n-switch
                  :disabled="Boolean(rowSavingMap[row.id])"
                  :value="row.isActive"
                  @update:value="(value) => toggleIsActive(row, value)"
                ></n-switch>
              </label>
              <label class="toggle-item">
                <span>显示到 Pricing</span>
                <n-switch
                  :disabled="Boolean(rowSavingMap[row.id])"
                  :value="row.showInPricing"
                  @update:value="(value) => toggleShowInPricing(row, value)"
                ></n-switch>
              </label>
              <div class="toggle-item toggle-item--sort">
                <span>排序值</span>
                <div class="sort-editor">
                  <n-input-number
                    v-model:value="sortDraftMap[row.id]"
                    :disabled="Boolean(rowSavingMap[row.id])"
                    :min="0"
                    :precision="0"
                  ></n-input-number>
                  <n-button
                    :loading="Boolean(rowSavingMap[row.id])"
                    tertiary
                    @click="saveSortOrder(row)"
                  >
                    保存排序
                  </n-button>
                </div>
              </div>
            </div>

            <div class="contact-card__actions">
              <n-button tertiary @click="openEditModal(row)">编辑</n-button>
              <n-button
                tertiary
                type="error"
                :loading="Boolean(rowSavingMap[row.id])"
                @click="confirmDelete(row)"
              >
                删除
              </n-button>
            </div>
          </n-card>
        </div>

        <n-empty
          v-else-if="!loading"
          class="empty-state"
          description="还没有配置微信联系人"
        ></n-empty>
      </n-spin>
    </div>

    <n-modal
      v-model:show="showModal"
      preset="card"
      class="wechat-form-modal"
      :mask-closable="false"
      :title="isEditing ? '编辑微信联系人' : '新增微信联系人'"
    >
      <div class="wechat-form">
        <div class="wechat-form__grid">
          <div class="field">
            <label>slug</label>
            <n-input v-model:value="form.slug" placeholder="例如：vip-buy-wechat"></n-input>
          </div>
          <div class="field">
            <label>标题</label>
            <n-input v-model:value="form.title" placeholder="例如：联系管理员微信"></n-input>
          </div>
          <div class="field field--wide">
            <label>副标题</label>
            <n-input
              v-model:value="form.subtitle"
              placeholder="例如：购买前请备注想开的版本和时长"
            ></n-input>
          </div>
          <div class="field">
            <label>联系类型</label>
            <n-select
              v-model:value="form.contactType"
              :options="contactTypeOptions"
            ></n-select>
          </div>
          <div class="field">
            <label>排序</label>
            <n-input-number v-model:value="form.sortOrder" :min="0" :precision="0"></n-input-number>
          </div>
          <div class="field field--inline">
            <label>价格菜单显示</label>
            <n-switch v-model:value="form.showInPricing"></n-switch>
          </div>
          <div class="field field--inline">
            <label>启用状态</label>
            <n-switch v-model:value="form.isActive"></n-switch>
          </div>
        </div>

        <div v-if="form.contactType === 'landing_qr'" class="wechat-form__block">
          <div class="field">
            <label>微信号</label>
            <n-input v-model:value="form.wechatId" placeholder="例如：xyzw-admin"></n-input>
          </div>
          <div class="field">
            <label>二维码图片</label>
            <div class="qr-uploader">
              <div class="qr-uploader__actions">
                <n-button @click="pickQrImage">选择二维码图片</n-button>
                <n-button
                  v-if="form.qrImageDataUrl"
                  tertiary
                  type="warning"
                  @click="clearQrImage"
                >
                  清除图片
                </n-button>
              </div>
              <p class="qr-uploader__hint">仅支持 png / jpg / jpeg / webp，会在前端转成 dataURL 后直接保存。</p>
              <input
                ref="qrFileInput"
                accept="image/png,image/jpeg,image/webp"
                class="qr-uploader__input"
                type="file"
                @change="handleQrFileChange"
              >
              <div v-if="form.qrImageDataUrl" class="qr-uploader__preview">
                <img alt="二维码预览" :src="form.qrImageDataUrl">
              </div>
            </div>
          </div>
        </div>

        <div v-else class="wechat-form__block">
          <div class="field">
            <label>目标链接</label>
            <n-input
              v-model:value="form.targetUrl"
              :placeholder="form.contactType === 'wecom_kf_link'
                ? 'https://work.weixin.qq.com/kfid/...'
                : 'https://example.com/...'"
            ></n-input>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="wechat-form__footer">
          <n-button @click="closeModal">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submitForm">
            {{ isEditing ? "保存修改" : "创建联系人" }}
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, h, onMounted, reactive, ref, watch } from "vue";
import { NInput, useDialog, useMessage } from "naive-ui/es";
import api from "@/api";
import { useAuthStore } from "@/stores/auth";

const QR_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const WECOM_KF_URL_PATTERN = /^https:\/\/work\.weixin\.qq\.com\/kfid\/[A-Za-z0-9_-]+(?:[/?#].*)?$/i;
const MAX_QR_FILE_SIZE = Math.floor(2.8 * 1024 * 1024);

const authStore = useAuthStore();
const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const saving = ref(false);
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref("");
const sensitiveConfirmToken = ref("");
const sensitiveConfirmExpiresAt = ref(0);
const contacts = ref([]);
const rowSavingMap = reactive({});
const sortDraftMap = reactive({});
const qrFileInput = ref(null);

const createDefaultForm = () => ({
  slug: "",
  title: "",
  subtitle: "",
  contactType: "landing_qr",
  targetUrl: "",
  wechatId: "",
  qrImageDataUrl: "",
  showInPricing: true,
  isActive: true,
  sortOrder: 100,
});

const form = reactive(createDefaultForm());
const canAccess = computed(
  () => authStore.isAuthenticated && Boolean(authStore.user?.isAdmin),
);
const contactTypeOptions = [
  { label: "二维码落地页", value: "landing_qr" },
  { label: "企业微信客服链接", value: "wecom_kf_link" },
  { label: "外部链接", value: "external_url" },
];
const contactTypeLabelMap = {
  landing_qr: "二维码落地页",
  wecom_kf_link: "企业微信客服链接",
  external_url: "外部链接",
};
const activeCount = computed(() => contacts.value.filter((row) => row.isActive).length);
const visibleCount = computed(() => contacts.value.filter((row) => row.showInPricing && row.isActive).length);

const formatDate = (value) =>
  value ? new Date(value).toLocaleString("zh-CN") : "-";

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
      if (settled) {
        return;
      }
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
  if (cached) {
    return cached;
  }

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
    clearSensitiveConfirmToken();
    message.error(error?.message || "二次验证失败");
    return "";
  }
};

const shouldResetConfirmCache = (error) => {
  const code = String(error?.code || "");
  const messageText = String(error?.message || "");
  const status = Number(error?.status || 0);
  return (
    status === 401
    || status === 403
    || code.startsWith("ADMIN_CONFIRM_")
    || messageText.includes("二次确认")
    || messageText.includes("二次验证")
  );
};

const syncSortDrafts = (rows) => {
  const ids = new Set(rows.map((row) => row.id));
  Object.keys(sortDraftMap).forEach((id) => {
    if (!ids.has(id)) {
      delete sortDraftMap[id];
    }
  });
  rows.forEach((row) => {
    sortDraftMap[row.id] = Number(row.sortOrder) || 100;
  });
};

const applyForm = (next) => {
  Object.assign(form, createDefaultForm(), next || {});
};

const fetchContacts = async () => {
  loading.value = true;
  try {
    const res = await api.admin.listWechatContacts();
    if (!res?.success) {
      message.error(res?.message || "加载微信联系人失败");
      return;
    }
    contacts.value = Array.isArray(res.data) ? res.data : [];
    syncSortDrafts(contacts.value);
  } catch (error) {
    message.error(error?.message || "加载微信联系人失败");
  } finally {
    loading.value = false;
  }
};

const closeModal = () => {
  showModal.value = false;
  saving.value = false;
  isEditing.value = false;
  editingId.value = "";
  applyForm();
};

const openCreateModal = () => {
  isEditing.value = false;
  editingId.value = "";
  applyForm();
  showModal.value = true;
};

const openEditModal = (row) => {
  isEditing.value = true;
  editingId.value = row.id;
  applyForm({
    slug: row.slug || "",
    title: row.title || "",
    subtitle: row.subtitle || "",
    contactType: row.contactType || "landing_qr",
    targetUrl: row.targetUrl || "",
    wechatId: row.wechatId || "",
    qrImageDataUrl: row.qrImageDataUrl || "",
    showInPricing: Boolean(row.showInPricing),
    isActive: Boolean(row.isActive),
    sortOrder: Number(row.sortOrder) || 100,
  });
  showModal.value = true;
};

const validateTargetUrl = (value, contactType) => {
  const targetUrl = String(value || "").trim();
  if (!targetUrl) {
    return "请填写目标链接";
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return "目标链接格式无效";
  }

  if (parsed.protocol !== "https:") {
    return "目标链接只允许 https";
  }

  if (contactType === "wecom_kf_link" && !WECOM_KF_URL_PATTERN.test(targetUrl)) {
    return "企业微信客服链接必须匹配 https://work.weixin.qq.com/kfid/...";
  }

  return "";
};

const validateForm = () => {
  if (!SLUG_PATTERN.test(String(form.slug || "").trim())) {
    return "slug 只允许小写字母、数字、中划线";
  }
  if (!String(form.title || "").trim()) {
    return "请填写标题";
  }

  if (form.contactType === "landing_qr") {
    if (!QR_DATA_URL_PATTERN.test(String(form.qrImageDataUrl || "").trim())) {
      return "请先上传 png/jpg/jpeg/webp 格式的二维码图片";
    }
    return "";
  }

  return validateTargetUrl(form.targetUrl, form.contactType);
};

const buildPayload = () => ({
  slug: String(form.slug || "").trim(),
  title: String(form.title || "").trim(),
  subtitle: String(form.subtitle || "").trim(),
  contactType: form.contactType,
  targetUrl: String(form.targetUrl || "").trim(),
  wechatId: String(form.wechatId || "").trim(),
  qrImageDataUrl: String(form.qrImageDataUrl || "").trim(),
  showInPricing: Boolean(form.showInPricing),
  isActive: Boolean(form.isActive),
  sortOrder: Number(form.sortOrder) || 100,
});

const submitForm = async () => {
  const validationMessage = validateForm();
  if (validationMessage) {
    message.error(validationMessage);
    return;
  }

  const confirmToken = await ensureSensitiveActionConfirmed(
    isEditing.value ? "编辑微信联系人" : "创建微信联系人",
  );
  if (!confirmToken) {
    return;
  }

  saving.value = true;
  try {
    const payload = buildPayload();
    const res = isEditing.value
      ? await api.admin.updateWechatContact(editingId.value, payload, confirmToken)
      : await api.admin.createWechatContact(payload, confirmToken);
    if (!res?.success) {
      message.error(res?.message || "保存失败");
      return;
    }
    message.success(isEditing.value ? "联系人已更新" : "联系人已创建");
    closeModal();
    await fetchContacts();
  } catch (error) {
    if (shouldResetConfirmCache(error)) {
      clearSensitiveConfirmToken();
    }
    message.error(error?.message || "保存失败");
  } finally {
    saving.value = false;
  }
};

const pickQrImage = () => {
  qrFileInput.value?.click();
};

const clearQrImage = () => {
  form.qrImageDataUrl = "";
};

const handleQrFileChange = (event) => {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  if (!["image/png", "image/jpeg", "image/webp"].includes(String(file.type || "").toLowerCase())) {
    message.error("二维码图片仅支持 png / jpg / jpeg / webp");
    input.value = "";
    return;
  }

  if (file.size > MAX_QR_FILE_SIZE) {
    message.error("二维码图片过大，请压缩到 2.8MB 以内");
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    form.qrImageDataUrl = String(reader.result || "");
    input.value = "";
  };
  reader.onerror = () => {
    message.error("读取二维码图片失败");
    input.value = "";
  };
  reader.readAsDataURL(file);
};

const withRowSaving = async (rowId, fn) => {
  rowSavingMap[rowId] = true;
  try {
    await fn();
  } finally {
    rowSavingMap[rowId] = false;
  }
};

const toggleIsActive = async (row, value) => {
  const confirmToken = await ensureSensitiveActionConfirmed(
    Boolean(value) ? "启用微信联系人" : "停用微信联系人",
  );
  if (!confirmToken) {
    return;
  }

  await withRowSaving(row.id, async () => {
    try {
      await api.admin.updateWechatContact(row.id, { isActive: Boolean(value) }, confirmToken);
      message.success(Boolean(value) ? "联系人已启用" : "联系人已停用");
      await fetchContacts();
    } catch (error) {
      if (shouldResetConfirmCache(error)) {
        clearSensitiveConfirmToken();
      }
      message.error(error?.message || "更新启用状态失败");
    }
  });
};

const toggleShowInPricing = async (row, value) => {
  const confirmToken = await ensureSensitiveActionConfirmed(
    Boolean(value) ? "显示微信联系人到价格菜单" : "从价格菜单隐藏微信联系人",
  );
  if (!confirmToken) {
    return;
  }

  await withRowSaving(row.id, async () => {
    try {
      await api.admin.updateWechatContact(
        row.id,
        { showInPricing: Boolean(value) },
        confirmToken,
      );
      message.success(Boolean(value) ? "已显示到价格菜单" : "已从价格菜单隐藏");
      await fetchContacts();
    } catch (error) {
      if (shouldResetConfirmCache(error)) {
        clearSensitiveConfirmToken();
      }
      message.error(error?.message || "更新显示状态失败");
    }
  });
};

const saveSortOrder = async (row) => {
  const nextSortOrder = Number(sortDraftMap[row.id]);
  if (!Number.isInteger(nextSortOrder) || nextSortOrder < 0) {
    message.error("排序值必须是大于等于 0 的整数");
    sortDraftMap[row.id] = Number(row.sortOrder) || 100;
    return;
  }

  const confirmToken = await ensureSensitiveActionConfirmed("修改微信联系人排序");
  if (!confirmToken) {
    return;
  }

  await withRowSaving(row.id, async () => {
    try {
      await api.admin.updateWechatContact(row.id, { sortOrder: nextSortOrder }, confirmToken);
      message.success("排序已更新");
      await fetchContacts();
    } catch (error) {
      if (shouldResetConfirmCache(error)) {
        clearSensitiveConfirmToken();
      }
      message.error(error?.message || "更新排序失败");
    }
  });
};

const confirmDelete = (row) => {
  dialog.warning({
    title: "删除微信联系人",
    content: `确认删除“${row.title}”吗？删除后价格菜单和公开页都将失效。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      const confirmToken = await ensureSensitiveActionConfirmed("删除微信联系人");
      if (!confirmToken) {
        return;
      }

      await withRowSaving(row.id, async () => {
        try {
          await api.admin.deleteWechatContact(row.id, confirmToken);
          message.success("联系人已删除");
          await fetchContacts();
        } catch (error) {
          if (shouldResetConfirmCache(error)) {
            clearSensitiveConfirmToken();
          }
          message.error(error?.message || "删除失败");
        }
      });
    },
  });
};

watch(
  () => form.contactType,
  (value) => {
    if (value === "landing_qr") {
      form.targetUrl = "";
      return;
    }
    form.wechatId = "";
    form.qrImageDataUrl = "";
  },
);

onMounted(async () => {
  applyForm();
  await fetchContacts();
});
</script>

<style scoped lang="scss">
.admin-wechat-page {
  min-height: 100dvh;
  padding: var(--spacing-lg);
}

.admin-wechat-page__container {
  display: grid;
  gap: var(--spacing-md);
}

.page-header {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
  align-items: flex-start;
}

.page-header h1 {
  margin: 0;
  font-size: var(--font-size-2xl);
}

.page-header p {
  margin: 8px 0 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.page-header__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.summary-bar {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--text-secondary);
}

.contact-list {
  display: grid;
  gap: 16px;
}

.contact-card {
  display: grid;
  gap: 16px;
}

.contact-card__head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.contact-card__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.contact-card__title-row h2 {
  margin: 0;
  font-size: 22px;
}

.slug-chip,
.type-chip,
.status-chip {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.slug-chip {
  background: rgba(15, 107, 255, 0.1);
  color: var(--primary-color);
}

.type-chip {
  background: rgba(0, 163, 137, 0.12);
  color: var(--secondary-color);
}

.status-chip {
  background: rgba(15, 107, 255, 0.08);
  color: var(--primary-color);
}

.status-chip--off {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.contact-card__subtitle {
  margin: 8px 0 0;
  color: var(--text-secondary);
}

.contact-card__tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.contact-card__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.meta-item,
.contact-card__target,
.contact-card__landing-meta {
  display: grid;
  gap: 6px;
}

.meta-item span,
.contact-card__target span,
.contact-card__landing-meta span {
  font-size: 12px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.meta-item strong,
.contact-card__landing-meta strong {
  font-weight: 700;
}

.contact-card__target a {
  color: var(--primary-color);
  word-break: break-all;
}

.contact-card__landing {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.contact-card__preview {
  width: 120px;
  height: 120px;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--surface-glass-border);
  background: rgba(255, 255, 255, 0.96);
}

.contact-card__preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.contact-card__toggles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.toggle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toggle-item span {
  color: var(--text-secondary);
}

.toggle-item--sort {
  align-items: flex-start;
}

.sort-editor {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.contact-card__actions,
.wechat-form__footer,
.qr-uploader__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.wechat-form {
  display: grid;
  gap: 18px;
}

.wechat-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.wechat-form__block {
  display: grid;
  gap: 14px;
}

.field {
  display: grid;
  gap: 8px;
}

.field label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 600;
}

.field--wide {
  grid-column: 1 / -1;
}

.field--inline {
  align-content: center;
}

.field--inline :deep(.n-switch) {
  justify-self: start;
}

.qr-uploader {
  display: grid;
  gap: 12px;
}

.qr-uploader__hint {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

.qr-uploader__input {
  display: none;
}

.qr-uploader__preview {
  width: min(320px, 100%);
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid var(--surface-glass-border);
  background: rgba(255, 255, 255, 0.96);
}

.qr-uploader__preview img {
  width: 100%;
  display: block;
  object-fit: contain;
}

@media (max-width: 768px) {
  .admin-wechat-page {
    padding: var(--spacing-md);
  }

  .page-header,
  .contact-card__head,
  .toggle-item {
    flex-direction: column;
    align-items: stretch;
  }

  .contact-card__tags {
    justify-content: flex-start;
  }

  .wechat-form__grid {
    grid-template-columns: 1fr;
  }
}
</style>
