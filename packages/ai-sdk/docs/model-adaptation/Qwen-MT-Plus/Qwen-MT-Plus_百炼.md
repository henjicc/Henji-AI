# Qwen-MT-Plus · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 能力 | 文本翻译（非流式 / 累积流式） |
| 平台模型 ID | `qwen-mt-plus` |
| 地域 | 北京、新加坡、美国（弗吉尼亚）、德国（法兰克福）；以实际开通为准 |
| 文档/价格 | API/价格公开；选型页本次触发验证码 |

## 1. 协议、参数与结果

OpenAI 兼容 `POST /compatible-mode/v1/chat/completions` 或 DashScope `POST /api/v1/services/aigc/text-generation/generation`，Bearer 鉴权。只支持 User Message。

`translation_options` 必填 `source_lang/target_lang`，源语言可用 `auto`；可选 `terms/tm_list/domains`。还支持 `stream/max_tokens/seed/temperature/top_p/top_k/repetition_penalty`。API 页未直接写独立 `max_tokens` 数值，它引用的选型页本次触发验证码，因此上限未核实。

译文为 `choices[0].message.content`。Plus 开启流式时，官方明确每块返回当前**累积序列**，而不是新增文本；客户端应替换当前候选或计算前缀差，不能直接追加。

## 2. 价格与适配

北京官方原价：输入 1.8 元/百万 Token，输出 5.4 元/百万 Token；价格页列 100 万 Token 限时免费额度。

实现必须为不同模型声明流式 delta 语义，不用同一个“字符串追加”分支处理 Flash/Lite/Plus。按需注册，不强制宿主安装全部模型。

## 3. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API/流式差异 | https://help.aliyun.com/zh/model-studio/qwen-mt-api | 否 |
| 选型/限制 | https://help.aliyun.com/zh/model-studio/machine-translation | 否（本次触发验证码） |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
