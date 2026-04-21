# Refactor Test Matrix

本矩阵用于后续重构 PR 选择最小但足够的回归范围。每个 PR 默认先运行基础门禁；触碰对应领域时补充该领域测试和手动验收。

基础门禁：

```bash
npm run lint
npm run typecheck
npm run openapi:check
npm run security:sca
npm test
npm run guard:legacy
```

涉及 UI 或安全链路时额外运行：

```bash
npm run e2e:security
```

## Auth

| 场景 | 验收重点 |
| --- | --- |
| login | 成功登录、失败密码、cookie/CSRF 行为、错误码不漂移 |
| refresh token | refresh 成功、过期/撤销 refresh token、token version 变化 |
| logout | 当前会话撤销、cookie 清理、重复 logout 行为稳定 |
| CSRF | CSRF token 获取、缺失/错误 token 被拒绝、安全错误结构稳定 |
| MFA | 管理员 MFA 要求、TOTP 初始化/校验、未启用 MFA 的管理员限制 |
| password reset | 申请、短时验证码、重置确认、过期/重复使用失败 |
| WeChat login if applicable | 输入校验、绑定/登录流程、失败响应不泄露敏感信息 |
| token version invalidation | 事故响应和 revoke sessions 后旧 token 失效 |

## Admin

| 场景 | 验收重点 |
| --- | --- |
| user management | 用户查询、状态变更、管理员权限变更、会话吊销 |
| invite code | 创建、查询、失效、使用状态和审计记录 |
| activation code | 生成、绑定、查询、失效、金额/时长字段不漂移 |
| audit logs | 关键管理操作写入 audit log，查询过滤稳定 |
| sensitive admin route access | 非管理员、未 MFA 管理员、过期登录态均被拒绝 |

## Task Control

| 场景 | 验收重点 |
| --- | --- |
| scheduler start/stop | 启停幂等、状态持久化、服务重启恢复 |
| cron window | Cron 触发、禁跑窗口、延后补跑 |
| queue behavior | 全局串行、多账号排队、排队提示 |
| retry classification | 可重试/不可重试错误分类、重试次数、失败落库 |
| daemon security | sandbox、BASE_URL、生产环境限制 |
| task logs | 后端 `[backend]` 日志写入、脱敏、管理员查询口径 |

## BIN/token import

| 场景 | 验收重点 |
| --- | --- |
| import validation | BIN/token 输入校验、非法格式拒绝、错误信息稳定 |
| proxy host allowlist | trusted import host allowlist、生产 fail-closed、loopback 限制 |
| file access authorization | 用户隔离、管理员访问边界、下载 ticket 权限 |
| storage path safety | 路径穿越防护、存储目录限制、审计记录 |

## Frontend

| 场景 | 验收重点 |
| --- | --- |
| auth guard | 未登录跳转、刷新后登录态恢复、401/403 处理 |
| admin route guard | 非管理员不可进入管理页，管理员菜单显示稳定 |
| BatchDailyTasks execution | 批量任务执行、模板/设置读取、日志和错误提示 |
| TaskControl quick task execution | 快捷任务触发、状态刷新、与批量任务 runner 的边界 |
| API error handling | 标准错误结构展示、网络错误、刷新 token 失败 |
| WebSocket connection and auth | `/ws` 连接、认证态变化、断线重连和事件处理 |

## Security/Supply chain

| 场景 | 验收重点 |
| --- | --- |
| CSP | 默认策略不放宽，高风险 runtime allowlist 生效 |
| production config | JWT/AES/CSRF/pepper/CORS/origin 配置 fail-closed |
| lockfile consistency | 只保留 npm lockfile，禁止 pnpm/yarn lockfile 漂移 |
| no floating deps | 生产依赖版本固定，无 `^`、`~` 或范围漂移 |
| license check | 生产依赖许可证符合 allowlist，例外显式治理 |
| npm audit | root/backend 生产依赖 high 级别漏洞门禁 |
| legacy guard | Flask legacy 不进入启动入口、代理配置、Docker 上下文或产物 |
