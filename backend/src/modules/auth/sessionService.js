import { userRepository } from "../../repositories/userRepository.js";

export const findSessionUserById = (userId) =>
  userRepository.findById(userId);

export const isRefreshTokenVersionCurrent = ({ refreshTokenRecord, user }) =>
  Number(refreshTokenRecord?.tokenVersion ?? 0) === Number(user?.tokenVersion ?? 0);

export const isSessionTrialExpired = (user) =>
  Boolean(
    user?.trialExpiresAt
      && Number.isFinite(new Date(user.trialExpiresAt).getTime())
      && new Date(user.trialExpiresAt).getTime() < Date.now(),
  );
