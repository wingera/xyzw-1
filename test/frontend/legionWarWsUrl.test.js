import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLegionWarWsUrl,
  resolveLegionWarActualToken,
} from "../../src/services/legionWar/legionWarWsUrl.js";

test("resolveLegionWarActualToken falls back to raw token when validateToken passes", () => {
  const actualToken = resolveLegionWarActualToken({
    tokenString: "plain-token-123",
    parseBase64Token: () => ({ success: false, error: "bad" }),
    validateToken: () => true,
  });

  assert.equal(actualToken, "plain-token-123");
});

test("buildLegionWarWsUrl keeps LegionWar query shape for raw tokens", () => {
  const result = buildLegionWarWsUrl({
    tokenString: "plain-token-123",
    sid: "sid-abc",
    parseBase64Token: () => ({ success: false, error: "bad" }),
    validateToken: () => true,
  });

  assert.equal(result.actualToken, "plain-token-123");
  assert.equal(result.wsUrl.includes("p=plain-token-123"), true);
  assert.equal((result.wsUrl.match(/sid2=sid-abc/g) || []).length, 2);
  assert.equal(result.wsUrlDisplay.includes("plain-token-123"), false);
  assert.equal(result.wsUrlDisplay.includes("sid-abc"), false);
});

test("buildLegionWarWsUrl prefers parsed actualToken over raw token string", () => {
  const result = buildLegionWarWsUrl({
    tokenString: "base64-token-value",
    sid: "sid-abc",
    parseBase64Token: () => ({
      success: true,
      data: { actualToken: "real-token-456" },
    }),
    validateToken: () => false,
  });

  assert.equal(result.actualToken, "real-token-456");
  assert.equal(result.wsUrl.includes("p=real-token-456"), true);
  assert.equal(result.wsUrl.includes("base64-token-value"), false);
});

test("buildLegionWarWsUrl throws when sid is empty", () => {
  assert.throws(
    () =>
      buildLegionWarWsUrl({
        tokenString: "plain-token-123",
        sid: "",
        parseBase64Token: () => ({ success: false, error: "bad" }),
        validateToken: () => true,
      }),
    /sid/,
  );
});

test("buildLegionWarWsUrl throws when token is invalid", () => {
  assert.throws(
    () =>
      buildLegionWarWsUrl({
        tokenString: "bad-token",
        sid: "sid-abc",
        parseBase64Token: () => ({ success: false, error: "bad" }),
        validateToken: () => false,
      }),
    /Token无效/,
  );
});
