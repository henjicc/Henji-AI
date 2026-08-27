# Qwen-MT-Flash · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 文本翻译（增量流式 / 非流式） |
| 平台模型 ID | `qwen-mt-flash` |
| 地域 | 北京、新加坡、美国（弗吉尼亚）、德国（法兰克福）；以区域模型实际开通为准 |
| 文档/价格 | API/价格公开；选型页本次触发验证码 |

## 1. 协议与参数

```text
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation
Authorization: Bearer <API Key>
```

只支持 User Message，`content` 是待翻译文本。`translation_options` 必填：`source_lang` 为源语言英文全称或 `auto`，`target_lang` 为目标语言英文全称；可选 `terms/tm_list/domains`，其中领域提示只支持英文。

支持 `stream/max_tokens/seed/temperature/top_p/top_k/repetition_penalty`。官方 API 页将 `max_tokens` 上限指向选型页，但选型页本次被验证码拦截，**未获得可核实的独立上限，实现不得凭经验硬编数字**。

## 2. 结果、流式与价格

非流式译文为 `choices[0].message.content`，用量为 `usage.prompt_tokens/completion_tokens/total_tokens`。Flash 的 SSE `delta.content` 是**增量片段**，客户端直接追加。

北京官方原价：输入 0.7 元/百万 Token，输出 1.95 元/百万 Token；价格页列北京限时 100 万 Token 免费额度，以账号实际为准。

## 3. 适配要点

翻译是独立 capability，不用通用 LLM prompt 伪装；但可复用 OpenAI 兼容传输与 SSE 解析。只在按需注册翻译能力时暴露，不得因为 SDK 内置就强制进入所有宿主。

## 4. SDK 实现状态

- 按需入口：`@henjicc/ai-sdk/capabilities/translation/bailian`，工厂 `createQwenMtFlashTranslationModule()`。
- 默认走 OpenAI 兼容 Chat Completions 并开启 SSE；将官方增量块统一成 `delta(mode=append)`，最终输出完整 `item`，Token 计入 `usage`。
- Say-It 当前保存的常用语言代码会先映射为官方英文语言名；术语表映射到 `terms`，翻译记忆映射到 `tm_list`，通用 `context` 映射到英文领域提示 `domains`。
- 未核实的独立最大输出数不设默认值，也不发送 `max_tokens`。当前只有官方示例 fixture/单测证据，尚无真实付费请求证据。

## 5. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API/请求/响应 | https://help.aliyun.com/zh/model-studio/qwen-mt-api | 否 |
| 选型/语言/限制 | https://help.aliyun.com/zh/model-studio/machine-translation | 否（本次访问触发验证码，未取正文） |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
