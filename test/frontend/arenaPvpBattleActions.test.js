import test from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";

import { useArenaPvpBattleActions } from "../../src/composables/useArenaPvpBattleActions.js";

const createBattleActionDeps = () => {
  const syncCalls = [];
  const messageCalls = [];
  const tokenStore = {
    selectedToken: { id: "token-1" },
    sendGetRoleInfo: async () => {},
    sendMessageWithPromise: async (tokenId, command) => {
      if (command === "presetteam_getinfo") {
        return {
          presetTeamInfo: {
            useTeamId: 2,
          },
        };
      }
      if (command === "arena_startarea") {
        return {
          areaArena: {
            phaseInfo: [],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    },
  };

  const deps = {
    tokenStore,
    message: {
      warning: (text) => messageCalls.push({ type: "warning", text }),
      success: (text) => messageCalls.push({ type: "success", text }),
      error: (text) => messageCalls.push({ type: "error", text }),
    },
    t: (key) => key,
    loading: ref(false),
    running: ref(false),
    selectedFormation: ref(1),
    fightCount: ref(3),
    currentFormation: ref(null),
    rankList: ref([]),
    selfArenaInfo: ref(null),
    selfArenaFallbackInfo: ref(null),
    lastUpdatedAt: ref(null),
    arenaTargetProfileCache: ref(new Map()),
    avatarCandidateIndexMap: ref(new Map()),
    isConnected: ref(true),
    isArenaActivityOpen: ref(true),
    arenaTicketCount: ref(3),
    extractSelfArenaInfoFromStartArea: () => null,
    fetchArenaRankWithFallback: async () => ({ list: [] }),
    normalizeArenaRankList: () => [],
    extractSelfArenaInfo: () => null,
    enrichRankListLineups: async () => {},
    selectArenaTargetWithRules: async () => ({
      target: null,
      skipped: [],
      allLvZhao: false,
      prioritizedTop: [],
    }),
    updateTargetWinStats: () => {},
    syncArenaBattleRecordsFromGame: async (payload) => {
      syncCalls.push(payload);
      return 0;
    },
    pushBattleLog: () => {},
    extractHeadImgFromPayload: () => "",
    isUsableHeadImg: () => false,
  };

  return {
    deps,
    syncCalls,
    messageCalls,
  };
};

test("refreshArenaData syncs arena battle records so refreshed win rates feed targeting", async () => {
  const { deps, syncCalls, messageCalls } = createBattleActionDeps();
  const { refreshArenaData } = useArenaPvpBattleActions(deps);

  await refreshArenaData({ silent: false });

  assert.deepEqual(syncCalls, [{ silent: true }]);
  assert.equal(messageCalls.some((item) => item.type === "success"), true);
});
