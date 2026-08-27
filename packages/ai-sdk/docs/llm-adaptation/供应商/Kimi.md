# Kimi（Moonshot）

> 核对时间：2026-08-26。信息来源见文末「原始链接索引」，均无需登录。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定） | `kimi` / `moonshot` |
| 对应项目 `adapter` | `openai`（Chat Completions 兼容） |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | 官方**没有** Responses API 也**没有** Anthropic Messages API，Chat Completions 是唯一路径，已实现，无需再排优先级 |
| 鉴权 | `Authorization: Bearer $MOONSHOT_API_KEY` |
| Base URL | `https://api.moonshot.cn/v1`（文档站已迁移到 `platform.kimi.com`，但**接口域名仍是 moonshot.cn**，不要混淆两个域名） |
| 官方协议 | 仅 OpenAI Chat Completions，**没有 Responses API** |

## 2. 协议现状

Kimi 官方文档全文没有出现过 `responses.create`；`platform.kimi.com/docs/llms.txt` 索引里也没有 Responses API 页面。三个消费方（助手、画布文本节点、提示词优化）走本项目现有的 `openai-compatible` 协议即可完整覆盖 Kimi，**不需要等 Responses API 适配器**。

## 3. 模型

| 模型 ID | 简介 | 输入 → 输出 | 上下文 | 最大输出 |
|---|---|---|---|---|
| `kimi-k3` | 当前旗舰，2.8 万亿参数，KDA 混合线性注意力，全球首个开源 3 万亿级模型 | 文本、图片、视频 → 文本 | 1,048,576 tokens（1M） | 默认 131,072，最大可设 1,048,576 |

价格（元/百万 tokens）：缓存命中 2、缓存未命中 20、输出 100。

K3 是付费解锁模型：**充值后才能调用**，新用户认证赠送的 15 元代金券不能用于 K3。

## 4. 思考模式（始终开启，不可关闭）

- 顶层 `reasoning_effort`：`low` / `high` / `max`，默认 `max`。**没有 `off`**——K2.x 系列的 `thinking` 配置迁移到 K3 时要整段删除，改传 `reasoning_effort`。
- 多轮对话/工具调用时必须把 API 返回的**完整** assistant message（含 `reasoning_content` 和 `tool_calls`）原样回传，只保留 `content` 会破坏推理连续性。

## 5. 固定采样参数（不要显式传）

`temperature=1.0`、`top_p=0.95`、`n=1`、`presence_penalty=0`、`frequency_penalty=0` 是官方文档明确写出的固定值，"建议不要显式传入"——如果项目通用请求构建层默认带上自己的 `temperature`/`topP`，K3 这边等于被覆盖成无效参数，属于容易被忽视的静默问题。

## 6. 视觉输入（重要限制）

- 图片必须走 `image_url.url` 的 **base64 data URL**（`data:image/png;base64,...`），**不支持公网图片直链**。这与大多数供应商"直接传 URL"的默认假设相反，接入时要单独处理。
- 视频走 Files API 先上传拿 `file_id`，再用 `video_url.url = "ms://<file-id>"` 引用，用完建议调用 `client.files.delete` 清理。
- `content` 必须是对象数组，不能是拼好的字符串。

## 7. 结构化输出

`response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`，只解析 `message.content`，不解析 `reasoning_content`。

## 8. 联网搜索（官方明确提示不建议用于生产）

- 内置工具名 `$web_search`，声明方式和普通 function 不同：`type` 要写成 `"builtin_function"`（不是 `"function"`），且**只需要 `function.name`，不需要 `parameters`**：
  ```json
  { "type": "builtin_function", "function": { "name": "$web_search" } }
  ```
  `$` 前缀是 Kimi 保留给内置函数的命名空间，普通 `function` 类型的工具名不允许出现 `$`。
- 执行方式：模型返回 `finish_reason=tool_calls` 且 `tool_call.function.name="$web_search"` 时，调用方**原样把 `arguments` 塞回一条 `role=tool` 消息**即可，不需要真的执行搜索——搜索本身由 Kimi 服务端完成。
- 价格：¥0.03/次（只在 `finish_reason=tool_calls` 且工具名是 `$web_search` 时收取；如果中途放弃 `tool_calls` 循环，只收这笔工具调用费，不收搜索内容占用的 token 费）。搜索结果本身也会计入下一次请求的 `prompt_tokens`，可从 `tool_call.function.arguments.usage.total_tokens` 读到这部分用量。
- **官方定价页原文警告**：「联网搜索（`web_search`）正在更新升级中，近期不建议使用该功能，当前文档已经过时」。项目侧如果要接这个能力，应该默认关闭并在 UI 上标注"实验性/暂不稳定"，而不是当作可靠能力直接暴露。
- 官方更推荐的替代路径是走 Formula 官方工具通道（标准 OpenAI `function` 类型，见「官方工具」文档），但同样标注"联网搜索工具正在更新，近期不建议使用"。

## 9. 动态加载工具（K3 独有能力）

把完整工具定义放进一条 `role=system` 且不含 `content`、只含 `tools` 字段的消息里，可以从对话中间某一轮开始动态生效，不需要在最初就声明全部工具。用于工具数量多、想省 token 或提升工具选择准确率的场景。

## 原始链接索引（均无需登录）

- [Kimi API 概览](https://platform.kimi.com/docs/overview)
- [Kimi K3 快速开始](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)
- [推理强度](https://platform.kimi.com/docs/guide/use-reasoning-effort)
- [使用 Kimi API 的联网搜索功能](https://platform.kimi.com/docs/guide/use-web-search)
- [如何在 Kimi API 中使用官方工具](https://platform.kimi.com/docs/guide/use-official-tools)
- [Kimi K3 定价](https://platform.kimi.com/docs/pricing/chat-k3)
- [联网搜索定价](https://platform.kimi.com/docs/pricing/tools)
- [使用思考模式](https://platform.kimi.com/docs/guide/use-thinking-models)
- [Kimi 文档全量索引](https://platform.kimi.com/docs/llms.txt)
