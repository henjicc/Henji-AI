# GPT-OSS 20B · Groq

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 模态 | LLM（文本生成/推理） |
| 供应商 | GroqCloud（不是 xAI Grok） |
| 平台模型 ID | `openai/gpt-oss-20b` |
| Say-It 决策 | 保留为 Groq 默认模型 |
| 文档/价格 | 公开无需登录；Key/账单需登录 |

## 1. 端点与鉴权

```text
POST https://api.groq.com/openai/v1/chat/completions
Authorization: Bearer <GROQ_API_KEY>
Content-Type: application/json
```

可复用 OpenAI 兼容 Chat/SSE 传输。必填 `model/messages`，支持 `stream/tools/response_format/max_completion_tokens/temperature/top_p/stop/seed`。`n` 只能为 1；`logprobs/logit_bias/top_logprobs/messages[].name` 会返回 400。

## 2. 模型发现

```text
GET https://api.groq.com/openai/v1/models
GET https://api.groq.com/openai/v1/models/openai/gpt-oss-20b
```

两个端点都需 Bearer Key。列表返回 `data[]`，包含 `id/active/context_window/owned_by`；单模型还可返 `max_completion_tokens`。Say-It 可默认选本模型，同时允许用户从实时模型列表切换。

## 3. 推理参数

- `reasoning_effort`: `low|medium|high`，默认 `medium`。
- GPT-OSS 20B **不支持 `reasoning_format`**。默认的 reasoning 在 assistant message 的 `reasoning` 字段。
- 可用 `include_reasoning=false` 隐藏推理；`include_reasoning` 与 `reasoning_format` 互斥。

Say-It 现有为 Groq Qwen3 设置 `reasoning_effort=none/default` 和 `reasoning_format=parsed` 的逻辑不能套到本模型。

## 4. 能力、限制与价格

| 项目 | 官方当前值 |
|---|---|
| 状态 | Production |
| 上下文 | 131,072 tokens |
| 最大输出 | 65,536 tokens |
| 速度 | 约 1000 tokens/s |
| Developer Plan | 250K TPM / 1K RPM |
| 输入 | $0.075 / 1M tokens |
| 输出 | $0.30 / 1M tokens |

错误体 `{error:{message,type}}`。对 429/498/500/502/503 进行受控重试，但 400/401/403/404/413/422 不盲目重试；499 归一为用户取消。

## 5. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 模型状态/价格/限制 | https://console.groq.com/docs/models | 否 |
| OpenAI 兼容 | https://console.groq.com/docs/openai | 否 |
| Chat/Models API | https://console.groq.com/docs/api-reference | 否 |
| Reasoning | https://console.groq.com/docs/reasoning | 否 |
| 错误码 | https://console.groq.com/docs/errors | 否 |
| API Key | https://console.groq.com/keys | **是** |
