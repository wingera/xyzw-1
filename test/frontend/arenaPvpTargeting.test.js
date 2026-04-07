import test from "node:test";
import assert from "node:assert/strict";

import { sortArenaTargetsByWinRatePreference } from "../../src/composables/useArenaPvpTargeting.js";

test("custom arena min win-rate preference prioritizes candidates at or above the threshold", () => {
  const available = [
    { id: "perfect", name: "Perfect" },
    { id: "preferred", name: "Preferred" },
    { id: "mid", name: "Mid" },
    { id: "unknown", name: "Unknown" },
  ];
  const targetWinStats = {
    perfect: { wins: 1, total: 1 },
    preferred: { wins: 6, total: 8 },
    mid: { wins: 5, total: 10 },
  };

  const sorted = sortArenaTargetsByWinRatePreference(
    available,
    targetWinStats,
    70,
  );

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["perfect", "preferred", "unknown", "mid"],
  );
});

test("empty arena win-rate preference keeps default highest-win-rate ordering", () => {
  const available = [
    { id: "perfect", name: "Perfect" },
    { id: "preferred", name: "Preferred" },
    { id: "mid", name: "Mid" },
    { id: "unknown", name: "Unknown" },
  ];
  const targetWinStats = {
    perfect: { wins: 1, total: 1 },
    preferred: { wins: 6, total: 8 },
    mid: { wins: 5, total: 10 },
  };

  const sorted = sortArenaTargetsByWinRatePreference(
    available,
    targetWinStats,
    null,
  );

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["perfect", "preferred", "mid", "unknown"],
  );
});

test("arena defense records participate in win-rate threshold ranking", () => {
  const available = [
    { id: "guard", name: "Guard" },
    { id: "unknown", name: "Unknown" },
    { id: "low", name: "Low" },
  ];
  const targetWinStats = {
    low: { wins: 1, total: 4 },
  };
  const arenaRecords = [
    { roleId: "guard", name: "Guard", type: "守", isWin: true },
    { roleId: "guard", name: "Guard", type: "守", isWin: true },
  ];

  const sorted = sortArenaTargetsByWinRatePreference(
    available,
    targetWinStats,
    80,
    arenaRecords,
  );

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["guard", "unknown", "low"],
  );
});

test("below-threshold win-rate entries no longer outrank fallback candidates", () => {
  const available = [
    { id: "unknown", name: "Unknown" },
    { id: "low", name: "Low" },
    { id: "lower", name: "Lower" },
  ];
  const targetWinStats = {
    low: { wins: 3, total: 5 },
    lower: { wins: 1, total: 4 },
  };

  const sorted = sortArenaTargetsByWinRatePreference(
    available,
    targetWinStats,
    80,
    [],
  );

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["unknown", "low", "lower"],
  );
});
