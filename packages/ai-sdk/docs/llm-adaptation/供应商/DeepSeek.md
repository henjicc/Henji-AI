# DeepSeek

> 核对时间：2026-11-14。以中文官方文档为准，英文页面尚有更新滞后。

## 2026-11-13 复核：内置助手相关要点（覆盖下方旧资料中冲突的部分）

采集来源（均无需登录，2026-11-13 读取）：[上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)、[图片理解](https://api-docs.deepseek.com/zh-cn/guides/vision)、[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)、[工具调用](https://api-docs.deepseek.com/zh-cn/guides/tool_calls)、[Responses API 指南](https://api-docs.deepseek.com/zh-cn/guides/responses_api)、[Responses API 参考](https://api-docs.deepseek.com/zh-cn/api/create-response/)、[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)、[错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes)、[限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)。

**模型与价格**：`deepseek-flash`（DeepSeek-V4.1-Flash-1017，唯一支持图片）与 `deepseek-v4-pro`（V4-Pro-0813，无图片）；均 1M 上下文、最大输出 384K，支持 JSON 输出、工具调用、Responses、Anthropic、对话前缀续写（Beta），FIM 仅非思考模式。Flash 元/百万 token（闲时 / 高峰）：缓存命中 0.02 / 0.04，未命中 1 / 2，输出 4 / 8；Pro 0.15 / 0.30、4.5 / 9、13.5 / 27。高峰为北京时间周一至周五（不含法定节假日）9:00–12:00、14:00–18:00。旧名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 已下线并按 Flash 计费。

**上下文缓存**（对助手成本影响最大）：
- 默认对所有用户开启，无需参数；`prompt_cache_key` / `prompt_cache_retention` 在 Responses 中被忽略，缓存不可人为控制。
- 按**请求前缀**命中，且以“缓存前缀单元”为整体匹配，部分匹配不算（受 Sliding Window Attention 影响）。单元在三处落盘：每次请求的用户输入结束处与模型输出结束处、系统检测到的多次请求公共前缀、长输入/长输出按固定 token 间隔截取（间隔未公布）。
- 落盘为秒级，尽力而为不保证命中；不再使用后几小时到几天清空。
- 用量字段：Chat Completions 为 `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；Responses 为 `usage.input_tokens_details.cached_tokens`（`input_tokens` 含命中部分），另有 `output_tokens_details.reasoning_tokens`。
- 官方页未说明 tools 定义在前缀中的位置。2026-11-13 实测（见 `tickets/46-正式使用链路/result-助手DeepSeek适配.md`）：对话中途加载工具后，命中只剩系统设定和最初那批工具，此后的历史全部按未命中重算，说明工具定义位于历史消息之前。

**思考模式**：默认开启、默认 high。OpenAI 格式 Chat 用 `thinking: {type}` + `reasoning_effort`；Responses 用 `reasoning.effort`，取值 `none`（关闭）/`low`/`high`/`max`，`minimal`→low，`medium`、`xhigh`→high，`ultra`→max。思考时 temperature、presence/frequency penalty 无效（不报错）；Flash 的 top_p 仅思考时生效且下限 0.95。Chat 带 tools 的多轮必须回传此前所有轮的 `reasoning_content`（含未调用工具的轮），缺失返回 400；Responses 的 `reasoning` 输入项以 `reasoning_text` 并入相邻 assistant 消息，`summary` 与 `encrypted_content` 不支持。`max_output_tokens` 计入可见输出与思考 token，页面未给默认值。

**角色**：Responses 的 `instructions` 作为首条 system；消息角色 `developer` **按 user 处理**。系统设定应使用 `system` 角色或 `instructions`。Responses 与 Anthropic 接口支持在对话中间插入 system 与工具调用消息；Chat 只支持插入 system。

**工具调用**：Responses 并行工具调用始终开启（`parallel_tool_calls` 被忽略）；`tool_choice` 为 none / auto / required / 指定函数；函数名 ≤128 字符、`^[a-zA-Z0-9_-]+$`、不可重名；`web_search` 仅 `deepseek-v4-pro`，Flash 忽略。strict 模式只在 `https://api.deepseek.com/beta`，要求所有属性 required、`additionalProperties:false`，不支持 minLength/maxLength/minItems/maxItems。不支持的顶层参数静默忽略，唯一例外是输入超出上下文窗口返回 400。

**图片**：仅 `deepseek-flash` 处理；Chat、Responses、Anthropic 均可。Base64 data URL（计入 48 MiB 请求体）、公网 URL（≤8192 字符、≤32 MiB、60 秒内可下载）或 Files API `file_id`（≤64 MiB）。JPEG/PNG/GIF/WebP，按内容判格式；单请求最多 600 张，不含 file_id 时总 ≤64 MiB；单边 ≤8192 像素，15 张及以上时 ≤4096。Chat 中图片只能在 user 消息；Responses 可在 user/developer 消息与 `function_call_output`/`custom_tool_call_output` 的 output 中，system/assistant 中返回 400。`detail`：low 缩到 512×512，high/original/auto 保留原图。计费：小于约 544×544 放大、大于约 1300×1300 缩小，每张最多 1024 token。

**错误与限速**：400 格式错误、401 认证失败、402 余额不足、422 参数错误、429 速率或并发达到上限、500 服务器故障、503 服务器繁忙。并发按账号计（Flash 2500、Pro 500），超出返回 429；等待期间流式持续返回 `: keep-alive` 注释，10 分钟仍未开始推理即断开。

**本项目落点**（2026-11-13，只做了与供应商无关的部分）：内置助手经 Pi 走 Responses；“最高”思考档按 SDK 已登记的供应商写法发出（此前 Pi 未声明 xhigh / max 档位，对所有供应商都静默降为 high）；每轮与每次运行的缓存命中、首字等待、思考 token 与参考费用进入 `embedded_agent.turn.model_completed` / `usage_summary` 日志与助手追踪。

**2026-11-14 已完成**：助手对 DeepSeek 声明 `supportsDeveloperRole: false` 改发 system（官方 Responses 参考：developer 在 deepseek-flash 上视同 system、在 deepseek-v4-pro 上视同 user），并声明 `supportsMidConvoSystemMessages`；SDK Chat 思考档位改为官方映射 low / high / max；Responses 下改发 `reasoning.effort`（none 关闭），此前发的 Chat 字段被静默忽略，思考关不掉。

**仍未处理**：48 MiB 请求体上限低于宿主现有的 128 MiB 附件预算；422 参数错误尚无专门提示。

## 2026-09-24 复核（含 2026-09-11 更新）（覆盖下方历史资料中的旧模型和能力说明）

- 官方默认与预设唯一推荐模型改为 `deepseek-flash`（DeepSeek V4.1 Flash），原生文本、图片输入，1M 上下文、384K 最大输出。Chat Completions 和 Responses 均支持图片；项目继续默认 Responses。
- 旧 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 已由官方转发到新版。2026-09-24 官方价格页重新列出独立的 `deepseek-v4-pro`（V4-Pro-0813，无视觉），不再据旧公告声称其必然转发到 Flash。项目不再推荐这些旧名字，也不把聚合供应商的旧 ID 当作新版别名。
- Pro-0813 最新人民币/百万 token 闲时 / 高峰：缓存命中 0.15 / 0.30、输入 4.5 / 9、输出 13.5 / 27；高峰不含中国法定节假日。目录保留独立 Pro ID 与无视觉能力，默认推荐仍为 Flash。
- 新版价格（人民币/百万 token，闲时 / 工作日高峰）：缓存命中输入 0.02 / 0.04，未命中输入 1 / 2，输出 4 / 8。高峰为北京时间工作日 09:00–12:00、14:00–18:00。
- 思考默认开启，默认 high；正式档位 low/high/max，兼容 minimal→low、medium/xhigh→high、ultra→max。Responses 用 reasoning.effort，none 关闭。思考时 temperature 无效，top_p 生效但下限 0.95；非思考 top_p 固定 1。
- Responses 为无状态 API，必须回传完整历史；text.format 支持 json_schema。当前仅支持 function 工具，内置工具会被忽略，不能再据旧资料宣称 web_search 可用。SDK 本次只更新目录与默认选型，不新增内置工具或协议分支。
- 图片支持 JPEG/PNG/GIF/WebP；请求体最多 48 MiB，单图内联/URL 32 MiB，file_id 64 MiB，最多 600 张；总大小不含 file_id 64 MiB、包含时 200 MiB。Chat 图片仅 user；Responses 支持 user/developer 和工具结果，system/assistant 图片返回 400。SDK 沿用已实现的 URL/内联图片通道，不新增 Files 上传能力。
- 官方来源：[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[图片理解](https://api-docs.deepseek.com/zh-cn/guides/vision/)、[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)、[Responses API](https://api-docs.deepseek.com/zh-cn/api/create-response/)。

以下为 2026-08-26 历史采集记录；冲突字段以本节为准。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定） | `deepseek` |
| 对应项目 `adapter` | `deepseek`（已实现；思考参数映射见 `packages/ai-sdk/src/llm/providerReasoningRequest.ts`，认证与请求体怪癖见 `packages/ai-sdk/src/llm/providerProtocol.ts`） |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | **Responses API 已实现并作为直连默认** → Chat Completions 兜底；Anthropic 暂不实现、不显示 |
| 鉴权 | `Authorization: Bearer <DEEPSEEK_API_KEY>` |
| 官方协议 | OpenAI Chat Completions、OpenAI Responses API、**Anthropic Messages API** 三选一，同一 Base URL 域名 |
| 项目当前实际协议 | 直连预制模型自动使用 Responses；Chat Completions 保留为兼容路径 |

## 2. Base URL

| 协议 | Base URL |
|---|---|
| OpenAI 格式（Chat Completions / Responses） | `https://api.deepseek.com` |
| Anthropic 格式（Messages API） | `https://api.deepseek.com/anthropic` |

三种协议共用同一域名，只是路径不同：`/chat/completions`、`/responses`、`/anthropic/v1/messages`。

## 3. 协议现状

| 协议 | 官方支持 | 备注 |
|---|---|---|
| Chat Completions | ✅ | SDK 兼容路径 |
| Responses API | ✅ | SDK 直连默认；`client.responses.create(model=..., input=...)`，见第 6 节 |
| Anthropic Messages API | ✅ | 把 Claude 模型名映射到 DeepSeek 模型（`claude-opus-*` → `deepseek-v4-pro`；`claude-haiku-*`/`claude-sonnet-*` → `deepseek-v4-flash`），可以不改代码直接把现有 Anthropic 客户端指过来 |

三种协议**同一批新模型会同步支持**，官方没有"新模型先上 Chat 后补 Responses"的滞后期。

## 4. 模型清单

官方用稳定别名指向最新快照，调用时直接用别名即可，无需关心具体快照号：

| 模型别名 | 当前快照 | 简介 | 输入 → 输出 | 上下文 / 最大输出 | 并发上限 |
|---|---|---|---|---|---|
| `deepseek-v4-flash` | DeepSeek-V4-Flash-0731 | 高性价比、低延迟 | 文本 → 文本 | 1M / 384K | 2500 |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 高能力，复杂推理与长任务 | 文本 → 文本 | 1M / 384K | 500 |
| `deepseek-v4-flash-vision-exp` | — | **实验性视觉模型**，在 Flash 基础上加图片输入 | 文本、图片 → 文本 | 1M / 384K | 2500 |

`deepseek-v4-flash-vision-exp` 不在此前整理的清单里，是新发现——它是唯一支持图片输入的 DeepSeek 模型，且**只能通过 Responses API 调用**（`input_image` 内容块），Chat Completions 路径下这个模型不接受图片。

### 价格（元/百万 tokens，闲时/高峰各半，高峰为北京时间 09:00–12:00、14:00–18:00 工作日）

| 模型 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|---|---|---|---|
| `deepseek-v4-flash` | 闲时 0.05 / 高峰 0.10 | 闲时 1.5 / 高峰 3 | 闲时 4.5 / 高峰 9 |
| `deepseek-v4-pro` | 闲时 0.15 / 高峰 0.30 | 闲时 4.5 / 高峰 9 | 闲时 13.5 / 高峰 27 |
| `deepseek-v4-flash-vision-exp` | 同 flash | 同 flash | 同 flash |

## 5. 思考模式

- 请求体同时传 `thinking: {"type": "enabled"}` 和顶层 `reasoning_effort`；官方两个字段都要求（示例见 curl）。`reasoning_effort` 取值与思考强度的对应关系官方未列举离散档位，直接透传字符串即可。
- 思考模式下 `temperature`、`top_p` 无效——传了也不报错，但不生效，UI 应避免让用户误以为调节生效。

## 6. Responses API 适配要点（比 Chat Completions 复杂得多，接入前必读）

`client.responses.create(model=..., input=..., instructions=...)`：

- `input` 可以是字符串或 `input_text`/`input_image` 内容块数组；`instructions` 相当于插入一条首位 system 消息。
- **不支持** `previous_response_id`、`conversation`、`store`（响应恒为 `store: false`）——**是无状态 API**，不要按 OpenAI 官方 Responses API 的"自动多轮托管"心智去设计，每次都要自己拼完整历史。
- `tools` 只支持 `function` 与 `web_search`/`web_search_2025_08_26`，其余内置工具类型（`file_search`/`code_interpreter`/`computer_use`/`mcp`）会被**静默忽略**，不报错。
- `web_search` 由服务端执行，`search_context_size`/`user_location` 参数会被忽略，服务端自动续搜最多 10 轮。**Chat Completions 完全不支持这个工具**——DeepSeek 官方 `guides/tool_calls` 文档里没有出现过 `web_search`，要联网搜索必须走 Responses API。
- 未知/不支持的顶层参数一律静默忽略而不报错，意味着"参数传了但没生效"这类 bug 不会在 DeepSeek 侧报错，需要自己校验响应内容。

## 7. Anthropic Messages API 适配要点（最低优先级，仅供顺手接入时参考）

- 沿用 Anthropic 官方字段名（`system`、`messages[].content[].type=text/image/tool_use/tool_result` 等），`thinking` 支持但 `budget_tokens` 被忽略。
- `output_config.effort` 是 DeepSeek 侧唯一生效的思考强度字段，其余 Anthropic 原生参数（`top_k`、`cache_control`、`disable_parallel_tool_use` 等）大多被忽略。
- 项目设置页不显示 Anthropic：它没有运行时实现，存量伪配置会归一化成 OpenAI Chat。官方能力只留作未来资料，不让用户面对无效协议选项。

## 8. 视觉输入限制（`deepseek-v4-flash-vision-exp`）

- 单张内联图片 ≤ 32 MiB，`file_id` 图片 ≤ 64 MiB；不含 `file_id` 时总大小 ≤ 64 MiB，含则 ≤ 200 MiB；单请求最多 600 张图。
- 图片只能出现在 `user`/`developer` 消息里，出现在 `system`/`assistant` 消息会直接返回 400。
- 非视觉模型收到 `input_image` 不会报错，而是被替换成占位文本——容易造成"没报错但模型看不到图"的静默失效。

## 原始链接索引（均无需登录）

- [Your First API Call](https://api-docs.deepseek.com/quick_start/pricing)（含 base_url/模型 ID/思考请求示例）
- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Using the Responses API](https://api-docs.deepseek.com/guides/responses_api)
- [Using the Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api)
- [Reasoning Model（思考模式）](https://api-docs.deepseek.com/guides/reasoning_model)
- [Function Calling](https://api-docs.deepseek.com/guides/tool_calls)
- [Vision（视觉输入限制）](https://api-docs.deepseek.com/guides/vision)
- [API sitemap](https://api-docs.deepseek.com/sitemap.xml)（用于核对页面是否存在，避免中文 `/zh-cn/` 前缀 404 后静默 fallback 到错误页面）

## 2026-10-12 原厂旧 Flash 别名

原厂 deepseek-v4-flash / deepseek-v4-flash-vision-exp 实体下线，调用旧名重定向到 deepseek-flash（V4.1 Flash）；两别名均支持图片及 Chat/Responses，仅原厂匹配覆盖。旧 ID 移出原厂推荐；硅基流动等网关旧名继续按其独立目录，不继承新视觉能力。来源：[原厂模型价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（公开无需登录）。
