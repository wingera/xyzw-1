# 依赖漏洞与供应链治理（M3）

最后更新：2026-03-19

## 目标

- 将第三方依赖风险纳入发布门禁，形成“检测 -> 评估 -> 修复 -> 复测”闭环。
- 降低可远程利用漏洞对认证、RCE、会话链路的影响面。
- 将锁文件与许可证策略前置到 CI，避免依赖漂移与合规失控。

## CI 门禁

仓库已新增 GitHub Actions 工作流：

- `.github/workflows/security-sca.yml`

工作流执行项：

1. `npm ci`（根目录）
2. `npm --prefix backend ci`
3. `npm run security:sca`

分支保护必须要求 `CI`、`Security SCA`、`CodeQL`、`Dependency Review` 全部通过。

`security:sca` 包含：

- `security:lockfiles`
  - 必须存在 `package-lock.json` 与 `backend/package-lock.json`
  - 禁止 `yarn.lock` / `pnpm-lock.yaml`
  - 锁文件版本需满足 `lockfileVersion >= 2`
- `security:licenses`
  - 对前端与 backend 生产依赖做许可证 allowlist 校验
  - allowlist 文件：`scripts/security/allowed-licenses.json`
  - package-level 例外文件：`scripts/security/license-exceptions.json`
- `security:audit`
  - `npm audit --omit=dev --audit-level=high`
  - `npm --prefix backend audit --omit=dev --audit-level=high`

## 漏洞分级与修复 SLA

- P0
  - 条件：可远程利用，或影响认证链路、会话安全、RCE。
  - 时限：24-72 小时内完成修复并上线。
- P1
  - 条件：高危漏洞，但暂未直接形成关键路径可利用。
  - 时限：1-2 周内完成修复。
- P2
  - 条件：中低危或仅在特定条件触发。
  - 时限：按迭代计划处理，最长不超过 30 天。

## 标准处置流程

1. 检测
   - 触发 CI 的 SCA workflow。
   - 本地可复现：`npm run security:sca`。
2. 评估
   - 确认影响范围：前端、backend、是否进入认证/RCE/下载/WS 关键路径。
   - 判定分级（P0/P1/P2）与修复时限。
3. 修复
   - 优先升级到无漏洞版本。
   - 若无安全版本，采用临时缓解（禁用入口、版本锁定、网关拦截）并记录风险。
4. 复测
   - 依赖变更后执行：`npm test` 与 `npm --prefix backend test`。
   - 关键安全冒烟：登录、下载、WebSocket 连接与鉴权。
5. 归档
   - 在 PR 或变更记录中写明：漏洞编号、分级、修复版本、测试结果、上线日期。

## 新增依赖安全评估：otplib

评估对象：`backend/package.json` 中 `otplib@^13.3.0`（MFA TOTP 依赖）

### 基础信息（基于 npm registry）

采集日期：2026-03-19

- 包名：`otplib`
- 版本：`13.3.0`
- 最近发布时间：`2026-02-12T14:34:51.381Z`
- 许可证：`MIT`
- 仓库：`https://github.com/yeojz/otplib`
- 维护者：`geraldyeo`

### 维护活跃度与替代方案对比

- `otplib`：近一个月仍有发布，维护活跃度满足当前需求。
- 对比 `speakeasy`：最新发布时间 `2022-06-26T22:41:15.138Z`，更新频率明显偏低。
- 对比 `otpauth`：最新发布时间 `2026-02-04T18:19:52.947Z`，可作为备选。

结论：当前继续使用 `otplib`，保留 `otpauth` 作为候选替代。

## 许可证例外：@resvg/resvg-js

评估对象：`backend/package.json` 中 `@resvg/resvg-js@2.6.2`

用途：

- backend 图片导出服务使用 `@resvg/resvg-js` 将 SVG 渲染为 PNG。
- 当前使用点包括 battle report 与 club member 图片导出服务。

许可证处理：

- `@resvg/resvg-js@2.6.2` 及其同版本可选 native platform packages 使用 `MPL-2.0`。
- 项目不把 `MPL-2.0` 加入全局 allowlist。
- 仅在 `scripts/security/license-exceptions.json` 中为 `@resvg/resvg-js` 2.6.2 系列添加 package-level exception。
- 后续升级或替换该依赖时，必须重新评估许可证与发布制品影响。

### 风险控制要求

- 升级策略：锁定在次版本范围内，优先跟进安全补丁。
- 变更触发：MFA 相关依赖升级必须跑后端全量测试与登录链路冒烟。
- 回滚预案：保留上一稳定 lockfile，以便快速回滚。

## 可选加固（后续）

- 将 secrets scanning 一并纳入 PR 门禁。
- 引入 SBOM 产物（如 CycloneDX），发布时归档。
- 对 P0 漏洞启用自动通知与升级工单模板。
