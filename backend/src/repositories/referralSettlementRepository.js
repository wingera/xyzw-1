import { query, run } from "../db/client.js";

const normalizeReferralSettlement = (row) => {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id || "").trim(),
    conversionId: String(row.conversionId || "").trim(),
    amountCents: Math.max(0, Number(row.amountCents) || 0),
    currency: String(row.currency || "CNY").trim() || "CNY",
    channel: String(row.channel || "").trim(),
    settlementRef: String(row.settlementRef || "").trim() || null,
    note: String(row.note || "").trim() || null,
    settledBy: String(row.settledBy || "").trim() || null,
    settledAt: String(row.settledAt || "").trim(),
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
  };
};

export const referralSettlementRepository = {
  create({
    id,
    conversionId,
    amountCents,
    currency = "CNY",
    channel,
    settlementRef = null,
    note = null,
    settledBy = null,
    settledAt,
    createdAt,
    updatedAt,
  }) {
    run(
      `INSERT INTO referral_settlements (
        id,
        conversion_id,
        amount_cents,
        currency,
        channel,
        settlement_ref,
        note,
        settled_by,
        settled_at,
        created_at,
        updated_at
      ) VALUES (
        $id,
        $conversionId,
        $amountCents,
        $currency,
        $channel,
        $settlementRef,
        $note,
        $settledBy,
        $settledAt,
        $createdAt,
        $updatedAt
      )`,
      {
        $id: String(id || "").trim(),
        $conversionId: String(conversionId || "").trim(),
        $amountCents: Math.max(0, Number(amountCents) || 0),
        $currency: String(currency || "CNY").trim() || "CNY",
        $channel: String(channel || "").trim(),
        $settlementRef: String(settlementRef || "").trim() || null,
        $note: String(note || "").trim() || null,
        $settledBy: String(settledBy || "").trim() || null,
        $settledAt: String(settledAt || "").trim(),
        $createdAt: String(createdAt || "").trim(),
        $updatedAt: String(updatedAt || "").trim(),
      },
    );
  },

  findByConversionId(conversionId) {
    const rows = query(
      `SELECT
        id,
        conversion_id as conversionId,
        amount_cents as amountCents,
        currency,
        channel,
        settlement_ref as settlementRef,
        note,
        settled_by as settledBy,
        settled_at as settledAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM referral_settlements
      WHERE conversion_id = $conversionId
      LIMIT 1`,
      {
        $conversionId: String(conversionId || "").trim(),
      },
    );
    return normalizeReferralSettlement(rows[0]);
  },
};
