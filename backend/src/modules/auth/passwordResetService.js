import { createPassword } from "../../lib/crypto.js";
import { transaction } from "../../db/client.js";
import { nowIso } from "../../db/sql.js";
import { refreshTokenRepository } from "../../repositories/refreshTokenRepository.js";
import { userRepository } from "../../repositories/userRepository.js";

export const findPasswordResetUser = (identity) =>
  userRepository.findByIdentity(identity);

export const findPasswordResetSubject = (identity) =>
  findPasswordResetUser(identity);

export const findPasswordResetCode = ({ userId, shortCode }) =>
  userRepository.findLatestPasswordResetCode({
    userId,
    code: shortCode,
  });

export const deactivatePasswordResetCode = (codeId) => {
  userRepository.deactivatePasswordResetCode(codeId);
};

export const assertPasswordResetCodeUsable = ({ codeRow, nowMs = Date.now() }) => {
  if (!codeRow || Number(codeRow.isActive) !== 1 || codeRow.usedAt) {
    return {
      ok: false,
      reason: "invalid_or_inactive_code",
    };
  }

  const expiresTs = new Date(codeRow.expiresAt).getTime();
  if (!Number.isFinite(expiresTs) || expiresTs < nowMs) {
    deactivatePasswordResetCode(codeRow.id);
    return {
      ok: false,
      reason: "expired_code",
    };
  }

  return {
    ok: true,
  };
};

export const consumePasswordResetCode = ({ codeId, usedAt }) => {
  userRepository.usePasswordResetCode({
    id: codeId,
    usedAt,
  });
};

export const revokeUserRefreshSessionsForPasswordReset = ({ userId, revokedAt }) => {
  refreshTokenRepository.revokeAllByUserId({
    userId,
    revokedAt,
  });
};

export const applyPasswordReset = ({ user, codeRow, newPassword }) => {
  const meta = createPassword(newPassword);
  const ts = nowIso();
  transaction(() => {
    userRepository.updatePassword({
      id: user.id,
      passwordSalt: meta.salt,
      passwordHash: meta.hash,
      updatedAt: ts,
    });
    userRepository.bumpTokenVersion({
      id: user.id,
      updatedAt: ts,
    });
    revokeUserRefreshSessionsForPasswordReset({
      userId: user.id,
      revokedAt: ts,
    });
    consumePasswordResetCode({
      codeId: codeRow.id,
      usedAt: ts,
    });
  });
  return {
    updatedAt: ts,
  };
};
