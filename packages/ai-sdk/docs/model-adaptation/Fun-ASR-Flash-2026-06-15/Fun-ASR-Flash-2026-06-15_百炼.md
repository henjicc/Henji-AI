# Fun-ASR-Flash-2026-06-15 · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 短音频同步识别（HTTP） |
| 平台模型 ID | `fun-asr-flash-2026-06-15` |
| 输入上限 | 5 分钟 / 2 GB，单次 1 个音频 |
| 文档/价格 | 公开，无需登录 |

## 1. 端点与请求

```text
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
Authorization: Bearer <API Key>
Content-Type: application/json
```

`model` 取上述 ID；`input.messages[].content[]` 最后一条为 `{type:"input_audio", input_audio:{data}}`，`data` 支持公网 URL 或 `data:<mime>;base64,...`。`parameters.format` 必填，`sample_rate/language_hints/vocabulary_id` 等可选。

`X-DashScope-SSE: enable` 开启 SSE，但音频至少 1 分钟才会分段返回中间结果；否则只有最终结果。官方明确该协议不支持 DashScope SDK，TypeScript SDK 需直连 HTTP/SSE。

## 2. 结果、能力与价格

- `output.text` 为累积文本，`output.sentence` 含句子、时间戳、`sentence_end`，`usage.duration` 为用量。
- 支持多语种/方言与 Prompt 上下文；不支持情感识别和说话人分离。
- 北京原价 0.00022 元/秒，输出不计费；官方列 36,000 秒/10 小时限时免费额度。

## 3. 上传与适配要点

小文件优先 Base64；大文件用公网 URL 或百炼临时 OSS。临时上传凭证为 `GET https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=fun-asr-flash-2026-06-15`，上传后得 `oss://` URL，调用时需 `X-DashScope-OssResourceResolve: enable`；URL 48 小时过期，不用于生产托管。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API | https://help.aliyun.com/zh/model-studio/non-real-time-speech-recognition-for-fun-asr-flash | 否 |
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| 临时上传 | https://help.aliyun.com/zh/model-studio/get-temporary-file-url | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
