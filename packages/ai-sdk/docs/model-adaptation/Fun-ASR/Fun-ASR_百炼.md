# Fun-ASR · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 长音频/录音文件异步识别 |
| 平台模型 ID | `fun-asr`（稳定别名，官方当前等同 `fun-asr-2025-11-07`） |
| 输入上限 | 12 小时 / 2 GB；单次 1 个 URL |
| 文档/价格 | 公开，无需登录 |

## 1. 提交、轮询与结果

```text
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription
Authorization: Bearer <API Key>
X-DashScope-Async: enable
GET https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}
```

提交体使用 `model="fun-asr"` 和 `input.file_urls=["<public-url>"]`。返回 `output.task_id/task_status`；状态为 `PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN`。多子任务时顶层成功不代表每个子任务成功，必须查 `results[].subtask_status`。

成功后 `output.results[].transcription_url` 指向 JSON，需二次下载。结果含 `transcript/sentences/words/begin_time/end_time/speaker_id`，顶层 `usage.duration` 是计量秒数。

## 2. 能力、上传与价格

- 多语种/方言、热词、说话人分离；不支持情感识别。说话人分离建议音频 ≤ 2 小时。
- 格式 `aac/amr/avi/flac/flv/m4a/mkv/mov/mp3/mp4/mpeg/ogg/opus/wav/webm/wma/wmv`，采样率任意。
- 公网 HTTP(S) URL；REST 也可用 48 小时百炼 `oss://` 临时 URL，需 `X-DashScope-OssResourceResolve: enable`。上传凭证与模型/主账号绑定，不可复用到别的模型。
- 北京原价 0.00022 元/有效语音秒，非语音不计费；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

宿主桥负责上传、轮询、取消和将转写 JSON 落地；SDK 负责协议与结果解析。不得把 `transcription_url` 或用户原始音频 URL 写入普通日志。最近 24 小时任务可查询，不代表结果 URL 可长期存储。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| HTTP API/结果 | https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api | 否 |
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| 临时上传 | https://help.aliyun.com/zh/model-studio/get-temporary-file-url | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
