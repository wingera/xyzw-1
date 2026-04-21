# backend modules

`backend/src/modules/` 是后端渐进式重构的目标模块目录，用于按业务域组织新功能和后续从 `routes/`、`services/`、`db/` 中拆出的稳定代码。

第一阶段只建立目录边界，不搬迁现有业务代码，不改变路由行为，不改变数据库 schema，不改变 WebSocket 协议。

## 边界规则

- `backend/` 仍是唯一生产后端主线，继续使用 Express + WebSocket + SQLite (`better-sqlite3`)。
- 新功能和后续拆分优先进入 `modules/<domain>/`，再由 `routes/` 接入 HTTP request/response。
- `routes/` 应逐步收敛为参数校验、鉴权、中间件组合和响应封装层。
- 模块内部可以继续使用现有 `services/`、`db/`、`lib/` 能力，拆分必须小步提交并配套测试。
- `server/` 是 legacy Flask 迁移排障参考，不得被 `modules/` 依赖或重新接入生产链路。

## 推荐业务域

- `auth/`: 认证、会话、MFA、密码重置、WeChat 登录、认证 schema 和 repository。
- `task-control/`: 后端调度、队列、Cron 窗口、重试分类、日志写入和任务适配器。
- `admin/`: 管理端 users、invite-codes、activation-codes、audit-logs、task-control-logs。
- `bin-files/`: BIN 文件授权、存储路径安全、下载审计和导入校验。
- `feedback/`: 工单、反馈处理和通知触发。
- `notifications/`: 用户通知、已读状态、清理策略和推送适配。
- `referrals/`: 推荐关系、结算记录和推荐配置。

## 验收门槛

每次从 legacy route/service 拆入 `modules/` 时，至少运行：

```bash
npm run lint
npm run typecheck
npm run openapi:check
npm run security:sca
npm test
npm run guard:legacy
```

涉及 UI 或安全主链路时，额外运行：

```bash
npm run e2e:security
```
