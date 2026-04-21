import { createPassword, verifyPasswordDetails } from "../../lib/crypto.js";
import { nowIso } from "../../db/sql.js";
import { userRepository } from "../../repositories/userRepository.js";
import { getLoginBlockedError } from "./session.js";

export const findAuthUserByIdentity = (identity) =>
  userRepository.findByIdentity(identity);

export const verifyAuthPassword = ({ user, password }) =>
  user
    ? verifyPasswordDetails(password, user.passwordSalt, user.passwordHash)
    : { ok: false, needsUpgrade: false };

export const upgradeAuthPasswordIfNeeded = ({ user, password, passwordCheck }) => {
  if (!user || !passwordCheck?.needsUpgrade) {
    return false;
  }
  const upgraded = createPassword(password);
  userRepository.updatePassword({
    id: user.id,
    passwordSalt: upgraded.salt,
    passwordHash: upgraded.hash,
    updatedAt: nowIso(),
  });
  return true;
};

export const getAuthLoginBlockedError = (user) =>
  getLoginBlockedError(user);
