# Groq · 供应商基础文档

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 供应商 | GroqCloud（与 xAI Grok 无关） |
| 建议 `providerId` | `groq` |
| Base URL | `https://api.groq.com/openai/v1` |
| 鉴权 | `Authorization: Bearer <GROQ_API_KEY>` |
| 当前 Say-It 默认模型 | `openai/gpt-oss-20b` |
| 文档/价格可见性 | 公开，无需登录；API Key、用量和账单需登录 |

## 1. OpenAI 兼容协议

Groq 支持 OpenAI 兼容 Chat Completions：

```text
POST https://api.groq.com/openai/v1/chat/completions
GET  https://api.groq.com/openai/v1/models
GET  https://api.groq.com/openai/v1/models/{model}
```

Chat 请求必填 `model` / `messages`，支持 SSE `stream`、tools、`response_format`、`max_completion_tokens`、`temperature`、`top_p`、`stop`、`seed`。`n` 只能为 1。`logprobs/logit_bias/top_logprobs/messages[].name` 不支持，传入会返回 400。

## 2. 模型发现

`GET /models` 需 Bearer Key，返回 `object=list` 与 `data[]`；单项包含 `id/object/created/owned_by/active/context_window/public_apps`，单模型查询还可返回 `max_completion_tokens`。

宿主应在设置页动态发现时过滤 `active !== false`，同时保留用户手动填入模型 ID 的兼容路径，不要将官方列表当作永不变的构建时常量。

## 3. GPT-OSS 推理参数

`openai/gpt-oss-20b` 支持 `reasoning_effort=low|medium|high`，默认 `medium`。

官方 Reasoning 页明确：GPT-OSS 20B/120B **不支持 `reasoning_format`**；默认在 assistant message 的 `reasoning` 字段返回推理，可传 `include_reasoning=false` 仅返回答案。`include_reasoning` 与 `reasoning_format` 互斥。

SDK 适配时不得沿用 Qwen3 的 `none/default` 为 GPT-OSS 构造参数，也不得给 GPT-OSS 发 `reasoning_format=parsed`。

## 4. `openai/gpt-oss-20b` 官方当前数据

| 项目 | 值 |
|---|---|
| 类型 | Production model |
| 速度 | 约 1000 tokens/s |
| 上下文 | 131,072 tokens |
| 最大输出 | 65,536 tokens |
| Developer Plan 限流 | 250K TPM / 1K RPM |
| 输入价格 | $0.075 / 1M tokens |
| 输出价格 | $0.30 / 1M tokens |

## 5. 错误与取消

错误体为 `{ error: { message, type } }`。重点状态：400 参数错误；401/403 鉴权/权限；404 模型或资源不存在；413 请求过大；422 语义不可处理；429 限流；498 Flex 容量不足；499 调用方取消；500/502/503 服务端错误。官方明确服务端错误不计费。

宿主需将 `AbortSignal` 下沉到 fetch/SSE，主动取消归一为 cancellation，不应当成网络错误重试。API Key、Authorization 头、完整 prompt 和 reasoning 不可进入日志。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 可用模型、价格、上下文、限流 | https://console.groq.com/docs/models | 否 |
| OpenAI 兼容性 | https://console.groq.com/docs/openai | 否 |
| Chat/Models API 参考 | https://console.groq.com/docs/api-reference | 否 |
| Reasoning 参数 | https://console.groq.com/docs/reasoning | 否 |
| 错误码 | https://console.groq.com/docs/errors | 否 |
| API Key | https://console.groq.com/keys | **是** |
