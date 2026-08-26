# 智谱 GLM（BigModel / Z.ai）

> 核对时间：2026-08-26。信息来源见文末「原始链接索引」，均无需登录。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定） | `bigmodel` / `zhipu` |
| 对应项目 `adapter` | `openai`（Chat Completions）；`glm-5.3` 官方还提供 Responses 与 Anthropic 协议 |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | `glm-5.3`：**Responses API 优先** → Chat Completions 兜底（已实现）→ Anthropic **最低优先级**；`glm-5v-turbo`：仅 Chat Completions |
| 鉴权 | `Authorization: Bearer <API Key>` |
| 官方协议 | GLM-5.3：三协议并存（Chat Completions / Responses / Anthropic Messages）；GLM-5V-Turbo：仅 Chat Completions |

## 2. Base URL（按协议区分，GLM-5.3 独有）

| 协议 | Base URL |
|---|---|
| OpenAI Chat Completions | `https://open.bigmodel.cn/api/paas/v4` |
| OpenAI Responses | `https://open.bigmodel.cn/api/v1` |
| Anthropic Messages | `https://open.bigmodel.cn/api/anthropic` |

**已知限制**：订阅过 GLM Coding Plan（含已过期）的账号，官方文档写明"暂时只能通过 OpenAI Chat Completion 协议调用模型 API"——即同一个账号在不同协议上的可用性可能不同，不能假设"能建这个供应商就三协议都能用"。

GLM-5V-Turbo 的调用示例全部走 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，官方页面没有展示它的 Responses/Anthropic 端点。

## 3. 模型清单

| 模型 ID | 简介 | 输入 → 输出 | 上下文 / 最大输出 | 价格（元/百万 tokens） |
|---|---|---|---|---|
| `glm-5.3` | 智谱最新旗舰，与 GLM-5.2 同底座、后训练大幅加强复杂软件工程与 Agent 任务；也涌现出较强的漏洞发现/利用能力 | 文本 → 文本（**官方明确写"目前仅支持处理文本模态"**） | 1M / 128K | 输入 8；输出 28；缓存命中 2 |
| `glm-5v-turbo` | 智谱首个多模态 Coding 基座，面向"看图/看视频写代码"场景 | 文本、图片、视频、文件 → 文本 | 200K / 128K | 具体价格见 [pricing 页](https://open.bigmodel.cn/pricing)，官方模型页未直接列出档位表 |

`glm-5v-turbo` 官方明确写"**不支持同时理解文件、视频和图像**"——一次请求只能带其中一种媒体输入，不是"随便混着传"。

## 4. 思考模式

- GLM-5.3：**始终开启思考，无法关闭**。请求体要求同时传 `thinking: {"type": "enabled"}` 和顶层 `reasoning_effort`（`low`/`high`/`max`，默认 `max`）。从 GLM-5.2 迁移时如果旧代码传的是 `thinking.type: "disabled"`，必须先改成 `"enabled"` 否则请求直接失败，不是降级或忽略。
- GLM-5V-Turbo：思考模式可开可关（`thinking.type` 支持 `enabled`/未传即关闭），这点与 GLM-5.3 不同，不要按同一套 schema 处理。

## 5. 联网搜索——智谱有三套不同的搜索产品，接入前先分清楚

| 产品 | 调用方式 | 适用场景 |
|---|---|---|
| **Web Search API**（独立端点） | `POST /paas/v4/web_search`，与对话模型无关，单独调用拿结构化结果 | 只要检索结果，自己拼进 prompt |
| **对话中的网络搜索**（Chat Completions 工具） | 在 `tools` 里传 `{"type": "web_search", "web_search": {...}}`，嵌套对象带 `search_engine`/`count`/`search_prompt` 等 | 让模型直接结合搜索结果作答，本项目最可能用到这条 |
| **Search Agent**（Assistant API） | 走独立的 `assistant.conversation()`，query 拆解 + 多轮检索 | 更重的调研类场景，不是简单工具调用 |

"对话中的网络搜索"的工具 schema **明显不同于** OpenAI/DeepSeek 那种扁平的 `{"type": "web_search"}`——GLM 是嵌套对象：

```json
{
  "type": "web_search",
  "web_search": {
    "enable": "True",
    "search_engine": "search_pro",
    "search_result": "True",
    "search_prompt": "...",
    "count": "5",
    "search_domain_filter": "www.sohu.com",
    "search_recency_filter": "noLimit",
    "content_size": "high"
  }
}
```

四档搜索引擎价格：`search_std` ¥0.01/次、`search_pro` ¥0.03/次、`search_pro_sogou`/`search_pro_quark` ¥0.05/次。独立 Web Search API 和嵌入式工具用的是同一套引擎编码和价格。

## 6. 适配要点

- GLM-5.3 与 GLM-5V-Turbo 是两个独立模型页、独立能力边界，不要按"文本+视觉"合并成一张 schema——GLM-5.3 目前**没有**视觉输入能力，视觉场景必须切到 GLM-5V-Turbo。
- 官方 SDK 从 `zhipuai` 迁移到了 `zai-sdk`（新客户端类 `ZhipuAiClient`），文档里两套示例都还在，接入时用新包。
- 智谱同时提供 MCP Server 方式接入 Web Search（`https://open.bigmodel.cn/api/mcp-broker/proxy/web-search/mcp`），如果项目未来走 MCP 路线可以复用。

## 原始链接索引（均无需登录）

- [GLM-5.3 模型说明](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)（含三协议 Base URL 表）
- [GLM-5V-Turbo 模型说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5v-turbo)
- [Function Calling](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling)
- [联网搜索（三产品总览）](https://docs.bigmodel.cn/cn/guide/tools/web-search)
- [Web Search API 接口文档](https://docs.bigmodel.cn/api-reference/工具-api/网络搜索)
- [对话补全 API](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)
- [智谱模型价格](https://open.bigmodel.cn/pricing)
- [智谱文档全量索引](https://docs.bigmodel.cn/llms.txt)
