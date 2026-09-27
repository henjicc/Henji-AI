# 小米 MiMo

> 核对时间：2026-09-24。下方更新契约优先于历史记录；官方 Markdown 可公开读取，无需登录。

## 2026-09-24 模型与协议更新

官方模型 ID 为 `mimo-v2.6-pro`、`mimo-v2.6-flash`、`mimo-v2.6-pro-ultraspeed`；均支持文本/图片/音频/视频理解、思考、工具调用、结构化输出，上下文 1M、最大输出 131072 tokens。UltraSpeed 为需联系供应商开通的定制服务，仅登记能力，不加入默认推荐。旧 `mimo-v2.5-pro`、`mimo-v2.5` 于北京时间 2026-10-21 10:00 直接停用，不自动替换；SDK 保留旧 ID 的能力识别但新建预设使用 2.6，不能把旧 ID 作为新模型别名暗中重定向。

价格（普通按量、元/百万 tokens）：Pro 缓存命中 0.025、未命中输入 3、输出 6；Flash 分别 0.02、1、2；UltraSpeed 分别 0.25、30、60。不把 Batch 半价或活动优惠当作基础价格。

当前同时提供 `POST https://api.xiaomimimo.com/v1/chat/completions` 与 `POST https://api.xiaomimimo.com/v1/responses`；鉴权支持 `api-key` 或 Bearer。Chat 用 `thinking.type=enabled|disabled`（默认 enabled），输出限制 `max_completion_tokens`。Responses 用 `reasoning.effort`，none 关闭，其余合法档位均开启且不区分强度；输出限制 `max_output_tokens`。两协议思考开启时不能自定义 temperature/top_p（实际固定 1/0.95）；SDK 不下发无效采样值。Responses 不支持 background、previous_response_id、context_management；SDK 使用无服务端存储的完整历史请求。Chat 与 Responses 不混发私有思考字段。

### Responses 事件契约

官方仅提供字段表，未提供字面事件 JSON；fixture 必须标记为“依据官方字段表构造”。所有事件的 type 为对应事件名，sequence_number 为数字；下表列出的其余字段按官方字段表类型处理，官方未逐字段声明 required/nullable 的部分不补造保证。正常顺序 created → in_progress → 条目/片段 → completed 或 incomplete；重复、乱序、断线恢复和服务器取消接口未明确约定。SDK 不自动重放付费 POST，取消/断开释放流与 AbortSignal；没有有效最终输出不得视为成功。

| 事件 | 字段 | 下一状态/对外行为 |
|---|---|---|
| response.created | response 对象 | 建立响应；空输出合法，不是 final |
| response.in_progress | response 对象 | 继续等待，空输出合法 |
| response.output_item.added | item 对象、output_index 数字 | 建立 message/reasoning/function_call 条目 |
| response.output_item.done | item 对象、output_index 数字 | 条目完成；不结束整个响应 |
| response.content_part.added | part 对象、item_id 字符串、output_index/content_index 数字 | 建立内容片段 |
| response.content_part.done | 同 added | 片段完成；不重复输出已发 delta |
| response.output_text.delta | delta 字符串、item_id、output_index/content_index | 增量正文 |
| response.output_text.done | text 字符串、item_id、output_index/content_index | 正文完成 |
| response.function_call_arguments.delta | delta 字符串、item_id、output_index | 追加工具 JSON 参数 |
| response.function_call_arguments.done | arguments 字符串、item_id、output_index | 工具参数完成 |
| response.reasoning_text.delta | delta 字符串、item_id、output_index/content_index | 增量思考，与正文分离 |
| response.reasoning_text.done | text 字符串、item_id、output_index/content_index | 思考完成 |
| response.custom_tool_call_input.delta | delta 字符串、item_id、output_index | 自定义工具输入；当前 SDK 公共工具仅支持 function，不声明此能力 |
| response.custom_tool_call_input.done | input 字符串、item_id、output_index | 同上，不当成正文 |
| response.completed | response 对象（output/usage/status） | 成功终态；统计用量并释放流 |
| response.incomplete | response 对象（含 incomplete_details） | 截断终态，不伪报完整成功 |

### 本轮原始链接（均公开）

- 模型：https://mimo.mi.com/static/docs/quick-start/summary/model.md
- 下线：https://mimo.mi.com/static/docs/updates/deprecate.md
- 价格：https://mimo.mi.com/static/docs/price/pay-as-you-go.md
- Chat 字段：https://mimo.mi.com/static/docs/api/chat/openai-api.md
- Responses 字段及逐事件：https://mimo.mi.com/static/docs/api/chat/responses.md

## 历史资料（2026-08-26，协议与模型以本轮更新为准）

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定，代码中已存在） | `mimo` |
| 对应项目 `adapter` | `openai`（Chat Completions）；官方也提供 Anthropic Messages API |
| 官方协议 | OpenAI Chat Completions + **Anthropic Messages API**，**没有 Responses API** |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | 官方**没有** Responses API；Chat Completions 是唯一已实现且能用联网搜索的路径；Anthropic **最低优先级**，且接了也拿不到联网搜索（第 7 节） |
| 已知协议怪癖（代码里已实现） | 额外发送 `api-key` 认证头；请求体 `max_tokens` 要改名成 `max_completion_tokens`，见 `packages/ai-sdk/src/llm/providerProtocol.ts` |

## 2. Base URL

| 用法 | OpenAI 兼容 | Anthropic 兼容 |
|---|---|---|
| 按量计费 | `https://api.xiaomimimo.com/v1` | `https://api.xiaomimimo.com/anthropic` |
| Token Plan（订阅套餐） | `https://token-plan-cn.xiaomimimo.com/v1` | `https://token-plan-cn.xiaomimimo.com/anthropic` |

两种用法的 Base URL 和 API Key 都不同，Token Plan 走独立域名——如果项目未来要支持订阅制账号，不能简单复用按量计费的 Base URL。

## 3. 认证怪癖（已在代码里处理，供交叉核对）

官方文档给出的 Header 名是 `api-key`（不是 `Authorization: Bearer`）：

```
curl --header "api-key: $MIMO_API_KEY" ...
```

这与项目 `providerProtocol.ts` 里 `PROVIDER_EXTRA_AUTH_HEADERS: { mimo: 'api-key' }` 的注释描述完全一致——代码是**额外补发**这个头而不是替换 `Authorization`，因为通用 OpenAI 兼容实现默认发的是 Bearer，MiMo 网关只认它认识的那个头，两个头同时发是安全的。

## 4. 模型清单

| 模型 ID | 简介 | 输入 → 输出 | 上下文 / 最大输出 | RPM / TPM |
|---|---|---|---|---|
| `mimo-v2.5-pro` | 复杂推理、深度分析、长文档场景 | 文本 → 文本 | 1M / 128K | 100 / 10M |
| `mimo-v2.5` | 全模态理解，图片/音频/视频场景 | 文本、图片、音频、视频 → 文本 | 1M / 128K | — |

能力标签（官方模型列表页原文）：两个模型都标注支持 Deep Thinking、Streaming、Function Call、Structured Output、**Web Search**；`mimo-v2.5` 额外标注 Full-modal Understanding。

`mimo-v2-pro`/`mimo-v2-omni`/`mimo-v2-flash`/`mimo-v2-tts` 已于 2026-06-30 正式下线，不要再作为可选模型出现在任何清单里。

### 价格（国内，元/百万 tokens）

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|
| `mimo-v2.5-pro` | 0.025 | 3.00 | 6.00 |
| `mimo-v2.5` | 0.02 | 1.00 | 2.00 |

海外价格另有独立美元档（见原始链接），缓存写入限时免费。

## 5. `max_completion_tokens` 怪癖（已在代码里处理，供交叉核对）

官方 Quick Start 示例请求体直接用的就是 `max_completion_tokens`，不是通用 OpenAI 实现默认的 `max_tokens`。这与项目 `applyProviderRequestBodyQuirks` 的注释一致——实测发 `max_tokens` 时六项能力探测**全部返回 400 `Invalid request parameters`**，包括最基础的纯文本对话，说明这不是能力缺失，是请求字段本身不被接受。

## 6. 思考模式的多轮回传

思考模式下，`assistant` 消息会带 `reasoning_content` 字段（与 `content`/`tool_calls` 并列）。多轮工具调用场景，官方建议把历史轮次的 `reasoning_content` 也保留在 `messages` 里回传，以获得最佳效果——这点和 Kimi K3、GLM 的"必须回传完整 assistant message"是同一类要求，三家风格接近，可以复用同一套"assistant message 原样回传"逻辑，不用分别实现。

## 7. 联网搜索（需要先在控制台激活插件，且只支持 Chat Completions）

- **前置步骤**：控制台 → 插件管理，先激活 Web Search 插件，否则 API 侧声明了 `tools` 也不会生效。
- 声明方式（比 GLM 简单，扁平结构而非嵌套）：
  ```json
  {
    "type": "web_search",
    "max_keyword": 3,
    "force_search": true,
    "limit": 1,
    "user_location": { "type": "approximate", "country": "China", "region": "Hubei", "city": "Wuhan" }
  }
  ```
- **官方原文明确写"其他 API 协议暂不支持"**——即联网搜索只能走 OpenAI Chat Completions，Anthropic Messages 路径下不可用，即便两个模型基础对话都支持 Anthropic 协议。
- 响应里搜索来源以 `annotations: [{type:"url_citation", url, title, ...}]` 形式附在 `message` 里，usage 里会带 `web_search_usage: {tool_usage, page_usage}`。
- 有 5 分钟缓存期：刚开关搜索插件后 5 分钟内可能不会立即生效，排查"为什么没触发搜索"时先看这一条。
- 价格：国内 ¥16/1000 次、海外 $5/1000 次；一轮搜索按 `max_keyword` 并发展开多个关键词，会产生多次调用计费；网页内容本身按标准 token 单价计入 `prompt_tokens`。

## 原始链接索引（均无需登录，需浏览器渲染）

- [模型列表](https://mimo.mi.com/docs/quick-start/summary/model)
- [首次 API 调用（含 OpenAI/Anthropic 双协议示例）](https://mimo.mi.com/docs/quick-start/summary/first-api-call)
- [联网搜索](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/tool-calling/web-search)
- [按量计费价格](https://mimo.mi.com/docs/en-US/price/pay-as-you-go)
