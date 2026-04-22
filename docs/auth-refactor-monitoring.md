# Auth Refactor Monitoring

## Scope

This monitoring period covers the merged auth refactor stack:

- Auth helper extraction.
- Auth service seam.
- Session and refresh-token service extraction.
- Password reset service extraction.
- MFA challenge and reset-by-link extraction.
- MFA setup, enable, and disable extraction.
- MFA QR approve and poll extraction.
- CodeQL remediation.
- Auth abuse rate-limit guards.

This monitoring period intentionally does not continue:

- WeChat seam.
- Full login orchestration extraction.
- `finalizeLogin` extraction.
- Cookie/session response finalization extraction.
- Task-control, admin, database, or frontend task refactor.

Merged stack PRs:

- #2 `fix/refactor-gate-checks`
- #11 `docs/refactor-baseline-v2`
- #12 `refactor/auth-helper-modules-v2`
- #13 `qian/auth-service-seam-prep-v2`
- #19 `qian/session-service-extraction-v3`
- #20 `qian/password-reset-service-extraction-v3`
- #21 `qian/mfa-service-extraction-v3`
- #22 `qian/mfa-setup-service-extraction-v3`
- #23 `qian/mfa-qr-service-extraction-v3`

## Required gates

The following local gates must remain green before release or follow-up auth work:

- `npm ci`
- `npm --prefix backend ci`
- `npm --prefix backend test -- test/auth-helper-characterization.test.js test/auth-route-characterization.test.js test/auth-service-seam.test.js`
- `npm run lint`
- `npm run typecheck`
- `npm run openapi:check`
- `npm run security:sca`
- `npm test`
- `npm run guard:legacy`

The following GitHub checks must remain green:

- GitHub CodeQL
- `dependency-review`
- `sca-gate`
- `build-and-test`
- Android checks

## Manual smoke checklist

### 1. Login

- Valid username/password returns the existing success response and sets the expected cookies.
- Invalid password returns the existing invalid-credentials response.
- Legacy password hash upgrade path still works, if applicable in the target environment.
- Login blocked behavior still matches the previous response, if applicable.
- Trial expired behavior still matches the previous response, if applicable.

### 2. Refresh/session

- Valid refresh rotates the refresh token and issues the expected access token/cookie.
- Missing refresh token returns the expected refresh failure response.
- Malformed refresh token returns the expected refresh failure response.
- Revoked refresh token returns the expected refresh failure response and clears auth cookies.
- Expired refresh token returns the expected refresh failure response and revocation state.
- TokenVersion mismatch returns the expected refresh failure response and revocation state.
- Logout clears refresh/access/CSRF cookies as before.
- Logout-all revokes active sessions and preserves WebSocket disconnect behavior.

### 3. CSRF/cookies

- CSRF endpoint returns the expected token, header name, and refresh-cookie presence metadata.
- Unsafe method without a valid CSRF token is rejected by the existing middleware.
- Access, refresh, and CSRF cookie attributes match the current security policy.
- Cookie clearing on logout and password reset uses the expected cookie names and options.

### 4. Password reset

- Unknown identity returns the generic response.
- Invalid short code returns the generic response.
- Used or inactive short code returns the generic response.
- Expired short code returns the generic response.
- Valid reset updates the password and returns the generic response.
- Valid reset bumps `tokenVersion`.
- Valid reset revokes existing refresh tokens.

### 5. MFA

- MFA setup returns the existing secret and `otpauthUrl` response shape.
- MFA enable stores the encrypted secret and recovery code hashes.
- MFA disable with TOTP succeeds and clears MFA state.
- MFA disable with recovery code succeeds and clears MFA state.
- Invalid TOTP is rejected with the existing response.
- Recovery code behavior is unchanged, including consumed-code behavior.
- Reset-by-link invalid, expired, stale, and already-disabled paths preserve existing responses.
- QR approve/poll pending returns the existing pending response.
- QR approve success returns the existing approval response.
- QR poll approved login calls the route-owned login finalization and sets expected cookies.
- QR replay behavior rejects consumed/deleted sessions with the existing expired-session response.

### 6. WeChat

- WeChat login start returns the existing authorize URL/flow response when configured.
- WeChat callback code normalization is preserved.
- WeChat bind start returns the existing authorize URL/flow response.
- WeChat binding preserves the existing authenticated binding response.
- WeChat unbind preserves the existing authenticated unbind response.
- Validate existing behavior only; do not refactor WeChat during this monitoring period.

### 7. Rate limits / abuse guards

- Normal requests under abuse thresholds are unaffected.
- Sensitive auth endpoints return the expected `429` response at the abuse threshold.
- Existing DB-backed login limiter still works.
- Existing DB-backed MFA limiter still works.

### 8. Security monitoring

- No new CodeQL alerts.
- `dependency-review` remains green.
- `security:sca` remains green.
- No unexpected auth error spike appears in logs.
- No unusual increase in `401`, `403`, or `429` responses appears after rollout.

## Rollback notes

Security-sensitive merged PRs include:

- #12: auth helper extraction plus CodeQL remediation.
- #13: auth service seam prep plus CodeQL remediation and auth abuse guards.
- #19: session/refresh-token service extraction.
- #20: password reset service extraction.
- #21: MFA challenge/reset-link service extraction.
- #22: MFA setup/enable/disable service extraction plus CodeQL remediation.
- #23: MFA QR approve/poll service extraction.

Modules introduced or formalized by this stack:

- `backend/src/modules/auth/authSchemas.js`
- `backend/src/modules/auth/authService.js`
- `backend/src/modules/auth/cookies.js`
- `backend/src/modules/auth/csrf.js`
- `backend/src/modules/auth/mfaChallenge.js`
- `backend/src/modules/auth/mfaService.js`
- `backend/src/modules/auth/passwordReset.js`
- `backend/src/modules/auth/passwordResetService.js`
- `backend/src/modules/auth/session.js`
- `backend/src/modules/auth/sessionService.js`
- `backend/src/modules/auth/tokens.js`
- `backend/src/modules/auth/wechatAuthService.js`

Auth regressions should be identified by:

- Login, MFA, refresh, password reset, or WeChat smoke failures.
- Changes in public response status, body shape, cookie names, or cookie attributes.
- Unexpected increases in `401`, `403`, or `429` responses.
- New CodeQL/code scanning alerts.
- New dependency-review or SCA failures.
- Characterization test failures in auth helper, route, or service seam tests.

Before rollback or hotfix, run:

- `npm --prefix backend test -- test/auth-helper-characterization.test.js test/auth-route-characterization.test.js test/auth-service-seam.test.js`
- `npm run lint`
- `npm run typecheck`
- `npm run openapi:check`
- `npm run security:sca`
- `npm test`
- `npm run guard:legacy`

Do not revert isolated security hardening without security review. In particular, preserve CodeQL remediation, auth abuse guards, cookie parser hardening, refresh credential parsing, password reset log redaction, MFA verifier-result branching, and auth credential verification seams unless a security reviewer approves an alternative.

## Next phase proposal

### Phase 2.7 WeChat seam planning only

Rules:

- Planning only first.
- No code movement until tests are defined.
- Must preserve WeChat login, bind, unbind, and callback behavior.
- Must preserve WeChat MFA branch behavior.
- Must preserve callback code normalization.
- Must preserve auth abuse guards.
- Must preserve `routes/auth.js` HTTP, cookie, and security-event ownership unless explicitly tested.
