import { query, run } from "../db/client.js";
import { normalizeActivationDurationMonths } from "../lib/activationCodeDuration.js";

const normalizeReferralConversion = (row) => {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id || "").trim(),
    referrerUserId: String(row.referrerUserId || "").trim(),
    referrerUsername: String(row.referrerUsername || "").trim(),
    referredUserId: String(row.referredUserId || "").trim(),
    referredUsername: String(row.referredUsername || "").trim(),
    referralAttributionId: String(row.referralAttributionId || "").trim(),
    activationCodeId: String(row.activationCodeId || "").trim(),
    activationCodeMask: String(row.activationCodeMask || "").trim() || null,
    tokenActivationId: String(row.tokenActivationId || "").trim() || null,
    conversionType: String(row.conversionType || "").trim(),
    featureScope: String(row.featureScope || "").trim(),
    durationMonths: normalizeActivationDurationMonths(row.durationMonths),
    grossAmountCents: Math.max(0, Number(row.grossAmountCents) || 0),
    rewardRateBps: Math.max(0, Number(row.rewardRateBps) || 0),
    rewardAmountCents: Math.max(0, Number(row.rewardAmountCents) || 0),
    rewardStatus: String(row.rewardStatus || "").trim(),
    note: String(row.note || "").trim() || null,
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
    paidAt: String(row.paidAt || "").trim() || null,
    paidBy: String(row.paidBy || "").trim() || null,
    paidByUsername: String(row.paidByUsername || "").trim() || null,
    settlementChannel: String(row.settlementChannel || "").trim() || null,
    settlementRef: String(row.settlementRef || "").trim() || null,
    settledAt: String(row.settledAt || "").trim() || null,
    settledBy: String(row.settledBy || "").trim() || null,
    settledByUsername: String(row.settledByUsername || "").trim() || null,
  };
};

const listBaseSql = `
  SELECT
    c.id,
    c.referrer_user_id as referrerUserId,
    referrer.username as referrerUsername,
    c.referred_user_id as referredUserId,
    referred.username as referredUsername,
    c.referral_attribution_id as referralAttributionId,
    c.activation_code_id as activationCodeId,
    ac.code_mask as activationCodeMask,
    c.token_activation_id as tokenActivationId,
    c.conversion_type as conversionType,
    c.feature_scope as featureScope,
    c.duration_months as durationMonths,
    c.gross_amount_cents as grossAmountCents,
    c.reward_rate_bps as rewardRateBps,
    c.reward_amount_cents as rewardAmountCents,
    c.reward_status as rewardStatus,
    c.note,
    c.created_at as createdAt,
    c.updated_at as updatedAt,
    c.paid_at as paidAt,
    c.paid_by as paidBy,
    payer.username as paidByUsername,
    s.channel as settlementChannel,
    s.settlement_ref as settlementRef,
    s.settled_at as settledAt,
    s.settled_by as settledBy,
    settler.username as settledByUsername
  FROM referral_conversions c
  JOIN users referrer ON referrer.id = c.referrer_user_id
  JOIN users referred ON referred.id = c.referred_user_id
  LEFT JOIN activation_codes ac ON ac.id = c.activation_code_id
  LEFT JOIN users payer ON payer.id = c.paid_by
  LEFT JOIN referral_settlements s ON s.conversion_id = c.id
  LEFT JOIN users settler ON settler.id = s.settled_by
`;

const sumByStatuses = ({ userId, statuses }) => {
  const validStatuses = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
  if (!validStatuses.length) {
    return 0;
  }
  const placeholders = validStatuses.map((_, index) => `$status${index}`);
  const params = {
    $userId: String(userId || "").trim(),
  };
  validStatuses.forEach((status, index) => {
    params[`$status${index}`] = String(status || "").trim();
  });
  const rows = query(
    `SELECT COALESCE(SUM(reward_amount_cents), 0) as total
     FROM referral_conversions
     WHERE referrer_user_id = $userId
       AND reward_status IN (${placeholders.join(", ")})`,
    params,
  );
  return Math.max(0, Number(rows[0]?.total || 0));
};

export const referralConversionRepository = {
  create({
    id,
    referrerUserId,
    referredUserId,
    referralAttributionId,
    activationCodeId,
    tokenActivationId,
    conversionType,
    featureScope,
    durationMonths,
    grossAmountCents,
    rewardRateBps,
    rewardAmountCents,
    rewardStatus,
    note,
    createdAt,
    updatedAt,
    paidAt = null,
    paidBy = null,
  }) {
    run(
      `INSERT INTO referral_conversions (
        id,
        referrer_user_id,
        referred_user_id,
        referral_attribution_id,
        activation_code_id,
        token_activation_id,
        conversion_type,
        feature_scope,
        duration_months,
        gross_amount_cents,
        reward_rate_bps,
        reward_amount_cents,
        reward_status,
        note,
        created_at,
        updated_at,
        paid_at,
        paid_by
      ) VALUES (
        $id,
        $referrerUserId,
        $referredUserId,
        $referralAttributionId,
        $activationCodeId,
        $tokenActivationId,
        $conversionType,
        $featureScope,
        $durationMonths,
        $grossAmountCents,
        $rewardRateBps,
        $rewardAmountCents,
        $rewardStatus,
        $note,
        $createdAt,
        $updatedAt,
        $paidAt,
        $paidBy
      )`,
      {
        $id: String(id || "").trim(),
        $referrerUserId: String(referrerUserId || "").trim(),
        $referredUserId: String(referredUserId || "").trim(),
        $referralAttributionId: String(referralAttributionId || "").trim(),
        $activationCodeId: String(activationCodeId || "").trim(),
        $tokenActivationId: String(tokenActivationId || "").trim() || null,
        $conversionType: String(conversionType || "").trim(),
        $featureScope: String(featureScope || "").trim(),
        $durationMonths: normalizeActivationDurationMonths(durationMonths),
        $grossAmountCents: Math.max(0, Number(grossAmountCents) || 0),
        $rewardRateBps: Math.max(0, Number(rewardRateBps) || 0),
        $rewardAmountCents: Math.max(0, Number(rewardAmountCents) || 0),
        $rewardStatus: String(rewardStatus || "").trim(),
        $note: String(note || "").trim() || null,
        $createdAt: String(createdAt || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
        $paidAt: String(paidAt || "").trim() || null,
        $paidBy: String(paidBy || "").trim() || null,
      },
    );
  },

  findById(id) {
    const rows = query(
      `${listBaseSql}
       WHERE c.id = $id
       LIMIT 1`,
      {
        $id: String(id || "").trim(),
      },
    );
    return normalizeReferralConversion(rows[0]);
  },

  listByReferrerUserId(userId) {
    const rows = query(
      `${listBaseSql}
       WHERE c.referrer_user_id = $userId
       ORDER BY datetime(c.created_at) DESC, c.id DESC`,
      {
        $userId: String(userId || "").trim(),
      },
    );
    return rows.map((row) => normalizeReferralConversion(row));
  },

  listForAdmin(limit = 200) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const rows = query(
      `${listBaseSql}
       ORDER BY datetime(c.created_at) DESC, c.id DESC
       LIMIT ${safeLimit}`,
    );
    return rows.map((row) => normalizeReferralConversion(row));
  },

  countNonVoidByReferredUserId(referredUserId) {
    const rows = query(
      `SELECT COUNT(*) as total
       FROM referral_conversions
       WHERE referred_user_id = $referredUserId
         AND reward_status != 'void'`,
      {
        $referredUserId: String(referredUserId || "").trim(),
      },
    );
    return Number(rows[0]?.total || 0);
  },

  hasAnyPriorNonVoidPaidPurchaseByReferredUserId(referredUserId) {
    const rows = query(
      `SELECT 1
       FROM referral_conversions
       WHERE referred_user_id = $referredUserId
         AND reward_status != 'void'
         AND gross_amount_cents > 0
       LIMIT 1`,
      {
        $referredUserId: String(referredUserId || "").trim(),
      },
    );
    return Boolean(rows[0]);
  },

  existsPaidByActivationCodeId(activationCodeId) {
    const rows = query(
      `SELECT 1
       FROM referral_conversions
       WHERE activation_code_id = $activationCodeId
         AND reward_status = 'paid'
       LIMIT 1`,
      {
        $activationCodeId: String(activationCodeId || "").trim(),
      },
    );
    return Boolean(rows[0]);
  },

  existsAnyPaidConversion() {
    const rows = query(
      `SELECT 1
       FROM referral_conversions
       WHERE reward_status = 'paid'
       LIMIT 1`,
    );
    return Boolean(rows[0]);
  },

  sumPendingRewardAmountByReferrerUserId(userId) {
    return sumByStatuses({
      userId,
      statuses: ["pending"],
    });
  },

  sumPaidRewardAmountByReferrerUserId(userId) {
    return sumByStatuses({
      userId,
      statuses: ["paid"],
    });
  },

  markPaidIfPending({
    id,
    note,
    paidAt,
    paidBy,
    updatedAt,
  }) {
    const result = run(
      `UPDATE referral_conversions
       SET reward_status = 'paid',
           note = $note,
           paid_at = $paidAt,
           paid_by = $paidBy,
           updated_at = $updatedAt
       WHERE id = $id
         AND reward_status = 'pending'`,
      {
        $id: String(id || "").trim(),
        $note: String(note || "").trim() || null,
        $paidAt: String(paidAt || "").trim(),
        $paidBy: String(paidBy || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
      },
    );
    return Number(result?.changes || 0);
  },

  rejectIfPending({
    id,
    note,
    updatedAt,
  }) {
    const result = run(
      `UPDATE referral_conversions
       SET reward_status = 'rejected',
           note = $note,
           updated_at = $updatedAt
       WHERE id = $id
         AND reward_status = 'pending'`,
      {
        $id: String(id || "").trim(),
        $note: String(note || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
      },
    );
    return Number(result?.changes || 0);
  },

  voidByActivationCodeIdExcludingPaid({
    activationCodeId,
    note,
    updatedAt,
  }) {
    const result = run(
      `UPDATE referral_conversions
       SET reward_status = 'void',
           note = CASE
             WHEN TRIM(COALESCE(note, '')) = '' THEN $note
             ELSE note || '\n' || $note
           END,
           updated_at = $updatedAt
       WHERE activation_code_id = $activationCodeId
         AND reward_status NOT IN ('paid', 'void')`,
      {
        $activationCodeId: String(activationCodeId || "").trim(),
        $note: String(note || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
      },
    );
    return Number(result?.changes || 0);
  },

  voidAllExcludingPaid({
    note,
    updatedAt,
  }) {
    const result = run(
      `UPDATE referral_conversions
       SET reward_status = 'void',
           note = CASE
             WHEN TRIM(COALESCE(note, '')) = '' THEN $note
             ELSE note || '\n' || $note
           END,
           updated_at = $updatedAt
       WHERE reward_status NOT IN ('paid', 'void')`,
      {
        $note: String(note || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
      },
    );
    return Number(result?.changes || 0);
  },
};
