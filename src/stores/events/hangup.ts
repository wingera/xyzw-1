import { gameLogger } from "@/utils/logger";
import type { EVM, XyzwSession } from ".";

// 处理加钟/时钟相关事件，触发获取角色信息以更新状态
export const HangupPlugin = ({
  onSome,
  $emit,
}: EVM) => {
  onSome(["system_claimhangupreward", "system_claimhanguprewardresp"], async (data: XyzwSession) => {
    gameLogger.verbose(`收到加钟/时钟信息事件: ${data.tokenId}`, data);
  });

  onSome(["syncresp", "system_mysharecallback"], async (data: XyzwSession) => {
    gameLogger.verbose(`收到加钟/时钟信息事件: ${data.tokenId}`, data);
  });
};
