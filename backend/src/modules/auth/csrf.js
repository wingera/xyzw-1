import { env } from "../../config/env.js";
import { readRefreshTokenFromRequest } from "./cookies.js";

export const buildCsrfResponseData = (req) => ({
  headerName: env.csrfHeaderName,
  token: req.csrfToken || null,
  hasRefreshTokenCookie: Boolean(readRefreshTokenFromRequest(req)),
});
