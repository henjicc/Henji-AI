# Qwen3-ASR-Flash-Filetrans · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 长音频/录音文件异步识别 |
| 平台模型 ID | `qwen3-asr-flash-filetrans` |
| 输入上限 | 12 小时 / 2 GB；单次 1 个 URL |
| 文档/价格 | 公开，无需登录 |

## 1. 提交与轮询

```text
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription
Authorization: Bearer <API Key>
X-DashScope-Async: enable
GET https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/{task_id}
```

提交 `model="qwen3-asr-flash-filetrans"`、`input.file_url`；可选 `parameters.language/enable_itn/enable_words/channel_id`。返回 `task_id`，轮询状态 `PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN`。成功返回的转写结果需及时持久化，不把任务或签名 URL 当长期资源。

## 2. 能力、上传与价格

- 多语种/中文方言，支持情感识别、ITN 和句/字时间戳；不支持热词和说话人分离。
- 格式 `aac/amr/avi/flac/flv/m4a/mkv/mov/mp3/mp4/mpeg/ogg/opus/wav/webm/wma/wmv`，采样率任意。
- 需公网 URL；REST 可用百炼 48 小时 `oss://` 临时 URL，调用时加 `X-DashScope-OssResourceResolve: enable`。
- `channel_id` 每个音轨独立计费。北京原价 0.00022 元/秒，输出不计费；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

该 ID 只支持 DashScope 异步，不得经 OpenAI 兼容 Chat 端点发送。宿主层负责文件上传和长轮询生命周期，SDK 返回结构化转写结果。用户取消时停止轮询；如官方取消 API 可用，后续实现应再发远端取消。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API | https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference | 否 |
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| 临时上传 | https://help.aliyun.com/zh/model-studio/get-temporary-file-url | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
