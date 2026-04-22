import {
  cleanupExpiredMfaQrSessions,
  deleteMfaQrSession,
  getMfaChallengeUser,
  getMfaQrSession,
  issueMfaChallengeToken,
  issueMfaResetLinkToken as issueMfaResetLinkTokenRaw,
  parseMfaResetLinkToken,
  saveMfaQrSession,
  verifyMfaCredentials,
} from "./mfaChallenge.js";
import {
  findAuthUserByIdentity,
  verifyAuthPassword,
} from "./authService.js";
import { nowIso } from "../../db/sql.js";
import { refreshTokenRepository } from "../../repositories/refreshTokenRepository.js";
import { userRepository } from "../../repositories/userRepository.js";
import {
  createMfaSetupPayload,
  decryptMfaSecret,
  encryptMfaSecret,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "../../services/mfaService.js";

export {
  MFA_RESET_LINK_TTL_SECONDS,
  parseMfaResetLinkToken,
} from "./mfaChallenge.js";

export const issueLoginMfaChallenge = ({
  user,
  rememberMe = false,
  loginMethod = "password+mfa",
}) =>
  issueMfaChallengeToken(user, {
    rememberMe,
    loginMethod,
  });

export const createMfaLoginChallenge = issueLoginMfaChallenge;

export const assertMfaChallengeUsable = (mfaChallengeToken) =>
  getMfaChallengeUser(mfaChallengeToken);

export const resolveMfaLoginChallenge = (mfaChallengeToken) =>
  assertMfaChallengeUsable(mfaChallengeToken);

export const verifyMfaLoginCredentials = ({
  user,
  secret,
  totpCode,
  recoveryCode,
}) =>
  verifyMfaCredentials({
    user,
    secret,
    totpCode,
    recoveryCode,
  });

export const issueMfaResetLinkToken = (user, options = {}) =>
  issueMfaResetLinkTokenRaw(user, options);

export const verifyMfaResetLinkToken = (token) => {
  try {
    return {
      ok: true,
      payload: parseMfaResetLinkToken(String(token || "").trim()),
    };
  } catch {
    return {
      ok: false,
      status: 401,
      message: "重置链接无效或已过期",
    };
  }
};

export const findMfaResetLinkUser = (payload) =>
  userRepository.findById(String(payload?.sub || ""));

export const isMfaResetLinkTokenVersionCurrent = ({ user, payload }) =>
  Number(user?.tokenVersion ?? 0) === Number(payload?.ver ?? -1);

export const resolveMfaResetLinkRequest = ({
  token,
  isLocalRequest = false,
} = {}) => {
  const tokenCheck = verifyMfaResetLinkToken(token);
  if (!tokenCheck.ok) {
    return tokenCheck;
  }

  const user = findMfaResetLinkUser(tokenCheck.payload);
  if (!user) {
    return {
      ok: false,
      status: 404,
      message: "账号不存在",
      payload: tokenCheck.payload,
    };
  }

  if (user.isAdmin && !isLocalRequest) {
    return {
      ok: false,
      status: 403,
      message: "管理员账号的二次验证重置仅允许在本地 127.0.0.1 环境执行",
      user,
      payload: tokenCheck.payload,
    };
  }

  if (!isMfaResetLinkTokenVersionCurrent({ user, payload: tokenCheck.payload })) {
    return {
      ok: false,
      status: 401,
      message: "重置链接无效或已失效",
      user,
      payload: tokenCheck.payload,
    };
  }

  return {
    ok: true,
    user,
    payload: tokenCheck.payload,
  };
};

export const applyMfaResetByLink = ({ user }) => {
  if (!user?.mfaEnabled) {
    return {
      ok: true,
      resetApplied: false,
      alreadyDisabled: true,
    };
  }

  const ts = nowIso();
  userRepository.disableMfa({
    id: user.id,
    updatedAt: ts,
  });
  userRepository.bumpTokenVersion({
    id: user.id,
    updatedAt: ts,
  });
  refreshTokenRepository.revokeAllByUserId({
    userId: user.id,
    revokedAt: ts,
  });

  return {
    ok: true,
    resetApplied: true,
    updatedAt: ts,
  };
};

export const verifyMfaAccountPassword = ({ identity, credential }) => {
  const user = findAuthUserByIdentity(identity);
  return verifyAuthPassword({
    user,
    credential: String(credential || ""),
  }).ok;
};

export const createMfaSetup = ({ username }) =>
  createMfaSetupPayload({ username });

export const buildMfaSetupResponse = (setup) => ({
  secret: setup.secret,
  otpauthUrl: setup.otpauthUrl,
});

export const verifyMfaSetupCode = ({ secret, totpCode }) =>
  verifyTotpCode({
    secret: String(secret || "").trim(),
    code: String(totpCode || "").trim(),
  });

export const enableUserMfa = ({ userId, username, secret }) => {
  const setup = createMfaSetup({ username });
  const updatedAt = nowIso();
  userRepository.updateMfaSettings({
    id: userId,
    mfaEnabled: true,
    mfaTotpSecretEnc: encryptMfaSecret(secret),
    mfaRecoveryCodesHash: JSON.stringify(setup.recoveryCodeHashes),
    updatedAt,
  });

  return {
    recoveryCodes: setup.recoveryCodes,
    updatedAt,
  };
};

const verifyMfaDisableTotpCredential = ({ secret, totpCode }) => ({
  method: "totp",
  ok: Boolean(secret) && verifyTotpCode({
    secret,
    code: String(totpCode || "").trim(),
  }),
});

const verifyMfaDisableRecoveryCredential = ({ user, recoveryCode }) => {
  const recoveryResult = verifyAndConsumeRecoveryCode({
    inputCode: String(recoveryCode || "").trim(),
    recoveryCodeHashesJson: user?.mfaRecoveryCodesHash || "[]",
  });
  return {
    method: "recovery",
    ok: recoveryResult.ok,
  };
};

const resolveMfaDisableCredentialVerification = ({
  user,
  secret,
  totpCode,
  recoveryCode,
}) => {
  const verifications = [
    verifyMfaDisableTotpCredential({ secret, totpCode }),
    verifyMfaDisableRecoveryCredential({ user, recoveryCode }),
  ];
  return verifications.find((verification) => verification.ok) || {
    method: "none",
    ok: false,
  };
};

export const verifyMfaDisableRequest = ({
  userId,
  totpCode = "",
  recoveryCode = "",
}) => {
  const user = userRepository.findById(userId);
  const secret = decryptMfaSecret(user?.mfaTotpSecretEnc || "");
  const verification = resolveMfaDisableCredentialVerification({
    user,
    secret,
    totpCode,
    recoveryCode,
  });

  return {
    ok: verification.ok,
    user,
  };
};

export const disableUserMfa = ({ userId }) => {
  const updatedAt = nowIso();
  userRepository.disableMfa({
    id: userId,
    updatedAt,
  });
  return {
    updatedAt,
  };
};

const mfaQrSessionError = (message) => ({
  ok: false,
  status: 410,
  code: "AUTH_MFA_QR_SESSION_EXPIRED",
  message,
});

const resolveMfaQrSession = (sessionId) => {
  cleanupExpiredMfaQrSessions();
  const normalizedSessionId = String(sessionId || "").trim();
  const session = getMfaQrSession(normalizedSessionId);
  if (!session) {
    return mfaQrSessionError("二维码会话已失效，请刷新二维码后重试");
  }
  if (session.consumedAtMs) {
    deleteMfaQrSession(normalizedSessionId);
    return mfaQrSessionError("二维码会话已失效，请刷新二维码后重试");
  }
  if (Date.now() > Number(session.expiresAtMs || 0)) {
    deleteMfaQrSession(normalizedSessionId);
    return mfaQrSessionError("二维码会话已过期，请刷新二维码后重试");
  }

  return {
    ok: true,
    sessionId: normalizedSessionId,
    session,
  };
};

export const resolveQrApprovalRequest = ({
  sessionId,
  totpCode = "",
  recoveryCode = "",
}) => {
  const normalizedTotpCode = String(totpCode || "").trim();
  const normalizedRecoveryCode = String(recoveryCode || "").trim();
  if (!normalizedTotpCode && !normalizedRecoveryCode) {
    return {
      ok: false,
      status: 400,
      message: "请输入验证码或恢复码",
    };
  }

  const sessionCheck = resolveMfaQrSession(sessionId);
  if (!sessionCheck.ok) {
    return sessionCheck;
  }

  const challengeCheck = getMfaChallengeUser(sessionCheck.session.mfaChallengeToken);
  if (!challengeCheck.ok) {
    deleteMfaQrSession(sessionCheck.sessionId);
    return challengeCheck;
  }

  const credentialsCheck = verifyMfaCredentials({
    user: challengeCheck.user,
    secret: challengeCheck.secret,
    totpCode: normalizedTotpCode,
    recoveryCode: normalizedRecoveryCode,
  });

  if (!credentialsCheck.ok) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_MFA_INVALID_CODE",
      message: "双重验证失败，请重试",
      user: challengeCheck.user,
      failureReason: "mfa_qr_verify_failed",
    };
  }

  return {
    ok: true,
    sessionId: sessionCheck.sessionId,
    session: sessionCheck.session,
    user: challengeCheck.user,
  };
};

export const approveMfaQrSession = ({ session }) => {
  const nextSession = {
    ...session,
    approvedAtMs: Date.now(),
  };
  saveMfaQrSession(nextSession);
  return nextSession;
};

export const getMfaQrPollState = ({ sessionId }) => {
  const sessionCheck = resolveMfaQrSession(sessionId);
  if (!sessionCheck.ok) {
    return sessionCheck;
  }

  if (!sessionCheck.session.approvedAtMs) {
    return {
      ok: true,
      status: "pending",
      sessionId: sessionCheck.sessionId,
      session: sessionCheck.session,
    };
  }

  const challengeCheck = getMfaChallengeUser(sessionCheck.session.mfaChallengeToken);
  if (!challengeCheck.ok) {
    deleteMfaQrSession(sessionCheck.sessionId);
    return challengeCheck;
  }

  const consumedSession = {
    ...sessionCheck.session,
    consumedAtMs: Date.now(),
  };
  saveMfaQrSession(consumedSession);
  deleteMfaQrSession(sessionCheck.sessionId);
  return {
    ok: true,
    status: "approved",
    sessionId: sessionCheck.sessionId,
    session: consumedSession,
    user: challengeCheck.user,
    rememberMe: Boolean(challengeCheck.payload?.rememberMe),
    loginMethod: String(challengeCheck.payload?.loginMethod || "password+mfa"),
  };
};

export const buildMfaQrPollResponse = ({ status }) => ({
  success: true,
  data: {
    status,
  },
});
