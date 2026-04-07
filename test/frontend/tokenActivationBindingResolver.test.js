import test from "node:test";
import assert from "node:assert/strict";

import {
  parseBoundSessId,
  resolveServerActivationBindingForToken,
} from "../../src/services/token/tokenActivationBindingResolver.js";

test("parseBoundSessId extracts the stored sessId prefix", () => {
  assert.equal(
    parseBoundSessId("sess-old-123|123456|测试大区|测试角色"),
    "sess-old-123",
  );
});

test("resolveServerActivationBindingForToken prefers exact tokenId matches", () => {
  const binding = resolveServerActivationBindingForToken({
    token: {
      id: "token-current",
      roleId: "123456",
      server: "测试大区",
      roleIndex: "0",
    },
    bindings: [
      {
        tokenId: "token-current",
        roleId: "123456",
        region: "测试大区",
        roleIndex: "0",
        roleName: "当前角色",
        accountIdentity: "sess-current|123456|测试大区|当前角色",
      },
      {
        tokenId: "token-old",
        roleId: "123456",
        region: "测试大区",
        roleIndex: "0",
        roleName: "旧角色",
        accountIdentity: "sess-old|123456|测试大区|旧角色",
      },
    ],
  });

  assert.equal(binding?.tokenId, "token-current");
  assert.equal(binding?.sessId, "sess-current");
  assert.equal(binding?.roleName, "当前角色");
});

test("resolveServerActivationBindingForToken falls back to same role binding when tokenId changes", () => {
  const binding = resolveServerActivationBindingForToken({
    token: {
      id: "token-new",
      roleId: "123456",
      server: "测试大区",
      roleIndex: "0",
    },
    bindings: [
      {
        tokenId: "token-old",
        roleId: "123456",
        region: "测试大区",
        roleIndex: "0",
        roleName: "测试角色",
        accountIdentity: "sess-old|123456|测试大区|测试角色",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ],
  });

  assert.equal(binding?.tokenId, "token-old");
  assert.equal(binding?.sessId, "sess-old");
  assert.equal(binding?.roleId, "123456");
  assert.equal(binding?.region, "测试大区");
  assert.equal(binding?.roleIndex, "0");
});

test("resolveServerActivationBindingForToken falls back to a unique roleId binding even when region metadata is missing", () => {
  const binding = resolveServerActivationBindingForToken({
    token: {
      id: "token-new",
      roleId: "123456",
      server: "",
      roleIndex: "",
    },
    bindings: [
      {
        tokenId: "token-old",
        roleId: "123456",
        region: "测试大区",
        roleIndex: "0",
        roleName: "测试角色",
        accountIdentity: "sess-old|123456|测试大区|测试角色",
      },
    ],
  });

  assert.equal(binding?.tokenId, "token-old");
  assert.equal(binding?.sessId, "sess-old");
  assert.equal(binding?.region, "测试大区");
});
