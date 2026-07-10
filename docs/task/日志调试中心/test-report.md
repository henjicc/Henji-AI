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

## 2.1 日志窗口骨架与查看器升级

### 自动化检查（已执行，全部通过）

| 命令 | 结果 |
|---|---|
| `npm run gen:model-manifest` | 通过（61 个模型） |
| `npm run check:colors` | 通过，未检测到十六进制颜色直写 |
| `npm run check:model-i18n` | 通过 |
| `npm run lint`（`eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0`） | 通过，无报错/警告 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无报错 |
| `npx tsc --noEmit`（全仓库） | 通过，无报错 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过，无报错/警告 |
| 原生控件检查（`<button>/<input>/<select>/<textarea>` 命中是否仅在 `primitives.tsx`） | 通过，无命中（新组件全部走 `Ui*`） |
| 新增文件行数检查（`src/features/logs/**`、`electron/main/windows/**`） | 全部 ≤ 200 行，远低于 400 行阈值（最大 `LogFilterToolbar.tsx` 122 行、`logStore.ts` 143 行） |
| `node -e "JSON.parse(...)"` 校验 `ui.json` 两份文件语法 | 通过 |
| 新增/修改文件裸 `any` 排查（逐一 review 本次改动文件） | 无命中，未新增裸 `any` |

**未执行 `npm run electron:build` / `npm run electron:smoke`**：仓库 `out/` 目录是本任务开始前的旧构建产物（早于本次改动），若不重新 `electron:build` 直接跑 `electron:smoke` 只会验证旧代码，没有意义；而 `electron:build` 成本较高，且本任务验收标准里几乎全部关键点（开窗口、快捷键、双窗口实时同步、过滤器、暂停恢复）本来就要求用户在真实 `npm run electron:dev` 会话里手动验证——与其额外跑一次昂贵的 `electron:build` 只为过一次不覆盖交互行为的冒烟测试，不如把这部分成本让位给下面的人工验证步骤（用户本就要重启 `electron:dev`）。`tsc -p tsconfig.electron.json --noEmit`（覆盖 `electron/main`、`electron/preload` 全部改动文件，包括新增的 `log-window.ts`）与 `eslint electron` 已经对主进程改动做了完整的静态验证。

### 验收标准逐项对照

| 验收标准 | 状态 | 说明 |
|---|---|---|
| 测试模式按钮与 `Ctrl+Shift+L` 均可打开日志窗口；重复触发聚焦既有窗口，不重复创建 | **待人工验证** | 见步骤 Q、R |
| 主窗口与日志窗口可同时操作，主窗口触发的前端与后端事件实时出现在日志窗口 | **待人工验证** | 见步骤 S |
| 打包产物（或模拟 `app.isPackaged` 且未开测试模式）中无入口按钮、快捷键无效 | **待人工验证**（本机无签名打包环境，用等效方式验证，见步骤 T） | 见步骤 T |
| 来源/级别/domain/关键词过滤与暂停/清空全部可用 | **待人工验证** | 见步骤 U |
| 数千条事件下滚动与过滤不卡顿 | **待人工验证** | 见步骤 V |
| 旧 `UnifiedLogViewer` 及测试面板相关选项已删除，全仓无残留引用；测试模式面板其余功能不回退 | 已通过代码走查 + 全仓 grep 确认（见下方说明），**功能不回退需人工二次确认** | 见步骤 W |
| lint / tsc / check:colors / 原生控件检查通过；任务总览已同步更新 | 已通过 | 见上表；任务总览同步见 `00-任务总览.md` |

`UnifiedLogViewer.tsx`/`TestModeParamsDisplay.tsx` 已物理删除；全仓 `grep -r "UnifiedLogViewer\|TestModeParamsDisplay"` 无命中（含之前依赖它们的 `TestModePanel.tsx`）。`testMode.options.logCaptureMode.*` i18n key 已删除，全仓 grep 无残留引用。

以下步骤涉及启动真实 Electron 应用、点击按钮、按快捷键、开关多个窗口，按项目约定交给用户执行，我没有自己上手操作。全部步骤都在 `npm run electron:dev` 下进行（本次改动涉及主进程与 preload，**必须先重启** `npm run electron:dev`）。

---

### 步骤 Q：验证测试模式按钮打开日志窗口

1. 重启 `npm run electron:dev`。
2. 按 `Ctrl+Alt+Shift+T` 打开测试模式面板，开启"启用测试模式"开关。
3. 在"测试选项"标签页最下方找到"日志窗口"区块，点击"打开日志窗口"按钮。
4. 确认弹出一个新的独立窗口，标题栏显示"痕迹AI - 日志"，窗口风格（背景色、无边框标题栏、圆角等）与主窗口一致；窗口内可见过滤工具栏（来源/级别/域/关键词/暂停/清空/完整捕获）与左右两栏（列表 + 详情）布局。
5. 确认主窗口此时仍可正常操作（两个窗口互不阻塞）。

### 步骤 R：验证快捷键与重复触发不重复创建

1. 关闭步骤 Q 打开的日志窗口。
2. 在主窗口聚焦状态下按 `Ctrl+Shift+L`（开发模式下应始终生效，不需要测试模式开启也能触发，见 `useLogWindowShortcut.ts` 的门控逻辑）。
3. 确认日志窗口再次打开。
4. 不关闭日志窗口，切回主窗口再按一次 `Ctrl+Shift+L`（或再点一次测试面板里的"打开日志窗口"按钮）。
5. 确认**没有**弹出第二个日志窗口，而是已存在的那个日志窗口被聚焦/置于前台（如果之前被最小化，应该被还原）。
6. 关闭日志窗口后，确认主窗口功能不受影响（可以继续正常生成/操作）。
7. 额外验证窗口联动关闭：先打开日志窗口，再关闭主窗口，确认日志窗口跟随一起关闭、应用完全退出（而不是主窗口关了但因为日志窗口还开着导致应用停留在后台不退出）。

### 步骤 S：验证双窗口实时同步

1. 保持步骤 Q 的日志窗口开着，同时把主窗口和日志窗口都摆在屏幕上可见（不要互相遮挡）。
2. 在主窗口触发一次 AI 生成任务或 LLM 对话。
3. 观察日志窗口列表是否实时（毫秒级、不需要手动刷新）出现新的日志行，且来源标签正确区分 `frontend`/`backend`（可在过滤工具栏切换"来源"验证）。
4. 确认前端日志（如 `generation.generate.start` 等）与后端日志（如 `generation.runtime.request_json`/`response_json`）都能看到。

### 步骤 T：验证打包态/非测试模式下入口不可见（等效验证）

由于本机可能没有现成的已签名打包环境，用以下两种等效方式验证渲染层门控逻辑，二选一或都做：

**方式一：模拟生产环境行为（不依赖真实打包）**
1. 关闭测试模式（`Ctrl+Alt+Shift+T` 打开面板，关闭"启用测试模式"开关）。
2. 打开开发者工具 Console，执行 `import.meta.env.DEV` 确认当前是否为 `true`（`electron:dev` 下通常是 `true`，这意味着开发环境下快捷键与逻辑始终允许，属于预期——按钮/快捷键在开发环境下不受测试模式门控是设计如此，见 `useLogWindowShortcut.ts` 注释）。
3. 若要严格验证"生产环境 + 未开测试模式 = 不可用"这条门控分支，需要走方式二。

**方式二：真实构建产物验证**
1. 执行 `npm run electron:build`（生成 `out/` 产物，`app.isPackaged` 在该产物下为 `true`，`import.meta.env.DEV` 为 `false`）。
2. 用 `scripts/lib/electronLaunch.cjs` 或直接运行打包产物启动应用（未开测试模式的初始状态）。
3. 确认测试模式面板本身默认不可见（这是既有行为，不属于本次改动范围）；即使手动打开测试面板但不开启"启用测试模式"，"日志窗口"按钮所在区块因为整个"测试选项"标签页都挂在 `state.enabled` 条件下，同样不可见。
4. 按 `Ctrl+Shift+L`，确认无任何反应（不弹窗口）。
5. 打开测试模式面板并开启"启用测试模式"，此时"打开日志窗口"按钮应可见并可点击；再次按 `Ctrl+Shift+L` 也应生效——验证"生产环境下测试模式开启后入口可用"这条路径同样符合预期（`useLogWindowShortcut.ts` 的生产分支逻辑）。

### 步骤 U：过滤器逐项验证

1. 承接步骤 S，日志窗口里已有一些混合的前端/后端日志。
2. **来源过滤**：切到"前端"，确认列表只剩 `source` 为 frontend 的行；切到"后端"同理；切回"全部来源"恢复。
3. **级别过滤**：故意触发一次失败请求（比如错误 API key）产生 `error` 级别日志，切到"ERROR"级别，确认只剩错误行；切回"全部级别"。
4. **域过滤**：下拉框应该能看到从当前事件流动态收集出的 domain 列表（如 `ai-runtime`、`llm-runtime`、`core.services.GenerationService` 等），选择其中一个，确认只剩该 domain 的行。
5. **关键词过滤**：输入一个已知会出现在某条日志 `message`/`context`/`error` 里的词（比如模型 id 或 requestId 片段），确认过滤结果符合预期；清空关键词恢复全部。
6. 确认以上几种过滤器可以同时叠加使用（比如"后端"+"ERROR"+关键词一起生效）。

### 步骤 V：暂停/恢复与清空验证

1. 点击工具栏"暂停"按钮，确认按钮文案变为"恢复"，列表顶部出现"已暂停，新日志已缓冲"提示。
2. 暂停期间在主窗口再触发几次生成/对话，确认日志窗口列表**不发生变化**（不新增行），但暂停提示后面的缓冲计数会增长。
3. 点击"恢复"，确认之前缓冲的日志一次性补充进列表（顺序正确，最新的在最上面）。
4. 点击"清空"，确认列表清空为空状态提示；之后再触发新请求，确认新日志能正常继续出现（清空不影响后续订阅）。

### 步骤 W：确认测试模式面板其余功能不回退

1. 在测试模式面板逐一检查"不发送实际请求"/"在控制台输出参数"/"允许 F12 打开控制台"/"启用参数流转追踪"四个开关仍然正常工作（本次改动只删除了"日志完整捕获"这一行和"统一日志查看器"区块，其余选项未改动）。
2. 切到"配置导出"标签页，确认导出面板仍正常显示（未受影响）。
3. 确认整个面板布局、动画、关闭交互都和之前一致，没有因为删除内容导致布局错位。

### 步骤 X：数千条事件性能验证

1. 让应用持续运行一段时间，或反复触发生成/对话请求，直到日志窗口积累到 2000~3000 条以上事件（可以观察"加载更早的日志"按钮后面的数字大致判断总量，或临时把测试模式"参数流转追踪"配合高频操作制造更多日志）。
2. 验证列表滚动流畅，不明显卡顿（默认只渲染最近 200 条，需要点击"加载更早的日志"才会展开更多，这是本次为避免卡顿采用的增量渲染策略，不是真正的虚拟滚动——如果实测仍有性能问题，请反馈，可能需要在后续任务里引入真正的虚拟滚动）。
3. 切换过滤器（尤其是从"全部"切到某个稀疏 domain 再切回来），确认响应速度可接受，没有明显掉帧或卡死。

### 步骤 Y：完整捕获开关跨窗口一致性验证（1.3 遗留边界的补充验证）

1. 在测试模式面板已删除"日志完整捕获"开关（本任务搬到了日志窗口工具栏），确认测试面板不再有这一行。
2. 打开日志窗口，在工具栏勾选"完整捕获"，确认状态生效（可结合 1.3 的步骤 L/M 触发长文本/图片请求验证实际截断行为变化）。
3. 关闭日志窗口后重新打开（或再开一个新的日志窗口——正常应该聚焦回同一个，先按步骤 R 关闭旧的），确认"完整捕获"开关的勾选状态与主进程当前真实状态一致（日志窗口挂载时会主动调用 `logging:getCaptureConfig` 拉取一次，见 `LogFilterToolbar.tsx`），而不是每次都重置回默认的"关闭"状态。
4. 测试完成后记得把"完整捕获"开关关回默认状态，避免后续日志体积膨胀。

---

以上 Q~Y 步骤覆盖了本任务几乎全部验收点，均需要真实操作 UI/快捷键/多窗口交互，按项目约定由用户手动执行；完成后如果发现任何一条不符合预期，请描述具体现象（最好附截图或日志片段），方便定位是渲染层过滤/状态管理问题还是主进程窗口管理问题。

## 2.2 请求链路视图与错误复制

### 自动化检查（已执行，全部通过）

| 命令 | 结果 |
|---|---|
| `npm run lint`（`eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0`） | 通过，无报错/警告 |
| `npm run check:colors` | 通过，未检测到十六进制颜色直写或任意值十六进制 Tailwind 类 |
| `npm run gen:model-manifest` | 通过（61 个模型，本任务未改模型定义，仅确认脚本链路未被破坏） |
| `npm run check:model-i18n` | 通过 |
| `npx tsc --noEmit`（全仓库） | 通过，无报错 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无报错（本任务未改动 `electron/` 下任何文件，纯渲染层改动，跑一遍确认零回归） |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过，无报错/警告（同上，确认零回归） |
| 原生控件检查（`grep -rEn '<button\|<input\|<select\|<textarea' --include=*.tsx src` 排除 `primitives.tsx`） | 通过，无命中 |
| `node -e "JSON.parse(...)"` 校验 `ui.json` 两份文件语法 | 通过 |
| 新增/修改文件裸 `any` 排查（逐一 grep 本次全部改动文件） | 无命中，未新增裸 `any` |
| 新增文件行数检查 | `JsonTree.tsx` 129 行、`RequestChainView.tsx` 111 行、`copyFormats.ts` 87 行，均远低于 400 行阈值；修改后的 `LogEventDetail.tsx` 99 行、`LogFilterToolbar.tsx` 161 行、`LogsPanel.tsx` 98 行、`logStore.ts` 160 行，均在可接受范围内 |

未执行 `npm run electron:build` / `npm run electron:smoke`：本任务是纯渲染层改动（任务文件末尾已标注"仅渲染层改动：无需重启"），未涉及 `electron/` 目录下任何文件，`tsc -p tsconfig.electron.json --noEmit` + `eslint electron` 已确认零回归，跑构建/冒烟成本与本次改动的风险面不成比例。

### 验收标准逐项对照

| 验收标准 | 状态 | 说明 |
|---|---|---|
| 任意日志行可打开详情，JSON 按层级折叠展开，超长字符串默认收起 | **待人工验证** | 见步骤 Z |
| 一次 LLM 调用的请求/响应/结果事件可按 requestId 聚合为时间线视图 | **待人工验证** | 见步骤 AA |
| 错误事件在列表中视觉突出，"只看错误"开关可用 | **待人工验证** | 见步骤 AB |
| 单条事件与整条链路均可复制为 Markdown 与 JSON，Markdown 粘贴后代码块格式正确、内容与日志一致 | **待人工验证** | 见步骤 AC |
| lint / check:colors / 原生控件检查通过；任务总览已同步更新 | 已通过 | 见上表；任务总览同步见 `00-任务总览.md` |

以下步骤涉及启动真实 Electron 应用、鼠标点击/复制粘贴操作，按项目约定交给用户执行，我没有自己上手操作。**本任务是纯渲染层改动，不需要重启 `npm run electron:dev`，页面会自动热更新**；如果应用当前未运行，直接 `npm run electron:dev` 启动即可。

---

### 步骤 Z：验证 JSON 折叠树

1. 打开日志窗口（测试模式面板按钮或 `Ctrl+Shift+L`），触发一次任意会产生日志的操作（比如一次 LLM 对话或 AI 生成任务）。
2. 点击列表中任意一条日志（尤其是带 `context`/`error` 字段、内容较复杂的事件，比如 `llm_runtime.chat_stream.request_json`），确认右侧详情面板不再是一整块 `<pre>` 纯文本，而是可交互的折叠树：顶层字段前有 `▶`/`▼` 图标，点击可展开/折叠该字段的子内容。
3. 找一个值为长字符串的字段（比如 prompt 文本超过 200 字符），确认它默认显示为截断预览（末尾有 `…`）+ 一个"展开（N 字符）"小按钮，点击后能看到完整字符串，再点一次变回"收起"。
4. 数字/布尔/`null` 类型的值应该用不同颜色区分（字符串绿色、数字蓝色、布尔黄色/琥珀色），确认视觉上能一眼区分开不同类型。
5. 如果这条事件命中过 `truncatedByLimit`（体积保险丝），确认黄色提示条依然显示在折叠树上方（这是 2.1 已有的行为，本次未改动）。

### 步骤 AA：验证请求链路时间线

1. 触发一次会产生多个关联事件的操作——最直接的是一次 LLM 对话（会产生 `llm_runtime.chat_stream.request_json` → `response_json`，同一个 requestId）或一次需要轮询的 AI 生成任务（`generation.runtime.request_json` → 多次轮询 → `response_json`/结果事件）。
2. 在日志列表中点开其中任意一条事件的详情面板，确认详情面板顶部出现"查看完整链路"按钮（只有该事件带 `requestId` 才会出现，没有 `requestId` 的事件——比如某些日志分组事件——不应该出现这个按钮）。
3. 点击"查看完整链路"，确认弹出一个居中的弹层，标题显示"请求链路 · <requestId 缩略>"，内容是纵向排列的时间线：每条事件前有圆点标记（错误事件是红色圆点，其余是品牌色圆点），每条右上角显示相对首条事件的耗时（如 `+0ms`、`+1234ms`）。
4. 确认时间线里的事件按时间从早到晚排列（最早的请求事件在最上面，结果/失败事件在最下面）。
5. 点击时间线里某一条事件，确认它下方就地展开该事件的 JSON 折叠树（内容与主详情面板看到的一致）；再点一次收起。
6. 也测试工具栏的 requestId 直接查询：从某条日志行或详情面板复制一个完整的 requestId 字符串，粘贴到工具栏最右侧的输入框（"输入/粘贴 requestId 查链路"），按 Enter 或点击旁边的"查看完整链路"按钮，确认弹出同一条链路（效果应与从详情面板打开一致）。
7. 关闭弹层（点击右上角 X 或点击遮罩层），确认主界面列表/详情面板状态不受影响。

### 步骤 AB：验证错误事件视觉突出与"只看错误"开关

1. 确认列表里已有的错误突出显示（2.1 遗留行为，本次未改）：故意触发一次失败请求（比如错误 API key 的 LLM 对话），产生的 error 级别日志行左侧应有红色竖条标记，与正常事件区分。
2. 在工具栏找到新增的"只看错误"复选框，勾选后确认列表**只剩** `level` 为 `error` 的行（其余 info/debug/warn 全部隐藏）。
3. 确认"只看错误"可以和其他过滤条件（来源/级别/domain/关键词）同时叠加使用；如果同时勾了"只看错误"又把级别下拉选成非 error 的值（比如"WARN"），列表应该为空（两个条件是"与"关系，都要满足）。
4. 取消勾选"只看错误"，确认列表恢复显示全部级别的事件。
5. 顺便验证"只看错误"不影响链路查询范围：勾选"只看错误"后，找一条报错事件点开详情，点"查看完整链路"，确认链路时间线里依然能看到该 requestId 下的**全部**事件（包括非 error 的请求/中间事件），不会因为"只看错误"开关而被过滤掉（这是本任务的设计要求，链路查询始终基于完整事件缓冲）。

### 步骤 AC：验证单条事件与整条链路的复制功能

1. 打开任意一条日志的详情面板，点击"复制 Markdown"按钮，确认按钮文案短暂变为"已复制"（约 1.5 秒后恢复原文案）。
2. 打开一个文本编辑器（记事本、VS Code 均可），粘贴（`Ctrl+V`），确认：
   - 内容是 Markdown 格式（标题行以 `###` 开头，元信息以 `- 时间:`/`- 级别:`/`- requestId:` 等列表项形式呈现）；
   - 如果该事件有 `context` 或 `error` 字段，对应内容包裹在 ```` ```json ```` 代码块里，格式正确（不是转义后的字符串，是可读的多行 JSON）；
   - 内容与详情面板/JSON 折叠树里看到的信息一致（没有遗漏字段或内容对不上）。
3. 回到详情面板，点击"复制 JSON"，粘贴到编辑器，确认是标准的 `JSON.stringify(event, null, 2)` 格式，可以直接用 JSON 校验工具（或粘贴进在线 JSON 格式化网站）验证语法合法。
4. 打开一条链路视图（参照步骤 AA），点击顶部"复制 Markdown"，粘贴到编辑器，确认：
   - 顶部有 `# 请求链路 requestId: <完整 requestId>` 标题和"共 N 条事件"提示；
   - 下方是链路里每条事件的 Markdown（格式同单条事件），按时间顺序排列，事件之间用 `---` 分隔线隔开。
5. 同一个链路视图点击"复制 JSON"，粘贴到编辑器，确认是一个 JSON 数组，数组元素按 `timestamp` 升序排列，每个元素结构与单条事件复制 JSON 的结构一致。
6. 复制内容建议直接贴给 AI（比如把复制的链路 Markdown 粘贴给一个 AI 助手），确认信息完整、可读性足够定位问题（这是本任务的核心目标：让排查者不需要手动整理就能直接把日志喂给人或 AI）。

---

以上 Z~AC 步骤需要真实触发日志事件、点击交互、复制粘贴操作，按项目约定由用户手动执行；完成后如果发现任何一条不符合预期，请描述具体现象（最好附截图、粘贴出的 Markdown/JSON 原文），方便定位是 `JsonTree.tsx` 渲染问题、`copyFormats.ts` 格式化问题还是过滤/聚合逻辑问题。
