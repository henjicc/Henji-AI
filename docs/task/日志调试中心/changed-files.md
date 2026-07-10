# 日志调试中心 - 变更文件清单

## 1.1 主进程日志中枢与统一落盘

### 新增

- `electron/main/services/logging/types.ts`
- `electron/main/services/logging/writer.ts`
- `electron/main/services/logging/push.ts`
- `electron/main/services/logging/main-logger.ts`
- `electron/main/services/logging/retention.ts`
- `electron/main/services/logging/index.ts`

### 删除

- `electron/main/services/logging.ts`（内容迁入 `electron/main/services/logging/` 目录，决策见 `decisions.md`）

### 修改

- `electron/main/ipc/logging.ts`：`logging:frontendEvents` 改为调用统一写入口 `appendLogEvents`，写入时补 `source: 'frontend'`。
- `electron/main/index.ts`：`app.whenReady()` 内新增 `void runLogRetention()`。
- `electron/main/services/ai-runtime/runtime.ts`：`generate()` 试点接入 `createMainLogger('ai-runtime')`，新增 `ai_runtime.generate.start` / `ai_runtime.generate.result` / `ai_runtime.generate.failed` 三个事件。
- `electron/preload/api.d.ts`：新增 `HenjiLogEvent` 类型、`HenjiLoggingApi.onLogEvent`。
- `electron/preload/index.ts`：`loggingApi` 实现 `onLogEvent`，订阅 IPC 通道 `henji://log-event`。
- `src/platform/contracts/logging.ts`：新增 `LogEventPushDto` 类型、`LoggingPlatform.listenLogEvent`。
- `src/platform/adapters/electron/logging.ts`：实现 `listenLogEvent`。
- `src/commands/logging.ts`：新增 `listenLogEvent()` 封装（渲染层暂无消费方，留给 2.1）。

## 验收反馈修复（同日）

- `electron/main/services/logging/types.ts`：新增导出常量 `MAIN_LOG_FILE_PREFIX = 'henji-'`，供 `writer.ts`/`retention.ts` 共用，避免两处各写一份前缀字符串。
- `electron/main/services/logging/writer.ts`：`getLogFilePath()` 拼文件名改为使用 `types.ts` 的 `MAIN_LOG_FILE_PREFIX`（原来是本文件内部私有常量）。
- `electron/main/services/logging/retention.ts`：`listLogFiles()` 的文件名匹配从 `entry.endsWith('.log')` 收紧为 `entry.startsWith(MAIN_LOG_FILE_PREFIX) && entry.endsWith('.log')`，修复"会把旧 `frontend-*.log` 也纳入清理范围"的问题，JSDoc 同步更新说明只处理 `henji-*.log`。
- `electron/main/services/logging/index.ts`：`export` 列表新增 `MAIN_LOG_FILE_PREFIX`。

## 1.2 LLM请求响应完整捕获

### 新增

- `electron/main/services/logging/sanitize.ts`：从 `ai-runtime/trace.ts` 抽出的共用脱敏/截断逻辑（`sanitizeJsonValue`/`isSensitiveKey`）。

### 修改

- `electron/main/services/logging/index.ts`：新增导出 `sanitizeJsonValue`、`isSensitiveKey`。
- `electron/main/services/ai-runtime/trace.ts`：删除内部私有的 sanitize 实现，改为 `import { sanitizeJsonValue } from '../logging'`；文件从 124 行瘦身到 43 行。
- `electron/main/services/ai-runtime/runtime.ts`：`generate()` 新增 `generation.runtime.request_json`（调用前）/`generation.runtime.response_json`（trace 构建后）两个直接落盘事件；`continuePolling()` 首次接入 `createMainLogger`，同样新增这两个事件。
- `electron/main/services/llm/runtime.ts`：接入 `createMainLogger('llm-runtime')`，新增 `llm_runtime.chat_stream.request_json`/`response_json`/`failed` 三类直接落盘事件。
- `src/core/logging/logger.ts`：新增导出函数 `logPreviewOnly()`（写内存 store + 控制台，不桥接落盘）；`initLoggerConfig()` 里两个预览监听器（`henji://runtime-request-preview` / `henji://llm-runtime-request-preview`）改调用它，不再调用 `createLogger(...).info(...)`。
- `src/core/logging/index.ts`：新增导出 `logPreviewOnly`。
- `src/core/services/GenerationService.ts`：`recordRuntimeTrace()` 记录 `generation.runtime.response_json` 的调用从 `logger.info(...)` 改为 `logPreviewOnly(...)`，避免与主进程新增的同名事件重复落盘。
- `src/commands/llmRuntime.ts`：删除对流内 `Error` 事件的前端日志记录（原 `llm_runtime.chat_stream.failed`），只保留 IPC 调用失败视角的 `llm_runtime.chat_stream.invoke_failed`。
- `src/components/debug/UnifiedLogViewer.tsx`：`EVENT_DISPLAY_MAP` 新增 `generation.runtime.request_json`、`generation.runtime.response_json`、`llm_runtime.chat_stream.response_json`、`ai_runtime.generate.failed` 四个展示条目。

### 未改动但相关（决策见 `decisions.md`）

- `src/utils/testMode.ts` 的 `recordApiTrace()`/`api.trace`：保持原样，是独立于本次改造的测试模式 opt-in 调试通道。
- `electron/preload/index.ts`、`electron/preload/api.d.ts`、`src/platform/contracts/logging.ts`、`src/platform/adapters/electron/logging.ts`、`src/commands/logging.ts`：预览通道相关五层结构均保留不动（决策：不删除预览通道，只切断其落盘职责）。
