import test from "node:test";
import assert from "node:assert/strict";

import { persistQuietWindowSetting } from "../../src/composables/taskControlQuietWindowPersistence.js";

test("persistQuietWindowSetting writes remote first and then updates local cache", async () => {
  const calls = [];

  const payload = await persistQuietWindowSetting({
    enabled: true,
    saveRemote: async (value) => {
      calls.push({ type: "remote", value });
    },
    saveLocal: (value) => {
      calls.push({ type: "local", value });
    },
  });

  assert.deepEqual(payload, { enabled: true });
  assert.deepEqual(calls, [
    { type: "remote", value: { enabled: true } },
    { type: "local", value: { enabled: true } },
  ]);
});

test("persistQuietWindowSetting does not update local cache when remote save fails", async () => {
  const calls = [];

  await assert.rejects(
    persistQuietWindowSetting({
      enabled: true,
      saveRemote: async () => {
        calls.push({ type: "remote" });
        throw new Error("network down");
      },
      saveLocal: () => {
        calls.push({ type: "local" });
      },
    }),
    /network down/,
  );

  assert.deepEqual(calls, [{ type: "remote" }]);
});
