# ADR 0001: Keep Express, Vue, SQLite, and a Modular Monolith

## Status

Accepted

## Context

XYZW Web Helper 的当前生产主链路是 `src/` 前端和 `backend/` 后端。前端使用 Vue 3 + Vite，后端使用 Express + WebSocket + SQLite (`better-sqlite3`)。仓库已经围绕这条链路建立了启动文档、安全校验、OpenAPI 校验、legacy guard 和测试脚本。

第一阶段目标是建立可持续重构基线，不是替换技术栈。

## Decision

第一阶段继续保留：

- Vue 3 + Vite 前端。
- Express + WebSocket 后端。
- SQLite (`better-sqlite3`) 数据存储。
- npm 与现有 lockfile。
- 单仓库、模块化单体架构。

后续重构通过 `backend/src/modules/`、`src/features/` 和 `shared/contracts/` 渐进拆分业务边界，不引入 NestJS、React、PostgreSQL、pnpm、yarn 或 monorepo workspace。

## Consequences

- 现有生产部署、开发启动和安全门禁保持稳定。
- 后续 PR 可以小步拆分 route、service、view 和 repository。
- 大规模架构迁移暂不进入第一阶段，避免扩大回归面。
- 模块边界需要通过文档、测试和代码 review 持续执行。

## Alternatives considered

- 切换到 NestJS：会改变后端框架和大量 request/response 组织方式，第一阶段风险过高。
- 切换到 React：会重写前端主工程，不符合渐进式重构目标。
- 切换到 PostgreSQL：会改变持久化和部署基线，适合单独数据库迁移阶段评估。
- 引入 workspace 或更换包管理器：会扩大工具链变更面，不适合作为重构基线第一步。

## Validation

每个重构 PR 至少运行：

```bash
npm run lint
npm run typecheck
npm run openapi:check
npm run security:sca
npm test
npm run guard:legacy
```
