import assert from "node:assert/strict";
import test from "node:test";
import * as authService from "../src/modules/auth/authService.js";
import * as sessionService from "../src/modules/auth/sessionService.js";
import * as mfaService from "../src/modules/auth/mfaService.js";
import * as passwordResetService from "../src/modules/auth/passwordResetService.js";
import * as wechatAuthService from "../src/modules/auth/wechatAuthService.js";
import * as authSchemas from "../src/modules/auth/authSchemas.js";

test("auth service seam exposes thin wrappers for future route extraction", () => {
  assert.equal(typeof authService.findAuthUserByIdentity, "function");
  assert.equal(typeof authService.verifyAuthPassword, "function");
  assert.equal(typeof authService.upgradeAuthPasswordIfNeeded, "function");
  assert.equal(typeof authService.getAuthLoginBlockedError, "function");

  assert.equal(typeof sessionService.findSessionUserById, "function");
  assert.equal(typeof sessionService.getSessionUser, "function");
  assert.equal(typeof sessionService.findRefreshSessionByTokenHash, "function");
  assert.equal(typeof sessionService.assertRefreshSessionUsable, "function");
  assert.equal(typeof sessionService.assertTokenVersionCurrent, "function");
  assert.equal(typeof sessionService.assertTrialActive, "function");
  assert.equal(typeof sessionService.rotateRefreshSession, "function");
  assert.equal(typeof sessionService.revokeRefreshSession, "function");
  assert.equal(typeof sessionService.isRefreshTokenVersionCurrent, "function");
  assert.equal(typeof sessionService.isSessionTrialExpired, "function");

  assert.equal(typeof mfaService.createMfaLoginChallenge, "function");
  assert.equal(typeof mfaService.resolveMfaLoginChallenge, "function");
  assert.equal(typeof mfaService.verifyMfaLoginCredentials, "function");
  assert.equal(typeof mfaService.issueMfaResetLinkToken, "function");
  assert.equal(typeof mfaService.MFA_RESET_LINK_TTL_SECONDS, "number");

  assert.equal(typeof passwordResetService.findPasswordResetUser, "function");
  assert.equal(typeof passwordResetService.findPasswordResetCode, "function");
  assert.equal(typeof passwordResetService.deactivatePasswordResetCode, "function");

  assert.equal(typeof wechatAuthService.isWechatAuthConfigured, "function");
  assert.equal(typeof wechatAuthService.buildWechatAuthorizeUrl, "function");
  assert.equal(typeof wechatAuthService.loadWechatUserProfileByCode, "function");

  assert.equal(typeof authSchemas.loginBodySchema?.parse, "function");
  assert.equal(typeof authSchemas.passwordResetBodySchema?.parse, "function");
  assert.equal(typeof authSchemas.mfaVerifyBodySchema?.parse, "function");
});
