import assert from "node:assert/strict";
import test from "node:test";
import {
  formatExecutionErrorMessage,
  getHourlyIntervalFromCron,
  isIntervalDueNow,
  sanitizeTaskControlLogMessage,
} from "../src/services/taskControlScheduler/taskControlSchedulerHelpers.js";
import {
  findDueCronMinuteKey,
  formatQuietWindowReason,
  getQuietWindowReason,
} from "../src/services/taskControlScheduler/schedulerTiming.js";
import {
  appendTaskControlSystemLog,
} from "../src/services/taskControlScheduler/systemLog.js";
import {
  createTokenExecutionQueue,
} from "../src/services/taskControlScheduler/tokenExecutionQueue.js";

test("getHourlyIntervalFromCron only accepts supported hourly interval expressions", () => {
  assert.equal(getHourlyIntervalFromCron("0 */6 * * *"), 6);
  assert.equal(getHourlyIntervalFromCron("15 */6 * * *"), null);
  assert.equal(getHourlyIntervalFromCron("0 6 * * *"), null);
});

test("isIntervalDueNow checks lastRunAt against parsed interval hours", () => {
  const nowTs = Date.parse("2026-04-13T12:00:00.000Z");
  assert.equal(
    isIntervalDueNow(
      {
        cronExpr: "0 */4 * * *",
        lastRunAt: "2026-04-13T07:30:00.000Z",
      },
      nowTs,
    ),
    true,
  );
  assert.equal(
    isIntervalDueNow(
      {
        cronExpr: "0 */4 * * *",
        lastRunAt: "2026-04-13T09:30:00.000Z",
      },
      nowTs,
    ),
    false,
  );
});

test("scheduler helper redacts sensitive tokens and retryable network errors", () => {
  assert.match(
    sanitizeTaskControlLogMessage(
      "url=https://x.example.com?a=1&token=secret Bearer abc123?p=payload",
    ),
    /\*\*\*/,
  );
  assert.equal(
    formatExecutionErrorMessage({ code: "ECONNRESET", message: "socket hang up" }),
    "网络连接异常（TLS/链路中断，ECONNRESET），请稍后重试",
  );
});

test("scheduler timing seam catches up only the recent cron due minute", () => {
  assert.equal(
    findDueCronMinuteKey(
      { cronExpr: "7 * * * *" },
      new Date(2026, 3, 22, 12, 10, 30).getTime(),
      new Date(2026, 3, 22, 12, 0, 0).getTime(),
    ),
    "202604221207",
  );

  assert.equal(
    findDueCronMinuteKey(
      { cronExpr: "4 * * * *" },
      new Date(2026, 3, 22, 12, 10, 30).getTime(),
      new Date(2026, 3, 22, 12, 0, 0).getTime(),
    ),
    "",
  );
});

test("scheduler timing seam keeps quiet-window reasons stable", () => {
  assert.equal(
    getQuietWindowReason(new Date(2026, 3, 24, 4, 50), false),
    "friday_0450_0700",
  );
  assert.equal(
    formatQuietWindowReason("friday_0450_0700"),
    "周五 04:50-07:00 禁跑窗口",
  );
  assert.equal(
    getQuietWindowReason(new Date(2026, 3, 22, 12, 0), false),
    "",
  );
  assert.equal(
    getQuietWindowReason(new Date(2026, 3, 25, 20, 0), true),
    "user_quiet_window",
  );
});

test("system log seam prefixes and sanitizes backend task-control logs", () => {
  const writes = [];
  appendTaskControlSystemLog(
    {
      userId: "user-1",
      taskId: "daily",
      taskName: "日常任务",
      status: "info",
      message: "token=secret https://x.example.com?a=1&token=secret",
    },
    {
      createLog: (row) => writes.push(row),
      randomId: () => "tc_log_test",
      nowIso: () => "2026-04-22T12:00:00.000Z",
    },
  );

  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, "tc_log_test");
  assert.equal(writes[0].message.startsWith("[backend] "), true);
  assert.doesNotMatch(writes[0].message, /secret/);
  assert.match(writes[0].message, /\*\*\*/);
});

test("token execution queue seam runs jobs serially and enforces max length", async () => {
  const queue = createTokenExecutionQueue({ maxLength: 2 });
  const events = [];

  const first = queue.enqueue({
    onQueued: (ahead) => events.push(`first:queued:${ahead}`),
    onStarted: (ahead) => events.push(`first:started:${ahead}`),
    job: async () => {
      events.push("first:job:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first:job:end");
      return "first-result";
    },
  });

  const second = queue.enqueue({
    onQueued: (ahead) => events.push(`second:queued:${ahead}`),
    onStarted: (ahead) => events.push(`second:started:${ahead}`),
    job: async () => {
      events.push("second:job");
      return "second-result";
    },
  });

  await assert.rejects(
    async () =>
      queue.enqueue({
        job: async () => "third-result",
      }),
    /执行队列已满/,
  );

  assert.equal(await first, "first-result");
  assert.equal(await second, "second-result");
  assert.deepEqual(events, [
    "first:queued:0",
    "second:queued:1",
    "first:started:0",
    "first:job:start",
    "first:job:end",
    "second:started:1",
    "second:job",
  ]);
});
