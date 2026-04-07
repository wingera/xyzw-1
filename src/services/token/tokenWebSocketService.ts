import type { ProtoMsg } from "@/utils/bonProtocol";
import { g_utils } from "@/utils/bonProtocol";
import { XyzwWebSocketClient } from "@/utils/xyzwWebSocket";
import {
  maskToken,
  sanitizeErrorForDisplay,
  sanitizeWsUrl,
} from "@/utils/securitySanitizer";

interface RefLike<T> {
  value: T;
}

interface CreateWebSocketConnectionDeps {
  tokenId: string;
  base64Token: string;
  customWsUrl?: string | null;
  wsConnections: RefLike<Record<string, any>>;
  currentSessionId: string;
  acquireConnectionLock: (tokenId: string, operation?: string) => Promise<boolean>;
  releaseConnectionLock: (tokenId: string, operation?: string) => void;
  checkCrossTabConnection: (tokenId: string) => any;
  updateCrossTabConnectionState: (tokenId: string, action: string) => void;
  closeExistingConnection: (tokenId: string) => Promise<any>;
  parseBase64Token: (base64String: string) => {
    success: boolean;
    data?: { actualToken: string };
    error?: string;
  };
  validateToken: (token: string) => boolean;
  attemptTokenRefresh: (tokenId: string, forceReconnect?: boolean) => Promise<boolean>;
  onMessage: (tokenId: string, message: ProtoMsg, client: XyzwWebSocketClient) => void;
  clearChatCache: () => void;
  logger: {
    info: (...args: any[]) => void;
    debug: (...args: any[]) => void;
    error: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    verbose?: (...args: any[]) => void;
    wsConnect?: (tokenId: string) => void;
    wsDisconnect?: (tokenId: string, reason: string) => void;
    wsError?: (tokenId: string, error: any) => void;
    wsMessage?: (tokenId: string, cmd: string, incoming: boolean) => void;
  };
}

const resolveActualToken = ({
  base64Token,
  parseBase64Token,
  validateToken,
}: Pick<
  CreateWebSocketConnectionDeps,
  "base64Token" | "parseBase64Token" | "validateToken"
>) => {
  const parseResult = parseBase64Token(base64Token);
  if (parseResult.success && parseResult.data?.actualToken) {
    return parseResult.data.actualToken;
  }

  if (validateToken(base64Token)) {
    return base64Token;
  }

  throw new Error(`Token无效: ${parseResult.error}`);
};

export const createWebSocketConnectionById = async ({
  tokenId,
  base64Token,
  customWsUrl = null,
  wsConnections,
  currentSessionId,
  acquireConnectionLock,
  releaseConnectionLock,
  checkCrossTabConnection,
  updateCrossTabConnectionState,
  closeExistingConnection,
  parseBase64Token,
  validateToken,
  attemptTokenRefresh,
  onMessage,
  clearChatCache,
  logger,
}: CreateWebSocketConnectionDeps) => {
  logger.info(`开始创建连接: ${tokenId}`);

  const lockAcquired = await acquireConnectionLock(tokenId, "connect");
  if (!lockAcquired) {
    logger.error(`无法获取连接锁: ${tokenId}`);
    return null;
  }

  try {
    const crossTabState = checkCrossTabConnection(tokenId);
    if (crossTabState) {
      logger.debug(`跳过创建，其他标签页已有连接: ${tokenId}`);
      releaseConnectionLock(tokenId, "connect");
      return null;
    }

    updateCrossTabConnectionState(tokenId, "connecting");

    if (wsConnections.value[tokenId]) {
      logger.debug(`优雅关闭现有连接: ${tokenId}`);
      await closeExistingConnection(tokenId);
    }

    const actualToken = resolveActualToken({
      base64Token,
      parseBase64Token,
      validateToken,
    });
    const baseWsUrl = `wss://xxz-xyzw.hortorgames.com/agent?p=${encodeURIComponent(actualToken)}&e=x&lang=chinese`;
    const wsUrl = customWsUrl || baseWsUrl;
    const maskedWsUrl = sanitizeWsUrl(wsUrl);
    const wsClient = new XyzwWebSocketClient({
      url: wsUrl,
      utils: g_utils,
      heartbeatMs: 5000,
    });

    wsConnections.value[tokenId] = {
      client: wsClient,
      status: "connecting",
      tokenId,
      wsUrl: maskedWsUrl,
      tokenPreview: maskToken(actualToken, 4, 4),
      sessionId: currentSessionId,
      connectedAt: null,
      lastMessage: null,
      lastError: null,
      reconnectAttempts: 0,
      randomSeedSynced: false,
      lastRandomSeedSource: null,
      lastRandomSeed: null,
    };

    wsClient.onConnect = () => {
      logger.wsConnect?.(tokenId);
      const connection = wsConnections.value[tokenId];
      if (connection) {
        connection.status = "connected";
        connection.connectedAt = new Date().toISOString();
        connection.reconnectAttempts = 0;
        connection.randomSeedSynced = false;
        connection.lastRandomSeedSource = null;
        connection.lastRandomSeed = null;
      }
      updateCrossTabConnectionState(tokenId, "connected");
      releaseConnectionLock(tokenId, "connect");
      clearChatCache();
      void wsClient.debounceSend("role_getroleinfo").catch((error: any) => {
        logger.warn(`初始化角色信息请求失败 [${tokenId}]`, error);
      });
    };

    wsClient.onDisconnect = async (event) => {
      const reason = event.code === 1006 ? "异常断开" : event.reason || "";
      logger.wsDisconnect?.(tokenId, reason);
      const connection = wsConnections.value[tokenId];
      if (connection) {
        connection.status = "disconnected";
        connection.randomSeedSynced = false;

        if (event.code === 1006 && !connection.connectedAt) {
          logger.warn(`检测到握手失败(1006)，尝试刷新Token [${tokenId}]`);
          await attemptTokenRefresh(tokenId, true);
        }
      }
      updateCrossTabConnectionState(tokenId, "disconnected");
    };

    wsClient.onError = (error) => {
      logger.wsError?.(tokenId, error);
      if (wsConnections.value[tokenId]) {
        wsConnections.value[tokenId].status = "error";
        wsConnections.value[tokenId].lastError = {
          timestamp: new Date().toISOString(),
          error: sanitizeErrorForDisplay(error),
          url: maskedWsUrl,
        };
      }
      releaseConnectionLock(tokenId, "connect");
    };

    wsClient.setMessageListener((message: ProtoMsg) => {
      const cmd = message?.cmd || "unknown";
      logger.wsMessage?.(tokenId, cmd, true);

      if (wsConnections.value[tokenId]) {
        wsConnections.value[tokenId].lastMessage = {
          timestamp: new Date().toISOString(),
          data: message,
          cmd: message?.cmd,
        };
        onMessage(tokenId, message, wsClient);
      }
    });

    wsClient.init();

    logger.verbose?.(`WebSocket客户端创建成功: ${tokenId}`);
    return wsClient;
  } catch (error) {
    logger.error(`创建连接失败 [${tokenId}]:`, error);
    updateCrossTabConnectionState(tokenId, "disconnected");
    releaseConnectionLock(tokenId, "connect");
    return null;
  }
};
