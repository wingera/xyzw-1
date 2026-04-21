# backend admin module

`backend/src/modules/admin/` 是后续管理端业务代码的目标目录。第一阶段只建立边界说明，不拆分 `backend/src/routes/admin.js`。

## 未来承接范围

- users：用户查询、状态变更、管理员权限、会话吊销。
- invite-codes：邀请码创建、查询、失效、审计记录。
- activation-codes：激活码生成、绑定、失效、查询。
- audit-logs：管理员审计日志查询和记录。
- task-control-logs：后端任务控制日志的管理端查询。

## 拆分约束

- 所有管理员接口继续要求 `adminRequired` 和 MFA 相关安全约束。
- 不改变公开 API 路径、权限语义、错误码或审计记录字段。
- 每次拆分保持 route 作为 request/response 层，业务规则下沉到模块 service。
- 继续使用现有 `transaction`、`recordAdminAudit`、`validateRequest` 等本地模式。
