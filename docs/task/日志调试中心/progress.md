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

## 1.2 LLM请求响应完整捕获

- 状态：已完成（自动化检查全通过；运行时行为需人工验证，见 `test-report.md`）
- 完成日期：2026-07-10

### 完成内容

1. `sanitizeJsonValue`/`isSensitiveKey` 脱敏截断逻辑从 `ai-runtime/trace.ts` 抽到新文件 `electron/main/services/logging/sanitize.ts`，经 `logging/index.ts` 统一导出；`trace.ts` 瘦身为纯 trace 构建函数。
2. `electron/main/services/llm/runtime.ts` 接入 `createMainLogger('llm-runtime')`：新增 `llm_runtime.chat_stream.request_json`（请求前）、`llm_runtime.chat_stream.response_json`（流结束后，含 output/reasoningOutput/耗时/字符数）、`llm_runtime.chat_stream.failed`（catch 分支）三类事件，一次性解决"成功响应完全没有记录"的问题。
3. `electron/main/services/ai-runtime/runtime.ts` 的 `generate()` 与 `continuePolling()` 都补上 `generation.runtime.request_json` / `generation.runtime.response_json` 直接落盘（`continuePolling()` 此前完全没有接入 `createMainLogger`，1.1 只试点了 `generate()`）。
4. 预览通道（`henji://runtime-request-preview` / `henji://llm-runtime-request-preview`）**保留**但切断落盘职责：`src/core/logging/logger.ts` 新增 `logPreviewOnly()`（只写内存 store + 控制台，不桥接落盘），`initLoggerConfig()` 里两个监听器与 `GenerationService.ts` 的 `recordRuntimeTrace()` 都改调用它，消除"渲染层转发再桥接"造成的同一事实重复落盘。
5. `src/commands/llmRuntime.ts` 删除对流内 `Error` 事件的重复日志记录（原 `chat_stream.failed`），前端只保留 IPC 调用失败视角的 `invoke_failed`，与后端权威的 `chat_stream.failed` 不再撞名重复。
6. `UnifiedLogViewer.tsx` 的 `EVENT_DISPLAY_MAP` 补 4 个新/漏收事件条目。

### 未完成 / 待验证

- 真实 LLM 成功对话、错误 API key 失败对话、AI 生成链路请求/响应、JSONL 去重与脱敏抽查均未实际触发验证，已在 `test-report.md` 写清步骤交给用户。

### 下一任务

1.3 完整捕获开关与脱敏策略统一，可直接复用本任务新增的 `sanitizeJsonValue`/`isSensitiveKey`/`logPreviewOnly`，详见 `handoff.md`。
