<template>
  <div class="wx-qrcode-import">
    <!-- 微信登录流程说明 -->
    <div class="login-flow-info">
      <h3>{{ t("tokenImportWxQrcode.flow.title") }}</h3>
      <ol class="flow-steps">
        <li>{{ t("tokenImportWxQrcode.flow.step1") }}</li>
        <li>{{ t("tokenImportWxQrcode.flow.step2") }}</li>
        <li>
          {{ t("tokenImportWxQrcode.flow.step3Prefix")
          }}<strong color="red">{{
            t("tokenImportWxQrcode.flow.step3Highlight")
          }}</strong
          >{{ t("tokenImportWxQrcode.flow.step3Suffix") }}
        </li>
      </ol>
    </div>

    <!-- 二维码显示区域 -->
    <div class="qrcode-container">
      <div
        id="qr-placeholder"
        v-if="!qrcodeUrl"
        class="qr-placeholder"
        @click="generateQRCode"
      >
        <NIcon color="var(--text-tertiary)" size="48">
          <Scan></Scan>
          <!-- 使用扫码图标 -->
        </NIcon>
        <p>{{ t("tokenImportWxQrcode.status.clickToGet") }}</p>
      </div>
      <img
        id="qr-image"
        v-else
        class="qr-image"
        :alt="t('tokenImportWxQrcode.alt.qrcode')"
        :src="qrcodeUrl"
      >

      <!-- 状态信息 -->
      <div id="qr-status" class="qr-status" :class="statusType">
        {{ statusMessage }}
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <NButton
        block
        type="primary"
        :loading="isProcessing"
        @click="generateQRCode"
      >
        <template #icon>
          <NIcon>
            <Refresh></Refresh>
          </NIcon>
        </template>
        {{
          qrcodeUrl
            ? t("tokenImportWxQrcode.actions.refreshQrcode")
            : t("tokenImportWxQrcode.actions.getQrcode")
        }}
      </NButton>
    </div>

    <!-- 角色命名格式配置 -->
    <NForm
      class="mt-16"
      label-placement="top"
      :model="importForm"
      :show-label="true"
    >
      <NFormItem
        :label="t('tokenImportWxQrcode.fields.nameTemplate')"
        :show-label="true"
      >
        <NInput
          placeholder="{name}"
          v-model:value="importForm.nameTemplate"
        ></NInput>
        <template #feedback>
          {{ t("tokenImportWxQrcode.feedback.nameTemplate") }}
        </template>
      </NFormItem>
    </NForm>

    <!-- 服务器角色列表 -->
    <NCard
      v-if="serverListData && serverListData.length > 0"
      class="my-16 server-role-list-card"
      :title="t('tokenImportWxQrcode.serverListTitle')"
    >
      <NDataTable
        class="server-role-table desktop-only"
        :columns="columns"
        :data="serverListData"
        :pagination="{ pageSize: 5 }"
        :scroll-x="600"
      ></NDataTable>
      <div class="mobile-only mobile-role-list">
        <div
          v-for="(role, index) in serverListData"
          :key="role.roleId || index"
          class="mobile-role-item"
        >
          <div class="mobile-role-head">
            <strong class="mobile-role-name">{{
              role.name || t("tokenImportWxQrcode.roleFallbacks.unnamed")
            }}</strong>
            <span class="mobile-role-power"
              >{{ t("tokenImportWxQrcode.columns.power") }}
              {{ formatPower(role.power) }}</span
            >
          </div>
          <div class="mobile-role-meta">
            <span
              >{{ t("tokenImportWxQrcode.mobile.server") }}
              {{ getServerDisplay(role.serverId) }}</span
            >
            <span
              >{{ t("tokenImportWxQrcode.mobile.roleIndex") }}
              {{ getRoleIndex(role.serverId) }}</span
            >
            <span class="word-break-all"
              >{{ t("tokenImportWxQrcode.mobile.roleId") }}
              {{ role.roleId }}</span
            >
          </div>
          <div class="mobile-role-actions">
            <NButton
              block
              size="small"
              type="primary"
              @click="addSelectedRole(role)"
            >
              {{ t("tokenImportWxQrcode.actions.add") }}
            </NButton>
            <NButton
              block
              size="small"
              type="info"
              @click="handleDownload(role)"
            >
              {{ t("tokenImportWxQrcode.actions.download") }}
            </NButton>
          </div>
        </div>
      </div>
    </NCard>

    <a-list>
      <a-list-item v-for="(role, index) in roleList" :key="index">
        <div class="role-item-row">
          <div>
            <strong>{{ t("tokenImportWxQrcode.roleLabels.name") }}</strong>
            {{ role.name || t("tokenImportWxQrcode.roleFallbacks.unnamed")
            }}<br>
            <strong>{{ t("tokenImportWxQrcode.roleLabels.token") }}</strong>
            <span class="word-break-all">{{ maskedRoleToken(role.token) }}</span
            ><br>
            <strong>{{ t("tokenImportWxQrcode.roleLabels.server") }}</strong>
            {{
              role.server || t("tokenImportWxQrcode.roleFallbacks.unspecified")
            }}<br>
            <strong>{{ t("tokenImportWxQrcode.roleLabels.roleIndex") }}</strong>
            {{ role.roleIndex }}
          </div>
          <div class="role-item-actions">
            <NButton
              secondary
              size="tiny"
              @click="copyMaskedRoleToken(role.token)"
            >
              {{ t("tokenImport.actions.copyMaskedToken") }}
            </NButton>
            <NButton
              tertiary
              size="tiny"
              @click="copyFullRoleToken(role.token)"
            >
              {{ t("tokenImport.actions.copyFullToken") }}
            </NButton>
            <NButton size="small" type="error" @click="removeRole(index)">
              {{ t("tokenImportWxQrcode.actions.delete") }}
            </NButton>
          </div>
        </div>
      </a-list-item>
    </a-list>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <NButton
        block
        size="large"
        type="primary"
        :loading="isImporting"
        @click="handleImport"
      >
        <template #icon>
          <NIcon>
            <CloudUpload></CloudUpload>
          </NIcon>
        </template>
        {{ t("tokenImportWxQrcode.actions.submit") }}
      </NButton>

      <NButton block :disabled="isProcessing" @click="$emit('cancel')">
        <template #icon>
          <NIcon>
            <Close></Close>
          </NIcon>
        </template>
        {{ t("tokenImportWxQrcode.actions.cancel") }}
      </NButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, h, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Close, CloudUpload, Refresh, Scan } from "@vicons/ionicons5";
import {
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  useDialog,
  useMessage,
} from "naive-ui/es";
import { getServerList, getTokenId, transformToken } from "@/utils/token";
import { g_utils } from "@/utils/bonProtocol";
import { formatPower } from "@/utils/legionWar";
import { useTokenStore } from "@/stores/tokenStore";
import { saveBinBuffer } from "@/utils/binStorage";
import { triggerBlobDownload } from "@/utils/download";
import { isHostAllowed } from "@/utils/hostAllowlist";
import { maskToken } from "@/utils/securitySanitizer";
import {
  confirmAndCopyFullToken,
  copyMaskedToken,
} from "@/utils/sensitiveCopy";

// 定义事件
const emit = defineEmits(["cancel", "ok"]);

const debugLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    console.error(...args);
  }
};

const tokenStore = useTokenStore();

const message = useMessage();
const dialog = useDialog();
const { locale, t } = useI18n();
const isImporting = ref(false);
const importForm = reactive({
  name: "",
  server: "",
  wsUrl: "",
  nameTemplate: "{name}",
});

const removeRole = (index: number) => {
  roleList.value.splice(index, 1);
};

// 响应式数据
const qrcodeUrl = ref<string | null>(null);
const qrcodeUUID = ref<string | null>(null);
const isProcessing = ref(false);
const statusMessage = ref(t("tokenImportWxQrcode.status.clickToGet"));
const statusType = ref("info");
const accountName = ref<string | null>(null);
const isScanning = ref(false);

const WECHAT_PROXY_BASE = "/api/v1/wechat-proxy";
const XYZW_RUNTIME_SCRIPT_URLS = [
  "/xyzw/cocos2d-js-min.js",
  "/xyzw/game-defines.js",
  "/xyzw/index.js",
];
const XYZW_RUNTIME_SCRIPT_ATTR = "data-xyzw-runtime";
let xyzwRuntimeLoadPromise: Promise<void> | null = null;
const runtimeSessionIdFallback = new Map<string, string>();

const getSessionStorage = () => {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
};

const getLocalStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const clearLegacyLocalStorageItem = (key: string) => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
};

const getRuntimeSessionId = (prefix: string) => {
  const storageKey = `xyzw:${prefix}:id`;
  clearLegacyLocalStorageItem(storageKey);

  const sessionStorage = getSessionStorage();
  const existing = String(
    sessionStorage?.getItem(storageKey)
    || runtimeSessionIdFallback.get(storageKey)
    || "",
  ).trim();
  if (existing) {
    return existing;
  }

  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

  const value = `${prefix.toUpperCase()}-${randomPart}`;
  if (sessionStorage) {
    try {
      sessionStorage.setItem(storageKey, value);
      return value;
    } catch {
      // fall through to in-memory storage
    }
  }
  runtimeSessionIdFallback.set(storageKey, value);
  return value;
};

const runtimeDid = getRuntimeSessionId("did");
const distinctId = runtimeDid;
const deviceUniqueId = runtimeDid;

const ensureRuntimeHostAllowed = () => {
  const host = String(window.location.hostname || "")
    .trim()
    .toLowerCase();
  if (!host)
    throw new Error(
      t("tokenImportWxQrcode.errors.runtimeHostNotAllowed", {
        host: "unknown",
      }),
    );
  if (isHostAllowed(host, import.meta.env.VITE_XYZW_RUNTIME_ALLOWED_HOSTS))
    return;
  throw new Error(
    t("tokenImportWxQrcode.errors.runtimeHostNotAllowed", { host }),
  );
};

const loadRuntimeScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[${XYZW_RUNTIME_SCRIPT_ATTR}="${src}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`加载失败: ${src}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.defer = true;
    script.src = src;
    script.setAttribute(XYZW_RUNTIME_SCRIPT_ATTR, src);
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`加载失败: ${src}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });

const ensureXyzwRuntimeLoaded = async () => {
  ensureRuntimeHostAllowed();
  const hasRequire = Boolean((window as any).__require);
  if (hasRequire) return;

  if (!xyzwRuntimeLoadPromise) {
    xyzwRuntimeLoadPromise = (async () => {
      for (const scriptUrl of XYZW_RUNTIME_SCRIPT_URLS) {
        await loadRuntimeScript(scriptUrl);
      }
    })();
  }
  await xyzwRuntimeLoadPromise;
};

const scanInterval = ref<any>(null);
const timeout = 120000; // 120秒超时
const startTime = ref<number | null>(null);

const serverListData = ref<any[]>([]);
const currentBinData = ref<ArrayBuffer | null>(null);
const binDecodedResult = ref("");
const originalBinData = ref<any>(null);
const roleList = ref<
  Array<{
    id: string;
    name: string;
    roleId: string;
    token: string;
    server: string;
    roleIndex?: number;
    wsUrl: string;
    importMethod: string;
  }>
>([]);
const maskedRoleToken = (token: string) => maskToken(token, 4, 4) || "***";

const copyMaskedRoleToken = async (token: string) => {
  await copyMaskedToken({
    token,
    message,
    successMessage: t("tokenImport.messages.tokenCopiedMasked"),
    failureMessage: t("tokenImport.messages.clipboardCopyFailed"),
  });
};

const copyFullRoleToken = (token: string) => {
  confirmAndCopyFullToken({
    token,
    dialog,
    message,
    title: t("tokenImport.dialogs.copyFullToken.title"),
    content: t("tokenImport.dialogs.copyFullToken.content"),
    placeholder: t("tokenImport.dialogs.copyFullToken.placeholder"),
    positiveText: t("tokenImport.common.confirm"),
    negativeText: t("tokenImport.common.cancel"),
    successMessage: t("tokenImport.messages.tokenCopiedFull"),
    failureMessage: t("tokenImport.messages.clipboardCopyFailed"),
    missingConfirmMessage: t("tokenImport.messages.copyFullConfirmMissing"),
  });
};

watch(locale, () => {
  if (!qrcodeUrl.value && !isScanning.value) {
    statusMessage.value = t("tokenImportWxQrcode.status.clickToGet");
  }
});

const columns = computed(() => [
  {
    title: t("tokenImportWxQrcode.columns.serverId"),
    key: "serverId",
    render(row: any) {
      return getServerDisplay(row.serverId);
    },
  },
  {
    title: t("tokenImportWxQrcode.columns.roleIndex"),
    key: "roleIndex",
    render(row: any) {
      return getRoleIndex(row.serverId);
    },
  },
  {
    title: t("tokenImportWxQrcode.columns.roleId"),
    key: "roleId",
  },
  {
    title: t("tokenImportWxQrcode.columns.name"),
    key: "name",
  },
  {
    title: t("tokenImportWxQrcode.columns.power"),
    key: "power",
    render(row: any) {
      return formatPower(row.power);
    },
    sorter: (row1: any, row2: any) => row1.power - row2.power,
  },
  {
    title: t("tokenImportWxQrcode.columns.actions"),
    key: "actions",
    render(row: any) {
      return h("div", { style: "display: flex; gap: 8px;" }, [
        h(
          NButton,
          {
            size: "small",
            type: "primary",
            onClick: () => addSelectedRole(row),
          },
          { default: () => t("tokenImportWxQrcode.actions.add") },
        ),
        h(
          NButton,
          {
            size: "small",
            type: "info",
            onClick: () => handleDownload(row),
          },
          { default: () => t("tokenImportWxQrcode.actions.download") },
        ),
      ]);
    },
  },
]);

const getRoleIndex = (serverId: any) => {
  const sid = Number(serverId);
  if (sid >= 2000000) return 2;
  if (sid >= 1000000) return 1;
  return 0;
};

const resolveRoleIndex = (roleInfo: any) => {
  const candidate = [
    roleInfo?.roleIndex,
    roleInfo?.index,
    roleInfo?.role?.index,
  ]
    .map((value) => String(value ?? "").trim())
    .find((value) => /^\d+$/.test(value));
  if (candidate !== undefined) {
    return Number(candidate);
  }
  return getRoleIndex(roleInfo?.serverId);
};

const getServerDisplay = (serverId: any) => {
  let sid = Number(serverId);
  if (sid >= 2000000) sid -= 2000000;
  else if (sid >= 1000000) sid -= 1000000;
  return sid - 27;
};

const handleDownload = (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error(t("tokenImportWxQrcode.messages.binMissingScan"));
    return;
  }
  try {
    const newData = { ...originalBinData.value };
    newData.serverId = roleInfo.serverId; // 确保类型一致
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;

    // 构造文件名: bin-{server}-0-{roleId}-{name}.bin
    let sid = Number(roleInfo.serverId);
    const roleIndex = resolveRoleIndex(roleInfo);
    if (sid >= 2000000) {
      sid -= 2000000;
    } else if (sid >= 1000000) {
      sid -= 1000000;
    }

    const serverNum = sid - 27;
    const fileName = `bin-${serverNum}服-${roleIndex}-${roleInfo.roleId}-${roleInfo.name}.bin`;

    downloadBinFile(fileName, newBinBuffer);
    message.success(
      t("tokenImportWxQrcode.messages.downloadStarted", { fileName }),
    );
  } catch (e: any) {
    debugLog("下载失败", e instanceof Error ? e.message : e);
    message.error(
      t("tokenImportWxQrcode.messages.downloadFailed", { error: e.message }),
    );
  }
};

const addSelectedRole = async (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error(t("tokenImportWxQrcode.messages.binMissingUpload"));
    return;
  }

  try {
    const newData = { ...originalBinData.value };
    newData.serverId = roleInfo.serverId; // 确保类型一致
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;
    const tokenId = getTokenId(newBinBuffer);
    const roleToken = await transformToken(newBinBuffer);
    const roleName =
      roleInfo.name ||
      t("tokenImportWxQrcode.messages.roleFallback", {
        roleId: roleInfo.roleId,
      });

    await saveBinBuffer(tokenId, newBinBuffer);

    let sid = Number(roleInfo.serverId);
    const roleIndex = resolveRoleIndex(roleInfo);
    if (sid >= 2000000) {
      sid -= 2000000;
    } else if (sid >= 1000000) {
      sid -= 1000000;
    }
    const serverNum = sid - 27;

    const finalName = roleName;

    // 检查是否已存在相同配置 (根据角色名称和roleId)
    const exists = roleList.value.some(
      (r) => r.roleId === roleInfo.roleId && r.name === finalName,
    );

    if (exists) {
      message.warning(
        t("tokenImportWxQrcode.messages.roleAlreadyQueued", {
          name: finalName,
        }),
      );
      return;
    }

    roleList.value.push({
      id: tokenId,
      roleId: roleInfo.roleId,
      activationRoleId: String(roleInfo.roleId || ""),
      activationGameAccountId: String(roleInfo.roleId || ""),
      token: roleToken,
      name: finalName,
      server: `${String(serverNum)}服`,
      roleIndex,
      wsUrl: importForm.wsUrl || "",
      importMethod: "wxQrcode",
      binSourceState: "available",
      binSourceMissingAt: null,
    });

    message.success(
      t("tokenImportWxQrcode.messages.roleAdded", { name: finalName }),
    );
  } catch (e: any) {
    debugLog("添加角色失败", e instanceof Error ? e.message : e);
    message.error(
      t("tokenImportWxQrcode.messages.addRoleFailed", { error: e.message }),
    );
  }
};

/**
 * 生成微信登录二维码
 */
const generateQRCode = async () => {
  try {
    isProcessing.value = true;
    updateStatus(t("tokenImportWxQrcode.status.loading"), "info");

    await ensureXyzwRuntimeLoaded();

    // 重置状态
    resetQRCode();

    // 调用获取二维码接口
    const success = await tryGetWeixinQR();

    if (!success) {
      throw new Error(t("tokenImportWxQrcode.messages.qrcodeFailed"));
    }
  } catch (error) {
    updateStatus(
      t("tokenImportWxQrcode.messages.qrcodeFailedWithReason", {
        error: error.message,
      }),
      "error",
    );
    debugLog("获取二维码失败:", error instanceof Error ? error.message : error);
  } finally {
    isProcessing.value = false;
  }
};

/**
 * 尝试获取微信二维码
 */
const tryGetWeixinQR = async () => {
  try {
    const qrPageUrl =
      `${WECHAT_PROXY_BASE}/qrconnect` +
      "?appid=wxfb0d5667e5cb1c44" +
      "&bundleid=com.hortor.games.xyzw" +
      "&scope=snsapi_base,snsapi_userinfo,snsapi_friend,snsapi_message" +
      "&state=weixin";

    const response = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", qrPageUrl, true);
      xhr.timeout = 15000;
      xhr.setRequestHeader("Accept", "text/html");
      xhr.onload = () => resolve(xhr);
      xhr.onerror = () =>
        reject(new Error(t("tokenImportWxQrcode.errors.networkError")));
      xhr.ontimeout = () =>
        reject(new Error(t("tokenImportWxQrcode.errors.requestTimeout")));
      xhr.send();
    });

    if (response.status !== 200) {
      throw new Error(
        t("tokenImportWxQrcode.errors.httpStatus", { status: response.status }),
      );
    }

    const html = response.responseText;
    const doc = new DOMParser().parseFromString(html, "text/html");

    let qrUrl = doc.querySelector("img.auth_qrcode")?.src;

    if (!qrUrl) {
      const m = html.match(/https:\/\/[^"']*qrcode[^"']*/i);
      if (m) qrUrl = m[0];
    }

    if (!qrUrl) {
      throw new Error(t("tokenImportWxQrcode.errors.qrcodeUrlMissing"));
    }

    // 解析 uuid
    qrcodeUUID.value = qrUrl.split("/").pop().split("?")[0];
    qrcodeUrl.value = qrUrl;

    // 更新状态
    updateStatus(t("tokenImportWxQrcode.status.scanPrompt"), "success");

    // 开始轮询扫码状态
    startScanMonitoring();
    return true;
  } catch (err) {
    debugLog("二维码解析失败:", err instanceof Error ? err.message : err);
    updateStatus(
      t("tokenImportWxQrcode.messages.qrcodeFailedWithReason", {
        error: err.message,
      }),
      "error",
    );
    return false;
  }
};

/**
 * 开始轮询扫码状态
 */
const startScanMonitoring = () => {
  if (isScanning.value) return;

  isScanning.value = true;
  startTime.value = Date.now();

  scanInterval.value = setInterval(() => {
    checkScanStatus();
  }, 1000);
};

/**
 * 检查扫码状态
 */
const checkScanStatus = async () => {
  try {
    if (!qrcodeUUID.value) return;

    const elapsed = Date.now() - startTime.value;
    if (elapsed > timeout) {
      updateStatus(t("tokenImportWxQrcode.status.timeout"), "error");
      stopScanMonitoring();
      resetQRCode();
      return;
    }

    const res = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${WECHAT_PROXY_BASE}/qrstatus`, true);
      xhr.timeout = 5000;
      xhr.setRequestHeader("Accept", "*/*");
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.onload = () => resolve(xhr);
      xhr.onerror = () => resolve({ status: 0 });
      xhr.ontimeout = () => resolve({ status: 0 });
      xhr.send(JSON.stringify({ uuid: qrcodeUUID.value }));
    });

    if (res.status === 200) {
      const text = res.responseText;

      // 405 → 扫码确认
      if (text.includes("window.wx_errcode=405")) {
        // 提取code
        const codeMatch = text.match(
          /wx_redirecturl='[^']*code=([a-zA-Z0-9]+)/,
        );
        // 提取nickname
        const nicknameMatch = text.match(
          /window\.wx_nickname\s*=\s*['"]([^'"]+)['"]/,
        );

        if (codeMatch) {
          const code = codeMatch[1];
          const nickname = nicknameMatch ? nicknameMatch[1] : "";

          stopScanMonitoring();
          updateStatus(
            t("tokenImportWxQrcode.status.loginSuccess", {
              nickname: nickname || t("tokenImportWxQrcode.status.unknownUser"),
            }),
            "success",
          );
          await handleScanSuccess(code, nickname);
          return;
        }
      }

      // 408 → 已过期
      if (text.includes("window.wx_errcode=408")) {
        updateStatus(t("tokenImportWxQrcode.status.expired"), "error");
        stopScanMonitoring();
        resetQRCode();
        return;
      }
    }

    // 每30秒提醒一次
    const remain = Math.ceil((timeout - elapsed) / 1000);
    if (remain % 30 === 0) {
      updateStatus(
        t("tokenImportWxQrcode.status.scanRemaining", { remain }),
        "info",
      );
    }
  } catch (err) {
    debugLog("扫码状态检查失败:", err instanceof Error ? err.message : err);
  }
};

/**
 * 停止扫码监控
 */
const stopScanMonitoring = () => {
  isScanning.value = false;
  if (scanInterval.value) {
    clearInterval(scanInterval.value);
    scanInterval.value = null;
  }
};

/**
 * 处理扫码成功
 */
const handleScanSuccess = async (code: string, nickname = "") => {
  try {
    isProcessing.value = true;

    // 获取加密数据
    const encrypted = await getEncryptedData(code);
    if (encrypted) {
      await saveAccount(encrypted.buffer, nickname);
    }
  } catch (err: any) {
    updateStatus(
      t("tokenImportWxQrcode.messages.processFailed", { error: err.message }),
      "error",
    );
    debugLog("扫码处理失败:", err instanceof Error ? err.message : err);
  } finally {
    isProcessing.value = false;
  }
};

/**
 * 请求Hortor登录接口，并用encodePayload加密
 */
const getEncryptedData = async (code) => {
  const payload = {
    gameId: "xyzwapp",
    code,
    gameTp: "app",
    sysInfo:
      "{\"system\":\"Android\",\"hortorSDKVersion\":\"4.0.6-cn\",\"model\":\"22081212C\",\"brand\":\"Redmi\"}",
    channel: "android",
    appFrom: "com.tencent.mm",
    noLogin: "2",
    distinctId,
    state: "hortor",
    packageName: "com.hortor.games.xyzw",
    tp: "app-we",
    signPrint: "E6:F7:FE:A9:EC:8E:24:D0:4F:2A:32:50:28:78:E1:C5:5E:70:81:13",
  };

  const rawJson = JSON.stringify(payload);
  const encoded = encodePayload(rawJson);

  const loginUrl =
    `${WECHAT_PROXY_BASE}/hortor-login` +
    `?gameId=xyzwapp` +
    `&timestamp=${Date.now()}&version=android-4.2.1-cn-release` +
    `&cryptVersion=1.1.0` +
    `&gameTp=app&system=android` +
    `&packageName=com.hortorgames.xyzw`;

  const res = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", loginUrl, true);
    xhr.timeout = 15000;
    xhr.setRequestHeader("Accept", "*/*");
    xhr.setRequestHeader("Content-Type", "text/plain; charset=utf-8");
    xhr.setRequestHeader("X-XYZW-Device-Unique-Id", deviceUniqueId);
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () =>
      reject(new Error(t("tokenImportWxQrcode.errors.loginFailed")));
    xhr.ontimeout = () =>
      reject(new Error(t("tokenImportWxQrcode.errors.loginTimeout")));
    xhr.send(encoded);
  });

  if (res.status !== 200) {
    throw new Error(
      t("tokenImportWxQrcode.errors.httpStatus", { status: res.status }),
    );
  }

  const json = JSON.parse(res.responseText);
  if (json.meta?.errCode !== 0) {
    throw new Error(
      t("tokenImportWxQrcode.errors.loginFailedWithReason", {
        error: json.meta?.errMsg,
      }),
    );
  }

  const combUser = json.data?.combUser;
  if (!combUser) {
    throw new Error(t("tokenImportWxQrcode.errors.invalidLoginResponse"));
  }
  // 这里简化处理，实际应该调用游戏加密模块生成bin
  // 由于是前端环境，我们模拟生成一个token
  const dm = (window as any).__require?.("13");
  if (!dm?.encMsg || !dm?.lz4XorEncode)
    throw new Error(t("tokenImportWxQrcode.errors.cryptoModuleMissing"));

  const encryptedBuffer = dm.encMsg(
    {
      platform: "hortor",
      platformExt: "mix",
      info: combUser,
      serverId: null,
      scene: 0,
      referrerInfo: "",
    },
    { decrypt: dm.lz4XorDecode, encrypt: dm.lz4XorEncode },
  );

  return new Uint8Array(encryptedBuffer);
};

/**
 * 将登录JSON文本编码成最终payload
 */
const encodePayload = (text) => {
  // 注意：这个超长字符串必须和原脚本里的一模一样！
  const cipherTable =
    "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";

  const xorShift = 1;
  const shuffleTimes = 6;
  const step = 3;

  const mid = codeBase64(text, cipherTable, shuffleTimes, step, xorShift);
  const final = encodeBase64(mid);
  return final;
};

const decodePayload = (cipherText) => {
  const xorShift = 1;
  const shuffleTimes = 6;
  const step = 3;

  const cipherTable = encodePayload
    .toString()
    .match(/const cipherTable = "([^"]+)"/)[1];

  const mid = atob(cipherText);
  const shuffled = transCode(cipherTable, shuffleTimes);
  const key = getCodeKey(shuffled, step);
  const base64Text = dealWithString(mid, key, xorShift);
  return decodeURIComponent(escape(atob(base64Text)));
};

const codeBase64 = (text, cipherTable, shuffleTimes, step, xorShift) => {
  const base64Text = encodeBase64(text);
  if (cipherTable) {
    const shuffled = transCode(cipherTable, shuffleTimes);
    const key = getCodeKey(shuffled, step);
    return dealWithString(base64Text, key, xorShift);
  }
  return null;
};

const encodeBase64 = (text) => {
  if (!text) return null;
  return btoa(unescape(encodeURIComponent(text)));
};

const transCode = (str, times) => {
  if (times <= 0) return str;
  if (str.length % 2 !== 0) return null;

  const right = rightSide(str);
  const left = leftSide(str);
  return transCode(right, times - 1) + transCode(left, times - 1);
};

const rightSide = (str) => {
  if (str.length % 2 !== 0) return null;
  return str.substring(Math.floor(str.length / 2));
};

const leftSide = (str) => {
  if (str.length % 2 !== 0) return null;
  return str.substring(0, Math.floor(str.length / 2));
};

const getCodeKey = (str, step) => {
  const chars = str.split("");
  const result = [];
  const count = Math.floor(str.length / step);
  for (let i = 0; i < count; i++) {
    result.push(chars[i * step]);
  }
  return result.join("");
};

const dealWithString = (src, key, shift) => {
  if (!src || !key) return null;

  const v = src.split("");
  const w = key.split("");
  const out = Array.from({ length: v.length });

  let idx = w.length >> shift;
  for (let i = 0; i < v.length; i++) {
    if (idx >= w.length) idx = 0;
    out[i] = String.fromCharCode(v[i].charCodeAt(0) ^ w[idx].charCodeAt(0));
    idx++;
  }
  return out.join("");
};

/**
 * 保存账号
 */
const saveAccount = async (arrBuf: ArrayBuffer, nickname = "") => {
  const name = accountName.value?.trim();

  const bin = new Uint8Array(arrBuf);
  currentBinData.value = bin.buffer;

  try {
    const listStr = await getServerList(bin.buffer);
    const parsedList = JSON.parse(listStr);
    // 转换为数组并排序
    if (parsedList && typeof parsedList === "object") {
      serverListData.value = Object.values(parsedList).sort(
        (a: any, b: any) => b.power - a.power,
      );
    } else {
      serverListData.value = [];
    }
    message.success(t("tokenImportWxQrcode.messages.serverListLoaded"));
  } catch (err) {
    debugLog(
      "Failed to get server list",
      err instanceof Error ? err.message : err,
    );
    message.warning(t("tokenImportWxQrcode.messages.serverListLoadFailed"));
    serverListData.value = [];
  }
  // 尝试解析 bin 文件内容
  try {
    const binMsg = g_utils.parse(bin.buffer);
    let binData = binMsg.getData();
    if (!binData && (binMsg as any)._raw) {
      binData = { ...(binMsg as any)._raw };
    }

    binDecodedResult.value = JSON.stringify(binData, null, 2);
    originalBinData.value = binData;
  } catch (err: any) {
    debugLog("Bin文件解析失败", err instanceof Error ? err.message : err);
    binDecodedResult.value = t("tokenImportWxQrcode.messages.parseFailed", {
      error: err.message || err,
    });
  }
};

const handleImport = async () => {
  if (roleList.value.length === 0) {
    message.error(t("tokenImportWxQrcode.messages.uploadFirst"));
    return;
  }
  roleList.value.forEach((role) => {
    // tokenStore.gameTokens中发现已存在的重复名称，则移出token后重新添加
    const gameToken = tokenStore.gameTokens.find((t) => t.id === role.id);
    if (gameToken) {
      // tokenStore.removeToken(gameToken.id);
      tokenStore.updateToken(gameToken.id, {
        ...role,
      });
    } else {
      tokenStore.addToken({
        ...role,
      });
    }
  });
  message.success(t("tokenImportWxQrcode.messages.importSuccess"));
  roleList.value = [];
  emit("ok");
};

const downloadBinFile = (fileName, bin) => {
  const blob = new Blob([new Uint8Array(bin)], {
    type: "application/octet-stream",
  });
  triggerBlobDownload({ blob, fileName });
};

/**
 * 更新状态信息
 */
const updateStatus = (message, type = "info") => {
  statusMessage.value = message;
  statusType.value = type;
};

/**
 * 重置二维码状态
 */
const resetQRCode = () => {
  stopScanMonitoring();
  qrcodeUUID.value = null;
  qrcodeUrl.value = null;
  updateStatus(t("tokenImportWxQrcode.status.clickToGet"), "info");
};

onUnmounted(() => {
  // 组件卸载时清理资源
  stopScanMonitoring();
});
</script>

<style scoped lang="scss">
.mt-16 {
  margin-top: 16px;
}

.my-16 {
  margin-top: 16px;
  margin-bottom: 16px;
}

.role-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.role-item-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.word-break-all {
  word-break: break-all;
}

.wx-qrcode-import {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg) 0;
}

.login-flow-info {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-md);

  h3 {
    margin: 0 0 var(--spacing-sm) 0;
    color: var(--text-primary);
    font-size: var(--font-size-md);
  }

  .flow-steps {
    margin: 0;
    padding-left: var(--spacing-lg);
    color: var(--text-secondary);

    li {
      margin-bottom: var(--spacing-xs);
      font-size: var(--font-size-sm);
    }
  }
}

.qrcode-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xl) 0;
}

.qr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 200px;
  border: 2px dashed var(--border-light);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all var(--transition-normal);
  background: var(--bg-tertiary);

  &:hover {
    border-color: var(--primary-color);
    background: rgba(102, 126, 234, 0.05);
  }

  p {
    margin: var(--spacing-sm) 0 0 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
}

.qr-image {
  width: 200px;
  height: 200px;
  border: 2px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all var(--transition-normal);

  &:hover {
    border-color: var(--primary-color);
    box-shadow: var(--shadow-small);
  }
}

.qr-status {
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-align: center;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--border-radius-small);

  &.info {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
  }

  &.success {
    color: var(--success-color);
    background: rgba(16, 185, 129, 0.1);
  }

  &.error {
    color: var(--error-color);
    background: rgba(239, 68, 68, 0.1);
  }
}

.account-name-input {
  margin-top: var(--spacing-md);
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-top: var(--spacing-xl);
}

.desktop-only {
  display: block;
}

.mobile-only {
  display: none;
}

.mobile-role-list {
  display: grid;
  gap: 10px;
}

.mobile-role-item {
  border: 1px solid var(--border-light);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-tertiary);
}

.mobile-role-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.mobile-role-name {
  color: var(--text-primary);
  font-size: 14px;
}

.mobile-role-power {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.mobile-role-meta {
  margin-top: 6px;
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.mobile-role-actions {
  margin-top: 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

@media (max-width: 768px) {
  .server-role-list-card :deep(.n-card__content) {
    padding: 10px;
  }

  .desktop-only {
    display: none;
  }

  .mobile-only {
    display: block;
  }
}
</style>
