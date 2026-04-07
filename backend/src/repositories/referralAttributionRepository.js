import { query, run } from "../db/client.js";

const normalizeReferralAttribution = (row) => {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    referrerUserId: String(row.referrerUserId || "").trim(),
    referrerUsername: String(row.referrerUsername || "").trim(),
    referredUserId: String(row.referredUserId || "").trim(),
    referredUsername: String(row.referredUsername || "").trim(),
    referralProfileId: String(row.referralProfileId || "").trim(),
    referralCodeSnapshot: String(row.referralCodeSnapshot || "").trim(),
    inviteCodeId: String(row.inviteCodeId || "").trim() || null,
    inviteCodeMask: String(row.inviteCodeMask || "").trim() || null,
    registeredAt: String(row.registeredAt || "").trim(),
    registerIp: String(row.registerIp || "").trim() || null,
    registerUserAgent: String(row.registerUserAgent || "").trim() || null,
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
  };
};

export const referralAttributionRepository = {
  findByReferredUserId(referredUserId) {
    const rows = query(
      `SELECT
        a.id,
        a.referrer_user_id as referrerUserId,
        referrer.username as referrerUsername,
        a.referred_user_id as referredUserId,
        referred.username as referredUsername,
        a.referral_profile_id as referralProfileId,
        a.referral_code_snapshot as referralCodeSnapshot,
        a.invite_code_id as inviteCodeId,
        a.invite_code_mask as inviteCodeMask,
        a.registered_at as registeredAt,
        a.register_ip as registerIp,
        a.register_user_agent as registerUserAgent,
        a.created_at as createdAt,
        a.updated_at as updatedAt
      FROM referral_attributions a
      JOIN users referrer ON referrer.id = a.referrer_user_id
      JOIN users referred ON referred.id = a.referred_user_id
      WHERE a.referred_user_id = $referredUserId
      LIMIT 1`,
      {
        $referredUserId: String(referredUserId || "").trim(),
      },
    );
    return normalizeReferralAttribution(rows[0]);
  },

  findByReferrerUserId(referrerUserId) {
    const rows = query(
      `SELECT
        a.id,
        a.referrer_user_id as referrerUserId,
        referrer.username as referrerUsername,
        a.referred_user_id as referredUserId,
        referred.username as referredUsername,
        a.referral_profile_id as referralProfileId,
        a.referral_code_snapshot as referralCodeSnapshot,
        a.invite_code_id as inviteCodeId,
        a.invite_code_mask as inviteCodeMask,
        a.registered_at as registeredAt,
        a.register_ip as registerIp,
        a.register_user_agent as registerUserAgent,
        a.created_at as createdAt,
        a.updated_at as updatedAt
      FROM referral_attributions a
      JOIN users referrer ON referrer.id = a.referrer_user_id
      JOIN users referred ON referred.id = a.referred_user_id
      WHERE a.referrer_user_id = $referrerUserId
      ORDER BY datetime(a.registered_at) DESC, a.id DESC`,
      {
        $referrerUserId: String(referrerUserId || "").trim(),
      },
    );
    return rows.map((row) => normalizeReferralAttribution(row));
  },

  countByReferrerUserId(referrerUserId) {
    const rows = query(
      `SELECT COUNT(*) as total
       FROM referral_attributions
       WHERE referrer_user_id = $referrerUserId`,
      {
        $referrerUserId: String(referrerUserId || "").trim(),
      },
    );
    return Number(rows[0]?.total || 0);
  },

  listForAdmin(limit = 200) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const rows = query(
      `SELECT
        a.id,
        a.referrer_user_id as referrerUserId,
        referrer.username as referrerUsername,
        a.referred_user_id as referredUserId,
        referred.username as referredUsername,
        a.referral_profile_id as referralProfileId,
        a.referral_code_snapshot as referralCodeSnapshot,
        a.invite_code_id as inviteCodeId,
        a.invite_code_mask as inviteCodeMask,
        a.registered_at as registeredAt,
        a.register_ip as registerIp,
        a.register_user_agent as registerUserAgent,
        a.created_at as createdAt,
        a.updated_at as updatedAt
      FROM referral_attributions a
      JOIN users referrer ON referrer.id = a.referrer_user_id
      JOIN users referred ON referred.id = a.referred_user_id
      ORDER BY datetime(a.registered_at) DESC, a.id DESC
      LIMIT ${safeLimit}`,
    );
    return rows.map((row) => normalizeReferralAttribution(row));
  },

  create({
    id,
    referrerUserId,
    referredUserId,
    referralProfileId,
    referralCodeSnapshot,
    inviteCodeId,
    inviteCodeMask,
    registeredAt,
    registerIp,
    registerUserAgent,
    createdAt,
    updatedAt,
  }) {
    run(
      `INSERT INTO referral_attributions (
        id,
        referrer_user_id,
        referred_user_id,
        referral_profile_id,
        referral_code_snapshot,
        invite_code_id,
        invite_code_mask,
        registered_at,
        register_ip,
        register_user_agent,
        created_at,
        updated_at
      ) VALUES (
        $id,
        $referrerUserId,
        $referredUserId,
        $referralProfileId,
        $referralCodeSnapshot,
        $inviteCodeId,
        $inviteCodeMask,
        $registeredAt,
        $registerIp,
        $registerUserAgent,
        $createdAt,
        $updatedAt
      )`,
      {
        $id: String(id || "").trim(),
        $referrerUserId: String(referrerUserId || "").trim(),
        $referredUserId: String(referredUserId || "").trim(),
        $referralProfileId: String(referralProfileId || "").trim(),
        $referralCodeSnapshot: String(referralCodeSnapshot || "").trim(),
        $inviteCodeId: String(inviteCodeId || "").trim() || null,
        $inviteCodeMask: String(inviteCodeMask || "").trim() || null,
        $registeredAt: String(registeredAt || "").trim(),
        $registerIp: String(registerIp || "").trim() || null,
        $registerUserAgent: String(registerUserAgent || "").trim() || null,
        $createdAt: String(createdAt || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
      },
    );
  },
};
