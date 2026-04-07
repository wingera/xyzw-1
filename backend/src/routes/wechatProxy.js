import express, { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { isAllowedHttpOrigin, normalizeHttpOrigin } from "../lib/origin.js";
import { authOptional } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validateRequest } from "../middleware/validate.js";

const router = Router();
const PROXY_TIMEOUT_MS = 15000;
const HORTOR_LOGIN_BODY_LIMIT = "64kb";
const HORTOR_DEVICE_UNIQUE_ID_HEADER = "x-xyzw-device-unique-id";
const HORTOR_DEVICE_UNIQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const QR_STATUS_BODY_SCHEMA = z.object({
  uuid: z.string().trim().min(1).max(256),
});

const qrConnectLimiter = createRateLimiter({
  scope: "wechat_proxy_qrconnect",
  windowMs: 60 * 1000,
  max: 60,
  blockMs: 5 * 60 * 1000,
});

const qrStatusLimiter = createRateLimiter({
  scope: "wechat_proxy_qrstatus",
  windowMs: 60 * 1000,
  max: 180,
  blockMs: 5 * 60 * 1000,
});

const hortorLoginLimiter = createRateLimiter({
  scope: "wechat_proxy_hortor_login",
  windowMs: 60 * 1000,
  max: 30,
  blockMs: 5 * 60 * 1000,
});

const allowedHortorRequestOrigins = new Set(
  (env.corsOrigins || [])
    .map((item) => normalizeHttpOrigin(item)?.raw || "")
    .filter(Boolean),
);

const ensureAllowedHortorSource = (req, res, next) => {
  const requestOrigin = String(req.get("origin") || "").trim();
  const refererOrigin = String(req.get("referer") || "").trim();
  const originAllowed = requestOrigin && isAllowedHttpOrigin(requestOrigin, allowedHortorRequestOrigins);
  const refererAllowed = refererOrigin && isAllowedHttpOrigin(refererOrigin, allowedHortorRequestOrigins);
  if (!originAllowed && !refererAllowed) {
    return res.status(403).json({
      success: false,
      message: "请求来源非法",
    });
  }
  return next();
};

const enforceGuestOnlyForHortorLogin = (req, res, next) => {
  if (!env.wechatProxyHortorLoginGuestOnly) {
    return next();
  }
  if (req.auth?.user?.id) {
    return res.status(403).json({
      success: false,
      message: "当前流程不支持已登录用户调用",
    });
  }
  return next();
};

const appendQuery = (target, query) => {
  Object.entries(query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) {
          target.searchParams.append(key, String(item));
        }
      });
      return;
    }
    if (value !== undefined && value !== null) {
      target.searchParams.append(key, String(value));
    }
  });
};

const hasNonEmptyQueryValue = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => String(item ?? "").trim());
  }
  return Boolean(String(value ?? "").trim());
};

const proxyText = async ({ res, url, method = "GET", body = undefined, headers = {} }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method,
      body,
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");
    if (contentType) {
      res.set("content-type", contentType);
    }
    if (contentLength) {
      res.set("content-length", contentLength);
    }
    const text = await upstream.text();
    return res.status(upstream.status).send(text);
  } catch (error) {
    const isTimeout = String(error?.name || "").toLowerCase() === "aborterror";
    return res.status(502).json({
      success: false,
      message: isTimeout ? "上游请求超时" : `上游请求失败: ${error?.message || "unknown error"}`,
    });
  } finally {
    clearTimeout(timer);
  }
};

router.get("/wechat-proxy/qrconnect", qrConnectLimiter, async (req, res) => {
  const target = new URL("https://open.weixin.qq.com/connect/app/qrconnect");
  appendQuery(target, req.query);
  return proxyText({
    res,
    url: target.toString(),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      Referer: "https://open.weixin.qq.com/",
    },
  });
});

router.post(
  "/wechat-proxy/qrstatus",
  qrStatusLimiter,
  validateRequest({ body: QR_STATUS_BODY_SCHEMA }),
  async (req, res) => {
    if (hasNonEmptyQueryValue(req.query?.["uuid"])) {
      return res.status(400).json({
        success: false,
        message: "uuid 不能通过 URL 参数传递",
      });
    }

  const target = new URL("https://long.open.weixin.qq.com/connect/l/qrconnect");
    target.searchParams.set("uuid", req.body.uuid);
    target.searchParams.set("f", "url");
    target.searchParams.set("_", String(Date.now()));
    return proxyText({
      res,
      url: target.toString(),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN",
        Accept: "*/*",
        Referer: "https://open.weixin.qq.com/",
      },
    });
  },
);

router.post(
  "/wechat-proxy/hortor-login",
  hortorLoginLimiter,
  authOptional,
  enforceGuestOnlyForHortorLogin,
  ensureAllowedHortorSource,
  express.text({ type: "*/*", limit: HORTOR_LOGIN_BODY_LIMIT }),
  async (req, res) => {
    const rawDeviceUniqueId = String(
      req.get(HORTOR_DEVICE_UNIQUE_ID_HEADER) || "",
    ).trim();
    if (hasNonEmptyQueryValue(req.query?.["deviceUniqueId"])) {
      return res.status(400).json({
        success: false,
        message: "deviceUniqueId 不能通过 URL 参数传递",
      });
    }
    if (!HORTOR_DEVICE_UNIQUE_ID_PATTERN.test(rawDeviceUniqueId)) {
      return res.status(400).json({
        success: false,
        message: "deviceUniqueId 非法",
      });
    }

    const target = new URL("https://comb-platform.hortorgames.com/comb-login-server/api/v1/login");
    const passthroughQuery = { ...req.query };
    delete passthroughQuery.deviceUniqueId;
    appendQuery(target, passthroughQuery);
    target.searchParams.set("deviceUniqueId", rawDeviceUniqueId);
    return proxyText({
      res,
      url: target.toString(),
      method: "POST",
      body: String(req.body || ""),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36",
        Accept: "*/*",
        Origin: "https://open.weixin.qq.com",
        Referer: "https://open.weixin.qq.com/",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  },
);

export default router;
