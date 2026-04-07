import { AES, enc, MD5 } from "crypto-js";
import {
  getJsonPreference,
  getStringPreference,
  setJsonPreference,
} from "@/services/preferences/localPreferences";

export const getArenaStatsStorageKey = (tokenId) =>
  `arena_pvp_win_rate_stats_v1:${tokenId || "unknown"}`;
export const getArenaRecordStorageKey = (tokenId) =>
  `arena_pvp_records_v1:${tokenId || "unknown"}`;
export const getArenaManualLineupStorageKey = (tokenId) =>
  `arena_pvp_manual_lineups_v1:${tokenId || "unknown"}`;
export const getArenaSkipLineupsStorageKey = (tokenId) =>
  `arena_pvp_skip_lineups_v1:${tokenId || "unknown"}`;
export const getArenaPreferredWinRateStorageKey = (tokenId) =>
  `arena_pvp_preferred_win_rate_v1:${tokenId || "unknown"}`;
export const getArenaSyncPrefKeyByScope = (scopeId) =>
  `arena_pvp_sync_v1:${scopeId || "unknown"}`;

export const getArenaSyncUserScopeFromStorage = (userId) =>
  String(userId || getStringPreference("activeUserId", "guest") || "guest");

const buildArenaStorageSecret = (scopeId) =>
  MD5(`arena_pvp_secure:${scopeId}:v2`).toString(enc.Hex);

const buildArenaStorageSecretLegacy = (tokenId, userScope) =>
  MD5(`arena_pvp_secure:${userScope}:${tokenId || "unknown"}:v1`).toString(enc.Hex);

export const encryptArenaPayload = (tokenId, value, scopeId) => {
  const text = JSON.stringify(value ?? null);
  return AES.encrypt(text, buildArenaStorageSecret(scopeId)).toString();
};

export const decryptArenaPayload = (tokenId, payload, scopeId, userScope) => {
  try {
    const bytes = AES.decrypt(String(payload || ""), buildArenaStorageSecret(scopeId));
    const plainText = bytes.toString(enc.Utf8);
    if (!plainText) {
      return null;
    }
    return JSON.parse(plainText);
  } catch {
    try {
      const bytes = AES.decrypt(
        String(payload || ""),
        buildArenaStorageSecretLegacy(tokenId, userScope),
      );
      const plainText = bytes.toString(enc.Utf8);
      if (!plainText) {
        return null;
      }
      return JSON.parse(plainText);
    } catch {
      return null;
    }
  }
};

export const saveEncryptedArenaLocalValue = (storageKey, tokenId, value, scopeId) => {
  setJsonPreference(storageKey, {
    encrypted: true,
    updatedAt: Date.now(),
    payload: encryptArenaPayload(tokenId, value, scopeId),
  });
};

export const loadEncryptedArenaLocalValue = (
  storageKey,
  tokenId,
  scopeId,
  userScope,
  fallbackFactory,
) => {
  const parsed = getJsonPreference(storageKey, null);
  if (!parsed) {
    return fallbackFactory();
  }
  if (parsed?.encrypted && typeof parsed?.payload === "string") {
    const decrypted = decryptArenaPayload(tokenId, parsed.payload, scopeId, userScope);
    return decrypted ?? fallbackFactory();
  }
  return parsed;
};

export const loadArenaStatsFromLocal = (tokenId) =>
  getJsonPreference(getArenaStatsStorageKey(tokenId), {});

export const saveArenaStatsToLocal = (tokenId, value) => {
  setJsonPreference(getArenaStatsStorageKey(tokenId), value);
};

export const loadArenaSkipLineupsFromLocal = (tokenId) =>
  getJsonPreference(getArenaSkipLineupsStorageKey(tokenId), null);

export const saveArenaSkipLineupsToLocal = (tokenId, value) => {
  setJsonPreference(getArenaSkipLineupsStorageKey(tokenId), value);
};

export const loadArenaPreferredWinRateFromLocal = (tokenId) =>
  getJsonPreference(getArenaPreferredWinRateStorageKey(tokenId), null);

export const saveArenaPreferredWinRateToLocal = (tokenId, value) => {
  setJsonPreference(getArenaPreferredWinRateStorageKey(tokenId), value);
};
