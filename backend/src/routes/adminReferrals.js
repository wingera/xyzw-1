import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth.js";
import { adminRequired } from "../middleware/admin.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validate.js";
import { makeSensitiveAction } from "../middleware/sensitiveAction.js";
import { nowIso, randomId } from "../db/sql.js";
import { transaction } from "../db/client.js";
import { recordAdminAudit } from "../services/adminAuditService.js";
import { referralAttributionRepository } from "../repositories/referralAttributionRepository.js";
import { referralConversionRepository } from "../repositories/referralConversionRepository.js";
import { referralSettlementRepository } from "../repositories/referralSettlementRepository.js";

const router = Router();
const SENSITIVE_ACTION_TTL_SECONDS = 5 * 60;
const SENSITIVE_ACTION_TOKEN_HEADER = "x-admin-confirm-token";
const SENSITIVE_ACTION_TOKEN_PURPOSE = "admin-sensitive-action";
const REFERRAL_SETTLEMENT_CHANNELS = ["wechat_manual", "bank", "other"];
const adminSensitiveAction = makeSensitiveAction({
  purpose: SENSITIVE_ACTION_TOKEN_PURPOSE,
  ttlSeconds: SENSITIVE_ACTION_TTL_SECONDS,
  headerName: SENSITIVE_ACTION_TOKEN_HEADER,
  codePrefix: "ADMIN_CONFIRM",
  requiredMessage: "高危操作需要二次确认，请先验证当前密码",
});
const sensitiveActionRequired = adminSensitiveAction.required;
const adminRateKey = (req) => `${req.auth?.user?.id || "anonymous"}:${req.ip || "anonymous"}`;
const adminApiLimiter = createRateLimiter({
  scope: "admin_referral_api",
  windowMs: 60 * 1000,
  max: 120,
  blockMs: 5 * 60 * 1000,
  keyGenerator: adminRateKey,
});
const adminWriteLimiter = createRateLimiter({
  scope: "admin_referral_write",
  windowMs: 60 * 1000,
  max: 40,
  blockMs: 10 * 60 * 1000,
  keyGenerator: adminRateKey,
});
const referralListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(200),
}).strict();
const conversionIdParamSchema = z.object({
  id: z.string().trim().min(1).max(64),
});
const markPaidBodySchema = z.object({
  channel: z.enum(REFERRAL_SETTLEMENT_CHANNELS),
  settlementRef: z.string().trim().max(128).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
}).strict().superRefine((data, ctx) => {
  const requiresSettlementRef = ["wechat_manual", "bank"].includes(String(data.channel || ""));
  if (requiresSettlementRef && !String(data.settlementRef || "").trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["settlementRef"],
      message: "当前结算渠道必须填写结算单号",
    });
  }
});
const rejectBodySchema = z.object({
  note: z.string().trim().min(1).max(1000),
}).strict();

const reqMeta = (req) => ({
  ip: String(req.ip || ""),
  userAgent: String(req.headers["user-agent"] || ""),
});

class ConflictError extends Error {
  constructor(message = "conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

const isUniqueSettlementConflict = (error) =>
  String(error?.message || "").includes("referral_settlements.conversion_id");

router.use(authRequired, adminRequired);
router.use(adminApiLimiter);

router.get(
  "/referrals/attributions",
  validateRequest({ query: referralListQuerySchema }),
  (req, res) => {
    const rows = referralAttributionRepository.listForAdmin(req.query.limit);
    return res.json({
      success: true,
      data: rows,
    });
  },
);

router.get(
  "/referrals/conversions",
  validateRequest({ query: referralListQuerySchema }),
  (req, res) => {
    const rows = referralConversionRepository.listForAdmin(req.query.limit);
    return res.json({
      success: true,
      data: rows,
    });
  },
);

router.post(
  "/referrals/conversions/:id/mark-paid",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: conversionIdParamSchema, body: markPaidBodySchema }),
  (req, res) => {
    const timestamp = nowIso();
    const note = String(req.body?.note || "").trim();
    const settlementRef = String(req.body?.settlementRef || "").trim();
    const channel = String(req.body?.channel || "").trim();
    const current = referralConversionRepository.findById(req.params.id);
    if (!current) {
      return res.status(404).json({ success: false, message: "返佣台账不存在" });
    }

    try {
      transaction(() => {
        const changes = referralConversionRepository.markPaidIfPending({
          id: current.id,
          note,
          paidAt: timestamp,
          paidBy: req.auth.user.id,
          updatedAt: timestamp,
        });
        if (changes !== 1) {
          throw new ConflictError("referral_conversion_not_pending");
        }

        referralSettlementRepository.create({
          id: randomId("refset"),
          conversionId: current.id,
          amountCents: current.rewardAmountCents,
          currency: "CNY",
          channel,
          settlementRef,
          note,
          settledBy: req.auth.user.id,
          settledAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });
      const updated = referralConversionRepository.findById(current.id);

      recordAdminAudit({
        adminUserId: req.auth.user.id,
        action: "mark_referral_conversion_paid",
        targetType: "referral_conversion",
        targetId: current.id,
        detail: {
          conversionId: current.id,
          previousStatus: current.rewardStatus,
          currentStatus: updated?.rewardStatus || "paid",
          amountCents: current.rewardAmountCents,
          channel,
          settlementRef: settlementRef || null,
          note: note || null,
        },
        ...reqMeta(req),
      });

      return res.json({
        success: true,
        message: "返佣台账已标记为已结算",
        data: updated,
      });
    } catch (error) {
      if (error instanceof ConflictError || isUniqueSettlementConflict(error)) {
        return res.status(409).json({ success: false, message: "该返佣台账已不是待结算状态，请刷新后重试" });
      }
      throw error;
    }
  },
);

router.post(
  "/referrals/conversions/:id/reject",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: conversionIdParamSchema, body: rejectBodySchema }),
  (req, res) => {
    const current = referralConversionRepository.findById(req.params.id);
    if (!current) {
      return res.status(404).json({ success: false, message: "返佣台账不存在" });
    }

    try {
      const timestamp = nowIso();
      const note = String(req.body?.note || "").trim();

      transaction(() => {
        const changes = referralConversionRepository.rejectIfPending({
          id: current.id,
          note,
          updatedAt: timestamp,
        });
        if (changes !== 1) {
          throw new ConflictError("referral_conversion_not_pending");
        }
      });

      const updated = referralConversionRepository.findById(current.id);
      recordAdminAudit({
        adminUserId: req.auth.user.id,
        action: "reject_referral_conversion",
        targetType: "referral_conversion",
        targetId: current.id,
        detail: {
          conversionId: current.id,
          previousStatus: current.rewardStatus,
          currentStatus: updated?.rewardStatus || "rejected",
          amountCents: current.rewardAmountCents,
          note,
        },
        ...reqMeta(req),
      });

      return res.json({
        success: true,
        message: "返佣台账已拒绝",
        data: updated,
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        return res.status(409).json({ success: false, message: "该返佣台账已不是待结算状态，请刷新后重试" });
      }
      throw error;
    }
  },
);

export default router;
