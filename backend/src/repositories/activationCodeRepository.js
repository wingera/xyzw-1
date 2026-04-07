import { query, run } from "../db/client.js";
import { env } from "../config/env.js";
import { codeSuffix, hmacHex, maskedCode } from "../lib/crypto.js";
import { normalizeActivationDurationMonths } from "../lib/activationCodeDuration.js";
import { normalizeAccessScope } from "../constants/accessScope.js";

const redactStoredCode = (id) => `activation-redacted:${String(id || "").trim()}`;
const activationCodeHmac = (code) => hmacHex(env.activationCodePepper, code);
const activationCodeMask = (code) => maskedCode(code, "ACT");

const normalizeActivationCode = (row) => {
  if (!row) return null;
  return {
    ...row,
    code: String(row.codeMask || row.code || "").trim(),
    codeMask: String(row.codeMask || row.code || "").trim(),
    codeSuffix: String(row.codeSuffix || "").trim(),
    featureScope: normalizeAccessScope(row.featureScope),
    durationMonths: normalizeActivationDurationMonths(row.durationMonths),
    saleAmountCents: Math.max(0, Number(row.saleAmountCents) || 0),
    saleCurrency: String(row.saleCurrency || "CNY").trim() || "CNY",
    isActive: Number(row.isActive) === 1,
    isDeleted: Number(row.isDeleted) === 1,
  };
};

export const activationCodeRepository = {
  existsByCode(code) {
    const rows = query(`SELECT id FROM activation_codes WHERE code_hmac = $codeHmac AND is_deleted = 0`, {
      $codeHmac: activationCodeHmac(code),
    });
    return Boolean(rows[0]);
  },

  findByCode(code) {
    const rows = query(
      `SELECT
         id,
         code_mask as codeMask,
         code_suffix as codeSuffix,
         created_by as createdBy,
         feature_scope as featureScope,
         duration_months as durationMonths,
         sale_amount_cents as saleAmountCents,
         sale_currency as saleCurrency,
         used_by as usedBy,
         used_at as usedAt,
         bound_token_id as boundTokenId,
         bound_game_account_id as boundGameAccountId,
         is_deleted as isDeleted,
         is_active as isActive,
         created_at as createdAt
       FROM activation_codes
       WHERE code_hmac = $codeHmac
         AND is_deleted = 0`,
      { $codeHmac: activationCodeHmac(code) },
    );
    return normalizeActivationCode(rows[0]);
  },

  findById(id) {
    const rows = query(
      `SELECT
         id,
         code_mask as codeMask,
         code_suffix as codeSuffix,
         feature_scope as featureScope,
         duration_months as durationMonths,
         sale_amount_cents as saleAmountCents,
         sale_currency as saleCurrency,
         used_at as usedAt,
         is_deleted as isDeleted,
         is_active as isActive
       FROM activation_codes
       WHERE id = $id`,
      { $id: String(id || "").trim() },
    );
    return normalizeActivationCode(rows[0]);
  },

  create({
    id,
    code,
    createdBy,
    featureScope = "full",
    durationMonths,
    saleAmountCents = 0,
    saleCurrency = "CNY",
    createdAt,
  }) {
    run(
      `INSERT INTO activation_codes (
         id, code, code_hmac, code_suffix, code_mask, created_by, feature_scope, duration_months, sale_amount_cents, sale_currency,
         used_by, used_at, bound_token_id, bound_game_account_id,
         is_active, created_at
       ) VALUES (
         $id, $storedCode, $codeHmac, $codeSuffix, $codeMask, $createdBy, $featureScope, $durationMonths, $saleAmountCents, $saleCurrency,
         NULL, NULL, NULL, NULL,
         1, $createdAt
       )`,
      {
        $id: String(id || "").trim(),
        $storedCode: redactStoredCode(id),
        $codeHmac: activationCodeHmac(code),
        $codeSuffix: codeSuffix(code),
        $codeMask: activationCodeMask(code),
        $createdBy: String(createdBy || "").trim(),
        $featureScope: normalizeAccessScope(featureScope),
        $durationMonths: normalizeActivationDurationMonths(durationMonths),
        $saleAmountCents: Math.max(0, Number(saleAmountCents) || 0),
        $saleCurrency: String(saleCurrency || "CNY").trim() || "CNY",
        $createdAt: String(createdAt || "").trim(),
      },
    );
  },

  consumeById({
    id,
    usedBy,
    usedAt,
    boundTokenId,
    boundGameAccountId,
  }) {
    run(
      `UPDATE activation_codes
       SET used_by = $usedBy,
           used_at = $usedAt,
           bound_token_id = $boundTokenId,
           bound_game_account_id = $boundGameAccountId,
           is_active = 0
       WHERE id = $id`,
      {
        $id: String(id || "").trim(),
        $usedBy: String(usedBy || "").trim(),
        $usedAt: String(usedAt || "").trim(),
        $boundTokenId: String(boundTokenId || "").trim(),
        $boundGameAccountId: String(boundGameAccountId || "").trim(),
      },
    );
  },

  markInactiveById(id) {
    run(
      `UPDATE activation_codes
       SET is_active = 0
       WHERE id = $id`,
      { $id: String(id || "").trim() },
    );
  },

  listWithCreatorAndConsumer() {
    const rows = query(
      `SELECT
         ac.id,
         ac.code_mask as codeMask,
         ac.code_suffix as codeSuffix,
         ac.created_at as createdAt,
         ac.feature_scope as featureScope,
         ac.duration_months as durationMonths,
         ac.sale_amount_cents as saleAmountCents,
         ac.sale_currency as saleCurrency,
         ac.is_active as isActive,
         ac.is_deleted as isDeleted,
         ac.used_at as usedAt,
         ac.bound_token_id as boundTokenId,
         ac.bound_game_account_id as boundGameAccountId,
         creator.username as createdBy,
         consumer.username as usedBy
       FROM activation_codes ac
       JOIN users creator ON creator.id = ac.created_by
       LEFT JOIN users consumer ON consumer.id = ac.used_by
       WHERE ac.is_deleted = 0
       ORDER BY ac.created_at DESC`,
    );
    return rows.map((row) => normalizeActivationCode(row));
  },

  softDeleteById(id) {
    run(
      `UPDATE activation_codes
       SET is_deleted = 1,
           is_active = 0
       WHERE id = $id`,
      { $id: String(id || "").trim() },
    );
  },

  resetBindingById(id) {
    const result = run(
      `UPDATE activation_codes
       SET bound_token_id = NULL,
           bound_game_account_id = NULL
       WHERE id = $id`,
      { $id: String(id || "").trim() },
    );
    return Number(result?.changes || 0);
  },

  resetAllConsumedBindings() {
    const result = run(
      `UPDATE activation_codes
       SET bound_token_id = NULL,
           bound_game_account_id = NULL
       WHERE bound_token_id IS NOT NULL
          OR bound_game_account_id IS NOT NULL`,
    );
    return Number(result?.changes || 0);
  },
};
