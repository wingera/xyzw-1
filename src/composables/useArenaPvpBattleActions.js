const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function useArenaPvpBattleActions({
  tokenStore,
  message,
  t,
  loading,
  running,
  selectedFormation,
  fightCount,
  currentFormation,
  rankList,
  selfArenaInfo,
  selfArenaFallbackInfo,
  lastUpdatedAt,
  arenaTargetProfileCache,
  avatarCandidateIndexMap,
  isConnected,
  isArenaActivityOpen,
  arenaTicketCount,
  extractSelfArenaInfoFromStartArea,
  fetchArenaRankWithFallback,
  normalizeArenaRankList,
  extractSelfArenaInfo,
  enrichRankListLineups,
  selectArenaTargetWithRules,
  updateTargetWinStats,
  syncArenaBattleRecordsFromGame,
  pushBattleLog,
  extractHeadImgFromPayload,
  isUsableHeadImg,
}) {
  const refreshCurrentFormation = async ({ syncSelection = true } = {}) => {
    if (!tokenStore.selectedToken)
      return;

    const tokenId = tokenStore.selectedToken.id;
    const teamInfo = await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_getinfo",
      {},
      6000,
    );
    const useTeamId = Number(teamInfo?.presetTeamInfo?.useTeamId || 0);
    if (Number.isFinite(useTeamId) && useTeamId > 0) {
      currentFormation.value = useTeamId;
      if (syncSelection || !Number(selectedFormation.value)) {
        selectedFormation.value = useTeamId;
      }
    }
  };

  const refreshArenaData = async ({ silent = false } = {}) => {
    if (!tokenStore.selectedToken) {
      if (!silent)
        message.warning(t("arenaPvpCard.messages.selectTokenFirst"));
      return;
    }

    if (!isConnected.value) {
      if (!silent)
        message.warning(t("arenaPvpCard.messages.connectWebSocketFirst"));
      return;
    }

    loading.value = true;
    try {
      const tokenId = tokenStore.selectedToken.id;
      await tokenStore.sendGetRoleInfo(tokenId).catch(() => {});
      await refreshCurrentFormation().catch(() => {});
      const startAreaResult = await tokenStore
        .sendMessageWithPromise(tokenId, "arena_startarea", {}, 6000)
        .catch(() => null);
      const fallbackSelfArenaInfo = extractSelfArenaInfoFromStartArea(startAreaResult || {});
      selfArenaFallbackInfo.value = fallbackSelfArenaInfo;

      const result = await fetchArenaRankWithFallback(tokenId);
      const normalized = normalizeArenaRankList(result || {});

      avatarCandidateIndexMap.value = new Map();
      rankList.value = normalized;
      selfArenaInfo.value = extractSelfArenaInfo(
        result || {},
        normalized,
        fallbackSelfArenaInfo,
      );
      lastUpdatedAt.value = Date.now();

      for (const item of normalized.slice(0, 20)) {
        if (!item?.roleId)
          continue;
        if (!isUsableHeadImg(extractHeadImgFromPayload(item))) {
          const cached = arenaTargetProfileCache.value.get(item.roleId);
          if (cached && !isUsableHeadImg(cached.headImg)) {
            arenaTargetProfileCache.value.delete(item.roleId);
          }
        }
      }

      void enrichRankListLineups(tokenId, normalized);
      await syncArenaBattleRecordsFromGame({ silent: true }).catch(() => {});

      if (!silent)
        message.success(t("arenaPvpCard.messages.refreshSuccess"));
    } catch (error) {
      if (!silent) {
        message.error(
          t("arenaPvpCard.messages.refreshFailed", {
            error: error.message || t("arenaPvpCard.common.unknownError"),
          }),
        );
      }
    } finally {
      loading.value = false;
    }
  };

  const ensureBattlePreconditions = () => {
    if (!tokenStore.selectedToken) {
      message.warning(t("arenaPvpCard.messages.selectTokenFirst"));
      return false;
    }
    if (!isConnected.value) {
      message.warning(t("arenaPvpCard.messages.connectWebSocketFirst"));
      return false;
    }
    if (!isArenaActivityOpen.value) {
      message.warning(t("arenaPvpCard.messages.activityClosed"));
      return false;
    }
    if (arenaTicketCount.value <= 0) {
      message.warning(t("arenaPvpCard.messages.noTickets"));
      return false;
    }
    return true;
  };

  const runArenaBattles = async () => {
    if (!ensureBattlePreconditions())
      return;
    if (running.value)
      return;

    const planned = Math.min(Number(fightCount.value || 0), arenaTicketCount.value);
    if (planned <= 0) {
      message.warning(t("arenaPvpCard.messages.invalidFightCount"));
      return;
    }

    const tokenId = tokenStore.selectedToken.id;
    running.value = true;

    let originalFormation = currentFormation.value;
    let switchedFormation = false;
    let executed = 0;

    try {
      await refreshCurrentFormation({ syncSelection: false });
      originalFormation = currentFormation.value;

      if (
        Number(selectedFormation.value) > 0
        && originalFormation
        && Number(selectedFormation.value) !== Number(originalFormation)
      ) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "presetteam_saveteam",
          { teamId: Number(selectedFormation.value) },
          6000,
        );
        currentFormation.value = Number(selectedFormation.value);
        switchedFormation = true;
        pushBattleLog(
          t("arenaPvpCard.logs.switchFormation", {
            value: selectedFormation.value,
          }),
        );
      }

      for (let i = 0; i < planned; i += 1) {
        if (!isConnected.value)
          break;

        await tokenStore.sendMessageWithPromise(tokenId, "arena_startarea", {}, 6000);
        let targets = await tokenStore.sendMessageWithPromise(
          tokenId,
          "arena_getareatarget",
          {},
          8000,
        );
        let decision = await selectArenaTargetWithRules(tokenId, targets);

        for (const skippedTarget of decision.skipped) {
          pushBattleLog(
            t("arenaPvpCard.logs.skipTarget", {
              index: i + 1,
              name: skippedTarget.name || skippedTarget.id,
              lineupType: skippedTarget.lineupType,
            }),
          );
        }

        if (decision.prioritizedTop.length > 0) {
          const topText = decision.prioritizedTop
            .map((item) => `${item.name}(${item.rate}%,${item.wins}/${item.total})`)
            .join(" | ");
          pushBattleLog(
            t("arenaPvpCard.logs.prioritizedCandidates", {
              index: i + 1,
              topText,
            }),
          );
        }

        if (!decision.target && decision.allLvZhao) {
          targets = await tokenStore.sendMessageWithPromise(
            tokenId,
            "arena_getareatarget",
            { refresh: true },
            8000,
          );
          await syncArenaBattleRecordsFromGame({ silent: true }).catch(() => {});
          decision = await selectArenaTargetWithRules(tokenId, targets);

          for (const skippedTarget of decision.skipped) {
            pushBattleLog(
              t("arenaPvpCard.logs.skipTargetAfterRefresh", {
                index: i + 1,
                name: skippedTarget.name || skippedTarget.id,
                lineupType: skippedTarget.lineupType,
              }),
            );
          }

          if (decision.prioritizedTop.length > 0) {
            const topText = decision.prioritizedTop
              .map((item) => `${item.name}(${item.rate}%,${item.wins}/${item.total})`)
              .join(" | ");
            pushBattleLog(
              t("arenaPvpCard.logs.prioritizedCandidatesAfterRefresh", {
                index: i + 1,
                topText,
              }),
            );
          }
        }

        if (!decision.target) {
          pushBattleLog(t("arenaPvpCard.logs.noAvailableTarget", { index: i + 1 }));
          await sleep(300);
          continue;
        }

        try {
          const fightResult = await tokenStore.sendMessageWithPromise(
            tokenId,
            "fight_startareaarena",
            { targetId: decision.target.id },
            15000,
          );
          const isWin = !!fightResult?.battleData?.result?.isWin;
          updateTargetWinStats(tokenId, decision.target, isWin);
          await sleep(250);
          await syncArenaBattleRecordsFromGame({ silent: true });
          pushBattleLog(
            t("arenaPvpCard.logs.challengeResult", {
              index: i + 1,
              name: decision.target.name || decision.target.id,
              lineupType: decision.target.lineupType || t("arenaPvpCard.common.unknown"),
              result: isWin
                ? t("arenaPvpCard.labels.winResult")
                : t("arenaPvpCard.labels.lossResult"),
            }),
          );
          executed += 1;
        } catch (error) {
          pushBattleLog(
            t("arenaPvpCard.logs.challengeFailed", {
              index: i + 1,
              name: decision.target.name || decision.target.id,
              error: error.message || t("arenaPvpCard.common.unknownError"),
            }),
          );
        }

        await sleep(500);
      }

      await tokenStore.sendGetRoleInfo(tokenId).catch(() => {});
      await refreshArenaData({ silent: true });
      message.success(t("arenaPvpCard.messages.battleCompleted", { count: executed }));
    } catch (error) {
      message.error(
        t("arenaPvpCard.messages.battleFailed", {
          error: error.message || t("arenaPvpCard.common.unknownError"),
        }),
      );
    } finally {
      if (
        switchedFormation
        && Number(originalFormation) > 0
        && Number(originalFormation) !== Number(currentFormation.value)
      ) {
        try {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_saveteam",
            { teamId: Number(originalFormation) },
            6000,
          );
          currentFormation.value = Number(originalFormation);
          selectedFormation.value = Number(originalFormation);
          pushBattleLog(
            t("arenaPvpCard.logs.restoreFormation", {
              value: originalFormation,
            }),
          );
        } catch (error) {
          pushBattleLog(
            t("arenaPvpCard.logs.restoreFormationFailed", {
              error: error.message || t("arenaPvpCard.common.unknownError"),
            }),
          );
        }
      }
      running.value = false;
    }
  };

  return {
    refreshArenaData,
    refreshCurrentFormation,
    runArenaBattles,
  };
}
