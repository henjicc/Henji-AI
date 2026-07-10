# 日志调试中心 - 进度记录

## 1.1 主进程日志中枢与统一落盘

- 状态：已完成（自动化检查全通过；运行时行为需人工验证，见 `test-report.md`）
- 完成日期：2026-07-10

### 完成内容

1. 新建 `electron/main/services/logging/` 目录，替代原单文件 `electron/main/services/logging.ts`（已删除）：
   - `types.ts`：`MainLogEvent` / `LogEventBridgeDto` / 保留策略常量（1 天 + 256MB）。
   - `writer.ts`：`henji-YYYY-MM-DD.log` 的异步批量写入，内置写入队列串行化，避免并发交错。
   - `push.ts`：`pushLogEvents` 推送 `henji://log-event` 给所有未销毁窗口；`appendLogEvents` 作为统一写入口（先落盘再推送）。
   - `main-logger.ts`：`createMainLogger(domain)`，接口对齐渲染层 `createLogger`（message + meta），事件 `source` 固定为 `'backend'`。
   - `retention.ts`：`runLogRetention()`，先删过期文件（>1 天），再检查目录总大小，超限从最旧文件删起。
   - `index.ts`：统一导出。
2. `electron/main/ipc/logging.ts`：`logging:frontendEvents` 改为直接调用 `appendLogEvents`，写入时补 `source: 'frontend'`。
3. `electron/main/index.ts`：`app.whenReady()` 内新增 `void runLogRetention()`，应用启动时执行一次清理。
4. `electron/preload/index.ts` + `electron/preload/api.d.ts`：新增 `HenjiLoggingApi.onLogEvent`，白名单订阅 IPC 通道 `henji://log-event`。
5. `src/platform/contracts/logging.ts`、`src/platform/adapters/electron/logging.ts`、`src/commands/logging.ts`：补齐 `listenLogEvent` 封装（新增 `LogEventPushDto` 类型），渲染层暂无消费方，留给 2.1 接页面。
6. 试点接入：`electron/main/services/ai-runtime/runtime.ts` 的 `generate()` 接入 `createMainLogger('ai-runtime')`，记录 `ai_runtime.generate.start` / `ai_runtime.generate.result` / `ai_runtime.generate.failed` 三个事件，直接落盘不经过渲染层。

### 未完成 / 待验证

- 运行时行为（backend 事件真实落盘、frontend 事件仍正常落盘同一文件、渲染层实时收到推送、保留清理生效）未在真实 Electron 窗口中实际运行验证，已在 `test-report.md` 写清人工验证步骤，交给用户执行。
- `continuePolling()` 等其他 ai-runtime 入口未接入 `createMainLogger`（任务只要求挑一处试点，其余留给后续任务/日常开发按 3.2 规范逐步覆盖）。

### 下一任务

1.2 LLM请求响应完整捕获，可直接使用本任务提供的 `createMainLogger`，详见 `handoff.md`。
