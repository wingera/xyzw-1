import test from "node:test";
import assert from "node:assert/strict";
import jiti from "jiti";

const loadModule = jiti(import.meta.url, { interopDefault: true });
const { adminRoutes } = loadModule("../../src/router/modules/admin.routes.js");

const findRouteByName = (routes, targetName) => {
  for (const route of routes) {
    if (String(route?.name || "") === targetName) {
      return route;
    }
    if (Array.isArray(route?.children)) {
      const nested = findRouteByName(route.children, targetName);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};

test("lineup assistant route does not require full game access", () => {
  const lineupAssistantRoute = findRouteByName(adminRoutes, "LineupAssistant");

  assert.ok(lineupAssistantRoute, "expected LineupAssistant route");
  assert.equal(Boolean(lineupAssistantRoute?.meta?.requiresGameAccess), false);
});

test("other restricted admin game pages still require full game access", () => {
  const legionWarRoute = findRouteByName(adminRoutes, "LegionWar");
  const dailyTasksRoute = findRouteByName(adminRoutes, "DailyTasks");

  assert.ok(legionWarRoute, "expected LegionWar route");
  assert.ok(dailyTasksRoute, "expected DailyTasks route");
  assert.equal(Boolean(legionWarRoute?.meta?.requiresGameAccess), true);
  assert.equal(Boolean(dailyTasksRoute?.meta?.requiresGameAccess), true);
});
