# Qwen Image 3.0

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个标准模型；无图/1–3 张图自动路由文生图/图生图；APIMart 另有 Pro 变体，若适配 Pro 应另建模型 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示且不请求 |
| 官方接口 | 阿里云百炼（已核查） |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| 阿里云百炼（官方） | 支持 | `qwen-image-3.0`；同页还列出 `qwen-image-3.0-pro` | [原始控制台链接](https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3047054)；[公开 API 正文](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference?mode=pure) | 标准版输入图 `0.02 元/张`；1K/2K 输出均 `0.18 元/张` | 原始控制台链接需登录；API 正文与价格页公开可见 |
| APIMart | 支持 | `qwen-image-3.0`；文档也支持 `qwen-image-3.0-pro` | [Qwen Image 3.0 API](https://docs.apimart.ai/en/api-reference/images/qwen-image-3.0/generation.md) | 标准约 `$0.0205712/张`；Pro 约 `$0.0285712/张`（2K Pro 约 `$0.0571432/张`） | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `qwen3/text-to-image`、`qwen3/image-to-image` | [文生图](https://docs.kie.ai/cn/market/qwen3/text-to-image.md)、[图生图](https://docs.kie.ai/cn/market/qwen3/image-to-image.md) | 标准版输出 1K/2K 均 `$0.024/张`；图生图输入 `$0.0025/张` | 价格与 API 文档无需登录；实际调用需要 API Key |

## 官方接口（阿里云百炼）

- Region/Workspace 必须与 API Key、Endpoint 一致。北京业务空间推荐 URL：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`。
- 同步：`POST /api/v1/services/aigc/multimodal-generation/generation`。
- 异步：`POST /api/v1/services/aigc/image-generation/generation`，必须增加 `X-DashScope-Async: enable`；返回 `output.task_id`，查询 `GET /api/v1/tasks/{task_id}`。
- Body：`model=qwen-image-3.0`，`input.messages` 仅一轮，`content` 由 1 个 text（文生图）或 1–3 个 image + 1 个 text（图生图）组成。
- `parameters` 支持 `prompt_extend`、`prompt_extend_mode=direct|agent`、`enable_thinking`、`n=1–6`、`size=宽*高`、`watermark`。`negative_prompt`、`seed` 虽在官方文档存在，按项目约定隐藏。
- 成功同步结果：`output.choices[0].message.content[].image`；异步成功状态为 `SUCCEEDED`，结果位置相同。图像 URL 只保留约 24 小时。

### 官方价格

来源：[阿里云百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing#6713612f55h4l)。图生图按“输入图像数 × 输入单价 + 成功输出图像数 × 输出单价”计费，请求失败不计费。

| 官方模型 | 输入图像 | 1K 输出 | 2K 输出 | 北京地域免费额度 |
|---|---:|---:|---:|---:|
| `qwen-image-3.0` | `0.02 元/张` | `0.18 元/张` | `0.18 元/张` | 输入输出合计 10 张，90 天内有效 |
| `qwen-image-3.0-pro` | `0.02 元/张` | `0.25 元/张` | `0.50 元/张` | 输入输出合计 10 张，90 天内有效 |

本文件适配目标是标准版，Pro 价格只用于避免把同页两个模型混淆。

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/images/generations`；轮询 `GET /v1/tasks/{task_id}`。
- `model` 使用 `qwen-image-3.0`。APIMart 同页也支持 `qwen-image-3.0-pro`，不要在标准模型的 builder 中按模型特定分支混用 Pro 价格。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 约 4.5K token 上限 |
| `image_urls` | string[] | 图生图 1–3 张，单张 ≤10MB |
| `resolution` | `1K` / `2K` | 影响计费；也可用 `size` 传像素 |
| `size` | 比例或像素 | `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`；自定义边长 512–2048，比例 1:8–8:1 |
| `n` | 1–6 | 参考图和生成张数按文档约束 |
| `prompt_extend` | boolean | 文档默认 true；可视为模型固定默认请求值，不必暴露为普通参数 |
| `prompt_extend_mode` | `direct` / `agent` | `agent` 只支持文生图；有图时不要发送 `agent` |
| `nsfw_check` | boolean | 默认 false，按需内部固定或不传 |
| `negative_prompt`、`seed` | — | 文档支持但项目绝对不显示；不请求 |

### 价格

APIMart 价格页显示标准版默认/1K/2K 均约 `$0.0205712/张`；Pro 默认/1K 约 `$0.0285712/张`、2K 约 `$0.0571432/张`。来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。

## KIE 适配

- Base URL `https://api.kie.ai`；提交 `POST /api/v1/jobs/createTask`，成功返回 `data.taskId`；查询 `GET /api/v1/jobs/recordInfo?taskId=...`。
- 无图使用 `model=qwen3/text-to-image`；有图使用 `model=qwen3/image-to-image`，`image_urls` 最多 3 张。
- 字段：`prompt`、`resolution=1K|2K`、`image_size=1:1|3:2|2:3|4:3|3:4|16:9|9:16|21:9`、`output_format=png|jpeg`、`prompt_extend`、`nsfw_checker`。`negative_prompt`、`seed` 不接入项目 UI，也不发送。
- `data.state=success` 后解析 `JSON.parse(data.resultJson).resultUrls`；失败读 `failMsg`。可传 `callBackUrl`，回调终态为成功/失败。
- KIE 定价页按 `qwen` 搜索可见标准版与 Pro 的输入/输出价格；本文件目标标准版为 1K/2K 输出 `$0.024/张`，图生图输入 `$0.0025/张`。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [阿里云百炼原始控制台链接](https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3047054)
- [阿里云百炼公开 API 正文](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference?mode=pure)：模型 ID、同步/异步端点、字段、结果与限制。
- [阿里云百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing#6713612f55h4l)：标准版/Pro 输入图与 1K/2K 输出价格、免费额度。
- [APIMart API](https://docs.apimart.ai/en/api-reference/images/qwen-image-3.0/generation.md)
- [APIMart 定价](https://apimart.ai/zh/pricing)
- [KIE 文生图](https://docs.kie.ai/cn/market/qwen3/text-to-image.md)
- [KIE 图生图](https://docs.kie.ai/cn/market/qwen3/image-to-image.md)
- [KIE 任务详情](https://docs.kie.ai/cn/market/common/get-task-detail.md)
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `qwen` 获取标准版/Pro 价格。
