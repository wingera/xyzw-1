import type { ProtoMsg } from "@/utils/bonProtocol";

interface RefLike<T> {
  value: T;
}

interface HandleGameMessageDeps {
  tokenId: string;
  message: ProtoMsg;
  client: any;
  wsConnections: RefLike<Record<string, any>>;
  gameTokens: RefLike<any[]>;
  gameData: RefLike<any>;
  updateToken: (tokenId: string, updates: Record<string, any>) => boolean;
  syncRandomSeedFromStatistics: (
    tokenId: string,
    rolePayload: any,
    client: any,
  ) => void;
  onMessageSkipped?: (
    tokenId: string,
    info: { message: string; cmd?: string | undefined; timestamp: number },
  ) => void;
  attemptTokenRefresh: (tokenId: string, forceReconnect?: boolean) => Promise<boolean>;
  emitGameEvent: (cmd: string | undefined, payload: Record<string, any>) => void;
  logger: {
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
    gameMessage?: (tokenId: string, cmd: string | undefined, hasBody: boolean) => void;
  };
}

export const handleGameMessageById = async ({
  tokenId,
  message,
  client,
  wsConnections,
  gameTokens,
  gameData,
  updateToken,
  syncRandomSeedFromStatistics,
  onMessageSkipped,
  attemptTokenRefresh,
  emitGameEvent,
  logger,
}: HandleGameMessageDeps) => {
  try {
    if (!message) {
      logger.warn(`消息处理跳过 [${tokenId}]: 无效消息`);
      onMessageSkipped?.(tokenId, {
        message: "无效消息",
        timestamp: Date.now(),
      });
      return;
    }

    if (message.error) {
      const errText = String(message.error).toLowerCase();
      logger.warn(`消息处理跳过 [${tokenId}]:`, message.error);
      onMessageSkipped?.(tokenId, {
        message: String(message.error || ""),
        cmd: message.cmd?.toLowerCase(),
        timestamp: Date.now(),
      });

      if (errText.includes("token") && errText.includes("expired")) {
        const connection = wsConnections.value[tokenId];
        if (connection) {
          connection.status = "error";
          connection.lastError = {
            timestamp: new Date().toISOString(),
            error: "token expired",
          };
        }

        const gameToken = gameTokens.value.find((token) => token.id === tokenId);
        if (gameToken) {
          const refreshed = await attemptTokenRefresh(tokenId);
          if (!refreshed) {
            logger.error(`Token 已过期且无法自动刷新，请重新导入 [${tokenId}]`);
          }
        }
      }
      return;
    }

    const cmd = message.cmd?.toLowerCase();
    const body = message.getData();

    if (cmd === "role_getroleinforesp" || cmd === "role_getroleinfo") {
      syncRandomSeedFromStatistics(tokenId, body, client);

      const roleIdRaw =
        body?.role?.roleId
        ?? body?.role?.roleid
        ?? body?.role?.role_id
        ?? body?.roleId
        ?? body?.roleid
        ?? body?.role_id
        ?? body?.roleInfo?.roleid
        ?? body?.roleInfo?.roleId
        ?? body?.roleInfo?.role_id
        ?? body?.role_info?.roleid
        ?? body?.role_info?.roleId;
      const roleId = String(roleIdRaw || "").trim();
      if (/^\d{6,12}$/.test(roleId)) {
        const currentToken = gameTokens.value.find((item) => item.id === tokenId);
        const currentRoleId = String(currentToken?.roleId || "").trim();
        if (!/^\d{6,12}$/.test(currentRoleId)) {
          updateToken(tokenId, {
            roleId,
            activationRoleId: roleId,
            activationGameAccountId: roleId,
          });
        }
      }

      const roleName = String(
        body?.role?.name
        ?? body?.name
        ?? body?.roleInfo?.name
        ?? body?.role_info?.name
        ?? "",
      ).trim();
      if (roleName) {
        const token = gameTokens.value.find((item) => item.id === tokenId);
        if (token && String(token.name || "").trim() !== roleName) {
          updateToken(tokenId, { name: roleName });
          logger.debug(`更新角色名称 [${tokenId}]: ${roleName}`);
        }
      }

      if (body?.role?.headImg) {
        const token = gameTokens.value.find((item) => item.id === tokenId);
        if (token && token.avatar !== body.role.headImg) {
          updateToken(tokenId, { avatar: body.role.headImg });
          logger.debug(`更新头像 [${tokenId}]: ${body.role.headImg}`);
        }
      }
    }

    emitGameEvent(cmd, {
      tokenId,
      body,
      message,
      client,
      gameData,
    });

    logger.gameMessage?.(tokenId, cmd, !!body);
  } catch (error) {
    logger.error(`处理消息失败 [${tokenId}]:`, error);
  }
};
