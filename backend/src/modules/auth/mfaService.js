import {
  getMfaChallengeUser,
  issueMfaChallengeToken,
  verifyMfaCredentials,
} from "./mfaChallenge.js";

export {
  issueMfaResetLinkToken,
  MFA_RESET_LINK_TTL_SECONDS,
  parseMfaResetLinkToken,
} from "./mfaChallenge.js";

export const createMfaLoginChallenge = ({
  user,
  rememberMe = false,
  loginMethod = "password+mfa",
}) =>
  issueMfaChallengeToken(user, {
    rememberMe,
    loginMethod,
  });

export const resolveMfaLoginChallenge = (mfaChallengeToken) =>
  getMfaChallengeUser(mfaChallengeToken);

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
