/* eslint-disable test/no-import-node-test */
import test from "node:test";
import assert from "node:assert/strict";
import jiti from "jiti";

const loadModule = jiti(import.meta.url, { interopDefault: true });
const {
  sendMessageById,
  sendMessageWithPromiseById,
} = loadModule("../../src/services/token/tokenConnectionService.ts");

const createLogger = () => ({
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
  wsMessage: () => {},
});

test("sendMessageById coalesces debounced read commands through debounceSend", async () => {
  const calls = [];
  const client = {
    debounceSend: (...args) => {
      calls.push(args);
      return Promise.resolve({ ok: true });
    },
    send: () => {
      throw new Error("send should not be called for debounced read commands");
    },
  };

  const result = sendMessageById({
    tokenId: "token-1",
    cmd: "role_getroleinfo",
    params: { force: true },
    wsConnections: {
      "token-1": {
        status: "connected",
        client,
      },
    },
    logger: createLogger(),
  });

  await Promise.resolve();

  assert.equal(result, true);
  assert.deepEqual(calls, [["role_getroleinfo", { force: true }]]);
});

test("sendMessageWithPromiseById keeps other commands on the original promise send path", async () => {
  const calls = [];
  const expected = { ok: true };
  const client = {
    debounceSend: () => {
      throw new Error("debounceSend should not be called for non-debounced commands");
    },
    sendWithPromise: async (...args) => {
      calls.push(args);
      return expected;
    },
  };

  const result = await sendMessageWithPromiseById({
    tokenId: "token-1",
    cmd: "fight_starttower",
    params: { floor: 3 },
    timeout: 9000,
    wsConnections: {
      "token-1": {
        status: "connected",
        client,
      },
    },
  });

  assert.equal(result, expected);
  assert.deepEqual(calls, [["fight_starttower", { floor: 3 }, 9000]]);
});
