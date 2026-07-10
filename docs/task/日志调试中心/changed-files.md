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

## 1.3 完整捕获开关与脱敏策略统一

### 新增

- `electron/main/services/logging/capture-config.ts`：内存态日志捕获模式配置（`LogCaptureMode`/`getLogCaptureMode`/`setLogCaptureMode`，默认 `standard`，不落盘）。

### 修改

- `electron/main/services/logging/sanitize.ts`：`sanitizeJsonValue`/`sanitizeString` 按 `getLogCaptureMode()` 分档（`full` 模式跳过长字符串/深度截断，图片 data URI 原文保留；音频/视频与无法识别类型的裸 base64 两种模式下都强制摘要）；新增 `MAIN_LOG_EVENT_MAX_BYTES` 常量与 `applyEventSizeFuse()` 单条事件体积保险丝。
- `electron/main/services/logging/types.ts`：`MainLogEvent` 新增可选字段 `truncatedByLimit?: boolean`。
- `electron/main/services/logging/push.ts`：`appendLogEvents` 落盘/推送前统一调用 `applyEventSizeFuse`。
- `electron/main/services/logging/index.ts`：新增导出 `getLogCaptureMode`/`setLogCaptureMode`/`LogCaptureMode`/`MAIN_LOG_EVENT_MAX_BYTES`。
- `electron/main/ipc/logging.ts`：新增 IPC `logging:setCaptureConfig`（校验 `mode` 为 `'standard' | 'full'`）。
- `electron/preload/api.d.ts`：新增 `HenjiLogCaptureMode` 类型、`HenjiLoggingApi.setCaptureConfig`。
- `electron/preload/index.ts`：`loggingApi` 实现 `setCaptureConfig`。
- `src/platform/contracts/logging.ts`：新增 `LogCaptureMode` 类型、`LoggingPlatform.setCaptureConfig`。
- `src/platform/adapters/electron/logging.ts`：实现 `setCaptureConfig`。
- `src/commands/logging.ts`：新增 `setLogCaptureMode()` 命令桥封装，导出 `LogCaptureMode` 类型。
- `src/stores/settingsStore.ts`：新增 `logCaptureMode` 状态 + `setLogCaptureMode` action（同步调用命令桥）；`persist` 配置新增 `partialize`，显式排除 `logCaptureMode` 不落 localStorage。
- `src/components/TestModePanel.tsx`：新增日志完整捕获开关（`UiCheckbox`），置于"测试选项"标签页。
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`：新增 `testMode.options.logCaptureMode.{title,description}` 中英文文案。

## 2.1 日志窗口骨架与查看器升级

### 新增

- `electron/main/windows/log-window.ts`：日志窗口单例管理（`openLogWindow()` 打开/聚焦、`closeLogWindow()` 供主窗口关闭时联动）。
- `src/features/logs/LogsShell.tsx`：日志窗口壳（自定义无边框标题栏 + 跟随主题 + 渲染 `LogsPanel`）。
- `src/features/logs/LogsPanel.tsx`：页面编排（过滤状态、`useLogWindowStore` 接线、列表/详情布局）。
- `src/features/logs/logStore.ts`：日志窗口专用数据源（订阅 `henji://log-event`、容量上限 5000 条、暂停/恢复缓冲、清空）。
- `src/features/logs/eventDisplay.ts`：事件美化字典与 `DisplayLogEvent` 类型（自 `UnifiedLogViewer.tsx` 迁移并补充 `truncatedByLimit` 特殊展示）。
- `src/features/logs/components/LogFilterToolbar.tsx`：来源/级别/domain/关键词过滤 + 暂停恢复 + 清空 + 完整捕获开关（原挂在 `TestModePanel.tsx`，本任务搬到这里）。
- `src/features/logs/components/LogEventList.tsx`：日志列表，增量渲染（初始 200 条 + "加载更早"）。
- `src/features/logs/components/LogEventRow.tsx`：单条日志行。
- `src/features/logs/components/LogEventDetail.tsx`：详情面板（简单 JSON 展示，`truncatedByLimit` 事件有专属提示；JSON 折叠树是 2.2 范围）。
- `src/hooks/useLogWindowShortcut.ts`：渲染层 `Ctrl+Shift+L` 快捷键（开发环境始终注册；生产环境需测试模式开启）。

### 删除

- `src/components/debug/UnifiedLogViewer.tsx`：功能迁入 `src/features/logs/`（重要记录 004）。
- `src/components/TestModeParamsDisplay.tsx`：排查确认全仓库无任何挂载点（死代码，唯一用途是渲染已删除的 `UnifiedLogViewer`），直接删除而非改造。

### 修改

- `electron/main/window.ts`：主窗口 `closed` 事件里调用 `closeLogWindow()`，避免主窗口关闭后应用因日志窗口存活而不退出。
- `electron/main/ipc/logging.ts`：新增 `logging:openWindow`（调用 `openLogWindow()`）、`logging:getCaptureConfig`（读取当前捕获模式，供独立日志窗口挂载时同步真实状态）。
- `electron/main/services/ai-runtime/runtime.ts`：删除 `emitPreview`/`RuntimeRequestPreviewEvent`/`henji://runtime-request-preview` 预览通道；`generate()`/`continuePolling()` 去掉不再需要的 `webContents` 参数。
- `electron/main/ipc/ai-runtime.ts`：`ai:generate`/`ai:continuePolling` handler 不再传 `event.sender`。
- `electron/main/services/llm/runtime.ts`：删除 `henji://llm-runtime-request-preview` 预览通道发送；`llmChatStream()` 去掉不再需要的 `webContents` 参数。
- `electron/main/ipc/llm-runtime.ts`：`llm:chatStream` handler 调用 `llmChatStream` 不再传 `event.sender`。
- `electron/preload/api.d.ts`：删除 `HenjiRuntimeRequestPreviewPayload` 类型与 `HenjiLoggingApi.onRuntimeRequestPreview`/`onLlmRuntimeRequestPreview`；`HenjiLogEvent` 新增 `truncatedByLimit?: boolean`；`HenjiLoggingApi` 新增 `getCaptureConfig()`/`openLogWindow()`。
- `electron/preload/index.ts`：`loggingApi` 删除两个预览通道监听实现，新增 `getCaptureConfig`/`openLogWindow` 实现。
- `src/platform/contracts/logging.ts`：删除 `RuntimeRequestPreviewDto`/`LlmRuntimeRequestPreviewDto` 类型与对应 `LoggingPlatform` 方法；`LogEventPushDto` 新增 `truncatedByLimit?: boolean`；`LoggingPlatform` 新增 `getCaptureConfig()`/`openLogWindow()`。
- `src/platform/adapters/electron/logging.ts`：同步删除/新增上述方法实现。
- `src/commands/logging.ts`：删除 `listenRuntimeRequestPreview`/`listenLlmRuntimeRequestPreview` 及其 DTO 类型；新增 `getLogCaptureMode()`/`openLogWindow()` 命令桥封装。
- `src/core/logging/logger.ts`：删除 `logPreviewOnly()` 导出函数、两路预览通道监听器、`runtimePreviewUnlisten`/`llmRuntimePreviewUnlisten` 变量；`initLoggerConfig()` 的 `beforeunload` 处理简化为只 flush 桥接队列。
- `src/core/logging/index.ts`：删除 `logPreviewOnly` 导出。
- `src/core/services/GenerationService.ts`：`recordRuntimeTrace()` 删除 `logPreviewOnly(...)` 调用，保留 `recordApiTrace(...)`（独立的测试模式 opt-in 通道，未受影响）。
- `src/components/TestModePanel.tsx`：删除 `UnifiedLogViewer` 挂载与"统一日志查看器"区块；删除"日志完整捕获"开关（已搬到日志窗口工具栏）；新增"打开日志窗口"按钮（`UiButton`，调用 `openLogWindow()`）。
- `src/main.tsx`：新增 `?view=logs` 查询参数分流，命中时渲染 `LogsShell` 而非主界面（不挂载 `DragDropProvider`/`GlobalContextMenuProvider`）。
- `src/App.tsx`：挂载 `useLogWindowShortcut()`（与 `useDevToolsShortcut()` 同级，不随 Tab 切换卸载）。
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`：删除 `testMode.options.logCaptureMode.*`；新增 `testMode.logsWindow.*`（打开日志窗口按钮文案）与顶层 `logsWindow.*` 命名空间（日志窗口标题、工具栏、列表、详情面板文案）。
- `.gitignore`：第 52 行 `logs` 改为 `/logs`（锚定仓库根目录），修复该规则误伤新建 `src/features/logs/` 目录导致其被 Git 静默忽略的问题，决策见 `decisions.md`。

## 2.2 请求链路视图与错误复制

### 新增

- `src/features/logs/components/JsonTree.tsx`：轻量 JSON 折叠树，自实现（129 行），按层级展开/折叠 + 长字符串默认收起点击展开。
- `src/features/logs/components/RequestChainView.tsx`：请求链路时间线视图（`UiModal` 承载，纵向时间线 + 就地展开单条 JSON + 整链路复制入口）。
- `src/features/logs/copyFormats.ts`：复制格式化模块，导出 `eventToMarkdown`/`eventToJson`/`chainToMarkdown`/`chainToJson`/`copyTextToClipboard`。

### 修改

- `src/features/logs/logStore.ts`：新增导出 `selectEventsByRequestId(events, requestId)` 选择器（按 requestId 过滤 + 按 timestamp 升序排序，签名与 handoff.md 建议略有差异，见 `decisions.md`）。
- `src/features/logs/components/LogEventDetail.tsx`：`<pre>{JSON.stringify(...)}}` 替换为 `<JsonTree value={event} />`；新增复制 Markdown/JSON 按钮（带"已复制"临时反馈）；新增 `onViewChain` prop 与"查看完整链路"按钮（仅 `requestId` 存在时显示）。
- `src/features/logs/components/LogFilterToolbar.tsx`：新增 `errorOnly`/`onErrorOnlyChange` prop 与对应 `UiCheckbox`（只看错误开关）；新增 `onLookupRequestId` prop、本地 requestId 输入框（支持 Enter 提交）+ "查看完整链路"按钮。
- `src/features/logs/LogsPanel.tsx`：新增 `errorOnly`/`chainRequestId` 状态；`filteredEvents` 追加 errorOnly 过滤；新增 `chainEvents`（`useMemo` 包 `selectEventsByRequestId`，基于完整 `events` 不受当前过滤条件影响）；渲染 `RequestChainView` 弹层；`LogEventDetail`/`LogFilterToolbar` 接线新增 props。
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`：新增 `logsWindow.toolbar.errorOnly`/`chainLookupPlaceholder`、`logsWindow.detail.jsonTree.{expandString,collapseString}`、`logsWindow.chain.{title,viewButton,count,empty}`、`logsWindow.copy.{markdown,json,copied}`（中英文）。
