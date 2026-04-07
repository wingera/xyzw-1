import { buildLoopbackOriginAlias, normalizeHttpOrigin } from "./origin.js";

export const isTrustedSameOriginRequest = (req) => {
  const secFetchSite = String(req.get("sec-fetch-site") || "").trim().toLowerCase();
  if (secFetchSite === "same-origin") {
    return true;
  }

  const origin = normalizeHttpOrigin(req.get("origin") || "");
  const host = String(req.get("host") || "").trim();
  if (!origin || !host) {
    return false;
  }

  const protocol = `${String(req.protocol || (req.secure ? "https" : "http")).trim().toLowerCase()}:`;
  const currentOrigin = normalizeHttpOrigin(`${protocol}//${host}`);
  if (!currentOrigin) {
    return false;
  }
  if (origin.raw === currentOrigin.raw) {
    return true;
  }
  const alias = buildLoopbackOriginAlias(origin);
  return Boolean(alias && alias === currentOrigin.raw);
};
