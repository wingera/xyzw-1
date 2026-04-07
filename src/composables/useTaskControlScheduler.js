import api from "@/api";
import { ref } from "vue";
import {
  getJsonPreference,
  setJsonPreference,
} from "@/services/preferences/localPreferences";
import { persistQuietWindowSetting } from "@/composables/taskControlQuietWindowPersistence";

const QUIET_WINDOW_PREF_KEY = "task_control_quiet_windows_v1";

export function useTaskControlScheduler({
  appendLog,
  findDueCronMinuteKey,
  getHourlyIntervalFromCron,
  isIntervalDueNow,
  minuteKey,
  nextRunNow,
  persistState,
  quietWindowsEnabled = ref(false),
  refreshNextRunNow,
  runTask,
  runningTaskIds,
  t,
  taskRows,
  tokenStore,
  validateCronExpression,
}) {
  const quietWindowSkipMinuteKey = ref("");

  let schedulerTimer = null;
  let lastSchedulerTickAt = Date.now();
  let schedulerTickInProgress = false;

  const getMinutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();

  const isInQuietWindow = (date = new Date()) => {
    const day = date.getDay();
    const minute = getMinutesOfDay(date);
    if (day === 6)
      return minute >= 19 * 60 + 50 && minute < 21 * 60 + 10;
    if (day === 0)
      return minute >= 19 * 60 + 50 && minute < 20 * 60 + 40;
    return false;
  };

  const getQuietWindowText = (date = new Date()) => {
    const day = date.getDay();
    if (day === 6)
      return t("taskControl.quietWindow.saturday");
    if (day === 0)
      return t("taskControl.quietWindow.sunday");
    return "";
  };

  const enforceOfflineForQuietWindow = () => {
    let closed = 0;
    for (const token of tokenStore.gameTokens || []) {
      const tokenId = token?.id;
      if (!tokenId)
        continue;
      const status = tokenStore.getWebSocketStatus(tokenId);
      if (
        status === "connected"
        || status === "connecting"
        || status === "disconnecting"
        || status === "error"
      ) {
        tokenStore.closeWebSocketConnection(tokenId);
        closed += 1;
      }
    }
    return closed;
  };

  const loadQuietWindowSetting = async () => {
    let loaded = false;
    try {
      const resp = await api.user.getPreference(QUIET_WINDOW_PREF_KEY);
      const value = resp?.data?.value;
      if (typeof value?.enabled === "boolean") {
        quietWindowsEnabled.value = value.enabled;
        loaded = true;
      } else if (typeof value === "boolean") {
        quietWindowsEnabled.value = value;
        loaded = true;
      }
    } catch {}
    if (loaded)
      return;
    try {
      const local = getJsonPreference(QUIET_WINDOW_PREF_KEY, null);
      if (typeof local?.enabled === "boolean") {
        quietWindowsEnabled.value = local.enabled;
      }
    } catch {}
  };

  const saveQuietWindowSetting = async (enabled) => {
    await persistQuietWindowSetting({
      enabled,
      saveRemote: (payload) => api.user.setPreference(QUIET_WINDOW_PREF_KEY, payload),
      saveLocal: (payload) => setJsonPreference(QUIET_WINDOW_PREF_KEY, payload),
    });
  };

  const setQuietWindowsEnabled = async (value) => {
    const previousValue = !!quietWindowsEnabled.value;
    const nextValue = !!value;
    quietWindowsEnabled.value = nextValue;
    try {
      await saveQuietWindowSetting(nextValue);
    } catch (error) {
      quietWindowsEnabled.value = previousValue;
      appendLog(
        { title: t("taskControl.common.system") },
        t("taskControl.messages.quietWindowSaveFailed", {
          error: error?.message || t("taskControl.messages.executionFailed"),
        }),
        "warning",
      );
      return;
    }
    if (quietWindowsEnabled.value && isInQuietWindow(new Date())) {
      const closed = enforceOfflineForQuietWindow();
      appendLog(
        { title: t("taskControl.common.system") },
        t("taskControl.messages.quietWindowEnabledNow", {
          time: getQuietWindowText(new Date()),
          count: closed,
        }),
        "info",
      );
    } else {
      appendLog(
        { title: t("taskControl.common.system") },
        quietWindowsEnabled.value
          ? t("taskControl.messages.quietWindowEnabled")
          : t("taskControl.messages.quietWindowDisabled"),
        "info",
      );
    }
    refreshNextRunNow(nextRunNow);
  };

  const schedulerTick = async () => {
    if (schedulerTickInProgress)
      return;
    schedulerTickInProgress = true;
    const now = new Date();
    const currentMinute = minuteKey(now);
    const nowTs = now.getTime();
    const previousTickAt = lastSchedulerTickAt;
    lastSchedulerTickAt = nowTs;
    try {
      let deferredChanged = false;
      const previousTickDate = new Date(previousTickAt);
      const previousMinuteKey = minuteKey(previousTickDate);
      if (quietWindowsEnabled.value && isInQuietWindow(now)) {
        const closed = enforceOfflineForQuietWindow();
        for (const row of taskRows.value) {
          if (!row.enabled || runningTaskIds.has(row.id))
            continue;
          const valid = validateCronExpression(row.cronExpr);
          if (!valid.valid)
            continue;
          const hasRollingInterval = !!getHourlyIntervalFromCron(row?.cronExpr) && !!row?.lastRunAt;
          const shouldRunByInterval = hasRollingInterval
            ? isIntervalDueNow(row, nowTs)
            : false;
          const dueCronMinuteKey = hasRollingInterval
            ? ""
            : findDueCronMinuteKey(row, nowTs, previousTickAt);
          const shouldRunByCron = !hasRollingInterval && !!dueCronMinuteKey;
          if (!shouldRunByInterval && !shouldRunByCron)
            continue;
          if (!row.quietDeferredAt) {
            row.quietDeferredAt = new Date().toISOString();
            deferredChanged = true;
          }
        }
        if (deferredChanged)
          await persistState();
        if (quietWindowSkipMinuteKey.value !== currentMinute) {
          quietWindowSkipMinuteKey.value = currentMinute;
          appendLog(
            { title: t("taskControl.common.system") },
            t("taskControl.messages.quietWindowActive", {
              time: getQuietWindowText(now),
              count: closed,
            }),
            "info",
          );
        }
        return;
      }
      quietWindowSkipMinuteKey.value = "";

      for (const row of taskRows.value) {
        if (!row.enabled || runningTaskIds.has(row.id))
          continue;

        if (row.quietDeferredAt) {
          const deferredAt = new Date(row.quietDeferredAt);
          const fallbackMinuteKey = Number.isNaN(deferredAt.getTime())
            ? previousMinuteKey
            : minuteKey(deferredAt);
          const triggerMinuteKey = `${fallbackMinuteKey}:quiet_deferred`;
          if (row.lastAutoMinuteKey === triggerMinuteKey)
            continue;
          row.lastAutoMinuteKey = triggerMinuteKey;
          row.quietDeferredAt = "";
          await persistState();
          await runTask(row, "auto");
          refreshNextRunNow(nextRunNow);
          continue;
        }

        const valid = validateCronExpression(row.cronExpr);
        if (!valid.valid)
          continue;

        const hasRollingInterval = !!getHourlyIntervalFromCron(row?.cronExpr) && !!row?.lastRunAt;
        const shouldRunByInterval = hasRollingInterval
          ? isIntervalDueNow(row, nowTs)
          : false;
        const dueCronMinuteKey = hasRollingInterval
          ? ""
          : findDueCronMinuteKey(row, nowTs, previousTickAt);
        const shouldRunByCron = !hasRollingInterval && !!dueCronMinuteKey;
        if (!shouldRunByInterval && !shouldRunByCron)
          continue;
        const triggerMinuteKey = shouldRunByCron ? dueCronMinuteKey : currentMinute;
        if (row.lastAutoMinuteKey === triggerMinuteKey)
          continue;

        row.lastAutoMinuteKey = triggerMinuteKey;
        await persistState();
        await runTask(row, "auto");
        refreshNextRunNow(nextRunNow);
      }
    } finally {
      schedulerTickInProgress = false;
    }
  };

  const startScheduler = () => {
    if (schedulerTimer)
      window.clearInterval(schedulerTimer);
    schedulerTick();
    schedulerTimer = window.setInterval(() => {
      schedulerTick();
    }, 15000);
  };

  const stopScheduler = () => {
    if (!schedulerTimer)
      return;
    window.clearInterval(schedulerTimer);
    schedulerTimer = null;
  };

  const setTaskEnabled = (id, enabled) => {
    const row = taskRows.value.find((item) => item.id === id);
    if (!row)
      return;
    row.enabled = enabled;
    persistState();
    refreshNextRunNow(nextRunNow);
    appendLog(
      row,
      enabled
        ? t("taskControl.messages.autoExecutionEnabled")
        : t("taskControl.messages.autoExecutionDisabled"),
      "info",
    );
  };

  return {
    loadQuietWindowSetting,
    quietWindowsEnabled,
    setQuietWindowsEnabled,
    setTaskEnabled,
    startScheduler,
    stopScheduler,
  };
}
