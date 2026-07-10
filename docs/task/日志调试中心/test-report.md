# 日志调试中心 - 测试报告

## 1.1 主进程日志中枢与统一落盘

### 自动化检查（已执行，全部通过）

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无报错 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过，无报错/警告 |
| `npm run lint`（`eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0`） | 通过，无报错/警告 |
| 新增/修改文件裸 `any` 排查（`grep -rn '\bany\b'` 覆盖本次全部改动文件） | 无命中，未新增裸 `any` |

未执行 `npm run electron:build` / `npm run electron:smoke`：按项目约定这两个命令较费时间，只在确有需要（验证完整类型链路、最终产物）时才跑，本次纯类型/静态检查已覆盖改动风险面，不属于"确有需要"。

**修复记录（验收反馈）**：主控 agent 验收时发现 `retention.ts` 的 `listLogFiles()` 用 `entry.endsWith('.log')` 匹配文件名，会把旧的 `frontend-YYYY-MM-DD.log` 也纳入清理范围，与实施方案"旧文件不迁移不删除，自然过期"矛盾。已修复为 `entry.startsWith(MAIN_LOG_FILE_PREFIX) && entry.endsWith('.log')`（`MAIN_LOG_FILE_PREFIX` 提到 `types.ts` 共享，`writer.ts` 拼文件名与 `retention.ts` 扫描目录用同一个常量）。修复后重新跑了 `npx tsc -p tsconfig.electron.json --noEmit` 与 `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`，均通过。下方步骤 D/E 已同步修正，并新增步骤 F 专门验证旧 `frontend-*.log` 不会被清理逻辑动到。

### 验收标准逐项对照

| 验收标准 | 状态 | 说明 |
|---|---|---|
| 主进程试点模块记录的事件出现在 `henji-YYYY-MM-DD.log`，`source` 为 `backend`，不经过渲染层 | **待人工验证** | 需要真实触发一次生成任务，见下方步骤 A |
| 前端既有日志仍正常落盘到同一文件（`source: 'frontend'`），`createLogger` 调用方零改动 | **待人工验证** | `src/core/logging/logger.ts` 的 `createLogger` 本身未改一行，理论上零改动；实际落盘行为需人工确认，见步骤 B |
| 渲染层可通过新增订阅方法收到实时推送的日志事件 | **待人工验证** | 见步骤 C，验证后不需要改代码（直接在控制台调用即可，无需再删临时代码） |
| 保留清理逻辑正确（1 天前文件删除、总大小超限删最旧文件） | **待人工验证** | 见步骤 D、E；且只清理 `henji-*.log`，旧 `frontend-*.log` 不受影响（本轮验收反馈修复，见步骤 F） |
| `npx tsc` / eslint electron / `npm run lint` 通过；无新增裸 any | 已通过 | 见上表 |

以下步骤涉及启动真实 Electron 应用与手动操作，按项目约定交给用户执行，我没有自己上手操作。

---

### 步骤 A：验证 backend 事件直接落盘（试点：ai-runtime 的 generate）

1. 重启 `npm run electron:dev`（本次改动涉及主进程与 preload，必须重启才生效）。
2. 在应用内正常触发一次任意 AI 生成任务（图片/视频/音频任一均可）。
3. 打开日志目录：`%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`，找到当天的 `henji-YYYY-MM-DD.log`。
4. 用文本编辑器或 `Get-Content` 搜索 `ai_runtime.generate.start` / `ai_runtime.generate.result`（生成失败的话是 `ai_runtime.generate.failed`），确认：
   - 这些行存在；
   - 每行 JSON 的 `"source":"backend"`；
   - `domain` 为 `"ai-runtime"`。
5. 生成过程中**不要**打开开发者工具网络面板去确认"是否经过渲染层"——这条判断标准本身就是"文件里能看到即代表主进程直接落盘"，不需要额外验证渲染层收没收到（渲染层收到与否是步骤 C 的事，两者互不冲突：同一批事件既落盘也会推送）。

### 步骤 B：验证前端日志仍正常落盘同一文件

1. 承接步骤 A 的窗口，正常使用应用一段时间（比如切换几个页面、生成失败一次触发 error 日志）。
2. 在同一份 `henji-YYYY-MM-DD.log` 中搜索 `"source":"frontend"`，确认既有前端日志（如 `generation.generate.start` 等 `src/core/logging/logger.ts` 里定义的事件名）仍然在持续写入同一个文件。
3. 确认没有再生成新的 `frontend-YYYY-MM-DD.log`（旧文件如果之前存在会保留，但不会有新内容追加）。

### 步骤 C：验证渲染层实时订阅

1. 应用运行中打开开发者工具（`Ctrl+Shift+I` 或标题栏菜单），切到 Console。
2. 执行：
   ```js
   window.henjiNative.logging.onLogEvent((events) => console.log('log-event', events))
   ```
3. 触发任意会产生日志的操作（比如再跑一次生成任务，或者任意会调用 `createLogger(...).info(...)` 的前端操作）。
4. 观察控制台是否打印出 `log-event` 数组，数组内每个对象应包含 `timestamp/level/domain/event/message/source` 等字段。
5. 这一步是纯 devtools 控制台命令，不需要改动任何源码，验证完直接关闭 devtools 或刷新页面即可，不留痕迹。

### 步骤 D：验证 1 天保留清理

1. 关闭应用。
2. 进入日志目录 `%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`，手动复制一份现有 `henji-*.log`（或新建一个空文件也可以），重命名为例如 `henji-2026-07-08.log`（比当天早 2 天以上）。
3. 用文件属性或 PowerShell 把它的"修改时间"改到 2 天前（如果文件名日期够早，`mtime` 也要相应调整，因为清理逻辑按文件的实际修改时间判断，不是按文件名）：
   ```powershell
   (Get-Item "$env:LOCALAPPDATA\com.henji.ai\Henji-AI\logs\henji-2026-07-08.log").LastWriteTime = (Get-Date).AddDays(-2)
   ```
4. 重新启动 `npm run electron:dev`。
5. 确认该文件在应用启动后被自动删除（`runLogRetention()` 在 `app.whenReady()` 时执行一次）。

### 步骤 E：验证总大小超限清理（从最旧文件删起）

1. 关闭应用。
2. 在日志目录里人为制造总大小超过 256MB 的情况：可以复制若干份任意大文件并重命名为 `henji-2026-07-0X.log`（**必须同时满足 `henji-` 前缀 + `.log` 后缀才会被清理逻辑扫描到**，只改后缀不改前缀不会被纳入清理范围），累计体积故意做到 300MB+，并让不同文件的"修改时间"错开（用上面 PowerShell 命令分别设置成不同天数，最旧的设置为例如 20 小时前，避免被步骤 D 的 1 天规则先删掉）。
3. 重新启动 `npm run electron:dev`。
4. 确认应用启动后，目录总大小回落到 256MB 以内，且是从**修改时间最早**的文件开始删的（可以提前记录每个测试文件的体积和顺序，删除后核对剩余文件是否符合"保留较新的、删掉较旧的"预期）。

### 步骤 F：验证旧 `frontend-*.log` 不被清理逻辑动到

1. 关闭应用。
2. 在日志目录里放一个旧命名规则的文件，例如复制任意 `.log` 文件重命名为 `frontend-2026-07-01.log`，并把它的"修改时间"改到很久以前（比如 10 天前），确保无论按"1 天保留"还是"总大小超限"哪条规则判断都会被判定为"该删"：
   ```powershell
   (Get-Item "$env:LOCALAPPDATA\com.henji.ai\Henji-AI\logs\frontend-2026-07-01.log").LastWriteTime = (Get-Date).AddDays(-10)
   ```
3. 如果条件允许，同时按步骤 E 的方法让日志目录总大小超过 256MB（`frontend-2026-07-01.log` 保持最旧的修改时间，理论上"从最旧文件删起"应该第一个轮到它）。
4. 重新启动 `npm run electron:dev`。
5. 确认应用启动后 `frontend-2026-07-01.log` 依然存在、没有被删除——这是本次修复要保证的行为：清理逻辑只扫描 `henji-*.log`，旧文件完全不在扫描范围内，不会被"总大小超限"或"1 天保留"任何一条规则误删。

---

以上 A~F 步骤中，A/B/C 只需要一次正常的 `electron:dev` 会话即可覆盖；D/E/F 需要额外制造测试文件，做完记得手动清理测试用的假日志文件，避免污染真实日志目录。

## 1.2 LLM请求响应完整捕获

### 自动化检查（已执行，全部通过）

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无报错 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过，无报错/警告 |
| `npm run lint`（`eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0`） | 通过，无报错/警告 |
| `npx tsc --noEmit`（全仓库，含 `src`，用于确认 `GenerationService.ts`/`logger.ts` 改动没有破坏渲染层类型链路） | 通过，无报错 |
| `npm run check:colors` | 通过 |
| `npm run check:model-i18n` | 通过 |
| `npm run gen:model-manifest` | 通过（61 个模型，本任务未改模型定义，仅确认脚本链路未被破坏） |
| 新增/修改文件裸 `any` 排查（覆盖本次全部改动文件逐一 grep） | 无命中，未新增裸 `any` |

未执行 `npm run electron:build` / `npm run electron:smoke`：按项目约定较费时间，本次纯类型/静态检查已覆盖改动风险面。

### 验收标准逐项对照

| 验收标准 | 状态 | 说明 |
|---|---|---|
| 成功 LLM 对话后 JSONL 含同 requestId 的 `request_json`/`response_json`，内容与界面一致 | **待人工验证** | 见下方步骤 G |
| 失败调用（错误 API key）后有 error 级别事件，含可读错误信息 | **待人工验证** | 见步骤 H |
| AI 生成链路（任选一个图像模型）请求/响应事件同样直接由主进程记录 | **待人工验证** | 见步骤 I |
| 所有捕获事件中 api_key/authorization 类字段为 `***` | **待人工验证** | 复用既有 `isSensitiveKey`，逻辑未改动，但需要实际抽查 JSONL 确认没有遗漏字段，见步骤 J |
| 同一事实不再经"渲染层转发再桥接"重复落盘（文件中无重复事件） | **待人工验证** | 见步骤 K |
| 类型/静态检查通过；无新增裸 any | 已通过 | 见上表 |

以下步骤涉及启动真实 Electron 应用、真实调用 LLM/AI 生成接口（需要真实 API key），按项目约定交给用户执行。

---

### 步骤 G：验证 LLM 成功对话的 request_json / response_json

1. 重启 `npm run electron:dev`（本次改动涉及主进程，必须重启）。
2. 在应用内配置一个有效的 LLM Provider API key（PPIO/OpenAI/DeepSeek 均可），发起一次正常对话，等待完整回复出现在界面上。
3. 打开日志目录：`%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`，找到当天的 `henji-YYYY-MM-DD.log`。
4. 搜索 `llm_runtime.chat_stream.request_json`，确认：
   - 该行 `"source":"backend"`、`"domain":"llm-runtime"`；
   - `context.requestBody` 是完整的 OpenAI 兼容 payload（含 `model`/`messages`/`stream` 等字段），你发送的 prompt 文本能在 `messages` 里找到（除非超过 1200+240 字符会被截断，正常长度的对话内容应完整可见）。
5. 搜索同一个 `requestId`（与上一步是同一个字符串）对应的 `llm_runtime.chat_stream.response_json` 行，确认：
   - `context.output` 与界面上实际显示的回复文本一致（同样受 1200+240 字符截断限制，短回复应逐字一致）；
   - 如果模型开了推理/reasoning，`context.reasoningOutput` 也应该有内容；
   - `context.elapsedMs`/`context.inputChars`/`context.outputChars` 数值合理。

### 步骤 H：验证 LLM 失败对话的 error 事件

1. 承接步骤 G 的窗口，把该 Provider 的 API key 改成一个明显错误的值（比如加个后缀）。
2. 再发起一次对话，界面上应该出现请求失败的提示。
3. 在同一份 `henji-YYYY-MM-DD.log` 里搜索 `llm_runtime.chat_stream.failed`，确认：
   - `"level":"error"`、`"source":"backend"`；
   - `error` 字段是结构化对象（含 `name`/`message`，可能有 `stack`）；
   - `context.normalizedMessage` 是可读的错误描述（应该能看出是 HTTP 4xx/401 之类的鉴权失败，而不是一串看不懂的堆栈）。
4. 顺便确认：改完 key 之后是否**还能**在同一份文件里找到一条 `commands.llmRuntime` 域、`event` 为 `llm_runtime.chat_stream.invoke_failed` 的 `"source":"frontend"` 记录——这条应该存在（IPC 调用确实失败了），但**不应该**再看到 `"source":"frontend"` 且 `event` 为 `llm_runtime.chat_stream.failed` 的记录（这条已经被本次改动删除，只有 `"source":"backend"` 的 `chat_stream.failed` 才应该出现）。

### 步骤 I：验证 AI 生成链路的 request_json / response_json

1. 在应用内正常触发一次 AI 图片生成任务（任选一个已配置 API key 的图像模型）。
2. 等待生成成功后，在 `henji-YYYY-MM-DD.log` 里搜索 `generation.runtime.request_json`，确认 `"source":"backend"`、`"domain":"ai-runtime"`，`context.requestBody` 是发给供应商的最终请求体。
3. 搜索同一个 `requestId` 对应的 `generation.runtime.response_json`，确认 `context.responseBody` 是供应商返回的原始响应结构（图片 URL/base64 等，图片数据本身按 sanitize 规则会被截断成 `...(len=N, ...)...` 形式，这是预期行为，不算异常）。
4. 如果条件允许，触发一次需要轮询的生成任务（比如某些视频模型），确认轮询阶段也能在文件里搜到 `generation.runtime.request_json`/`response_json`（`continuePolling()` 本次是新接入的，之前完全没有这两个事件，值得重点确认）。

### 步骤 J：抽查敏感字段打码

1. 结合步骤 G/I 产生的日志行，搜索 `api_key`、`authorization`、`Authorization`，确认所有命中的值都是字符串 `"***"`，没有任何一处出现明文 key 或 token。
2. 如果应用里配置了多个 Provider 的 key，可以多触发几次不同 Provider 的请求，扩大抽查覆盖面。

### 步骤 K：确认无重复落盘

1. 用编辑器打开 `henji-YYYY-MM-DD.log`，针对步骤 G/I 里用到的同一个 `requestId`，统计一下：
   - `llm_runtime.chat_stream.request_json`/`response_json` 应该各**只出现一次**（`source:"backend"`）；
   - `generation.runtime.request_json`/`response_json` 应该各**只出现一次**（`source:"backend"`）——注意如果测试模式（`Ctrl+Alt+Shift+T`）是打开状态且"输出参数"选项也打开，会额外看到一条 `api.trace`（`source:"frontend"`），这是独立的 opt-in 调试通道，字段结构和 `generation.runtime.response_json` 不同（多了 `model`/`type`/`prompt` 归纳字段），**不算重复**，属于本次决策里明确保留的行为（见 `decisions.md`）；如果测试模式是关闭状态，则完全不应该出现 `api.trace`。
2. 如果发现同一个 `requestId` 下 `generation.runtime.response_json` 或 `llm_runtime.chat_stream.request_json` 出现了两条内容几乎相同、只有 `source` 不同的记录，说明去重没有生效，需要回头检查 `logPreviewOnly` 是否被正确接入（预期：这类事件现在应该只有 `source:"backend"` 一条，不应该再看到对应的 `source:"frontend"` 副本）。

---

以上 G~K 步骤需要真实的 LLM/AI 生成 API key 才能触发，且涉及主动构造错误场景（步骤 H），按项目约定由用户手动执行；完成后如果发现任何一条不符合预期，请把对应日志行原文贴出来，方便定位是 sanitize 规则问题还是事件接入位置问题。

## 1.3 完整捕获开关与脱敏策略统一

### 自动化检查（已执行，全部通过）

| 命令 | 结果 |
|---|---|
| `npm run gen:model-manifest` | 通过（61 个模型，本任务未改模型定义，仅确认脚本链路未被破坏） |
| `npm run check:colors` | 通过 |
| `npm run check:model-i18n` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无报错 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过，无报错/警告 |
| `npx tsc --noEmit`（全仓库，含 `src`，用于确认 `settingsStore.ts` 的自定义 `partialize` 类型推导没有破坏 persist 类型链路） | 通过，无报错 |
| `npm run lint`（`eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0`） | 通过，无报错/警告 |
| 新增/修改文件裸 `any` 排查（逐一 grep 本次全部改动文件） | 无命中，未新增裸 `any` |

未执行 `npm run electron:build` / `npm run electron:smoke`：任务文件"执行步骤"第 6 条只要求跑 `tsc electron` / `eslint electron` / `npm run lint` 三项，本次改动风险面（新增 IPC 通道、preload 白名单、渲染层状态）已被上述静态检查覆盖，构建/冒烟成本较高，按项目约定不做无必要的额外执行；如果需要更强的运行时确信，可在下方人工验证步骤之外自行补跑 `npm run electron:build && npm run electron:smoke`。

### 验收标准逐项对照

| 验收标准 | 状态 | 说明 |
|---|---|---|
| 标准模式：超长字符串按现有策略截断，行为与改动前一致 | **可自动验证的部分已用类型检查兜底；实际截断内容待人工验证** | 见步骤 L |
| 完整捕获模式：同一请求的长文本完整落盘，无 `truncated` 标注；图片 `data:image/*` 原文保留，音频/视频仍为摘要 | **待人工验证** | 见步骤 L、M |
| 两种模式下 api_key/authorization 等字段均为 `***` | **待人工验证** | 见步骤 N |
| 构造超大事件触发保险丝时不崩溃、事件带 `truncatedByLimit` 标注 | **待人工验证** | 见步骤 O |
| 切换开关无需重启应用即时生效 | **待人工验证** | 见步骤 P |
| 类型/静态检查通过；任务总览已同步更新 | 已通过 | 见上表；总览同步见 `00-任务总览.md` |

以下步骤涉及启动真实 Electron 应用、鼠标点击开关、真实触发生成请求（构造超长 prompt/图片），按项目约定由用户手动执行，我没有自己上手操作。

---

### 步骤 L：验证标准模式截断行为与完整捕获模式的长文本差异

1. 重启 `npm run electron:dev`（本次改动涉及主进程与 preload，必须重启才生效）。
2. 打开测试模式面板（`Ctrl+Alt+Shift+T`），确认"日志完整捕获"开关默认是**关闭**状态（对应 `standard` 模式）。
3. 在对话/生成界面构造一个超过 1500 个字符的 prompt（可以随便复制一段长文本反复粘贴凑够长度），发起一次 LLM 对话或 AI 生成请求。
4. 打开日志目录 `%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`，找到当天的 `henji-YYYY-MM-DD.log`，搜索这次请求对应的 `request_json`（LLM 对话搜 `llm_runtime.chat_stream.request_json`，AI 生成搜 `generation.runtime.request_json`），确认 prompt 字段被截断为 `...(len=N, truncated)...` 形式（头部约 1200 字符 + 尾部约 240 字符）。
5. 在测试模式面板打开"日志完整捕获"开关（不需要重启应用）。
6. 用同样超长的 prompt 再发起一次请求，在日志文件中找到这次新的 `request_json` 事件，确认 prompt 字段**完整可见**，没有 `truncated` 标注。
7. 对比两次请求的日志行，验证"标准模式截断、完整模式不截断"的行为差异符合预期。

### 步骤 M：验证完整捕获模式下图片 data URI 原文保留、音频/视频仍摘要

1. 承接步骤 L，保持"日志完整捕获"开关为**开启**状态。
2. 找一个图生图或图生视频模型，上传一张图片发起生成请求（确保请求体里会带 `data:image/...;base64,...` 字段）。
3. 在日志文件中找到这次请求的 `request_json` 事件，确认图片字段是完整的 `data:image/...;base64,...` 原文，没有 `...(len=N, data-uri)...` 摘要标注。
4. 如果有支持音频/视频输入的模型（比如音频转文字、视频编辑类），用同样方式发起一次带音频或视频 `data:` URI 的请求，确认对应字段**仍然**是 `...(len=N, data-uri)...` 摘要形式，不受完整捕获模式影响。
5. 测试完成后记得把"日志完整捕获"开关关回**关闭**状态，避免后续正常使用时日志体积不必要地膨胀。

### 步骤 N：验证敏感字段两种模式下都打码

1. 结合步骤 L/M 产生的日志行（分别在开关关闭和开启的情况下各触发过至少一次请求），搜索 `api_key`、`authorization`、`Authorization`，确认所有命中的值都是字符串 `"***"`，两种模式下都没有任何一处出现明文 key 或 token。

### 步骤 O：验证单条事件体积保险丝

1. 这一步需要人为制造一条超过 2MB 的单条日志事件，比较取巧的方式：在"日志完整捕获"开关开启的情况下，构造一个非常大的图片（比如几 MB 的 PNG，转成 base64 后请求体本身就会超过 2MB）发起一次图生图请求。
2. 在日志文件中找到这次请求对应的 `request_json`/`response_json` 事件，确认：
   - 应用没有崩溃或卡死；
   - 该行 JSON 里 `"truncatedByLimit":true`；
   - `context` 字段被替换成了 `{"truncatedByLimit":true,"originalBytes":N}` 形式（不再包含原始请求体内容）。
3. 如果找不到方便构造超大图片的模型，也可以退而求其次：只验证"正常大小的请求不会被误触发保险丝"（即步骤 L/M 里的日志行都不应该带 `truncatedByLimit` 字段），间接确认保险丝阈值设置合理、不会误伤正常请求。

### 步骤 P：验证开关切换即时生效、无需重启

1. 承接前面步骤，全程只用同一次 `npm run electron:dev` 会话，**不要重启应用**。
2. 在测试模式面板反复切换"日志完整捕获"开关几次（关→开→关→开），每次切换后立即发起一次请求，确认日志文件中对应请求的截断行为跟随开关的最新状态变化（开启时不截断，关闭时截断），不需要重启应用、不需要刷新页面。

---

以上 L~P 步骤涉及真实触发 LLM/AI 生成请求（部分需要构造超长 prompt 或超大图片），按项目约定由用户手动执行；完成后如果发现任何一条不符合预期，请把对应日志行原文贴出来，方便定位是 `sanitize.ts` 分档逻辑问题还是开关同步问题。
