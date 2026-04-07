import assert from "node:assert/strict";
import test from "node:test";
import { redactHeaders, redactUrl, sanitizeForLog } from "../src/lib/logRedactor.js";

test("redactHeaders masks authorization/cookie/set-cookie/x-*-token headers", () => {
  const headers = {
    authorization: "Bearer abc",
    cookie: "sid=abc",
    "set-cookie": "sid=abc; HttpOnly",
    "x-user-confirm-token": "u-token",
    "x-admin-confirm-token": "a-token",
    "content-type": "application/json",
  };

  const redacted = redactHeaders(headers);
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.equal(redacted.cookie, "[REDACTED]");
  assert.equal(redacted["set-cookie"], "[REDACTED]");
  assert.equal(redacted["x-user-confirm-token"], "[REDACTED]");
  assert.equal(redacted["x-admin-confirm-token"], "[REDACTED]");
  assert.equal(redacted["content-type"], "application/json");
});

test("redactUrl masks sensitive query params", () => {
  const query = new URLSearchParams({
    ticket: "123",
    token: "xyz",
    foo: "bar",
    secret: "s",
  }).toString();
  const redacted = redactUrl(`/api/v1/bin-files/abc/download?${query}`);
  const expected = `/api/v1/bin-files/abc/download?${new URLSearchParams({
    ticket: "***",
    token: "***",
    foo: "bar",
    secret: "***",
  }).toString()}`;
  assert.equal(redacted, expected);
});

test("redactUrl masks sessId-style activation query params", () => {
  const query = new URLSearchParams({
    sessId: "abc123",
    tokenId: "t1",
  }).toString();
  const redacted = redactUrl(`/api/v1/token-activations/status?${query}`);
  assert.equal(redacted.includes("sessId=***") || redacted.includes("sessid=***"), true);
  assert.equal(redacted.includes("abc123"), false);
});

test("redactUrl masks deviceUniqueId and distinctId query params", () => {
  const query = new URLSearchParams({
    deviceUniqueId: "abc123",
    distinctId: "did-456",
    gameId: "xyzwapp",
  }).toString();
  const redacted = redactUrl(`/api/v1/wechat-proxy/hortor-login?${query}`);
  assert.equal(redacted.includes("deviceUniqueId=***"), true);
  assert.equal(redacted.includes("distinctId=***"), true);
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("did-456"), false);
  assert.equal(redacted.includes("gameId=xyzwapp"), true);
});

test("redactUrl masks qrstatus uuid query params", () => {
  const query = new URLSearchParams({
    uuid: "wx-uuid-123",
    f: "url",
  }).toString();
  const redacted = redactUrl(`/api/v1/wechat-proxy/qrstatus?${query}`);
  assert.equal(redacted.includes("uuid=***"), true);
  assert.equal(redacted.includes("wx-uuid-123"), false);
});

test("sanitizeForLog escapes control characters", () => {
  assert.equal(sanitizeForLog("/a\tb\r\nc"), "/a\\tb\\r\\nc");
});

test("redactUrl also escapes control characters", () => {
  const redacted = redactUrl("/api/test?foo=a\tb&token=abc\r\nx");
  assert.equal(redacted.includes("token=***"), true);
  assert.equal(/[\r\n\t]/.test(redacted), false);
});
