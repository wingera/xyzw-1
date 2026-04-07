import { ref } from "vue";

import { buildLegionWarWsUrl } from "@/services/legionWar/legionWarWsUrl";
import { getCurrentTimeByFormat } from "@/utils/DateTimeUtils";
import { XyzwLegionWarWebSocketClient } from "@/utils/xyzwLegionWarWebSocket";

export function useLegionWarActions({
  message,
  router,
  tokenStore,
  onBattlefieldData,
}) {
  const hint = ref(null);
  const isEntireBattlefield = ref(false);
  const currentDateTime = ref(getCurrentTimeByFormat("yyyy-MM-dd HH:mm:ss"));
  const legionWarWebSocket = ref(null);

  const sendMessageToLegion = async (validData) => {
    const legionInfoList = Object.values(validData?.legionInfo || {});
    if (!legionInfoList.length || !tokenStore.selectedToken) {
      return;
    }

    const messageList = [];
    for (let i = 0; i < 2; i++) {
      let content = "";
      for (let j = 0; j < 10; j++) {
        const element = legionInfoList[j + i * 10];
        if (!element) {
          continue;
        }
        if (content) {
          content += "\n";
        }
        content += `${element.name}:剩${150 - element.reviveCount}`;
      }
      if (content) {
        messageList.push(content);
      }
    }

    const tokenId = tokenStore.selectedToken.id;
    const sendInterval = 1500;
    for (const content of messageList) {
      await new Promise((resolve) => setTimeout(resolve, sendInterval));
      try {
        await tokenStore.sendMessageToLegion(tokenId, content);
      } catch (error) {
        if (String(error?.message || "").includes("频繁")) {
          await new Promise((resolve) => setTimeout(resolve, sendInterval * 2));
          await tokenStore.sendMessageToLegion(tokenId, content);
        }
      }
    }
  };

  const setupBattlefieldSocket = async (battlefieldResp) => {
    if (!tokenStore.selectedToken) {
      return;
    }

    const tokenId = tokenStore.selectedToken.id;
    const status = tokenStore.getWebSocketStatus(tokenId);
    if (status !== "connected") {
      connectWebSocket();
      return;
    }

    const battleFieldId = battlefieldResp?.info?.battlefieldId;
    const sid = battlefieldResp?.info?.sid;
    let wsUrl;
    try {
      ({ wsUrl } = buildLegionWarWsUrl({
        tokenString: tokenStore.selectedToken.token,
        sid,
        parseBase64Token: tokenStore.parseBase64Token,
        validateToken: tokenStore.validateToken,
      }));
    } catch (error) {
      console.error("构建 LegionWar WebSocket URL 失败:", error);
      message.error(String(error?.message || "战场连接参数无效"));
      return;
    }

    hint.value = battleFieldId;
    legionWarWebSocket.value = new XyzwLegionWarWebSocketClient({
      url: wsUrl,
      utils: null,
      hint: hint.value,
      heartbeatMs: 5000,
    });

    legionWarWebSocket.value.onConnect = async () => {
      try {
        setTimeout(() => {
          isEntireBattlefield.value = true;
          legionWarWebSocket.value?.send("war_enterbattlefield", {
            battlefieldId: hint.value,
            useGzip: true,
          });
        }, 5000);
      } catch (error) {
        console.error(`初始请求盐场信息失败 [${tokenId}]`, error);
      }
    };

    legionWarWebSocket.value.setMessageListener((socketMessage) => {
      const cmd = socketMessage?.cmd || "unknown";
      if (cmd.includes("war_getbattlefieldinfo")) {
        onBattlefieldData(socketMessage?.rawData);
      }
    });

    legionWarWebSocket.value.onDisconnect = (event) => {
      console.log(event);
    };

    legionWarWebSocket.value.onError = (error) => {
      console.log(error);
    };

    legionWarWebSocket.value.init();
  };

  const connectWebSocket = () => {
    if (!tokenStore.selectedToken) {
      message.warning("请先选择一个Token");
      router.push("/tokens");
      return;
    }

    try {
      const tokenId = tokenStore.selectedToken.id;
      tokenStore.createWebSocketConnection(tokenId, tokenStore.selectedToken.token);
      message.info("正在建立 WebSocket 连接...");

      setTimeout(async () => {
        const status = tokenStore.getWebSocketStatus(tokenId);
        if (status === "connected") {
          message.success("WebSocket 连接成功");
          const battlefieldResp = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_getbattlefield",
            {},
            10000,
          );
          setupBattlefieldSocket(battlefieldResp);
        }
      }, 2000);
    } catch (error) {
      console.error("WebSocket连接失败:", error);
      message.error("WebSocket连接失败");
    }
  };

  const getBattlefieldInfo = async () => {
    if (!isEntireBattlefield.value) {
      message.error("暂未进入战场,请稍后");
      return;
    }

    legionWarWebSocket.value?.send("war_getbattlefieldinfo", {
      battlefieldId: hint.value,
    });
    currentDateTime.value = getCurrentTimeByFormat("");
  };

  return {
    connectWebSocket,
    currentDateTime,
    getBattlefieldInfo,
    hint,
    isEntireBattlefield,
    legionWarWebSocket,
    sendMessageToLegion,
    setupBattlefieldSocket,
  };
}
