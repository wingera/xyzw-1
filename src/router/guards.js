import { useAuthStore } from "@/stores/auth";
import { useTokenStore } from "@/stores/tokenStore";
import {
  extractSensitiveTokenImportQuery,
  getSanitizedTokenImportQuery,
  stashTokenImportRouteNotice,
} from "@/services/tokenImport/tokenImportRouteHandoff";
import { isNowInLegionWarTime } from "@/utils/clubBattleUtils";
import {
  canAccessAdminCenter,
  getDefaultAuthenticatedPath,
  hasGameFeatureAccess,
} from "@/utils/accessScope";
import { APP_TITLE, mergeMatchedMeta } from "./meta";

let guardsInstalled = false;

export const setupRouterGuards = (router) => {
  if (guardsInstalled)
    return;

  router.beforeEach(async (to) => {
    const authStore = useAuthStore();
    const tokenStore = useTokenStore();
    await authStore.initializeAuth();

    const mergedMeta = mergeMatchedMeta(to.matched);
    document.title = mergedMeta.title
      ? `${mergedMeta.title} - ${APP_TITLE}`
      : APP_TITLE;

    if (to.name === "LegionWar" && !isNowInLegionWarTime()) {
      return getDefaultAuthenticatedPath(authStore.user);
    }

    const isTokenImportRoute = to.path === "/tokens" || to.name === "TokenImport";
    const sanitizedTokenImportQuery = isTokenImportRoute
      ? getSanitizedTokenImportQuery(to.query)
      : null;
    const sensitiveTokenImportQuery = isTokenImportRoute
      ? extractSensitiveTokenImportQuery(to.query)
      : { hasSensitiveParams: false };

    if (isTokenImportRoute && sensitiveTokenImportQuery.hasSensitiveParams) {
      stashTokenImportRouteNotice("legacySensitiveQueryDisabled");
      return {
        path: to.path,
        query: sanitizedTokenImportQuery || {},
        hash: to.hash,
        replace: true,
      };
    }

    const safeRedirect = isTokenImportRoute
      ? router.resolve({
        path: to.path,
        query: sanitizedTokenImportQuery || {},
        hash: to.hash,
      }).fullPath
      : to.fullPath;

    if (mergedMeta.requiresAuth && !authStore.isAuthenticated) {
      return {
        path: "/login",
        query: { redirect: safeRedirect },
      };
    }

    if (mergedMeta.requiresAdmin && !canAccessAdminCenter(authStore.user)) {
      return authStore.user?.isAdmin
        ? { path: "/admin/profile", query: { adminMfaRequired: "1" } }
        : getDefaultAuthenticatedPath(authStore.user);
    }

    if (mergedMeta.requiresGameAccess && !hasGameFeatureAccess(authStore.user)) {
      return "/admin/task-control";
    }

    if (
      authStore.isAuthenticated
      && ["GameFeatures", "TaskControl", "LineupAssistant"].includes(String(to.name || ""))
    ) {
      if (!tokenStore.hasUsableWorkbenchToken) {
        try {
          await tokenStore.syncActivationBindingsFromServer();
        } catch {
          // ignore sync failure and keep existing fallback route behavior
        }
      }
      if (!tokenStore.hasUsableWorkbenchToken) {
        return "/tokens";
      }
    }

    if (
      authStore.isAuthenticated
      && (to.path === "/login" || to.path === "/register" || to.path === "/forgot-password")
    ) {
      return getDefaultAuthenticatedPath(authStore.user);
    }

    if (to.path === "/" && authStore.isAuthenticated) {
      return getDefaultAuthenticatedPath(authStore.user);
    }

    return true;
  });

  guardsInstalled = true;
};
