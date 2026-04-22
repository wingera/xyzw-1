import { randomId, nowIso } from "../../db/sql.js";
import { taskControlRepository } from "../../repositories/taskControlRepository.js";
import { sanitizeTaskControlLogMessage } from "./taskControlSchedulerHelpers.js";

export const appendTaskControlSystemLog = (
  { userId, taskId, taskName, status, message },
  {
    createLog = taskControlRepository.createLog,
    randomId: createId = randomId,
    nowIso: getNowIso = nowIso,
  } = {},
) => {
  const normalized = sanitizeTaskControlLogMessage(message).trim();
  const taggedMessage = normalized.startsWith("[backend]")
    ? normalized
    : `[backend] ${normalized}`;
  createLog({
    id: createId("tc_log"),
    userId,
    taskId: taskId || null,
    taskName: String(taskName || "任务控制").slice(0, 64),
    status: status || "info",
    message: taggedMessage.slice(0, 2000),
    createdAt: getNowIso(),
  });
};
