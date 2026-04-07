import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../middleware/validate.js";
import { wechatContactRepository } from "../repositories/wechatContactRepository.js";
import {
  attachWechatContactsStreamCleanup,
  registerWechatContactsStreamClient,
} from "../services/publicWechatContactStream.js";

const router = Router();

const slugParamSchema = z.object({
  slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/, "slug 格式无效"),
});

router.get("/public/wechat-contacts", (_req, res) => {
  return res.json({
    success: true,
    data: wechatContactRepository.listPublicPricing(),
  });
});

router.get("/public/wechat-contacts/stream", (req, res) => {
  registerWechatContactsStreamClient(res);
  attachWechatContactsStreamCleanup(req, res);
});

router.get(
  "/public/wechat-contacts/:slug",
  validateRequest({ params: slugParamSchema }),
  (req, res) => {
    const row = wechatContactRepository.findPublicBySlug(req.params.slug);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "联系人不存在",
      });
    }

    return res.json({
      success: true,
      data: row,
    });
  },
);

export default router;
