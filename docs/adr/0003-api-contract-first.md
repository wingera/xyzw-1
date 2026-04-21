# ADR 0003: API Contract First

## Status

Accepted

## Context

后续重构会拆分认证、管理、任务控制、BIN 文件、反馈通知等业务域。若先移动实现再整理契约，容易引入公开 API 行为漂移，影响前端、后端测试和移动端/自动化调用方。

仓库已有 OpenAPI 校验脚本，应继续作为重构边界。

## Decision

后续重构采用 API contract first：

- 先确认 OpenAPI/schema/API client 契约，再移动实现。
- 公开 API 路径、请求字段、响应结构、错误码和鉴权语义默认不变。
- 契约相关资料逐步归拢到 `shared/contracts/` 或等价契约目录。
- 若必须修改公开契约，PR 必须包含测试覆盖、兼容说明和影响面说明。

## Consequences

- route/service/repository 拆分可以在契约保护下推进。
- 前后端边界更清晰，减少页面直接依赖后端实现细节。
- OpenAPI 校验失败时必须优先修复或记录，不得绕过。

## Alternatives considered

- 先搬迁代码，事后补契约：短期快，但容易隐藏 API 行为变化。
- 只依赖端到端手测：覆盖不稳定，难以及时发现字段或错误码漂移。
- 生成全新 client 并一次性替换调用层：范围过大，不适合第一阶段。

## Validation

运行：

```bash
npm run openapi:check
npm test
```

涉及 UI 或安全链路时额外运行：

```bash
npm run e2e:security
```
