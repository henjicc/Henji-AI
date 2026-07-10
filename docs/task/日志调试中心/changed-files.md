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
