import { nowIso, secureId } from "../../db/sql.js";
import { signJwt, verifyJwt } from "../../lib/crypto.js";
import { userRepository } from "../../repositories/userRepository.js";
import {
  decryptMfaSecret,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "../../services/mfaService.js";

export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
export const MFA_CHALLENGE_PURPOSE = "auth-mfa-challenge";
export const MFA_RESET_LINK_TTL_SECONDS = 60 * 60;
export const MFA_RESET_LINK_PURPOSE = "auth-mfa-reset-link";
export const MFA_QR_SESSION_TTL_MS = MFA_CHALLENGE_TTL_SECONDS * 1000;
export const MAX_MFA_QR_SESSION_COUNT = 500;
const MISSING_TOTP_CODE = "__missing_mfa_totp_code__";
const MISSING_RECOVERY_CODE = "__missing_mfa_recovery_code__";

export const mfaQrSessionStore = new Map();

export const issueMfaChallengeToken = (
  user,
  {
    rememberMe = false,
    loginMethod = "password+mfa",
  } = {},
) =>
  signJwt(
    {
      sub: user.id,
      username: user.username,
      ver: Number(user.tokenVersion ?? 0),
      purpose: MFA_CHALLENGE_PURPOSE,
      rememberMe: Boolean(rememberMe),
      loginMethod: String(loginMethod || "password+mfa").trim() || "password+mfa",
    },
    5 * 60,
  );

export const issueMfaResetLinkToken = (user, { requestedBy = "" } = {}) =>
  signJwt(
    {
      sub: user.id,
      username: user.username,
      ver: Number(user.tokenVersion ?? 0),
      purpose: MFA_RESET_LINK_PURPOSE,
      requestedBy: String(requestedBy || "").trim() || null,
      mfaEnabled: Boolean(user.mfaEnabled),
    },
    60 * 60,
  );

export const parseMfaChallengeToken = (challengeToken) => {
  const payload = verifyJwt(challengeToken);
  if (String(payload?.purpose || "") !== MFA_CHALLENGE_PURPOSE) {
    throw new Error("invalid_mfa_challenge");
  }
  return payload;
};

export const parseMfaResetLinkToken = (token) => {
  const payload = verifyJwt(token);
  if (String(payload?.purpose || "") !== MFA_RESET_LINK_PURPOSE) {
    throw new Error("invalid_mfa_reset_link");
  }
  return payload;
};

export const getMfaChallengeUser = (challengeToken) => {
  let payload;
  try {
    payload = parseMfaChallengeToken(challengeToken);
  } catch {
    return {
      ok: false,
      status: 401,
      code: "AUTH_MFA_CHALLENGE_INVALID",
      message: "MFA 挑战无效或已过期",
    };
  }

  const user = userRepository.findById(String(payload?.sub || ""));
  if (!user) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_USER_NOT_FOUND",
      message: "用户不存在或已失效",
    };
  }
  if (!user.mfaEnabled || !user.mfaTotpSecretEnc) {
    return {
      ok: false,
      status: 403,
      code: "AUTH_MFA_SETUP_REQUIRED",
      message: "账号尚未启用双重验证",
    };
  }
  if (Number(payload?.ver) !== Number(user.tokenVersion ?? 0)) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_MFA_CHALLENGE_INVALID",
      message: "MFA 挑战无效或已过期",
    };
  }
  if (String(payload?.username || "") !== String(user.username || "")) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_MFA_CHALLENGE_INVALID",
      message: "MFA 挑战无效或已过期",
    };
  }

  const secret = decryptMfaSecret(user.mfaTotpSecretEnc);
  if (!secret) {
    return {
      ok: false,
      status: 403,
      code: "AUTH_MFA_SETUP_REQUIRED",
      message: "账号尚未启用双重验证",
    };
  }

  return {
    ok: true,
    user,
    payload,
    secret,
  };
};

export const verifyMfaCredentials = ({
  user,
  secret,
  totpCode,
  recoveryCode,
  updateMfaRecoveryCodesHash = userRepository.updateMfaRecoveryCodesHash,
}) => {
  const totpPassed = verifyTotpCode({
    secret,
    code: String(totpCode || MISSING_TOTP_CODE),
  });
  if (totpPassed) {
    return { ok: true };
  }

  const recoveryResult = verifyAndConsumeRecoveryCode({
    inputCode: String(recoveryCode || MISSING_RECOVERY_CODE),
    recoveryCodeHashesJson: user.mfaRecoveryCodesHash || "[]",
  });

  if (!recoveryResult.ok) {
    return { ok: false };
  }

  updateMfaRecoveryCodesHash({
    id: user.id,
    mfaRecoveryCodesHash: recoveryResult.nextRecoveryCodeHashesJson,
    updatedAt: nowIso(),
  });
  return { ok: true };
};

export const cleanupExpiredMfaQrSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of mfaQrSessionStore.entries()) {
    if (!session || Number(session.expiresAtMs) <= now || session.consumedAtMs) {
      mfaQrSessionStore.delete(sessionId);
    }
  }
  if (mfaQrSessionStore.size <= MAX_MFA_QR_SESSION_COUNT) {
    return;
  }
  const sessions = Array.from(mfaQrSessionStore.entries()).sort(
    (a, b) => Number(a?.[1]?.createdAtMs || 0) - Number(b?.[1]?.createdAtMs || 0),
  );
  const removeCount = Math.max(0, sessions.length - MAX_MFA_QR_SESSION_COUNT);
  for (let i = 0; i < removeCount; i += 1) {
    mfaQrSessionStore.delete(String(sessions[i]?.[0] || ""));
  }
};

export const createMfaQrSession = ({ userId, mfaChallengeToken }) => {
  cleanupExpiredMfaQrSessions();
  const now = Date.now();
  const sessionId = secureId("mfaqr");
  const session = {
    id: sessionId,
    userId,
    mfaChallengeToken,
    createdAtMs: now,
    expiresAtMs: now + MFA_QR_SESSION_TTL_MS,
    approvedAtMs: 0,
    consumedAtMs: 0,
  };
  mfaQrSessionStore.set(sessionId, session);
  return session;
};

export const getMfaQrSession = (sessionId) =>
  mfaQrSessionStore.get(String(sessionId || "").trim()) || null;

export const saveMfaQrSession = (session) => {
  if (!session?.id) {
    return;
  }
  mfaQrSessionStore.set(session.id, session);
};

export const deleteMfaQrSession = (sessionId) => {
  mfaQrSessionStore.delete(String(sessionId || "").trim());
};
