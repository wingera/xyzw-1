<template>
  <div class="fight-pvp-container">
    <!-- 主卡片容器 -->
    <div class="status-card main-card">
      <!-- 卡片头部 -->
      <div class="card-header">
        <img
          class="status-icon"
          src="/icons/Ob7pyorzmHiJcbab2c25af264d0758b527bc1b61cc3b.png"
          :alt="t('fightPvpCard.iconAlt')"
        >
        <div class="status-info">
          <h3>{{ t("fightPvpCard.title") }}</h3>
          <p>{{ t("fightPvpCard.subtitle") }}</p>
        </div>
      </div>

      <!-- 操作区域 -->
      <div class="action-section">
        <div class="input-group">
          <n-input
            class="target-input"
            size="medium"
            type="text"
            v-model:value="targetId"
            :placeholder="t('fightPvpCard.placeholders.targetId')"
          ></n-input>
          <n-button
            size="medium"
            type="primary"
            :disabled="loading1 || !targetId"
            @click="getTargetInfo"
          >
            <template #icon>
              <n-icon>
                <Refresh></Refresh>
              </n-icon>
            </template>
            {{ t("fightPvpCard.actions.queryTarget") }}
          </n-button>
        </div>

        <div class="fight-options">
          <div class="option-item">
            <span class="option-label">{{ t("fightPvpCard.labels.fightCount") }}</span>
            <n-select
              allow-create
              filterable
              tag
              class="fight-count-select"
              size="medium"
              v-model:value="fightNum"
              :options="options"
              :placeholder="t('fightPvpCard.placeholders.fightCount')"
              @update:value="handleFightNumChange"
            ></n-select>
          </div>

          <div class="option-actions">
            <n-button
              size="medium"
              type="success"
              :disabled="loading1 || !targetId || !memberData"
              @click="fightPVPRefresh"
            >
              <template #icon>
                <n-icon>
                  <Trophy></Trophy>
                </n-icon>
              </template>
              {{ t("fightPvpCard.actions.startFight") }}
            </n-button>

            <n-button
              size="medium"
              type="default"
              :disabled="loading1 || !memberData"
              @click="handleExport1"
            >
              <template #icon>
                <n-icon>
                  <Copy></Copy>
                </n-icon>
              </template>
              {{ t("fightPvpCard.actions.exportData") }}
            </n-button>

            <n-button
              size="medium"
              type="default"
              :disabled="loading1 || !lastTargetRawInfo"
              @click="exportCurrentTargetRawData"
            >
              <template #icon>
                <n-icon>
                  <DocumentText></DocumentText>
                </n-icon>
              </template>
              {{ t("fightPvpCard.actions.exportRaw") }}
            </n-button>
          </div>
        </div>
      </div>

      <!-- 目标列表（历史/好友） -->
      <div class="history-section">
        <div class="history-header">
          <div class="history-tabs">
            <n-button
              size="small"
              :type="activeTargetListTab === 'history' ? 'primary' : 'default'"
              @click="activeTargetListTab = 'history'"
            >
              {{ t("fightPvpCard.targetLists.history") }}
            </n-button>
            <n-button
              size="small"
              :type="activeTargetListTab === 'friends' ? 'primary' : 'default'"
              @click="activeTargetListTab = 'friends'"
            >
              {{ t("fightPvpCard.targetLists.friends") }}
            </n-button>
          </div>
          <div class="history-header-actions">
            <n-button
              size="small"
              type="info"
              :disabled="loading1"
              :loading="syncingTargetLists"
              @click="syncTargetListsFromGame"
            >
              {{ t("fightPvpCard.actions.syncFromGame") }}
            </n-button>
            <n-button
              text
              size="small"
              type="error"
              :disabled="currentTabRecords.length === 0"
              @click="clearCurrentTabRecords"
            >
              {{ t("fightPvpCard.actions.clearCurrent") }}
            </n-button>
          </div>
        </div>
        <div v-if="currentTabRecords.length > 0" class="history-list">
          <div
            v-for="item in currentTabRecords"
            :key="item.id"
            class="history-item"
          >
            <n-avatar
              round
              class="history-avatar"
              :size="38"
              :src="item.headImg"
            ></n-avatar>
            <div class="history-content">
              <div class="history-name-row">
                <span class="history-name">{{ item.name || t("fightPvpCard.common.unknownPlayer") }}</span>
                <span class="history-id">ID: {{ item.id }}</span>
              </div>
              <div class="history-meta">
                <span>{{ t("fightPvpCard.labels.serverName", { value: item.serverName || t('fightPvpCard.common.unknown') }) }}</span>
                <span>{{ t("fightPvpCard.labels.redCount", { value: item.red ?? 0 }) }}</span>
                <span>{{ t("fightPvpCard.labels.updatedAt") }}
                  {{ formatUpdatedAt(item.updatedAt) }}</span>
              </div>
            </div>
            <div class="history-actions">
              <n-button size="small" type="primary" @click="useHistoryTarget(item)">
                {{ t("fightPvpCard.actions.use") }}
              </n-button>
              <n-button
                quaternary
                size="small"
                type="error"
                @click="removeCurrentTabRecord(item.id)"
              >
                {{ t("fightPvpCard.actions.delete") }}
              </n-button>
            </div>
          </div>
        </div>
        <n-empty
          v-else
          size="small"
          :description="
            activeTargetListTab === 'history'
              ? t('fightPvpCard.empty.history')
              : t('fightPvpCard.empty.friends')
          "
        ></n-empty>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading1" class="loading-section">
        <n-spin size="large">
          <template #description>
            {{ loadingText }}
          </template>
        </n-spin>
      </div>

      <!-- 对手信息卡片 -->
      <div ref="exportDom" v-else-if="memberData" class="content-section">
        <!-- 对手信息和阵容左右布局 -->
        <div class="opponent-main-layout">
          <!-- 左侧对手信息 -->
          <div class="info-card opponent-card left-card">
            <div class="card-title">
              <h4>{{ t("fightPvpCard.sections.opponentInfo") }}</h4>
            </div>

            <!-- 表格形式显示对手信息 -->
            <div class="opponent-info-table">
              <table class="info-table">
                <tbody>
                  <tr>
                    <td class="avatar-cell" rowspan="8">
                      <n-avatar
                        round
                        class="opponent-avatar"
                        :size="60"
                        :src="memberData.headImg"
                      ></n-avatar>
                    </td>
                    <td class="label-cell">{{ t("fightPvpCard.info.name") }}</td>
                    <td class="value-cell">
                      {{ memberData.name }}
                      <n-tag
                        v-if="memberData.lineupType"
                        class="lineup-type-tag ml-8"
                        size="small"
                        :bordered="false"
                        :color="getLineupTagColor(memberData.lineupType)"
                      >
                        {{ memberData.lineupType }}
                      </n-tag>
                      <n-tag
                        v-if="memberData.legacy > 0"
                        class="legacy-tag ml-8"
                        size="small"
                        :style="{
                          '--legacy-bg': legacyColorMap[memberData.legacy]?.value,
                        }"
                      >
                        {{ legacyColorMap[memberData.legacy]?.name || t("fightPvpCard.common.unknown") }}
                      </n-tag>
                    </td>
                  </tr>
                  <tr>
                    <td class="label-cell">{{ t("fightPvpCard.info.server") }}</td>
                    <td class="value-cell">{{ memberData.serverName }}</td>
                  </tr>
                  <tr class="highlight-row">
                    <td class="label-cell">{{ t("fightPvpCard.info.power") }}</td>
                    <td class="value-cell power-value">
                      {{ memberData.power }}
                    </td>
                  </tr>
                  <tr>
                    <td class="label-cell">{{ t("fightPvpCard.info.weapon") }}</td>
                    <td class="value-cell">{{ memberData.lordWeaponId }}</td>
                  </tr>
                  <tr class="highlight-row">
                    <td class="label-cell">{{ t("fightPvpCard.info.lineup") }}</td>
                    <td class="value-cell lineup">
                      <span class="red-count">{{ t("fightPvpCard.labels.redCount", { value: memberData.red }) }}</span>
                      <span class="separator">/</span>
                      <span class="hole-count">{{ t("fightPvpCard.labels.holeCount", { value: memberData.hole }) }}</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="label-cell">{{ t("fightPvpCard.info.club") }}</td>
                    <td class="value-cell">{{ memberData.legionName }}</td>
                  </tr>
                  <tr>
                    <td class="label-cell">{{ t("fightPvpCard.info.clubPower") }}</td>
                    <td class="value-cell">{{ memberData.MaxPower }}</td>
                  </tr>
                  <tr>
                    <td class="label-cell">{{ t("fightPvpCard.info.currentRed") }}</td>
                    <td class="value-cell">{{ memberData.legionRed }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 右侧对手阵容 -->
          <div class="info-card heroes-card right-card">
            <div class="card-title">
              <h4>{{ t("fightPvpCard.sections.opponentLineup") }}</h4>
              <div class="card-title-right">
                <span class="hero-count">{{ t("fightPvpCard.labels.heroCount", { value: memberData.heroList.length }) }}</span>
                <span class="click-hint">{{ t("fightPvpCard.labels.clickAvatarHint") }}</span>
              </div>
            </div>

            <div class="heroes-grid compact">
              <div
                v-for="hero in memberData.heroList"
                :key="hero.heroId || hero.heroName"
                class="hero-card compact"
                @click="selectHeroInfo(hero)"
              >
                <div class="hero-avatar-container">
                  <div class="hero-circle">
                    <img
                      v-if="hero.heroAvate"
                      class="hero-avatar-img"
                      :alt="hero.heroName"
                      :src="hero.heroAvate"
                    >
                    <div v-else class="hero-placeholder">
                      {{ hero.heroName?.substring(0, 2) || "?" }}
                    </div>
                  </div>
                </div>

                <div class="hero-info compact">
                  <div class="hero-name-row">
                    <h5 class="hero-name">{{ hero.heroName || t("fightPvpCard.common.unknownHero") }}</h5>
                    <n-tag
                      class="holy-beast-tag"
                      size="small"
                      :type="hero.HolyBeast ? 'success' : 'warning'"
                    >
                      {{ hero.HolyBeast ? t("fightPvpCard.labels.holyBeastOpened") : t("fightPvpCard.labels.holyBeastClosed") }}
                    </n-tag>
                  </div>
                  <div class="hero-stats">
                    <span class="stat-item">{{ t("fightPvpCard.labels.powerValue", { value: hero.power || '0' }) }}</span>
                    <span class="stat-item">{{ t("fightPvpCard.labels.starValue", { value: hero.star || '0' }) }}</span>
                    <span class="stat-item">{{ t("fightPvpCard.labels.redCount", { value: hero.red || '0' }) }}</span>
                    <span
                      v-if="hero.HolyBeast"
                      class="stat-item"
                    >{{ t("fightPvpCard.labels.holyBeastLevel", { value: hero.HBlevel }) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 切磋结果卡片 -->
        <div v-if="fightResult" class="info-card result-card">
          <div class="card-title">
            <h4>{{ t("fightPvpCard.sections.fightResult") }}</h4>
            <div class="result-summary">
              <div class="summary-item match-count">
                <span class="summary-label">{{ t("fightPvpCard.summary.total") }}</span>
                <span class="summary-value">{{ fightNum }}</span>
              </div>
              <div class="summary-item win-count">
                <span class="summary-label">{{ t("fightPvpCard.summary.win") }}</span>
                <span class="summary-value">{{ fightResult.winCount }}</span>
              </div>
              <div class="summary-item loss-count">
                <span class="summary-label">{{ t("fightPvpCard.summary.loss") }}</span>
                <span class="summary-value">{{
                  fightNum - fightResult.winCount
                }}</span>
              </div>

              <div class="summary-item win-rate">
                <span class="summary-label">{{ t("fightPvpCard.summary.winRate") }}</span>
                <span class="summary-value">{{
                  ((fightResult.winCount / fightNum) * 100).toFixed(2)
                }}%</span>
              </div>
              <div class="summary-item die-rate">
                <span class="summary-label">{{ t("fightPvpCard.summary.ourDieRate") }}</span>
                <span class="summary-value">{{
                  (
                    (fightResult.ourTotalDieHeroCount / (fightNum * 5))
                    * 100
                  ).toFixed(2)
                }}%</span>
              </div>
              <div class="summary-item die-rate">
                <span class="summary-label">{{ t("fightPvpCard.summary.enemyDieRate") }}</span>
                <span class="summary-value">{{
                  (
                    (fightResult.enemyTotalDieHeroCount / (fightNum * 5))
                    * 100
                  ).toFixed(2)
                }}%</span>
              </div>
            </div>
          </div>

          <div class="result-list">
            <div
              v-for="(battle, index) in fightResult.resultCount"
              :key="index"
              class="battle-result-item"
              :class="[battle.isWin ? 'win' : 'loss']"
            >
              <div class="battle-header">
                <span class="battle-index">{{ t("fightPvpCard.labels.battleIndex", { value: index + 1 }) }}</span>
                <n-tag size="small" :type="battle.isWin ? 'success' : 'error'">
                  {{ battle.isWin ? t("fightPvpCard.summary.winResult") : t("fightPvpCard.summary.lossResult") }}
                </n-tag>
              </div>

              <div class="battle-details">
                <div class="battle-side left-side">
                  <n-avatar
                    round
                    class="side-avatar"
                    :size="32"
                    :src="battle.leftheadImg"
                  ></n-avatar>
                  <div class="side-info">
                    <span class="side-name">{{
                      battle.leftName || t("fightPvpCard.common.unknown")
                    }}</span>
                    <span class="side-power">{{ t("fightPvpCard.labels.powerValue", { value: battle.leftpower }) }}</span>
                    <span class="side-die">{{ t("fightPvpCard.labels.dieCount", { value: battle.leftDieHero }) }}</span>
                  </div>
                </div>

                <div class="battle-vs">VS</div>

                <div class="battle-side right-side">
                  <n-avatar
                    round
                    class="side-avatar"
                    :size="32"
                    :src="battle.rightheadImg"
                  ></n-avatar>
                  <div class="side-info">
                    <span class="side-name">{{
                      battle.rightName || t("fightPvpCard.common.unknown")
                    }}</span>
                    <span class="side-power">{{ t("fightPvpCard.labels.powerValue", { value: battle.rightpower }) }}</span>
                    <span class="side-die">{{ t("fightPvpCard.labels.dieCount", { value: battle.rightDieHero }) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <n-empty :description="t('fightPvpCard.empty.prompt')"></n-empty>
      </div>
    </div>

    <!-- 武将详情模态框 -->
    <n-modal
      class="hero-detail-modal modal-w-600"
      preset="card"
      size="large"
      v-model:show="showHeroModal"
      :bordered="false"
      :segmented="{ content: 'soft', footer: 'soft' }"
      :title="t('fightPvpCard.heroModal.title')"
    >
      <template #header-extra>
        <span class="hero-id">{{ t("fightPvpCard.heroModal.heroId", { value: heroModealTemp?.heroId }) }}</span>
      </template>

      <div v-if="heroModealTemp" class="hero-modal-content">
        <div class="hero-modal-header">
          <div class="hero-modal-avatar">
            <img
              v-if="heroModealTemp.heroAvate"
              :alt="heroModealTemp.heroName"
              :src="heroModealTemp.heroAvate"
            >
          </div>
          <div class="hero-modal-basic">
            <h3 class="hero-modal-name">{{ heroModealTemp.heroName }}</h3>
            <div class="hero-modal-stats">
              <span class="stat-item">{{ heroModealTemp.power }}</span>
              <span class="stat-item">{{ t("fightPvpCard.heroModal.level", { value: heroModealTemp.level }) }}</span>
              <span class="stat-item">{{ t("fightPvpCard.heroModal.star", { value: heroModealTemp.star }) }}</span>
              <n-tag :type="heroModealTemp.HolyBeast ? 'success' : 'warning'">
                {{ heroModealTemp.HolyBeast ? t("fightPvpCard.heroModal.activated") : t("fightPvpCard.heroModal.notActivated") }}
              </n-tag>
            </div>
          </div>
        </div>

        <div class="hero-modal-details">
          <n-descriptions bordered column="3" label-placement="left">
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.power')">
              {{ heroModealTemp.power }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.level')">
              {{ heroModealTemp.level }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.star')">
              {{ heroModealTemp.star }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.hole')">
              {{ heroModealTemp.hole }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.red')">
              {{ heroModealTemp.red }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.holyBeastStatus')">
              {{ heroModealTemp.HolyBeast ? t("fightPvpCard.heroModal.activated") : t("fightPvpCard.heroModal.notActivated") }}
            </n-descriptions-item>
            <n-descriptions-item
              v-if="heroModealTemp.HolyBeast"
              :label="t('fightPvpCard.heroModal.labels.holyBeastLevel')"
            >
              {{ heroModealTemp.HBlevel }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.fishInfo')">
              {{
                heroModealTemp?.PearlInfo?.FishInfo?.name != undefined
                  ? heroModealTemp.PearlInfo?.FishInfo?.name
                  : t("fightPvpCard.common.none")
              }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.pearlSkill')">
              {{
                heroModealTemp?.PearlInfo?.PearlSkill?.name != undefined
                  ? heroModealTemp.PearlInfo?.PearlSkill?.name
                  : t("fightPvpCard.common.none")
              }}
            </n-descriptions-item>
            <n-descriptions-item :label="t('fightPvpCard.heroModal.labels.pearlWash')">
              <div v-if="heroModealTemp?.PearlInfo?.slotMap?.length > 0">
                <div
                  v-for="item in heroModealTemp.PearlInfo.slotMap"
                  :key="item.id"
                  class="ModalEquipment"
                  :style="{ '--equip-color': item.value }"
                ></div>
              </div>
              <div v-else>{{ t("fightPvpCard.common.none") }}</div>
            </n-descriptions-item>
          </n-descriptions>
        </div>

        <div class="hero-modal-equipment">
          <h4 class="section-title">{{ t("fightPvpCard.heroModal.equipmentTitle") }}</h4>
          <div class="equipment-grid">
            <div class="equipment-item">
              <span class="equipment-label">{{ t("fightPvpCard.heroModal.equipment.weapon") }}</span>
              <div class="equipment-slots">
                <div
                  v-for="(item, idx) in getEquipmentQuenchSlots(
                    heroModealTemp.equipment,
                    0,
                  )"
                  :key="idx"
                  class="equipment-slot"
                  :class="{
                    'red-slot': isRedQuenchSlot(item, heroModealTemp.equipment),
                    'orange-slot': isOrangeQuenchSlot(item, heroModealTemp.equipment),
                  }"
                ></div>
              </div>
            </div>
            <div class="equipment-item">
              <span class="equipment-label">{{ t("fightPvpCard.heroModal.equipment.clothes") }}</span>
              <div class="equipment-slots">
                <div
                  v-for="(item, idx) in getEquipmentQuenchSlots(
                    heroModealTemp.equipment,
                    1,
                  )"
                  :key="idx"
                  class="equipment-slot"
                  :class="{
                    'red-slot': isRedQuenchSlot(item, heroModealTemp.equipment),
                    'orange-slot': isOrangeQuenchSlot(item, heroModealTemp.equipment),
                  }"
                ></div>
              </div>
            </div>
            <div class="equipment-item">
              <span class="equipment-label">{{ t("fightPvpCard.heroModal.equipment.helmet") }}</span>
              <div class="equipment-slots">
                <div
                  v-for="(item, idx) in getEquipmentQuenchSlots(
                    heroModealTemp.equipment,
                    2,
                  )"
                  :key="idx"
                  class="equipment-slot"
                  :class="{
                    'red-slot': isRedQuenchSlot(item, heroModealTemp.equipment),
                    'orange-slot': isOrangeQuenchSlot(item, heroModealTemp.equipment),
                  }"
                ></div>
              </div>
            </div>
            <div class="equipment-item">
              <span class="equipment-label">{{ t("fightPvpCard.heroModal.equipment.mount") }}</span>
              <div class="equipment-slots">
                <div
                  v-for="(item, idx) in getEquipmentQuenchSlots(
                    heroModealTemp.equipment,
                    3,
                  )"
                  :key="idx"
                  class="equipment-slot"
                  :class="{
                    'red-slot': isRedQuenchSlot(item, heroModealTemp.equipment),
                    'orange-slot': isOrangeQuenchSlot(item, heroModealTemp.equipment),
                  }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="modal-footer">
          <n-button
            type="default"
            @click="showHeroModal = false"
          >
            {{ t("fightPvpCard.actions.close") }}
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMessage } from "naive-ui/es";
import { useI18n } from "vue-i18n";
import { useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/auth";
import api from "@/api";
import {
  loadFightHistoryFromLocalStorage,
  loadFightTargetListsFromLocalStorage,
  loadFightTargetSyncDiagnosticFromLocalStorage,
  saveFightHistoryToLocalStorage,
  saveFightTargetListsToLocalStorage,
  saveFightTargetSyncDiagnosticToLocalStorage,
} from "@/services/preferences/fightPvpStorage";
import { useFightPvpActions } from "@/composables/useFightPvpActions";
import { useFightPvpTargetSync } from "@/composables/useFightPvpTargetSync";
import { triggerBlobDownload } from "@/utils/download";
import {
  Copy,
  DocumentText,
  Refresh,
  Trophy,
} from "@vicons/ionicons5";

import {
  gettoday,
} from "@/utils/goldWarrankUtils";
import {
  formatWeapon,
  getLineupType,
  HERO_DICT,
  HeroFillInfo,
  legacycolor,
  LINEUP_RULES,
} from "@/utils/HeroList";
import { captureWithHtml2canvas } from "@/utils/html2canvasLoader";
import { downloadCanvasAsImage } from "@/utils/imageExport";

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  inline: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:visible"]);

// 确保legacycolor在模板中可用
const legacyColorMap = legacycolor;

const message = useMessage();
const { locale, t } = useI18n();
const tokenStore = useTokenStore();
const authStore = useAuthStore();

const showModal = computed({
  get: () => props.visible,
  set: (val) => emit("update:visible", val),
});

const exportDom = ref(null);
const loading1 = ref(false);
const loadingText = ref("");
const topranklist = ref(null);
const expandedMembers = ref(new Set());
const roleIdinput = ref("");
const queryDate = ref("");
const targetId = ref("");
const teamArray = ref(null);
// 切磋对手信息
const memberData = ref(null);
// 批量数量
const fightNum = ref(1);
// 战斗结果
const fightResult = ref(null);
const FIGHT_HISTORY_STORAGE_KEY = "fight_pvp_history_v1";
const FIGHT_HISTORY_PREF_KEY = "fight_pvp_history_v1";
const FIGHT_TARGET_LISTS_STORAGE_KEY = "fight_pvp_target_lists_v1";
const FIGHT_TARGET_LISTS_PREF_KEY = "fight_pvp_target_lists_v1";
const FIGHT_TARGET_LIST_SYNC_DIAGNOSTIC_STORAGE_KEY
  = "fight_pvp_target_sync_diagnostic_v1";
const FIGHT_HISTORY_MAX_COUNT = 50;
const fightHistoryRecords = ref([]);
const lastTargetRawInfo = ref(null);
const targetLists = ref({
  friends: [],
  follows: [],
});
const targetListSyncDiagnostic = ref(null);
const activeTargetListTab = ref("history");
const syncingTargetLists = ref(false);
const isFightHistorySyncReady = ref(false);
const isTargetListsSyncReady = ref(false);
let fightHistorySyncTimer = null;
let targetListsSyncTimer = null;

const GAME_TARGET_LIST_BASE_CMD_CANDIDATES = [
  { cmd: "role_getroleinfo", params: {} },
  { cmd: "friend_batch", params: { friendId: 0 } },
  { cmd: "friend_batch", params: { type: 0 } },
  { cmd: "friend_batch", params: { type: 1 } },
  { cmd: "friend_batch", params: { listType: 0 } },
  { cmd: "friend_batch", params: { listType: 1 } },
  { cmd: "friend_batch", params: { tab: 0 } },
  { cmd: "friend_batch", params: { tab: 1 } },
];

const GAME_TARGET_LIST_FOLLOW_BATCH_CMD_CANDIDATES = [
  { cmd: "friend_batch", params: { type: 2 } },
  { cmd: "friend_batch", params: { type: 3 } },
  { cmd: "friend_batch", params: { listType: 2 } },
  { cmd: "friend_batch", params: { listType: 3 } },
  { cmd: "friend_batch", params: { tab: 2 } },
  { cmd: "friend_batch", params: { tab: 3 } },
];

const GAME_TARGET_LIST_FOLLOW_PROBE_CMD_CANDIDATES = [
  { cmd: "friend_getfollowlist", params: {} },
  { cmd: "friend_getattentionlist", params: {} },
  { cmd: "friend_getfollowerlist", params: {} },
];

// 监听targetId变化，清除之前的切磋结果
watch(targetId, (newId, oldId) => {
  if (newId !== oldId) {
    fightResult.value = null;
  }
});
// 模态框控制符
const showHeroModal = ref(false);
// 选中的武将信息
const heroModealTemp = ref(null);
const options = [
  {
    label: "1",
    value: 1,
  },
  {
    label: "10",
    value: 10,
  },
  {
    label: "25",
    value: 25,
  },
  {
    label: "50",
    value: 50,
  },
];
loadingText.value = t("fightPvpCard.messages.loadingTarget");
const player_date = { name: "", power: "" };

const getLineupTagColor = (lineupType) => {
  const rule = LINEUP_RULES.find((item) => item.name === lineupType);
  return rule?.colorProps || { color: "#595959", textColor: "#fff" };
};

const normalizeFightHistoryRecord = (record) => {
  const normalizedId = String(record?.id || "").trim();
  if (!normalizedId)
    return null;

  return {
    id: normalizedId,
    name: record?.name || t("fightPvpCard.common.unknownPlayer"),
    red: Number(record?.red) || 0,
    headImg: record?.headImg || "",
    serverName: record?.serverName || t("fightPvpCard.common.unknown"),
    updatedAt: Number(record?.updatedAt) || Date.now(),
  };
};

const mergeFightRecord = (existing, incoming) => {
  if (!existing)
    return incoming;
  if (!incoming)
    return existing;

  const incomingName = String(incoming.name || "").trim();
  const existingName = String(existing.name || "").trim();
  const incomingServerName = String(incoming.serverName || "").trim();
  const existingServerName = String(existing.serverName || "").trim();

  return {
    ...existing,
    ...incoming,
    // 避免“未知值”覆盖已有信息
    name:
      incomingName && incomingName !== t("fightPvpCard.common.unknownPlayer")
        ? incomingName
        : existingName || t("fightPvpCard.common.unknownPlayer"),
    serverName:
      incomingServerName && incomingServerName !== t("fightPvpCard.common.unknown")
        ? incomingServerName
        : existingServerName || t("fightPvpCard.common.unknown"),
    headImg: incoming.headImg || existing.headImg || "",
    // 关键：同步数据里 red 常为空，避免用 0 覆盖已有有效红数
    red: Math.max(Number(existing.red) || 0, Number(incoming.red) || 0),
    updatedAt: Math.max(
      Number(existing.updatedAt) || 0,
      Number(incoming.updatedAt) || 0,
    ),
  };
};

const sanitizeFightHistoryRecords = (records) => {
  if (!Array.isArray(records))
    return [];

  const dedup = new Map();
  for (const item of records) {
    const normalized = normalizeFightHistoryRecord(item);
    if (!normalized)
      continue;
    const existing = dedup.get(normalized.id);
    dedup.set(normalized.id, mergeFightRecord(existing, normalized));
  }

  return [...dedup.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, FIGHT_HISTORY_MAX_COUNT);
};

const mergeFightHistoryRecords = (sourceA, sourceB) =>
  sanitizeFightHistoryRecords([...(sourceA || []), ...(sourceB || [])]);

const sanitizeTargetLists = (data) => ({
  friends: sanitizeFightHistoryRecords(data?.friends || []),
  follows: sanitizeFightHistoryRecords(data?.follows || []),
});

const mergeTargetLists = (sourceA, sourceB) => ({
  friends: sanitizeFightHistoryRecords([
    ...(sourceA?.friends || []),
    ...(sourceB?.friends || []),
  ]),
  follows: sanitizeFightHistoryRecords([
    ...(sourceA?.follows || []),
    ...(sourceB?.follows || []),
  ]),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRoleIdFromObject = (obj) =>
  obj?.roleId
  ?? obj?.id
  ?? obj?.uid
  ?? obj?.targetId
  ?? obj?.friendId
  ?? obj?.playerId
  ?? null;

const getRoleNameFromObject = (obj) =>
  obj?.name ?? obj?.roleName ?? obj?.nickName ?? obj?.nickname ?? "";

const getServerFromObject = (obj) =>
  obj?.serverName
  ?? obj?.server
  ?? (obj?.serverId ? `${obj.serverId}` : t("fightPvpCard.common.unknown"));

const getHeadImgFromObject = (obj) =>
  obj?.headImg ?? obj?.avatar ?? obj?.head ?? "";

const getRedFromObject = (obj) =>
  Number(obj?.red ?? obj?.redQuench ?? obj?.redCount ?? 0) || 0;

const formatUpdatedAt = (updatedAt) => {
  const date = new Date(Number(updatedAt) || Date.now());
  const localeValue = typeof locale?.value === "string" ? locale.value : undefined;
  try {
    return date.toLocaleString(localeValue);
  } catch {
    return date.toLocaleString();
  }
};

const getQuenchColorLevel = (quench) => {
  const normalizeColorText = (value) => {
    const t = String(value).trim().toLowerCase();
    if (t === "red" || t === "红色" || t === "红")
      return 6;
    if (t === "orange" || t === "橙色" || t === "橙")
      return 5;
    if (t === "purple" || t === "紫色" || t === "紫")
      return 4;
    if (t === "blue" || t === "蓝色" || t === "蓝")
      return 3;
    if (t === "green" || t === "绿色" || t === "绿")
      return 2;
    if (t === "white" || t === "白色" || t === "白")
      return 1;
    return 0;
  };

  const toNumericLevel = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0)
      return n;
    return normalizeColorText(value);
  };

  const extractColorLevelDeep = (node, depth = 0) => {
    if (node == null || depth > 2)
      return 0;

    if (typeof node === "number" || typeof node === "string") {
      return toNumericLevel(node);
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const level = extractColorLevelDeep(item, depth + 1);
        if (level > 0)
          return level;
      }
      return 0;
    }

    if (typeof node !== "object")
      return 0;

    const direct = toNumericLevel(
      node?.colorId
      ?? node?.color
      ?? node?.attrColorId
      ?? node?.slotColorId
      ?? node?.quality
      ?? node?.quenchColorId
      ?? node?.attr?.colorId
      ?? node?.attr?.color
      ?? 0,
    );
    if (direct > 0)
      return direct;

    for (const [key, value] of Object.entries(node)) {
      const lowerKey = String(key).toLowerCase();
      if (
        lowerKey.includes("color")
        || lowerKey.includes("quality")
        || lowerKey.includes("grade")
        || lowerKey.includes("rank")
      ) {
        const level = extractColorLevelDeep(value, depth + 1);
        if (level > 0)
          return level;
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        const level = extractColorLevelDeep(value, depth + 1);
        if (level > 0)
          return level;
      }
    }

    return 0;
  };

  if (typeof quench === "number" || typeof quench === "string") {
    return toNumericLevel(quench);
  }

  return extractColorLevelDeep(quench);
};

const toNonEmptyMap = (value) =>
  value && typeof value === "object" && Object.keys(value).length ? value : null;

const parseQuenchCollection = (value) => {
  if (!value)
    return [];

  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined && item !== null);
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text || (text[0] !== "{" && text[0] !== "["))
      return [];
    try {
      return parseQuenchCollection(JSON.parse(text));
    } catch (error) {
      return [];
    }
  }

  if (typeof value === "object") {
    return Object.values(value).filter((item) => item !== undefined && item !== null);
  }

  return [];
};

const detectQuenchPalette = (levels) => {
  const normalized = (levels || [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  const hasLevel5 = normalized.includes(5);
  const hasLevel7OrAbove = normalized.some((item) => item >= 7);

  // 兼容另一套色阶：6=橙，7=红
  if (!hasLevel5 && hasLevel7OrAbove) {
    return { orangeLevel: 6, redThreshold: 7 };
  }

  // 默认色阶：5=橙，6=红
  return { orangeLevel: 5, redThreshold: 6 };
};

const getEquipmentPalette = (equipment) => {
  const levels = [];
  for (const equ of Object.values(equipment || {})) {
    const quenchMap = getEffectiveQuenchMap(equ);
    if (!quenchMap)
      continue;
    for (const slot of parseQuenchCollection(quenchMap)) {
      const level = getQuenchColorLevel(slot);
      if (level > 0)
        levels.push(level);
    }
  }
  return detectQuenchPalette(levels);
};

const getQuenchCollectionScore = (slots) => {
  if (!Array.isArray(slots) || slots.length === 0)
    return 0;
  const colorScore = slots.filter((slot) => getQuenchColorLevel(slot) > 0).length;
  return colorScore * 10 + slots.length;
};

const getEffectiveQuenchMap = (equip) => {
  if (!equip || typeof equip !== "object")
    return null;

  const primary = toNonEmptyMap(equip.quenches);
  const secondary = toNonEmptyMap(equip.quenches2);
  const curQuenchId = Number(equip.curQuenchId || 0);

  if (curQuenchId === 2 && secondary)
    return secondary;
  if ((curQuenchId === 1 || curQuenchId === 0) && primary)
    return primary;
  if (primary && !secondary)
    return primary;
  if (secondary && !primary)
    return secondary;
  if (!primary && !secondary)
    return null;

  const primarySlots = parseQuenchCollection(primary);
  const secondarySlots = parseQuenchCollection(secondary);
  return getQuenchCollectionScore(primarySlots)
    >= getQuenchCollectionScore(secondarySlots)
    ? primary
    : secondary;
};

const getEquipmentQuenchSlots = (heroEquipment, index) => {
  const equip = Object.values(heroEquipment || {})[index];
  return parseQuenchCollection(getEffectiveQuenchMap(equip));
};

const isRedQuenchSlot = (slot, heroEquipment) => {
  const level = getQuenchColorLevel(slot);
  const palette = getEquipmentPalette(heroEquipment || {});
  return level >= palette.redThreshold;
};

const isOrangeQuenchSlot = (slot, heroEquipment) => {
  const level = getQuenchColorLevel(slot);
  const palette = getEquipmentPalette(heroEquipment || {});
  return level === palette.orangeLevel;
};

const countPearlOrangeSlots = (slotMap) => {
  if (!Array.isArray(slotMap))
    return 0;
  return slotMap.reduce(
    (count, slot) => count + (Number(slot?.colorId || 0) === 5 ? 1 : 0),
    0,
  );
};

const calculateRedCountFromHeroes = (heroes) => {
  if (!heroes || typeof heroes !== "object")
    return 0;

  let redCount = 0;
  for (const hero of Object.values(heroes)) {
    if (!hero?.equipment || typeof hero.equipment !== "object")
      continue;
    const palette = getEquipmentPalette(hero.equipment);
    for (const equipment of Object.values(hero.equipment)) {
      const quenchMap = getEffectiveQuenchMap(equipment);
      if (!quenchMap)
        continue;
      for (const quench of parseQuenchCollection(quenchMap)) {
        if (getQuenchColorLevel(quench) >= palette.redThreshold)
          redCount += 1;
      }
    }
  }
  return redCount;
};

const toFightRecord = (obj) => {
  if (!obj || typeof obj !== "object")
    return null;

  const hasStrongRoleId
    = obj?.roleId !== undefined
      || obj?.uid !== undefined
      || obj?.targetId !== undefined
      || obj?.friendId !== undefined
      || obj?.playerId !== undefined;
  const hasProfileLikeFields
    = !!(
      obj?.name
      || obj?.roleName
      || obj?.nickName
      || obj?.nickname
      || obj?.headImg
      || obj?.avatar
      || obj?.serverId
      || obj?.serverName
    );
  // 避免把 avatarFrame/customCard 这类仅含 id 的子对象误识别为角色
  if (!hasStrongRoleId && !hasProfileLikeFields)
    return null;

  const rawId = getRoleIdFromObject(obj);
  const id = rawId === null || rawId === undefined ? "" : String(rawId).trim();
  if (!id)
    return null;

  return {
    id,
    name: getRoleNameFromObject(obj) || t("fightPvpCard.common.unknownPlayer"),
    serverName: getServerFromObject(obj),
    headImg: getHeadImgFromObject(obj),
    red: getRedFromObject(obj),
    updatedAt: Date.now(),
  };
};

const extractRecordsByHints = (payload, hints = [], options = {}) => {
  const { requireHint = false } = options;
  const candidates = [];
  const visit = (node, path = "") => {
    const lowerPath = path.toLowerCase();
    const hasHint
      = hints.length === 0 || hints.some((hint) => lowerPath.includes(hint));

    if (Array.isArray(node)) {
      const records = sanitizeFightHistoryRecords(node.map((item) => toFightRecord(item)));
      if (records.length > 0 && (!requireHint || hasHint)) {
        let score = records.length;
        for (const hint of hints) {
          if (lowerPath.includes(hint))
            score += 100;
        }
        candidates.push({ records, score });
      }
      for (let i = 0; i < node.length; i += 1) {
        visit(node[i], `${path}[${i}]`);
      }
      return;
    }

    if (node && typeof node === "object") {
      const objectValues = Object.values(node);
      if (objectValues.length > 0) {
        const records = sanitizeFightHistoryRecords(
          objectValues
            .filter(
              (item) =>
                item
                && typeof item === "object"
                && !Array.isArray(item)
                && toFightRecord(item),
            )
            .map((item) => toFightRecord(item)),
        );
        if (records.length > 0 && (!requireHint || hasHint)) {
          let score = records.length;
          for (const hint of hints) {
            if (lowerPath.includes(hint))
              score += 100;
          }
          candidates.push({ records, score });
        }
      }

      Object.entries(node).forEach(([key, val]) => {
        const nextPath = path ? `${path}.${key}` : key;
        visit(val, nextPath);
      });
    }
  };

  visit(payload, "");
  if (!candidates.length)
    return [];
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].records;
};

const hasFollowMarker = (obj) => {
  if (!obj || typeof obj !== "object")
    return false;
  const entries = Object.entries(obj);
  const markerKeys = [
    "follow",
    "attention",
    "focus",
    "subscribe",
    "follower",
    "fans",
    "care",
    "concern",
  ];

  for (const [key, value] of entries) {
    const lowerKey = String(key).toLowerCase();
    if (!markerKeys.some((marker) => lowerKey.includes(marker)))
      continue;

    if (typeof value === "boolean" && value)
      return true;
    if (typeof value === "number" && value > 0)
      return true;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (
        normalized === "1"
        || normalized === "true"
        || normalized === "yes"
        || normalized === "follow"
      ) {
        return true;
      }
    }
  }

  return false;
};

const extractGameTargetLists = (payload) => {
  const friends = extractRecordsByHints(
    payload,
    ["friend", "friends", "buddy"],
    { requireHint: true },
  );
  const follows = extractRecordsByHints(payload, [
    "follow",
    "attention",
    "focus",
    "subscribe",
    "follower",
    "fans",
    "care",
    "concern",
  ], {
    requireHint: true,
  });

  if (follows.length === 0 && payload?.friendList && typeof payload.friendList === "object") {
    const followFromFriendList = sanitizeFightHistoryRecords(
      Object.values(payload.friendList)
        .filter((item) => hasFollowMarker(item))
        .map((item) => toFightRecord(item)),
    );
    if (followFromFriendList.length > 0) {
      return { friends, follows: followFromFriendList };
    }
  }

  return { friends, follows };
};

const buildDiagnosticSnapshot = (
  value,
  depth = 0,
  seen = new WeakSet(),
  maxDepth = 2,
  maxKeys = 16,
) => {
  if (value == null)
    return value;

  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 120)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value === "bigint")
    return value.toString();
  if (typeof value === "function")
    return "[Function]";
  if (depth >= maxDepth)
    return "[MaxDepth]";

  if (Array.isArray(value)) {
    const sliced = value.slice(0, 6);
    return sliced.map((item) =>
      buildDiagnosticSnapshot(item, depth + 1, seen, maxDepth, maxKeys),
    );
  }

  if (typeof value === "object") {
    if (seen.has(value))
      return "[Circular]";
    seen.add(value);

    const keys = Object.keys(value);
    const out = {};
    keys.slice(0, maxKeys).forEach((key) => {
      out[key] = buildDiagnosticSnapshot(
        value[key],
        depth + 1,
        seen,
        maxDepth,
        maxKeys,
      );
    });
    if (keys.length > maxKeys) {
      out.__trimmedKeys = keys.length - maxKeys;
    }
    return out;
  }

  return String(value);
};

const buildTargetListSyncAttemptDiagnostic = (payload) => {
  const isObjectPayload = payload && typeof payload === "object";
  const topKeys = isObjectPayload ? Object.keys(payload).slice(0, 30) : [];
  return {
    topKeys,
    snapshot: buildDiagnosticSnapshot(payload),
    roleLikeCollections: collectRoleLikeCollections(payload),
  };
};

const collectRoleLikeCollections = (payload) => {
  const collections = [];
  const visit = (node, path = "") => {
    if (!node)
      return;

    if (Array.isArray(node)) {
      const records = sanitizeFightHistoryRecords(node.map((item) => toFightRecord(item)));
      if (records.length > 0) {
        const sampleRaw = node.find((item) => toFightRecord(item));
        collections.push({
          path: path || "<root-array>",
          kind: "array",
          count: records.length,
          sampleRecord: records[0],
          sampleRaw: buildDiagnosticSnapshot(sampleRaw, 0, new WeakSet(), 4),
        });
      }
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (typeof node === "object") {
      const entries = Object.entries(node);
      const objectValues = entries.map(([, val]) => val);
      const recordEntries = entries.filter(([, val]) => toFightRecord(val));
      if (recordEntries.length > 0) {
        const [sampleKey, sampleValue] = recordEntries[0];
        const records = sanitizeFightHistoryRecords(
          objectValues
            .filter((item) => toFightRecord(item))
            .map((item) => toFightRecord(item)),
        );
        collections.push({
          path: path || "<root-map>",
          kind: "map",
          count: records.length,
          sampleKey,
          sampleRecord: records[0],
          sampleRaw: buildDiagnosticSnapshot(
            sampleValue,
            0,
            new WeakSet(),
            5,
            80,
          ),
          sampleEntries:
            path.toLowerCase().includes("friendlist") && recordEntries.length > 1
              ? recordEntries.slice(0, 3).map(([key, value]) => ({
                  key,
                  raw: buildDiagnosticSnapshot(value, 0, new WeakSet(), 3, 40),
                }))
              : undefined,
        });
      }
      entries.forEach(([key, val]) => {
        const nextPath = path ? `${path}.${key}` : key;
        visit(val, nextPath);
      });
    }
  };

  visit(payload, "");
  return collections.slice(0, 10);
};

const saveTargetListSyncDiagnosticToLocal = () => {
  try {
    saveFightTargetSyncDiagnosticToLocalStorage(targetListSyncDiagnostic.value);
  } catch (error) {
    console.warn("保存目标列表同步诊断失败:", error);
  }
};

const loadTargetListSyncDiagnosticFromLocal = () => {
  try {
    const parsed = loadFightTargetSyncDiagnosticFromLocalStorage();
    if (!parsed) {
      targetListSyncDiagnostic.value = null;
      return;
    }
    targetListSyncDiagnostic.value = parsed;
  } catch (error) {
    console.warn("读取目标列表同步诊断失败:", error);
    targetListSyncDiagnostic.value = null;
  }
};

const saveFightHistoryToLocal = () => {
  try {
    saveFightHistoryToLocalStorage(fightHistoryRecords.value);
  } catch (error) {
    console.warn("保存切磋历史失败:", error);
  }
};

const loadFightHistoryFromLocal = () => {
  try {
    const parsed = loadFightHistoryFromLocalStorage();
    if (!Array.isArray(parsed) || parsed.length === 0) {
      fightHistoryRecords.value = [];
      return;
    }
    fightHistoryRecords.value = sanitizeFightHistoryRecords(parsed);
  } catch (error) {
    console.warn("读取切磋历史失败:", error);
    fightHistoryRecords.value = [];
  }
};

const loadFightHistoryFromCloud = async () => {
  if (!authStore.isAuthenticated)
    return null;

  try {
    const res = await api.user.getPreference(FIGHT_HISTORY_PREF_KEY);
    const rawValue = res?.data?.value;
    if (rawValue == null)
      return [];

    if (typeof rawValue === "string") {
      return sanitizeFightHistoryRecords(JSON.parse(rawValue));
    }

    return sanitizeFightHistoryRecords(rawValue);
  } catch (error) {
    console.warn("读取云端切磋历史失败:", error?.message || error);
    return null;
  }
};

const saveFightHistoryToCloud = async () => {
  if (!authStore.isAuthenticated || !isFightHistorySyncReady.value)
    return;

  try {
    await api.user.setPreference(FIGHT_HISTORY_PREF_KEY, fightHistoryRecords.value);
  } catch (error) {
    console.warn("同步云端切磋历史失败:", error?.message || error);
  }
};

const scheduleFightHistoryCloudSync = () => {
  if (!authStore.isAuthenticated || !isFightHistorySyncReady.value)
    return;

  if (fightHistorySyncTimer) {
    clearTimeout(fightHistorySyncTimer);
  }

  fightHistorySyncTimer = setTimeout(() => {
    fightHistorySyncTimer = null;
    saveFightHistoryToCloud();
  }, 300);
};

const persistFightHistory = () => {
  saveFightHistoryToLocal();
  scheduleFightHistoryCloudSync();
};

const addFightHistoryRecord = (record) => {
  const normalizedRecord = normalizeFightHistoryRecord({
    ...record,
    updatedAt: Date.now(),
  });
  if (!normalizedRecord)
    return;

  const current = [...fightHistoryRecords.value];
  const existingIndex = current.findIndex(
    (item) => item.id === normalizedRecord.id,
  );
  if (existingIndex >= 0) {
    current.splice(existingIndex, 1);
  }
  current.unshift(normalizedRecord);
  fightHistoryRecords.value = sanitizeFightHistoryRecords(current);
  persistFightHistory();
};

const useHistoryTarget = (item) => {
  targetId.value = String(item.id);
  getTargetInfo();
};

const removeFightHistory = (id) => {
  fightHistoryRecords.value = fightHistoryRecords.value.filter(
    (item) => item.id !== id,
  );
  persistFightHistory();
};

const clearFightHistory = () => {
  fightHistoryRecords.value = [];
  persistFightHistory();
};

const saveTargetListsToLocal = () => {
  try {
    saveFightTargetListsToLocalStorage(targetLists.value);
  } catch (error) {
    console.warn("保存好友/关注列表失败:", error);
  }
};

const loadTargetListsFromLocal = () => {
  try {
    const parsed = loadFightTargetListsFromLocalStorage();
    if (!parsed || typeof parsed !== "object") {
      targetLists.value = sanitizeTargetLists({});
      return;
    }
    targetLists.value = sanitizeTargetLists(parsed);
  } catch (error) {
    console.warn("读取好友/关注列表失败:", error);
    targetLists.value = sanitizeTargetLists({});
  }
};

const loadTargetListsFromCloud = async () => {
  if (!authStore.isAuthenticated)
    return null;

  try {
    const res = await api.user.getPreference(FIGHT_TARGET_LISTS_PREF_KEY);
    const rawValue = res?.data?.value;
    if (rawValue == null)
      return sanitizeTargetLists({});

    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    return sanitizeTargetLists(parsed);
  } catch (error) {
    console.warn("读取云端好友/关注列表失败:", error?.message || error);
    return null;
  }
};

const saveTargetListsToCloud = async () => {
  if (!authStore.isAuthenticated || !isTargetListsSyncReady.value)
    return;

  try {
    await api.user.setPreference(FIGHT_TARGET_LISTS_PREF_KEY, targetLists.value);
  } catch (error) {
    console.warn("同步云端好友/关注列表失败:", error?.message || error);
  }
};

const scheduleTargetListsCloudSync = () => {
  if (!authStore.isAuthenticated || !isTargetListsSyncReady.value)
    return;

  if (targetListsSyncTimer) {
    clearTimeout(targetListsSyncTimer);
  }

  targetListsSyncTimer = setTimeout(() => {
    targetListsSyncTimer = null;
    saveTargetListsToCloud();
  }, 300);
};

const persistTargetLists = () => {
  saveTargetListsToLocal();
  scheduleTargetListsCloudSync();
};

const getTargetListLabel = (listKey) =>
  listKey === "friends"
    ? t("fightPvpCard.targetLists.friends")
    : t("fightPvpCard.targetLists.follows");

const addRecordToTargetList = (listKey, record) => {
  const normalizedRecord = normalizeFightHistoryRecord({
    ...record,
    updatedAt: Date.now(),
  });
  if (!normalizedRecord)
    return;

  const current = [...(targetLists.value[listKey] || [])];
  const existingIndex = current.findIndex(
    (item) => item.id === normalizedRecord.id,
  );
  if (existingIndex >= 0) {
    current.splice(existingIndex, 1);
  }
  current.unshift(normalizedRecord);
  targetLists.value = {
    ...targetLists.value,
    [listKey]: sanitizeFightHistoryRecords(current),
  };
  persistTargetLists();
};

const addCurrentTargetToList = (listKey) => {
  if (!memberData.value) {
    message.warning(t("fightPvpCard.messages.queryTargetFirst"));
    return;
  }
  addRecordToTargetList(listKey, {
    id: memberData.value.roleId || targetId.value,
    name: memberData.value.name,
    red: memberData.value.red,
    headImg: memberData.value.headImg,
    serverName: memberData.value.serverName,
  });
  activeTargetListTab.value = listKey;
  message.success(t("fightPvpCard.messages.addedToList", { list: getTargetListLabel(listKey) }));
};

const addHistoryRecordToList = (listKey, item) => {
  addRecordToTargetList(listKey, item);
  message.success(t("fightPvpCard.messages.addedToList", { list: getTargetListLabel(listKey) }));
};

const removeTargetListRecord = (listKey, id) => {
  targetLists.value = {
    ...targetLists.value,
    [listKey]: (targetLists.value[listKey] || []).filter((item) => item.id !== id),
  };
  persistTargetLists();
};

const clearTargetList = (listKey) => {
  targetLists.value = {
    ...targetLists.value,
    [listKey]: [],
  };
  persistTargetLists();
};

const currentTabRecords = computed(() => {
  if (activeTargetListTab.value === "history")
    return fightHistoryRecords.value;
  const records = targetLists.value[activeTargetListTab.value] || [];
  if (activeTargetListTab.value === "friends") {
    return [...records].sort((a, b) => {
      const redDiff = (Number(b?.red) || 0) - (Number(a?.red) || 0);
      if (redDiff !== 0)
        return redDiff;
      return (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0);
    });
  }
  return records;
});

const removeCurrentTabRecord = (id) => {
  if (activeTargetListTab.value === "history") {
    removeFightHistory(id);
    return;
  }
  removeTargetListRecord(activeTargetListTab.value, id);
};

const clearCurrentTabRecords = () => {
  if (activeTargetListTab.value === "history") {
    clearFightHistory();
    return;
  }
  clearTargetList(activeTargetListTab.value);
};

const hasTargetListSyncDiagnostic = computed(
  () =>
    Array.isArray(targetListSyncDiagnostic.value?.attempts)
    && targetListSyncDiagnostic.value.attempts.length > 0,
);

const downloadTextAsFile = (
  text,
  filename,
  mime = "application/json;charset=utf-8",
) => {
  const blob = new Blob([text], { type: mime });
  triggerBlobDownload({ blob, fileName: filename });
};

const exportTargetListSyncDiagnostic = () => {
  if (!hasTargetListSyncDiagnostic.value) {
    message.warning(t("fightPvpCard.messages.noDiagnosticData"));
    return;
  }

  try {
    const text = JSON.stringify(targetListSyncDiagnostic.value, null, 2);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");
    const filename = `fight-pvp-target-sync-diagnostic-${timestamp}.json`;
    downloadTextAsFile(text, filename);
    message.success(t("fightPvpCard.messages.diagnosticExported", { filename }));
  } catch (error) {
    message.error(t("fightPvpCard.messages.exportFailed", {
      error: error?.message || t("fightPvpCard.common.unknownError"),
    }));
  }
};

const { syncTargetListsFromGame } = useFightPvpTargetSync({
  tokenStore,
  message,
  t,
  targetLists,
  syncingTargetLists,
  GAME_TARGET_LIST_BASE_CMD_CANDIDATES,
  sanitizeFightHistoryRecords,
  normalizeFightHistoryRecord,
  mergeFightRecord,
  calculateRedCountFromHeroes,
  extractGameTargetLists,
  persistTargetLists,
  sleep,
});

// 分页状态
const currentPage = ref(1);
const pageSize = ref(20); // 每页20条，共5页

// 计算总页数
const totalPages = computed(() => {
  if (!topranklist.value)
    return 0;
  return Math.ceil(Object.keys(topranklist.value).length / pageSize.value);
});

const selectHeroInfo = (heroInfo) => {
  showHeroModal.value = true;
  heroModealTemp.value = heroInfo;
};

// 获取当前页的数据
const currentPageData = computed(() => {
  if (!topranklist.value)
    return {};

  const startIndex = (currentPage.value - 1) * pageSize.value;
  const endIndex = startIndex + pageSize.value;
  const entries = Object.entries(topranklist.value);

  return Object.fromEntries(entries.slice(startIndex, endIndex));
});
// 格式化战力
const formatPower = (power) => {
  if (!power)
    return "0";
  if (power >= 100000000) {
    return `${(power / 100000000).toFixed(2)}亿`;
  }
  if (power >= 10000) {
    return `${(power / 10000).toFixed(2)}万`;
  }
  return power.toString();
};

// 获取战斗样式类
const getBattleClass = (battle) => {
  const classes = [];
  if (battle.isWin) {
    classes.push("battle-win");
  } else {
    classes.push("battle-loss");
  }
  return classes.join(" ");
};

const formatScore = (score) => {
  return score.toFixed(0).toString();
};

const formatServerId = (ServerId) => {
  return (ServerId - 27).toFixed(0).toString();
};

// 处理图片加载错误
const handleImageError = (event) => {
  event.target.style.display = "none";
};

const { fetchfightPVP, fetchTargetInfo } = useFightPvpActions({
  tokenStore,
  message,
  t,
  gettoday,
  formatPower,
  formatWeapon,
  getLineupType,
  HeroFillInfo,
  countPearlOrangeSlots,
  getHeroInfo,
  loading1,
  loadingText,
  queryDate,
  targetId,
  memberData,
  fightNum,
  fightResult,
  lastTargetRawInfo,
  topranklist,
  addFightHistoryRecord,
});

const exportCurrentTargetRawData = () => {
  if (!lastTargetRawInfo.value) {
    message.warning(t("fightPvpCard.messages.noRawData"));
    return;
  }

  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      targetId: String(targetId.value || ""),
      summary: memberData.value
        ? {
            roleId: memberData.value.roleId,
            name: memberData.value.name,
            red: memberData.value.red,
            orange: memberData.value.orange,
            hole: memberData.value.hole,
          }
        : null,
      raw: lastTargetRawInfo.value,
    };
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `fight-pvp-target-raw-${targetId.value || "unknown"}-${timestamp}.json`;
    downloadTextAsFile(JSON.stringify(payload, null, 2), filename);
    message.success(t("fightPvpCard.messages.rawExported", { filename }));
  } catch (error) {
    message.error(t("fightPvpCard.messages.rawExportFailed", {
      error: error?.message || t("fightPvpCard.common.unknownError"),
    }));
  }
};

/**
 * 提取数组中的英雄信息
 * @param {object} heroObj
 */
function getHeroInfo(heroObj) {
  // 统计总红数
  let redCount = 0;
  let orangeCount = 0;
  let holeCount = 0;
  const heroList = [];
  Object.values(heroObj).forEach((hero) => {
    const heroInfo = HERO_DICT[hero.heroId];
    const equipmentInfo = getEquipment(hero.equipment);
    const tempObj = {
      heroId: hero.heroId, // 英雄ID
      heroSort: hero.battleTeamSlot, // 阵容站位
      artifactId: hero.artifactId, // 英雄装备ID，用于匹配鱼灵信息
      power: formatPower(hero.power), // 英雄战力
      star: hero.star, // 英雄星级
      equipment: hero.equipment, // 英雄具体孔数和红数
      heroName: heroInfo.name, // 英雄姓名
      heroAvate: heroInfo.avatar,
      level: hero.level, // 英雄等级
      hole: equipmentInfo.holeCount, // 英雄开孔数量
      red: equipmentInfo.redCount, // 英雄红数
      orange: equipmentInfo.orangeCount, // 英雄橙数
      HolyBeast: hero.hB?.active, // 激活四圣
      HBlevel: hero.hB?.order || 0, // 四圣等级
    };
    redCount += tempObj.red;
    orangeCount += tempObj.orange;
    holeCount += tempObj.hole;
    heroList.push(tempObj);
  });
  return {
    redCount,
    orangeCount,
    holeCount,
    heroList: heroList.sort((a, b) => {
      return a.heroSort - b.heroSort;
    }),
  };
}

// 获取装备信息红数和孔数
const getEquipment = (equipment) => {
  let redCount = 0;
  let orangeCount = 0;
  let holeCount = 0;
  const palette = getEquipmentPalette(equipment);
  // 此处遍历4件装备
  Object.values(equipment).forEach((equ) => {
    const quenchMap = getEffectiveQuenchMap(equ);
    if (!quenchMap)
      return;
    // 遍历每件装备的属性
    parseQuenchCollection(quenchMap).forEach((item) => {
      holeCount++;
      const colorLevel = getQuenchColorLevel(item);
      if (colorLevel >= palette.redThreshold) {
        redCount++;
      }
      if (colorLevel === palette.orangeLevel) {
        orangeCount++;
      }
    });
  });
  return { redCount, orangeCount, holeCount };
};

// 处理分页大小改变
const handlePageSizeChange = (size) => {
  pageSize.value = size;
  currentPage.value = 1; // 重置到第一页
};
// 刷新战绩
const fightPVPRefresh = () => {
  fetchfightPVP();
};

// 处理切磋次数变化
const handleFightNumChange = (value) => {
  // 确保输入的是有效的数字
  if (typeof value === "string") {
    // 如果是字符串，转换为数字
    const num = Number.parseInt(value, 10);
    // 确保数字有效且大于0,尽量限制最大次数,万一谁请求打多了,可不是什么好事情
    if (!isNaN(num) && num > 0 && num <= 50) {
      fightNum.value = num;
    } else {
      // 否则重置为默认值1
      fightNum.value = 1;
    }
  } else {
    if (value > 0 && value <= 50) {
      // 如果已经是数字类型，直接使用
      fightNum.value = value;
    } else {
      fightNum.value = 1;
    }
  }
};

// 获取对手信息
const getTargetInfo = () => {
  fetchTargetInfo();
};

const handleExport1 = async () => {
  // 校验：确保DOM已正确绑定
  if (!exportDom.value) {
    message.error(t("fightPvpCard.messages.exportDomNotFound"));
    return;
  }

  try {
    // 获取结果列表元素
    const resultList = exportDom.value.querySelector(".result-list");
    let originalMaxHeight = "";
    let originalOverflow = "";
    let originalPaddingRight = "";

    // 临时移除结果列表的高度限制，让所有结果都可见
    if (resultList) {
      originalMaxHeight = resultList.style.maxHeight;
      originalOverflow = resultList.style.overflowY;
      originalPaddingRight = resultList.style.paddingRight;

      resultList.style.maxHeight = "none";
      resultList.style.overflowY = "visible";
      resultList.style.paddingRight = "0";
    }

    // 等待DOM更新
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 生成canvas并导出
    const canvas = await captureWithHtml2canvas(exportDom.value, {
      scale: 2, // 放大2倍，解决图片模糊问题
      useCORS: true, // 允许跨域图片（若DOM内有远程图片，需开启）
      backgroundColor: "#ffffff", // 避免透明背景（默认透明）
      logging: false, // 关闭控制台日志
      allowTaint: true, // 允许跨域图片
      taintTest: false, // 关闭跨域测试
    });

    // 恢复原始样式
    if (resultList) {
      resultList.style.maxHeight = originalMaxHeight;
      resultList.style.overflowY = originalOverflow;
      resultList.style.paddingRight = originalPaddingRight;
    }

    downloadCanvasAsImage(canvas, t("fightPvpCard.messages.exportImageFileName"));
  } catch (err) {
    console.error(t("fightPvpCard.messages.exportImageFailedLog"), err);
    message.error(t("fightPvpCard.messages.exportImageFailed"));
  }
};

// 关闭弹窗
const handleClose = () => {
  expandedMembers.value.clear();
};

// 暴露方法给父组件
defineExpose({
  fetchfightPVP,
});

// Inline 模式：挂载后自动拉取
onMounted(async () => {
  loadFightHistoryFromLocal();
  loadTargetListsFromLocal();
  targetLists.value = {
    friends: sanitizeFightHistoryRecords(targetLists.value.friends || []),
    follows: [],
  };

  const localRecords = [...fightHistoryRecords.value];
  const cloudRecords = await loadFightHistoryFromCloud();
  let mergedRecords = localRecords;

  if (Array.isArray(cloudRecords)) {
    mergedRecords = mergeFightHistoryRecords(cloudRecords, localRecords);
    fightHistoryRecords.value = mergedRecords;
    saveFightHistoryToLocal();
  }

  isFightHistorySyncReady.value = true;

  const shouldSyncToCloud = Array.isArray(cloudRecords)
    ? JSON.stringify(cloudRecords) !== JSON.stringify(mergedRecords)
    : localRecords.length > 0;

  if (shouldSyncToCloud) {
    scheduleFightHistoryCloudSync();
  }

  const localTargetLists = { ...targetLists.value };
  const cloudTargetLists = await loadTargetListsFromCloud();
  let mergedTargetLists = localTargetLists;

  if (cloudTargetLists) {
    mergedTargetLists = {
      friends: sanitizeFightHistoryRecords([
        ...(cloudTargetLists.friends || []),
        ...(localTargetLists.friends || []),
      ]),
      follows: [],
    };
    targetLists.value = {
      friends: mergedTargetLists.friends,
      follows: [],
    };
    saveTargetListsToLocal();
  }

  isTargetListsSyncReady.value = true;

  const shouldSyncTargetListsToCloud = cloudTargetLists
    ? JSON.stringify(cloudTargetLists) !== JSON.stringify(mergedTargetLists)
    : localTargetLists.friends.length > 0;

  if (shouldSyncTargetListsToCloud) {
    scheduleTargetListsCloudSync();
  }
  // if (props.inline) {
  //     topranklistRefresh()
  // }
});

onBeforeUnmount(() => {
  if (fightHistorySyncTimer) {
    clearTimeout(fightHistorySyncTimer);
    fightHistorySyncTimer = null;
  }
  if (targetListsSyncTimer) {
    clearTimeout(targetListsSyncTimer);
    targetListsSyncTimer = null;
  }
});
</script>

<style scoped lang="scss">
.modal-w-600 {
  width: 600px;
}

.ml-8 {
  margin-left: 8px;
}

.legacy-tag {
  color: #fff;
  background-color: var(--legacy-bg);
}

.lineup-type-tag {
  font-weight: 700;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.25),
    0 1px 3px rgba(0, 0, 0, 0.18);
}

.fight-pvp-container {
  width: 100%;
  // padding: 16px;
}

.main-card {
  background: var(--bg-primary);
  border-radius: var(--border-radius-xl);
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.main-card:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
}

.card-header .status-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 12px;
  margin-right: 16px;
}

.card-header .status-info {
  flex: 1;
}

.card-header .status-info h3 {
  margin: 0 0 4px 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-header .status-info p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.action-section {
  margin-bottom: 24px;
}

.action-section .input-group {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.action-section .input-group .target-input {
  flex: 1;
}

.action-section .fight-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.action-section .fight-options .option-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-section .fight-options .option-item .option-label {
  font-size: 14px;
  color: var(--text-secondary);
}

.action-section .fight-options .option-item .fight-count-select {
  width: 120px;
}

.action-section .fight-options .option-actions {
  display: flex;
  gap: 12px;
}

.history-section {
  margin-bottom: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  padding: 12px;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 10px;
  flex-wrap: wrap;
}

.history-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.history-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.history-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
}

.history-content {
  min-width: 0;
  flex: 1;
}

.history-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.history-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.history-id {
  font-size: 12px;
  color: var(--text-tertiary);
}

.history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.history-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.loading-section {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px 20px;
  background: var(--bg-secondary);
  border-radius: var(--border-radius-medium);
}

.empty-state {
  padding: 40px 20px;
  background: var(--bg-secondary);
  border-radius: var(--border-radius-medium);
  text-align: center;
}

.content-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-large);
  padding: 12px;
  transition: all 0.3s ease;
}

.info-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.info-card .card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-light);
}

.info-card .card-title h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.info-card .card-title .card-title-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-card .card-title .hero-count {
  font-size: 13px;
  color: var(--text-secondary);
}

.info-card .card-title .click-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}

/* 左右卡片的额外优化 */
.info-card.left-card,
.info-card.right-card {
  padding: 10px;
  display: flex;
  flex-direction: column;
}

/* 确保对手信息卡片和对手阵容卡片高度完全一致 */
.info-card.left-card,
.info-card.right-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 调整对手信息表格的内部间距 */
.info-table {
  border-spacing: 0;
  border-collapse: collapse;
}

.info-table tr {
  display: table-row;
  height: 26px;
}

.info-card.left-card .card-title,
.info-card.right-card .card-title {
  margin-bottom: 6px;
  padding-bottom: 4px;
}

.info-card.left-card .opponent-info-table {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.info-card.left-card .info-table {
  flex: 1;
}

/* 对手信息表格样式 */
.opponent-info-table {
  width: 100%;
  overflow-x: auto;
}

.info-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto; /* 自动表格布局，根据内容调整宽度 */
}

.info-table td {
  padding: 2px 5px; /* 进一步减少内边距 */
  font-size: 13px; /* 略微减小字体大小 */
  vertical-align: middle;
  height: 24px; /* 进一步减小行高 */
  line-height: 24px; /* 确保行高与内容对齐 */
}

.info-table .avatar-cell {
  width: 70px;
  text-align: center;
  padding: 6px;
}

.info-table .opponent-avatar {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border: 2px solid var(--primary-color-light);
}

.info-table .label-cell {
  width: 100px;
  color: var(--text-secondary);
  text-align: right;
  font-weight: 500;
  background-color: var(--bg-secondary);
  border-right: 1px solid var(--border-light);
  white-space: nowrap; /* 确保标签不换行 */
}

.info-table .value-cell {
  color: var(--text-primary);
  text-align: left;
  font-weight: 500;
  padding-left: 10px;
  white-space: nowrap; /* 防止文本自动换行 */
  min-width: 120px; /* 确保有足够宽度显示内容 */
}

.info-table .highlight-row .value-cell {
  color: var(--primary-color);
  font-weight: 600;
}

.info-table .lineup {
  display: flex;
  gap: 6px;
  align-items: center;
}

.info-table .lineup .red-count {
  color: #ef4444;
  font-weight: 600;
}

.info-table .lineup .separator {
  color: var(--text-secondary);
}

.info-table .lineup .hole-count {
  color: #10b981;
  font-weight: 600;
}

.opponent-main-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  grid-template-rows: 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 1200px) {
  .opponent-main-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }
}

.opponent-main-layout .left-card {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
}

.opponent-main-layout .right-card {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
}

@media (max-width: 1200px) {
  .opponent-main-layout .left-card {
    grid-column: 1;
    grid-row: 1;
  }
  .opponent-main-layout .right-card {
    grid-column: 1;
    grid-row: 2;
  }
}

/* 英雄卡片样式 */
.heroes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-top: 16px;
  justify-items: center; /* 水平居中 */
  align-items: center; /* 垂直居中 */
  justify-content: center; /* 确保整个网格在容器中居中 */
  height: 100%;
  padding: 8px 0;
}

@media (max-width: 768px) {
  .heroes-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
}

.heroes-grid.compact {
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  justify-items: center; /* 水平居中 */
  align-items: center; /* 垂直居中 */
}

@media (max-width: 1200px) {
  .heroes-grid.compact {
    grid-template-columns: repeat(5, minmax(100px, 1fr));
    gap: 12px;
  }
}

@media (max-width: 768px) {
  .heroes-grid.compact {
    grid-template-columns: repeat(5, minmax(80px, 1fr));
    gap: 8px;
  }
}

.hero-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  padding: 12px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.hero-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  border-color: var(--primary-color-light);
}

.hero-card.compact {
  padding: 12px;
  min-height: auto;
  width: 130px; /* 调整卡片宽度 */
  height: 190px; /* 调整卡片高度 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.hero-avatar-container {
  position: relative;
  margin-bottom: 12px;
}

.hero-card.compact .hero-avatar-container {
  margin-bottom: 10px;
}

.hero-circle {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  margin: 0 auto 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.hero-card.compact .hero-circle {
  width: 64px;
  height: 64px;
}

.hero-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-placeholder {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-secondary);
}

.hero-info {
  text-align: center;
}

.hero-name-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  height: 22px; /* 设置固定行高 */
}

.hero-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 22px; /* 与行高保持一致 */
  display: inline-flex;
  align-items: center;
  height: 100%;
}

.hero-card.compact .hero-name {
  font-size: 13px;
  margin: 0;
  line-height: 22px; /* 与行高保持一致 */
}

.holy-beast-tag {
  font-size: 10px;
  padding: 2px 6px;
  margin: 0;
  display: inline-flex;
  align-items: center;
  height: 22px; /* 与行高保持一致 */
  vertical-align: middle;
}

.hero-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hero-stats .stat-item {
  font-size: 12px;
  color: var(--text-secondary);
}

.hero-card.compact .hero-stats .stat-item {
  font-size: 11px;
  line-height: 16px;
}

/* 结果卡片样式 */
.result-card .card-title .result-summary {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.result-summary .summary-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.result-summary .summary-label {
  font-size: 14px;
  color: var(--text-secondary);
}

.result-summary .summary-value {
  font-size: 16px;
  font-weight: 600;
}

.result-summary .win-rate .summary-value {
  color: var(--success-color);
}

.result-summary .die-rate .summary-value {
  color: var(--warning-color);
}

.result-summary .win-count .summary-value {
  color: var(--success-color);
}

.result-summary .loss-count .summary-value {
  color: var(--error-color);
}

.result-list {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(2, 1fr); /* 1行显示2场战斗结果 */
  gap: 12px;
  max-height: 500px; /* 限制最大高度 */
  overflow-y: auto; /* 添加垂直滚动 */
  padding-right: 8px; /* 为滚动条预留空间 */
}

/* 自定义滚动条样式 */
.result-list::-webkit-scrollbar {
  width: 6px;
}

.result-list::-webkit-scrollbar-track {
  background: var(--bg-secondary);
  border-radius: 3px;
}

.result-list::-webkit-scrollbar-thumb {
  background: var(--border-light);
  border-radius: 3px;
}

.result-list::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

.battle-result-item {
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  padding: 10px;
  transition: all 0.3s ease;
  width: 100%;
  box-sizing: border-box;
}

@media (max-width: 1200px) {
  .result-list {
    grid-template-columns: 1fr; /* 在小屏幕上恢复1行1场 */
  }
}

.battle-result-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.battle-result-item.win {
  border-left: 4px solid var(--success-color);
  background-color: rgba(16, 185, 129, 0.05);
}

.battle-result-item.loss {
  border-left: 4px solid var(--error-color);
  background-color: rgba(239, 68, 68, 0.05);
}

.battle-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.battle-index {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.battle-details {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 768px) {
  .battle-details {
    flex-direction: column;
    gap: 12px;
  }
}

.battle-side {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.battle-side.left-side {
  justify-content: flex-end;
  text-align: right;
}

.battle-side.right-side {
  justify-content: flex-start;
}

.side-avatar {
  flex-shrink: 0;
}

.side-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.side-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.side-power,
.side-die {
  font-size: 12px;
  color: var(--text-secondary);
}

.battle-vs {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* 英雄详情模态框样式 */
.hero-detail-modal .hero-modal-content {
  padding: 20px 0;
}

.hero-modal-header {
  display: flex;
  gap: 24px;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-light);
}

@media (max-width: 768px) {
  .hero-modal-header {
    flex-direction: column;
    text-align: center;
  }
}

.hero-modal-avatar {
  flex-shrink: 0;
}

.hero-modal-avatar img {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid var(--primary-color-light);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.hero-modal-basic {
  flex: 1;
}

.hero-modal-name {
  margin: 0 0 12px 0;
  font-size: 24px;
  font-weight: 600;
}

.hero-modal-stats {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.hero-modal-stats .stat-item {
  font-size: 14px;
  color: var(--text-primary);
}

.hero-modal-stats .stat-item:first-child {
  font-size: 18px;
  font-weight: 600;
  color: var(--primary-color);
}

.hero-modal-details {
  margin-bottom: 24px;
}

.hero-modal-equipment .section-title {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
}

.equipment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.equipment-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.equipment-label {
  font-size: 14px;
  color: var(--text-secondary);
}

.equipment-slots {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.equipment-slot {
  width: 20px;
  height: 20px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.equipment-slot.red-slot {
  background-color: #ef4444;
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

.equipment-slot.orange-slot {
  background-color: #f59e0b;
  border-color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
}

.orange-count {
  color: #d97706;
}

/* 鱼珠洗练样式 */
.ModalEquipment {
  display: inline-block;
  width: 18px;
  height: 18px;
  background-color: var(--equip-color);
  margin-right: 5px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.modal-footer {
  display: flex;
  justify-content: center;
  gap: 12px;
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .action-section .fight-options {
    flex-direction: column;
    align-items: stretch;
  }

  .heroes-card .heroes-grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}

@media (max-width: 768px) {
  .main-card {
    padding: 12px;
  }

  .card-header {
    flex-direction: column;
    text-align: center;
    gap: 12px;
  }

  .action-section .input-group {
    flex-direction: column;
  }

  .history-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .history-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .result-card .card-title .result-summary {
    flex-direction: column;
    gap: 12px;
  }

  .result-card .battle-details {
    flex-direction: column;
    gap: 16px;
  }

  .result-card .battle-side {
    justify-content: center !important;
  }
}

@media (max-width: 480px) {
  .info-card {
    padding: 12px;
  }

  .heroes-card .heroes-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }

  .heroes-card .hero-card {
    padding: 12px;
  }
}
</style>
