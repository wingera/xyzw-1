import type { EVM, XyzwSession } from ".";
import { getTokenOperationLock } from "@/services/token/tokenOperationCoordination";

const refreshRoleInfoSafely = (data: XyzwSession) => {
  const { client, tokenId } = data;
  const currentLock = getTokenOperationLock(tokenId);
  if (currentLock) {
    return;
  }
  client?.debounceSend("role_getroleinfo", {}).catch(() => {});
};

export const ClockPlugin = ({ onSome, $emit }: EVM) => {
  onSome(
    ["system_claimhangupreward", "system_claimhanguprewardresp"],
    async (data: XyzwSession) => {
      refreshRoleInfoSafely(data);
    },
  );

  onSome(["syncresp", "system_mysharecallback"], async (data: XyzwSession) => {
    refreshRoleInfoSafely(data);
  });
};
