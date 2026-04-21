# backend auth module

`backend/src/modules/auth/` 是后续认证域代码的目标目录。第一阶段只建立边界说明，不搬迁现有 `backend/src/routes/auth.js` 行为。

## 未来承接范围

- auth route 中的纯 helper、request schema、response shape 适配。
- auth service：登录、刷新 token、登出、注销全部会话、当前用户查询。
- session 与 refresh token 生命周期。
- MFA 初始化、校验、恢复、管理员强制 MFA 规则。
- password reset 申请、短时验证码、重置确认。
- WeChat login 相关的认证编排和输入校验。
- auth repository：用户凭证、session、token version、reset code、MFA 状态读写。

## 拆分约束

- 不改变公开 API 路径、响应结构、错误码和 cookie/CSRF 行为。
- 先抽纯 helper 和 schema，再抽 service，最后抽 repository。
- 每一步必须有现有测试或新增聚焦测试覆盖。
- 保留 CSP、CSRF、MFA、CORS、生产配置校验和 audit 相关安全能力。
