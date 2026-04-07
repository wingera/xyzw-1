import { query, run } from "../db/client.js";

const normalizeReferralProfile = (row) => {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: String(row.userId || "").trim(),
    referralCode: String(row.referralCode || "").trim(),
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
    generatedAt: String(row.generatedAt || "").trim(),
  };
};

export const referralProfileRepository = {
  findByUserId(userId) {
    const rows = query(
      `SELECT
        id,
        user_id as userId,
        referral_code as referralCode,
        created_at as createdAt,
        updated_at as updatedAt,
        generated_at as generatedAt
      FROM referral_profiles
      WHERE user_id = $userId
      LIMIT 1`,
      {
        $userId: String(userId || "").trim(),
      },
    );
    return normalizeReferralProfile(rows[0]);
  },

  findByCode(referralCode) {
    const rows = query(
      `SELECT
        id,
        user_id as userId,
        referral_code as referralCode,
        created_at as createdAt,
        updated_at as updatedAt,
        generated_at as generatedAt
      FROM referral_profiles
      WHERE referral_code = $referralCode
      LIMIT 1`,
      {
        $referralCode: String(referralCode || "").trim(),
      },
    );
    return normalizeReferralProfile(rows[0]);
  },

  create({
    id,
    userId,
    referralCode,
    createdAt,
    updatedAt,
    generatedAt,
  }) {
    run(
      `INSERT INTO referral_profiles (
        id,
        user_id,
        referral_code,
        created_at,
        updated_at,
        generated_at
      ) VALUES (
        $id,
        $userId,
        $referralCode,
        $createdAt,
        $updatedAt,
        $generatedAt
      )`,
      {
        $id: String(id || "").trim(),
        $userId: String(userId || "").trim(),
        $referralCode: String(referralCode || "").trim(),
        $createdAt: String(createdAt || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
        $generatedAt: String(generatedAt || "").trim(),
      },
    );
  },
};
