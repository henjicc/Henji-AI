# Whisper Large v3 Turbo · Groq

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-31 |
| 模态 | ASR（同步文件转写） |
| 供应商 | GroqCloud |
| 平台模型 ID | `whisper-large-v3-turbo` |
| 翻译端点 | **不支持** |
| 公开价格 | `$0.04 / hour` |
| 免费政策 | Free Plan 持续性限流额度，不是一次性试用金 |
| 文档/价格 | 公开无需登录；Key/用量需登录 |

## 1. 端点与鉴权

```text
POST https://api.groq.com/openai/v1/audio/transcriptions
Authorization: Bearer <GROQ_API_KEY>
Content-Type: multipart/form-data
```

必填 `model=whisper-large-v3-turbo`，且 `file` / `url` 二选一。`url` 可为普通 URL 或
Base64URL。可选字段包括 `language`（ISO-639-1）、`prompt`（最多 224 tokens）、
`response_format=json|verbose_json|text`、`temperature=0..1` 和
`timestamp_granularities[]=segment|word`。

本模型不能调用 `/audio/translations`。官方未公开独立 WebSocket/SSE 实时 ASR，请求是同步
HTTP 文件转写。

## 2. 响应与时间戳

- `json` 最小结果包含 `text`；`text` 格式返回纯文本。
- `verbose_json` 可返回段/词时间戳和段级统计。
- 官方参数表要求时间戳使用 `verbose_json`，但 Python 示例注释误写为 `json`；适配
  应以参数表和真实 API 验证为准。

## 3. 文件限制

- Free Tier 最大 25 MB，Developer Tier 公开总限制为 100 MB；附件上传最大 25 MB，
  超过时可使用 `url`。Models 表的 Turbo 单模型文件大小栏为 `-`，100 MB 不应作为
  Turbo 永久的硬编码常量。
- 支持 `flac/mp3/mp4/mpeg/mpga/m4a/ogg/wav/webm`；多音轨文件只处理第一条音轨。
- 最短 0.01 秒，每次最少按 10 秒计费；服务端下采样为 16 kHz 单声道。
- 长音频需客户端分块并拼接结果。

## 4. 价格、额度与选型

| 项目 | 官方当前值 |
|---|---|
| 价格 | `$0.04 / hour` |
| 参考速度 | 216x real-time |
| 参考 WER | 12% |
| Free Plan | 20 RPM / 2K RPD / 7.2K ASH / 28.8K ASD |
| Developer Plan | 400K ASH / 400 RPM |

Turbo 是官方建议的多语种性价比选项；如果任务对错词率更敏感或需音频译英文，应选
`whisper-large-v3`。速度/WER 是官方比较指标，不是 SLA。实际组织限流以登录后
Limits 页为准。

## 5. 错误与适配要点

错误体是 `{error:{message,type}}`。需处理 400/401/403/404/413/422/429、498 容量不足、
499 调用方取消与 500/502/503。Say-It/SDK 接入属于简单 Bearer + multipart HTTP，但需在发送前
按账户等级校验文件大小，传递 `AbortSignal`，并对 429/5xx 执行受控重试。中国大陆网络与
付款可用性未经官方承诺或本轮实测。

## 6. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| ASR API、参数与文件限制 | https://console.groq.com/docs/speech-to-text | 否 |
| 模型价格与 Developer Plan | https://console.groq.com/docs/models | 否 |
| Free Plan 限流 | https://console.groq.com/docs/rate-limits | 否 |
| 错误码 | https://console.groq.com/docs/errors | 否 |
| API Key | https://console.groq.com/keys | **是** |
