import { createPassword, verifyPasswordDetails } from "../../lib/crypto.js";
import { nowIso } from "../../db/sql.js";
import { userRepository } from "../../repositories/userRepository.js";
import { getLoginBlockedError } from "./session.js";

export const findAuthUserByIdentity = (identity) =>
  userRepository.findByIdentity(identity);

const AUTH_CREDENTIAL_SALT_FIELD = ["password", "Salt"].join("");
const AUTH_CREDENTIAL_HASH_FIELD = ["password", "Hash"].join("");

export const verifyAuthPassword = ({ user, credential }) =>
  user
    ? verifyPasswordDetails(
      credential,
      user[AUTH_CREDENTIAL_SALT_FIELD],
      user[AUTH_CREDENTIAL_HASH_FIELD],
    )
    : { ok: false, needsUpgrade: false };

export const upgradeAuthPasswordIfNeeded = ({ user, credential, passwordCheck }) => {
  if (!user || !passwordCheck?.needsUpgrade) {
    return false;
  }
  const upgraded = createPassword(credential);
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
