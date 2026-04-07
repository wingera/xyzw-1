import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "../config/env.js";
import { isAllowedHttpOrigin } from "../lib/origin.js";
import { requestLogger } from "../middleware/requestLogger.js";
import { csrfProtection } from "../middleware/csrf.js";

export function registerMiddleware(app) {
  app.set("trust proxy", env.trustProxy);

  const corsOriginSet = new Set(env.corsOrigins);
  const cspConnectSrc = Array.from(new Set(["'self'", ...env.cspConnectSrc]));

  const csrfExcludePaths = [
    // This endpoint is protected by strict Origin/Referer checks and route-level rate limits.
    "/api/v1/wechat-proxy/hortor-login",
    "/api/v1/wechat-proxy/qrstatus",
  ];

  const corsOptionsDelegate = (req, callback) => {
    const requestOrigin = String(req.get("origin") || "").trim();
    if (!requestOrigin) {
      return callback(null, {
        origin: false,
      });
    }
    if (isAllowedHttpOrigin(requestOrigin, corsOriginSet)) {
      return callback(null, {
        origin: requestOrigin,
        credentials: true,
      });
    }
    return callback(null, {
      origin: false,
    });
  };

  app.use(cors(corsOptionsDelegate));
  app.options("*", cors(corsOptionsDelegate));
  app.use(requestLogger);
  app.use(
    helmet({
      xContentTypeOptions: true,
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "no-referrer" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          connectSrc: cspConnectSrc,
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", "data:"],
          upgradeInsecureRequests: [],
        },
      },
    }),
  );
  app.use(express.json({ limit: "4mb" }));
  app.use(
    csrfProtection({
      excludePaths: csrfExcludePaths,
    }),
  );

  return { corsOriginSet };
}
