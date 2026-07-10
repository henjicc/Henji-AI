# 日志调试中心 - 交接说明（写给下一个执行者）

面向任务：2.1 日志窗口骨架搭建（第二阶段-日志窗口，第一阶段-日志数据层已全部完成）

## 1.3 留下了什么（2.1 最需要看这部分）

### 捕获模式开关现在放在哪

- UI：`src/components/TestModePanel.tsx`"测试选项"标签页，"参数流转追踪"行下面新增了一行"日志完整捕获"（`UiCheckbox`），状态来自 `useSettingsStore((s) => s.logCaptureMode)`。
- **2.1 需要做的事**：任务文件 1.3 的实施方案第 5 条已经写明"2.1 日志窗口就绪后移到窗口工具栏"——把这个开关从 `TestModePanel.tsx` 搬到新的独立日志窗口工具栏，UI 交互（`UiCheckbox`/`UiButton` 均可）与状态读写方式（`useSettingsStore` 的 `logCaptureMode`/`setLogCaptureMode`）不需要改，只是换个挂载位置。等这个开关搬走后，`TestModePanel.tsx` 里对应的那一行连同 i18n key（`testMode.options.logCaptureMode.*`）应该跟着删掉，不要留一份重复 UI。

### 状态与同步链路（不用改，直接复用）

- 状态源：`src/stores/settingsStore.ts` 的 `logCaptureMode: 'standard' | 'full'`（默认 `'standard'`），**有意不持久化**——`persist` 配置加了自定义 `partialize` 显式排除这个字段，应用重启会回落 `standard`，不会因为用户忘记关闭而长期处于"完整捕获"状态。
- 同步链路（五层都已打通，2.1 不需要重新接）：`settingsStore.setLogCaptureMode(mode)` → `src/commands/logging.ts` 的 `setLogCaptureMode(mode)` → `src/platform/contracts/logging.ts`/`src/platform/adapters/electron/logging.ts` 的 `LoggingPlatform.setCaptureConfig` → preload `window.henjiNative.logging.setCaptureConfig(mode)` → IPC 通道 `logging:setCaptureConfig`（`electron/main/ipc/logging.ts`，payload `{ mode: 'standard' | 'full' }`，非法值直接拒绝不会崩主进程）→ 主进程 `electron/main/services/logging/capture-config.ts` 的 `setLogCaptureMode(mode)`，写入模块级内存变量。
- **只有 `setCaptureConfig`，没有 `getCaptureConfig`**：任务文件只要求一个 IPC 通道，所以主进程当前状态无法从渲染层反查。已知边界情况：如果渲染层在不重启应用的情况下发生"整页刷新"（不是 Vite HMR 的模块热替换，而是真正的 `location.reload()`/`Ctrl+R`），`settingsStore` 会重新初始化为默认值 `standard`，但主进程内存里的值可能还停留在用户上次设置的 `full`，两边会短暂不一致，直到用户再次手动切换开关。如果 2.1 要做得更严谨，可以考虑补一个 `logging:getCaptureConfig` IPC 让渲染层挂载时同步读取，但这不是 1.3 范围内做的事，只是留意这个已知边界。

### `sanitizeJsonValue` 新签名（其实没变签名，行为变了）

- 位置不变：`electron/main/services/logging/sanitize.ts`，经 `logging/index.ts` 统一导出。
- **签名没变**：仍然是 `sanitizeJsonValue(value: JsonValue, depth = 0): JsonValue`，调用方（`ai-runtime/trace.ts`、`ai-runtime/runtime.ts`、`llm/runtime.ts`）零改动。函数内部现在会调用 `getLogCaptureMode()`（来自同目录 `capture-config.ts`）读取当前捕获模式，按模式分档处理，不需要调用方传参。
- 行为分档（`standard` 是默认值，行为与 1.2 完全一致）：
  - 脱敏（`isSensitiveKey`，命中 `api_key`/`apikey`/`authorization`/`token`/`secret`/`password`）在**任何模式下都强制生效**，不受这次改动影响，这条依然是最高优先级、不可协商的约束。
  - `standard` 模式：长字符串（>1200+240 字符）、深度（>12 层）、base64/图片/音频/视频 data URI 全部按固定阈值截断，与 1.2 行为完全一致。
  - `full` 模式：跳过长字符串截断与深度截断；`data:image/*` 前缀的字符串原文完整保留；`data:audio/*`/`data:video/*`/其他无法识别的 `data:` 类型、以及不带 `data:` 前缀但形似 base64（≥512 字符）的长字符串，**两种模式下都强制走"头尾摘要 + 长度标注"**，不受 `full` 模式影响。

### 单条事件保险丝的行为

- 常量 `MAIN_LOG_EVENT_MAX_BYTES = 2 * 1024 * 1024`（2MB），定义在 `sanitize.ts`，经 `logging/index.ts` 导出。
- 函数 `applyEventSizeFuse(event: MainLogEvent): MainLogEvent`：对整条事件 `JSON.stringify` 后按字节数（`Buffer.byteLength(..., 'utf8')`）判断，超过 2MB 时把 `context` 替换成 `{ truncatedByLimit: true, originalBytes: N }`、把 `error` 清空，并在事件顶层加 `truncatedByLimit: true`，其余字段（`timestamp`/`level`/`domain`/`event`/`message`/`requestId` 等）保持不动。
- 调用点：`electron/main/services/logging/push.ts` 的 `appendLogEvents()`——这是前端桥接事件与主进程自身事件的唯一汇合点，`.map(applyEventSizeFuse)` 一次调用同时覆盖两条来源，写盘（`writeLogEventsToFile`）和推送渲染层（`pushLogEvents`）拿到的都是保险丝处理后的版本。
- **2.1 渲染日志窗口时要处理 `truncatedByLimit: true` 的展示**：这类事件的 `context` 字段不再是原始业务数据，而是 `{ truncatedByLimit: true, originalBytes: N }` 这种固定结构，UI 上应该给出明显提示（比如"该事件因体积超限已被截断，原始大小 N 字节"），不要按正常 `context` 的渲染逻辑去解析它。

### 1.3 没有动、2.1 可能要关心的事

- `src/utils/testMode.ts` 的 `recordApiTrace()`/`api.trace` 通道依然独立于统一开关之外（1.2、1.3 都做出了同样的决策：保持独立），2.1 如果要做"日志窗口只看统一事件流"，需要自己决定要不要展示这条 opt-in 通道的事件。
- 预览通道（`henji://runtime-request-preview` / `henji://llm-runtime-request-preview`）与 `logPreviewOnly()` 仍然保留（见下方 1.2 遗留说明），2.1 把 `UnifiedLogViewer`/`TestModePanel` 按计划删除后，这两条通道和 `logPreviewOnly` 的调用点才应该一起清理——1.3 同样没有动它们。

## 1.2 留下了什么

LLM 与 AI 生成两条主链路现在都由**主进程直接落盘**请求/响应/失败事件，不再依赖"渲染层转发再桥接"。

### 事件一览（都在 `henji-YYYY-MM-DD.log`，`source: 'backend'`）

| domain | event | 触发点 | 内容 |
|---|---|---|---|
| `llm-runtime` | `llm_runtime.chat_stream.request_json` | 发起 HTTP 请求前 | `context.requestBody`（sanitize 后的 OpenAI 兼容 payload） |
| `llm-runtime` | `llm_runtime.chat_stream.response_json` | SSE 流结束后 | `context.output`/`context.reasoningOutput`（sanitize 后）+ `elapsedMs`/`inputChars`/`outputChars` |
| `llm-runtime` | `llm_runtime.chat_stream.failed` | catch 分支 | `error`（结构化 name/message/stack）+ `context.normalizedMessage` |
| `ai-runtime` | `generation.runtime.request_json` | `generate()`/`continuePolling()` 调用 provider 前 | `context.requestBody`（sanitize 后） |
| `ai-runtime` | `generation.runtime.response_json` | trace 构建后 | `context.responseBody`（复用 `buildGenerateTrace`/`buildContinuePollingTrace` 里已经 sanitize 过的 `trace.responseBody`，不重复 sanitize） |
| `ai-runtime` | `ai_runtime.generate.failed` | `generate()` catch 分支（1.1 已有） | — |

前端侧仍保留、但语义收窄的事件：

- `commands.llmRuntime` 的 `llm_runtime.chat_stream.invoke_failed`：只在 IPC 调用本身 reject 时记录，代表"前端视角确认调用失败"，不再与后端 `chat_stream.failed` 撞名重复。

### `sanitizeJsonValue` / `isSensitiveKey` 现在在哪、怎么用

```ts
import { sanitizeJsonValue, isSensitiveKey } from '../logging' // 相对路径按你的文件位置调整

const safeBody = sanitizeJsonValue(rawJsonValue) // depth 参数可选，默认 0，一般不用传
```

- 位置：`electron/main/services/logging/sanitize.ts`，经 `electron/main/services/logging/index.ts` 统一导出。
- `ai-runtime/trace.ts` 现在只剩 `buildGenerateTrace`/`buildContinuePollingTrace` 两个函数（43 行），内部调用 `sanitizeJsonValue`，不再自己实现脱敏逻辑。
- **当前脱敏/截断规则是硬编码的**，没有任何开关：
  - 命中 `isSensitiveKey`（key 包含 `api_key`/`apikey`/`authorization`/`token`/`secret`/`password`，大小写不敏感）的字段直接替换成 `'***'`，**这条不可协商，1.3 只能在此基础上扩展，不能放松**。
  - `data:` 开头的字符串（base64 图片/视频/音频）按 `DATA_URI_HEAD_LEN=96` / `TAIL_LEN=32` 截断，中间显示 `...(len=N, data-uri)...`。
  - 长度 ≥512 且形似 base64 的字符串按 `BASE64_HEAD_LEN=160` / `TAIL_LEN=48` 截断。
  - 普通长字符串（含 LLM 的长文本回复）超过 `LONG_STRING_HEAD_LEN=1200 + LONG_STRING_TAIL_LEN=240` 才截断。
- **00-任务总览"重要记录"里已经定了 1.3 的方向**："完整捕获模式保留图片 base64 原文，音频/视频仍摘要"——这意味着 1.3 大概率要给 `sanitizeJsonValue` 加一个可配置的"捕获模式"参数（至少区分"截断"与"完整"两档，且区分数据类型），而不是全局一刀切开关。当前实现里 `MAX_DEPTH`/`*_HEAD_LEN`/`*_TAIL_LEN` 都是模块顶层 `const`，1.3 改造时这些常量大概率要变成可传入参数或从配置读取。

### `logPreviewOnly` 是什么、为什么存在

- 位置：`src/core/logging/logger.ts`，经 `src/core/logging/index.ts` 导出。
- 签名：`logPreviewOnly(domain: string, message: string, meta?: LogCallMeta): void`。
- 作用：写渲染层内存 store（`subscribeLogEvents` 能读到）+ 打印控制台，但**不**调用 `enqueueFrontendLogForBridge`，即不会把这条日志再桥接回主进程落盘一次。
- 使用点（都是"主进程已经权威落盘过同一份数据，渲染层只需要本地展示"的场景）：
  1. `initLoggerConfig()` 里对 `henji://runtime-request-preview` / `henji://llm-runtime-request-preview` 两个预览通道的处理。
  2. `GenerationService.ts` 的 `recordRuntimeTrace()`（记 `generation.runtime.response_json`）。
- **这两条预览通道本身没有删**（`henji://runtime-request-preview` in `ai-runtime/runtime.ts` 的 `emitPreview()`，`henji://llm-runtime-request-preview` in `llm/runtime.ts`），preload/platform/commands 五层都还在。原因：`UnifiedLogViewer`（挂在 `TestModePanel` 里）目前只读渲染层内存 store，`henji://log-event` 实时推送还没有任何代码把它塞进这个 store（那是 2.1 的活），直接删预览通道会让测试模式面板瞬间失去实时展示能力。**1.3 大概率不用管这个**，但如果 1.3 也要动 `logger.ts`/`GenerationService.ts`，记得这段历史，不要误删 `logPreviewOnly` 或预览通道。等 2.1 把独立日志窗口做出来、`UnifiedLogViewer`/`TestModePanel` 按计划删除后，预览通道和 `logPreviewOnly` 的调用点才应该一起清理。

## "尚未接开关"的问题已在 1.3 解决

上一版 handoff 在这里列过"1.3 的活"清单，现已全部完成，不再重复列出（详见本文件最上方"1.3 留下了什么"一节）。仍然独立于统一开关之外、2.1 需要自己决定要不要处理的：

- `src/utils/testMode.ts` 的 `recordApiTrace()`/`api.trace` 事件：1.2、1.3 都决策保持独立（opt-in 调试通道，不纳入 `logCaptureMode` 统一开关）。

## 之前（1.1）留下的坑，依然有效

1. 不要在 `electron/main/services/logging/` 同级再建平铺 `logging.ts` 文件。
2. `appendLogEvents` 在 `push.ts` 里定义，`index.ts` 只 re-export；1.3 新增的 `applyEventSizeFuse` 调用点也放在这里，不要在别处重复调用。
3. 渲染层订阅通道 `listenLogEvent` 目前仍然没有任何代码把推送事件写入 `src/core/logging/store.ts` 的内存 store——**这正是 2.1（日志窗口）的核心工作范围**，1.2、1.3 都没有动它。
4. API key 等敏感字段的打码逻辑唯一入口是 `electron/main/services/logging/sanitize.ts` 的 `isSensitiveKey`，2.1 如果要展示日志内容，直接信任落盘的数据已经打码，不需要在渲染层再做一遍脱敏。
5. 前端桥接事件与后端事件写同一个文件，看 `source` 字段区分来源；旧 `frontend-*.log` 自然过期，不受清理逻辑影响。
6. `MainLogEvent` 新增了可选字段 `truncatedByLimit?: boolean`（`electron/main/services/logging/types.ts`），2.1 渲染层展示日志事件的类型定义（如果有独立于 `MainLogEvent` 的渲染层类型）记得同步这个字段，否则会丢失"这条事件被保险丝截断过"的展示线索。

## 快速自检命令（改完 2.1 也应该跑一遍）

```bash
npx tsc -p tsconfig.electron.json --noEmit
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
npm run lint
npx tsc --noEmit
```
