import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth.js";
import { adminRequired } from "../middleware/admin.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validate.js";
import { makeSensitiveAction } from "../middleware/sensitiveAction.js";
import { nowIso, randomId } from "../db/sql.js";
import { env } from "../config/env.js";
import { matchesAllowedHost } from "../lib/hostAllowlist.js";
import { recordAdminAudit } from "../services/adminAuditService.js";
import { wechatContactRepository } from "../repositories/wechatContactRepository.js";
import { broadcastWechatContactsChanged } from "../services/publicWechatContactStream.js";

const router = Router();
const CONTACT_TYPES = ["landing_qr", "wecom_kf_link", "external_url"];
const SENSITIVE_ACTION_TTL_SECONDS = 5 * 60;
const SENSITIVE_ACTION_TOKEN_HEADER = "x-admin-confirm-token";
const SENSITIVE_ACTION_TOKEN_PURPOSE = "admin-sensitive-action";
const QR_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i;
const WECHAT_CONTACT_SLUG_PATTERN = /^[a-z0-9-]+$/;
const WECOM_KF_URL_PATTERN = /^https:\/\/work\.weixin\.qq\.com\/kfid\/[A-Za-z0-9_-]+(?:[/?#].*)?$/i;
const adminSensitiveAction = makeSensitiveAction({
  purpose: SENSITIVE_ACTION_TOKEN_PURPOSE,
  ttlSeconds: SENSITIVE_ACTION_TTL_SECONDS,
  headerName: SENSITIVE_ACTION_TOKEN_HEADER,
  codePrefix: "ADMIN_CONFIRM",
  requiredMessage: "高危操作需要二次确认，请先验证当前密码",
});
const sensitiveActionRequired = adminSensitiveAction.required;
const adminRateKey = (req) => `${req.auth?.user?.id || "anonymous"}:${req.ip || "anonymous"}`;
const adminWriteLimiter = createRateLimiter({
  scope: "admin_wechat_contacts_write",
  windowMs: 60 * 1000,
  max: 40,
  blockMs: 10 * 60 * 1000,
  keyGenerator: adminRateKey,
});

const trimString = (value) => String(value ?? "").trim();
const resolveTargetHostname = (targetUrl) => {
  try {
    return String(new URL(targetUrl).hostname || "").trim().toLowerCase();
  } catch {
    return "";
  }
};
const isAllowedExternalUrlHost = (hostname) =>
  (env.wechatContactExternalUrlAllowlist || []).some((pattern) =>
    matchesAllowedHost(hostname, pattern),
  );
const optionalString = (max) =>
  z.preprocess(
    (value) => trimString(value),
    z.string().max(max),
  );
const booleanishSchema = z.boolean();
const fullContactBaseSchema = z.object({
  slug: z.string().trim().min(1).max(64).regex(WECHAT_CONTACT_SLUG_PATTERN, "slug 只允许小写字母、数字、中划线"),
  title: z.string().trim().min(1).max(80),
  subtitle: optionalString(160),
  contactType: z.enum(CONTACT_TYPES),
  targetUrl: optionalString(2048),
  wechatId: optionalString(120),
  qrImageDataUrl: optionalString(3_500_000),
  showInPricing: booleanishSchema,
  isActive: booleanishSchema,
  sortOrder: z.coerce.number().int().min(0).max(9999),
}).strict();

const validateContactByType = (data, ctx) => {
  const targetUrl = trimString(data.targetUrl);
  const qrImageDataUrl = trimString(data.qrImageDataUrl);

  if (data.contactType === "landing_qr") {
    if (!QR_DATA_URL_PATTERN.test(qrImageDataUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qrImageDataUrl"],
        message: "landing_qr 必须提供 png/jpg/jpeg/webp 的 data url",
      });
    }
    return;
  }

  if (!targetUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetUrl"],
      message: "targetUrl 不能为空",
    });
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetUrl"],
      message: "targetUrl 必须是有效 URL",
    });
    return;
  }

  if (parsed.protocol !== "https:") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetUrl"],
      message: "targetUrl 只允许 https",
    });
    return;
  }

  if (data.contactType === "wecom_kf_link" && !WECOM_KF_URL_PATTERN.test(targetUrl)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetUrl"],
      message: "wecom_kf_link 必须匹配 https://work.weixin.qq.com/kfid/...",
    });
  }

  if (data.contactType === "external_url") {
    const allowlist = env.wechatContactExternalUrlAllowlist || [];
    if (!allowlist.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetUrl"],
        message: "未配置 external_url 白名单",
      });
      return;
    }

    const hostname = resolveTargetHostname(targetUrl);
    if (!hostname || !isAllowedExternalUrlHost(hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetUrl"],
        message: "external_url 域名不在白名单",
      });
    }
  }
};

const fullContactSchema = fullContactBaseSchema.superRefine(validateContactByType);
const createWechatContactBodySchema = fullContactBaseSchema.extend({
  showInPricing: booleanishSchema.optional().default(true),
  isActive: booleanishSchema.optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(100),
}).superRefine(validateContactByType);
const updateWechatContactBodySchema = z.object({
  slug: z.string().trim().min(1).max(64).regex(WECHAT_CONTACT_SLUG_PATTERN, "slug 只允许小写字母、数字、中划线").optional(),
  title: z.string().trim().min(1).max(80).optional(),
  subtitle: optionalString(160).optional(),
  contactType: z.enum(CONTACT_TYPES).optional(),
  targetUrl: optionalString(2048).optional(),
  wechatId: optionalString(120).optional(),
  qrImageDataUrl: optionalString(3_500_000).optional(),
  showInPricing: booleanishSchema.optional(),
  isActive: booleanishSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
}).strict();
const contactIdParamSchema = z.object({
  id: z.string().trim().min(1).max(64),
});

const pickFirstIssueMessage = (error) => {
  const issue = error?.issues?.[0];
  if (!issue) {
    return "请求参数无效";
  }
  const path = Array.isArray(issue.path) && issue.path.length > 0
    ? issue.path.join(".")
    : "request";
  return `${path}: ${issue.message}`;
};

const reqMeta = (req) => ({
  ip: String(req.ip || ""),
  userAgent: String(req.headers["user-agent"] || ""),
});

const normalizePersistedContact = (input = {}) => {
  const showInPricing = Boolean(input.showInPricing);
  const isActive = Boolean(input.isActive);
  const sortOrder = Number(input.sortOrder) || 100;
  const subtitle = trimString(input.subtitle);
  const targetUrl = trimString(input.targetUrl);
  const wechatId = trimString(input.wechatId);
  const qrImageDataUrl = trimString(input.qrImageDataUrl);

  if (input.contactType === "landing_qr") {
    return {
      slug: trimString(input.slug),
      title: trimString(input.title),
      subtitle,
      contactType: input.contactType,
      targetUrl: "",
      wechatId,
      qrImageDataUrl,
      showInPricing,
      isActive,
      sortOrder,
    };
  }

  return {
    slug: trimString(input.slug),
    title: trimString(input.title),
    subtitle,
    contactType: input.contactType,
    targetUrl,
    wechatId: "",
    qrImageDataUrl: "",
    showInPricing,
    isActive,
    sortOrder,
  };
};

const buildAuditDetail = (row = {}) => ({
  slug: row.slug,
  title: row.title,
  subtitle: row.subtitle || null,
  contactType: row.contactType,
  targetHostname: resolveTargetHostname(row.targetUrl),
  showInPricing: Boolean(row.showInPricing),
  isActive: Boolean(row.isActive),
  sortOrder: Number(row.sortOrder) || 100,
  hasTargetUrl: Boolean(trimString(row.targetUrl)),
  hasQrImageDataUrl: Boolean(trimString(row.qrImageDataUrl)),
  hasWechatId: Boolean(trimString(row.wechatId)),
});

const findAdminRowById = (id) =>
  wechatContactRepository.listForAdmin().find((row) => row.id === id) || null;

router.use(authRequired, adminRequired);

router.get("/wechat-contacts", (_req, res) => {
  return res.json({
    success: true,
    data: wechatContactRepository.listForAdmin(),
  });
});

router.post(
  "/wechat-contacts",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ body: createWechatContactBodySchema }),
  (req, res) => {
    const payload = normalizePersistedContact(req.body);
    const existing = wechatContactRepository.listForAdmin().find((row) => row.slug === payload.slug);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "slug 已存在",
      });
    }

    const timestamp = nowIso();
    const id = randomId("wechat_contact");
    wechatContactRepository.create({
      id,
      ...payload,
      createdBy: req.auth.user.id,
      updatedBy: req.auth.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const created = findAdminRowById(id);
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "create_wechat_contact",
      targetType: "wechat_contact",
      targetId: id,
      detail: buildAuditDetail(created || { id, ...payload }),
      ...reqMeta(req),
    });
    broadcastWechatContactsChanged();

    return res.json({
      success: true,
      message: "微信联系人已创建",
      data: created,
    });
  },
);

router.put(
  "/wechat-contacts/:id",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: contactIdParamSchema, body: updateWechatContactBodySchema }),
  (req, res) => {
    const id = req.params.id;
    const current = findAdminRowById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "联系人不存在",
      });
    }

    if (Object.keys(req.body || {}).length === 0) {
      return res.status(400).json({
        success: false,
        message: "至少提供一个更新字段",
      });
    }

    const mergedCandidate = {
      slug: req.body.slug ?? current.slug,
      title: req.body.title ?? current.title,
      subtitle: req.body.subtitle ?? current.subtitle,
      contactType: req.body.contactType ?? current.contactType,
      targetUrl: req.body.targetUrl ?? current.targetUrl,
      wechatId: req.body.wechatId ?? current.wechatId,
      qrImageDataUrl: req.body.qrImageDataUrl ?? current.qrImageDataUrl,
      showInPricing: req.body.showInPricing ?? current.showInPricing,
      isActive: req.body.isActive ?? current.isActive,
      sortOrder: req.body.sortOrder ?? current.sortOrder,
    };
    const validated = fullContactSchema.safeParse(mergedCandidate);
    if (!validated.success) {
      return res.status(400).json({
        success: false,
        message: pickFirstIssueMessage(validated.error),
      });
    }

    const payload = normalizePersistedContact(validated.data);
    const duplicate = wechatContactRepository
      .listForAdmin()
      .find((row) => row.slug === payload.slug && row.id !== id);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "slug 已存在",
      });
    }

    const updatedAt = nowIso();
    wechatContactRepository.update({
      id,
      ...payload,
      updatedBy: req.auth.user.id,
      updatedAt,
    });

    const updated = findAdminRowById(id);
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "update_wechat_contact",
      targetType: "wechat_contact",
      targetId: id,
      detail: {
        previous: buildAuditDetail(current),
        current: buildAuditDetail(updated || { id, ...payload }),
      },
      ...reqMeta(req),
    });
    broadcastWechatContactsChanged();

    return res.json({
      success: true,
      message: "微信联系人已更新",
      data: updated,
    });
  },
);

router.delete(
  "/wechat-contacts/:id",
  adminWriteLimiter,
  sensitiveActionRequired,
  validateRequest({ params: contactIdParamSchema }),
  (req, res) => {
    const id = req.params.id;
    const current = findAdminRowById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "联系人不存在",
      });
    }

    wechatContactRepository.remove(id);
    recordAdminAudit({
      adminUserId: req.auth.user.id,
      action: "delete_wechat_contact",
      targetType: "wechat_contact",
      targetId: id,
      detail: buildAuditDetail(current),
      ...reqMeta(req),
    });
    broadcastWechatContactsChanged();

    return res.json({
      success: true,
      message: "微信联系人已删除",
      data: { id },
    });
  },
);

export default router;
