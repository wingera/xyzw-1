# Project Structure

本文档用于回答两个问题：
1. 每个目录负责什么。
2. 新人第一次接手应该从哪里下手。

## 新人接手顺序（建议）

1. 先看 [README.md](../README.md)：了解项目运行方式与命令入口。
2. 再看 [startup.md](./startup.md)：按全新机器流程完成本地启动。
3. 再看 [architecture.md](./architecture.md)：理解当前主链路（`Vite -> backend`）。
4. 最后按你的任务类型进入对应目录（前端在 `src/`，后端在 `backend/src/`）。

## 根目录角色说明

- `backend/`
  - 当前正式后端主线（Node.js + Express + WebSocket）。
  - 所有生产 API 主逻辑应优先落在这里。

- `server/`
  - 历史 Flask 兼容服务。
  - 用途：仅作为迁移排障参考。
  - 状态：不进入生产构建、部署、网关 upstream 或主链路开发。
  - 约束：不要在这里新增业务主代码。

- `source/`
  - 历史源码样本与逆向参考材料（例如大体量 JS 文件）。
  - 状态：不参与当前构建/发布流程。
  - 约束：不要在这里新增业务主代码。

- `test/`
  - 历史脚本测试目录（手动触发脚本）。
  - 状态：不是自动化测试主入口。
  - 说明：当前仓库自动化测试主入口是 `backend` 内的 `npm --prefix backend test`（Node test runner）。

- `src/`
  - 前端主工程目录（Vue + Vite）。

- `docs/`
  - 项目文档统一目录。

- `docs/archive/`
  - 历史或一次性迁移文档归档区。

## 标准目录约定

已统一为以下目录骨架：

- `backend/src/modules/`
  - 后端按业务域拆模块（推荐新功能优先放此处）。

- `backend/src/services/taskControlScheduler/`
  - 任务控制调度的局部 helper 目录。
  - 放 Cron 判定、日志脱敏、网络重试分类等调度专用纯工具；`taskControlSchedulerService.js` 继续保留为入口 facade。

- `src/router/modules/`
  - 前端路由按领域拆分。

- `src/stores/modules/`
  - 前端状态按领域拆分。

- `src/views/batch-daily-tasks/`
  - 批量日常任务页的局部页面块与排序 helper。
  - 用于承接页面壳、账号选择区、任务 modal body、分组管理、模板管理、梦境购买、月赛助威，以及设置 / helper / 定时任务列表 / 模板 / 旧功法赠送 / 批量设置 / 任务编辑等 modal 壳视图层拆分，避免主页面文件继续堆积。

- `src/components/cards/lineup/`
  - 阵容助手的局部展示组件与纯 helper。
  - 用于承接已保存阵容列表、操作条、英雄网格、应用进度面板、运行状态面板、鱼灵/鱼珠/装备显示 helper 等展示层拆分，避免 `Unlimitedlineup.vue` 回到巨型视图文件。

- `src/components/cards/pvp/`
  - PVP 卡片的局部展示组件与纯 formatter。
  - 用于承接切磋工具条、历史/记录列表、结果摘要、目标信息壳、排行壳、武将详情弹层与纯显示 helper 等展示层拆分，避免 `FightPvp.vue`、`ArenaPvp.vue` 继续堆积。

- `src/components/Club/info/`
  - 俱乐部信息页与成员展示的局部组件和纯 helper。
  - 用于承接摘要面板、成员列表壳、成员详情 modal、成员动作条、申请列表 modal、桃园切磋动作/进度/结果面板，以及职位/阵容/战力/说明文案 helper，避免 `PeachInfo.vue`、`ClubInfo.vue` 继续堆积。

- `src/components/Club/records/`
  - 俱乐部战绩页共用的工具条、badge 与纯 formatter。
  - 用于承接 `PeachBattleRecords`、`ClubBattleRecords`、`ClubMonthBattleRecords` 之间真正重复的展示层逻辑，例如工具条、summary / stats / Top 榜面板、单侧表格壳、头部 / 双列 layout、style3/style4 展示壳、rows 标准化与显示 helper，避免把查询与导出编排重新塞回页面里。

## 命名统一约定

- 项目名：`XYZW Web Helper`
- 根目录包名：`xyzw-web-helper`
- 后端包名：`xyzw-web-helper-backend`
- 文档命名：统一放在 `docs/`，使用小写 kebab-case（例如 `auth-flow.md`）。
- 历史脚本命名：使用语义化脚本名（例如 `test:legacy:*`）。

## 当前阶段边界

- 主链路：`src/ + backend/`
- 迁移排障参考：`server/`
- 参考材料：`source/`
- 历史脚本测试：`test/`

如果后续决定彻底下线兼容链路，可以按里程碑将 `server/`、`source/`、`test/` 再拆分到独立归档仓库。
