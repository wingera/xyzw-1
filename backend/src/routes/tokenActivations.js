import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { authRequired } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate.js";
import { nowIso, randomId } from "../db/sql.js";
import { transaction } from "../db/client.js";
import { activationCodeRepository } from "../repositories/activationCodeRepository.js";
import { tokenActivationRepository } from "../repositories/tokenActivationRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import {
  addActivationDuration,
  isAllowedActivationDurationMonths,
  normalizeActivationDurationMonths,
} from "../lib/activationCodeDuration.js";
import { recordReferralConversionOnActivation } from "../services/referralService.js";

const router = Router();

const tokenIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

const roleIdSchema = z
  .string()
  .trim()
  .regex(/^\d{6,12}$/, "roleId must be a 6-12 digit numeric id");

const roleIndexSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    const text = String(value).trim();
    return text === "" ? undefined : text;
  },
  z.coerce.number().int().min(0).max(9).optional(),
);

const bindActivationBodySchema = z.object({
  tokenId: tokenIdSchema,
  sessId: z.string().trim().max(256).optional().default(""),
  roleId: roleIdSchema.optional(),
  gameAccountId: roleIdSchema.optional(),
  roleName: z.string().trim().max(64).optional().default(""),
  region: z.string().trim().max(64).optional().default(""),
  server: z.string().trim().max(64).optional().default(""),
  roleIndex: roleIndexSchema,
  activationCode: z.string().trim().min(1).max(64),
}).strict().superRefine((data, ctx) => {
  const roleId = String(data.roleId || data.gameAccountId || "").trim();
  if (!/^\d{6,12}$/.test(roleId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "roleId must be a 6-12 digit numeric id",
      path: ["roleId"],
    });
  }
});

const activationStatusBodySchema = z.object({
  tokenId: tokenIdSchema.optional(),
  sessId: z.string().trim().max(256).optional().default(""),
  roleId: roleIdSchema.optional(),
  gameAccountId: roleIdSchema.optional(),
  roleName: z.string().trim().max(64).optional().default(""),
  region: z.string().trim().max(64).optional().default(""),
  server: z.string().trim().max(64).optional().default(""),
  roleIndex: roleIndexSchema,
}).superRefine((data, ctx) => {
  const roleId = String(data.roleId || data.gameAccountId || "").trim();
  if (!/^\d{6,12}$/.test(roleId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "roleId must be a 6-12 digit numeric id",
      path: ["roleId"],
    });
  }
});

const parseFutureDateOrNull = (value, nowTs) => {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  const ts = parsed.getTime();
  if (!Number.isFinite(ts) || ts <= nowTs) return null;
  return parsed;
};

const DEFAULT_ROLE_NAME = "未命名角色";
const DEFAULT_REGION = "未知大区";

const normalizeRoleName = (value) => {
  const text = String(value || "").trim();
  return text || DEFAULT_ROLE_NAME;
};

const normalizeRegion = (value) => {
  const text = String(value || "").trim();
  return text || DEFAULT_REGION;
};

const normalizeSessId = (value) => String(value || "").trim().slice(0, 256);

const normalizeRoleIndex = (value) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "";
  }
  const safe = Math.max(0, Math.floor(num));
  return String(safe);
};

const parseBoundSessId = (accountIdentity) =>
  String(String(accountIdentity || "").split("|")[0] || "").trim();

const buildAccountIdentity = ({ sessId, roleId, region, roleName }) =>
  `${normalizeSessId(sessId)}|${String(roleId || "").trim()}|${normalizeRegion(region)}|${normalizeRoleName(roleName)}`;

const buildRoleCompositeLabel = ({ roleName, region, roleId, roleIndex }) => {
  const base = `${normalizeRoleName(roleName)}-${normalizeRegion(region)}-${String(roleId || "").trim()}`;
  const normalizedRoleIndex = normalizeRoleIndex(roleIndex);
  return normalizedRoleIndex ? `${base}-序号${normalizedRoleIndex}` : base;
};

const createAccountSeed = () => {
  const raw = crypto.randomBytes(8).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") || raw;
};

const createAccountSignature = ({ accountIdentity, accountSeed }) =>
  crypto.createHash("sha256").update(`${accountIdentity}|${accountSeed}`).digest("hex");

router.use(authRequired);

router.post(
  "/token-activations/bind",
  validateRequest({ body: bindActivationBodySchema }),
  (req, res) => {
    const tokenId = String(req.body?.tokenId || "").trim();
    const sessId = normalizeSessId(req.body?.sessId);
    const roleId = String(req.body?.roleId || req.body?.gameAccountId || "").trim();
    const roleName = String(req.body?.roleName || "").trim();
    const region = String(req.body?.region || req.body?.server || "").trim();
    const roleIndex = normalizeRoleIndex(req.body?.roleIndex);
    const normalizedRoleName = normalizeRoleName(roleName);
    const normalizedRegion = normalizeRegion(region);
    const accountIdentity = buildAccountIdentity({
      sessId,
      roleName: normalizedRoleName,
      region: normalizedRegion,
      roleId,
    });
    const roleCompositeLabel = buildRoleCompositeLabel({
      roleName: normalizedRoleName,
      region: normalizedRegion,
      roleId,
      roleIndex,
    });
    const activationCode = String(req.body?.activationCode || "").trim().toUpperCase();
    const userId = String(req.auth?.user?.id || "").trim();

    const now = new Date();
    const nowAt = nowIso();

    const result = transaction(() => {
      const tokenBinding = tokenActivationRepository.findByTokenId({ tokenId });
      if (tokenBinding && String(tokenBinding.userId || "") !== userId) {
        return {
          status: 403,
          payload: { success: false, message: "该Token已绑定到其他用户，无法重复绑定" },
        };
      }
      if (
        tokenBinding
        && String(tokenBinding.accountIdentity || "").trim() !== accountIdentity
      ) {
        return {
          status: 400,
          payload: {
            success: false,
            message: "该Token已绑定其他账号标识（sessid-RoleID-大区-角色名），请使用对应账号激活",
          },
        };
      }
      if (
        tokenActivationRepository.existsByAccountIdentityForOtherUser({
          accountIdentity,
          userId,
        })
      ) {
        return {
          status: 403,
          payload: { success: false, message: "该账号标识已绑定到其他用户，无法重复绑定" },
        };
      }

      const bindingByTokenAndIdentity = tokenActivationRepository.findByTokenAndAccountIdentity({
        tokenId,
        accountIdentity,
      });
      const bindingByIdentity = tokenActivationRepository.findByAccountIdentity({
        accountIdentity,
      });
      if (
        bindingByIdentity
        && String(bindingByIdentity.userId || "").trim() === userId
        && String(bindingByIdentity.tokenId || "").trim() !== tokenId
      ) {
        return {
          status: 400,
          payload: {
            success: false,
            message: "该账号标识已绑定其他Token，请使用对应账号激活",
          },
        };
      }
      const binding = bindingByTokenAndIdentity || null;

      const codeRow = activationCodeRepository.findByCode(activationCode);
      if (!codeRow) {
        return {
          status: 400,
          payload: { success: false, message: "激活码无效" },
        };
      }
      if (!codeRow.isActive) {
        return {
          status: 400,
          payload: { success: false, message: "激活码已失效" },
        };
      }
      if (codeRow.usedAt) {
        return {
          status: 400,
          payload: { success: false, message: "激活码已使用" },
        };
      }

      const durationMonths = normalizeActivationDurationMonths(codeRow.durationMonths);
      if (!isAllowedActivationDurationMonths(durationMonths)) {
        return {
          status: 400,
          payload: { success: false, message: "激活码时长配置无效" },
        };
      }

      const previousExpiresAt = String(binding?.expiresAt || tokenBinding?.expiresAt || "").trim();
      const activeExpiresAt = parseFutureDateOrNull(previousExpiresAt, now.getTime());
      const baseStartAt = activeExpiresAt || now;
      const expiresAt = addActivationDuration(baseStartAt, durationMonths).toISOString();
      const extendedFromActive = Boolean(activeExpiresAt);
      const accountSeed = String(
        tokenBinding?.accountSeed || bindingByIdentity?.accountSeed || createAccountSeed(),
      ).trim();
      const accountSignature = createAccountSignature({
        accountIdentity,
        accountSeed,
      });
      const tokenActivationId = binding?.id || randomId("tact");

      if (binding) {
        tokenActivationRepository.updateById({
          id: tokenActivationId,
          tokenId,
          userId,
          roleName: normalizedRoleName,
          region: normalizedRegion,
          roleIndex,
          accountIdentity,
          accountSeed,
          accountSignature,
          activationCodeId: codeRow.id,
          boundAt: nowAt,
          expiresAt,
        });
      } else {
        tokenActivationRepository.create({
          id: tokenActivationId,
          tokenId,
          roleId,
          roleName: normalizedRoleName,
          region: normalizedRegion,
          roleIndex,
          accountIdentity,
          accountSeed,
          accountSignature,
          userId,
          activationCodeId: codeRow.id,
          boundAt: nowAt,
          expiresAt,
          createdAt: nowAt,
        });
      }

      userRepository.updateAccessScope({
        id: userId,
        accessScope: codeRow.featureScope,
        updatedAt: nowAt,
      });

      activationCodeRepository.consumeById({
        id: codeRow.id,
        usedBy: userId,
        usedAt: nowAt,
        boundTokenId: "",
        boundGameAccountId: roleCompositeLabel,
      });

      recordReferralConversionOnActivation({
        referredUserId: userId,
        activationCodeId: codeRow.id,
        tokenActivationId,
        featureScope: codeRow.featureScope,
        durationMonths,
        grossAmountCents: codeRow.saleAmountCents,
      });

      return {
        status: 200,
        payload: {
          success: true,
          message: extendedFromActive ? "Token 续期成功" : "Token 激活成功",
          data: {
            tokenId: binding?.tokenId || tokenId,
            roleId,
            roleName: normalizedRoleName,
            region: normalizedRegion,
            roleIndex,
            accountIdentity,
            roleCompositeLabel,
            gameAccountId: roleId,
            tokenActivationId,
            boundAt: nowAt,
            expiresAt,
            previousExpiresAt: previousExpiresAt || null,
            extendedFromActive,
            durationMonths,
          },
        },
      };
    });

    return res.status(result.status).json(result.payload);
  },
);

router.get(
  "/token-activations/status",
  (_req, res) => res.status(405).json({
    success: false,
    message: "激活状态查询仅支持 POST 提交",
  }),
);

router.post(
  "/token-activations/status",
  validateRequest({ body: activationStatusBodySchema }),
  (req, res) => {
    const tokenId = String(req.body?.tokenId || "").trim();
    const sessId = normalizeSessId(req.body?.sessId);
    const roleId = String(req.body?.roleId || req.body?.gameAccountId || "").trim();
    const roleName = String(req.body?.roleName || "").trim();
    const region = String(req.body?.region || req.body?.server || "").trim();
    const roleIndex = normalizeRoleIndex(req.body?.roleIndex);
    const normalizedRoleName = normalizeRoleName(roleName);
    const normalizedRegion = normalizeRegion(region);
    const accountIdentity = buildAccountIdentity({
      sessId,
      roleName: normalizedRoleName,
      region: normalizedRegion,
      roleId,
    });
    const userId = String(req.auth?.user?.id || "").trim();

    const bindingByTokenId = tokenId
      ? tokenActivationRepository.findByTokenId({ tokenId })
      : null;
    let binding = bindingByTokenId
      && String(bindingByTokenId.accountIdentity || "").trim() === accountIdentity
      ? bindingByTokenId
      : null;

    if (!binding) {
      binding = tokenActivationRepository.findByAccountIdentity({
        accountIdentity,
      });
    }
    if (!binding) {
      binding = tokenActivationRepository.findByRoleIdAndRegion({
        roleId,
        region: normalizedRegion,
        roleIndex,
      });
    }
    if (!binding) {
      if (bindingByTokenId) {
        return res.status(403).json({
          success: false,
          message: "该Token未绑定当前账号标识，请使用已绑定账号",
        });
      }
      return res.json({
        success: true,
        data: {
          tokenId: tokenId || null,
          roleId,
          roleName: normalizedRoleName,
          region: normalizedRegion,
          roleIndex,
          accountIdentity,
          sessId,
          gameAccountId: roleId,
          active: false,
          bound: false,
          expiresAt: null,
          boundAt: null,
        },
      });
    }

    if (String(binding.userId || "") !== userId) {
      return res.status(403).json({
        success: false,
        message: "该账号标识已绑定到其他用户",
      });
    }
    if (
      tokenId
      && bindingByTokenId
      && String(binding.id || "").trim() !== String(bindingByTokenId.id || "").trim()
    ) {
      return res.status(403).json({
        success: false,
        message: "该Token未绑定当前账号标识，请使用已绑定账号",
      });
    }

    const expiresAt = String(binding.expiresAt || "");
    const active = Boolean(binding.isActive) && new Date(expiresAt).getTime() > Date.now();
    const boundSessId = parseBoundSessId(binding.accountIdentity) || sessId;

    return res.json({
      success: true,
      data: {
        tokenId: tokenId || binding.tokenId || null,
        roleId: String(binding.roleId || roleId || "").trim(),
        roleName: binding.roleName || normalizedRoleName,
        region: binding.region || normalizedRegion,
        roleIndex: String(binding.roleIndex ?? roleIndex).trim(),
        accountIdentity: String(binding.accountIdentity || "").trim() || buildAccountIdentity({
          sessId: boundSessId,
          roleName: binding.roleName || normalizedRoleName,
          region: binding.region || normalizedRegion,
          roleId: String(binding.roleId || roleId || "").trim(),
        }),
        roleCompositeLabel: buildRoleCompositeLabel({
          roleName: binding.roleName || normalizedRoleName,
          region: binding.region || normalizedRegion,
          roleId: String(binding.roleId || roleId || "").trim(),
          roleIndex: String(binding.roleIndex ?? roleIndex).trim(),
        }),
        sessId: boundSessId,
        gameAccountId: String(binding.roleId || roleId || "").trim(),
        active,
        bound: true,
        expiresAt,
        boundAt: binding.boundAt || null,
      },
    });
  },
);

router.get("/token-activations/my", (_req, res) => {
  const userId = String(_req.auth?.user?.id || "").trim();
  const rows = tokenActivationRepository.listByUser(userId);
  const nowTs = Date.now();

  return res.json({
    success: true,
    data: rows.map((row) => {
      const safeRow = { ...row };
      delete safeRow.accountSeed;
      delete safeRow.accountSignature;
      return {
        ...safeRow,
        active: Boolean(row.isActive) && new Date(row.expiresAt).getTime() > nowTs,
      };
    }),
  });
});

export default router;
