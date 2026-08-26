# 小米 MiMo

> 核对时间：2026-08-26。信息来源见文末「原始链接索引」，均无需登录（文档站是 SPA，curl 拿不到正文，用浏览器渲染后取 `innerText`，见采集手册）。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定，代码中已存在） | `mimo` |
| 对应项目 `adapter` | `openai`（Chat Completions）；官方也提供 Anthropic Messages API |
| 官方协议 | OpenAI Chat Completions + **Anthropic Messages API**，**没有 Responses API** |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | 官方**没有** Responses API；Chat Completions 是唯一已实现且能用联网搜索的路径；Anthropic **最低优先级**，且接了也拿不到联网搜索（第 7 节） |
| 已知协议怪癖（代码里已实现） | 额外发送 `api-key` 认证头；请求体 `max_tokens` 要改名成 `max_completion_tokens`，见 `src/core/llm/providerProtocol.ts` |

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
