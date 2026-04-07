const inferArenaRecordWinState = (record) => {
  if (typeof record?.isWin === "boolean")
    return record.isWin;
  const scoreDelta = Number(record?.scoreDelta);
  if (Number.isFinite(scoreDelta) && scoreDelta !== 0)
    return scoreDelta > 0;
  return null;
};

const appendArenaRecordStats = (map, key, isWin) => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey)
    return;
  const prev = map.get(normalizedKey) || { wins: 0, total: 0 };
  map.set(normalizedKey, {
    wins: prev.wins + (isWin ? 1 : 0),
    total: prev.total + 1,
  });
};

const buildArenaRecordStatsLookups = (records = []) => {
  const byRoleId = new Map();
  const byName = new Map();
  for (const record of records || []) {
    const isWin = inferArenaRecordWinState(record);
    if (isWin === null)
      continue;
    appendArenaRecordStats(byRoleId, record?.roleId, isWin);
    appendArenaRecordStats(byName, record?.name, isWin);
  }
  return { byRoleId, byName };
};

const resolveArenaTargetStats = (item, targetWinStats = {}, recordLookups = null) => {
  const roleIdKey = String(item?.id || "").trim();
  const nameKey = String(item?.name || "").trim();
  const recordStats
    = recordLookups?.byRoleId?.get(roleIdKey)
      || recordLookups?.byName?.get(nameKey)
      || null;
  const stats = recordStats?.total > 0 ? recordStats : targetWinStats?.[roleIdKey];
  const total = Math.max(0, Number(stats?.total || 0));
  const wins = Math.max(0, Number(stats?.wins || 0));
  const known = total > 0;
  const rate = known ? (wins / total) * 100 : -1;
  return { known, wins, total, rate };
};

export const sortArenaTargetsByWinRatePreference = (
  available = [],
  targetWinStats = {},
  preferredWinRate = null,
  arenaRecords = [],
) => {

  const hasExplicitPreferredWinRate = !(
    preferredWinRate === null
    || preferredWinRate === undefined
    || String(preferredWinRate).trim() === ""
  );
  const numericPreferredWinRate = Number(preferredWinRate);
  const hasPreferredWinRate
    = hasExplicitPreferredWinRate
      && Number.isFinite(numericPreferredWinRate)
      && numericPreferredWinRate >= 0
      && numericPreferredWinRate <= 100;
  const recordLookups = buildArenaRecordStatsLookups(arenaRecords);
  const fallbackOrder = new Map(
    (available || []).map((item, index) => [String(item?.id || ""), index]),
  );

  const resolveStatsMeta = (item) => {
    const stats = resolveArenaTargetStats(item, targetWinStats, recordLookups);
    const meetsThreshold = hasPreferredWinRate && stats.known && stats.rate >= numericPreferredWinRate;
    const group = hasPreferredWinRate
      ? meetsThreshold
        ? 0
        : stats.known
          ? 2
          : 1
      : stats.known
        ? 0
        : 1;
    return {
      ...stats,
      group,
      meetsThreshold,
      fallbackIndex: fallbackOrder.get(String(item?.id || "")) ?? Number.MAX_SAFE_INTEGER,
    };
  };

  return [...available].sort((a, b) => {
    const metaA = resolveStatsMeta(a);
    const metaB = resolveStatsMeta(b);

    if (metaA.group !== metaB.group)
      return metaA.group - metaB.group;

    if (metaA.group === 0 && metaA.known && metaB.known) {
      if (metaA.rate !== metaB.rate)
        return metaB.rate - metaA.rate;
      if (metaA.total !== metaB.total)
        return metaB.total - metaA.total;
    }
    return metaA.fallbackIndex - metaB.fallbackIndex;
  });
};

export function useArenaPvpTargeting({
  tokenStore,
  t,
  roleInfo,
  myRoleId,
  rankList,
  targetWinStats,
  preferredWinRate,
  arenaRecords,
  arenaTargetProfileCache,
  saveTargetWinStats,
  getLineupType,
  formatPower,
  normalizeHeadImg,
  normalizeRoleId,
  extractHeadImgFromPayload,
  isUsableHeadImg,
  toArray,
  toInteger,
  toIntegerOrNull,
  toPositiveInteger,
  resolveManualLineupType,
  isSkippedLineupType,
}) {
  const toHeroArray = (source) => {
    const list = toArray(source);
    return list
      .map((item) => {
        const heroId = Number(item?.heroId || item?.id || 0);
        return Number.isFinite(heroId) && heroId > 0 ? { heroId } : null;
      })
      .filter(Boolean);
  };

  const tryGetLineupTypeFromPayload = (payload) => {
    if (!payload || typeof payload !== "object")
      return "";

    const directLineupType = String(
      payload?.lineupType || payload?.lineup || payload?.teamType || "",
    ).trim();
    if (directLineupType)
      return directLineupType;

    const heroCandidates = [
      ...toHeroArray(payload?.heroList),
      ...toHeroArray(payload?.heroes),
      ...toHeroArray(payload?.teamInfo),
      ...toHeroArray(payload?.teamInfo?.team),
      ...toHeroArray(payload?.teamInfo?.heroes),
      ...toHeroArray(payload?.team?.heroes),
      ...toHeroArray(payload?.team),
      ...toHeroArray(payload?.targetTeam?.heroes),
      ...toHeroArray(payload?.targetTeam?.team),
    ];

    if (!heroCandidates.length)
      return "";
    return getLineupType(heroCandidates);
  };

  const updateTargetWinStats = (tokenId, target, isWin) => {
    const id = normalizeRoleId(target?.id);
    if (!id || typeof isWin !== "boolean")
      return;

    const existing = targetWinStats.value[id] || {
      id,
      name: "",
      wins: 0,
      total: 0,
      updatedAt: 0,
    };

    const next = {
      ...existing,
      name: target?.name || existing.name || id,
      wins: existing.wins + (isWin ? 1 : 0),
      total: existing.total + 1,
      updatedAt: Date.now(),
    };

    targetWinStats.value = {
      ...targetWinStats.value,
      [id]: next,
    };
    saveTargetWinStats(tokenId);
  };

  const normalizeArenaRankList = (payload) => {
    const rawList
      = payload?.list
        || payload?.rankList
        || payload?.arenaRankList
        || payload?.data?.list
        || [];
    const candidates = toArray(rawList)
      .map((item, index) => ({
        roleId: String(item?.roleId || item?.id || ""),
        name: item?.name || item?.roleName || "",
        rank: Number(item?.rank || index + 1),
        score: toInteger(item?.score ?? item?.point ?? 0),
        power: Number(item?.power || 0),
        powerText: formatPower(item?.power || 0),
        headImg: extractHeadImgFromPayload(item),
        lineupType:
          resolveManualLineupType(item?.roleId || item?.id, item?.name || item?.roleName)
          || tryGetLineupTypeFromPayload(item)
          || t("arenaPvpCard.common.unknown"),
        raw: item,
      }))
      .filter((item) => item.roleId || item.name);

    return candidates.sort((a, b) => {
      const rankA = Number.isFinite(a.rank) && a.rank > 0 ? a.rank : Number.MAX_SAFE_INTEGER;
      const rankB = Number.isFinite(b.rank) && b.rank > 0 ? b.rank : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB)
        return rankA - rankB;
      return (b.score || 0) - (a.score || 0);
    });
  };

  const extractSelfArenaInfoFromStartArea = (payload) => {
    const areaArena = payload?.areaArena || payload?.body?.areaArena;
    if (!areaArena || typeof areaArena !== "object")
      return null;

    const phaseList = toArray(areaArena?.phaseInfo).filter((item) => item && typeof item === "object");
    const latestPhase = phaseList
      .slice()
      .sort((a, b) => {
        const timeA = Number(a?.createTime || 0);
        const timeB = Number(b?.createTime || 0);
        if (timeA !== timeB)
          return timeB - timeA;
        const phaseA = String(a?.phase || "");
        const phaseB = String(b?.phase || "");
        return phaseB.localeCompare(phaseA);
      })[0];

    if (!latestPhase)
      return null;

    const rank = Number(
      latestPhase?.weekRank
      ?? latestPhase?.rank
      ?? areaArena?.weekRank
      ?? areaArena?.rank
      ?? 0,
    );
    const score = toInteger(
      latestPhase?.score
      ?? latestPhase?.point
      ?? areaArena?.score
      ?? areaArena?.point,
    );

    return {
      roleId: myRoleId.value || "",
      name: String(roleInfo.value?.name || ""),
      rank,
      score,
      power: Number(roleInfo.value?.power || 0),
      powerText: formatPower(roleInfo.value?.power || 0),
      headImg: normalizeHeadImg(roleInfo.value?.headImg || ""),
      lineupType: t("arenaPvpCard.common.unknown"),
      raw: latestPhase,
    };
  };

  const extractSelfArenaInfo = (payload, normalizedRankList, fallbackInfo = null) => {
    const roleId = myRoleId.value;
    const fromList = normalizedRankList.find((item) => item.roleId === roleId);
    if (fromList)
      return fromList;

    const candidate
      = payload?.myInfo
        || payload?.selfInfo
        || payload?.myRankInfo
        || payload?.self
        || payload?.mine
        || payload?.roleInfo;

    if (!candidate || typeof candidate !== "object")
      return fallbackInfo || null;

    const extractedRank = toPositiveInteger(candidate?.rank);
    const extractedScore = toIntegerOrNull(candidate?.score ?? candidate?.point);
    const fallbackRank = toPositiveInteger(fallbackInfo?.rank);
    const fallbackScore = toIntegerOrNull(fallbackInfo?.score);

    return {
      roleId: String(candidate?.roleId || candidate?.id || roleId || ""),
      name: candidate?.name || candidate?.roleName || "",
      rank: extractedRank > 0 ? extractedRank : fallbackRank,
      score: extractedScore !== null ? extractedScore : fallbackScore,
      power: Number(candidate?.power || 0),
      powerText: formatPower(candidate?.power || 0),
      headImg: extractHeadImgFromPayload(candidate),
      lineupType: tryGetLineupTypeFromPayload(candidate) || t("arenaPvpCard.common.unknown"),
      raw: candidate,
    };
  };

  const buildArenaTargetCandidates = (targets) => {
    const rawCandidates = [
      ...toArray(targets?.rankList),
      ...toArray(targets?.roleList),
      ...toArray(targets?.targets),
      ...toArray(targets?.targetList),
      ...toArray(targets?.list),
      ...(targets?.target ? [targets.target] : []),
    ];

    if (!rawCandidates.length && (targets?.roleId || targets?.id)) {
      rawCandidates.push({
        roleId: targets?.roleId || targets?.id,
        name: targets?.name || targets?.roleName || "",
      });
    }

    const dedup = new Map();
    for (const item of rawCandidates) {
      const roleId = normalizeRoleId(item?.roleId || item?.id);
      if (!roleId || dedup.has(roleId))
        continue;
      dedup.set(roleId, {
        id: roleId,
        name: item?.name || item?.roleName || "",
        raw: item,
      });
    }
    return [...dedup.values()];
  };

  const fetchTargetProfile = async (tokenId, roleId) => {
    const normalizedRoleId = normalizeRoleId(roleId);
    const baseRankParams = {
      bottleType: 0,
      includeBottleTeam: false,
      isSearch: false,
      includeHero: true,
      includeHeroDetail: false,
      includePearl: false,
    };

    const parseProfile = (result) => {
      const roleData = result?.roleInfo || result?.role || {};
      const teamInfo = result?.teamInfo || result?.targetTeam || {};
      const heroes = [
        ...toHeroArray(teamInfo?.team),
        ...toHeroArray(teamInfo?.heroes),
        ...toHeroArray(roleData?.heroes),
        ...toHeroArray(result?.heroes),
      ];
      const lineupType = heroes.length ? getLineupType(heroes) : tryGetLineupTypeFromPayload(result);
      const headImg
        = extractHeadImgFromPayload(teamInfo)
          || extractHeadImgFromPayload(roleData)
          || extractHeadImgFromPayload(result);
      return { lineupType, headImg };
    };

    try {
      const result = await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_gettargetteam",
        {
          targetId: normalizedRoleId,
          teamType: 1,
          cCMonsterId: 0,
        },
        6000,
      );
      return parseProfile(result);
    } catch {
      const maybeNumberRoleId = Number(normalizedRoleId);
      if (!Number.isSafeInteger(maybeNumberRoleId) || maybeNumberRoleId <= 0) {
        return { lineupType: "", headImg: "" };
      }
      try {
        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_gettargetteam",
          {
            targetId: maybeNumberRoleId,
            teamType: 1,
            cCMonsterId: 0,
          },
          6000,
        );
        return parseProfile(result);
      } catch {
        try {
          const result = await tokenStore.sendMessageWithPromise(
            tokenId,
            "rank_getroleinfo",
            {
              ...baseRankParams,
              roleId: normalizedRoleId,
            },
            6000,
          );
          return parseProfile(result);
        } catch {
          try {
            const result = await tokenStore.sendMessageWithPromise(
              tokenId,
              "rank_getroleinfo",
              {
                ...baseRankParams,
                roleId: maybeNumberRoleId,
              },
              6000,
            );
            return parseProfile(result);
          } catch {
            return { lineupType: "", headImg: "" };
          }
        }
      }
    }
  };

  const detectCandidateProfile = async (tokenId, candidate) => {
    if (!candidate?.id)
      return { lineupType: t("arenaPvpCard.common.unknown"), headImg: "" };

    const cachedProfile = arenaTargetProfileCache.value.get(candidate.id);
    const manualLineupType = resolveManualLineupType(candidate.id, candidate.name);

    let lineupType
      = manualLineupType
        || (cachedProfile?.lineupType
          && cachedProfile.lineupType !== t("arenaPvpCard.common.unknown")
          ? cachedProfile.lineupType
          : tryGetLineupTypeFromPayload(candidate.raw));
    let headImg = isUsableHeadImg(cachedProfile?.headImg) ? cachedProfile.headImg : "";
    if (!headImg) {
      const rawHeadImg
        = extractHeadImgFromPayload(candidate.raw) || extractHeadImgFromPayload(candidate);
      headImg = isUsableHeadImg(rawHeadImg) ? rawHeadImg : "";
    }

    if ((!lineupType || !headImg) && !manualLineupType) {
      const profile = await fetchTargetProfile(tokenId, candidate.id);
      if (!lineupType)
        lineupType = profile.lineupType;
      if (!headImg)
        headImg = profile.headImg;
    }

    const finalProfile = {
      lineupType: lineupType || t("arenaPvpCard.common.unknown"),
      headImg: normalizeHeadImg(headImg),
    };

    if (
      finalProfile.lineupType !== t("arenaPvpCard.common.unknown")
      || isUsableHeadImg(finalProfile.headImg)
    ) {
      arenaTargetProfileCache.value.set(candidate.id, finalProfile);
    }
    return finalProfile;
  };

  const enrichRankListLineups = async (tokenId, sourceList) => {
    const topList = (sourceList || []).slice(0, 20);
    if (!topList.length)
      return;

    const nextList = [...(rankList.value || [])];
    for (const item of topList) {
      if (!item?.roleId)
        continue;
      const hasLineup
        = !!item.lineupType && item.lineupType !== t("arenaPvpCard.common.unknown");
      const hasHeadImg = isUsableHeadImg(extractHeadImgFromPayload(item));
      if (hasLineup && hasHeadImg)
        continue;

      const profile = await detectCandidateProfile(tokenId, {
        id: item.roleId,
        name: item.name,
        raw: item.raw || {},
      });

      const idx = nextList.findIndex((entry) => entry.roleId === item.roleId);
      if (idx >= 0) {
        const lineupType
          = profile.lineupType
            || nextList[idx].lineupType
            || t("arenaPvpCard.common.unknown");
        const headImg = profile.headImg || nextList[idx].headImg || "";
        nextList[idx] = {
          ...nextList[idx],
          lineupType,
          headImg,
        };
      }
    }

    rankList.value = nextList;
  };

  const selectArenaTargetWithRules = async (tokenId, targets) => {
    const candidates = buildArenaTargetCandidates(targets);
    if (!candidates.length) {
      return { target: null, skipped: [], allLvZhao: false, prioritizedTop: [] };
    }

    const skipped = [];
    const available = [];
    for (const candidate of candidates) {
      const profile = await detectCandidateProfile(tokenId, candidate);
      const lineupType = profile.lineupType || t("arenaPvpCard.common.unknown");
      if (isSkippedLineupType(lineupType)) {
        skipped.push({
          id: candidate.id,
          name: candidate.name,
          lineupType,
        });
        continue;
      }
      available.push({
        id: candidate.id,
        name: candidate.name,
        lineupType,
        headImg: profile.headImg || "",
      });
    }

    if (available.length === 0) {
      return { target: null, skipped, allLvZhao: true, prioritizedTop: [] };
    }

    const sorted = sortArenaTargetsByWinRatePreference(
      available,
      targetWinStats.value,
      preferredWinRate?.value,
      arenaRecords?.value,
    );
    const recordLookups = buildArenaRecordStatsLookups(arenaRecords?.value || []);

    const prioritizedTop = sorted
      .map((item) => {
        const stats = resolveArenaTargetStats(
          item,
          targetWinStats.value,
          recordLookups,
        );
        if (!stats.known || Number(stats.total) <= 0)
          return null;
        const hasThreshold = !(
          preferredWinRate?.value === null
          || preferredWinRate?.value === undefined
          || String(preferredWinRate.value).trim() === ""
        );
        const numericThreshold = Number(preferredWinRate?.value);
        if (
          hasThreshold
          && Number.isFinite(numericThreshold)
          && stats.rate < numericThreshold
        ) {
          return null;
        }
        const total = Number(stats.total || 0);
        const wins = Number(stats.wins || 0);
        const rate = total > 0 ? ((wins / total) * 100).toFixed(0) : "0";
        return {
          id: item.id,
          name: item.name || item.id,
          rate,
          wins,
          total,
        };
      })
      .filter(Boolean)
      .slice(0, 3);

    return {
      target: sorted[0],
      skipped,
      allLvZhao: false,
      prioritizedTop,
    };
  };

  return {
    enrichRankListLineups,
    extractSelfArenaInfo,
    extractSelfArenaInfoFromStartArea,
    normalizeArenaRankList,
    selectArenaTargetWithRules,
    tryGetLineupTypeFromPayload,
    updateTargetWinStats,
  };
}
