import test from "node:test";
import assert from "node:assert/strict";

import {
  hasSensitiveSourceUrlParams,
  hasSensitiveWsUrlParams,
  sanitizeSourceUrlForDisplay,
  sanitizeWsUrl,
} from "../../src/utils/securitySanitizer.js";

test("hasSensitiveSourceUrlParams detects common sensitive sourceUrl query keys", () => {
  assert.equal(
    hasSensitiveSourceUrlParams("https://api.example.com/token?code=abc123&ticket=xyz"),
    true,
  );
  assert.equal(
    hasSensitiveSourceUrlParams("https://api.example.com/token?lang=zh-CN"),
    false,
  );
});

test("sanitizeSourceUrlForDisplay masks sensitive sourceUrl query values", () => {
  const sanitized = sanitizeSourceUrlForDisplay(
    "https://api.example.com/token?code=abc123&ticket=xyz&lang=zh-CN",
  );

  assert.equal(sanitized.startsWith("https://api.example.com/token?"), true);
  assert.equal(sanitized.includes("abc123"), false);
  assert.equal(sanitized.includes("ticket=xyz"), false);
  assert.equal(sanitized.includes("lang=zh-CN"), true);
});

test("sanitizeSourceUrlForDisplay falls back to text masking when URL parsing fails", () => {
  const sanitized = sanitizeSourceUrlForDisplay(
    "bad url ?token=abc123&code=xyz789",
  );

  assert.equal(sanitized.includes("abc123"), false);
  assert.equal(sanitized.includes("xyz789"), false);
});

test("hasSensitiveWsUrlParams detects common sensitive wsUrl query keys", () => {
  assert.equal(
    hasSensitiveWsUrlParams("wss://example.com/agent?p=abc123&lang=chinese"),
    true,
  );
  assert.equal(
    hasSensitiveWsUrlParams("wss://example.com/agent?sid2=s123&lang=chinese"),
    true,
  );
  assert.equal(
    hasSensitiveWsUrlParams("wss://example.com/agent?lang=chinese"),
    false,
  );
});

test("sanitizeWsUrl masks sensitive wsUrl query values", () => {
  const sanitized = sanitizeWsUrl(
    "wss://example.com/agent?p=abc123&token=xyz789&lang=chinese",
  );

  assert.equal(sanitized.startsWith("wss://example.com/agent?"), true);
  assert.equal(sanitized.includes("abc123"), false);
  assert.equal(sanitized.includes("xyz789"), false);
  assert.equal(sanitized.includes("lang=chinese"), true);
});

test("sanitizeWsUrl masks LegionWar sid2 while preserving non-sensitive params", () => {
  const sanitized = sanitizeWsUrl(
    "wss://example.com/agent?p=abc&sid2=s123&lang=chinese",
  );

  assert.equal(sanitized.includes("abc"), false);
  assert.equal(sanitized.includes("s123"), false);
  assert.equal(sanitized.includes("lang=chinese"), true);
});
