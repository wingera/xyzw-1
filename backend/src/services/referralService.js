import crypto from "node:crypto";
import { env } from "../config/env.js";
import { nowIso, randomId } from "../db/sql.js";
import {
  REFERRAL_FIRST_PURCHASE_RATE_BPS,
  REFERRAL_RENEWAL_GT_2M_RATE_BPS,
} from "../constants/referral.js";
import { normalizeActivationDurationMonths } from "../lib/activationCodeDuration.js";
import { referralProfileRepository } from "../repositories/referralProfileRepository.js";
import { referralAttributionRepository } from "../repositories/referralAttributionRepository.js";
import { referralConversionRepository } from "../repositories/referralConversionRepository.js";

const REFERRAL_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const REFERRAL_CODE_LENGTH = 10;
const isUniqueConstraintError = (error) => {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").trim();
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE"
    || message.includes("UNIQUE constraint failed")
  );
};
const isReferralProfileUniqueConflict = (error, fieldName) =>
  isUniqueConstraintError(error)
  && String(error?.message || "").includes(`referral_profiles.${fieldName}`);

export const normalizeReferralCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

export const maskReferrerDisplayName = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= 2) {
    return text;
  }
  if (text.length <= 4) {
    return `${text.slice(0, 1)}***${text.slice(-1)}`;
  }
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
};

export const generateReferralCode = () => {
  let code = "";
  while (code.length < REFERRAL_CODE_LENGTH) {
    const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
    for (const byte of bytes) {
      code += REFERRAL_CODE_ALPHABET[byte % REFERRAL_CODE_ALPHABET.length];
      if (code.length >= REFERRAL_CODE_LENGTH) {
        break;
      }
    }
  }
  return code;
};

export const buildReferralShareUrl = (referralCode) => {
  const normalized = normalizeReferralCode(referralCode);
  if (!normalized) {
    return "";
  }
  try {
    return new URL(`/r/${encodeURIComponent(normalized)}`, env.publicAppOrigin).toString();
  } catch {
    return `/r/${encodeURIComponent(normalized)}`;
  }
};

export const generateReferralProfileForUser = (userId) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("userId 无效");
  }

  const existing = referralProfileRepository.findByUserId(normalizedUserId);
  if (existing) {
    return {
      ...existing,
      shareUrl: buildReferralShareUrl(existing.referralCode),
    };
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const referralCode = generateReferralCode();
    if (referralProfileRepository.findByCode(referralCode)) {
      continue;
    }
    const timestamp = nowIso();
    const id = randomId("refprof");
    try {
      referralProfileRepository.create({
        id,
        userId: normalizedUserId,
        referralCode,
        createdAt: timestamp,
        updatedAt: timestamp,
        generatedAt: timestamp,
      });
    } catch (error) {
      if (isReferralProfileUniqueConflict(error, "user_id")) {
        const concurrentCreated = referralProfileRepository.findByUserId(normalizedUserId);
        if (concurrentCreated) {
          return {
            ...concurrentCreated,
            shareUrl: buildReferralShareUrl(concurrentCreated.referralCode),
          };
        }
      }
      if (isReferralProfileUniqueConflict(error, "referral_code")) {
        continue;
      }
      throw error;
    }
    const created = referralProfileRepository.findByUserId(normalizedUserId);
    return {
      ...created,
      shareUrl: buildReferralShareUrl(created?.referralCode || referralCode),
    };
  }

  throw new Error("生成推广码失败，请稍后重试");
};

export const attachReferralAttributionOnRegister = ({
  referralCode,
  referredUserId,
  inviteCodeId,
  inviteCodeMask,
  registeredAt,
  registerIp,
  registerUserAgent,
}) => {
  const normalizedCode = normalizeReferralCode(referralCode);
  if (!normalizedCode) {
    return null;
  }

  const profile = referralProfileRepository.findByCode(normalizedCode);
  if (!profile) {
    throw new Error("推广码无效");
  }

  const normalizedReferredUserId = String(referredUserId || "").trim();
  if (!normalizedReferredUserId) {
    throw new Error("referredUserId 无效");
  }
  if (String(profile.userId || "").trim() === normalizedReferredUserId) {
    throw new Error("不能绑定自己的推广码");
  }

  const existing = referralAttributionRepository.findByReferredUserId(normalizedReferredUserId);
  if (existing) {
    return existing;
  }

  const timestamp = String(registeredAt || "").trim() || nowIso();
  referralAttributionRepository.create({
    id: randomId("refattr"),
    referrerUserId: profile.userId,
    referredUserId: normalizedReferredUserId,
    referralProfileId: profile.id,
    referralCodeSnapshot: normalizedCode,
    inviteCodeId: String(inviteCodeId || "").trim() || null,
    inviteCodeMask: String(inviteCodeMask || "").trim() || null,
    registeredAt: timestamp,
    registerIp: String(registerIp || "").trim() || null,
    registerUserAgent: String(registerUserAgent || "").trim() || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return referralAttributionRepository.findByReferredUserId(normalizedReferredUserId);
};

export const recordReferralConversionOnActivation = ({
  referredUserId,
  activationCodeId,
  tokenActivationId,
  featureScope,
  durationMonths,
  grossAmountCents,
}) => {
  const normalizedReferredUserId = String(referredUserId || "").trim();
  if (!normalizedReferredUserId) {
    return null;
  }
  const attribution = referralAttributionRepository.findByReferredUserId(normalizedReferredUserId);
  if (!attribution) {
    return null;
  }

  const safeDurationMonths = normalizeActivationDurationMonths(durationMonths);
  const safeGrossAmountCents = Math.max(0, Number(grossAmountCents) || 0);
  const hasPriorPaidPurchase = referralConversionRepository.hasAnyPriorNonVoidPaidPurchaseByReferredUserId(
    normalizedReferredUserId,
  );

  let conversionType = "renewal_le_2m";
  if (safeGrossAmountCents > 0 && !hasPriorPaidPurchase) {
    conversionType = "first_purchase";
  } else if (safeGrossAmountCents > 0 && safeDurationMonths > 2) {
    conversionType = "renewal_gt_2m";
  }

  let rewardRateBps = 0;
  if (safeGrossAmountCents > 0) {
    if (conversionType === "first_purchase") {
      rewardRateBps = REFERRAL_FIRST_PURCHASE_RATE_BPS;
    } else if (conversionType === "renewal_gt_2m") {
      rewardRateBps = REFERRAL_RENEWAL_GT_2M_RATE_BPS;
    }
  }

  const rewardAmountCents = Math.floor((safeGrossAmountCents * rewardRateBps) / 10000);
  const rewardStatus = rewardAmountCents > 0 ? "pending" : "not_eligible";
  const timestamp = nowIso();
  const id = randomId("refconv");

  referralConversionRepository.create({
    id,
    referrerUserId: attribution.referrerUserId,
    referredUserId: normalizedReferredUserId,
    referralAttributionId: attribution.id,
    activationCodeId: String(activationCodeId || "").trim(),
    tokenActivationId: String(tokenActivationId || "").trim() || null,
    conversionType,
    featureScope: String(featureScope || "").trim(),
    durationMonths: safeDurationMonths,
    grossAmountCents: safeGrossAmountCents,
    rewardRateBps,
    rewardAmountCents,
    rewardStatus,
    note: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return referralConversionRepository.findById(id);
};
