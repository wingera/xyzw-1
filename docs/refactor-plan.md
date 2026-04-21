# XYZW Web Helper 渐进式重构计划

本计划用于建立重构版本的第一阶段基线。目标是让后续重构可测试、可回滚、可审查，而不是推倒重写。

## 重构目标

- 保留 Express/Vue/SQLite/npm 主链路：
  - 前端继续使用 `src/`，Vue 3 + Vite。
  - 后端继续使用 `backend/`，Express + WebSocket + SQLite (`better-sqlite3`)。
  - 包管理器继续使用 npm 和现有 lockfile。
- 保留企业安全加固能力，不回退 CSP、CSRF、MFA、CORS、生产配置校验、依赖治理、OpenAPI 校验和 legacy guard。
- 逐步把巨型 route、service、view 拆到业务域模块，减少单文件承担过多职责。
- 优先建立测试和 API 契约，再做大规模搬迁。
- 每个 PR 尽量小、可回滚、可审查，避免改变公开 API 行为。

## 当前边界

- `src/` 是前端主工程，负责 Vue 页面、路由、状态管理和前端 API 适配。
- `backend/` 是唯一生产后端主线，负责 REST、WebSocket、SQLite 持久化、任务调度和 BIN 文件服务。
- `server/` 是 legacy Flask 迁移排障参考，不进入生产构建、部署、网关 upstream 或主链路开发。
- `source/` 是历史源码样本/逆向参考材料，不参与构建发布，不新增业务主代码。
- `shared/contracts/` 是未来契约目录，第一阶段不启用 workspace 或新构建链路。

## 推荐目标结构

后端模块：

```text
backend/src/modules/auth/
backend/src/modules/task-control/
backend/src/modules/admin/
backend/src/modules/bin-files/
backend/src/modules/feedback/
backend/src/modules/notifications/
backend/src/modules/referrals/
```

前端功能域：

```text
src/features/auth/
src/features/task-control/
src/features/batch-daily-tasks/
src/features/admin/
```

共享契约：

```text
shared/contracts/
```

## 高优先级重构对象

- `backend/src/routes/auth.js`: 认证路由体量过大，应先抽纯 helper/schema，再抽 service。
- `backend/src/routes/admin.js`: 管理端资源混在同一路由文件，应按资源逐步拆分。
- `backend/src/services/taskControlSchedulerService.js`: 调度、队列、Cron 窗口、重试、日志和任务适配职责集中。
- `backend/src/db/database.js`: schema、migration、repository 职责集中。
- `src/views/BatchDailyTasks.vue`: 页面、任务编排、modal、设置和执行状态仍偏重。
- `src/views/TaskControl.vue`: 后续应解除对隐藏 `BatchDailyTasks.vue` 运行能力的直接依赖。

## 推荐 PR 顺序

1. PR 1：重构基线文档、ADR、验收命令，不改业务。
2. PR 2：API 契约与 schema 目录整理，不改公开接口。
3. PR 3：拆 auth helper，不改变路由行为。
4. PR 4：拆 auth service，让 route 只负责 request/response。
5. PR 5：拆 `taskControlSchedulerService`，抽 queue、cron-window、retry-policy、log-writer、task-adapters。
6. PR 6：抽前端 task runner，解除 `TaskControl.vue` 对隐藏 `BatchDailyTasks.vue` 的直接运行依赖。
7. PR 7：`BatchDailyTasks.vue` 页面瘦身，抽 composables 和子组件。
8. PR 8：`database.js` 拆 schema/migration/repository。
9. PR 9：admin 路由按资源拆分。
10. PR 10：补充 E2E、安全回归和重构验收文档。

## 每个 PR 的验收标准

每个重构 PR 至少运行：

```bash
npm run lint
npm run typecheck
npm run openapi:check
npm run security:sca
npm test
npm run guard:legacy
```

如涉及 UI 或安全链路，额外运行：

```bash
npm run e2e:security
```

如果现有检查失败，不得删除或绕过检查。PR 总结必须记录失败命令、失败日志摘要、可能原因和建议修复路径。

## 第一阶段不做

- 不引入 NestJS、React、PostgreSQL、pnpm、yarn 或 monorepo workspace。
- 不把 `server/` 或 `source/` 接入生产主链路。
- 不移动大段业务代码。
- 不修改公开 API 行为、数据库字段含义、权限逻辑或 WebSocket 协议。
- 不削弱已有安全门禁和 legacy guard。
