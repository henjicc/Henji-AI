# Whisper Large v3 · Groq

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-31 |
| 模态 | ASR（同步文件转写 / 音频译英文） |
| 供应商 | GroqCloud |
| 平台模型 ID | `whisper-large-v3` |
| 转写端点 | 支持 |
| 翻译端点 | 支持，输出英文 |
| 公开价格 | `$0.111 / hour` |
| 免费政策 | Free Plan 持续性限流额度，不是一次性试用金 |
| 文档/价格 | 公开无需登录；Key/用量需登录 |

## 1. 端点与鉴权

```text
POST https://api.groq.com/openai/v1/audio/transcriptions
POST https://api.groq.com/openai/v1/audio/translations
Authorization: Bearer <GROQ_API_KEY>
Content-Type: multipart/form-data
```

两个端点都传 `model=whisper-large-v3`，且 `file` / `url` 二选一。`url` 可为普通 URL 或
Base64URL。`/audio/transcriptions` 返回原语言文本，`/audio/translations` 返回英文翻译；后者
不是可任意选择目标语言的翻译 API。

可选字段包括 `language`（ISO-639-1）、`prompt`（最多 224 tokens）、
`response_format=json|verbose_json|text`、`temperature=0..1` 和
`timestamp_granularities[]=segment|word`。官方未公开独立 WebSocket/SSE 实时 ASR，请求是同步
HTTP 文件处理。

## 2. 响应与时间戳

- `json` 最小结果包含 `text`；`text` 格式返回纯文本。
- `verbose_json` 可返回段/词时间戳和段级统计。
- 官方参数表要求时间戳使用 `verbose_json`，但 Python 示例注释误写为 `json`；适配
  应以参数表和真实 API 验证为准。

## 3. 文件限制

- Free Tier 最大 25 MB，Developer Tier 最大 100 MB；附件上传最大 25 MB，超过时可使用
  `url`。Groq Models 表对本模型也明确列 100 MB 最大文件。
- 支持 `flac/mp3/mp4/mpeg/mpga/m4a/ogg/wav/webm`；多音轨文件只处理第一条音轨。
- 最短 0.01 秒，每次最少按 10 秒计费；服务端下采样为 16 kHz 单声道。
- 长音频需客户端分块并拼接结果。

## 4. 价格、额度与选型

| 项目 | 官方当前值 |
|---|---|
| 价格 | `$0.111 / hour` |
| 参考速度 | 189x real-time |
| 参考 WER | 10.3% |
| Free Plan | 20 RPM / 2K RPD / 7.2K ASH / 28.8K ASD |
| Developer Plan | 200K ASH / 300 RPM |

官方建议在多语种且对转写错误更敏感时选本模型；Turbo 的单价更低、参考速度更高。
速度/WER 是官方比较指标，不是 SLA。实际组织限流以登录后 Limits 页为准。

## 5. 错误与适配要点

错误体是 `{error:{message,type}}`。需处理 400/401/403/404/413/422/429、498 容量不足、
499 调用方取消与 500/502/503。Say-It/SDK 接入属于简单 Bearer + multipart HTTP；应把
“转写”和“译英文”建模为明确能力，而不是向 Turbo 也暴露一个必然失败的翻译开关。
中国大陆网络与付款可用性未经官方承诺或本轮实测。

## 6. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| ASR API、参数与文件限制 | https://console.groq.com/docs/speech-to-text | 否 |
| 模型价格与 Developer Plan | https://console.groq.com/docs/models | 否 |
| Free Plan 限流 | https://console.groq.com/docs/rate-limits | 否 |
| 错误码 | https://console.groq.com/docs/errors | 否 |
| API Key | https://console.groq.com/keys | **是** |
