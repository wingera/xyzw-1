# ADR 0002: Legacy Server Is Not Production

## Status

Accepted

## Context

仓库内存在 `server/` 历史 Flask 兼容服务。当前生产主链路已经迁移到 `backend/` Express 后端，`server/` 只保留为迁移排障参考。

Legacy Flask 仍包含历史兼容面和更高风险能力，不应重新进入生产镜像、压缩包、网关 upstream 或默认开发流程。

## Decision

- `backend/` 是唯一生产后端主线。
- `server/` 仅用于本地、短期、内部迁移排障参考。
- 禁止在 `server/` 中新增业务主代码。
- 禁止让生产构建、部署脚本、Docker 上下文、Nginx upstream 或 CI 产物依赖 `server/`。
- `npm run guard:legacy` 继续作为 legacy Flask 排除门禁。

## Consequences

- 生产入口保持单一，降低路由、鉴权、CORS、上传和 token 兼容面的风险。
- 迁移排障资料仍可保留，但不能成为新功能入口。
- 文档中若出现暗示 `server/` 可生产使用的表述，需要改为仅迁移排障参考。

## Alternatives considered

- 同时维护 Flask 与 Express 双主线：会造成安全策略、API 行为和部署入口分裂。
- 删除 `server/`：可能影响短期迁移排障，不作为第一阶段目标。
- 将 Flask 重新接入网关：会绕开当前安全基线，明确不采用。

## Validation

运行：

```bash
npm run guard:legacy
```

并确认生产构建、部署入口和共享部署文档不推荐启用 legacy Flask。
