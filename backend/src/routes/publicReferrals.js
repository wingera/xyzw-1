import { Router } from "express";
import { z } from "zod";
import { createRateLimiter } from "../middleware/rateLimit.js";
import {
  clearReferralCookie,
  setReferralCookie,
} from "../lib/referralCookie.js";
import { isTrustedSameOriginRequest } from "../lib/requestTrust.js";
import { validateRequest } from "../middleware/validate.js";
import { referralProfileRepository } from "../repositories/referralProfileRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import {
  buildReferralShareUrl,
  maskReferrerDisplayName,
  normalizeReferralCode,
} from "../services/referralService.js";

const router = Router();
const referralCodeParamSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9]+$/, "推广码格式无效"),
});
const publicReferralAttachLimiter = createRateLimiter({
  scope: "public_referral_attach",
  windowMs: 10 * 60 * 1000,
  max: 30,
  blockMs: 15 * 60 * 1000,
});

const resolveReferralPayload = (referralCode) => {
  const normalizedCode = normalizeReferralCode(referralCode);
  const profile = referralProfileRepository.findByCode(normalizedCode);
  if (!profile) {
    return null;
  }
  const referrer = userRepository.findById(profile.userId);
  if (!referrer) {
    return null;
  }
  return {
    referrerDisplayName: maskReferrerDisplayName(referrer.username),
    referralCode: normalizedCode,
    registerPath: `/register?ref=${encodeURIComponent(normalizedCode)}`,
    shareUrl: buildReferralShareUrl(normalizedCode),
  };
};

router.post(
  "/public/referrals/:code/attach",
  publicReferralAttachLimiter,
  validateRequest({ params: referralCodeParamSchema }),
  (req, res) => {
    if (!isTrustedSameOriginRequest(req)) {
      return res.status(403).json({
        success: false,
        code: "REFERRAL_ATTACH_FORBIDDEN",
        message: "当前请求来源不可信，无法写入推广归因",
      });
    }

    const payload = resolveReferralPayload(req.params.code);
    if (!payload) {
      clearReferralCookie(req, res);
      return res.status(404).json({
        success: false,
        code: "REFERRAL_INVALID",
        message: "推广链接不存在",
      });
    }

    setReferralCookie(req, res, payload.referralCode);
    return res.json({
      success: true,
      data: payload,
    });
  },
);

router.get(
  "/public/referrals/:code",
  validateRequest({ params: referralCodeParamSchema }),
  (req, res) => {
    const payload = resolveReferralPayload(req.params.code);
    if (!payload) {
      return res.status(404).json({
        success: false,
        code: "REFERRAL_INVALID",
        message: "推广链接不存在",
      });
    }
    return res.json({
      success: true,
      data: payload,
    });
  },
);

export default router;
