# Qwen3-ASR-Flash-2026-02-10 · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 短音频同步识别（OpenAI 兼容 / DashScope HTTP） |
| 平台模型 ID | `qwen3-asr-flash-2026-02-10`（最新快照） |
| 输入上限 | 5 分钟 / 10 MB，单次 1 个音频 |
| 文档/价格 | 公开，无需登录 |

## 1. 端点、输入与结果

`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`，Bearer 鉴权。用 `messages[].content[].input_audio.data` 传公网 URL 或 Base64 Data URI；`asr_options` 可传 `language/enable_itn`。

同步结果 `choices[0].message.content`，SSE 结果 `choices[0].delta.content`。备选 DashScope 端点为 `/api/v1/services/aigc/multimodal-generation/generation`，请求/结果包装与 OpenAI 不同。

## 2. 能力与价格

多语种/中文方言，支持情感识别和 ITN；不支持热词/说话人分离。北京原价 0.00022 元/秒，输出不计费；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

与稳定别名共用请求实现，但分开注册和展示。小文件优先 Base64；如用百炼临时 OSS，必须按本精确模型 ID 申请上传凭证，并加 `X-DashScope-OssResourceResolve: enable`。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API | https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference | 否 |
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| 临时上传 | https://help.aliyun.com/zh/model-studio/get-temporary-file-url | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
