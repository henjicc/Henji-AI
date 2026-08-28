# DeepSeek

> 核对时间：2026-08-26。信息来源见文末「原始链接索引」，均无需登录。

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
