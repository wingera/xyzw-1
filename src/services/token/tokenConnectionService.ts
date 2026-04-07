interface LoggerLike {
  debug: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  wsMessage?: (tokenId: string, cmd: string, incoming: boolean) => void;
}

const DEBOUNCED_READ_COMMANDS = new Set([
  "role_getroleinfo",
  "tower_getinfo",
  "evotower_getinfo",
  "presetteam_getinfo",
  "legion_getinfo",
]);

const waitForDisconnect = async (client: any) => {
  await new Promise((resolve) => {
    const checkDisconnected = () => {
      if (!client?.connected) {
        resolve(undefined);
      } else {
        setTimeout(checkDisconnected, 100);
      }
    };
    setTimeout(resolve, 5000);
    checkDisconnected();
  });
};

export const getWebSocketStatusById = (wsConnections: Record<string, any>, tokenId: string) => {
  return wsConnections[tokenId]?.status || "disconnected";
};

export const getWebSocketClientById = (wsConnections: Record<string, any>, tokenId: string) => {
  return wsConnections[tokenId]?.client || null;
};

export const closeWebSocketConnectionAsyncById = async ({
  tokenId,
  wsConnections,
  acquireConnectionLock,
  releaseConnectionLock,
  updateCrossTabConnectionState,
  logger,
}: {
  tokenId: string;
  wsConnections: { value: Record<string, any> };
  acquireConnectionLock: (tokenId: string, operation?: string) => Promise<boolean>;
  releaseConnectionLock: (tokenId: string, operation?: string) => void;
  updateCrossTabConnectionState: (tokenId: string, action: string) => void;
  logger: LoggerLike;
}) => {
  const lockAcquired = await acquireConnectionLock(tokenId, "disconnect");
  if (!lockAcquired) {
    logger.warn(`无法获取断开连接锁: ${tokenId}`);
    return;
  }

  try {
    const connection = wsConnections.value[tokenId];
    if (connection?.client) {
      logger.debug(`开始优雅关闭连接: ${tokenId}`);
      connection.status = "disconnecting";
      updateCrossTabConnectionState(tokenId, "disconnecting");
      connection.client.disconnect();
      await waitForDisconnect(connection.client);
      delete wsConnections.value[tokenId];
      updateCrossTabConnectionState(tokenId, "disconnected");
      logger.info(`连接已优雅关闭: ${tokenId}`);
    }
  } catch (error) {
    logger.error(`关闭连接失败 [${tokenId}]:`, error);
  } finally {
    releaseConnectionLock(tokenId, "disconnect");
  }
};

export const sendMessageById = ({
  tokenId,
  cmd,
  params = {},
  options = {},
  wsConnections,
  logger,
}: {
  tokenId: string;
  cmd: string;
  params?: Record<string, any>;
  options?: Record<string, any>;
  wsConnections: Record<string, any>;
  logger: LoggerLike;
}) => {
  const connection = wsConnections[tokenId];
  if (!connection || connection.status !== "connected") {
    logger.error(`WebSocket未连接，无法发送消息 [${tokenId}]`);
    return false;
  }

  try {
    const client = connection.client;
    if (!client) {
      logger.error(`WebSocket客户端不存在 [${tokenId}]`);
      return false;
    }

    if (
      DEBOUNCED_READ_COMMANDS.has(String(cmd || "").toLowerCase())
      && typeof client.debounceSend === "function"
    ) {
      void client.debounceSend(cmd, params).catch((error: any) => {
        logger.error(`发送失败 [${tokenId}] ${cmd}:`, error?.message || error);
      });
      logger.wsMessage?.(tokenId, cmd, false);
      return true;
    }

    client.send(cmd, params, options);
    logger.wsMessage?.(tokenId, cmd, false);
    return true;
  } catch (error: any) {
    logger.error(`发送失败 [${tokenId}] ${cmd}:`, error?.message || error);
    return false;
  }
};

export const sendMessageWithPromiseById = async ({
  tokenId,
  cmd,
  params = {},
  timeout = 5000,
  wsConnections,
}: {
  tokenId: string;
  cmd: string;
  params?: Record<string, any>;
  timeout?: number;
  wsConnections: Record<string, any>;
}) => {
  const connection = wsConnections[tokenId];
  if (!connection || connection.status !== "connected") {
    throw new Error(`WebSocket未连接 [${tokenId}]`);
  }

  const client = connection.client;
  if (!client) {
    throw new Error(`WebSocket客户端不存在 [${tokenId}]`);
  }

  if (
    DEBOUNCED_READ_COMMANDS.has(String(cmd || "").toLowerCase())
    && typeof client.debounceSend === "function"
  ) {
    return client.debounceSend(cmd, params, timeout);
  }

  return client.sendWithPromise(cmd, params, timeout);
};
