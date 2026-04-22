import crypto from "crypto";
import WebSocket from "ws";
import { nowIso } from "../db/sql.js";
import { taskControlRepository } from "../repositories/taskControlRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { userPreferenceRepository } from "../repositories/userPreferenceRepository.js";
import { tokenActivationRepository } from "../repositories/tokenActivationRepository.js";
import { listBinFiles, readBinFile } from "./binStorageService.js";
import {
  AUTHUSER_RETRY_COUNT,
  AUTHUSER_TIMEOUT_MS,
  CHECK_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  EMPTY_PRIORITY,
  extractRoleIdFromTokenText,
  formatExecutionErrorMessage,
  getHourlyIntervalFromCron,
  isIntervalDueNow,
  isRetryableNetworkError,
  maskTokenIdForLog,
  MAX_AUTO_TASKS_PER_USER_PER_TICK,
  minuteKey,
  parseTaskRows,
  parseTokenString,
  QUIET_WINDOW_PREF_KEY,
  SERVER_ERROR_CODE_MAP,
  sleep,
  SUPPORTED_TASK_IDS,
  TASK_CONTROL_CUSTOM_WS_URL_ALLOWLIST,
  TASK_CONTROL_CUSTOM_WS_URL_ENABLED,
  TASK_META,
  TOKEN_CACHE_TTL_MS,
  WS_CIRCUIT_OPEN_FAIL_COUNT,
  WS_CIRCUIT_OPEN_MS,
  WS_CONNECT_RETRY_BASE_DELAY_MS,
  WS_CONNECT_RETRY_COUNT,
  WS_CONNECT_TIMEOUT_MS,
  sanitizeTaskControlWsUrl,
} from "./taskControlScheduler/taskControlSchedulerHelpers.js";
import {
  findDueCronMinuteKey,
  formatQuietWindowReason,
  getQuietWindowReason,
} from "./taskControlScheduler/schedulerTiming.js";
import { appendTaskControlSystemLog } from "./taskControlScheduler/systemLog.js";
import { tokenExecutionQueue } from "./taskControlScheduler/tokenExecutionQueue.js";
import { g_utils } from "../../../shared/bonProtocol.js";
import {
  normalizeCars,
  canClaim,
  shouldSendCar,
} from "../../../shared/batch/carUtils.js";
import { CarresearchItem } from "../../../shared/batch/constants.js";

const tokenCache = new Map();
const minuteRunGuard = new Map();
let schedulerTimer = null;
let schedulerRunning = false;
let lastSchedulerTickAt = Date.now();
const wsConnectFailureMap = new Map();

const decodeAuthPayloadToToken = async (binBuffer) => {
  const url = "https://xxz-xyzw.hortorgames.com/login/authuser?_seq=1";
  const maxAttempts = AUTHUSER_RETRY_COUNT + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTHUSER_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: Buffer.from(binBuffer),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`authuser failed: HTTP ${response.status}`);
      }
      const payload = await response.arrayBuffer();
      const msg = g_utils.parse(payload);
      const data = msg.getData() || {};
      const sessId = Date.now() * 100 + crypto.randomInt(0, 100);
      const connId = Date.now() + crypto.randomInt(0, 10);
      const tokenText = JSON.stringify({
        ...data,
        sessId,
        connId,
        isRestore: 0,
      });
      const roleId = Number(data?.roleId || data?.role?.roleId);
      return {
        token: parseTokenString(tokenText),
        roleId: Number.isFinite(roleId) && roleId > 0 ? String(roleId) : "",
      };
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && isRetryableNetworkError(error);
      if (!canRetry) {
        throw error;
      }
      await sleep(350 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("authuser failed");
};

const getActualTokenByBin = async ({ user, tokenId, withContext = false }) => {
  const cacheKey = `${user.id}:${tokenId}`;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return withContext ? cached : cached.token;
  }
  const binBuffer = await readBinFile({ user, tokenId });
  if (!binBuffer) {
    throw new Error("未找到对应 BIN 文件");
  }
  const decoded = await decodeAuthPayloadToToken(binBuffer);
  const token = String(decoded?.token || "").trim();
  if (!token || token.length < 10) {
    throw new Error("BIN 转换 token 失败");
  }
  const cacheValue = {
    token,
    roleId: String(decoded?.roleId || "").trim(),
    expiresAt: now + TOKEN_CACHE_TTL_MS,
  };
  tokenCache.set(cacheKey, cacheValue);
  return withContext ? cacheValue : cacheValue.token;
};

const resolveExecutableTokenIds = async ({ user, row, allBinTokenIds }) => {
  const normalizeTokenIds = async (tokenIds = []) => {
    const unique = [];
    const seenTokenIds = new Set();

    for (const tokenId of tokenIds) {
      const id = String(tokenId || "").trim();
      if (!id) continue;
      if (seenTokenIds.has(id)) continue;
      seenTokenIds.add(id);
      try {
        await getActualTokenByBin({ user, tokenId: id });
        unique.push(id);
      } catch {
        unique.push(id);
      }
    }

    return [...new Set(unique)];
  };

  if (!Array.isArray(row?.tokenIds) || row.tokenIds.length === 0) {
    return normalizeTokenIds([...allBinTokenIds]);
  }

  const exactMatched = row.tokenIds.filter((id) => allBinTokenIds.includes(id));
  const missingIds = row.tokenIds.filter((id) => !allBinTokenIds.includes(id));
  if (missingIds.length === 0) {
    return normalizeTokenIds([...new Set(exactMatched)]);
  }

  const tokenRoleIdMap =
    row?.tokenRoleIdMap && typeof row.tokenRoleIdMap === "object"
      ? row.tokenRoleIdMap
      : {};
  const desiredRoleIds = [
    ...new Set(
      missingIds
        .map((id) => String(tokenRoleIdMap[id] || "").trim())
        .filter(Boolean),
    ),
  ];

  if (desiredRoleIds.length === 0) {
    return normalizeTokenIds([...new Set(exactMatched)]);
  }

  const fallbackMatched = [];
  for (const tokenId of allBinTokenIds) {
    if (exactMatched.includes(tokenId)) {
      continue;
    }
    try {
      const tokenCtx = await getActualTokenByBin({
        user,
        tokenId,
        withContext: true,
      });
      const roleId = String(tokenCtx?.roleId || "").trim();
      if (roleId && desiredRoleIds.includes(roleId)) {
        fallbackMatched.push(tokenId);
      }
    } catch {
      continue;
    }
  }

  return normalizeTokenIds([...new Set([...exactMatched, ...fallbackMatched])]);
};

export const resolveTokenActivationForExecution = async ({
  user,
  row,
  tokenId,
  nowTs = Date.now(),
}) => {
  const userId = String(user?.id || "").trim();
  let binding = tokenActivationRepository.findByTokenId({ tokenId });
  if (!binding) {
    const tokenRoleIdMap =
      row?.tokenRoleIdMap && typeof row.tokenRoleIdMap === "object"
        ? row.tokenRoleIdMap
        : {};
    let fallbackRoleId = String(tokenRoleIdMap[tokenId] || "").trim();

    if (!fallbackRoleId) {
      try {
        const tokenCtx = await getActualTokenByBin({
          user,
          tokenId,
          withContext: true,
        });
        fallbackRoleId = String(tokenCtx?.roleId || "").trim();
      } catch {
        fallbackRoleId = "";
      }
    }

    if (fallbackRoleId) {
      binding = tokenActivationRepository.findByRoleId({
        roleId: fallbackRoleId,
      });
    }
  }

  if (!binding) {
    return {
      active: false,
      reason: "未激活",
    };
  }
  if (String(binding.userId || "").trim() !== String(userId || "").trim()) {
    return {
      active: false,
      reason: "已绑定到其他账号",
    };
  }
  const expiresTs = new Date(binding.expiresAt || "").getTime();
  const active = Boolean(binding.isActive) && Number.isFinite(expiresTs) && expiresTs > nowTs;
  if (!active) {
    return {
      active: false,
      reason: "激活已过期",
    };
  }
  return {
    active: true,
    binding,
  };
};

const isCarTaskActivityOpen = (date = new Date()) => {
  const day = date.getDay();
  const hour = date.getHours();
  return day >= 1 && day <= 3 && hour >= 6;
};

const isQuietWindowEnabledForUser = (userId) => {
  try {
    const pref = userPreferenceRepository.findByUserAndKey({
      userId,
      key: QUIET_WINDOW_PREF_KEY,
    });
    if (!pref?.valueJson) return false;
    const parsed = JSON.parse(pref.valueJson);
    if (typeof parsed?.enabled === "boolean") return parsed.enabled;
    if (typeof parsed === "boolean") return parsed;
    return false;
  } catch {
    return false;
  }
};

const normalizeLineupKeywords = (raw) => {
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    ];
  }
  if (typeof raw === "string") {
    return [
      ...new Set(
        raw
          .split(/[\n,，]/)
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    ];
  }
  return [];
};

const stringifyLineupValue = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string"
          ? item.trim()
          : item && typeof item === "object"
            ? String(item.name || item.nickName || item.title || "").trim()
            : String(item || "").trim(),
      )
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value === "object") {
    const objText = [
      value.name,
      value.nickName,
      value.title,
      value.desc,
      value.description,
      value.lineupName,
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(" ");
    if (objText) return objText;
    return "";
  }
  return String(value || "").trim();
};

const extractMemberLineupText = (member) => {
  const custom = member?.custom || {};
  const candidates = [
    member?.lineupName,
    member?.lineup,
    member?.formationName,
    member?.battleTeamName,
    member?.teamName,
    member?.battleTeam,
    member?.battleTeamInfo,
    custom?.lineupName,
    custom?.lineup,
    custom?.formationName,
    custom?.battleTeamName,
    custom?.battle_team_name,
    custom?.lineupText,
    custom?.lineup_text,
    custom?.lineupHeroNames,
    custom?.lineupHeros,
    custom?.lineupNames,
  ];
  for (const item of candidates) {
    const text = stringifyLineupValue(item);
    if (text) return text;
  }
  return "";
};

const normalizeSmartCarSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    carMinColor: Math.max(1, Math.min(6, Number(source.carMinColor || 4))),
    useGoldRefreshFallback: source.useGoldRefreshFallback === true,
    smartDepartureGoldThreshold: Math.max(0, Number(source.smartDepartureGoldThreshold || 0)),
    smartDepartureRecruitThreshold: Math.max(0, Number(source.smartDepartureRecruitThreshold || 0)),
    smartDepartureJadeThreshold: Math.max(0, Number(source.smartDepartureJadeThreshold || 0)),
    smartDepartureTicketThreshold: Math.max(0, Number(source.smartDepartureTicketThreshold || 0)),
    smartDepartureMaxRefreshAttempts: Math.max(
      1,
      Math.min(
        500,
        Number(
          source.smartDepartureMaxRefreshAttempts
          || source.smartDepartureMaxRefreshTimes
          || 30,
        ) || 30,
      ),
    ),
    smartDepartureMatchAll: source.smartDepartureMatchAll === true,
    helperLineupAnalysisEnabled: source.helperLineupAnalysisEnabled !== false,
    helperPreferredLineups: normalizeLineupKeywords(source.helperPreferredLineups),
    actionDelay: Math.max(100, Number(source.actionDelay || 400)),
    refreshDelay: Math.max(200, Number(source.refreshDelay || 600)),
  };
};

const normalizeDailyRunnerSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const parseFormation = (raw, fallback = undefined) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 6) return fallback;
    return n;
  };
  const parseBossTimes = Number(source.bossTimes);
  return {
    friendGoldEnable: source.friendGoldEnable !== false,
    recruitEnable: source.recruitEnable !== false,
    payRecruit: source.payRecruit !== false,
    openBox: source.openBox !== false,
    freeFishEnable: source.freeFishEnable !== false,
    mengjingEnable: source.mengjingEnable !== false,
    legionBossEnable: source.legionBossEnable !== false,
    dailyBossEnable: source.dailyBossEnable !== false,
    bossTimes: Number.isFinite(parseBossTimes)
      ? Math.max(0, Math.min(4, Math.floor(parseBossTimes)))
      : 2,
    legionBossFormation: parseFormation(source.legionBossFormation, undefined),
    dailyBossFormation: parseFormation(source.dailyBossFormation, undefined),
  };
};

const resolveDailyRunnerSettingsForToken = (row, tokenId) => {
  const globalSettings = normalizeDailyRunnerSettings(row?.dailyRunner);
  const tokenMap =
    row?.dailyRunnerByToken && typeof row.dailyRunnerByToken === "object"
      ? row.dailyRunnerByToken
      : {};
  const rawOverride = tokenMap[String(tokenId)];
  if (!rawOverride || typeof rawOverride !== "object") {
    return globalSettings;
  }
  const override = normalizeDailyRunnerSettings(rawOverride);
  return {
    ...globalSettings,
    ...override,
  };
};

const pickArenaTargetId = (targets) => {
  if (Array.isArray(targets)) {
    const candidate = targets[0];
    return candidate?.roleId || candidate?.id || candidate?.targetId || null;
  }
  const candidate =
    targets?.rankList?.[0]
    || targets?.roleList?.[0]
    || targets?.targets?.[0]
    || targets?.targetList?.[0]
    || targets?.list?.[0];
  if (candidate?.roleId) return candidate.roleId;
  if (candidate?.id) return candidate.id;
  if (candidate?.targetId) return candidate.targetId;
  return targets?.roleId || targets?.id || targets?.targetId || null;
};

const isTodayAvailable = (statisticsTime) => {
  if (!statisticsTime) return true;
  const today = new Date().toDateString();
  const recordDate = new Date(Number(statisticsTime) * 1000).toDateString();
  return today !== recordDate;
};

const getTodayBossId = () => {
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
};

const appendSystemLog = appendTaskControlSystemLog;

const getWsCircuitKey = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return String(url || "").trim();
  }
};

const isWsCircuitOpen = (url) => {
  const key = getWsCircuitKey(url);
  const record = wsConnectFailureMap.get(key);
  if (!record) return false;
  const now = Date.now();
  if (record.count < WS_CIRCUIT_OPEN_FAIL_COUNT) return false;
  return now - record.lastFailureAt < WS_CIRCUIT_OPEN_MS;
};

const markWsConnectFailure = (url) => {
  const key = getWsCircuitKey(url);
  const previous = wsConnectFailureMap.get(key);
  const count = Number(previous?.count || 0) + 1;
  wsConnectFailureMap.set(key, { count, lastFailureAt: Date.now() });
};

const clearWsConnectFailure = (url) => {
  wsConnectFailureMap.delete(getWsCircuitKey(url));
};

const enqueueTokenExecution = (payload) => tokenExecutionQueue.enqueue(payload);

const connectWs = async (token, wsUrl) => {
  const url =
    wsUrl
    || `wss://xxz-xyzw.hortorgames.com/agent?p=${encodeURIComponent(token)}&e=x&lang=chinese`;
  if (isWsCircuitOpen(url)) {
    throw new Error("WebSocket 连接熔断中，请稍后重试");
  }
  const maxAttempts = WS_CONNECT_RETRY_COUNT + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ws = new WebSocket(url);
    const state = {
      ws,
      ack: 0,
      seq: 1,
      waitersByResp: new Map(),
      waitersByCmd: new Map(),
    };

    ws.binaryType = "arraybuffer";
    ws.on("message", (raw) => {
      try {
        const msg = g_utils.parse(raw);
        if (msg?.seq) {
          state.ack = msg.seq;
        }

        const settleWaiter = (waiter, isError, payload) => {
          if (!waiter || waiter.settled) return;
          waiter.settled = true;
          clearTimeout(waiter.timeoutId);
          if (typeof waiter.cleanup === "function") waiter.cleanup();
          if (isError) {
            waiter.reject(payload);
          } else {
            waiter.resolve(payload);
          }
        };

        const code = Number(msg?.code);
        const hint = String(msg?.hint || "").trim();
        const codeError = Number.isFinite(code) && code !== 0
          ? new Error(
            `服务器错误: ${code} - ${SERVER_ERROR_CODE_MAP[code] || hint || "未知错误"}`,
          )
          : null;
        const data = msg.getData();

        const resp = Number(msg?.resp);
        if (Number.isFinite(resp) && state.waitersByResp.has(resp)) {
          const waiter = state.waitersByResp.get(resp);
          settleWaiter(waiter, !!codeError, codeError || data);
          return;
        }

        const cmd = String(msg?.cmd || "").toLowerCase();
        const waitQueue = state.waitersByCmd.get(cmd);
        if (Array.isArray(waitQueue) && waitQueue.length > 0) {
          const waiter = waitQueue.shift();
          if (waitQueue.length === 0) {
            state.waitersByCmd.delete(cmd);
          }
          settleWaiter(waiter, !!codeError, codeError || data);
        }
      } catch {
        // ignore parse errors
      }
    });

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket 连接超时")), WS_CONNECT_TIMEOUT_MS);
        ws.once("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        ws.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      clearWsConnectFailure(url);
      return state;
    } catch (error) {
      lastError = error;
      markWsConnectFailure(url);
      try {
        ws.terminate();
      } catch {
        // ignore close errors
      }
      const canRetry = attempt < maxAttempts && isRetryableNetworkError(error);
      if (!canRetry) {
        throw error;
      }
      await sleep(WS_CONNECT_RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw lastError || new Error("WebSocket 连接失败");
};

const closeWs = async (state) => {
  if (!state?.ws) return;
  await new Promise((resolve) => {
    const ws = state.ws;
    const done = () => resolve();
    ws.once("close", done);
    ws.close(1000, "done");
    setTimeout(done, 1500);
  });
};

const sendCommand = async (state, cmd, body = {}, timeout = DEFAULT_TIMEOUT_MS) => {
  const respCmd = `${String(cmd).toLowerCase()}resp`;
  return new Promise((resolve, reject) => {
    const seq = state.seq++;
    const timeoutId = setTimeout(() => {
      const respWaiter = state.waitersByResp.get(seq);
      if (respWaiter) {
        respWaiter.settled = true;
      }
      state.waitersByResp.delete(seq);
      const queue = state.waitersByCmd.get(respCmd);
      if (Array.isArray(queue) && queue.length > 0) {
        const idx = queue.findIndex((item) => item?.seq === seq);
        if (idx >= 0) queue.splice(idx, 1);
        if (queue.length === 0) state.waitersByCmd.delete(respCmd);
      }
      reject(new Error(`命令超时: ${cmd}`));
    }, timeout);

    const waiter = {
      seq,
      resolve,
      reject,
      timeoutId,
      settled: false,
      cleanup: () => {
        state.waitersByResp.delete(seq);
        const queue = state.waitersByCmd.get(respCmd);
        if (!Array.isArray(queue) || queue.length === 0) {
          state.waitersByCmd.delete(respCmd);
          return;
        }
        const idx = queue.findIndex((item) => item?.seq === seq);
        if (idx >= 0) queue.splice(idx, 1);
        if (queue.length === 0) state.waitersByCmd.delete(respCmd);
      },
    };
    state.waitersByResp.set(seq, waiter);
    const queue = state.waitersByCmd.get(respCmd) || [];
    queue.push(waiter);
    state.waitersByCmd.set(respCmd, queue);

    const packet = {
      ack: state.ack || 0,
      body: g_utils.bon.encode(body || {}),
      cmd,
      seq,
      time: Date.now(),
    };
    const encoded = g_utils.encode(packet, "x");
    state.ws.send(encoded);
  });
};

const runTaskByToken = async ({ taskId, row, tokenId, token, wsUrl }) => {
  const state = await connectWs(token, wsUrl);
  let resolvedRoleName = "";
  let resolvedServerName = "";
  try {
    try {
      const roleInfo = await sendCommand(state, "role_getroleinfo", {}, 8_000);
      resolvedRoleName = String(roleInfo?.role?.name || "").trim();
      resolvedServerName = String(
        roleInfo?.role?.serverName
        || roleInfo?.serverName
        || roleInfo?.role?.server
        || roleInfo?.server
        || "",
      ).trim();
    } catch {
      resolvedRoleName = "";
      resolvedServerName = "";
    }

    const executeGameCommand = async (
      cmd,
      params = {},
      timeout = DEFAULT_TIMEOUT_MS,
      delay = 350,
    ) => {
      const result = await sendCommand(state, cmd, params, timeout);
      if (delay > 0) {
        await sleep(delay);
      }
      return result;
    };

    const safeExecute = async (
      cmd,
      params = {},
      timeout = DEFAULT_TIMEOUT_MS,
      delay = 350,
    ) => {
      try {
        await executeGameCommand(cmd, params, timeout, delay);
        return true;
      } catch {
        return false;
      }
    };

    const switchToFormationIfNeeded = async (targetFormation) => {
      if (!Number.isInteger(targetFormation) || targetFormation < 1 || targetFormation > 6) {
        return { switched: false, originalFormation: null };
      }
      try {
        const teamInfo = await executeGameCommand(
          "presetteam_getinfo",
          {},
          8_000,
          150,
        );
        const originalFormation = Number(teamInfo?.presetTeamInfo?.useTeamId || 0) || null;
        if (originalFormation === targetFormation) {
          return { switched: false, originalFormation };
        }
        await executeGameCommand(
          "presetteam_saveteam",
          { teamId: targetFormation },
          8_000,
          300,
        );
        return { switched: true, originalFormation };
      } catch {
        return { switched: false, originalFormation: null };
      }
    };

    if (taskId === "study") {
      await executeGameCommand("study_startgame", {}, 8_000, 500);
      await sleep(2_000);
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "tower") {
      const { switched, originalFormation } = await switchToFormationIfNeeded(1);
      await safeExecute("tower_getinfo", {}, 8_000, 150);
      let roleInfo = await executeGameCommand("role_getroleinfo", {}, 8_000, 150);
      let energy = Number(roleInfo?.role?.tower?.energy || 0);
      let count = 0;
      let consecutiveFailures = 0;
      while (energy > 0 && count < 100) {
        try {
          await executeGameCommand("fight_starttower", {}, 10_000, 800);
          count += 1;
          consecutiveFailures = 0;
          if (count % 5 === 0) {
            roleInfo = await executeGameCommand("role_getroleinfo", {}, 8_000, 150);
            energy = Number(roleInfo?.role?.tower?.energy || 0);
          } else {
            energy = Math.max(0, energy - 1);
          }
        } catch (error) {
          const msg = String(error?.message || "");
          if (msg.includes("1500040")) {
            const towerId = Number(roleInfo?.role?.tower?.id || 0);
            const rewardFloor = Math.floor(towerId / 10);
            if (rewardFloor > 0) {
              await safeExecute(
                "tower_claimreward",
                { rewardId: rewardFloor },
                8_000,
                250,
              );
            }
            await sleep(1_200);
            roleInfo = await executeGameCommand("role_getroleinfo", {}, 8_000, 150);
            energy = Number(roleInfo?.role?.tower?.energy || 0);
            continue;
          }
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) {
            break;
          }
          await sleep(1_000);
          roleInfo = await executeGameCommand("role_getroleinfo", {}, 8_000, 150);
          energy = Number(roleInfo?.role?.tower?.energy || 0);
        }
      }
      if (switched && originalFormation) {
        await safeExecute(
          "presetteam_saveteam",
          { teamId: originalFormation },
          8_000,
          150,
        );
      }
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "arena") {
      const mode = row?.arenaConfig?.mode === "standalone" ? "standalone" : "batch";
      const arenaFormation = Math.max(
        1,
        Math.min(6, Number(row?.arenaConfig?.arenaFormation || 1)),
      );
      const { switched, originalFormation } = await switchToFormationIfNeeded(
        arenaFormation,
      );
      let roleInfo = null;
      try {
        roleInfo = await executeGameCommand("role_getroleinfo", {}, 8_000, 150);
      } catch {
        roleInfo = null;
      }
      const ticketCount = Number(roleInfo?.role?.items?.[1007]?.quantity || 0);
      const desiredFights =
        mode === "standalone"
          ? Math.max(1, Number(row?.arenaConfig?.fightCount || 10))
          : 3;
      const fights = Math.max(0, Math.min(desiredFights, ticketCount));
      for (let i = 0; i < fights; i += 1) {
        await executeGameCommand("arena_startarea", {}, 8_000, 200);
        let targets = null;
        try {
          targets = await executeGameCommand("arena_getareatarget", {}, 8_000, 150);
        } catch {
          break;
        }
        const targetId = pickArenaTargetId(targets);
        if (!targetId) {
          break;
        }
        await safeExecute(
          "fight_startareaarena",
          { targetId },
          12_000,
          800,
        );
      }
      if (switched && originalFormation) {
        await safeExecute(
          "presetteam_saveteam",
          { teamId: originalFormation },
          8_000,
          150,
        );
      }
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "daily") {
      const settings = resolveDailyRunnerSettingsForToken(row, tokenId);
      let roleInfoResp = null;
      try {
        roleInfoResp = await executeGameCommand("role_getroleinfo", {}, 8_000, 150);
      } catch {
        roleInfoResp = null;
      }
      const roleData = roleInfoResp?.role || {};
      const completedTasks = roleData?.dailyTask?.complete || {};
      const isTaskCompleted = (taskNum) => completedTasks[taskNum] === -1;
      const statistics = roleData?.statistics || {};
      const statisticsTime = roleData?.statisticsTime || {};
      const todayHour = new Date().getHours();
      const originalFormation = await (async () => {
        try {
          const teamInfo = await executeGameCommand(
            "presetteam_getinfo",
            {},
            8_000,
            150,
          );
          return Number(teamInfo?.presetTeamInfo?.useTeamId || 0) || null;
        } catch {
          return null;
        }
      })();

      const runOptional = async (
        cmd,
        params = {},
        timeout = DEFAULT_TIMEOUT_MS,
        delay = 350,
      ) => {
        await safeExecute(cmd, params, timeout, delay);
      };

      if (!isTaskCompleted(2)) {
        await runOptional("system_mysharecallback", { isSkipShareCard: true, type: 2 });
      }
      if (!isTaskCompleted(3) && settings.friendGoldEnable !== false) {
        await runOptional("friend_batch", {});
      }
      if (!isTaskCompleted(4) && settings.recruitEnable !== false) {
        await runOptional("hero_recruit", { recruitType: 3, recruitNumber: 1 });
        if (settings.payRecruit) {
          await runOptional("hero_recruit", { recruitType: 1, recruitNumber: 1 });
        }
      }
      if (!isTaskCompleted(6) && isTodayAvailable(statisticsTime["buy:gold"])) {
        for (let i = 0; i < 3; i += 1) {
          await runOptional("system_buygold", { buyNum: 1 });
        }
      }
      if (!isTaskCompleted(5)) {
        await runOptional("system_claimhangupreward", {});
        for (let i = 0; i < 4; i += 1) {
          await runOptional("system_mysharecallback", { isSkipShareCard: true, type: 2 });
        }
      }
      if (!isTaskCompleted(7) && settings.openBox) {
        await runOptional("item_openbox", { itemId: 2001, number: 10 });
      }
      await runOptional("bottlehelper_stop", {});
      await runOptional("bottlehelper_start", {});
      if (!isTaskCompleted(14)) {
        await runOptional("bottlehelper_claim", {});
      }

      if (!isTaskCompleted(13) && todayHour >= 6 && todayHour <= 22) {
        const arenaFormation = Math.max(
          1,
          Math.min(6, Number(row?.arenaConfig?.arenaFormation || 1)),
        );
        await switchToFormationIfNeeded(arenaFormation);
        await runOptional("arena_startarea", {});
        for (let i = 0; i < 3; i += 1) {
          let targets = null;
          try {
            targets = await executeGameCommand("arena_getareatarget", {}, 8_000, 150);
          } catch {
            break;
          }
          const targetId = pickArenaTargetId(targets);
          if (!targetId) {
            break;
          }
          await runOptional("fight_startareaarena", { targetId }, 12_000, 600);
        }
      }

      if (settings.legionBossEnable !== false && settings.bossTimes > 0) {
        let alreadyLegionBoss = Number(statistics["legion:boss"] || 0);
        if (isTodayAvailable(statisticsTime["legion:boss"])) {
          alreadyLegionBoss = 0;
        }
        const remaining = Math.max(settings.bossTimes - alreadyLegionBoss, 0);
        if (remaining > 0) {
          const formation =
            settings.legionBossFormation || settings.dailyBossFormation || 1;
          await switchToFormationIfNeeded(formation);
          for (let i = 0; i < remaining; i += 1) {
            await runOptional("fight_startlegionboss", {}, 12_000, 700);
          }
        }
      }

      if (settings.dailyBossEnable !== false) {
        const formation =
          settings.dailyBossFormation || settings.legionBossFormation || 1;
        await switchToFormationIfNeeded(formation);
        const todayBossId = getTodayBossId();
        for (let i = 0; i < 3; i += 1) {
          await runOptional("fight_startboss", { bossId: todayBossId }, 12_000, 700);
        }
      }

      await runOptional("system_signinreward", {});
      await runOptional("legion_signin", {});
      await runOptional("discount_claimreward", {});
      await runOptional("collection_claimfreereward", {});
      await runOptional("card_claimreward", {});
      await runOptional("card_claimreward", { cardId: 4003 });
      await runOptional("mail_claimallattachment", {});
      await runOptional("collection_goodslist", {});
      await runOptional("collection_claimfreereward", {});

      if (settings.freeFishEnable !== false) {
        for (let i = 0; i < 3; i += 1) {
          await runOptional(
            "artifact_lottery",
            { lotteryNumber: 1, newFree: true, type: 1 },
            8_000,
            400,
          );
        }
      }
      for (let gid = 1; gid <= 4; gid += 1) {
        if (isTodayAvailable(statisticsTime[`genie:daily:free:${gid}`])) {
          await runOptional("genie_sweep", { genieId: gid }, 8_000, 300);
        }
      }
      for (let i = 0; i < 3; i += 1) {
        await runOptional("genie_buysweep", {}, 8_000, 250);
      }
      if (!isTaskCompleted(12)) {
        await runOptional("store_purchase", { goodsId: 1 }, 8_000, 300);
      }

      const dayOfWeek = new Date().getDay();
      if (settings.mengjingEnable !== false && [0, 1, 3, 4].includes(dayOfWeek)) {
        await runOptional("dungeon_selecthero", { battleTeam: { 0: 107 } }, 8_000, 300);
      }
      if (dayOfWeek === 1 && isTodayAvailable(statisticsTime["genie:daily:free:5"])) {
        await runOptional("genie_sweep", { genieId: 5, sweepCnt: 1 }, 8_000, 300);
      }

      if (originalFormation) {
        await runOptional(
          "presetteam_saveteam",
          { teamId: originalFormation },
          8_000,
          200,
        );
      }

      for (let taskNum = 1; taskNum <= 10; taskNum += 1) {
        await runOptional("task_claimdailypoint", { taskId: taskNum }, 8_000, 200);
      }
      await runOptional("task_claimdailyreward", {}, 8_000, 250);
      await runOptional("task_claimweekreward", {}, 8_000, 250);
      await runOptional(
        "activity_recyclewarorderrewardclaim",
        { actId: 1 },
        8_000,
        250,
      );

      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "hangup") {
      await sendCommand(state, "system_claimhangupreward", {});
      await sleep(400);
      for (let i = 0; i < 4; i += 1) {
        await sendCommand(state, "system_mysharecallback", {
          isSkipShareCard: true,
          type: 2,
        });
        await sleep(400);
      }
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "bottle") {
      await sendCommand(state, "bottlehelper_stop", {});
      await sleep(400);
      await sendCommand(state, "bottlehelper_start", {});
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "legacy") {
      await sendCommand(state, "legacy_claimhangup", {});
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "club-store") {
      const goodsIds = Array.isArray(row?.clubStore?.goodsIds)
        ? row.clubStore.goodsIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        : [6];
      const dedupIds = [...new Set(goodsIds)];
      for (const goodsId of dedupIds) {
        await sendCommand(state, "legion_storebuygoods", { id: goodsId });
        await sleep(350);
      }
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "claim-car") {
      const carInfo = await sendCommand(state, "car_getrolecar", {}, 12_000);
      const carList = normalizeCars(carInfo?.body ?? carInfo);
      let researchLevel = Number(carInfo?.roleCar?.research?.[1] || 0);
      for (const car of carList) {
        if (!canClaim(car)) continue;
        await sendCommand(
          state,
          "car_claim",
          { carId: String(car.id) },
          12_000,
        );
        await sleep(300);
        let roleInfo = await sendCommand(state, "role_getroleinfo", {}, 8_000);
        let refreshPieces = Number(roleInfo?.role?.items?.[35009]?.quantity || 0);
        while (
          researchLevel < CarresearchItem.length
          && refreshPieces >= Number(CarresearchItem[researchLevel] || Number.MAX_SAFE_INTEGER)
        ) {
          try {
            await sendCommand(state, "car_research", { researchId: 1 }, 8_000);
            researchLevel += 1;
            await sleep(300);
            roleInfo = await sendCommand(state, "role_getroleinfo", {}, 8_000);
            refreshPieces = Number(roleInfo?.role?.items?.[35009]?.quantity || 0);
          } catch {
            break;
          }
        }
        try {
          await sendCommand(state, "car_claimpartconsumereward", {}, 8_000);
        } catch {
          // ignore
        }
      }
      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    if (taskId === "send-car") {
      const globalSmartCar = normalizeSmartCarSettings(row?.smartCar);
      const smartCarOverride = row?.smartCarByToken?.[tokenId];
      const smartCar = smartCarOverride
        ? { ...globalSmartCar, ...normalizeSmartCarSettings(smartCarOverride) }
        : globalSmartCar;
      const minColor = Math.max(1, Math.min(6, Number(smartCar.carMinColor || 4)));
      const useGoldRefreshFallback = smartCar.useGoldRefreshFallback === true;
      const matchAll = smartCar.smartDepartureMatchAll === true;
      const customConditions = {
        gold: Number(smartCar.smartDepartureGoldThreshold || 0),
        recruit: Number(smartCar.smartDepartureRecruitThreshold || 0),
        jade: Number(smartCar.smartDepartureJadeThreshold || 0),
        ticket: Number(smartCar.smartDepartureTicketThreshold || 0),
      };
      const maxRefreshAttempts = Math.max(
        1,
        Number(
          smartCar.smartDepartureMaxRefreshAttempts
          || smartCar.smartDepartureMaxRefreshTimes
          || 30,
        ) || 30,
      );
      const actionDelay = Math.max(100, Number(smartCar.actionDelay || 400));
      const refreshDelay = Math.max(200, Number(smartCar.refreshDelay || 600));
      const carInfo = await sendCommand(state, "car_getrolecar", {}, 12_000);
      const carList = normalizeCars(carInfo?.body ?? carInfo);
      let roleInfo = null;
      let refreshTickets = 0;
      let currentRoleId = null;
      try {
        roleInfo = await sendCommand(state, "role_getroleinfo", {}, 8_000);
        refreshTickets = Number(roleInfo?.role?.items?.[35002]?.quantity || 0);
        currentRoleId = roleInfo?.role?.roleId ? String(roleInfo.role.roleId) : null;
      } catch {
        refreshTickets = 0;
      }
      let helperUsageMap = {};
      let sortedHelpers = [];
      const lineupAnalysisEnabled = smartCar.helperLineupAnalysisEnabled !== false;
      const preferredLineupKeywords = normalizeLineupKeywords(
        smartCar.helperPreferredLineups,
      );
      const updateHelperUsage = async () => {
        try {
          const usageRes = await sendCommand(
            state,
            "car_getmemberhelpingcnt",
            {},
            8_000,
          );
          const usageMap =
            usageRes?.body?.memberHelpingCntMap
            || usageRes?.memberHelpingCntMap
            || {};
          helperUsageMap = usageMap && typeof usageMap === "object" ? usageMap : {};
        } catch {
          // ignore helper usage errors
        }
      };
      try {
        await updateHelperUsage();
        const legionRes = await sendCommand(state, "legion_getinfo", {}, 8_000);
        const membersMap =
          legionRes?.body?.info?.members || legionRes?.info?.members || {};
        sortedHelpers = Object.values(membersMap)
          .filter((member) => !currentRoleId || String(member?.roleId || "") !== currentRoleId)
          .map((member) => ({
            id: String(member?.roleId || "").trim(),
            name: String(member?.name || member?.nickname || member?.roleId || "").trim(),
            redQuench: Number(member?.custom?.red_quench_cnt || 0),
            lineupText: extractMemberLineupText(member),
          }))
          .filter((member) => member.id)
          .map((member) => {
            const lineupLower = String(member.lineupText || "").toLowerCase();
            const lineupPriority =
              lineupAnalysisEnabled && preferredLineupKeywords.length > 0
                ? preferredLineupKeywords.findIndex((kw) =>
                    lineupLower.includes(String(kw).toLowerCase()),
                  )
                : -1;
            return {
              ...member,
              lineupPriority:
                lineupPriority >= 0 ? lineupPriority : EMPTY_PRIORITY,
            };
          })
          .sort((a, b) => {
            if (a.lineupPriority !== b.lineupPriority) {
              return a.lineupPriority - b.lineupPriority;
            }
            return b.redQuench - a.redQuench;
          });
      } catch {
        sortedHelpers = [];
      }
      const assignHelperIfNeeded = async (car) => {
        const color = Number(car?.color || 0);
        if (color < 5) return 0;
        if (car?.helperId) return String(car.helperId);
        await updateHelperUsage();
        if (!sortedHelpers.length) return 0;
        const bestHelper = sortedHelpers.find((helper) => {
          const used = Number(helperUsageMap[helper.id] || 0);
          return used < 4;
        });
        if (!bestHelper) return 0;
        helperUsageMap[bestHelper.id] = Number(helperUsageMap[bestHelper.id] || 0) + 1;
        car.helperId = bestHelper.id;
        return String(bestHelper.id);
      };
      const sendCar = async (car) => {
        const helperId = await assignHelperIfNeeded(car);
        await sendCommand(
          state,
          "car_send",
          {
            carId: String(car.id),
            helperId: helperId || 0,
            text: "",
            isUpgrade: false,
          },
          12_000,
        );
      };

      for (const car of carList) {
        if (Number(car?.sendAt || 0) !== 0) continue;
        try {
          const shouldSendImmediately = shouldSendCar(
            car,
            useGoldRefreshFallback ? 999 : refreshTickets,
            minColor,
            customConditions,
            useGoldRefreshFallback,
            matchAll,
          );
          if (shouldSendImmediately) {
            await sendCar(car);
            await sleep(actionDelay);
            continue;
          }

          let shouldRefresh = false;
          const free = Number(car?.refreshCount ?? 0) === 0;
          const useGoldFallbackNow =
            useGoldRefreshFallback && !free && refreshTickets < 6;
          if (refreshTickets >= 6 || free || useGoldFallbackNow) {
            shouldRefresh = true;
          }
          if (!shouldRefresh) {
            await sendCar(car);
            await sleep(actionDelay);
            continue;
          }

          let refreshAttempts = 0;
          while (shouldRefresh) {
            refreshAttempts += 1;
            if (refreshAttempts > maxRefreshAttempts) {
              await sendCar(car);
              await sleep(actionDelay);
              break;
            }
            const refreshed = await sendCommand(
              state,
              "car_refresh",
              { carId: String(car.id) },
              12_000,
            );
            const data = refreshed?.car || refreshed?.body?.car || refreshed;
            if (data && typeof data === "object") {
              if (data.color != null) car.color = Number(data.color);
              if (data.refreshCount != null) car.refreshCount = Number(data.refreshCount);
              if (data.rewards != null) car.rewards = data.rewards;
            }
            await sleep(refreshDelay);
            try {
              roleInfo = await sendCommand(state, "role_getroleinfo", {}, 8_000);
              refreshTickets = Number(roleInfo?.role?.items?.[35002]?.quantity || 0);
            } catch {
              refreshTickets = 0;
            }

            const shouldSendAfterRefresh = shouldSendCar(
              car,
              useGoldRefreshFallback ? 999 : refreshTickets,
              minColor,
              customConditions,
              useGoldRefreshFallback,
              matchAll,
            );
            if (shouldSendAfterRefresh) {
              await sendCar(car);
              await sleep(actionDelay);
              break;
            }

            const freeNow = Number(car?.refreshCount ?? 0) === 0;
            const useGoldFallbackAfterRefresh =
              useGoldRefreshFallback && !freeNow && refreshTickets < 6;
            if (!(refreshTickets >= 6 || freeNow || useGoldFallbackAfterRefresh)) {
              await sendCar(car);
              await sleep(actionDelay);
              break;
            }
          }
        } catch {
          // 单车失败不影响该账号后续车辆
          continue;
        }
      }

      return { roleName: resolvedRoleName, serverName: resolvedServerName };
    }

    throw new Error(`任务 ${taskId} 暂不支持后端执行`);
  } finally {
    await closeWs(state);
  }
};

const executeTaskRow = async ({ user, row }) => {
  const meta = TASK_META[row.id] || { title: row.id || "任务", taskName: row.id || "unknown" };
  const tokenNameMap =
    row?.tokenNameMap && typeof row.tokenNameMap === "object"
      ? row.tokenNameMap
      : {};
  const resolveTokenLabel = (tokenId) => {
    const id = String(tokenId || "").trim();
    if (!id) return "未知账号";
    const candidate = String(tokenNameMap[id] || "").trim();
    return candidate || id;
  };
  const formatTokenHint = (tokenId) => `token:${maskTokenIdForLog(tokenId)}`;
  if (!SUPPORTED_TASK_IDS.has(row.id)) {
    appendSystemLog({
      userId: user.id,
      taskId: row.id,
      taskName: meta.title,
      status: "warning",
      message: `后端调度已命中，但任务“${meta.title}”暂不支持服务端执行`,
    });
    return;
  }

  if ((row.id === "send-car" || row.id === "claim-car") && !isCarTaskActivityOpen(new Date())) {
    appendSystemLog({
      userId: user.id,
      taskId: row.id,
      taskName: meta.title,
      status: "warning",
      message: "当前不在发车活动开放时段（周一至周三 06:00后），本次自动执行已跳过",
    });
    return;
  }

  const allBinTokenIds = (await listBinFiles({ user })).map((item) => item.tokenId);
  const configuredTokenIds = Array.isArray(row?.tokenIds)
    ? [...new Set(row.tokenIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  if (configuredTokenIds.length > 0) {
    const missingConfiguredTokenIds = configuredTokenIds.filter(
      (id) => !allBinTokenIds.includes(id),
    );
    if (missingConfiguredTokenIds.length > 0) {
      const labels = missingConfiguredTokenIds
        .map((id) => `${resolveTokenLabel(id)}(${formatTokenHint(id)})`)
        .join("、");
      appendSystemLog({
        userId: user.id,
        taskId: row.id,
        taskName: meta.title,
        status: "warning",
        message: `检测到 ${missingConfiguredTokenIds.length} 个已绑定账号缺少 BIN，已跳过: ${labels}`,
      });
    }
  }
  const tokenIds = await resolveExecutableTokenIds({
    user,
    row,
    allBinTokenIds,
  });

  if (tokenIds.length === 0) {
    appendSystemLog({
      userId: user.id,
      taskId: row.id,
      taskName: meta.title,
      status: "warning",
      message: "无可执行账号：请先导入 BIN 并确保任务已绑定 token",
    });
    return;
  }

  appendSystemLog({
    userId: user.id,
    taskId: row.id,
    taskName: meta.title,
    status: "info",
    message: `后端调度开始执行，账号数 ${tokenIds.length}`,
  });

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const nowTs = Date.now();
  for (const tokenId of tokenIds) {
    const tokenLabel = resolveTokenLabel(tokenId);
    const activation = await resolveTokenActivationForExecution({
      user,
      row,
      tokenId,
      nowTs,
    });
    if (!activation.active) {
      skipped += 1;
      appendSystemLog({
        userId: user.id,
        taskId: row.id,
        taskName: meta.title,
        status: "warning",
        message: `账号 ${tokenLabel} (${formatTokenHint(tokenId)}) 已跳过: ${activation.reason}`,
      });
      continue;
    }
    try {
      const taskResult = await enqueueTokenExecution({
        onQueued: (ahead) => {
          appendSystemLog({
            userId: user.id,
            taskId: row.id,
            taskName: meta.title,
            status: "info",
            message: `账号 ${tokenLabel} (${formatTokenHint(tokenId)}) 已进入执行队列，前方排队 ${ahead} 个`,
          });
        },
        onStarted: (ahead) => {
          appendSystemLog({
            userId: user.id,
            taskId: row.id,
            taskName: meta.title,
            status: "info",
            message:
              ahead > 0
                ? `账号 ${tokenLabel} (${formatTokenHint(tokenId)}) 开始执行（进入队列时前方 ${ahead} 个）`
                : `账号 ${tokenLabel} (${formatTokenHint(tokenId)}) 开始执行`,
          });
        },
        job: async () => {
          const token = await getActualTokenByBin({ user, tokenId });
          const resolvedWsUrl = sanitizeTaskControlWsUrl(
            row?.wsUrlByToken?.[tokenId] || row?.wsUrl || "",
            {
              allowCustom: TASK_CONTROL_CUSTOM_WS_URL_ENABLED,
              allowlist: TASK_CONTROL_CUSTOM_WS_URL_ALLOWLIST,
            },
          );
          return runTaskByToken({
            taskId: row.id,
            row,
            tokenId,
            token,
            wsUrl: resolvedWsUrl,
          });
        },
      });
      const roleLabel = String(taskResult?.roleName || "").trim() || resolveTokenLabel(tokenId);
      const serverLabel = String(taskResult?.serverName || "").trim() || "未知区服";
      success += 1;
      appendSystemLog({
        userId: user.id,
        taskId: row.id,
        taskName: meta.title,
        status: "success",
        message: `账号 ${roleLabel} (${serverLabel}, ${formatTokenHint(tokenId)}) 执行成功`,
      });
    } catch (error) {
      failed += 1;
      appendSystemLog({
        userId: user.id,
        taskId: row.id,
        taskName: meta.title,
        status: "error",
        message: `账号 ${tokenLabel} (${formatTokenHint(tokenId)}) 执行失败: ${formatExecutionErrorMessage(error)}`,
      });
    }
  }

  appendSystemLog({
    userId: user.id,
    taskId: row.id,
    taskName: meta.title,
    status: failed > 0 ? "warning" : "success",
    message: `后端调度执行完成：成功 ${success}，失败 ${failed}，跳过 ${skipped}`,
  });
};

const runSchedulerTick = async () => {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const states = taskControlRepository.listStateRows();
    const now = new Date();
    const nowMinuteKey = minuteKey(now);
    const nowTs = now.getTime();
    const previousTickAt = lastSchedulerTickAt;
    lastSchedulerTickAt = nowTs;

    for (const state of states) {
      const user = userRepository.findById(state.userId);
      if (!user) continue;
      const quietWindowEnabled = isQuietWindowEnabledForUser(user.id);
      const quietReason = getQuietWindowReason(now, quietWindowEnabled);
      const inQuietWindow = !!quietReason;

      const rows = parseTaskRows(state.payloadJson);
      let stateChanged = false;
      let triggeredTaskCount = 0;
      for (const row of rows) {
        const meta = TASK_META[row.id] || { title: row.id || "任务" };
        if (!row?.enabled || !row?.cronExpr || !row?.id) continue;
        const hasRollingInterval = !!getHourlyIntervalFromCron(row?.cronExpr) && !!row?.lastRunAt;
        const shouldRunByInterval = hasRollingInterval
          ? isIntervalDueNow(row, nowTs)
          : false;
        const dueCronMinuteKey = hasRollingInterval
          ? ""
          : findDueCronMinuteKey(row, nowTs, previousTickAt);
        const shouldRunByCron = !hasRollingInterval && !!dueCronMinuteKey;
        const shouldRunNow = shouldRunByInterval || shouldRunByCron;
        if (inQuietWindow) {
          if (shouldRunNow && !row.quietDeferredAt) {
            row.quietDeferredAt = now.toISOString();
            row.quietDeferredReason = quietReason;
            stateChanged = true;
            appendSystemLog({
              userId: user.id,
              taskId: row.id,
              taskName: meta.title,
              status: "warning",
              message: `命中${formatQuietWindowReason(quietReason)}，任务已自动延后，窗口结束后将补跑`,
            });
          }
          continue;
        }
        if (row.quietDeferredAt) {
          if (triggeredTaskCount >= MAX_AUTO_TASKS_PER_USER_PER_TICK) {
            appendSystemLog({
              userId: user.id,
              taskId: row.id,
              taskName: meta.title,
              status: "warning",
              message: `单轮调度任务数超限（上限 ${MAX_AUTO_TASKS_PER_USER_PER_TICK}），补跑任务已延后到下一轮`,
            });
            break;
          }
          const triggerMinuteKey = `${nowMinuteKey}:quiet_deferred`;
          if (row.lastAutoMinuteKey === triggerMinuteKey) continue;
          const guardKey = `${user.id}:${row.id}:${triggerMinuteKey}`;
          if (minuteRunGuard.has(guardKey)) continue;
          minuteRunGuard.set(guardKey, Date.now());
          appendSystemLog({
            userId: user.id,
            taskId: row.id,
            taskName: meta.title,
            status: "info",
            message: `检测到延后任务，开始补跑（原因：${formatQuietWindowReason(String(row.quietDeferredReason || ""))}）`,
          });
          row.lastRunAt = now.toISOString();
          row.lastAutoMinuteKey = triggerMinuteKey;
          row.quietDeferredAt = "";
          row.quietDeferredReason = "";
          triggeredTaskCount += 1;
          stateChanged = true;
          executeTaskRow({ user, row }).catch((error) => {
            appendSystemLog({
              userId: user.id,
              taskId: row.id,
              taskName: TASK_META[row.id]?.title || row.id,
              status: "error",
              message: `后端调度任务异常: ${error.message || "未知错误"}`,
            });
          });
          continue;
        }
        if (!shouldRunNow) continue;
        if (triggeredTaskCount >= MAX_AUTO_TASKS_PER_USER_PER_TICK) {
          appendSystemLog({
            userId: user.id,
            taskId: row.id,
            taskName: meta.title,
            status: "warning",
            message: `单轮调度任务数超限（上限 ${MAX_AUTO_TASKS_PER_USER_PER_TICK}），剩余任务已延后到下一轮`,
          });
          break;
        }
        const triggerMinuteKey = shouldRunByCron ? dueCronMinuteKey : nowMinuteKey;
        if (row.lastAutoMinuteKey === triggerMinuteKey) continue;
        const guardKey = `${user.id}:${row.id}:${triggerMinuteKey}`;
        if (minuteRunGuard.has(guardKey)) continue;
        minuteRunGuard.set(guardKey, Date.now());
        // Align with frontend behavior: execution attempt updates lastRunAt.
        row.lastRunAt = now.toISOString();
        row.lastAutoMinuteKey = triggerMinuteKey;
        triggeredTaskCount += 1;
        stateChanged = true;
        // detach async execution from main scheduler loop
        executeTaskRow({ user, row }).catch((error) => {
          appendSystemLog({
            userId: user.id,
            taskId: row.id,
            taskName: TASK_META[row.id]?.title || row.id,
            status: "error",
            message: `后端调度任务异常: ${error.message || "未知错误"}`,
          });
        });
      }
      if (stateChanged) {
        const ts = nowIso();
        taskControlRepository.upsertState({
          userId: user.id,
          payloadJson: JSON.stringify({ tasks: rows }),
          createdAt: ts,
          updatedAt: ts,
        });
      }
    }

    const expireBefore = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of minuteRunGuard.entries()) {
      if (ts < expireBefore) {
        minuteRunGuard.delete(key);
      }
    }
  } finally {
    schedulerRunning = false;
  }
};

export const startTaskControlSchedulerJob = () => {
  if (schedulerTimer) {
    return {
      stop: () => {
        if (!schedulerTimer) return;
        clearInterval(schedulerTimer);
        schedulerTimer = null;
      },
      isRunning: () => Boolean(schedulerTimer),
      waitForIdle: async (timeoutMs = 5000) => {
        const startedAt = Date.now();
        while (schedulerRunning) {
          if (Date.now() - startedAt >= timeoutMs) {
            return false;
          }
          await sleep(50);
        }
        return true;
      },
    };
  }
  // eslint-disable-next-line no-console
  console.log("[task-control-scheduler] started (backend-native beta)");
  runSchedulerTick();
  schedulerTimer = setInterval(runSchedulerTick, CHECK_INTERVAL_MS);
  if (typeof schedulerTimer.unref === "function") {
    schedulerTimer.unref();
  }

  return {
    stop: () => {
      if (!schedulerTimer) return;
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    },
    isRunning: () => Boolean(schedulerTimer),
    waitForIdle: async (timeoutMs = 5000) => {
      const startedAt = Date.now();
      while (schedulerRunning) {
        if (Date.now() - startedAt >= timeoutMs) {
          return false;
        }
        await sleep(50);
      }
      return true;
    },
  };
};
