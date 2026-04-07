import api from "@/api";
import {
  acquireTokenOperationLock,
  releaseTokenOperationLock,
} from "@/services/token/tokenOperationCoordination";
import { resolveServerActivationBindingForToken } from "@/services/token/tokenActivationBindingResolver";

export function useTaskControlRunner({
  appendLog,
  dailySelectableOptions,
  nextRunNow,
  normalizeClubStoreGoodsIds,
  normalizeDailySelectedTasks,
  normalizeSkipLineups,
  persistState,
  refreshNextRunNow,
  resolveDailyRunnerSettingsForToken,
  resolveSmartCarSettingsForToken,
  runFeature,
  runningTaskIds,
  t,
  tokenStore,
}) {
  const resolveTokenIds = (row) => {
    const validAll = tokenStore.gameTokens.map((token) => token.id);
    if (Array.isArray(row.tokenIds) && row.tokenIds.length > 0) {
      return row.tokenIds.filter((id) => validAll.includes(id));
    }
    return validAll;
  };

  const resolveRoleNames = (tokenIds = []) => {
    const nameMap = new Map(
      tokenStore.gameTokens.map((token) => [token.id, token.name || token.id]),
    );
    return tokenIds.map((id) => nameMap.get(id) || id);
  };

  const formatRoleNames = (names = []) => {
    if (!Array.isArray(names) || names.length === 0)
      return t("taskControl.messages.unmatchedRoles");
    if (names.length <= 6)
      return names.join(t("taskControl.delimiter"));
    return t("taskControl.messages.roleListSummary", {
      roles: names.slice(0, 6).join(t("taskControl.delimiter")),
      count: names.length,
    });
  };

  const sleep = (ms) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });

  const getBusySourceText = (lock) => {
    if (!lock) {
      return "其他流程";
    }
    if (lock.source === "lineup-apply") {
      return "阵容应用";
    }
    if (lock.source === "task-control") {
      return "另一个任务控制流程";
    }
    return lock.meta?.label || lock.source || "其他流程";
  };

  const withTaskControlTokenLock = async (row, tokenId, roleName, executor) => {
    const lockResult = acquireTokenOperationLock(tokenId, "task-control", {
      taskId: row.id,
      taskName: row.taskName,
      title: row.title,
      roleName,
      label: `任务控制:${row.title || row.taskName || row.id}`,
    });

    if (!lockResult.ok) {
      appendLog(
        row,
        `账号 ${roleName} 正在执行${getBusySourceText(lockResult.current)}，本次任务已跳过该账号`,
        "warning",
      );
      return false;
    }

    try {
      await executor();
      return true;
    } finally {
      releaseTokenOperationLock(tokenId, lockResult.lock.lockId);
    }
  };

  const resolveTaskItemText = (row) => {
    if (row.id === "club-store" && row.clubStore) {
      const ids = normalizeClubStoreGoodsIds(row.clubStore.goodsIds);
      const modeText = row.clubStore.onlyUnbought !== false
        ? t("taskControl.messages.onlyUnbought")
        : t("taskControl.messages.tryAll");
      return t("taskControl.messages.clubStoreTaskItem", {
        ids: ids.join(","),
        mode: modeText,
      });
    }
    if (row.id === "arena" && row.arenaConfig) {
      const modeText
        = row.arenaConfig.mode === "standalone"
          ? t("taskControl.arenaModes.standalone")
          : t("taskControl.arenaModes.batch");
      const fightCount
        = row.arenaConfig.mode === "standalone"
          ? Math.max(1, Number(row.arenaConfig.fightCount || 10))
          : 3;
      const formation = Math.max(
        1,
        Math.min(6, Number(row.arenaConfig.arenaFormation || 1)),
      );
      const skipText = normalizeSkipLineups(row.arenaConfig.skipLineups).join(
        t("taskControl.delimiter"),
      );
      return t("taskControl.messages.arenaTaskItem", {
        mode: modeText,
        formation,
        count: fightCount,
        skip: skipText,
      });
    }
    return row.title;
  };

  const mapRuntimeLogStatus = (type) => {
    if (type === "success")
      return "success";
    if (type === "error")
      return "error";
    if (type === "warning")
      return "warning";
    return "info";
  };

  const isCarTaskActivityOpen = (date = new Date()) => {
    const day = date.getDay();
    const hour = date.getHours();
    return day >= 1 && day <= 3 && hour >= 6;
  };

  const getTokenActivationBindings = async () => {
    const res = await api.tokenActivation.listMine();
    if (!res?.success) {
      throw new Error(res?.message || t("taskControl.messages.activationCheckFailed"));
    }
    return Array.isArray(res.data) ? res.data : [];
  };

  const resolveActivatedTokenIds = async (tokenIds, tokenRoleIdMap = {}) => {
    const bindings = await getTokenActivationBindings();
    const activatedTokenIds = [];
    const skippedNames = [];
    const nowTs = Date.now();
    const tokenById = new Map(
      tokenStore.gameTokens.map((token) => [String(token.id || ""), token]),
    );

    tokenIds.forEach((tokenId) => {
      const token = tokenById.get(String(tokenId || ""));
      if (!token) {
        return;
      }
      const roleId = String(
        token.activationRoleId || token.activationGameAccountId || token.roleId || "",
      ).trim();
      const fallbackRoleId = String(tokenRoleIdMap?.[token.id] || "").trim();
      const displayName = String(token.name || token.id || roleId || tokenId);
      const tokenForBindingMatch = fallbackRoleId
        ? {
            ...token,
            roleId: roleId || fallbackRoleId,
            activationRoleId:
              String(token.activationRoleId || "").trim() || fallbackRoleId,
            activationGameAccountId:
              String(token.activationGameAccountId || "").trim()
              || fallbackRoleId,
          }
        : token;
      const activation = resolveServerActivationBindingForToken({
        token: tokenForBindingMatch,
        bindings,
        parseBase64Token: tokenStore.parseBase64Token,
      });
      const expiresAt = String(
        activation?.expiresAt || token.activationExpiresAt || "",
      ).trim();
      const expiresTs = new Date(expiresAt).getTime();
      const isActive
        = Boolean(activation?.active)
          && Number.isFinite(expiresTs)
          && expiresTs > nowTs;

      if (!isActive) {
        skippedNames.push(displayName);
        return;
      }

      const resolvedRoleId = String(
        activation?.roleId
        || activation?.gameAccountId
        || fallbackRoleId
        || roleId,
      ).trim();
      if (tokenStore.updateToken) {
        tokenStore.updateToken(token.id, {
          activationSessId:
            activation?.sessId || token.activationSessId || token.sessId || "",
          activationRoleId: resolvedRoleId || roleId,
          activationGameAccountId: resolvedRoleId || roleId,
          activationRoleName:
            activation?.roleName || token.activationRoleName || token.name || "",
          activationRegion:
            activation?.region || token.activationRegion || token.server || "",
          activationExpiresAt: expiresAt || null,
          activationBoundAt:
            activation?.boundAt || token.activationBoundAt || null,
        });
      }
      activatedTokenIds.push(tokenId);
    });

    return {
      activatedTokenIds,
      skippedNames,
    };
  };

  const runTask = async (row, source = "manual") => {
    if (!runFeature) {
      throw new Error(t("taskControl.messages.executorNotReady"));
    }

    if (runningTaskIds.has(row.id))
      return;
    const isCarTask = row.id === "send-car" || row.id === "claim-car";
    if (source === "auto" && isCarTask && !isCarTaskActivityOpen(new Date())) {
      appendLog(row, t("taskControl.messages.carTaskSkipped"), "warning");
      return;
    }

    const originalTokenIds = resolveTokenIds(row);
    if (originalTokenIds.length === 0) {
      appendLog(row, t("taskControl.messages.noExecutableAccounts"), "warning");
      return;
    }
    let tokenIds = [...originalTokenIds];
    try {
      const result = await resolveActivatedTokenIds(
        tokenIds,
        row.tokenRoleIdMap || {},
      );
      tokenIds = result.activatedTokenIds;
      if (result.skippedNames.length > 0) {
        appendLog(
          row,
          t("taskControl.messages.tokenActivationSkipSummary", {
            roles: formatRoleNames(result.skippedNames),
          }),
          "warning",
        );
      }
    } catch (error) {
      appendLog(
        row,
        t("taskControl.messages.activationCheckFailedWithReason", {
          error: error.message || t("taskControl.messages.executionFailed"),
        }),
        "error",
      );
      return;
    }
    if (tokenIds.length === 0) {
      appendLog(row, t("taskControl.messages.noExecutableAccounts"), "warning");
      return;
    }
    const roleNames = resolveRoleNames(tokenIds);
    const roleText = formatRoleNames(roleNames);
    const taskItemText = resolveTaskItemText(row);
    const isArenaTask = row.id === "arena";
    const processLogHandler = (runtimeLog) => {
      if (!runtimeLog?.message)
        return;
      appendLog(
        row,
        t("taskControl.messages.runtimeLog", { message: runtimeLog.message }),
        mapRuntimeLogStatus(runtimeLog.type),
      );
    };

    runningTaskIds.add(row.id);
    appendLog(
      row,
      t("taskControl.messages.taskStarted", {
        source: source === "auto"
          ? t("taskControl.common.auto")
          : t("taskControl.common.manual"),
        item: taskItemText,
        count: tokenIds.length,
        roles: roleText,
      }),
      "info",
    );
    if (isArenaTask) {
      appendLog(
        row,
        t("taskControl.messages.arenaDetails", { item: taskItemText, roles: roleText }),
        "info",
      );
    }

    try {
      if (row.id === "daily") {
        for (const tokenId of tokenIds) {
          const roleName = formatRoleNames(resolveRoleNames([tokenId]));
          await withTaskControlTokenLock(row, tokenId, roleName, async () => {
            appendLog(
              row,
              t("taskControl.messages.dailyFlowPreparing", { role: roleName }),
              "info",
            );
            await sleep(500);
            await runFeature({
              taskName: row.taskName,
              tokenIds: [tokenId],
              taskOptions: {
                dailyRunner: resolveDailyRunnerSettingsForToken(row, tokenId),
              },
              onLog: processLogHandler,
            });

            const extraTasks = normalizeDailySelectedTasks(row.dailySelectedTasks);
            if (extraTasks.length > 0) {
              for (const taskName of extraTasks) {
                const opt = dailySelectableOptions.value.find((item) => item.value === taskName);
                appendLog(
                  row,
                  t("taskControl.messages.extraTaskPreparing", {
                    task: opt?.label || taskName,
                    role: roleName,
                  }),
                  "info",
                );
                await sleep(500);
                await runFeature({
                  taskName,
                  tokenIds: [tokenId],
                  onLog: processLogHandler,
                });
              }
            }
          });
        }
      } else {
        for (const tokenId of tokenIds) {
          const roleName = formatRoleNames(resolveRoleNames([tokenId]));
          await withTaskControlTokenLock(row, tokenId, roleName, async () => {
            if (isArenaTask) {
              appendLog(
                row,
                t("taskControl.messages.arenaRolePreparing", { role: roleName }),
                "info",
              );
            }
            appendLog(
              row,
              t("taskControl.messages.taskPreparing", { role: roleName }),
              "info",
            );
            await sleep(500);
            await runFeature({
              taskName: row.taskName,
              tokenIds: [tokenId],
              batchSettingsOverride:
                row.id === "send-car"
                  ? resolveSmartCarSettingsForToken(row, tokenId)
                  : undefined,
              taskOptions:
                row.id === "arena" && row.arenaConfig
                  ? {
                      arenaMode: row.arenaConfig.mode || "batch",
                      arenaFightCount: Number(row.arenaConfig.fightCount || 10),
                      arenaFormation: Math.max(
                        1,
                        Math.min(6, Number(row.arenaConfig.arenaFormation || 1)),
                      ),
                      arenaSkipLineups: normalizeSkipLineups(
                        row.arenaConfig.skipLineups,
                      ),
                    }
                  : row.id === "club-store" && row.clubStore
                    ? {
                        clubStore: {
                          goodsIds: normalizeClubStoreGoodsIds(row.clubStore.goodsIds),
                          onlyUnbought: row.clubStore.onlyUnbought !== false,
                        },
                      }
                    : undefined,
              onLog: processLogHandler,
            });
          });
        }
      }
      appendLog(
        row,
        t("taskControl.messages.taskFinished", { item: taskItemText, roles: roleText }),
        "success",
      );
    } catch (error) {
      appendLog(
        row,
        t("taskControl.messages.taskFailed", {
          item: taskItemText,
          error: error.message || t("taskControl.messages.executionFailed"),
          roles: roleText,
        }),
        "error",
      );
    } finally {
      runningTaskIds.delete(row.id);
      row.lastRunAt = new Date().toISOString();
      persistState();
      refreshNextRunNow(nextRunNow);
    }
  };

  return {
    runTask,
  };
}
