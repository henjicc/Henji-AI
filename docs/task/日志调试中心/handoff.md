# 日志调试中心 - 交接说明（写给下一个执行者）

面向任务：1.3 完整捕获开关与脱敏策略统一

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

## 尚未接"开关"的地方（1.3 的活）

- `sanitizeJsonValue` 的截断阈值全是硬编码常量，没有读取任何配置/开关。
- LLM 与 AI 生成两条链路目前**默认永远截断**（没有"完整捕获"这一档），1.3 需要设计开关存储位置（大概率是 `settingsStore` 或类似的设置项，具体看 1.3 任务文件）、开关如何传导到主进程（IPC？还是主进程自己读一份配置文件？）、以及 `sanitizeJsonValue` 怎么按开关状态改变行为（尤其是"图片 base64 保留原文，音频/视频仍摘要"这种按数据类型区分的要求，现在的实现是不区分数据类型统一走 `data:` 前缀判断+固定长度截断，需要重新设计参数)。
- `src/utils/testMode.ts` 的 `recordApiTrace()`/`api.trace` 事件**完全没有改**，它是独立于本次改造之外的测试模式 opt-in 调试功能（用户手动打开"测试模式"+"输出参数"两个开关才会触发），内部直接把 `trace.requestBody`/`trace.responseBody` 原样塞进日志 context（这两个值已经是 sanitize 后的，因为来自主进程返回的 `trace` 对象）。1.3 如果要统一"完整捕获"语义，需要想清楚这个通道要不要也纳入统一开关，还是保持独立。

## 之前（1.1）留下的坑，依然有效

1. 不要在 `electron/main/services/logging/` 同级再建平铺 `logging.ts` 文件。
2. `appendLogEvents` 在 `push.ts` 里定义，`index.ts` 只 re-export。
3. 渲染层订阅通道 `listenLogEvent` 目前仍然没有任何代码把推送事件写入 `src/core/logging/store.ts` 的内存 store——这是 2.1（日志窗口）的工作范围，1.2 也没有动它。
4. API key 等敏感字段的打码逻辑现在唯一入口是 `electron/main/services/logging/sanitize.ts` 的 `isSensitiveKey`（1.2 从 `trace.ts` 搬过来的），1.3 扩展脱敏策略时改这里，不要在别处再复制一份判断逻辑。
5. 前端桥接事件与后端事件写同一个文件，看 `source` 字段区分来源；旧 `frontend-*.log` 自然过期，不受清理逻辑影响。

## 快速自检命令（改完 1.3 也应该跑一遍）

```bash
npx tsc -p tsconfig.electron.json --noEmit
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
npm run lint
npx tsc --noEmit
```
