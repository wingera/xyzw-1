import { userRepository } from "../../repositories/userRepository.js";

export const findPasswordResetUser = (identity) =>
  userRepository.findByIdentity(identity);

export const findPasswordResetCode = ({ userId, shortCode }) =>
  userRepository.findLatestPasswordResetCode({
    userId,
    code: shortCode,
  });

export const deactivatePasswordResetCode = (codeId) => {
  userRepository.deactivatePasswordResetCode(codeId);
};
