# Qwen-MT-Lite · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 文本翻译（增量流式 / 非流式） |
| 平台模型 ID | `qwen-mt-lite` |
| 地域 | 北京、新加坡、美国（弗吉尼亚）、德国（法兰克福）；以实际开通为准 |
| 文档/价格 | API/价格公开；选型页本次触发验证码 |

## 1. 协议、参数与结果

OpenAI 兼容 `POST /compatible-mode/v1/chat/completions` 或 DashScope `POST /api/v1/services/aigc/text-generation/generation`，Bearer 鉴权。只支持 User Message。

`translation_options` 必填 `source_lang/target_lang`，源语言可 `auto`；可选 `terms/tm_list/domains`。支持 `stream/max_tokens/seed/temperature/top_p/top_k/repetition_penalty`。API 页引用的选型页本次触发验证码，所以独立 `max_tokens` 数值未核实，不硬编。

非流式结果为 `choices[0].message.content`；Lite 的 SSE `delta.content` 为**增量片段**，可直接追加。用量从 `usage` 读取。

## 2. 价格与适配

北京官方原价：输入 0.6 元/百万 Token，输出 1.6 元/百万 Token；价格页列 100 万 Token 限时免费额度。

翻译 capability 单独注册，宿主可只选 Lite 而不引入 Plus/Flash。密钥、待翻译原文、完整译文均默认不记入常规日志。

## 3. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API/流式差异 | https://help.aliyun.com/zh/model-studio/qwen-mt-api | 否 |
| 选型/限制 | https://help.aliyun.com/zh/model-studio/machine-translation | 否（本次触发验证码） |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
