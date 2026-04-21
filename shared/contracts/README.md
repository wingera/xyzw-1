# shared contracts

`shared/contracts/` 是后续 API 契约和前后端共享类型的目标目录。

第一阶段只建立目录说明，不引入 package workspace，不改变构建方式，不移动现有 OpenAPI 产物路径。

## 未来承接范围

- OpenAPI 源定义或生成物的稳定入口。
- zod schema、请求/响应 DTO、错误码枚举。
- 前后端共享的纯类型和无运行时副作用常量。
- API client 生成物或薄封装。

## 边界规则

- 共享契约不得依赖 DOM、Vue、Pinia、Express、SQLite 或 Node-only 副作用。
- 公开 API 改动必须先更新契约、测试和兼容说明。
- 后续重构应先保证契约不变，再移动实现代码。
- 如需改变契约，必须在 PR 总结中明确列出影响面和回归测试。
