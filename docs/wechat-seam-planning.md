# Phase 2.7 WeChat Seam Planning

This document is planning-only. It does not authorize moving WeChat logic,
changing auth behavior, or modifying tests. The first implementation step after
review should be a tests-only PR.

## 当前 WeChat 职责清单

### Login start

- Endpoint: `POST /wechat/login/start`
- Current route responsibilities:
  - Apply `wechatLoginStartAbuseLimiter`.
  - Validate WeChat auth configuration.
  - Create a server-owned auth flow with `intent: "login"`.
  - Persist `rememberMe` in server-side flow state.
  - Return the existing `authorizeUrl` and `flowId` response shape.

### Bind start

- Endpoint: `POST /wechat/bind/start`
- Current route responsibilities:
  - Apply `wechatBindStartAbuseLimiter`.
  - Require authenticated user via `authRequired`.
  - Validate WeChat auth configuration.
  - Create a server-owned auth flow with `intent: "bind"`.
  - Persist the authenticated `userId` in server-side flow state.
  - Return the existing `authorizeUrl` and `flowId` response shape.

### Callback

- Endpoint: `GET /wechat/callback`
- Current route responsibilities:
  - Apply `wechatCallbackAbuseLimiter`.
  - Read `state` as `flowId`.
  - Normalize the callback `code` through the fixed allowlist.
  - Consume the auth flow exactly once.
  - Build and send callback HTML with a `postMessage` payload.
  - Preserve failure handling for unconfigured auth, invalid flow, missing code,
    upstream errors, bind failures, and login failures.
  - Preserve bind intent behavior.
  - Preserve login intent behavior.
  - Preserve MFA-required behavior.
  - Preserve successful WeChat login session behavior.

### Bind result lookup

- Endpoint: `GET /wechat/binding`
- Current route responsibilities:
  - Apply `wechatBindingAbuseLimiter`.
  - Require authenticated user via `authRequired`.
  - Validate WeChat auth configuration.
  - Query the current user's WeChat binding.
  - Return the existing `bound`, `nickname`, `avatarUrl`, `boundAt`,
    `lastLoginAt`, and `maskedOpenId` response shape.

### Unbind

- Endpoint: `POST /wechat/unbind`
- Current route responsibilities:
  - Apply `wechatUnbindAbuseLimiter`.
  - Require authenticated user via `authRequired`.
  - Require sensitive-action verification via `userSensitiveActionRequired`.
  - Validate WeChat auth configuration.
  - Clear current user's WeChat binding.
  - Record `wechat_unbind_success`.
  - Return the existing success response.

### MFA branch

- WeChat callback login branch checks `user.mfaEnabled`.
- If MFA is enabled:
  - Issue an MFA login challenge through existing MFA service boundaries.
  - Preserve `rememberMe` from the server-owned WeChat auth flow.
  - Preserve `loginMethod: "wechat+mfa"`.
  - Record `wechat_login_failed` with reason `mfa_required`.
  - Return callback HTML payload with `mfaRequired` and `mfaChallengeToken`.
  - Do not issue access or refresh cookies before `/mfa/verify`.
- The final MFA login session remains owned by existing `/mfa/verify`
  route-level orchestration.

### Callback code normalization

- Callback `code` is currently normalized before upstream exchange.
- Allowed pattern: alphanumeric plus `_` and `-`, length 1 to 512.
- Invalid, empty, newline/control-character, or oversized values must continue
  into the missing-code failure path.
- Raw callback code must never be passed to upstream exchange or exposed in
  callback payloads.

### Rate-limit guards

WeChat routes currently have abuse guards that must stay attached:

- `wechatLoginStartAbuseLimiter`
- `wechatBindStartAbuseLimiter`
- `wechatCallbackAbuseLimiter`
- `wechatBindingAbuseLimiter`
- `wechatUnbindAbuseLimiter`

### Cookie/session/finalizeLogin

- WeChat non-MFA callback success currently issues login session from the route
  because the response is callback HTML, not JSON login response.
- WeChat MFA callback does not issue cookies; it returns an MFA challenge.
- Cookie writing and final login behavior should remain route-owned unless
  explicit characterization tests prove an equivalent behavior.

### Security event recording

The route currently records WeChat security events with request metadata:

- `wechat_bind_failed`
- `wechat_bind_success`
- `wechat_login_failed`
- `wechat_unbind_success`

Route ownership of `recordSecurityEvent` and `reqMeta(req)` should remain until
tests pin every event type, reason, user id, and request metadata shape.

## 不可回退安全边界

- Keep `express-rate-limit` abuse guards on all WeChat auth routes.
- Keep callback code normalization and its fixed allowlist.
- Keep callback state single-use consumption semantics.
- Keep auth flow TTL cleanup behavior.
- Keep `MAX_WECHAT_AUTH_FLOW_COUNT` cleanup behavior.
- Keep `intent=bind` and `intent=login` separated; do not allow intent reuse.
- Keep bind flow `userId` sourced from server-saved flow state, not request
  body, query, or callback payload.
- Keep MFA challenge/reset-link semantics, including token purpose, version,
  TTL, and `wechat+mfa` login method.
- Keep WeChat MFA branch from issuing access/refresh cookies before MFA verify.
- Keep existing service boundaries for:
  - `authService`
  - `sessionService`
  - `passwordResetService`
  - `mfaService`
- Keep route-owned HTTP status, response body, callback HTML, cookie/session,
  and security-event behavior unless explicitly covered by tests.
- Keep callback HTML payload from exposing raw `code`, raw `openId`, access
  tokens, refresh tokens, cookie values, or session internals.
- Keep `postMessage` payload shape stable:
  - `source`
  - `intent`
  - `flowId`
  - `success`
  - `message`
  - `errorCode` when failure has an error
  - `mfaRequired` when MFA is required
  - `mfaChallengeToken` when MFA is required

## 需要补的 characterization tests

Add route-level tests first. Do not move production code until these are in
place and green.

| Area | Test case | Expected invariant |
|---|---|---|
| Login start | configured WeChat auth returns `authorizeUrl` and `flowId` | Existing response shape unchanged |
| Login start | unconfigured WeChat auth | `503 AUTH_WECHAT_NOT_CONFIGURED` unchanged |
| Login start | `rememberMe: true` persists through callback login | Session remember behavior unchanged |
| Bind start | unauthenticated request | Existing auth missing response unchanged |
| Bind start | configured authenticated request | Existing `authorizeUrl` and `flowId` response shape unchanged |
| Bind start | unconfigured WeChat auth | `503 AUTH_WECHAT_NOT_CONFIGURED` unchanged |
| Callback state | missing or invalid `state` | Callback payload has `AUTH_WECHAT_FLOW_INVALID` |
| Callback state | same `flowId` callback twice | Second callback follows invalid/consumed path |
| Callback code | missing `code` | Callback payload has `AUTH_WECHAT_CODE_MISSING`; event recorded |
| Callback code | newline/control chars | Normalized to missing-code path |
| Callback code | oversized code | Normalized to missing-code path |
| Callback code | valid allowlisted code | Passed to upstream exchange after normalization |
| Callback HTML | failure payload | Does not include raw code, raw openId, token, cookie, or session detail |
| Callback HTML | success payload | Does not include raw code, raw openId, token, cookie, or session detail |
| postMessage | login success payload | `source`, `intent`, `flowId`, `success`, `message` shape unchanged |
| postMessage | failure payload | `errorCode` shape unchanged |
| postMessage | MFA payload | `mfaRequired` and `mfaChallengeToken` shape unchanged |
| Auth flow TTL | expired flow cleanup | Expired flow cannot be consumed |
| Auth flow max count | count exceeds `MAX_WECHAT_AUTH_FLOW_COUNT` | Oldest excess flows are cleaned without weakening cap |
| Intent separation | bind flow used as login | Does not log in as WeChat identity |
| Intent separation | login flow used as bind | Does not bind to a user |
| Bind identity | bind callback user id | Uses server-saved flow `userId`, not callback request input |
| Callback upstream | upstream token/profile error | Existing upstream error payload and security event preserved |
| Bind callback | flow user missing | `AUTH_USER_NOT_FOUND` payload and bind failed event preserved |
| Bind callback | WeChat already bound to another account | `AUTH_WECHAT_ALREADY_BOUND` payload and event preserved |
| Bind callback | idempotent same-user binding | Existing `boundAt` semantics preserved |
| Bind callback | successful new binding | DB fields updated and `wechat_bind_success` recorded |
| Login callback | WeChat identity not bound | `AUTH_WECHAT_NOT_BOUND` payload and masked-open-id event detail preserved |
| Login callback | blocked/trial-expired user | Existing blocked code/message propagated |
| Login callback | non-MFA success | Session cookies written and callback payload unchanged |
| Login callback MFA | MFA-enabled user | Callback payload includes challenge token and no auth cookies |
| Login callback MFA | verify challenge through `/mfa/verify` | Final response/cookies match existing MFA login |
| Binding lookup | unconfigured WeChat auth | `503 AUTH_WECHAT_NOT_CONFIGURED` unchanged |
| Binding lookup | no binding | `bound: false` and empty display fields preserved |
| Binding lookup | existing binding | masked openId/nickname/avatar/boundAt/lastLoginAt preserved |
| Unbind | unauthenticated request | Existing auth failure unchanged |
| Unbind | missing sensitive action | Existing sensitive-action failure unchanged |
| Unbind | no existing binding | Success response and `hadBinding: false` event preserved |
| Unbind | existing binding | Binding cleared and `hadBinding: true` event preserved |
| Rate limits | normal request volume | Existing successful behavior unaffected |
| Rate limits | each WeChat auth route over threshold | Expected `429` response |

## 推荐拆分边界

### 可考虑进入 `wechatAuthService`

Only after tests are defined:

- Auth flow store helpers:
  - cleanup expired flows
  - create flow
  - consume flow
  - TTL and max-count cleanup
- Callback code normalization helper, if tests pin the fixed allowlist.
- Callback payload helper:
  - payload construction
  - safe `postMessage` payload shape
  - masked openId helper
- Binding decision helpers:
  - existing binding lookup result interpretation
  - same-user binding idempotency decision
  - conflict classification
  - `boundAt` selection
- Login decision helpers that return data-only results:
  - not bound
  - blocked
  - MFA required
  - login ready

### 必须继续留在 `routes/auth.js`

- Express route definitions.
- Middleware order and attachment.
- All `wechat*AbuseLimiter` usage.
- `authRequired` and `userSensitiveActionRequired`.
- HTTP status and response mapping.
- Callback HTML sending.
- Cookie/session finalization.
- `issueLoginSession` side effects.
- `finalizeLogin` ownership.
- `recordSecurityEvent` calls until every event is characterized.
- `reqMeta(req)` ownership.
- MFA verify route and final login behavior.
- Full WeChat callback orchestration until smaller helper PRs are proven.

## PR 顺序建议

1. **PR 2.7a: WeChat route characterization tests only**
   - Add route-level tests for login start, bind start, callback failure paths,
     binding, unbind, callback state replay, callback payload safety, auth flow
     TTL/max count, intent separation, and WeChat MFA branch.
   - No production code movement.

2. **PR 2.7b: Extract WeChat flow and payload pure helpers**
   - Move only auth flow and payload helpers after tests are green.
   - Keep route-owned HTTP, cookie, session, and security event behavior.

3. **PR 2.7c: Extract bind decision helpers**
   - Move binding conflict/idempotency/boundAt decisions.
   - Keep response mapping and event recording in routes.

4. **PR 2.7d: Extract login decision helpers**
   - Move not-bound/blocked/MFA-required/login-ready classification.
   - Keep `issueLoginSession`, callback HTML, cookies, and events in routes.

5. **Stop before full callback orchestration extraction**
   - Only revisit after monitoring and review confirm no regressions.
   - Full callback orchestration is high risk because callback HTML, cookies,
     MFA, sessions, flow state, and security events intersect.

## 风险点

- WeChat callback and MFA challenge intersect at `wechat+mfa`; `rememberMe` and
  `loginMethod` must be preserved.
- WeChat MFA branch must not sign access/refresh cookies before `/mfa/verify`.
- Direct WeChat login success sends callback HTML, not JSON; session behavior
  must not be accidentally moved into `finalizeLogin`.
- Callback state must be single-use; replayed callback state must remain invalid.
- Bind/login intent must not be interchangeable.
- Bind user id must come from server-side flow state.
- Callback code normalization must not pass raw query values to upstream
  exchange.
- Callback HTML payload must not leak raw `code`, raw `openId`, token, cookie,
  or session detail.
- `postMessage` payload shape is part of the frontend integration contract.
- Security events can lose useful `userId` or reason details if moved too early.
- Flow TTL and max-count cleanup can become weaker if store helpers are moved
  without characterization tests.
- WeChat binding conflict detection depends on both repository checks and DB
  unique constraint error classification.
- Abuse limiter middleware order must remain unchanged.
- WeChat unbind depends on both auth and sensitive-action middleware.
