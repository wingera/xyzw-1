# backend task-control module

`backend/src/modules/task-control/` 是后续任务控制后端调度域的目标目录。第一阶段只建立边界说明，不拆分 `backend/src/services/taskControlSchedulerService.js`。

## 未来承接范围

- scheduler facade：保留外部启动/停止/状态查询入口。
- queue：全局串行队列、多账号排队、排队日志。
- cron-window：Cron 解析、禁跑窗口、延后补跑。
- retry-policy：错误分类、重试次数、可恢复/不可恢复判断。
- log-writer：后端任务日志写入、脱敏、清理口径。
- task-adapters：daily、hangup、bottle、tower、study、legacy、arena、club-store、claim-car、send-car 等任务适配。

## 拆分约束

- 不改变现有任务执行时机、禁跑窗口、日志口径或管理员查询接口。
- 优先抽纯函数和无副作用策略，再抽队列与 adapter。
- 调度行为必须用聚焦测试锁定后再移动实现。
- 不新增与 `server/` 或 `source/` 的运行时依赖。
