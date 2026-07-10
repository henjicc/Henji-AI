# 日志调试中心 - 执行期决策记录

## 1.1 主进程日志中枢与统一落盘

### 决策：`electron/main/services/logging.ts` 删除而非改为再导出

- 任务文件里这一点标注"执行时确认，避免双份实现"。
- 排查确认全仓库只有 `electron/main/ipc/logging.ts` 一处 `import ... from '../services/logging'`，没有其他文件依赖旧文件的具体导出名。
- 选择**直接删除**旧文件，新建同名目录 `electron/main/services/logging/` 承接（`index.ts` 作为目录入口，`import '../services/logging'` 自动解析到 `logging/index.ts`，调用方 import 路径不用改）。
- 理由：只有一个调用点，保留再导出文件没有实际兼容价值，反而会让"哪份是主实现"变得含糊，与"避免双份实现"的要求相悖。

### 决策：`appendLogEvents` 与 `pushLogEvents` 放在同一个 `push.ts` 文件

- 任务文件建议的文件划分是 types / writer / main-logger / push / retention / index，`appendLogEvents`（统一写入口，写完再推送）没有单独归属文件。
- 若把 `appendLogEvents` 放进 `index.ts`，`main-logger.ts` 想复用它就必须 `import from './index'`，而 `index.ts` 又要 `export { createMainLogger } from './main-logger'`，会形成 `main-logger.ts` ↔ `index.ts` 循环依赖（CommonJS 下虽然多数情况能跑，但不确定、不好排查）。
- 选择把 `appendLogEvents`（write→push 两步编排）放进 `push.ts`，与 `pushLogEvents` 放在一起；`main-logger.ts` 和 `index.ts` 都从 `push.ts` 单向导入，依赖图是纯 DAG（`types` ← `writer` ← `push` ← `main-logger`；`retention` 只依赖 `writer`；`index` 汇总导出，没有人反向依赖 `index`）。
- 理由：避免循环依赖带来的加载顺序不确定性，同时 `appendLogEvents` 的落点（写完就推送）在语义上确实更贴近"推送"这一步的收尾动作。

### 决策：试点接入选 `ai-runtime/runtime.ts` 的 `generate()`，不动 `continuePolling()`

- 任务文件建议"generate 结果处"，验收标准也只要求一处试点验证链路通。
- 只改 `generate()`（新增 start/result/failed 三个 backend 事件），`continuePolling()` 暂不动，避免这次改动扩大到"顺手把整个 ai-runtime 都加日志"。
- `continuePolling()` 及其余主进程模块的日志覆盖留给 1.2、3.2 或日常开发按规范逐步接入。

### 决策：`createMainLogger` 不做批量防抖，单条事件直接进写入队列

- 渲染层 `enqueueFrontendLogForBridge` 有 450ms/60 条的批量攒批逻辑，是因为要过 IPC 到主进程，减少调用次数。
- 主进程内 `createMainLogger` 已经在同进程内，没有 IPC 开销；`writer.ts` 内部有写入队列做串行化，足够避免并发写文件交错。
- 选择不加防抖/批量，每条日志立即入队写入，保持调用方语义简单（"记完就落盘"），代价是高频日志场景下 appendFile 调用次数更多，可接受。

## 验收反馈修复：`retention.ts` 误清理旧 `frontend-*.log`（同日，主控 agent 验收发现）

- **问题**：初版 `retention.ts` 的 `listLogFiles()` 用 `entry.endsWith('.log')` 匹配日志目录下所有文件，没有区分新旧命名规则。这会导致旧的 `frontend-YYYY-MM-DD.log` 也被纳入"1 天过期删除"和"总大小超限删最旧"两条清理规则，与实施方案"旧文件名 `frontend-YYYY-MM-DD.log` 不迁移不删除，自然过期"直接矛盾，也和 `handoff.md` 里写的"保留策略只清理 `henji-*.log`"矛盾。这是我实现时的疏漏：写清理逻辑时只想着"清理 `.log` 文件"，没有回头核对实施方案里"旧文件不删"这条约束。
- **修复**：把 `MAIN_LOG_FILE_PREFIX = 'henji-'` 从 `writer.ts` 的文件私有常量提到 `types.ts` 作为共享导出常量；`retention.ts` 的匹配条件改为 `entry.startsWith(MAIN_LOG_FILE_PREFIX) && entry.endsWith('.log')`，`writer.ts` 拼文件名时也改用这个共享常量（消除"两处各写一份 `'henji-'` 字符串、以后改一处忘改另一处"的风险）。
- **提醒**：以后任何人改日志文件命名规则（比如前缀改名），只需要改 `types.ts` 的 `MAIN_LOG_FILE_PREFIX` 一处，`writer.ts`/`retention.ts` 会自动同步；不要再在 `retention.ts` 或其他文件里重新硬编码 `'henji-'` 或裸 `.endsWith('.log')` 之类的匹配条件。

## 1.2 LLM请求响应完整捕获

### 决策：`sanitize.ts` 的 `JsonValue`/`JsonObject` 类型直接从 `ai-runtime/types.ts` 引入，不在 `logging/` 下重新定义

- `electron/main/services/logging/sanitize.ts` 需要 `JsonValue`/`JsonObject` 类型，但 `logging/types.ts` 里只有 `MainLogEvent` 相关类型，没有通用 JSON 类型。
- 选择 `import type { JsonObject, JsonValue } from '../ai-runtime/types'`（仅类型导入，编译期擦除，不产生运行时依赖/循环依赖），而不是在 `logging/types.ts` 里重新声明一份等价类型。
- 理由：`llm/types.ts` 已经是这么做的（`import type { JsonObject, JsonValue } from '../ai-runtime/types'` 再 `export type`），是仓库里已确立的跨 service 目录共享类型的方式；重新定义一份会造成"两份等价类型长期漂移"的风险，与"避免同功能多份实现"的项目约束相悖。

### 决策：预览通道（`henji://runtime-request-preview` / `henji://llm-runtime-request-preview`）保留，不做五层删除

- 任务文件把这一点标为"执行时确认"：若 1.1 的 `henji://log-event` 实时推送已覆盖显示需求，则删除预览通道。
- 排查确认：`henji://log-event` 目前**没有任何渲染层消费方**接到 `src/core/logging/store.ts` 的内存 store 里——1.1 只打通了"能订阅"（`listenLogEvent`），真正把推送事件塞进 store、喂给 `UnifiedLogViewer` 是 2.1（日志窗口）的工作范围。而 `UnifiedLogViewer` 现在还挂在 `TestModePanel`（测试模式面板）里，是一个仍在使用中的调试功能，只读 `subscribeLogEvents`（内存 store），如果直接删掉预览通道且不做任何替代，测试模式面板会立刻看不到任何 LLM/生成请求的实时 JSON——这是真实功能回归，不是"绕路问题"本身。
- 选择：**保留**五层通道不动（preload/platform/commands/logger.ts 的监听结构都不删），只把 `logger.ts` 里两个监听器的处理方式从"完整 `createLogger(...).info(...)`"（会经 `enqueueFrontendLogForBridge` 桥接落盘）换成新增的 `logPreviewOnly()`（只写内存 store + 控制台，不桥接落盘）。这样：
  - 主进程侧现在直接落盘一份权威的 `request_json`/`response_json`（本任务新增），文件里不再有渲染层转发的重复副本；
  - 测试模式面板的实时展示能力完全不受影响，用户体感零变化；
  - 等 2.1 把独立日志窗口做出来、`UnifiedLogViewer`/`TestModePanel` 按 00-任务总览"重要记录"里已经定的方向删除后，这两条预览通道和 `logPreviewOnly` 的调用点可以在那次任务里一起清掉（届时`henji://log-event` 推送会是唯一实时展示来源）。
- 记录一下这个先后关系，避免 1.3 或 2.x 的执行者误以为预览通道是"忘记删"。

### 决策：`GenerationService.ts` 的 `recordRuntimeTrace()` 一并从 `logger.info` 改为 `logPreviewOnly`（不在原始文件清单里，执行时扩展）

- 任务文件"涉及内容"没有列出 `src/core/services/GenerationService.ts`，但实施方案第 4 条明确写了"AI 生成链路的 `generation.runtime.request_json` **与现有 trace 同样**改为主进程直接记录（trace 结构已含请求/响应体，转成日志事件即可）"——这里的"现有 trace"指的就是 `recordRuntimeTrace()` 用 `response.trace` 记录 `generation.runtime.response_json` 的机制。
- 一旦 `ai-runtime/runtime.ts` 也直接记录 `generation.runtime.response_json`（本任务新增），如果 `recordRuntimeTrace()` 不跟着改，同一次生成的响应体会在 `henji-*.log` 里出现两次（一次 `source:"backend"`，一次 `source:"frontend"`，内容几乎相同），直接违反验收标准"同一事实不再重复落盘"。
- 因此对 `GenerationService.ts` 做了一处最小改动：`recordRuntimeTrace()` 里的 `logger.info(...)` 换成 `logPreviewOnly(...)`，语义不变（仍然是"记一条 response_json"），只是不再桥接落盘。
- `recordApiTrace()`（`src/utils/testMode.ts` 里的 `api.trace` 事件）**没有动**：它是测试模式手动开关下的独立调试功能（需要用户显式打开"测试模式"+"输出参数"两个开关才会触发），事件名、字段结构（额外带 `model`/`type`/`prompt` 归纳信息）都和 `generation.runtime.response_json` 不同，属于"偶发、opt-in、面向人工调试"的场景，不是本任务针对的"默认开启、静默重复落盘"问题。保留它意味着测试模式打开时，日志文件里对同一次生成会有 `api.trace`（前端，opt-in）+ `generation.runtime.request_json`/`response_json`（后端，默认落盘）两条记录，两者字段结构不同、用途不同，判定为可接受，不算"同一事实重复落盘"。

### 决策：`src/commands/llmRuntime.ts` 删除流内 Error 事件的前端日志，只保留 `invoke_failed`

- 任务实施方案第 5 条要求"确认不与主进程事件重复计为同一事实（event 名区分：`invoke_failed` 前端 / `chat_stream.failed` 后端）"。
- 排查确认：原代码里前端对同一次 LLM 失败会记两条日志——收到流内 `Error` 事件时记一次 `llm_runtime.chat_stream.failed`（前端桥接落盘），IPC 调用本身 reject 后 catch 块再记一次 `llm_runtime.chat_stream.invoke_failed`（前端桥接落盘）。本任务给 `llm/runtime.ts` 的 catch 分支新增了后端权威的 `llm_runtime.chat_stream.failed`（含结构化 error + 规范化消息，信息量比前端那条更完整）之后，前端原来那条 `chat_stream.failed` 就与后端撞名且内容重叠，变成三条记录里有两条同名同质。
- 选择：删除前端对流内 `Error` 事件的日志记录（`handleEvent` 包装函数整体去掉，`onEvent` 直接透传给底层调用，不影响 UI 收到 Error 事件本身），只保留 `invoke_failed`（前端独有视角：确认 IPC 调用本身完成但失败，与后端 `chat_stream.failed` 是否触发是两件独立可验证的事）。

### 已知取舍：`src/core/logging/logger.ts`（886 行）与 `src/core/services/GenerationService.ts`（966 行）均已是存量超 500 行文件

- 本次分别只新增了约 30 行（`logPreviewOnly()`）和几行（`recordRuntimeTrace()` 内一行函数替换 + 注释），未做拆分。
- CLAUDE.md 约束是"修改即拆分"，但这两个文件的拆分是与本任务无关的独立重构工作量（`logger.ts` 承担了整个渲染层日志格式化/控制台美化逻辑，`GenerationService.ts` 是生成主链路核心编排），本任务范围内不适合顺带做，记录在此留给后续任务或专门的治理任务处理，不隐藏这个已知问题。
