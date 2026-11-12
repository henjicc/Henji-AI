# 结果：内置助手的上下文缓存与通用请求适配（DeepSeek 实测，2026-11-13）

按 11-13 收窄后的范围：只做所有助手（内置 Pi、换别的模型）都受益、与供应商无关的部分；DeepSeek 专项只调研、记进“以后再做”，不实现。未碰 git；未动开发版窗口；SDK 只改了文档，没有代码改动，不涉及发布。

## 一、现状（改动前）

- **运行时**：`electron/main/services/embedded-agent/`。主进程 `service.ts` 组装系统提示词（`SYSTEM_INSTRUCTIONS` + 技能目录 + 用户指令）、记忆与宿主上下文，在独立 utility 进程里跑 `piEngine.ts`（官方 `@earendil-works/pi-coding-agent` 1.4.0）。每条消息都会重新 `configure` 一次会话（会话文件不变）。
- **请求构建**：Pi 的 `openai-responses` 实现（`pi-ai/dist/api/openai-responses*.js`）。工具按 `toolDisclosure.ts` 渐进披露：首轮只给当前界面的基础工具，其余经 `load_application_tools` 按任务 / 领域 / 名称加载；Pi 按首次声明顺序发工具（已加载的位置不变，新加载的接在后面）。
- **宿主上下文**：每轮作为一条 `henji-context` 自定义消息追加在历史末尾（`hostContext.ts`），只差采集时间的快照不重复发；长文本与前文相同的用“同前文”缩写，只缩短新消息、不改已发送的历史。
- **历史压缩**：交给 Pi 自动压缩（预留 = 输出上限 + 8192）；`contextBudget.ts` 只在超窗时让出最旧的界面快照；单条超过窗口一半的工具结果在产生时转成摘录 + 续读引用。都不就地改写未超窗的历史。
- **附件**：本轮附件发原始字节，之后的轮次只留文字引用（`piAttachments.ts`）——之后第一次请求从该条消息起前缀会变一次，这是有意的取舍（不重复发送大图）。
- **用量**：Pi 已把 Chat 的 `prompt_cache_hit_tokens`、`prompt_tokens_details.cached_tokens`、Kimi 的 `cached_tokens` 与 Responses 的 `input_tokens_details.cached_tokens` 归一成 `cacheRead`；`piEngine` 每轮记 `model_completed`、每次运行记 `usage_summary`（含 `cacheHitRate`），助手追踪显示“缓存读取”。缺首字等待、思考 token 与费用。
- **DeepSeek 接入**（用户真实配置）：预设供应商 `deepseek`，官方端点 `https://api.deepseek.com`，模型 `deepseek-flash`（V4.1 Flash，图片可读），协议 Responses，思考开、强度“最高”，输出上限 32768（`AGENT_MIN_OUTPUT_TOKENS`），温度不传。
- **以前的缓存适配**：工具顺序稳定（新加载的接在后面，有测试 `expectStableToolOrder`）、宿主快照去重与“同前文”缩写、不按条截断历史工具结果（11-10 起交给 Pi）、Responses 统一 `store:false`。

## 二、官方要点

完整记录（含原始链接，2026-11-13 采集，均无需登录）已写进 `packages/ai-sdk/docs/llm-adaptation/供应商/DeepSeek.md` 顶部“2026-11-13 复核”一节。与助手最相关的几条：

- 缓存默认开启、不可控制（`prompt_cache_key` 被忽略）；按请求前缀命中，以“缓存前缀单元”整体匹配，单元落在每次请求的输入结束处与输出结束处、多次请求的公共前缀、长内容的固定间隔处；尽力而为，几小时到几天清空。[kv_cache](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)
- Responses 用量为 `input_tokens_details.cached_tokens` 与 `output_tokens_details.reasoning_tokens`。[create-response](https://api-docs.deepseek.com/zh-cn/api/create-response/)
- 图片只有 `deepseek-flash` 能读；Responses 中图片可放在 user/developer 消息与 `function_call_output` 的 output 里；单图 ≤32 MiB（data URL 计入 48 MiB 请求体）、单请求 ≤600 张、每张最多 1024 token。[vision](https://api-docs.deepseek.com/zh-cn/guides/vision)
- 思考：Responses `reasoning.effort` 取 none/low/high/max；带工具的多轮必须回传此前所有思考内容。[thinking_mode](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
- 错误码 400/401/402/422/429/500/503；并发按账号，超出 429。[error_codes](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes)、[rate_limit](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)

## 三、改了什么（都是通用改动）

1. **最高思考档不再被静默降级**（`modelOptions.ts`、`piEngine.ts`）：Pi 只在模型声明了 `thinkingLevelMap` 时才发 xhigh / max，否则降到 high。原来把“最高”映射成 xhigh 又不声明，结果**所有供应商**选“最高”实际都只发 high。现在只声明 xhigh、max 两档，取值按 SDK 已登记的供应商思考写法换算（`applyProviderReasoningRequestBody`，按端点的 `providerFamilyId` 查，与 SDK 两条请求路径一致）；低、中、高仍由 Pi 原样发送。没有登记写法、写法不是 `reasoning_effort`，或该模型落到 SDK 通用兜底（例如 MiniMax 非 Flash，公开文档未见强度字段）的不声明，保持降到 high。实测 DeepSeek 请求从 `reasoning.effort: "high"` 变为 `"max"`。
   - **供更新日志**：内置助手现在发出该供应商支持的最高档。Kimi、智谱等预设的默认档本来就是最高，更新后内置助手对这些供应商会从 high 变为最高，费用与延迟上升。
2. **用量与可观察性**（`piEngine.ts`、`contracts.ts`、`piTrace.ts`、`assistantChain.ts`）：
   - 每轮 `embedded_agent.turn.model_completed.metrics` 新增 `cacheHitRate`、`reasoning`（思考 token）、`firstTokenMs`（请求发出到第一个流式增量）、`cost` / `costCurrency`。
   - 每次运行 `usage_summary.summary` 新增 `reasoning`、`firstTokenMsAverage`、`firstTokenMsMax`、`cost`、`costCurrency`。
   - 费用按用户自填单价，否则按供应商预设的刊例价顶层（分时计价取高峰价），所以是**估算**，不是账单；Pi 本来就按注册单价算 `usage.cost`，原来没有单价所以一直是 0。
   - 助手追踪的思考 token 改为真实值；`logs:query --chain` 报告开头多一行“用量：N 次请求 · 输入（缓存命中 x%）· 输出 · 首字平均 · 估算费用”，每轮一行带命中率与首字等待。
   - 加载工具说明里的领域按名称排序，与每个领域内的工具名同样稳定。
3. **按名精确加载工具**（`toolDisclosure.ts`）：`load_application_tools` 的说明里列出各领域的工具名，并提示只需要几个工具时用 `names` 一次列齐、不要为一两个工具加载整个领域。原因见第四节：整领域加载剪辑是 90 个工具、约 35 万字节（约 10 万 token），工具定义排在历史之前，一加载此前对话就全部按未命中重算，并且之后每次请求都带着它。
4. **测试**（`piEngine.test.ts`）：
   - Chat 路径：同样输入新开对话，首个请求的工具与消息逐字节一致；同一对话里工具往返与跨轮（中间重新 configure、宿主快照只差采集时间）每个请求都是上一个请求的严格前缀扩展，工具数组不变，易变的宿主快照只出现一次且在末尾。
   - 正式的 Responses 路径，用完整应用工具目录：中途按名加载一个剪辑工具后，输入只在末尾追加，新工具接在原有工具之后，原有部分逐字节不变；加载工具的说明里含各领域工具名；新开对话做同样的事，首个请求逐字节一致。为此测试替身的 Responses 分支补了函数调用往返。
   - 选“低”时仍发 `low`；选“最高”时发 `max`；Kimi K3 声明 `{ xhigh: high, max: max }`，MiniMax 非 Flash 与未登记供应商不声明。
   - 原有用量测试补上新字段（命中率、思考 token、首字等待）。Chat 的 `prompt_cache_hit_tokens` 与 Responses 的 `cached_tokens` 归一由原有两条用例覆盖。

验证：`piEngine.test.ts`（38 项）、`assistantChain.test.ts`、SDK `providerReasoningRequest.test.ts` 通过；改动文件 eslint 通过；`tsc -p tsconfig.electron.json` 0 错误（审查修正后重跑）。渲染层 `tsc -p tsconfig.json` 0 错误是在收窄范围与审查修正之前跑的，之后渲染层只改了 `assistantChain.ts` 的一处文案，没有再跑。独立审查一轮：1 条重要、4 条小问题已全部按意见修改，没有不修的。第三节实测是审查修正之前的代码：修正只影响“低”档和未登记供应商，DeepSeek 选“最高”时请求不变。

## 四、缓存命中：问题在哪、改前改后

### 1. 逐处核对前缀稳定性（结论：除工具加载外都已稳定）

| 检查点 | 结论 |
|---|---|
| 系统提示词里的时间戳、随机 ID、每轮变化内容 | 无。Pi 的系统提示只有我们的设定 + 固定的 `<cwd>`（助手资料目录）；记忆、宿主上下文、选区 ID、附件标记都在每轮末尾的消息里 |
| 每条消息重新 configure 会话 | 不改写历史，也不重复系统设定（新测试与原测试覆盖） |
| 工具定义顺序与序列化 | 同一组工具逐字节一致；新加载的接在后面 |
| 宿主快照 | 只差采集时间的不重发；“同前文”缩写只作用于新消息 |
| 历史压缩 | Pi 自动压缩只在接近窗口时发生；本地只在超窗时让出最旧快照，不就地改写 |
| 多轮工具调用的思考内容 | Pi 把 `reasoning` 项按原文回传（`reasoning_text`），符合官方要求 |
| 附件 | 本轮发字节、之后只发文字引用，之后第一次请求从该消息起会变一次（有意取舍，见第七节） |

实测跨对话复用也成立：同一句任务第二次新开对话，首个请求命中 97.4%（第一次 0–17% 是冷缓存）。

### 2. 真正的大头：中途加载工具让此前的历史全部失效

改前日志里，**75%–92% 的未命中都出在 `load_application_tools` 之后的那一次请求**。DeepSeek 把工具定义放在历史之前，工具数组一变，后面的整段历史都按未命中重算；而模型习惯整领域加载，剪辑领域 90 个工具约 35 万字节，加载后每次请求还要多带约 10 万 token。例：改前 T3 第 2 次请求 11.3 万 token 只命中 6272；改后① 的 T2 第 10 次请求只多加载 2 个工具，命中从 99% 跌到 30%（5.1 万 token 未命中）。

改法是第三节第 3 条：让模型知道每个领域有哪些工具，按名一次加载需要的几个。

### 3. 改前改后对比（真实 Pi + deepseek-flash 官方端点，只读任务）

任务 T1：读取当前应用上下文并列出“性能验收-剪辑 11-12”的文档；T1f：同一对话续聊，打开“多轨4K”读出序列、时长与轨道（会加载剪辑工具）。“改前”用 02:15 的旧产物；“改后①”含第 1、2 条但还没有第 3 条；“改后②”是最终代码。费用按闲时刊例价（运行都在北京时间工作日 07:00–08:00，属闲时）。

| 运行 | 请求数 | 输入合计 | 未命中 | 命中率 | 加载那一步：工具数 / 未命中 | 首字平均 | 费用 |
|---|---|---|---|---|---|---|---|
| 改前 T1（3 遍） | 3–4 | 3.6–5.0 万 | 0.2–1.5 万 | 59%（冷）/ 95% / 83% | 8→19 / 0.5–0.8 万 | 未记录 | ¥0.006–0.017 |
| 改后② T1（3 遍） | 4 | 4.7 万 | 0.25–1.1 万 | 77%（冷）/ 95% / 95% | 8→11 / 0.03–0.3 万 | 0.47–0.72 秒 | ¥0.005–0.014 |
| 改前 T1f | 6 | 61 万 | 11.4 万 | 81.5% | 21→111 / **10.4 万** | 未记录 | ¥0.132 |
| 改后① T1f | 9 | 103 万 | 12.0 万 | 88.3% | 19→109 / **10.9 万** | 0.96 秒 | ¥0.150 |
| 改后② T1f 第 1 遍 | 10 | 65 万 | 8.6 万 | 86.7% | 11→13 / **0.66 万** | 0.91 秒 | ¥0.112 |
| 改后② T1f 第 2 遍 | 10 | 23 万 | 2.1 万 | 90.6% | 11→13 / **0.30 万** | 0.47 秒 | ¥0.042 |
| 改后② T1f 第 3 遍 | 8 | 46 万 | 7.3 万 | 84.1% | 11→13 / **0.31 万** | 0.71 秒 | ¥0.090 |

- 加载那一步的未命中从约 10.4–10.9 万 token 降到 0.3–0.7 万；加载后每次请求的长度从 12–13 万 token 降到 1.5–10 万（之后的增长来自模型读回的大结果，例如第 1 遍一次读了 23 万字节的实体详情，这部分是新内容，本来就不可能命中）。
- 整次运行命中率在 84%–91% 之间波动，波动来源是模型每遍读回的内容不同，不是前缀不稳；同一遍内没有加载的请求命中 97%–99.7%。
- 首字等待：命中良好的请求约 0.3–0.9 秒；一次性未命中 10 万 token 的那一步约 1.7 秒。
- 只读任务答案前后一致（1 条序列、3840×2160 59.94fps、899 帧约 15 秒、视频轨 12 条、音频轨 1 条）。

另外两组改前任务各跑了一遍，作为同类现象的佐证，不做改后对比：T2（读“长录测试”口播线索清单并说明处理打算）命中 89.8%，¥0.035；T3（观察剪辑成片画面）命中 96.2%，¥0.276。

### 4. “最高”思考档的代价

用户设置是“最高”，此前实际一直只发 high。改后按设置发 max：T2 同一任务输出从 2069 token 涨到 19950（其中思考 16070），单次费用从 ¥0.035 涨到 ¥0.257；T1f 输出从 1.9k 涨到 2.4–4.3k。这是用户选择本来就该有的效果；如果嫌贵，把设置改成“高”即可回到原来的消耗。

## 五、视觉与其他能力核对

- **图片请求格式**：工具结果里的图片由 Pi 放进 `function_call_output.output` 的 `input_image`（data URL，`detail: auto`），与官方 Responses 写法一致；图片放在 user 消息的附件也一致。单图上限 16 MiB（宿主）低于官方 32 MiB。
- **不支持图片的模型**：已有退路，不会静默丢图——`read_application_media` 直接回复“当前模型不支持图片理解……不要声称已看到图片”；讲解历史画面返回“需要切换支持图片的模型”；历史附件写明“当前模型无法读取这份附件”。均有原测试覆盖。Pi 自身在模型声明不支持图片时会把图片换成“(see attached image)”文字，但我们的工具在这之前已经返回文字，不会走到那一步。
- **本次没能端到端看到画面**：无窗口的 `assistant:cli` 里剪辑取帧报 `importExternalTexture ... Failed to import texture from video`（隐藏窗口的 GPU 视频导入失败，与模型无关；助手如实说明没看到画面，没有编造）。整窗截图 `observe_application_surface` 在内置助手和 MCP 目录里都没有（见第七节原有问题），助手回答“没有截屏能力”并改用状态数据描述。
- **思考 / 工具调用 / 输出上限**：多轮工具调用的思考内容按要求回传；Pi 按顺序执行工具（官方并行调用总开启，不影响正确性）；输出上限 32768 计入思考 token，max 档下长任务有截断风险，日志里能看到 `stopReason: length`，本次未出现。
- **错误码**：`src/core/assistant/assistantErrorPresentation.ts` 已把 402 余额不足、401、403、429、上下文超长、超时、网络、5xx 转成可操作的中文提示，DeepSeek 的错误码都落在这些分支里（422 落到通用提示）。

## 六、实测花费

全部运行共 20 次（含被中途停掉的 1 次），按闲时刊例价合计约 **¥1.45**（从统一日志的每轮用量逐条累加，没有高峰时段的运行）。没有生成类付费调用，没有修改用户作品；T3 改前那次助手为触发解码挪过一次测试工程的播放头并自己撤销了。

## 七、驱动内置助手的途径（回答用户的问题）

现有途径：

1. **`npm run assistant:cli`**：无窗口独立进程，复用正式服务与真实资料目录，`--thread` 可续聊，结束输出 `runId`，再用 `npm run logs:query -- --chain <runId>` 读完整链路（本次起开头一行就是缓存命中、首字等待与参考费用）。限制：要求 `out/` 是新产物，而开发版运行时 `electron:bundle` 会拒绝改写 `out/`；隐藏窗口里取视频帧失败。本次的绕法：用临时配置把同一份构建写到 `out-cli/`，再用一个只含 `package.json`（同名 `henji-ai`、`main` 指向 `out-cli`）的目录启动 Electron，工作目录仍是仓库根，资料与密钥照常可用；用完已删除。
2. **开发版 + CDP**：以 `HENJI_ELECTRON_REMOTE_DEBUGGING_PORT=9333` 启动的开发版，可经 CDP 在渲染层调用 `window.henjiNative.embeddedAgent.prompt / snapshot / onSnapshot`，用 `clientMessageId` 作 runId 再查日志（`scripts/real-request-acceptance.cjs` 已用这种连接方式）。要自己拼宿主上下文，而且当前运行的开发版不一定带调试端口。
3. **MCP**：目前**没有**向内置助手发消息、读取其回复或追踪的工具；外部助手经 MCP 是自己直接操作应用，不经过内置助手。

最小补法（只给方案，不实现）：在应用能力里加一个外部可用的 `ask_builtin_assistant`（输入：文字、可选 `sessionId`、`wait`；在主进程调用 `EmbeddedAgentService.prompt`，宿主上下文用 CLI 已有的 `buildEmbeddedPromptContext(host.getContext())`；输出 `runId`、`sessionId`、状态与最终回复），再给 `assistant.run` 一个只读实体或在结果里附 `formatAssistantChainReport` 的摘要行。走现有能力声明与 MCP 投影，不新增协议通道；付费仍按内置助手的付费策略。工作量约 1–1.5 天（能力声明、主进程执行器、长任务等待与取消、契约与结果测试）。

## 八、没做的、风险与原有问题

**以后再做（DeepSeek 专项，只调研未实现，详见 `DeepSeek.md` 顶部“以后再做”）**：
- Pi 对推理模型把系统设定发成 `developer` 角色，DeepSeek 按 user 处理；宜对该端点声明 `supportsDeveloperRole: false` 改发 system（实测改发会让已有缓存失效一次）。
- SDK Chat 思考映射仍是 high / max 两档，官方已是 low / high / max（medium、xhigh 归 high）。
- DeepSeek 支持对话中途插入 system 消息，可声明 `supportsMidConvoSystemMessages`，系统设定或技能目录变化时追加而不是改写首条（现在一变就整段失效，频率很低）。
- 48 MiB 请求体上限低于宿主 128 MiB 附件预算；422 没有专门提示。

**通用方向的后续建议（未做）**：
- 跨界面切换时 `prepareContext` 会去掉上一界面的工具，工具数组一变整段历史失效；这是“跨界面不携带旧工具”的既定取舍，若要更高命中率可改成对话内只增不减，代价是工具变多。
- 按名加载会让模型可能分几次加载，每次都要重算一次历史；本次三遍都只加载一次，长对话里的表现还需观察。
- 附件之后只发引用：附件那条之后的第一次请求会变一次前缀；若改成一直保留图片，命中更稳、模型也能继续看图，但对不做缓存的供应商成本更高。

**风险**：
- 用户设置“最高”后思考 token 明显变多（见第四节），费用与耗时上升属于设置生效。
- 日志里的费用是按刊例价顶层（高峰价）算的参考上限，闲时实际约为一半。
- 改后②与改前的工具数组不同，首次使用新说明的那一轮对已有缓存是一次冷启动。

**原有问题（不是本次引入，未改）**：
- `observe_application_surface` 声明为 `external.kind: internal`，理由还是旧的“C2 内容不开放无差别截图”，结果内置助手的工具目录里也没有它，助手无法截整窗；与 `assistant-capability.md`“整窗观察任何时候都可用”及安全分级放开的方向不符，建议单独处理。
- 无窗口 CLI 里剪辑取帧的 GPU 视频导入失败，凡是依赖取帧的助手验收都没法用 CLI 做。

## 九、改动文件

- `electron/main/services/embedded-agent/modelOptions.ts`、`piEngine.ts`、`contracts.ts`、`piTrace.ts`、`toolDisclosure.ts`、`piEngine.test.ts`
- `src/core/assistant/assistantChain.ts`
- `packages/ai-sdk/docs/llm-adaptation/供应商/DeepSeek.md`、`packages/ai-sdk/docs/llm-adaptation/README.md`（只改文档）
- `docs/rules/assistant-status.md`（台账一条）
