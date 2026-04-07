<template>
  <div class="token-import-page">
    <div class="container token-import-page__container app-page">
      <section class="app-page__hero token-import-hero">
        <div class="app-page__hero-copy">
          <span class="app-page__eyebrow">Token 工作区</span>
          <h1 class="app-page__title">{{ t("tokenImport.header.title") }}</h1>
          <p class="app-page__description">
            {{ tokenHeroDescription }}
          </p>
          <div class="app-chip-row">
            <span class="app-inline-stat">
              <strong>{{
                authStore.user?.username || t("tokenImport.header.notLoggedIn")
              }}</strong>
              当前账号
            </span>
            <span class="app-inline-stat">
              <strong>{{ tokenStore.gameTokens.length }}</strong>
              已导入角色
            </span>
            <span class="app-inline-stat">
              <strong>{{ persistentTokenCount }}</strong>
              长效凭证
            </span>
            <span class="app-inline-stat">
              <strong>{{ binFiles.length }}</strong>
              BIN 文件
            </span>
          </div>
        </div>

        <div class="app-page__actions token-import-page__actions">
          <NButton
            v-if="!showImportForm"
            size="large"
            type="primary"
            @click="showImportForm = true"
          >
            <template #icon>
              <NIcon>
                <Add></Add>
              </NIcon>
            </template>
            {{ t("tokenImport.actions.addToken") }}
          </NButton>

          <NButton
            v-if="tokenStore.hasUsableWorkbenchToken"
            secondary
            size="large"
            type="primary"
            @click="goToDashboard"
          >
            <template #icon>
              <NIcon>
                <List></List>
              </NIcon>
            </template>
            {{ t("tokenImport.actions.batchFeatures") }}
          </NButton>

          <NButton
            v-if="authStore.user?.isAdmin && authStore.user?.mfaEnabled"
            quaternary
            size="large"
            type="primary"
            @click="goToAdminCenter"
          >
            管理中心
          </NButton>
        </div>
      </section>

      <div class="app-page__summary token-import-summary">
        <article
          v-for="card in tokenSummaryCards"
          :key="card.label"
          class="app-summary-card"
        >
          <span class="app-summary-card__label">{{ card.label }}</span>
          <strong class="app-summary-card__value">{{ card.value }}</strong>
          <span class="app-summary-card__meta">{{ card.meta }}</span>
        </article>
      </div>

      <!-- Token导入区域 -->
      <a-modal
        class="token-import-modal"
        width="40rem"
        v-model:visible="showImportForm"
        :default-visible="!tokenStore.hasTokens"
        :footer="false"
      >
        <template #title>
          <h2>
            <NIcon>
              <Add></Add>
            </NIcon>
            {{ t("tokenImport.importModal.title") }}
          </h2>
        </template>
        <div class="card-header">
          <!-- 导入方式选择 -->
          <n-radio-group
            class="import-method-tabs"
            size="small"
            v-model:value="importMethod"
          >
            <n-radio-button value="manual">
              {{ t("tokenImport.importMethods.manual") }}
            </n-radio-button>
            <n-radio-button value="url">
              {{ t("tokenImport.importMethods.url") }}
            </n-radio-button>
            <n-radio-button value="wxQrcode">
              {{ t("tokenImport.importMethods.wxQrcode") }}
            </n-radio-button>
            <n-radio-button value="bin">
              {{ t("tokenImport.importMethods.bin") }}
            </n-radio-button>
            <n-radio-button value="singlebin">
              {{ t("tokenImport.importMethods.singlebin") }}
            </n-radio-button>
          </n-radio-group>
        </div>
        <div class="card-body">
          <ManualTokenForm
            v-if="importMethod === 'manual'"
            @cancel="() => (showImportForm = false)"
            @ok="handleImportSuccess"
          ></ManualTokenForm>
          <UrlTokenForm
            v-if="importMethod === 'url'"
            @cancel="() => (showImportForm = false)"
            @ok="handleImportSuccess"
          ></UrlTokenForm>
          <WxQrcodeForm
            v-if="importMethod === 'wxQrcode'"
            @cancel="() => (showImportForm = false)"
            @ok="handleImportSuccess"
          ></WxQrcodeForm>
          <BinTokenForm
            v-if="importMethod === 'bin'"
            @cancel="() => (showImportForm = false)"
            @ok="handleImportSuccess"
          ></BinTokenForm>
          <single-bin-token-form
            v-if="importMethod === 'singlebin'"
            @cancel="() => (showImportForm = false)"
            @ok="handleImportSuccess"
          ></single-bin-token-form>
        </div>
      </a-modal>

      <n-card class="bin-files-section" size="small">
        <template #header>
          <div class="bin-files-header">
            <div>
              <h2>
                {{
                  t("tokenImport.binFiles.title", { count: binFiles.length })
                }}
              </h2>
              <p>{{ t("tokenImport.binFiles.desc") }}</p>
              <n-tag
                v-if="sensitiveConfirmRemainingText"
                size="small"
                type="warning"
              >
                {{ sensitiveConfirmRemainingText }}
              </n-tag>
            </div>
            <NButton
              size="small"
              :loading="binFilesLoading"
              @click="loadBinFiles"
            >
              <template #icon>
                <NIcon>
                  <Refresh></Refresh>
                </NIcon>
              </template>
              {{ t("tokenImport.binFiles.refresh") }}
            </NButton>
          </div>
        </template>
        <n-data-table
          size="small"
          :columns="binFileColumns"
          :data="binFiles"
          :loading="binFilesLoading"
          :pagination="{ pageSize: 5 }"
        ></n-data-table>
      </n-card>

      <!-- Token列表 -->
      <div v-if="tokenStore.hasTokens" class="tokens-section">
        <div class="section-header">
          <n-space align="center">
            <h2>
              {{
                t("tokenImport.tokenList.title", {
                  count: tokenStore.gameTokens.length,
                })
              }}
            </h2>
            <n-radio-group size="small" v-model:value="viewMode">
              <n-radio-button value="list">{{
                t("tokenImport.viewModes.list")
              }}</n-radio-button>
              <n-radio-button value="card">{{
                t("tokenImport.viewModes.card")
              }}</n-radio-button>
            </n-radio-group>
            <n-divider vertical class="divider-h-24"></n-divider>
            <n-button-group size="small">
              <NButton
                :type="sortConfig.field === 'name' ? 'primary' : 'default'"
                @click="toggleSort('name')"
              >
                {{ t("tokenImport.sort.name") }} {{ getSortIcon("name") }}
              </NButton>
              <NButton
                :type="sortConfig.field === 'server' ? 'primary' : 'default'"
                @click="toggleSort('server')"
              >
                {{ t("tokenImport.sort.server") }} {{ getSortIcon("server") }}
              </NButton>
              <NButton
                :type="sortConfig.field === 'createdAt' ? 'primary' : 'default'"
                @click="toggleSort('createdAt')"
              >
                {{ t("tokenImport.sort.createdAt") }}
                {{ getSortIcon("createdAt") }}
              </NButton>
              <NButton
                :type="sortConfig.field === 'lastUsed' ? 'primary' : 'default'"
                @click="toggleSort('lastUsed')"
              >
                {{ t("tokenImport.sort.lastUsed") }}
                {{ getSortIcon("lastUsed") }}
              </NButton>
            </n-button-group>
          </n-space>
          <div class="header-actions">
            <NButton
              v-if="tokenStore.hasUsableWorkbenchToken"
              type="success"
              @click="goToDashboard"
            >
              <template #icon>
                <NIcon>
                  <List></List>
                </NIcon>
              </template>
              {{ t("tokenImport.actions.batchFeatures") }}
            </NButton>

            <NButton
              v-if="!showImportForm"
              type="primary"
              @click="showImportForm = true"
            >
              <template #icon>
                <NIcon>
                  <Add></Add>
                </NIcon>
              </template>
              {{ t("tokenImport.actions.addToken") }}
            </NButton>

            <n-dropdown :options="bulkOptions" @select="handleBulkAction">
              <NButton>
                <template #icon>
                  <NIcon>
                    <Menu></Menu>
                  </NIcon>
                </template>
                {{ t("tokenImport.actions.bulkActions") }}
              </NButton>
            </n-dropdown>
          </div>
        </div>

        <div v-if="viewMode === 'card'" class="tokens-grid">
          <a-card
            v-for="(token, index) in sortedTokens"
            :key="token.id"
            class="token-card"
            draggable="true"
            :class="{
              active: selectedTokenId === token.id,
            }"
            @click="selectToken(token)"
            @dragover="handleDragOver($event)"
            @dragstart="handleDragStart(index, $event)"
            @drop="handleDrop(index, $event)"
          >
            <template #title>
              <a-space align="center" class="token-name">
                <n-avatar
                  v-if="token.avatar"
                  round
                  fallback-src="/icons/xiaoyugan.png"
                  size="small"
                  :src="token.avatar"
                ></n-avatar>
                {{ token.name }}
                <a-tag v-if="token.server" :color="getServerTagColor(token.id)">
                  {{ token.server }}
                </a-tag>
                <!-- 连接状态指示器 -->
                <a-badge
                  :status="getTokenStyle(token.id)"
                  :text="getConnectionStatusText(token.id)"
                ></a-badge>
                <n-tag
                  v-if="hasMissingBinSource(token)"
                  size="small"
                  type="error"
                >
                  {{ t("tokenImport.tokenCard.missingSource") }}
                </n-tag>
                <!-- 连接状态文字 -->
                <!-- <a-tag color="green">
                  {{ getConnectionStatusText(token.id) }}
                </a-tag> -->
              </a-space>
            </template>
            <template #extra>
              <n-dropdown
                :options="getTokenActions(token)"
                @select="(key) => handleTokenMenuAction(key, token)"
              >
                <NButton text>
                  <template #icon>
                    <NIcon>
                      <EllipsisHorizontal></EllipsisHorizontal>
                    </NIcon>
                  </template>
                </NButton>
              </n-dropdown>
            </template>

            <template #default>
              <div class="token-display">
                <span class="token-label">{{
                  t("tokenImport.labels.token")
                }}</span>
                <code class="token-value">{{ maskToken(token.token) }}</code>
              </div>

              <!-- 备注信息 -->
              <div
                v-if="editingRemark === token.id"
                class="token-remark token-remark-edit"
                @click.stop
              >
                <span class="remark-label">{{
                  t("tokenImport.labels.remark")
                }}</span>
                <n-input
                  autofocus
                  type="textarea"
                  v-model:value="tempRemarks[token.id]"
                  :placeholder="t('tokenImport.placeholders.remarkLong')"
                  :rows="2"
                  @blur="saveRemark(token)"
                  @keyup.enter="saveRemark(token)"
                  @keyup.esc="cancelEditRemark()"
                ></n-input>
              </div>
              <div
                v-else
                class="token-remark"
                @click.stop="startEditRemark(token)"
              >
                <span class="remark-label">{{
                  t("tokenImport.labels.remark")
                }}</span>
                <span class="remark-value">{{
                  token.remark || t("tokenImport.placeholders.remarkClick")
                }}</span>
                <NIcon class="remark-edit-icon">
                  <Create></Create>
                </NIcon>
              </div>

              <a-button
                :loading="refreshingTokens.has(token.id)"
                @click.stop="refreshToken(token)"
              >
                <template #icon>
                  <NIcon>
                    <Refresh></Refresh>
                  </NIcon>
                </template>
                {{
                  token.sourceUrl
                    ? t("tokenImport.actions.refresh")
                    : t("tokenImport.actions.reacquire")
                }}
              </a-button>

              <div class="token-timestamps">
                <div class="timestamp-item">
                  <span class="timestamp-label">{{
                    t("tokenImport.labels.created")
                  }}</span>
                  <span class="timestamp-value">{{
                    formatTime(token.createdAt)
                  }}</span>
                </div>
                <div class="timestamp-item">
                  <span class="timestamp-label">{{
                    t("tokenImport.labels.used")
                  }}</span>
                  <span class="timestamp-value">{{
                    formatTime(token.lastUsed)
                  }}</span>
                </div>
              </div>

              <!-- 存储类型信息 -->
              <div class="storage-info">
                <div class="storage-item">
                  <span class="storage-label">{{
                    t("tokenImport.labels.storageType")
                  }}</span>
                  <n-tag
                    size="small"
                    :type="
                      token.importMethod === 'url' ||
                      token.importMethod === 'bin' ||
                      token.importMethod === 'wxQrcode' ||
                      token.upgradedToPermanent
                        ? 'success'
                        : 'warning'
                    "
                  >
                    {{ getLongStorageLabel(token) }}
                  </n-tag>
                </div>
                <div v-if="hasMissingBinSource(token)" class="storage-item">
                  <span class="storage-label">{{
                    t("tokenImport.labels.sourceFile")
                  }}</span>
                  <n-tag size="small" type="error">{{
                    t("tokenImport.tokenCard.missingBinSource")
                  }}</n-tag>
                </div>

                <!-- 升级选项（仅对临时存储的token显示） -->
                <div
                  v-if="
                    !(
                      token.importMethod === 'url' ||
                      token.importMethod === 'bin' ||
                      token.importMethod === 'wxQrcode' ||
                      token.upgradedToPermanent
                    )
                  "
                  class="storage-upgrade"
                >
                  <NButton
                    ghost
                    size="tiny"
                    type="success"
                    @click.stop="upgradeTokenToPermanent(token)"
                  >
                    <template #icon>
                      <NIcon>
                        <Star></Star>
                      </NIcon>
                    </template>
                    {{ t("tokenImport.actions.upgradePermanent") }}
                  </NButton>
                </div>
              </div>
            </template>
            <template #actions>
              <NButton
                block
                size="large"
                type="primary"
                :loading="connectingTokens.has(token.id)"
                @click="startTaskManagement(token)"
              >
                <template #icon>
                  <NIcon>
                    <Home></Home>
                  </NIcon>
                </template>
                {{ t("tokenImport.actions.enterConsole") }}
              </NButton>
            </template>
          </a-card>
        </div>

        <!-- List View -->
        <div v-else class="tokens-list">
          <n-card
            v-for="(token, index) in sortedTokens"
            :key="token.id"
            hoverable
            class="token-list-card"
            draggable="true"
            size="small"
            :class="{ active: selectedTokenId === token.id }"
            @click="selectToken(token)"
            @dragover="handleDragOver($event)"
            @dragstart="handleDragStart(index, $event)"
            @drop="handleDrop(index, $event)"
          >
            <n-space align="center" justify="space-between">
              <!-- Info -->
              <n-space align="center" :size="6">
                <!-- 连接状态 - 移动到最前端显示 -->
                <div class="min-w-65">
                  <a-badge
                    :status="getTokenStyle(token.id)"
                    :text="getConnectionStatusText(token.id)"
                  ></a-badge>
                </div>
                <!-- Avatar -->
                <n-avatar
                  v-if="token.avatar"
                  round
                  fallback-src="/icons/xiaoyugan.png"
                  size="small"
                  :src="token.avatar"
                ></n-avatar>

                <!-- Token基本信息 -->
                <div class="min-w-100">
                  <div class="token-basic-row">
                    <span class="token-name-text">{{ token.name }}</span>
                    <n-tag
                      v-if="hasMissingBinSource(token)"
                      size="small"
                      type="error"
                    >
                      {{ t("tokenImport.tokenCard.missingSource") }}
                    </n-tag>
                    <n-tag
                      v-if="token.server"
                      size="small"
                      :type="getServerTagType(token.id)"
                    >
                      {{ token.server }}
                    </n-tag>
                    <!-- 备注信息 - 显示在服务器信息后面 -->
                    <div
                      v-if="editingRemark === token.id"
                      class="token-remark-inline-edit"
                      @click.stop
                    >
                      <i class="i-mdi:note-outline note-icon-tight"></i>
                      <n-input
                        autofocus
                        class="remark-input-w-150"
                        size="small"
                        v-model:value="tempRemarks[token.id]"
                        :placeholder="t('tokenImport.placeholders.remarkShort')"
                        @blur="saveRemark(token)"
                        @keyup.enter="saveRemark(token)"
                        @keyup.esc="cancelEditRemark()"
                      ></n-input>
                    </div>
                    <div
                      v-else
                      class="token-remark-inline-view"
                      @click.stop="startEditRemark(token)"
                    >
                      <i class="i-mdi:note-outline note-icon-tight"></i>
                      {{
                        token.remark ||
                        t("tokenImport.placeholders.remarkClick")
                      }}
                      <NIcon class="remark-create-icon">
                        <Create></Create>
                      </NIcon>
                    </div>
                  </div>
                </div>
              </n-space>

              <!-- Actions -->
              <n-space>
                <!-- 存储类型 -->
                <n-tag
                  size="small"
                  :type="
                    token.importMethod === 'url' ||
                    token.importMethod === 'bin' ||
                    token.importMethod === 'wxQrcode' ||
                    token.upgradedToPermanent
                      ? 'success'
                      : 'warning'
                  "
                >
                  {{ getShortStorageLabel(token) }}
                </n-tag>

                <!-- 升级选项（仅对临时存储的token显示） -->
                <NButton
                  v-if="
                    !(
                      token.importMethod === 'url' ||
                      token.importMethod === 'bin' ||
                      token.importMethod === 'wxQrcode' ||
                      token.upgradedToPermanent
                    )
                  "
                  ghost
                  size="small"
                  type="success"
                  @click.stop="upgradeTokenToPermanent(token)"
                >
                  <template #icon>
                    <NIcon>
                      <Star></Star>
                    </NIcon>
                  </template>
                  {{ t("tokenImport.actions.upgrade") }}
                </NButton>

                <NButton
                  size="small"
                  type="primary"
                  :loading="connectingTokens.has(token.id)"
                  @click.stop="startTaskManagement(token)"
                >
                  <template #icon>
                    <NIcon>
                      <Home></Home>
                    </NIcon>
                  </template>
                  {{ t("tokenImport.actions.console") }}
                </NButton>
                <NButton
                  size="small"
                  :loading="refreshingTokens.has(token.id)"
                  @click.stop="refreshToken(token)"
                >
                  <template #icon>
                    <NIcon>
                      <Refresh></Refresh>
                    </NIcon>
                  </template>
                  {{ t("tokenImport.actions.refresh") }}
                </NButton>
                <n-dropdown
                  :options="getTokenActions(token)"
                  @select="(key) => handleTokenMenuAction(key, token)"
                >
                  <NButton circle size="small" @click.stop>
                    <template #icon>
                      <NIcon>
                        <EllipsisHorizontal></EllipsisHorizontal>
                      </NIcon>
                    </template>
                  </NButton>
                </n-dropdown>
              </n-space>
            </n-space>
          </n-card>
        </div>
      </div>

      <!-- 空状态 -->
      <a-empty v-if="!tokenStore.hasTokens && !showImportForm">
        <template #image>
          <i class="mdi:bed-empty"></i>
        </template>
        {{ t("tokenImport.empty.noTokens") }}
        <a-button type="link" @click="openshowImportForm">
          {{ t("tokenImport.empty.openManager") }}
        </a-button>
      </a-empty>
    </div>

    <!-- 编辑Token模态框 -->
    <n-modal
      class="modal-w-500"
      preset="card"
      v-model:show="showEditModal"
      :title="t('tokenImport.editModal.title')"
    >
      <n-form
        ref="editFormRef"
        label-placement="left"
        label-width="80px"
        :model="editForm"
        :rules="editRules"
      >
        <n-form-item
          path="name"
          :label="t('tokenImport.editModal.fields.name')"
        >
          <n-input v-model:value="editForm.name"></n-input>
        </n-form-item>
        <n-form-item
          path="token"
          :label="t('tokenImport.editModal.fields.token')"
        >
          <n-input
            clearable
            type="textarea"
            v-model:value="editForm.token"
            :placeholder="t('tokenImport.editModal.placeholders.token')"
            :rows="3"
          ></n-input>
        </n-form-item>
        <n-form-item :label="t('tokenImport.editModal.fields.server')">
          <n-input v-model:value="editForm.server"></n-input>
        </n-form-item>
        <n-collapse>
          <n-collapse-item
            name="advancedWs"
            :title="t('tokenImport.wsSecurity.advancedSettings')"
          >
            <n-form-item :label="t('tokenImport.editModal.fields.wsUrl')">
              <n-input v-model:value="editForm.wsUrl"></n-input>
            </n-form-item>
            <n-alert
              v-if="editFormWsRisk.shouldWarn"
              type="error"
              :show-icon="true"
            >
              {{ t("tokenImport.wsSecurity.riskWarning") }}
            </n-alert>
          </n-collapse-item>
        </n-collapse>
        <n-form-item :label="t('tokenImport.editModal.fields.remark')">
          <n-input
            type="textarea"
            v-model:value="editForm.remark"
            :placeholder="t('tokenImport.editModal.placeholders.remark')"
            :rows="2"
          ></n-input>
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="modal-actions">
          <NButton @click="showEditModal = false">
            {{ t("tokenImport.common.cancel") }}
          </NButton>
          <NButton type="primary" @click="saveEdit">
            {{ t("tokenImport.common.save") }}
          </NButton>
        </div>
      </template>
    </n-modal>

    <n-modal
      class="modal-w-500"
      preset="card"
      title="Token激活"
      v-model:show="showActivationModal"
      :mask-closable="false"
      @close="cancelActivationInput"
    >
      <n-form label-placement="left" label-width="96px">
        <n-form-item label="角色名称">
          <n-input
            readonly
            :value="activationTargetToken?.name || '-'"
          ></n-input>
        </n-form-item>
        <n-form-item label="RoleID">
          <n-input
            readonly
            placeholder="自动识别6-12位游戏内角色RoleID"
            :value="activationResolvedRoleId || '-'"
          ></n-input>
        </n-form-item>
        <n-form-item label="激活码">
          <n-input
            placeholder="请输入一次性激活码"
            v-model:value="activationForm.activationCode"
            :disabled="activationSubmitting"
          ></n-input>
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-actions">
          <NButton
            :disabled="activationSubmitting"
            @click="cancelActivationInput"
          >
            {{ t("tokenImport.common.cancel") }}
          </NButton>
          <NButton
            type="primary"
            :loading="activationSubmitting"
            @click="confirmActivationInput"
          >
            确认激活
          </NButton>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import ManualTokenForm from "./manual.vue";
import UrlTokenForm from "./url.vue";
import BinTokenForm from "./bin.vue";
import singleBinTokenForm from "./singlebin.vue";
import WxQrcodeForm from "./wxqrcode.vue";
import { useTokenImportBinFiles } from "@/composables/useTokenImportBinFiles";
import { useTokenImportListActions } from "@/composables/useTokenImportListActions";
import { useTokenImportTokenActions } from "@/composables/useTokenImportTokenActions";
import { analyzeWsUrlSafety } from "@/services/tokenImport/wsUrlSafety";
import api from "@/api";

import { selectedTokenId, useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/auth";
import {
  Add,
  Create,
  EllipsisHorizontal,
  Home,
  List,
  Menu,
  Refresh,
  Star,
} from "@vicons/ionicons5";
import { NButton, NIcon, useDialog, useMessage } from "naive-ui/es";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  consumeTokenImportLaunchPayload,
  consumeTokenImportRouteNotice,
  extractSensitiveTokenImportQuery,
  getSanitizedTokenImportQuery,
} from "@/services/tokenImport/tokenImportRouteHandoff";
import {
  getTokenViewMode,
  setTokenViewMode,
} from "@/services/tokenImport/tokenImportPreferences";
import {
  fetchTokenPayloadFromUrl,
  isTrustedTokenImportUrl,
} from "@/services/tokenImport/tokenRemoteSource";
import { maskToken } from "@/utils/securitySanitizer";
// 接收路由参数
const props = defineProps({
  name: String,
  server: String,
  auto: Boolean,
});

const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const { locale, t } = useI18n();
const tokenStore = useTokenStore();
const authStore = useAuthStore();

// 响应式数据
const showImportForm = ref(false);
const isImporting = ref(false);
const editFormRef = ref(null);
const importMethod = ref("manual");
const connectingTokens = ref(new Set());
// 从localStorage读取上次的视图模式，默认为列表视图
const viewMode = ref(getTokenViewMode());

const hasMissingBinSource = (token) =>
  (token.importMethod === "bin" || token.importMethod === "wxQrcode") &&
  token.binSourceState === "missing";

const isPersistentToken = (token) =>
  token.importMethod === "url" ||
  token.importMethod === "bin" ||
  token.importMethod === "wxQrcode" ||
  token.upgradedToPermanent;

const getLongStorageLabel = (token) =>
  isPersistentToken(token)
    ? t("tokenImport.storage.long")
    : t("tokenImport.storage.temporary");

const getShortStorageLabel = (token) =>
  isPersistentToken(token)
    ? t("tokenImport.storage.longShort")
    : t("tokenImport.storage.temporaryShort");

const persistentTokenCount = computed(
  () =>
    tokenStore.gameTokens.filter((token) => isPersistentToken(token)).length,
);

const tokenHeroDescription = computed(() => {
  const username =
    authStore.user?.username || t("tokenImport.header.notLoggedIn");
  if (!tokenStore.hasTokens) {
    return `${username} · ${t("tokenImport.header.accountIsolation")}。先导入一个角色，后续再统一做刷新、批量操作和连接管理。`;
  }

  return `${username} · ${t("tokenImport.header.accountIsolation")}`;
});

const tokenSummaryCards = computed(() => [
  {
    label: "当前选择",
    value: tokenStore.selectedToken?.name || "未选择",
    meta: tokenStore.selectedToken?.server || "先在列表里选择一个角色",
  },
  {
    label: "视图模式",
    value:
      viewMode.value === "card"
        ? t("tokenImport.viewModes.card")
        : t("tokenImport.viewModes.list"),
    meta: "移动端默认更适合卡片流式查看",
  },
  {
    label: "长效凭证",
    value: String(persistentTokenCount.value),
    meta: tokenStore.hasTokens
      ? `共 ${tokenStore.gameTokens.length} 个角色`
      : "导入后可长期复用",
  },
  {
    label: "安全确认",
    value: sensitiveConfirmRemainingText.value || "无需再次确认",
    meta: "BIN 文件恢复与远程导入保持原逻辑",
  },
]);

const showActivationModal = ref(false);
const activationSubmitting = ref(false);
const activationTargetToken = ref(null);
const activationResolvedRoleId = ref("");
const activationResolver = ref(null);
const activationForm = reactive({
  activationCode: "",
});
const GAME_ACCOUNT_ID_PATTERN = /^\d{6,12}$/;

const parseTokenPayload = (rawToken) => {
  const text = String(rawToken || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // ignore
  }
  try {
    const clean = text.replace(/^data:.*base64,/, "").trim();
    if (!clean) return null;
    const decoded = atob(clean);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const normalizeRoleId = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (GAME_ACCOUNT_ID_PATTERN.test(text)) {
    return text;
  }
  const matched = text.match(/\b(\d{6,12})\b/);
  return matched ? matched[1] : "";
};

const normalizeSessId = (value) =>
  String(value || "")
    .trim()
    .slice(0, 256);

const ACCOUNT_ID_PRIORITY = [
  "roleid",
  "role_id",
  "gameaccountid",
  "game_account_id",
];
const ACCOUNT_ID_KEYS = new Set(ACCOUNT_ID_PRIORITY);

const collectNineDigitIdsFromPayload = (payload) => {
  if (!payload || typeof payload !== "object") return [];
  const keyBuckets = new Map(ACCOUNT_ID_PRIORITY.map((key) => [key, []]));
  const push = (key, value) => {
    const next = normalizeRoleId(value);
    if (next) {
      keyBuckets.get(key)?.push(next);
    }
  };

  const queue = [{ value: payload, depth: 0 }];
  const seen = new WeakSet();
  while (queue.length > 0) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || depth > 4) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    Object.entries(value).forEach(([key, child]) => {
      if (typeof child !== "object" || child === null) {
        const normalizedKey = String(key || "")
          .trim()
          .toLowerCase();
        if (ACCOUNT_ID_KEYS.has(normalizedKey)) {
          push(normalizedKey, child);
        }
        return;
      }
      queue.push({ value: child, depth: depth + 1 });
    });
  }

  const result = [];
  ACCOUNT_ID_PRIORITY.forEach((key) => {
    const values = keyBuckets.get(key) || [];
    values.forEach((value) => {
      if (!result.includes(value)) {
        result.push(value);
      }
    });
  });
  return result;
};

const resolveTokenRoleId = (token) => {
  const roleIdFromToken = normalizeRoleId(token?.roleId);
  if (roleIdFromToken) {
    return roleIdFromToken;
  }

  const roleIdFromActivation = normalizeRoleId(
    token?.activationRoleId || token?.activationGameAccountId,
  );
  if (roleIdFromActivation) {
    return roleIdFromActivation;
  }

  const payload = parseTokenPayload(token?.token);
  const fromPayload = collectNineDigitIdsFromPayload(payload);
  if (fromPayload.length > 0) {
    return fromPayload[0];
  }

  return "";
};

const resolveTokenSessId = (token) => {
  const directSessId = normalizeSessId(
    token?.activationSessId || token?.sessId,
  );
  if (directSessId) {
    return directSessId;
  }

  const payload = parseTokenPayload(token?.token);
  return normalizeSessId(
    payload?.sessId ||
      payload?.sessid ||
      payload?.sess_id ||
      payload?.sessionId ||
      payload?.sessionid ||
      payload?.session_id ||
      payload?.sid ||
      "",
  );
};

const parseBoundSessId = (accountIdentity) => {
  const parts = String(accountIdentity || "").split("|");
  return normalizeSessId(parts[0] || "");
};

const resolveServerActivationBinding = async (tokenId) => {
  const res = await api.tokenActivation.listMine();
  const bindings = Array.isArray(res?.data) ? res.data : [];
  const matched = bindings.find(
    (item) =>
      String(item?.tokenId || "").trim() === String(tokenId || "").trim(),
  );
  if (!matched) {
    return null;
  }

  const roleId = normalizeRoleId(
    matched?.roleId || matched?.gameAccountId || "",
  );
  if (!roleId) {
    return null;
  }

  return {
    sessId: parseBoundSessId(matched?.accountIdentity),
    roleId,
    roleName: String(matched?.roleName || "").trim(),
    region: String(matched?.region || "").trim(),
    roleIndex: String(matched?.roleIndex ?? "").trim(),
    expiresAt: matched?.expiresAt || null,
    boundAt: matched?.boundAt || null,
    active: Boolean(matched?.active),
  };
};

const requestActivationInput = (token, options = {}) =>
  new Promise((resolve) => {
    activationTargetToken.value = token;
    activationResolvedRoleId.value = resolveTokenRoleId(token);
    activationForm.activationCode = "";
    activationResolver.value = resolve;
    showActivationModal.value = true;
    if (options.forceRenew) {
      message.info("请填写新的激活码完成续期");
    }
  });

const finishActivationInput = (payload) => {
  const resolver = activationResolver.value;
  activationResolver.value = null;
  showActivationModal.value = false;
  activationSubmitting.value = false;
  activationTargetToken.value = null;
  activationResolvedRoleId.value = "";
  if (typeof resolver === "function") {
    resolver(payload);
  }
};

const cancelActivationInput = () => {
  finishActivationInput(null);
};

const confirmActivationInput = () => {
  const roleId = String(activationResolvedRoleId.value || "").trim();
  const activationCode = String(activationForm.activationCode || "").trim();
  if (!roleId) {
    message.error("未识别到6-12位游戏内角色RoleID，无法激活");
    return;
  }
  if (!GAME_ACCOUNT_ID_PATTERN.test(roleId)) {
    message.error("角色RoleID必须为6-12位数字");
    return;
  }
  if (!activationCode) {
    message.error("未填写激活码，无法激活");
    return;
  }
  activationSubmitting.value = true;
  finishActivationInput({ roleId, activationCode });
};

const ensureTokenActivation = async (token, options = {}) => {
  let normalizedSessId = resolveTokenSessId(token);
  let normalizedRoleId = normalizeRoleId(
    token.activationRoleId ||
      token.activationGameAccountId ||
      token.roleId ||
      resolveTokenRoleId(token),
  );
  if (!normalizedRoleId && typeof tokenStore.parseBase64Token === "function") {
    const parsed = tokenStore.parseBase64Token(String(token?.token || ""));
    if (parsed?.success) {
      normalizedSessId = normalizeSessId(
        parsed?.data?.activationSessId ||
          parsed?.data?.sessId ||
          normalizedSessId,
      );
      normalizedRoleId = normalizeRoleId(
        parsed?.data?.activationRoleId ||
          parsed?.data?.activationGameAccountId ||
          parsed?.data?.roleId ||
          resolveTokenRoleId(parsed?.data),
      );
    }
    if (normalizedRoleId || normalizedSessId) {
      tokenStore.updateToken(token.id, {
        sessId: normalizedSessId || token.sessId || "",
        activationSessId:
          normalizedSessId || token.activationSessId || token.sessId || "",
        roleId: normalizedRoleId,
        activationRoleId: normalizedRoleId,
        activationGameAccountId: normalizedRoleId,
        activationRoleName: String(
          token?.activationRoleName || token?.name || "",
        ).trim(),
        activationRegion: String(
          token?.activationRegion || token?.server || "",
        ).trim(),
      });
    }
  }
  const normalizedRoleName =
    String(token?.activationRoleName || token?.name || "").trim() ||
    "未命名角色";
  const normalizedRegion =
    String(token?.activationRegion || token?.server || "").trim() || "未知大区";
  const normalizedRoleIndex = String(token?.roleIndex ?? "").trim();
  if (normalizedRoleId && !options.forceRenew) {
    try {
      const status = await api.tokenActivation.getStatus(
        token.id,
        normalizedRoleId,
        {
          sessId: normalizedSessId,
          roleName: normalizedRoleName,
          region: normalizedRegion,
          server: normalizedRegion,
          roleIndex: normalizedRoleIndex,
        },
      );
      if (status?.success && status?.data?.active) {
        tokenStore.updateToken(token.id, {
          sessId: normalizedSessId || token.sessId || "",
          activationSessId: normalizeSessId(
            status.data.sessId ||
              normalizedSessId ||
              token.activationSessId ||
              token.sessId,
          ),
          roleId: normalizedRoleId,
          activationRoleId: normalizedRoleId,
          activationGameAccountId: normalizedRoleId,
          activationRoleName: String(
            status.data.roleName || normalizedRoleName,
          ).trim(),
          activationRegion: String(
            status.data.region || normalizedRegion,
          ).trim(),
          activationExpiresAt:
            status.data.expiresAt || token.activationExpiresAt || null,
          activationBoundAt:
            status.data.boundAt || token.activationBoundAt || null,
        });
        return true;
      }
    } catch (error) {
      const messageText = String(error?.message || "").trim();
      if (!messageText.includes("未绑定当前账号标识")) {
        // 如果校验失败，继续走手动激活流程。
      } else {
        try {
          const binding = await resolveServerActivationBinding(token.id);
          if (binding) {
            const status = await api.tokenActivation.getStatus(
              token.id,
              binding.roleId,
              {
                sessId: binding.sessId,
                roleName: binding.roleName || normalizedRoleName,
                region: binding.region || normalizedRegion,
                server: binding.region || normalizedRegion,
                roleIndex: binding.roleIndex || normalizedRoleIndex,
              },
            );
            if (status?.success && status?.data?.active) {
              tokenStore.updateToken(token.id, {
                sessId: binding.sessId || token.sessId || "",
                activationSessId: normalizeSessId(
                  status.data.sessId ||
                    binding.sessId ||
                    token.activationSessId ||
                    token.sessId,
                ),
                roleId: binding.roleId,
                activationRoleId: binding.roleId,
                activationGameAccountId: binding.roleId,
                activationRoleName: String(
                  status.data.roleName ||
                    binding.roleName ||
                    normalizedRoleName,
                ).trim(),
                activationRegion: String(
                  status.data.region || binding.region || normalizedRegion,
                ).trim(),
                activationExpiresAt:
                  status.data.expiresAt ||
                  binding.expiresAt ||
                  token.activationExpiresAt ||
                  null,
                activationBoundAt:
                  status.data.boundAt ||
                  binding.boundAt ||
                  token.activationBoundAt ||
                  null,
              });
              return true;
            }
            if (binding.active) {
              tokenStore.updateToken(token.id, {
                sessId: binding.sessId || token.sessId || "",
                activationSessId:
                  binding.sessId ||
                  token.activationSessId ||
                  token.sessId ||
                  "",
                roleId: binding.roleId,
                activationRoleId: binding.roleId,
                activationGameAccountId: binding.roleId,
                activationRoleName: binding.roleName || normalizedRoleName,
                activationRegion: binding.region || normalizedRegion,
                activationExpiresAt:
                  binding.expiresAt || token.activationExpiresAt || null,
                activationBoundAt:
                  binding.boundAt || token.activationBoundAt || null,
              });
              return true;
            }
          }
        } catch {
          // 回退失败后继续走手动激活流程。
        }
      }
    }
  }

  const input = await requestActivationInput(token, options);
  if (!input) {
    message.info("已取消激活");
    return false;
  }

  try {
    const res = await api.tokenActivation.bind({
      tokenId: token.id,
      sessId: normalizedSessId,
      roleId: input.roleId,
      gameAccountId: input.roleId,
      roleName: normalizedRoleName,
      region: normalizedRegion,
      server: normalizedRegion,
      roleIndex: normalizedRoleIndex,
      activationCode: input.activationCode,
    });
    if (!res?.success) {
      message.error(res?.message || "激活失败");
      return false;
    }
    tokenStore.updateToken(token.id, {
      sessId: normalizedSessId || token.sessId || "",
      activationSessId:
        normalizedSessId || token.activationSessId || token.sessId || "",
      roleId: input.roleId,
      activationRoleId: input.roleId,
      activationGameAccountId: input.roleId,
      activationRoleName: normalizedRoleName,
      activationRegion: normalizedRegion,
      activationExpiresAt: res.data?.expiresAt || null,
      activationBoundAt: res.data?.boundAt || new Date().toISOString(),
    });
    message.success(
      `激活成功，${token.name} 可用至 ${new Date(res.data?.expiresAt).toLocaleString()}`,
    );
    return true;
  } catch (error) {
    message.error(error.message || "激活失败");
    return false;
  }
};

// 监听视图模式变化，保存到localStorage
watch(viewMode, (newViewMode) => {
  setTokenViewMode(newViewMode);
});

const handleImportSuccess = async () => {
  showImportForm.value = false;
  await loadBinFiles();
};

const handleLogout = async () => {
  await authStore.logout();
  message.success(t("tokenImport.messages.loggedOut"));
  if (typeof window !== "undefined") {
    window.location.replace("/");
    return;
  }
  await router.replace("/");
};

const goToAdminCenter = () => {
  if (!authStore.user?.isAdmin || !authStore.user?.mfaEnabled) {
    router.push({ path: "/admin/profile", query: { adminMfaRequired: "1" } });
    return;
  }
  router.push("/admin/admin-users");
};

/**
 * 手动打开Token管理卡片
 */
const openshowImportForm = () => {
  showImportForm.value = true;
};

const formatTime = (timestamp) => {
  const localeTag = locale.value === "zh-CN" ? "zh-CN" : "en-US";
  return new Date(timestamp).toLocaleString(localeTag);
};

const {
  binFileColumns,
  binFiles,
  binFilesLoading,
  loadBinFiles,
  loadRemoteBinDownloadPreference,
  sensitiveConfirmRemainingText,
  tryRelinkBinSourceByRoleId,
  tryRestoreTokensFromSavedBins,
} = useTokenImportBinFiles({
  authStore,
  dialog,
  formatTime,
  message,
  t,
  tokenStore,
});

const {
  cancelEditRemark,
  editForm,
  editRules,
  editingRemark,
  getConnectionStatusText,
  getServerTagColor,
  getServerTagType,
  getTokenActions,
  getTokenStyle,
  handleTokenAction,
  refreshToken,
  refreshingTokens,
  saveCurrentRemark,
  saveEdit,
  saveRemark,
  selectToken,
  showEditModal,
  startEditRemark,
  tempRemarks,
  upgradeTokenToPermanent,
} = useTokenImportTokenActions({
  dialog,
  editFormRef,
  ensureTokenActivation,
  loadBinFiles,
  message,
  selectedTokenId,
  t,
  tokenStore,
  tryRelinkBinSourceByRoleId,
});
const editFormWsRisk = computed(() => analyzeWsUrlSafety(editForm.wsUrl));

const {
  bulkOptions,
  getSortIcon,
  handleBulkAction,
  handleDragOver,
  handleDragStart,
  handleDrop,
  sortConfig,
  sortedTokens,
  toggleSort,
} = useTokenImportListActions({
  dialog,
  loadBinFiles,
  message,
  refreshToken,
  t,
  tokenStore,
});

const handleTokenMenuAction = (key, token) => {
  handleTokenAction(key, token, {
    openImportForm: () => {
      showImportForm.value = true;
      importMethod.value = "manual";
    },
  });
};

const goToDashboard = () => {
  router.push("/admin/task-control");
};

const LEGACY_SENSITIVE_IMPORT_QUERY_WARNING =
  "URL 中携带敏感导入参数已禁用，请改用页面内输入或安全会话跳转";

const replaceWithSanitizedTokenImportRoute = async () => {
  const sanitizedQuery = getSanitizedTokenImportQuery(
    router.currentRoute.value.query,
  );
  await router.replace({
    path: router.currentRoute.value.path || "/tokens",
    query: sanitizedQuery,
    hash: router.currentRoute.value.hash,
  });
};

const showLegacySensitiveImportQueryWarning = () => {
  message.warning(
    t("tokenImport.messages.importFailedWithReason", {
      error: LEGACY_SENSITIVE_IMPORT_QUERY_WARNING,
    }),
  );
};

const formatActivationExpiry = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "未获取到到期时间";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
};

const showActivationExpiryDialog = (token) => {
  const wsStatus = tokenStore.getWebSocketStatus(token.id);
  const refreshRoleInfo =
    wsStatus === "connected"
      ? tokenStore.sendGetRoleInfo(token.id).catch(() => {
          // 读取实时角色信息失败时回退到本地缓存名称。
        })
      : Promise.resolve();

  return refreshRoleInfo.then(
    () =>
      new Promise((resolve) => {
        const latestToken =
          tokenStore.gameTokens.find((item) => item.id === token.id) || token;
        const expiryText = formatActivationExpiry(
          latestToken?.activationExpiresAt,
        );
        dialog.info({
          title: "激活到期时间",
          content: `${latestToken?.name || token.name} 到期时间：${expiryText}`,
          positiveText: "进入控制台",
          negativeText: "取消",
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false),
        });
      }),
  );
};

// 开始任务管理 - 直接跳转到控制台
const startTaskManagement = async (token) => {
  const activated = await ensureTokenActivation(token);
  if (!activated) return;
  const confirmed = await showActivationExpiryDialog(token);
  if (!confirmed) return;
  tokenStore.selectToken(token.id);
  message.success(
    t("tokenImport.messages.enteringConsole", { name: token.name }),
  );
  router.push("/admin/dashboard");
};

// URL参数处理函数
const handleUrlParams = async () => {
  const routeNotice = consumeTokenImportRouteNotice();
  if (routeNotice === "legacySensitiveQueryDisabled") {
    showLegacySensitiveImportQueryWarning();
  }

  const sensitiveTokenImportQuery = extractSensitiveTokenImportQuery(
    router.currentRoute.value.query,
  );
  if (sensitiveTokenImportQuery.hasSensitiveParams) {
    showLegacySensitiveImportQueryWarning();
    await replaceWithSanitizedTokenImportRoute();
    return true;
  }

  const handoffPayload = consumeTokenImportLaunchPayload();
  const launchApi = String(handoffPayload?.api || "").trim();
  const launchWsUrl = String(handoffPayload?.wsUrl || "").trim();
  const launchName = String(handoffPayload?.name || props.name || "").trim();
  const launchServer = String(
    handoffPayload?.server || props.server || "",
  ).trim();
  const shouldAutoLaunch = handoffPayload?.auto === true || props.auto === true;

  // 仅允许通过受信任 API 地址导入，避免任意外部 URL 拉取
  if (launchApi) {
    try {
      isImporting.value = true;
      let tokenResult = null;

      if (!isTrustedTokenImportUrl(launchApi)) {
        throw new Error("仅允许同源或 localhost API 地址");
      }
      message.info(t("tokenImport.messages.importingFromApi"));

      const data = await fetchTokenPayloadFromUrl(launchApi, {
        trustedOnly: true,
        useProxy: true,
      });

      // 使用API获取的token
      tokenResult = tokenStore.importBase64Token(
        launchName ||
          data.name ||
          t("tokenImport.messages.importedFromApiDefaultName"),
        data.token,
        {
          server: launchServer || data.server,
          wsUrl: launchWsUrl || null,
          sourceUrl: launchApi,
          importMethod: "url",
        },
      );

      if (tokenResult && tokenResult.success) {
        message.success(
          t("tokenImport.messages.tokenImportSuccess", {
            name: tokenResult.tokenName,
          }),
        );

        // 如果auto=true，自动选择并跳转到控制台
        if (shouldAutoLaunch && tokenResult.token) {
          const activated = await ensureTokenActivation(tokenResult.token);
          if (activated) {
            const confirmed = await showActivationExpiryDialog(
              tokenResult.token,
            );
            if (confirmed) {
              tokenStore.selectToken(tokenResult.token.id);
              message.success(t("tokenImport.messages.redirectingToConsole"));
              setTimeout(() => {
                router.push("/admin/dashboard");
              }, 200);
            }
          }
        } else {
          // 清除URL参数，避免重复处理
          await replaceWithSanitizedTokenImportRoute();
        }
      } else {
        throw new Error(
          tokenResult?.message || t("tokenImport.messages.tokenImportFailed"),
        );
      }
    } catch (error) {
      console.error("URL参数处理失败:", error);
      message.error(
        t("tokenImport.messages.importFailedWithReason", {
          error: error.message,
        }),
      );
      // 清除URL参数
      await replaceWithSanitizedTokenImportRoute();
    } finally {
      isImporting.value = false;
    }
    return true;
  }

  return false;
};

// 监听路由变化
watch(
  () => router.currentRoute.value.fullPath,
  async (nextPath, previousPath) => {
    if (nextPath === previousPath) {
      return;
    }
    if (router.currentRoute.value.path !== "/tokens") {
      return;
    }
    await handleUrlParams();
  },
  { immediate: false },
);

// 生命周期
onMounted(async () => {
  tokenStore.initTokenStore();
  await loadRemoteBinDownloadPreference();
  await loadBinFiles();
  await tryRestoreTokensFromSavedBins();

  // 处理URL参数
  const handledImportEntry = await handleUrlParams();

  // 如果没有token且没有URL参数，显示导入表单
  if (!tokenStore.hasTokens && !handledImportEntry) {
    showImportForm.value = true;
  }
});
</script>

<style scoped lang="scss">
.divider-h-24 {
  height: 24px;
}

.remark-edit-icon {
  margin-left: 4px;
  color: var(--text-tertiary);
}

.token-list-card {
  margin-bottom: 8px;
}

.min-w-65 {
  min-width: 65px;
}

.min-w-100 {
  min-width: 100px;
}

.token-basic-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}

.token-name-text {
  font-weight: bold;
  font-size: 0.95em;
}

.token-remark-inline-edit {
  font-size: 0.75em;
  display: flex;
  align-items: center;
  gap: 4px;
}

.note-icon-tight {
  margin-right: 1px;
}

.remark-input-w-150 {
  width: 150px;
}

.token-remark-inline-view {
  font-size: 0.75em;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.remark-create-icon {
  font-size: 0.8em;
  color: var(--text-tertiary);
}

.modal-w-500 {
  width: min(500px, calc(100vw - 24px));
}

.token-import-page {
  min-height: 100dvh;
  background: transparent;
  padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));
  animation: token-fade-in 0.4s ease;
}

[data-theme="dark"] .token-import-page {
  background: transparent;
}

.container {
  max-width: 1320px;
  margin: 0 auto;
  padding: 0 var(--spacing-md);
}

.token-import-page__actions {
  align-items: flex-start;
}

.page-header {
  text-align: center;
  margin-bottom: var(--spacing-2xl);
}

.header-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  color: white;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: var(--spacing-md);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.account-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.account-name {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

.account-desc {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.9);
}

.header-tools {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.brand-logo {
  width: 64px;
  height: 64px;
  border-radius: var(--border-radius-medium);
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
}

.header-content h1 {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  margin: 0;
  color: #ffffff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.header-content p {
  font-size: var(--font-size-lg);
  margin: 0;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

.import-section {
  margin-bottom: var(--spacing-2xl);
}

.import-card {
  background: var(--bg-primary);
  border-radius: var(--border-radius-xl);
  padding: var(--spacing-2xl);
  box-shadow: var(--shadow-large);
  max-width: 600px;
  margin: 0 auto;
}

.card-header {
  text-align: center;
  margin-bottom: var(--spacing-xl);

  h2 {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    color: var(--text-primary);
    font-size: var(--font-size-xl);
    margin-bottom: var(--spacing-sm);
  }

  p {
    color: var(--text-secondary);
    margin: 0 0 var(--spacing-md) 0;
  }

  .subtitle {
    font-size: var(--font-size-md);
    color: var(--text-tertiary);
    margin: 0;
    font-weight: var(--font-weight-normal);
  }

  .import-method-tabs {
    margin-top: var(--spacing-md);
    display: flex;
    justify-content: center;
  }
}

.form-tips {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.form-tip {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.cors-tip {
  color: var(--warning-color);
  font-weight: var(--font-weight-medium);
}

.connection-actions {
  display: flex;
  gap: var(--spacing-xs);
  align-items: center;
}

/* 深色主题强制覆盖（与全局 data-theme 保持一致） */
[data-theme="dark"] .n-form-item-label,
[data-theme="dark"] .n-form-item-label__text {
  color: #ffffff !important;
}

[data-theme="dark"] .n-input__input,
[data-theme="dark"] .n-input__textarea {
  color: #ffffff !important;
  background-color: rgba(255, 255, 255, 0.1) !important;
}

[data-theme="dark"] .n-input__placeholder {
  color: rgba(255, 255, 255, 0.5) !important;
}

[data-theme="dark"] .n-card {
  background-color: rgba(255, 255, 255, 0.1) !important;
  color: #ffffff !important;
}

[data-theme="dark"] .import-card {
  background: rgba(45, 55, 72, 0.9) !important;
  color: #ffffff !important;
}

[data-theme="dark"] .import-card h2 {
  color: #ffffff !important;
}

[data-theme="dark"] .import-card .subtitle {
  color: rgba(255, 255, 255, 0.7) !important;
}

[data-theme="dark"] .n-collapse-item__header {
  color: #ffffff !important;
}

[data-theme="dark"] .n-collapse-item__content-wrapper {
  background-color: transparent !important;
}

[data-theme="dark"] .n-radio-button {
  color: #ffffff !important;
}

[data-theme="dark"] .n-radio-button--checked {
  background-color: rgba(16, 185, 129, 0.8) !important;
  color: #ffffff !important;
}

[data-theme="dark"] .form-tip {
  color: rgba(255, 255, 255, 0.6) !important;
}

.optional-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-top: var(--spacing-xl);
}

.bin-files-section {
  margin-bottom: var(--spacing-lg);
  border: 1px solid var(--surface-glass-border);
  box-shadow: var(--shadow-light);
  background: var(--surface-glass-strong);
  backdrop-filter: blur(12px);
}

.bin-files-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-lg);
  }

  p {
    margin: var(--spacing-xs) 0 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
}

.tokens-section {
  background: var(--surface-glass-strong);
  border-radius: var(--border-radius-xl);
  padding: var(--spacing-xl);
  box-shadow: var(--shadow-light);
  border: 1px solid var(--surface-glass-border);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

/* 深色主题下的列表区域背景 */
[data-theme="dark"] .tokens-section {
  background: rgba(45, 55, 72, 0.9);
  color: #ffffff;
}

/* 深色主题下的固定头部 */
[data-theme="dark"] .section-header {
  background: rgba(45, 55, 72, 0.9);
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-light);

  h2 {
    color: var(--text-primary);
    font-size: var(--font-size-xl);
    margin: 0;
  }
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
  max-width: 100%;
  flex-wrap: wrap;
}

.tokens-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--spacing-lg);
}

.token-card {
  border: 2px solid var(--border-light);
  border-radius: var(--border-radius-large);
  padding: var(--spacing-lg);
  cursor: pointer;
  transition: all var(--transition-normal);

  &:hover {
    box-shadow: var(--shadow-medium);
    transform: translateY(-2px);
  }

  &.active {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
  }

  &.connected {
    border-left: 4px solid var(--success-color);
  }
}

.tokens-list {
  overflow-y: auto;
  padding-right: var(--spacing-sm);
  scrollbar-width: thin;
  scrollbar-color: var(--border-medium) var(--bg-tertiary);
  flex: 1;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--border-medium);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--border-dark);
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-md);
}

.token-info {
  flex: 1;
}

.token-name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0 0 var(--spacing-xs) 0;
}

.token-meta {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.meta-item {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-small);
}

.card-body {
  margin-bottom: var(--spacing-md);
}

.token-display {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
}

.token-label {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.token-value {
  font-family: monospace;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  flex: 1;
}

.connection-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);

  &.connected {
    background: var(--success-color);
  }

  &.connecting {
    background: var(--warning-color);
  }

  &.error {
    background: var(--error-color);
  }
}

.status-text {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.token-remark {
  margin: var(--spacing-sm) 0;
  padding: var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-small);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-xs);

  &:hover {
    background: var(--bg-secondary);
  }
}

.token-remark-edit {
  cursor: default;
  background: var(--bg-primary);
  border: 1px solid var(--border-medium);

  &:hover {
    background: var(--bg-primary);
  }
}

.remark-label {
  font-weight: var(--font-weight-medium);
  margin-right: var(--spacing-xs);
  color: var(--text-primary);
  flex-shrink: 0;
}

.remark-value {
  font-style: italic;
  flex: 1;
}

.token-timestamps {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.timestamp-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.timestamp-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.timestamp-value {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.card-footer {
  border-top: 1px solid var(--border-light);
  padding-top: var(--spacing-md);
}

/* 连接状态指示器样式 */
.connection-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: var(--spacing-xs);
  position: relative;

  &.connected {
    background-color: #10b981;
    /* 绿色 - 已连接 */
    animation: pulse-green 2s infinite;
  }

  &.connecting {
    background-color: #f59e0b;
    /* 黄色 - 连接中 */
    animation: pulse-yellow 1s infinite;
  }

  &.disconnected {
    background-color: #6b7280;
    /* 灰色 - 已断开 */
  }

  &.error {
    background-color: #ef4444;
    /* 红色 - 连接错误 */
    animation: pulse-red 1s infinite;
  }
}

.connection-status {
  font-size: var(--font-size-xs);
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;

  &.connected {
    color: #10b981;
    background-color: rgba(16, 185, 129, 0.1);
  }

  &.connecting {
    color: #f59e0b;
    background-color: rgba(245, 158, 11, 0.1);
  }

  &.disconnected {
    color: #6b7280;
    background-color: rgba(107, 114, 128, 0.1);
  }

  &.error {
    color: #ef4444;
    background-color: rgba(239, 68, 68, 0.1);
  }
}

@keyframes pulse-green {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

@keyframes pulse-yellow {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}

@keyframes pulse-red {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  background: var(--bg-primary);
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-medium);
}

.modal-actions {
  display: flex;
  gap: var(--spacing-md);
  justify-content: flex-end;
}

@keyframes token-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .token-import-page :deep(.n-button) {
    min-height: 40px;
  }

  .token-import-page :deep(.n-button.n-button--small-type) {
    min-height: 40px;
    padding-left: 12px;
    padding-right: 12px;
  }

  .token-import-page :deep(.n-button.n-button--medium-type) {
    min-height: 40px;
  }

  .header-top {
    flex-direction: column;
    align-items: flex-start;
  }

  .bin-files-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-tools {
    width: 100%;
    justify-content: space-between;
  }

  .container {
    padding: 0 var(--spacing-md);
  }

  .tokens-grid {
    grid-template-columns: 1fr;
  }

  .optional-fields {
    grid-template-columns: 1fr;
  }

  .section-header {
    flex-direction: column;
    gap: var(--spacing-md);
    align-items: stretch;
  }

  .token-timestamps {
    flex-direction: column;
  }

  .storage-info {
    flex-direction: column;
    gap: var(--spacing-sm);
  }
}

/* 存储信息样式 */
.storage-info {
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--border-light);
}

.storage-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.storage-label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
  min-width: 70px;
}

.storage-upgrade {
  margin-top: var(--spacing-xs);
}

:global([data-theme="dark"] .token-import-modal .arco-modal) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}

[data-theme="dark"] .token-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
</style>
