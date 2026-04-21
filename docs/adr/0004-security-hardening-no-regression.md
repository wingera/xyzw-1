# ADR 0004: Security Hardening Has No Regression Budget

## Status

Accepted

## Context

当前仓库已经建立多项企业安全加固能力，包括 CSP、CSRF、MFA、CORS、生产配置校验、依赖治理、SBOM、npm audit、OpenAPI 校验和 legacy guard。

重构通常会移动鉴权、路由、代理、上传、任务调度和管理端代码。任何安全门禁回退都可能造成生产风险。

## Decision

第一阶段和后续重构都不得削弱已有安全能力：

- CSP、CSRF、MFA、CORS 和生产配置校验保持开启。
- 依赖治理、lockfile 策略、license check、SBOM 和 npm audit 继续作为供应链门禁。
- `npm run guard:legacy` 继续阻断 legacy Flask 进入生产链路。
- 管理端、BIN 文件、token import、任务守护和代理相关改动必须保留现有鉴权、白名单、路径安全和审计约束。
- 若安全检查当前失败，必须记录失败原因和修复建议，不得删除或绕过检查。

## Consequences

- 重构 PR 的验收成本更高，但回归风险更低。
- 安全链路改动需要更小步、更明确的测试覆盖。
- 供应链例外必须显式治理，不能隐式放宽门禁。

## Alternatives considered

- 重构期间临时放宽安全门禁：容易让临时例外进入长期生产流程，明确不采用。
- 只在发布前运行安全检查：反馈太晚，不利于小步重构。
- 把 legacy guard 从常规验收中移除：会增加 Flask 旧链路回流风险，明确不采用。

## Validation

运行：

```bash
npm run security:sca
npm run guard:legacy
```

涉及 UI 或安全链路时额外运行：

```bash
npm run e2e:security
```
