# 日志接入

> 读取时机：新增或改造涉及网络请求、文件读写、长耗时任务、导入导出、状态流转或用户可见失败的功能。
>
> 完整使用手册见 [docs/日志调试中心使用手册.md](../日志调试中心使用手册.md)。

## 核心前提

**日志系统不会自动推断新功能的业务事件。** 新功能不会凭空产生业务日志，必须在实际执行层判断并补充结构化日志。

## 唯一入口

- 渲染层/前端服务：`createLogger(domain)`
- Electron 主进程服务：`createMainLogger(domain)`

只要通过这两个入口记录，事件会自动进入主进程 JSONL、日志窗口（实时/历史）和 `npm run logs:query`。

**禁止**为新功能另建日志文件、查看器、IPC 或查询通道；禁止要求 UI 逐案适配。

## 覆盖要求

- 关键链路最少覆盖 `start`、`completed`、`failed`
- 高频进度用 `debug` / `trace`
- 关联 AI/生成任务时必须带稳定的 `requestId`，按需带 `taskId`、`modelId`、`providerId`

## 命名

- **domain** 分层前缀：前端按代码归属（`features.*`、`services.*`、`commands.*`）；新主进程服务用 `main.<服务>`。存量 domain 不批量重命名。
- **event** 用 `模块.动作.阶段`，如 `project_package.export.completed`

## 脱敏（不可放宽）

日志中不得包含 API key、token、cookie、授权头、密码等敏感信息。完整捕获只放开截断，**不放开脱敏**。

## 查询

```bash
npm run logs:query -- --chain <runId>
```

## 改动后

至少执行相应静态检查；涉及真实窗口、文件落盘或主进程事件可见性时，写清用户手动验证步骤（见 [docs/rules/testing.md](../../docs/rules/testing.md)）。
