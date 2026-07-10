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

## 1.3 完整捕获开关与脱敏策略统一

- 状态：已完成（自动化检查全通过；运行时行为需人工验证，见 `test-report.md`）
- 完成日期：2026-07-10
- **第一阶段（日志数据层）全部完成**（1.1 + 1.2 + 1.3 均已交付），下一步进入第二阶段（日志窗口，任务 2.1）。

### 完成内容

1. 新增 `electron/main/services/logging/capture-config.ts`：内存态捕获模式配置，`LogCaptureMode = 'standard' | 'full'`，`getLogCaptureMode()`/`setLogCaptureMode()`，默认 `standard`，不落盘、应用重启回落默认值。
2. `electron/main/services/logging/sanitize.ts` 按捕获模式分档：
   - `sanitizeJsonValue` 内部每次调用读取当前捕获模式；`standard` 模式行为与改动前完全一致（长字符串/深度/base64 阈值不变）。
   - `full` 模式：跳过长字符串截断与深度截断（`MAX_DEPTH`），`data:image/*` 原文完整保留；`data:audio/*`/`data:video/*`/其他无法识别的 `data:` 类型、以及不带 `data:` 前缀但形似 base64 的长字符串，两种模式下都强制走"头尾摘要 + 长度标注"。
   - 脱敏（`isSensitiveKey`）判断先于模式分支执行，两种模式下都强制生效，不受捕获模式影响。
   - 新增单条事件体积保险丝：`MAIN_LOG_EVENT_MAX_BYTES = 2 * 1024 * 1024`（2MB），`applyEventSizeFuse(event)` 序列化超限时丢弃 `context`/`error` 并标注 `truncatedByLimit: true`。
3. `electron/main/services/logging/types.ts`：`MainLogEvent` 新增可选字段 `truncatedByLimit?: boolean`。
4. `electron/main/services/logging/push.ts`：`appendLogEvents` 落盘/推送前统一跑一遍 `applyEventSizeFuse`，覆盖前端桥接事件与主进程自身事件两条来源。
5. 新增 IPC `logging:setCaptureConfig`（`electron/main/ipc/logging.ts`），校验 `mode` 只能是 `'standard' | 'full'`，非法值直接拒绝（走 `registerIpcHandler` 的错误信封，不会崩主进程）。
6. preload 白名单新增 `HenjiLoggingApi.setCaptureConfig`（`electron/preload/api.d.ts` + `electron/preload/index.ts`），`src/platform/contracts/logging.ts`/`src/platform/adapters/electron/logging.ts`/`src/commands/logging.ts` 五层一次改齐，新增 `setLogCaptureMode()` 命令桥封装。
7. `src/stores/settingsStore.ts` 新增 `logCaptureMode` 状态（默认 `'standard'`）+ `setLogCaptureMode` action：本地更新状态的同时调用命令桥同步主进程；通过自定义 `partialize` 显式排除 `logCaptureMode`，使其**不随 zustand persist 落 localStorage**，应用重启回落 `standard`。
8. 开关 UI 落点：`src/components/TestModePanel.tsx` 的"测试选项"标签页，紧跟"参数流转追踪"之后新增一行，复用既有 `UiCheckbox` 模式（与 `skipRequest`/`logParams`/`enableDevTools` 同款交互），状态读写走 `useSettingsStore`，不新增任何原生控件。i18n key `testMode.options.logCaptureMode.{title,description}` 已补齐中英文。

### 验收标准逐项对照（自查，未做真实生成请求验证）

| 验收标准 | 状态 |
|---|---|
| 标准模式：截断行为与改动前一致 | 代码走查确认（`mode==='standard'` 分支与改动前逻辑等价），**待人工二次确认** |
| 完整捕获模式：长文本无截断，图片 `data:image/*` 原文保留，音频/视频仍摘要 | 代码走查确认，**待人工二次确认** |
| 两种模式下敏感字段均为 `***` | 代码走查确认（脱敏判断不受模式影响），**待人工二次确认** |
| 保险丝触发不崩溃且带 `truncatedByLimit` | 代码走查确认，**待人工二次确认**（需构造超大事件） |
| 切换开关无需重启即时生效 | 设计上成立（`getLogCaptureMode()` 每次读取内存变量，无缓存/无需订阅），**待人工二次确认** |
| 类型/静态检查通过 | 已通过，见 `test-report.md` |

### 未完成 / 待验证

- 真实触发超长 prompt/图片生成请求验证两种模式下的实际落盘内容、保险丝触发效果、开关热切换体感，均未实际操作，已在 `test-report.md` 写清步骤交给用户。
- `src/utils/testMode.ts` 的 `recordApiTrace()`/`api.trace` 通道未纳入本次统一开关（沿用 1.2 决策，保持独立 opt-in 调试通道）。

### 下一阶段（第二阶段-日志窗口，任务 2.1）

详见 `handoff.md`。

## 2.1 日志窗口骨架与查看器升级

- 状态：已完成（自动化检查全通过；交互行为需人工验证，见 `test-report.md`）
- 完成日期：2026-07-10

### 完成内容

1. **主进程窗口管理**：新增 `electron/main/windows/log-window.ts`，`openLogWindow()` 单例创建/聚焦已存在窗口，加载与主窗口同源 URL + `?view=logs`；`closeLogWindow()` 供主窗口 `closed` 事件联动关闭，避免主窗口关闭后应用因日志窗口存活而不退出。新增 IPC `logging:openWindow`、`logging:getCaptureConfig`（后者供日志窗口挂载时同步真实捕获模式）。
2. **快捷键**：`Ctrl+Shift+L` 完全落在渲染层实现（`src/hooks/useLogWindowShortcut.ts`），与既有 `useDevToolsShortcut`/F12 同款门控模式：开发环境始终注册，生产环境需测试模式已开启；主进程 IPC 不做打包态门控（渲染层决定是否调用，与 F12 DevTools 切换同一策略）。
3. **渲染层分流**：`src/main.tsx` 读取 `?view=logs` 查询参数，命中时渲染 `src/features/logs/LogsShell.tsx`（不挂载 `DragDropProvider`/`GlobalContextMenuProvider`），否则渲染原有 `App`。
4. **日志窗口实现**：新增 `src/features/logs/` 目录——
   - `LogsShell.tsx`：自定义无边框标题栏（复用通用 `getPlatform().window` per-sender-window 控制）+ `useApplyRuntimeTheme()` 跟随主题 + 渲染 `LogsPanel`。
   - `LogsPanel.tsx`：编排过滤状态、`useLogWindowStore`、列表/详情两栏布局。
   - `logStore.ts`：日志窗口专用数据源，订阅 `henji://log-event`（推送本身在 1.1 已实现广播到所有窗口，本任务未改）、容量上限 5000 条、暂停期间缓冲、清空。
   - `eventDisplay.ts`：从旧 `UnifiedLogViewer.tsx` 迁移的事件美化字典/domain 提示/关键词匹配，新增 `truncatedByLimit` 特殊展示分支。
   - `components/LogFilterToolbar.tsx`：来源/级别/domain/关键词过滤 + 暂停恢复 + 清空 + 完整捕获开关（从 `TestModePanel.tsx` 搬迁而来，挂载时主动拉取 `logging:getCaptureConfig` 纠正独立窗口的本地默认值）。
   - `components/LogEventList.tsx` / `LogEventRow.tsx` / `LogEventDetail.tsx`：列表增量渲染（初始 200 条 + 加载更早）、单行展示、详情面板（简单 JSON，`truncatedByLimit` 事件有专属提示；JSON 折叠树留给 2.2）。
5. **入口调整**：`TestModePanel.tsx` 删除 `UnifiedLogViewer` 挂载与"日志完整捕获"开关行，新增"打开日志窗口"按钮；`TestModeParamsDisplay.tsx` 排查确认全仓无挂载点（死代码），直接删除。
6. **旧查看器删除**：`src/components/debug/UnifiedLogViewer.tsx` 物理删除（重要记录 004）。
7. **预览通道清理**：`henji://runtime-request-preview` / `henji://llm-runtime-request-preview` 两条给旧查看器用的预览通道，及 `logPreviewOnly()`（`src/core/logging/logger.ts`）随本任务一起删除（1.2 决策已预告的先后关系）——五层结构（preload/platform/commands/`logger.ts`/主进程 emit 调用点）全部清理，`GenerationService.ts` 的 `recordRuntimeTrace()` 同步去掉对应调用，保留独立的 `recordApiTrace()` 通道不受影响。`ai-runtime/runtime.ts`/`llm/runtime.ts` 的 `generate()`/`continuePolling()`/`llmChatStream()` 相应去掉不再需要的 `webContents` 参数。
8. i18n：`testMode.options.logCaptureMode.*` 删除，新增 `testMode.logsWindow.*` 与顶层 `logsWindow.*`（中英文）。

### 验收标准逐项对照（自查，未做真实交互验证）

| 验收标准 | 状态 |
|---|---|
| 按钮/快捷键打开窗口、重复触发聚焦不重复创建 | 代码走查确认（单例 `logWindowInstance` + `focus()`/`restore()`），**待人工验证** |
| 主/日志窗口同时操作、实时同步 | 设计上成立（1.1 的 `pushLogEvents` 已广播全部窗口，本任务新增消费方），**待人工验证** |
| 打包态/非测试模式入口不可见 | 代码走查确认（渲染层门控与 `useDevToolsShortcut` 同款模式），**待人工验证**（含构建产物等效验证步骤） |
| 过滤/暂停/清空全部可用 | 代码走查确认，**待人工验证** |
| 数千条事件不卡顿 | 增量渲染（初始 200 条 + 加载更早）设计上缓解，非真正虚拟滚动，**待人工验证** |
| 旧查看器与相关选项已删除、无残留引用 | 已通过全仓 grep 确认，**测试面板其余功能不回退待人工二次确认** |
| lint/tsc/check:colors/原生控件检查通过 | 已通过，见 `test-report.md` |

### 未完成 / 待验证

- 全部交互类验收点（开窗口、快捷键、双窗口同步、过滤器、暂停恢复、性能）均未实际操作，已在 `test-report.md` 写清步骤（Q~Y）交给用户。
- 未执行 `npm run electron:build`/`electron:smoke`：仓库现有 `out/` 是旧构建产物，跑冒烟测试没有意义；本任务改动的主进程/preload 部分已用 `tsc -p tsconfig.electron.json --noEmit` + `eslint electron` 完整覆盖静态检查，交互行为验证与用户即将进行的 `electron:dev` 手动验证重合，不重复花时间跑一次 `electron:build`。
- JSON 折叠树、requestId 链路聚合视图、错误一键复制留给 2.2（详见 `handoff.md`）。
- 真正的虚拟滚动（如引入 `react-window`）本任务未做，采用"增量渲染 + 加载更多"的简化方案；如果用户实测数千条场景仍有明显卡顿，需要后续任务补虚拟滚动。

### 下一任务

2.2 请求链路视图与错误复制，可直接在本任务的 `logStore.ts`/`eventDisplay.ts`/`LogsPanel.tsx` 基础上扩展，详见 `handoff.md`。
