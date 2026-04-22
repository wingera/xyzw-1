import {
  getMfaChallengeUser,
  issueMfaChallengeToken,
  issueMfaResetLinkToken as issueMfaResetLinkTokenRaw,
  parseMfaResetLinkToken,
  verifyMfaCredentials,
} from "./mfaChallenge.js";
import { verifyAuthPassword } from "./authService.js";
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

export const verifyMfaAccountPassword = ({ userId, credential }) => {
  const userPwd = userRepository.findPasswordById(userId);
  return verifyAuthPassword({
    user: userPwd,
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
