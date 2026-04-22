import {
  CRON_CATCHUP_MAX_MINUTES,
  minuteKey,
} from "./taskControlSchedulerHelpers.js";
import { matchesCronExpression as matchesCronExpressionShared } from "../../../../shared/batch/cronUtils.js";

const matchesCronExpression = (cronExpr, now = new Date()) => {
  try {
    return matchesCronExpressionShared(cronExpr, now);
  } catch {
    return false;
  }
};

export const findDueCronMinuteKey = (row, nowTs, previousTickTs) => {
  const fallbackStart = nowTs - 60 * 1000;
  const safePreviousTs =
    Number.isFinite(previousTickTs) && previousTickTs > 0 ? previousTickTs : fallbackStart;
  const lookbackStartTs = Math.max(
    nowTs - CRON_CATCHUP_MAX_MINUTES * 60 * 1000,
    safePreviousTs,
  );
  const probe = new Date(lookbackStartTs);
  probe.setSeconds(0, 0);
  const end = new Date(nowTs);
  end.setSeconds(0, 0);
  let dueMinute = "";
  while (probe.getTime() <= end.getTime()) {
    if (matchesCronExpression(row.cronExpr, probe)) {
      const key = minuteKey(probe);
      if (key !== row.lastAutoMinuteKey) {
        dueMinute = key;
      }
    }
    probe.setMinutes(probe.getMinutes() + 1);
  }
  return dueMinute;
};

const getMinutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();

const isInUserQuietWindow = (date = new Date()) => {
  const day = date.getDay();
  const minute = getMinutesOfDay(date);
  if (day === 6) return minute >= 19 * 60 + 50 && minute < 21 * 60 + 10;
  if (day === 0) return minute >= 19 * 60 + 50 && minute < 20 * 60 + 40;
  return false;
};

const isInFridayNoRunWindow = (date = new Date()) => {
  const day = date.getDay();
  const minute = getMinutesOfDay(date);
  return day === 5 && minute >= 4 * 60 + 50 && minute < 7 * 60;
};

export const getQuietWindowReason = (date = new Date(), userQuietEnabled = false) => {
  if (isInFridayNoRunWindow(date)) return "friday_0450_0700";
  if (userQuietEnabled && isInUserQuietWindow(date)) return "user_quiet_window";
  return "";
};

export const formatQuietWindowReason = (reason) => {
  if (reason === "friday_0450_0700") return "周五 04:50-07:00 禁跑窗口";
  if (reason === "user_quiet_window") return "静默时段";
  return "静默时段";
};
