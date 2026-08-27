# Qwen3-ASR-Flash · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 短音频同步识别（OpenAI 兼容 / DashScope HTTP） |
| 平台模型 ID | `qwen3-asr-flash`（稳定别名，官方当前等同 `qwen3-asr-flash-2025-09-08`） |
| 输入上限 | 5 分钟 / 10 MB，单次 1 个音频 |
| 文档/价格 | 公开，无需登录 |

## 1. 接入协议

推荐 Say-It 复用 OpenAI 兼容协议：

```text
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
Authorization: Bearer <API Key>
```

`messages[].content[]` 传 `{type:"input_audio", input_audio:{data}}`，`data` 支持公网 URL 或 Base64 Data URI。`asr_options` 是非 OpenAI 标准参数，支持 `language` 和 `enable_itn`。也可用 DashScope 同步端点 `/api/v1/services/aigc/multimodal-generation/generation`。

非流式结果为 `choices[0].message.content`；SSE 为 `choices[0].delta.content`，最后 usage 块需单独处理。DashScope 结果在 `output.choices[]`。

## 2. 能力与价格

- 支持多语种/中文方言、情感识别、ITN；不支持热词和说话人分离。
- 北京原价 0.00022 元/秒，输出不计费；官方列 36,000 秒/10 小时限时免费额度。

## 3. 适配要点

稳定别名与 2026-02-10 快照并列注册，不自动改写模型 ID。该模型 10 MB 上限明显低于 Fun-ASR-Flash；上传前必须先按模型限制校验，不能只按通用上传的 1 GB 上限。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API | https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference | 否 |
| 模型/音频规格 | https://help.aliyun.com/zh/model-studio/asr-model/ | 否 |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
