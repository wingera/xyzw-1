import { defineStore } from "pinia";
import { computed, ref } from "vue";
import api from "@/api";

import type { ProtoMsg } from "@/utils/bonProtocol";
import { gameLogger, tokenLogger, wsLogger } from "@/utils/logger";
import { sanitizeForLog } from "@/utils/securitySanitizer";
import {
  clearCrossTabConnectionState,
  createConnectionLockHelpers,
  generateSessionId,
  hasRecentForeignConnection,
  subscribeCrossTabConnectionEvents,
  writeCrossTabConnectionState,
} from "@/services/token/connectionCoordination";
import {
  closeWebSocketConnectionAsyncById,
  getWebSocketClientById,
  getWebSocketStatusById,
  sendMessageById,
  sendMessageWithPromiseById,
} from "@/services/token/tokenConnectionService";
import {
  sendClaimDailyRewardById,
  sendGameMessageById,
  sendGetDataBundleVersionById,
  sendGetRoleInfoById,
  sendGetTeamInfoById,
  sendMessageToLegionById,
  sendMessageToWorldById,
  sendSignInById,
} from "@/services/token/tokenGameCommandService";
import { handleGameMessageById } from "@/services/token/tokenMessageService";
import {
  attemptTokenRefreshById,
  createConnectionMonitor,
} from "@/services/token/tokenMaintenanceService";
import { createTokenGameDataReader } from "@/services/token/tokenGameDataReader";
import { syncRandomSeedFromStatisticsById } from "@/services/token/tokenRuntimeSyncService";
import {
  activeConnections,
  allGameTokens,
  allTokenGroups,
  gameTokens,
  getEffectiveUserId,
  hasTokens,
  selectedToken,
  selectedTokenId,
  tokenGroups,
} from "@/services/token/tokenStorage";
import type { TokenData } from "@/services/token/tokenStorage";
import { resolveServerActivationBindingForToken } from "@/services/token/tokenActivationBindingResolver";
import { createTokenDataService } from "@/services/token/tokenDataService";
import { createTokenGroupService } from "@/services/token/tokenGroupService";
import { createWebSocketConnectionById } from "@/services/token/tokenWebSocketService";
import type { XyzwWebSocketClient } from "@/utils/xyzwWebSocket";

import { deleteBinBuffer } from "@/utils/binStorage";
import { emitPlus } from "./events/index.js";
import router from "@/router";

export {
  gameTokens,
  hasTokens,
  selectedToken,
  selectedTokenId,
  tokenGroups,
} from "@/services/token/tokenStorage";

declare interface WebSocketConnection {
  status: "connecting" | "connected" | "disconnected" | "error";
  client: XyzwWebSocketClient | null;
  lastError: { timestamp: string; error: string; url?: string } | null;
  tokenId: string;
  sessionId: string;
  wsUrl?: string;
  tokenPreview?: string;
  createdAt: string;
  lastMessageAt: string | null;
  randomSeedSynced?: boolean;
  lastRandomSeedSource?: number | null;
  lastRandomSeed?: number | null;
}

declare type WebCtx = Record<string, Partial<WebSocketConnection>>;

declare interface ConnectLock {
  tokenId: string;
  operation: "connect" | "disconnect";
  timestamp: number;
  sessionId: string;
}
declare type LockCtx = Record<string, Partial<ConnectLock>>;

/**
 * 重构后的Token管理存储
 * 以名称-token列表形式管理多个游戏角色
 */
export const useTokenStore = defineStore("tokens", () => {
  const wsConnections = ref<WebCtx>({}); // WebSocket连接状态
  const connectionLocks = ref<LockCtx>({}); // 连接操作锁，防止竞态条件
  const skippedMessageWarnings = ref<
    Record<string, { message: string; cmd?: string; timestamp: number }>
  >({});

  const isTokenActivationExpired = (
    token: Partial<TokenData> | null | undefined,
  ) => {
    const raw = String(token?.activationExpiresAt || "").trim();
    if (!raw) {
      return true;
    }
    const expiresTs = new Date(raw).getTime();
    if (!Number.isFinite(expiresTs)) {
      return true;
    }
    return expiresTs <= Date.now();
  };

  const isTokenWorkbenchReady = (
    token: Partial<TokenData> | null | undefined,
  ) => {
    const roleId = String(
      token?.activationRoleId || token?.activationGameAccountId || "",
    ).trim();
    if (!roleId) {
      return false;
    }
    return !isTokenActivationExpired(token);
  };

  const hasUsableWorkbenchToken = computed(() =>
    gameTokens.value.some((token) => isTokenWorkbenchReady(token)),
  );

  // 游戏数据存储
  const gameData = ref({
    roleInfo: null,
    legionInfo: null,
    commonActivityInfo: null, // 消耗活动进度
    bossTowerInfo: null, // 宝库
    evoTowerInfo: null, // 怪异塔
    presetTeam: null,
    battleVersion: null as number | null, // 战斗版本号
    studyStatus: {
      isAnswering: false,
      questionCount: 0,
      answeredCount: 0,
      status: "", // '', 'starting', 'answering', 'claiming_rewards', 'completed'
      timestamp: null,
    },
    lastUpdated: null as string | null,
  });

  // 获取当前选中token的角色信息
  const selectedTokenRoleInfo = computed(() => {
    return gameData.value.roleInfo;
  });

  const syncRandomSeedFromStatistics = (
    tokenId: string,
    rolePayload: any,
    client: XyzwWebSocketClient | null,
  ) => {
    return syncRandomSeedFromStatisticsById({
      tokenId,
      rolePayload,
      client,
      wsConnections,
      logger: wsLogger,
    });
  };

  // Token管理
  const addToken = (tokenData: TokenData) => {
    const id =
      tokenData.id ||
      `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const ownerId = getEffectiveUserId() || tokenData.ownerId;
    const isBinBacked =
      tokenData.importMethod === "bin" || tokenData.importMethod === "wxQrcode";
    const newToken = {
      id,
      ownerId,
      sessId: tokenData.sessId || tokenData.activationSessId || "",
      roleId: tokenData.roleId || "",
      name: tokenData.name,
      token: tokenData.token, // 保存原始Base64 token
      wsUrl: tokenData.wsUrl || null, // 可选的自定义WebSocket URL
      server: tokenData.server || "",
      roleIndex: tokenData.roleIndex ?? "",
      remark: tokenData.remark || "", // 备注信息
      level: tokenData.level || 1,
      profession: tokenData.profession || "",
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      isActive: true,
      // URL获取相关信息
      sourceUrl: tokenData.sourceUrl || null, // Token来源URL（用于刷新）
      importMethod: tokenData.importMethod || "manual", // 导入方式：manual 或 url
      avatar: tokenData.avatar || "", // 用户头像
      activationSessId: tokenData.activationSessId || tokenData.sessId || "",
      activationRoleId:
        tokenData.activationRoleId || tokenData.activationGameAccountId || "",
      activationGameAccountId:
        tokenData.activationGameAccountId || tokenData.activationRoleId || "",
      activationRoleName: tokenData.activationRoleName || tokenData.name || "",
      activationRegion: tokenData.activationRegion || tokenData.server || "",
      activationExpiresAt: tokenData.activationExpiresAt || null,
      activationBoundAt: tokenData.activationBoundAt || null,
      binSourceState:
        tokenData.binSourceState || (isBinBacked ? "available" : undefined),
      binSourceMissingAt: tokenData.binSourceMissingAt || null,
    };

    gameTokens.value = [...gameTokens.value, newToken];
    return newToken;
  };

  const updateToken = (tokenId: string, updates: Partial<TokenData>) => {
    const currentTokens = [...gameTokens.value];
    const index = currentTokens.findIndex((token) => token.id === tokenId);
    if (index !== -1) {
      currentTokens[index] = {
        ...currentTokens[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      gameTokens.value = currentTokens;
      return true;
    }
    return false;
  };

  const resolveActivationBinding = async (tokenId: string) => {
    const token = gameTokens.value.find(
      (item) => String(item?.id || "").trim() === String(tokenId || "").trim(),
    );
    if (!token) {
      return null;
    }

    const res = await api.tokenActivation.listMine();
    const bindings = Array.isArray(res?.data) ? res.data : [];
    return resolveServerActivationBindingForToken({
      token,
      bindings,
      parseBase64Token,
    });
  };

  const syncActivationBindingsFromServer = async () => {
    if (gameTokens.value.length === 0) {
      return { matchedCount: 0 };
    }

    const res = await api.tokenActivation.listMine();
    const bindings = Array.isArray(res?.data) ? res.data : [];
    let matchedCount = 0;

    for (const token of [...gameTokens.value]) {
      const binding = resolveServerActivationBindingForToken({
        token,
        bindings,
        parseBase64Token,
      });
      if (!binding) {
        continue;
      }

      updateToken(token.id, {
        activationSessId:
          binding.sessId || token.activationSessId || token.sessId || "",
        activationRoleId: binding.roleId,
        activationGameAccountId: binding.roleId,
        activationRoleName:
          binding.roleName || token.activationRoleName || token.name || "",
        activationRegion:
          binding.region || token.activationRegion || token.server || "",
        activationExpiresAt:
          binding.expiresAt || token.activationExpiresAt || null,
        activationBoundAt: binding.boundAt || token.activationBoundAt || null,
      });
      matchedCount += 1;
    }

    return { matchedCount };
  };

  const markBinSourceState = (
    tokenId: string,
    state: "available" | "missing",
  ) => {
    return updateToken(tokenId, {
      binSourceState: state,
      binSourceMissingAt: state === "missing" ? new Date().toISOString() : null,
    });
  };

  const removeToken = async (tokenId: string) => {
    const targetToken = gameTokens.value.find((token) => token.id === tokenId);
    gameTokens.value = gameTokens.value.filter((token) => token.id !== tokenId);

    // 关闭对应的WebSocket连接
    if (wsConnections.value[tokenId]) {
      closeWebSocketConnection(tokenId);
    }

    // 如果删除的是当前选中token，清除选中状态
    if (selectedTokenId.value === tokenId) {
      selectedTokenId.value = null;
    }

    await deleteBinBuffer(tokenId, targetToken ? [targetToken.name] : []);

    return true;
  };

  const selectToken = (tokenId: string, forceReconnect = false) => {
    const token = gameTokens.value.find((t) => t.id === tokenId);
    if (!token) {
      return null;
    }

    // 检查是否已经是当前选中的token
    const isAlreadySelected = selectedTokenId.value === tokenId;
    const existingConnection = wsConnections.value[tokenId];
    const isConnected = existingConnection?.status === "connected";
    const isConnecting = existingConnection?.status === "connecting";

    tokenLogger.debug(`选择Token: ${tokenId}`, {
      isAlreadySelected,
      isConnected,
      isConnecting,
      forceReconnect,
    });

    // 更新选中状态
    selectedTokenId.value = tokenId;

    // 更新最后使用时间
    updateToken(tokenId, { lastUsed: new Date().toISOString() });
    // 避免点击断开链接
    if (isConnected) {
      return token;
    }
    // 智能连接判断
    const shouldCreateConnection =
      forceReconnect || // 强制重连
      !isAlreadySelected || // 首次选择此token
      !existingConnection || // 没有现有连接
      existingConnection.status === "disconnected" || // 连接已断开
      existingConnection.status === "error"; // 连接出错

    if (shouldCreateConnection) {
      if (isAlreadySelected && !forceReconnect) {
        wsLogger.info(`Token已选中但无连接，创建新连接: ${tokenId}`);
      } else if (!isAlreadySelected) {
        wsLogger.info(`切换到新Token，创建连接: ${tokenId}`);
      } else if (forceReconnect) {
        wsLogger.info(`强制重连Token: ${tokenId}`);
      }

      // 创建WebSocket连接
      createWebSocketConnection(tokenId, token.token, token.wsUrl).catch(
        (error) => {
          wsLogger.warn(
            `Token 连接被阻止 [${tokenId}]: ${error?.message || "unknown"}`,
          );
        },
      );
    } else {
      if (isConnected) {
        wsLogger.debug(`Token已连接，跳过连接创建: ${tokenId}`);
      } else if (isConnecting) {
        wsLogger.debug(`Token连接中，跳过连接创建: ${tokenId}`);
      } else {
        wsLogger.debug(`Token已选中且有连接，跳过连接创建: ${tokenId}`);
      }
    }

    return token;
  };

  // Token刷新尝试记录
  const tokenRefreshAttempts = ref<Record<string, number>>({});

  // 尝试自动刷新Token
  const attemptTokenRefresh = async (
    tokenId: string,
    forceReconnect = false,
  ) => {
    return attemptTokenRefreshById({
      tokenId,
      forceReconnect,
      tokenRefreshAttempts,
      gameTokens,
      wsConnections,
      updateToken,
      markBinSourceState,
      selectToken,
      getCurrentPath: () => router.currentRoute.value.path,
      logger: wsLogger,
    });
  };

  // 游戏消息处理
  const handleGameMessage = async (
    tokenId: string,
    message: ProtoMsg,
    client: any,
  ) => {
    return handleGameMessageById({
      tokenId,
      message,
      client,
      wsConnections,
      gameTokens,
      gameData,
      updateToken,
      syncRandomSeedFromStatistics,
      onMessageSkipped: (warningTokenId, info) => {
        skippedMessageWarnings.value = {
          ...skippedMessageWarnings.value,
          [warningTokenId]: info,
        };
      },
      attemptTokenRefresh,
      emitGameEvent: (cmd, payload) => emitPlus(cmd, payload),
      logger: gameLogger,
    });
  };

  const getSkippedMessageWarning = (tokenId: string) => {
    return skippedMessageWarnings.value[tokenId] || null;
  };

  const clearSkippedMessageWarning = (tokenId: string) => {
    if (!skippedMessageWarnings.value[tokenId]) {
      return;
    }
    const nextWarnings = { ...skippedMessageWarnings.value };
    delete nextWarnings[tokenId];
    skippedMessageWarnings.value = nextWarnings;
  };

  const currentSessionId = generateSessionId();
  const { acquireConnectionLock, releaseConnectionLock } =
    createConnectionLockHelpers({
      connectionLocks,
      logger: wsLogger,
      currentSessionId,
    });

  // 更新跨标签页连接状态
  const updateCrossTabConnectionState = (
    tokenId: string,
    action: string,
    sessionId: string = currentSessionId,
  ) => {
    writeCrossTabConnectionState({
      tokenId,
      action,
      sessionId,
      activeConnections,
    });
  };

  // 检查是否有其他标签页的活跃连接
  const checkCrossTabConnection = (tokenId: string) => {
    const state = hasRecentForeignConnection({
      tokenId,
      currentSessionId,
    });
    if (state) {
      wsLogger.debug(`检测到其他标签页的活跃连接: ${tokenId}`);
      return state;
    }
    return null;
  };

  // WebSocket连接管理（重构版 - 防重连）
  const createWebSocketConnection = async (
    tokenId: string,
    base64Token: string,
    customWsUrl = null,
  ) => {
    const token = gameTokens.value.find((item) => item.id === tokenId);
    if (token) {
      const roleId = String(
        token.activationRoleId ||
          token.activationGameAccountId ||
          token.roleId ||
          "",
      ).trim();
      if (!roleId) {
        throw new Error("该Token尚未激活，请先绑定角色RoleID并输入激活码");
      }

      const localExpiresAt = String(token.activationExpiresAt || "").trim();
      if (localExpiresAt && new Date(localExpiresAt).getTime() <= Date.now()) {
        throw new Error("该Token激活已过期，请续期后再使用");
      }

      const currentActivation = {
        sessId: String(token.activationSessId || token.sessId || "").trim(),
        roleId,
        roleName:
          String(token.activationRoleName || token.name || "").trim() ||
          "未命名角色",
        region:
          String(token.activationRegion || token.server || "").trim() ||
          "未知大区",
        roleIndex: String(token.roleIndex ?? "").trim(),
      };
      let statusRes;

      try {
        statusRes = await api.tokenActivation.getStatus(
          tokenId,
          currentActivation.roleId,
          {
            sessId: currentActivation.sessId,
            roleName: currentActivation.roleName,
            region: currentActivation.region,
            server: currentActivation.region,
            roleIndex: currentActivation.roleIndex,
          },
        );
      } catch (error: any) {
        const message = String(error?.message || "").trim();
        if (!message.includes("未绑定当前账号标识")) {
          throw error;
        }

        const binding = await resolveActivationBinding(tokenId);
        if (!binding) {
          throw error;
        }

        statusRes = await api.tokenActivation.getStatus(
          tokenId,
          binding.roleId,
          {
            sessId: binding.sessId,
            roleName: binding.roleName || currentActivation.roleName,
            region: binding.region || currentActivation.region,
            server: binding.region || currentActivation.region,
            roleIndex: binding.roleIndex || currentActivation.roleIndex,
          },
        );

        updateToken(tokenId, {
          activationSessId: binding.sessId || currentActivation.sessId,
          activationRoleId: binding.roleId,
          activationGameAccountId: binding.roleId,
          activationRoleName: binding.roleName || currentActivation.roleName,
          activationRegion: binding.region || currentActivation.region,
          activationExpiresAt:
            binding.expiresAt || token.activationExpiresAt || null,
          activationBoundAt: binding.boundAt || token.activationBoundAt || null,
        });
      }

      if (!statusRes?.success || !statusRes?.data?.active) {
        throw new Error(statusRes?.message || "该Token未激活或已过期");
      }

      updateToken(tokenId, {
        activationSessId: String(
          statusRes?.data?.sessId || currentActivation.sessId,
        ).trim(),
        activationRoleId: String(
          statusRes?.data?.roleId || statusRes?.data?.gameAccountId || roleId,
        ).trim(),
        activationGameAccountId: String(
          statusRes?.data?.gameAccountId || statusRes?.data?.roleId || roleId,
        ).trim(),
        activationRoleName: String(
          statusRes?.data?.roleName || currentActivation.roleName,
        ).trim(),
        activationRegion: String(
          statusRes?.data?.region || currentActivation.region,
        ).trim(),
        activationExpiresAt:
          statusRes?.data?.expiresAt || token.activationExpiresAt || null,
        activationBoundAt:
          statusRes?.data?.boundAt || token.activationBoundAt || null,
      });
    }

    return createWebSocketConnectionById({
      tokenId,
      base64Token,
      customWsUrl,
      wsConnections,
      currentSessionId,
      acquireConnectionLock,
      releaseConnectionLock,
      checkCrossTabConnection,
      updateCrossTabConnectionState,
      closeExistingConnection: closeWebSocketConnectionAsync,
      parseBase64Token,
      validateToken,
      attemptTokenRefresh,
      onMessage: handleGameMessage,
      clearChatCache: () => localStorage.removeItem("xyzw_chat_msg_list"),
      logger: wsLogger,
    });
  };

  // 异步版本的关闭连接（优雅关闭）
  const closeWebSocketConnectionAsync = async (tokenId: string) => {
    return closeWebSocketConnectionAsyncById({
      tokenId,
      wsConnections,
      acquireConnectionLock,
      releaseConnectionLock,
      updateCrossTabConnectionState,
      logger: wsLogger,
    });
  };

  // 同步版本的关闭连接（保持向后兼容）
  const closeWebSocketConnection = (tokenId: string) => {
    closeWebSocketConnectionAsync(tokenId).catch((error) => {
      wsLogger.error(`关闭连接异步操作失败 [${tokenId}]:`, error);
    });
  };

  const getWebSocketStatus = (tokenId: string) => {
    return getWebSocketStatusById(wsConnections.value, tokenId);
  };

  // 获取WebSocket客户端
  const getWebSocketClient = (tokenId: string) => {
    return getWebSocketClientById(wsConnections.value, tokenId);
  };

  // 设置消息监听器
  const setMessageListener = (listener: any) => {
    if (selectedToken.value) {
      const connection = wsConnections.value[selectedToken.value.id];
      if (connection && connection.client) {
        connection.client.setMessageListener(listener);
      }
    }
  };

  // 设置是否显示消息
  const setShowMsg = (show: any) => {
    if (selectedToken.value) {
      const connection = wsConnections.value[selectedToken.value.id];
      if (connection && connection.client) {
        connection.client.setShowMsg(show);
      }
    }
  };

  // 发送消息到WebSocket
  const sendMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    options = {},
  ) => {
    return sendMessageById({
      tokenId,
      cmd,
      params,
      options,
      wsConnections: wsConnections.value,
      logger: wsLogger,
    });
  };

  // Promise版发送消息
  const sendMessageWithPromise = async (
    tokenId: string,
    cmd: string,
    params = {},
    timeout = 5000,
  ) => {
    // 为战斗相关命令自动注入 battleVersion
    const battleCommands = [
      "fight_startareaarena",
      "fight_startpvp",
      "fight_starttower",
      "fight_startboss",
      "fight_startlegionboss",
      "fight_startdungeon",
    ];
    if (battleCommands.includes(cmd)) {
      const battleVersion = gameData.value.battleVersion;
      params = { battleVersion, ...params };
      wsLogger.info(
        `⚔️ [战斗命令] 注入 battleVersion: ${battleVersion} [${cmd}]`,
      );
    }

    try {
      const result = await sendMessageWithPromiseById({
        tokenId,
        cmd,
        params,
        timeout,
        wsConnections: wsConnections.value,
      });

      // 特殊日志：fight_starttower 响应
      if (cmd === "fight_starttower") {
        wsLogger.info(`🗼 [咸将塔] 收到爬塔响应 [${tokenId}]:`, result);
      }

      return result;
    } catch (error) {
      // 特殊日志：fight_starttower 错误
      if (cmd === "fight_starttower") {
        wsLogger.error(`🗼 [咸将塔] 爬塔请求失败 [${tokenId}]:`, error.message);
      }
      return Promise.reject(error);
    }
  };

  // 发送心跳消息
  const sendHeartbeat = (tokenId: string) => {
    return sendMessage(tokenId, "heart_beat");
  };

  // 发送获取角色信息请求（异步处理）
  const sendGetRoleInfo = async (
    tokenId: string,
    params = {},
    retryCount = 0,
  ) => {
    const roleInfo = await sendGetRoleInfoById({
      tokenId,
      params,
      retryCount,
      sendMessageWithPromise,
      gameData,
      logger: gameLogger,
    });
    const resolvedName = String(
      roleInfo?.role?.name ||
        roleInfo?.name ||
        roleInfo?.roleInfo?.name ||
        roleInfo?.role_info?.name ||
        "",
    ).trim();
    const resolvedServer = String(
      roleInfo?.role?.serverName ||
        roleInfo?.serverName ||
        roleInfo?.role?.server ||
        roleInfo?.server ||
        "",
    ).trim();
    if (resolvedName || resolvedServer) {
      updateToken(tokenId, {
        ...(resolvedName ? { name: resolvedName } : {}),
        ...(resolvedServer ? { server: resolvedServer } : {}),
      });
    }
    return roleInfo;
  };

  // 发送获取数据版本请求
  const sendGetDataBundleVersion = (tokenId: string, params = {}) => {
    return sendGetDataBundleVersionById(
      tokenId,
      params,
      sendMessageWithPromise,
    );
  };

  // 发送签到请求
  const sendSignIn = (tokenId: string) => {
    return sendSignInById(tokenId, sendMessageWithPromise);
  };

  // 发送领取日常任务奖励
  const sendClaimDailyReward = (tokenId: string, rewardId = 0) => {
    return sendClaimDailyRewardById(tokenId, rewardId, sendMessageWithPromise);
  };

  // 发送获取队伍信息
  const sendGetTeamInfo = (tokenId: string, params = {}) => {
    return sendGetTeamInfoById(tokenId, params, sendMessageWithPromise);
  };

  // 发送消息到世界
  const sendMessageToWorld = (tokenId: string, message: string) => {
    return sendMessageToWorldById(tokenId, message, sendMessageWithPromise);
  };
  // 发送消息到俱乐部
  const sendMessageToLegion = (tokenId: string, message: string) => {
    return sendMessageToLegionById(tokenId, message, sendMessageWithPromise);
  };

  // 发送自定义游戏消息
  const sendGameMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    options = {},
  ) => {
    return sendGameMessageById({
      tokenId,
      cmd,
      params,
      options,
      sendMessage,
      sendMessageWithPromise,
    });
  };

  const clearAllTokens = async () => {
    // 关闭所有WebSocket连接
    Object.keys(wsConnections.value).forEach((tokenId) => {
      closeWebSocketConnection(tokenId);
    });

    const currentTokens = [...gameTokens.value];
    gameTokens.value = [];
    selectedTokenId.value = null;

    // 仅清理当前账号下 token 的缓存数据
    await Promise.all(
      currentTokens.map((token) => deleteBinBuffer(token.id, [token.name])),
    );
  };

  // 连接唯一性验证和监控
  const validateConnectionUniqueness = (tokenId: string) => {
    const connections = Object.values(wsConnections.value).filter(
      (conn) =>
        conn.tokenId === tokenId &&
        (conn.status === "connecting" || conn.status === "connected"),
    );

    if (connections.length > 1) {
      wsLogger.warn(
        `检测到重复连接: ${tokenId}, 连接数: ${connections.length}`,
      );
      // 保留最新的连接，关闭旧连接
      const sortedConnections = connections.sort(
        (a, b) => new Date(b.connectedAt || 0) - new Date(a.connectedAt || 0),
      );

      for (let i = 1; i < sortedConnections.length; i++) {
        const oldConnection = sortedConnections[i];
        wsLogger.debug(`关闭重复连接: ${tokenId}`);
        closeWebSocketConnectionAsync(oldConnection.tokenId);
      }

      return false; // 检测到重复连接
    }

    return true; // 连接唯一
  };

  const connectionMonitor = createConnectionMonitor({
    wsConnections,
    connectionLocks,
    activeConnections,
    closeWebSocketConnectionAsync,
    clearCrossTabConnectionState,
    logger: wsLogger,
  });

  // 监听localStorage变化（跨标签页通信）
  const setupCrossTabListener = () => {
    subscribeCrossTabConnectionEvents({
      currentSessionId,
      wsConnections,
      logger: wsLogger,
      onRemoteConnected(tokenId) {
        closeWebSocketConnectionAsync(tokenId);
      },
    });
  };

  // 初始化
  const initTokenStore = () => {
    const userId = getEffectiveUserId();
    if (userId) {
      // 老数据迁移：把未绑定账号的 token/group 归属到当前账号。
      allGameTokens.value = allGameTokens.value.map((token) =>
        token.ownerId ? token : { ...token, ownerId: userId },
      );
      allTokenGroups.value = allTokenGroups.value.map((group) =>
        group.ownerId ? group : { ...group, ownerId: userId },
      );
    }

    // 清理过期token
    cleanExpiredTokens();
    // 启动连接监控
    connectionMonitor.startMonitoring();

    // 设置跨标签页监听
    setupCrossTabListener();
    tokenLogger.info("Token Store 初始化完成，连接监控已启动");

    if (userId && gameTokens.value.length > 0) {
      void syncActivationBindingsFromServer().catch((error: any) => {
        tokenLogger.warn(`激活绑定同步失败: ${error?.message || "unknown"}`);
      });
    }
  };
  const setBattleVersion = (version: number | null) => {
    gameData.value.battleVersion = version;
    gameData.value.lastUpdated = new Date().toISOString();
  };

  const getBattleVersion = () => {
    return gameData.value.battleVersion;
  };
  const {
    cleanExpiredTokens,
    exportTokens,
    importBase64Token,
    importTokens,
    parseBase64Token,
    upgradeTokenToPermanent,
    validateToken,
  } = createTokenDataService({
    gameTokens,
    addToken,
    updateToken,
    removeToken,
  });
  const { getCurrentTowerLevel, getTowerInfo } = createTokenGameDataReader(
    gameData,
    gameLogger,
  );

  const {
    createTokenGroup,
    deleteTokenGroup,
    updateTokenGroup,
    addTokenToGroup,
    removeTokenFromGroup,
    getTokenGroups,
    getGroupTokenIds,
    getValidGroupTokenIds,
    cleanupInvalidTokens,
  } = createTokenGroupService(tokenGroups, gameTokens);

  return {
    // 状态
    gameTokens,
    selectedTokenId,
    wsConnections,
    gameData,

    // 计算属性
    hasTokens,
    hasUsableWorkbenchToken,
    selectedToken,
    selectedTokenRoleInfo,

    // Token管理方法
    addToken,
    updateToken,
    removeToken,
    selectToken,

    // Base64解析方法
    parseBase64Token,
    importBase64Token,

    // WebSocket方法
    createWebSocketConnection,
    closeWebSocketConnection,
    getWebSocketStatus,
    getWebSocketClient,
    sendMessage,
    sendMessageWithPromise,
    setMessageListener,
    setShowMsg,
    sendHeartbeat,
    sendGetRoleInfo,
    sendGetDataBundleVersion,
    sendSignIn,
    sendClaimDailyReward,
    sendGetTeamInfo,
    sendGameMessage,

    // 工具方法
    exportTokens,
    importTokens,
    clearAllTokens,
    cleanExpiredTokens,
    upgradeTokenToPermanent,
    initTokenStore,
    syncActivationBindingsFromServer,
    markBinSourceState,
    isTokenActivationExpired,
    isTokenWorkbenchReady,

    // 游戏内发送消息方法
    sendMessageToLegion,
    sendMessageToWorld,
    getSkippedMessageWarning,
    clearSkippedMessageWarning,

    // 塔信息方法
    getCurrentTowerLevel,
    getTowerInfo,

    // battleVersion
    setBattleVersion,
    getBattleVersion,

    // 调试工具方法
    validateToken,
    debugToken: (tokenString: string) => {
      console.log("🔍 Token调试信息:");
      const parseResult = parseBase64Token(tokenString);
      console.log("解析结果:", sanitizeForLog(parseResult));
      if (parseResult.success) {
        const maskedToken = String(parseResult.data.actualToken || "");
        const safePreview =
          maskedToken.length > 8
            ? `${maskedToken.slice(0, 4)}***${maskedToken.slice(-4)}`
            : "***";
        console.log("实际Token(掩码):", safePreview);
        console.log(
          "Token有效性:",
          validateToken(parseResult.data.actualToken),
        );
      }
      return parseResult;
    },

    // 连接管理增强功能
    validateConnectionUniqueness,
    connectionMonitor,
    currentSessionId: () => currentSessionId,

    // Token分组管理方法
    tokenGroups,
    createTokenGroup,
    deleteTokenGroup,
    updateTokenGroup,
    addTokenToGroup,
    removeTokenFromGroup,
    getTokenGroups,
    getGroupTokenIds,
    getValidGroupTokenIds,
    cleanupInvalidTokens,

    // 开发者工具
    devTools: {
      getConnectionStats: () => connectionMonitor.getStats(),
      forceCleanup: () => connectionMonitor.forceCleanup(),
      showConnectionLocks: () => Object.keys(connectionLocks.value),
      showCrossTabStates: () => Object.keys(activeConnections.value),
      testDuplicateConnection: (tokenId: string) => {
        // 降噪
        const token = gameTokens.value.find((t) => t.id === tokenId);
        if (token) {
          // 故意创建第二个连接进行测试
          createWebSocketConnection(`${tokenId}_test`, token.token);
        }
      },
    },
  };
});
