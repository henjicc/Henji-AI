# TeleSpeechASR · 硅基流动

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-31 |
| 模态 | ASR（同步文件转写） |
| 供应商 | SiliconFlow / SiliconCloud |
| 平台模型 ID | `TeleAI/TeleSpeechASR` |
| 公开计费 | **未确认**：当前通用价格页未列该 ID |
| 免费证据 | 官方“说点啥”用例将其列入该客户端的免费服务；不足以证明自有 Key 长期免费 |
| 文档/价格 | 公开无需登录；Key/实名/用量需登录 |

## 1. 端点与鉴权

```text
POST https://api.siliconflow.cn/v1/audio/transcriptions
Authorization: Bearer <SILICONFLOW_API_KEY>
Content-Type: multipart/form-data
```

请求仅需两个官方公开字段：

```text
file=<binary audio file>
model=TeleAI/TeleSpeechASR
```

`file` 必须不超过 1 小时、50 MB。官方转写端点明确把该 ID 列为 `model` enum，但未公开
完整文件格式白名单，也未在端点层公开语言清单、热词、说话人、时间戳或其它模型特性。
公开协议没有 WebSocket/SSE 实时接口。

## 2. 响应契约

```json
{
  "text": "<string>"
}
```

响应头包含 `x-siliconcloud-trace-id`。在硅基流动当前公开端点中，两个 ASR model enum 共用同一个
`text` 响应形状；不得凭模型名称猜测额外字段。

## 3. 价格与免费不确定项

- 2026-08-31 公开通用价格页的语音模型栏未找到 `TeleAI/TeleSpeechASR`，因此无法从价格页确认
  自有 API Key 调用的单价或免费身份。
- 官方“说点啥”用例把 TeleSpeechASR 与 SenseVoiceSmall 列为该客户端可选的“免费服务”，
  但同页又将关闭免费服务后的“自己 API Key”作为另一种路径。这不能等价为所有 SiliconCloud
  账号下长期 0 费用。
- SDK 可先记录模型可调用，但在未取得控制台账单证据前，价格不应写 0；发布前需用目标账号复核。

## 4. 错误与适配要点

官方错误体可为 `{code,message,data}` JSON，也可为纯文本。常见状态为 400/401/403/429/
500/503/504。SDK 的 `provider_http_error` 诊断文本保留 HTTP status、可用的
`code/message/data`、文本 fallback 和脱敏后的 `x-siliconcloud-trace-id`；当前通用
`AiRuntimeError` 不提供结构化供应商错误 metadata。

Say-It/SDK 接入是简单 Bearer + multipart HTTP，但只能提交 `file/model`；其它 ASR 参数在官方端点
未公开时应隐藏。中国大陆使用 `api.siliconflow.cn`；本轮未发起真实请求，可用性、限流与
计费均需目标账号实测。

## 5. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| ASR API、模型 ID、输入限制与响应 | https://docs.siliconflow.cn/docs/api/audio-transcriptions-post | 否 |
| 当前通用价格页（该 ID 未列出） | https://siliconflow.cn/pricing | 否 |
| 免费模型/实名/Rate Limits 规则 | https://docs.siliconflow.cn/cn/userguide/rate-limits/rate-limit-and-upgradation | 否 |
| 客户端免费服务证据 | https://docs.siliconflow.cn/cn/usercases/use-siliconcloud-in-BiBiKeyboard | 否 |
| 错误处理 | https://docs.siliconflow.cn/cn/faqs/error-code | 否 |
| API Key | https://cloud.siliconflow.cn/account/ak | **是** |
