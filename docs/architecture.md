# ARCHITECTURE

## 1) 当前目标状态（单主链路）

- 开发环境主链路：`浏览器 -> Vite(src/) -> Express(backend/)`
- 生产环境主链路：`浏览器 -> 前端静态资源` + `浏览器 -> backend/ (/api/v1, /ws)`
- `deploy/legacy/worker.js`：历史备用部署方案，不是日常开发必需路径
- `wrangler.toml`：仅保留 Pages 构建配置
- `server/`：历史 Flask 迁移排障参考，不进入生产构建、部署、网关 upstream 或主链路开发

## 2) 最小架构图（开发）

```text
浏览器
  -> src/ (Vite Dev Server, :3000)
      -> /api/v1 -> backend/ (Express, :8787) -> 数据库
      -> /ws     -> backend/ (WebSocket, :8787)
      -> /api/v1/bin-files -> backend/ -> BIN 存储
```

## 3) 目录职责边界

- `src/`：前端页面、状态管理、API 调用入口（统一使用 `/api/v1` 与 `/ws`）
- `backend/`：正式后端服务，提供 REST + WebSocket + 数据持久化 + BIN 文件管理
- `server/`：旧 Flask 方案，仅作迁移排障参考，不新增业务主代码，不接入生产链路
- `deploy/legacy/worker.js`：Cloudflare Worker 归档入口，默认不启用

## 4) 代理与入口约束

- `vite.config.js`：开发代理分为主链路（`/api/v1`、`/ws`）和调试链路（第三方代理）
- `deploy/legacy/worker.js`：默认不承担开发或生产主链路职责

## 5) 本地运行一句话

先启动 `backend`（8787），再启动 `vite`（3000），浏览器只访问 `http://localhost:3000`，所有后端流量通过 Vite 代理进入 Express。
