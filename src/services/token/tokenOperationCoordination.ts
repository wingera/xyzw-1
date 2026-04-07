type TokenOperationLock = {
  tokenId: string;
  lockId: string;
  source: string;
  startedAt: number;
  updatedAt: number;
  meta: Record<string, any>;
};

type TokenRewardSync = {
  tokenId: string;
  event: string;
  timestamp: number;
  meta: Record<string, any>;
};

type CoordinationStore = {
  locks: Record<string, TokenOperationLock>;
  rewardSync: Record<string, TokenRewardSync>;
  busyEvents: Record<string, TokenRewardSync>;
};

const STORE_KEY = "__XYZW_TOKEN_OPERATION_COORDINATION__";

const fallbackStore: CoordinationStore = {
  locks: {},
  rewardSync: {},
  busyEvents: {},
};

const getStore = (): CoordinationStore => {
  if (typeof window === "undefined") {
    return fallbackStore;
  }

  if (!window[STORE_KEY]) {
    window[STORE_KEY] = {
      locks: {},
      rewardSync: {},
      busyEvents: {},
    };
  }

  return window[STORE_KEY];
};

const normalizeTokenId = (tokenId: string | number | null | undefined) =>
  String(tokenId || "").trim();

export const acquireTokenOperationLock = (
  tokenId: string | number | null | undefined,
  source: string,
  meta: Record<string, any> = {},
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId) {
    return {
      ok: false,
      reason: "missing_token_id",
      current: null,
    };
  }

  const store = getStore();
  const current = store.locks[normalizedTokenId];
  if (current) {
    return {
      ok: false,
      reason: "busy",
      current,
    };
  }

  const now = Date.now();
  const lock: TokenOperationLock = {
    tokenId: normalizedTokenId,
    lockId: `${source}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    source: String(source || "").trim() || "unknown",
    startedAt: now,
    updatedAt: now,
    meta: { ...meta },
  };

  store.locks[normalizedTokenId] = lock;
  return {
    ok: true,
    lock,
  };
};

export const refreshTokenOperationLock = (
  tokenId: string | number | null | undefined,
  lockId: string,
  meta: Record<string, any> = {},
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId || !lockId) {
    return null;
  }

  const store = getStore();
  const current = store.locks[normalizedTokenId];
  if (!current || current.lockId !== lockId) {
    return null;
  }

  current.updatedAt = Date.now();
  current.meta = {
    ...current.meta,
    ...meta,
  };
  return current;
};

export const releaseTokenOperationLock = (
  tokenId: string | number | null | undefined,
  lockId?: string | null,
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId) {
    return false;
  }

  const store = getStore();
  const current = store.locks[normalizedTokenId];
  if (!current) {
    return false;
  }
  if (lockId && current.lockId !== lockId) {
    return false;
  }

  delete store.locks[normalizedTokenId];
  return true;
};

export const getTokenOperationLock = (
  tokenId: string | number | null | undefined,
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId) {
    return null;
  }
  return getStore().locks[normalizedTokenId] || null;
};

export const touchTokenRewardSync = (
  tokenId: string | number | null | undefined,
  event = "syncrewardresp",
  meta: Record<string, any> = {},
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId) {
    return null;
  }

  const entry: TokenRewardSync = {
    tokenId: normalizedTokenId,
    event,
    timestamp: Date.now(),
    meta: { ...meta },
  };
  getStore().rewardSync[normalizedTokenId] = entry;
  return entry;
};

export const getRecentTokenRewardSync = (
  tokenId: string | number | null | undefined,
  withinMs = 30_000,
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId) {
    return null;
  }

  const entry = getStore().rewardSync[normalizedTokenId];
  if (!entry) {
    return null;
  }

  return Date.now() - Number(entry.timestamp || 0) <= withinMs ? entry : null;
};

export const touchTokenBusyEvent = (
  tokenId: string | number | null | undefined,
  event: string,
  meta: Record<string, any> = {},
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId) {
    return null;
  }

  const entry: TokenRewardSync = {
    tokenId: normalizedTokenId,
    event,
    timestamp: Date.now(),
    meta: { ...meta },
  };
  getStore().busyEvents[normalizedTokenId] = entry;
  return entry;
};

export const getRecentTokenBusyEvent = (
  tokenId: string | number | null | undefined,
  withinMs = 30_000,
) => {
  const normalizedTokenId = normalizeTokenId(tokenId);
  if (!normalizedTokenId) {
    return null;
  }

  const entry = getStore().busyEvents[normalizedTokenId];
  if (!entry) {
    return null;
  }

  return Date.now() - Number(entry.timestamp || 0) <= withinMs ? entry : null;
};
