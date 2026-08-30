# SenseVoiceSmall · 硅基流动

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-31 |
| 模态 | ASR（同步文件转写） |
| 供应商 | SiliconFlow / SiliconCloud |
| 平台模型 ID | `FunAudioLLM/SenseVoiceSmall` |
| 当前公开价格 | **免费** |
| 免费前提 | 账号实名认证；固定 Rate Limits，精确数值未公开 |
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
model=FunAudioLLM/SenseVoiceSmall
```

`file` 必须不超过 1 小时、50 MB。官方 cURL 以 MP3 为示例，但转写页未公开完整文件
格式白名单。公开协议没有 `language/prompt/response_format`、热词、说话人、情感或音频事件
参数，也没有 WebSocket/SSE 实时接口。

## 2. 响应契约

```json
{
  "text": "<string>"
}
```

响应头包含 `x-siliconcloud-trace-id`。虽然 SenseVoice 开源上游还有多语种、情感与音频事件能力，
硅基流动当前转写 API 只声明 `text`。SDK 文档与类型不得保证端点会返回上游额外标签。

## 3. 价格、账号与限流

- 2026-08-31 公开价格页的语音模型栏对 `FunAudioLLM/SenseVoiceSmall` 标注“免费”。
- 这是免费模型计划，不是一次性赠送金；官方说明账单中调用消耗为 0。
- 全部免费模型要求实名认证。限流为固定值，但公开 Rate Limits 页未给本模型的精确
  RPM/RPD/音频时长额度；以登录后实际账号页为准。
- 官方转写页明确保留模型上下线和服务能力调整的可能；价格/可用性需在发布前复核。

## 4. 错误与适配要点

官方错误体可为 `{code,message,data}` JSON，也可为纯文本。常见状态为 400/401/403/429/
500/503/504；403 可与实名、模型权限或余额有关。SDK 的 `provider_http_error` 诊断文本保留
HTTP status、可用的 `code/message/data`、文本 fallback 和脱敏追踪 ID；
当前通用 `AiRuntimeError` 不提供结构化供应商错误 metadata。

Say-It/SDK 接入是简单 Bearer + multipart HTTP，但不得透传硅基流动未公开的 OpenAI ASR
扩展参数。中国大陆使用 `api.siliconflow.cn`；本轮未发起真实请求，实际账号限流未实测。

## 5. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| ASR API、模型 ID、输入限制与响应 | https://docs.siliconflow.cn/docs/api/audio-transcriptions-post | 否 |
| 当前价格 | https://siliconflow.cn/pricing | 否 |
| 免费模型/实名/Rate Limits 规则 | https://docs.siliconflow.cn/cn/userguide/rate-limits/rate-limit-and-upgradation | 否 |
| 错误处理 | https://docs.siliconflow.cn/cn/faqs/error-code | 否 |
| API Key | https://cloud.siliconflow.cn/account/ak | **是** |
