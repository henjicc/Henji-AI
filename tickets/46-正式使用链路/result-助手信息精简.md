# 结果：传给助手的信息精简（4u 实施，2026-11-13）

承接 [排查-助手信息冗余.md](排查-助手信息冗余.md) 与 [result-助手DeepSeek适配.md](result-助手DeepSeek适配.md)。未碰 git，未启动或操作运行中的应用，未跑 assistant:cli，没有付费调用。下文 token 数未注明的都是 tiktoken o200k（离线参照）；“DeepSeek token”按排查报告的校准换算（工具 JSON 3.2 字节/token）。独立审查一轮：1 条重要、8 条小问题已全部按意见修改（见第八节），本文数字是修改后的最终代码。

## 一、每项怎么改的与依据

### A1 工具加载：按名加载、跨消息保留、超预算才收回

**改法**（`electron/main/services/embedded-agent/toolDisclosure.ts`）

1. `load_application_tools` 只按 `names` 或 `task` 加载；`domains` 只返回该领域每个工具的一句用途（说明的第一句，不截半句，付费的标“（付费）”）和该领域的做法说明（如三维镜头构图），**不加载**。无参数调用不再默认加载图片编辑整个领域，改为报错并说明用 names 或 domains。旧会话里遗留的 `henji-loaded-image-edit-tools` 记录不再恢复。
2. 已加载的工具跨用户消息保留（同一界面），新加载的由 Pi 接在工具列表末尾（Pi 按会话记录里的首次声明顺序发工具，已在用的工具位置不变）。
3. 已加载的工具（除去当前界面的首轮基础工具）按 `estimateContextTokens` 估算超过模型窗口的 1/8 时——这个估算偏高 1.5–2 倍，实际约为窗口的 1/12–1/16——在下一条用户消息开始处只保留上一条消息里实际调用过的工具，并把“替换后的集合”写进会话记录，冷恢复得到同一组；上一条消息把已加载的都用过时没有可收回的，不写记录。
4. 加载工具的说明、系统提示词、各界面引导里的“按领域加载”改成“先用 domains 看目录，再按 names 加载”。

**依据（真实日志 + 价格）**

- 11-12 的 13 次按领域加载期运行：模型为了查文档、查剪辑结构加载 `documents`、`video_edit` 整个领域，之后真正调用的专用工具只有 `list_projects`、`list_documents`、`open_document`、`observe_video_edit_frame`、`undo_application_changes`、`search_application_settings` 几个；读写都走本来就常驻的通用实体工具。整领域加载让每次请求带 109–115 个工具（35 万字节，约 11 万 DeepSeek token）。
- 跨消息的代价：5a36b3db 是同一会话的下一条消息，首轮就带着上一条加载的 111 个工具，7 次请求每次 12.6–14 万 token。
- 收回的代价：工具定义排在历史之前，收回任何一个都会让其后整段历史按未命中重算。deepseek-flash 未命中 1 元/百万、命中 0.02 元/百万（50 倍）。收回 L token 的工具，只有之后的请求数 R 满足 R × L × 0.02 > H × 0.98（H 为历史长度），也就是 R × L > 49H 才划算。按名加载后一次加载通常 2–5 个工具（约 1–6 千 token），H 动辄 1–10 万，要几百次请求才抵得上一次重算，所以**默认保留**。
- 仍要有上限：工具占窗口过多会挤压历史、提前触发压缩（压缩本身也会整段失效），窗口小的模型（32k/128k）最先受影响。1M 窗口的 DeepSeek 实际几乎不会触发；128k 窗口约在 8–10k 实际 token 的已加载工具时触发。
- 新加载接末尾：Pi 已这样做（`getCurrentTools` 按首次声明顺序重放），原有测试与新测试都覆盖。

### A2 工具定义去掉重复的通用部分

**改法**（`electron/main/services/application-runtime/toolCatalog.ts`、`resultProjection.ts`、`src/core/application-control/inputValidation.ts`）

- 新增 `slimToolSchema`，在“能力声明 → 工具定义”这一层统一去掉：`$schema`；zod 给整数补的 ±9007199254740991；`minLength: 1`；引用对象里可选 `label`/`revision` 的长度与范围（只留类型，读取结果里带着它们的引用原样传回仍然合法）。执行入口仍按完整 zod 声明校验，参数错误照常点名字段。落盘 schema 与能力声明本身（含 `.describe()` 文字）一字未改，持久格式门禁通过。
- 写工具的 `baselineIds` 只留类型；`operationId` 去掉长说明，只留一句“同一次操作重试时沿用同一个值。”（见下面“幂等兜底”）。
- 三个结果开关 `includeRevisions`、`includeEvidence`、`includeDetails` 合并成一个 `includeDetails`（修订号、验证证据、完整元数据一起展开），每个工具只带 `{"type":"boolean"}`。
- 通用约定写成一份 `APPLICATION_TOOL_CONVENTIONS`，放进内置助手系统提示词、MCP 服务器说明和契约 `detail="full"` 的 workflows；系统提示词里原来讲 operationId、baselineIds 的两句随之删除（记忆条目要先读基线这一层意思并入约定）。约定里写明“结果默认省略修订号、验证证据与空值，没列出不代表等于默认值”，与实际行为一致（只有生成准备的 options 按默认值省略，那是该工具自己说明的）。
- **幂等兜底**（审查重要问题）：外部客户端不一定把服务器说明交给模型，只看工具定义时超时后可能换新值重提、付费工具重复扣费。所以工具定义里仍保留四处极短的提示：`operationId` 一句；付费工具说明末尾“ 付费工具；结果未知时用原 operationId 查 get_application_operation，不要重提。”；`get_application_operation` 说明保留“断线、超时或换客户端后用原 operationId 查询，不要换标识重试”；`describe_application_contract` 说明开头“写入前先读一次，含幂等与付费约定”。
- 两条通道同源：Pi 与 MCP 都从 `buildApplicationToolCatalog` 取同一份定义，没有一边精简一边没跟上。

### A3 过时与套话

- `list_application_entities`：删掉“脚本语言不支持遍历读取结果”（Henji Script 已删），改为“不要整页取回再逐个比对”，并把原先目录层追加的“items 与 refs 按位置对应”并进能力说明；输入 schema 旁的注释同步改掉脚本语言的说法。
- `get_application_operation`：去掉“从主进程登记刷新”。
- `interpret_*_intent`、`read_*_intent_recording`：“Pi 提出 / 供 Pi 理解”改成“助手”。
- `organize_assistant_memory`：说明里整段附带的 `MEMORY_RULES`（约 550 字）删除；两条通道的常驻说明里本来就有。
- `describe_application_entities` 的属性说明：只是“领域名 + 标题 + 。”的自动说明（如“口播剪辑口播名（文件名）。”，排查统计 984 条里有 371 条）不再输出；注册文案本身没改（`audioEditFields.ts` 等在别的任务手里）。
- 没删的：各工具里写约束、单位、改道的说明都保留；`read_application_media` 等协议工具的参数说明保留。

### B4 完整结构查询必须点名

`describe_application_entities` 的 `detail="full"` 只展开 `propertyIds` 点名的属性；不点名时返回紧凑目录并附 `hint`（说明怎样点名）。同一次返回里结构相同的值 schema 只展开一次，其余写 `valueSchemaSameAs: <第一次出现的属性 id>`。只查一类实体时紧凑目录里的属性不再重复 `entityType`。

### B5 生成准备的输出

新增 `publicGenerationPreparation`，用在 `prepare_generation_task`、`prepare_canvas_node_generation`、`prepare_image_edit_outpaint`、`prepare_video_edit_in_place_generation` 的能力返回：

- `options` 不含提示词，只列与模型默认值不同、且非空的参数（界面面板的空状态等于默认值，自然不出现）；能力说明写明“默认值见 get_model_schema”。
- `selectionEvidence` 只留 `standing`、`standingReason`、`promptLanguage`。
- `priceEstimate` 去掉每次相同的 `comparisonNote` 与 `comparableCnyExchangeRate`；`amount` 四舍五入到 4 位小数，`comparableCnyAmount` 进位到 4 位（它也是付费授权的金额，只进不舍不会低估）。
- 画布提交、估价、媒体尺寸检查用的是完整准备结果，整形只发生在能力处理器的返回边界，`readCanvasNodeGeneration` 等内部函数不变。**提交前的付费预检（`generationBudget.ts`）读的就是这份精简后的返回**，它依赖的 `canSubmit`、`errorCode`、`message`、`priceEstimate.comparableCnyAmount`、`priceEstimate.estimateKind` 都原样保留，有结构断言钉住（`generationPreparationService.test.ts`）。
- `create_visible_generation_task` 不依赖模型抄写 prepare 的 options：它按自己的入参重新准备（已核对 `registerGenerationCapabilityHandlers.ts`）。
- `resolve_generation_model` 输出本来只有 modelId、providerId、selection，无需改。

### B6 读取、列表与回执

均在 `resultProjection.ts` 的公开投影里做，`includeDetails:true` 时原样给全；账本、基线、验证仍用完整内部回执。

- 所有结果：默认不交付顶层 `revision`、`scopeRevisions`、`revisionEpoch`（模型并发核对用 `baselineId`）。例外：带 `textPage` 的长文本分页读取保留 `revisionEpoch`——续读靠“每页 revisions 与代次都不变”判断原文没变，宿主重启后修订号可能恰好相同；读取工具说明同步写成“revisions 与 revisionEpoch 任一变化都重新从头读取”。
- 写入回执：去掉 `transactionRef`、`resultingRevisions`、`verification.checkedAt`、空的 `unmetConditions`、`origin:{kind:"direct"}`，以及与 `effects[].refs` 完全相同的 `resultRefs`；`undoRef`、`operationId`、`executionState/verificationState`、`effects`、`verification.verified` 保留。宿主日志与 `logs:query --chain` 的“执行事务”一步改从精简前的结果取（分发器 `call` 新增只给宿主用的 `observeRaw` 回调，内置助手服务用它写日志），事务号与写入引用照常进日志。
- `read_application_entity` 不点名属性时：不列空值属性（null、空字符串、空数组、空对象），给 `omittedEmptyProperties` 个数；单个属性超过 8000 字（转录稿、多次拍摄、关键帧数组这类）只在 `largeProperties` 给条目数与字数；`capturedAt` 与和 `ref.kind` 相同的 `entityType` 不给。点名属性原样返回。0 和 false 不当空值省略（opacity 0、enabled false 都有意义；实体属性普遍没有登记默认值，所以“等于默认值”没法通用判断，只省空值）。说明里写明了这些规则。
- `list_documents` / `list_projects`：`draft`、`missing`、`external` 只在为 true 时出现；按项目列出时不再逐条重复 `projectId`、`projectName`。
- 大数组：词块、片段、关键帧要么是实体（`list_application_entities` 有 cursor/limit、propertyIds、where、text），要么是属性（`read_application_entity` 用 propertyIds 选、长文本用 textPage）；剪辑转录另有 `query_video_edit_transcript` 局部检索。字段选择和分页都已存在，本次补的是“不点名时大属性不展开”和下面的“默认不读属性”标记。
- MCP 资源（`resources/read`）是实体完整快照，固定按 `includeDetails:true` 读取，不受默认精简影响。

### B6 补：通用读取层的“默认不读”属性（给口播线索等大属性用）

属性描述符新增可选 `omitFromDefaultRead: true`（`src/core/application-control/reflection.ts`，由注册表 `registry.ts` 统一处理）：

- 不点名属性的整实体读取（`read_application_entity` 省略 propertyIds，或任何内部 `readEntity(ref, undefined)`）时，注册表**不把它放进交给 provider 的 `request.propertyIds`**，结果里也没有它。provider 据此就能区分“调用方没点名”（列表里没有它）与“点名了它”（列表里有它），只在点名时才去算这类贵的值。
- 点名读取、`list_application_entities` 的 `propertyIds` 投影与 `where` 筛选照常读取它。
- `describe_application_entities` 在该属性上标 `omitFromDefaultRead: true`，模型据此知道要点名；读取工具说明也写了这一条。
- 用法：在属性描述符（字段定义的 `descriptor`）上加 `omitFromDefaultRead: true`，provider 的 `readEntity` 按 `request.propertyIds` 里有没有它决定算不算。注册表测试覆盖“默认读取不交给 provider、点名能读、按它筛选能用”。

### B7 字体实体结构解析失败

是真实缺陷，不是离线环境缺注册：`font.axes`（11-10 可变字体加入）的值引用了 `font.axes.value` 这份值 schema，但 `createFontRegistration` 没有登记它，`describe_application_entities` 带上 font（包括 `domains:["video_edit"]` 整域）就抛 `SCHEMA_NOT_FOUND`。补登记了值 schema（`fontReflection.ts`），并在 `propertyCoverage.test.ts` 加结构门禁：全注册表每条 json 属性的值 schema 都必须能解析，缺了点名是哪条。离线总账里 `video_edit` 域的结构查询由 error 变为正常（紧凑 19.7k）。

## 二、改前改后的总账

度量脚本都在 `tickets/46-正式使用链路/证据/payload-audit/`：

- `run.sh`：离线总账（本次扩展：真实 Pi 首轮经 `PiToolDisclosure` 本身计算、含加载工具与 read_assistant_context；按领域目录结果的体积；生成准备经同一份公开整形）。改前在改动前的代码上跑出（2026-11-13 00:03Z），报告存为 `before-report.txt`；改后为最终代码。
- `replay.sh <改前 payloads.json> <日志...>`：`replay.test.ts` 把真实日志里的工具调用参数按当前定义用 Pi 的校验器重验、把能解析的结果按当前投影重算体积（`replay_summary.py` 汇总）；`simulate.py` 按真实请求序列替换工具定义，估算缓存与费用（乐观、保守两种口径）。改前的 payloads.json 有 14MB，没放进仓库，需要时在改动前的提交上跑一次 `run.sh` 得到。

### 1. 每次请求的固定开销

| 块 | 改前 | 改后 | 说明 |
|---|---|---|---|
| 全目录工具定义（同一批 260 个，Pi 形态） | 179,412 | 144,173（−19.6%） | 其中 inputSchema 144,764 → 109,229（−24.5%）；另有录音的子代理新增 5 个工具，全目录现 265 个 145,708 |
| MCP tools/list（含 outputSchema） | 445,045 | 410,685（−7.7%） | outputSchema 未动 |
| 通用部分：三个结果开关 / `$schema` / 信封 / 安全整数 | 10,660 / 4,608 / 23,218 / 251 处 | 2,120 / 0 / 9,286 / 0 处 | 剩下的是每个工具一个裸 `includeDetails`、写工具 `operationId`（一句）与裸 `baselineIds` |
| 写工具平均 | 747 | 593 | 196 个写工具 |
| 剪辑领域 90 个工具 | 85,935 | 70,569（−18%） | 改后不会再整领域加载，这里只作 schema 精简的对照 |
| 生成页首轮（真实 8 个工具） | 21,644 字节，约 6.8k DeepSeek token（11-12 真实日志） | 20,263 字节，约 6.3k（−6%） | 首轮工具少，写工具只有 change 一个，收益主要在大工具集 |
| 剪辑页首轮（22 个工具） | 约 66.1k 字节，约 20.7k | 约 58.8k 字节，约 18.4k（−11%） | 改前按 20 个工具实测 + 加载工具与 read_assistant_context 推算 |
| 系统提示词 | 1,491 | 1,703（+212，约 +284 DeepSeek token） | 加了工具通用约定、删了两句重复；属常驻前缀，跨会话命中 |
| `domains:["video_edit"]` 目录（一次性，进历史） | —（整领域加载每次请求约 10.5 万 DeepSeek token） | 3,836 | 90 个工具每个一句用途 |

### 2. 典型任务的总输入与缓存命中（按真实请求序列估算）

方法：取 11-12、11-13 日志里 20 次内置助手运行、157 次请求的真实 `toolBytes`、input、cacheRead 与工具调用序列。非工具部分 = 真实输入 − 工具字节/3.2，改后不变（加系统提示词增量）。改后的工具集合 = 新的生成页首轮 + 在原加载那一步按名加载“本次运行里之后真正调用过”的专用工具，跨消息保留。未命中：改后工具集合变化的那次请求算变化点之后全部未命中（新增工具 + 全部消息），同一步真实也换过工具时取两者较小（真实值含跨会话缓存）；真实因整领域加载整段未命中、而改后不变的，只算新追加的消息；其余沿用真实未命中。价格按 deepseek-flash 闲时，只算输入。B6 的结果精简没算进来。

两种口径：**乐观**——模型照加载工具说明里列的工具名直接按名加载；**保守**——真实日志里 22 次加载有 14 次只给了 `domains`，按新逻辑这一步只拿到目录，要再请求一轮才按名加载，算作“多一次请求 + 目录结果进历史”（目录按每个工具约 51 DeepSeek token 计）。

| 运行组 | 请求数 | 每次请求平均输入 | 未命中合计 | 输入费用 |
|---|---|---|---|---|
| 按领域加载期（13 次运行，11-12 23:04–23:34） | 110 | 89,519 → 乐观 25,760 / 保守 28,269（另多 13 次目录请求） | 78.6 万 → 31.3 万 / 37.7 万 | ¥0.967 → ¥0.364 / ¥0.439 |
| 按名加载期（7 次运行，11-12 23:39 起，上一次提交后的代码） | 47 | 34,042 → 32,754（两种口径相同） | 21.8 万 → 21.8 万 | ¥0.246 → ¥0.245 |
| 合计 | 157 | 72,911 → 27,854 / 29,509 | 100.4 万 → 53.2 万 / 59.5 万 | ¥1.213 → ¥0.609 / ¥0.684 |

命中率 91.2% → 87.8%（保守 88.1%）不是变差：去掉的主要是每次都命中的大块工具定义，分母变小；未命中的绝对量和费用都明显下降。

逐运行的代表（乐观口径；保守口径见 `replay.sh` 输出）：

| 运行 | 任务 | 改前 | 改后 |
|---|---|---|---|
| e0039f96 | 读多轨4K结构（人在生成页，第 2 轮整领域加载剪辑） | 6 次请求 61.3 万 token，未命中 11.4 万，¥0.124 | 9.0 万，未命中 0.96 万，¥0.011（保守 13.6 万、¥0.021） |
| 5a36b3db | 同一会话下一条消息，查素材（首轮就带着 111 个工具） | 93.6 万，¥0.031 | 20.8 万，¥0.017 |
| 9ed3b90f | 剪辑里取帧核对（33 次请求，第 2 轮加载 video_edit+documents） | 416.1 万，未命中 15.8 万，¥0.238 | 92.6 万，未命中 5.6 万，¥0.073（保守 115.2 万、¥0.094） |
| 0927c6d6 | 剪辑里读结构 + 取帧 | 99.1 万，¥0.146 | 18.4 万，¥0.031 |
| b0202efd | 已按名加载（2 个工具） | 64.9 万，¥0.098 | 63.1 万，¥0.097（大头是一次 5.6 万 token 的 `detail="full"` 读结构，见下） |

按名加载期的几次运行里，单次最大的输入来自 `describe_application_entities(entityTypes:[sequence,track], detail:"full")`（日志里 56,352 token 未命中）——B4 之后不点名属性只返回紧凑目录，这一类单次几万 token 的结果会消失，上表没有计入。

### 3. 每轮内容（结果）的变化

| 结果 | 改前 | 改后 |
|---|---|---|
| `describe_application_entities` 剪辑片段 `detail="full"` 不点名 | 331,514 | 14,400（返回紧凑目录 + 提示） |
| 同上，剪辑序列 / 图片编辑全域 / 设置全域 | 53,272 / 70,171 / 36,109 | 约 3.3k / 5.2k / 2.9k |
| `describe_application_entities(domains:["video_edit"])` | SCHEMA_NOT_FOUND | 紧凑全量约 19.7k |
| `prepare_generation_task`（300 字提示词）Kling 4.0 / GPT Image 2.6 / MiniMax Speech | 751 / 794 / 768 | 265 / 242 / 189（−65%～−75%，提示词越长省得越多） |
| 真实结果回放（日志里能解析的 101 条，≤4000 字） | 136,843 字 | 113,309 字（−17%）；其中 read_application_entity −33%、list_documents −37%、list_projects −21%、change/undo 回执 −41%/−44% |
| 契约 compact / full | 1,728 / 12,098 | 1,733 / 12,457（full 的 workflows 里多了通用约定） |

### 4. 缓存的影响

- 这次改动让常驻前缀（工具定义与系统提示词）变一次：每个用户的第一次请求（以及每种工具集合第一次出现）冷启动一次，之后照常命中。A1 与 A2 一起发，只失效这一次。
- 之后：整领域加载造成的“加载那一步十万 token 未命中”不再发生；按名加载那一步的未命中只剩新追加的少量工具和此前的历史（真实日志里按名加载的那一步未命中 0.03–0.7 万）。先查目录再加载时多一轮，那一轮前缀不变，只有目录结果是新内容。
- 收回工具只在超预算时发生，并且在用户消息开始处一次性做完，同一条消息里不反复变。
- 前缀逐字节稳定：工具定义的序列化不含时间或随机量，`slimToolSchema` 是纯函数；原有“同样输入新开对话首个请求逐字节一致、多轮只在末尾追加、中途按名加载后原有工具逐字节不变”的测试保持通过。

## 三、助手仍能完成任务的证据

1. **真实调用回放**：11-12、11-13 日志里模型发出的 161 次工具调用（20 次运行），参数按新的工具定义用 Pi 同一个校验器（`validateToolArguments`）逐条校验，161/161 通过。要说清它证明了什么：这 161 次里写调用只有 7 次，而且新 schema 只比旧的更宽松（去掉的都是约束），所以它只能说明**新定义不会误拒模型原来的写法**（含 `includeDetails:true`、引用里带 `label` 的调用），不能说明模型只看新定义也会写对。
2. **测试替身（受控模型按计划回放工具调用）**，精简前后都通过（精简后只改了与有意变化的输出相关的断言）：
   - 画布生成闭环：`task=canvas_generation` 加载 → 读参数 → 跨界面 → 回到画布与冷恢复后工具仍可用（`piEngine.test.ts`）。
   - 剪辑按名加载：正式 Responses 路径中途 `names:["export_video_edit"]`，工具接在末尾、原有部分逐字节不变，新开对话首请求逐字节一致（`piEngine.test.ts`）。
   - 新增：`domains` 只返回目录、目录里每个工具有用途、按目录点名后加载成功、无参数报错给改道（`piEngine.test.ts`）。
   - 新增：已加载工具跨消息保留；超预算时只留上一条消息调用过的，冷恢复同一组；没有可收回的不写记录（`piEngine.test.ts`）。
   - 授权讲解 JSONL：按名加载后调用并读到图片（`piEngine.test.ts`）；内置助手服务端到端（`servicePi.test.ts`）。
3. **公共入口与 MCP**：MCP 发现与调用、未知字段与类型错误点名字段且按提示修正后可继续、大属性点名后整份经协议返回（`server.test.ts`）；真实 MCP → 中立桥 → 注册表读设置（`mcpIntegration.test.ts`，单独运行通过）；MCP 写入、幂等与 `includeDetails` 不进幂等摘要（`mcpWriteIntegration.test.ts`，原生 SQLite 运行器通过）；公共入口 describe→change→read（`applicationHarness.propertyNormalization.test.ts`）；读取/列表/回执/准备的新形状各有精确测试。
4. **费用估算的偏差方向**：加载这一侧，乐观口径假设模型直接按名加载；真实里 14 次只给 domains 的加载在新逻辑下要多查一轮目录，保守口径已把这一轮算进去（合计费用 ¥0.609 → ¥0.684，仍比改前 ¥1.213 低 44%）。结果这一侧（B4–B6）没算进去，是往省的方向偏保守。
5. **没做的**：真实 Pi + 真实模型的对照走查（按要求留给统一走查）。最值得看：模型是先 `domains` 看目录再点名（多一轮）还是直接按说明里的名字加载；`read_application_entity` 省略空值后模型会不会误以为属性不存在；剪辑首轮 20 个工具的真实调用频率（甲3 没动）。

## 四、契约变化

对外能力契约由大版本 3 升到 **4**（`EXTERNAL_CONTRACT_VERSION`、弃用策略文字、`AGENTS.md`、`docs/rules/assistant-capability.md`、两份 `henji-application-capability` skill 同步），因为有不兼容变化：

- 输入：`includeRevisions`、`includeEvidence` 删除，统一为 `includeDetails`；传旧字段会按“不认识的参数”拒绝并列出可用字段。
- 输出（默认，`includeDetails:true` 可恢复）：顶层 `revision`、`scopeRevisions`、`revisionEpoch` 不再给（分页读取保留代次）；写入回执不再给 `transactionRef`、`resultingRevisions`、`verification.checkedAt`、空 `unmetConditions`，`resultRefs` 与 effects 重复时不给；整实体读取省略空值与大属性、不给 `capturedAt`；文档与项目列表省略 false 标记与按项目重复的项目字段。
- 行为：`describe_application_entities` 的 `detail="full"` 不点名属性时返回紧凑目录；新字段 `hint`、`valueSchemaSameAs`、`omittedEmptyProperties`、`largeProperties`、`omitFromDefaultRead`。
- 生成准备的 `preparation.options` 只含与默认值不同的参数，`selectionEvidence` 与 `priceEstimate` 精简（这部分不随 `includeDetails` 恢复，完整默认值走 `get_model_schema`）。
- 投影后的 outputSchema 同步把这些字段改为可选，Ajv 输出契约校验通过；`catalogSchemaHash` 随之变化，已连接的外部客户端会收到目录变更。

## 五、改动文件

标“共用”的文件里还有别的任务的未提交改动（录音能力、口播线索交接材料），我的部分写在括号里，提交时请按块分开。

- 工具定义与结果投影：`electron/main/services/application-runtime/toolCatalog.ts`、`resultProjection.ts`、`applicationToolDispatcher.ts`（`call` 的 `observeRaw` 参数）、`runtime.ts`（内置客户端透传 `observeRaw`）、`src/core/application-control/inputValidation.ts`、`localHostContracts.ts`
- 通用读取层：`src/core/application-control/reflection.ts`（`omitFromDefaultRead`）、`registry/registry.ts`（整实体读取跳过它）
- 工具加载：`electron/main/services/embedded-agent/toolDisclosure.ts`、`toolDisclosureProfiles.ts`、`piEngine.ts`、`service.ts`（系统提示词、日志摘要改用精简前结果）
- MCP：`electron/main/services/mcp/server.ts`（服务器说明）、`resources.ts`（资源按完整结果读）
- 能力说明：`src/core/application-control/domains/shared/applicationReflectionApplicationCapabilities.ts`、`domains/generation/generationApplicationCapabilities.ts`、`domains/assistantMemory/memoryCapabilities.ts`、`domains/creativeIntent/creativeIntentCapabilities.ts`
- 结构描述与读取：`src/features/application-control/capabilities/applicationReflectionAdapter.ts`
- 生成准备：`src/features/generation/application/generationPreparationService.ts`、`registerGenerationCapabilityHandlers.ts`、`src/features/imageEdit/application/registerImageEditOutpaintHandlers.ts`、`src/features/videoEdit/application/videoEditInPlaceCapability.ts`
- 字体：`src/features/videoEdit/application/fontReflection.ts`
- 测试：`electron/main/services/application-runtime/toolCatalog.test.ts`、`resultProjection.test.ts`、`persistedWebReplayRecovery.test.ts`（结果开关）、`outputContract.test.ts`（**共用**：我只改了两处 `{ includeDetails: true }`，新增的录音样例回执是录音子代理的）、`electron/main/services/embedded-agent/piEngine.test.ts`、`electron/main/services/mcp/server.test.ts`、`src/core/application-control/inputValidation.test.ts`、`registry/registry.test.ts`、`src/features/application-control/capabilities/applicationReflectionAdapter.test.ts`、`propertyCoverage.test.ts`、`src/features/application-control/mcpWriteIntegration.test.ts`、`src/features/generation/application/generationPreparationService.test.ts`
- 规则与台账：`AGENTS.md`（契约版本那一行）、`docs/rules/assistant-capability.md`、`docs/rules/assistant-status.md`（**共用**：我的是顶部“2026-11-13（传给助手的信息精简…）”一条与第五节“2026-11-13（工具按名加载）”一条；顶部录音那条与第三节的改动是录音子代理的）、`.claude/skills/henji-application-capability/SKILL.md`、`references/capability-patterns.md`（`.codex` 同步两份）
- 度量脚本：`tickets/46-正式使用链路/证据/payload-audit/audit.test.ts`、`tokens.py`（改）、`replay.sh`、`replay.test.ts`、`replay_summary.py`、`simulate.py`、`before-report.txt`（新）
- 本文：`tickets/46-正式使用链路/result-助手信息精简.md`

## 六、检查与测试结果（本次实际执行）

级别 L2（公共契约、跨 Pi/MCP 两条通道的结果投影），属提交前审查范围（已审一轮）。

- `npm run check:application-control-coverage`：通过（15 项）
- `npm run check:persistence-compat`：通过（67 种格式；落盘 schema 未改）
- `npm run check:skill-sync`：通过（5 个 skill、26 个共享文件）
- `npm run check:main-imports`：通过（toolDisclosure 新引入 toolCatalog）
- 改动的 TS 文件 eslint：0 问题
- 精确测试（最终代码）：toolCatalog、resultProjection、piEngine（39 项）、service、servicePi、server（27 项）、registry、inputValidation、responseSize、reflectionAdapter、propertyCoverage、fontReflection、generationPreparationService、registerGenerationCapabilityHandlers、canvasGenerationTaskService、registerImageEditOutpaintHandlers、videoEditInPlaceCapability、outputContract、persistedWebReplayRecovery、externalToolContracts、skillToolReferences，以及 describe 的 12 个消费方测试与 `applicationHarness.propertyNormalization`：通过
- `npm run test:assistant-persistence -- src/features/application-control/mcpWriteIntegration.test.ts`：Electron 原生 SQLite 通过（1 文件 5 用例 0 跳过）
- `sh run.sh`、`sh replay.sh`：跑通，数字即本文第二节
- 类型检查：最终代码上两套各 0 错误（过程见第八节末尾）

与本次无关、跑到时遇到的失败（未修）：

- `videoEditEffectPresets.test.ts` 一项：效果库存储 `minReaderVersion` 期望 18、实际 17，与本次改动无关。
- `mcpIntegration.test.ts` 与其他测试一起并行时 30 秒超时，单独运行通过。
- 之前遇到的 `outputContract.test.ts` 缺录音与口播撤销样例回执，已由录音子代理在同一文件补上，现在通过。

## 七、没做的与风险

**没做的**

- 甲3（剪辑首轮 20 个工具，就地生成 5 个约 6.6k）：要等真实剪辑任务的调用频率再定。
- 甲4（`export_video_edit.settings` 等巨型 schema）与 `interpret_*_intent` 收敛：改领域声明，收益在按名加载后只剩点名那几次。
- 乙2 的注册文案修正（371 条“领域名+标题”说明）：只在输出端不再发给模型，注册文案没改，`audioEditFields.ts` 等在别的任务手里。
- 丙2（search_models 截断半句的价格说明、`inputLimits.when` 表达式）、丙3（技能主文件超预算）、丙4（MCP `content.text` 与 `structuredContent` 双份）、丙5（宿主上下文）：低优先级，未动。
- 属性键改相对键：没做。模型会把相对键抄进 where/propertyIds，跨工具不一定都接受，风险大于收益。

**风险**

- 首次使用新定义时整段前缀冷启动一次（见第二节第 4 点）。
- 模型可能先查 `domains` 目录再点名，多一轮请求（约 1 秒、目录一次 3.8k token 进历史，已在保守口径里计入）；也可能分几次按名加载，每次加载那一步按历史长度未命中一次。说明里已要求“一次列齐”。
- 整实体读取省略空值与大属性：模型若没读说明，可能把“没列出”当成“没有这个属性”。点名 propertyIds 原样返回，说明与通用约定都写明了“没列出不代表等于默认值”。
- 窗口小的模型在长会话里会触发收回，之后再用到被收回的工具要重新加载，那一步按历史长度未命中一次。
- 生成准备的 `comparableCnyAmount` 改为进位到 4 位小数，付费额度判断最多多算 0.0001 元。

## 八、审查意见的处理（第 1 轮）

1. 重要｜外部客户端不读服务器说明时幂等约定丢失：已改。`operationId` 留一句、付费工具标记补“结果未知时用原 operationId 查 get_application_operation，不要重提”、`get_application_operation` 恢复“断线、超时或换客户端后用原 operationId 查询”、`describe_application_contract` 说明开头“写入前先读一次，含幂等与付费约定”；`toolCatalog.test.ts` 的断言改为“baselineIds 不带说明、operationId 说明不超过 20 字、付费工具以新标记结尾”。全目录因此比上一版多约 3.3k token（同一批 260 个：140,830 → 144,173）。
2. 付费预检读的是精简后的结果：注释与本文改准；`generationPreparationService.test.ts` 加结构断言钉住 `canSubmit`、`errorCode`、`message`、金额与 `estimateKind`。
3. 通用约定的“等于默认值”：改为“没列出不代表等于默认值”，与实际一致。
4. `AGENTS.md` 契约版本：改为当前大版本 4，并留升级来历。
5. 日志丢事务号：分发器 `call` 新增 `observeRaw`，内置助手日志改用精简前结果；`resultProjection.test.ts` 断言观察到的是精简前结果、交给模型的是精简后的。上一版在 `service.ts` 里从 effects 推写入引用的补丁删掉。
6. 收回预算：文档与注释改准为“估算 1/8，实际约 1/12–1/16”，系数不变；没有可收回的不再写重复记录，并有测试。
7. 分页续读的代次：带 `textPage` 的读取默认保留 `revisionEpoch`，读取工具说明改为“revisions 与 revisionEpoch 任一变化都重新从头读取”，有测试。
8. 过时写法：`outputContract.test.ts`、`persistedWebReplayRecovery.test.ts` 改为 `{ includeDetails: true }`；`piEngine.test.ts` 的注释改准（`service.ts` 每条消息发送前都会重新 configure，披露随之按会话记录重建）；`mcpWriteIntegration.test.ts` 已在原生 SQLite 运行器上跑过。
9. 证据说法：第三节改准；回放与估算脚本放进 `证据/payload-audit/`，`replay.sh` 一条命令复核，`simulate.py` 加保守口径。
- 另：通用读取层的“默认不读”属性见 B6 补。

类型检查：第一轮主进程 `tsc` 查出本次 `resultProjection.ts` 3 处类型错误，修后重跑 0 错误；渲染层 `tsc` 第一轮除这 3 处外，其余 3 处错误在录音录屏子代理的测试文件里。审查修改又动了 `src/core/application-control/reflection.ts`、`registry.ts`（两套工程都编译）和主进程分发器，所以本轮结束时两套各再跑了一次：主进程 `tsc -p tsconfig.electron.json` 0 错误，渲染层 `tsc -p tsconfig.json`（heavy.sh）0 错误。同一轮最终代码上 25 个相关测试文件 583 项通过，`check:application-control-coverage`、`check:persistence-compat`、`check:main-imports` 通过。
