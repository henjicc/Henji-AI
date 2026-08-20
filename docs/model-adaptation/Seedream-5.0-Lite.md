# Seedream 5.0 Lite

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个模型；按是否有参考图自动在文生图、图生图之间路由；`n>1` 时启用组图/序列生成 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 文档虽支持，但按项目约定默认不显示且不请求 |
| 官方接口 | 火山方舟（已核查） |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| 火山方舟（官方） | 支持 | `doubao-seedream-5.0-lite` 系列，具体 Endpoint ID 以控制台模型列表为准 | [图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh) | 本次页面未提取到价格 | 正文本次可见；调用需要 API Key |
| APIMart | 支持 | `seedream-5-0-lite`（兼容 `seedream-5.0-lite`、`Seedream-5.0-lite`） | [Seedream-5.0-Lite API](https://docs.apimart.ai/en/api-reference/images/seedream-5-lite/generation.md) | 约 `$0.0228/张` | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `seedream/5-lite-text-to-image`、`seedream/5-lite-image-to-image` | [文生图](https://docs.kie.ai/cn/market/seedream/5-lite-text-to-image.md)、[图片编辑](https://docs.kie.ai/cn/market/seedream/5-lite-image-to-image.md) | 文生图/图生图均 `$0.0275/张` | 价格与 API 文档无需登录；实际调用需要 API Key |

## 适配结论

- 对外作为一个图片模型；APIMart 是一个提交端点，通过 `image_urls` 是否存在区分文生图/图生图。KIE 虽然拆成两个模型 ID，仍建议在本项目内部按“无图/有图”自动选端点。
- KIE 文档把 `quality` 映射为 2K/3K/4K：`basic` / `high` / `ultra`。APIMart 直接使用 `resolution`：`2K` / `3K` / `4K`。
- `n` 的范围是 1–15；参考图数量与生成图数量之和不得超过 15。`n>1` 时 APIMart 会自动启用 `sequential_image_generation=auto`。

## APIMart 适配

### 请求契约

- Base URL：`https://api.apimart.ai`。
- 提交：`POST /v1/images/generations`。
- Header：`Authorization: Bearer <API_KEY>`、`Content-Type: application/json`。
- 请求 `model` 固定为 `seedream-5-0-lite`，`prompt` 必填。
- 成功先拿任务 ID；使用 `GET /v1/tasks/{task_id}` 轮询。初始状态通常为 `submitted`，继续轮询 `pending` / `processing`，终态为 `completed` 或 `failed`。
- 成功结果读取 `data.result.images[].url[]`；URL 有效期约 72 小时，应立即下载或转存。

### 参数

| UI/内部参数 | 请求字段 | 类型/取值 | 适配注意 |
|---|---|---|---|
| 提示词 | `prompt` | string | 必填 |
| 比例 | `size` | `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`、`2:1`、`1:2`、`21:9`、`auto` | `auto` 仅在有参考图时使用；不显示 `9:21` |
| 分辨率 | `resolution` | `2K`、`3K`、`4K` | 不支持 1K；建议 UI 用智能比例映射为具体像素 |
| 生成张数 | `n` | 1–15 | 参考图数 + `n` ≤ 15 |
| 参考图 | `image_urls` | URL 数组 | 每张 ≤10MB，支持 JPEG/PNG；最多 14 张，但还要受总数限制 |
| 组图模式 | `sequential_image_generation` | `disabled` / `auto` | `n>1` 时固定请求 `auto`，不必单独暴露 mode |
| 组图选项 | `sequential_image_generation_options` | object | 仅在组图模式需要；按文档扩展，不要无条件发送 |
| 水印 | `watermark` | boolean，默认 false | 按产品策略决定是否显示 |
| 内容审核 | `nsfw_check` | boolean，默认 false | 可不传；不是用户创作参数 |

### 价格

APIMart 价格页显示 `SEEDREAM-5-0-LITE` 默认 `$0.0228/张`。价格来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。

## KIE 适配

- Base URL：`https://api.kie.ai`；Header：`Authorization: Bearer <API_KEY>`。
- 提交统一为 `POST /api/v1/jobs/createTask`，Body 为 `{ model, callBackUrl?, input }`。
- `input` 参数：文生图为 `prompt`、`aspect_ratio`、`quality`、`output_format`；图生图再加 `image_urls`（最多 14 张）。
- `aspect_ratio`：`1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9`；`quality`：`basic`、`high`、`ultra`；`output_format`：`png` / `jpeg`。
- 成功返回 `data.taskId`；轮询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`。当 `data.state=success` 时解析 `data.resultJson`，其中 `resultUrls` 为结果 URL 数组；`fail` 为失败终态。
- 生产环境可传 `callBackUrl`，回调中同样解析 `state` 与 `resultJson`。任务和结果 URL 有时效限制，需尽快保存。
- KIE 公开定价页按 `seedream 5.0 Lite` 搜索可见：文生图与图生图均为 `$0.0275/张`。来源：[KIE 定价](https://kie.ai/pricing)。

## 官方适配参考

火山方舟页面统一端点为 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，鉴权为 API Key。页面同时描述 Lite 的文生图、单图/多图生图、组图生成、`sequential_image_generation`、`image`、`size`、`output_format`、`watermark` 等字段；模型的具体 Endpoint ID 应从火山方舟模型列表读取，不要把 APIMart/KIE 的模型 ID 直接带入官方接口。来源：[火山方舟图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh)。

## 原始链接索引

- [火山方舟官方 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh)
- [APIMart API 文档](https://docs.apimart.ai/en/api-reference/images/seedream-5-lite/generation.md)
- [APIMart 定价](https://apimart.ai/zh/pricing)
- [KIE 文生图](https://docs.kie.ai/cn/market/seedream/5-lite-text-to-image.md)
- [KIE 图片编辑](https://docs.kie.ai/cn/market/seedream/5-lite-image-to-image.md)
- [KIE 任务详情](https://docs.kie.ai/cn/market/common/get-task-detail.md)
- [KIE 定价](https://kie.ai/pricing)：公开可见，无需登录；搜索 `seedream` 获取 Lite 价格。

## Fal 适配（2026-08-21）

- 端点：[文生图](https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image/api) `bytedance/seedream/v5/lite/text-to-image`；[图片编辑](https://fal.ai/models/bytedance/seedream/v5/lite/edit/api) `bytedance/seedream/v5/lite/edit`，最多 10 张输入图。
- 参数：画布独立比例与 `2K|3K|4K`；智能比例使用 `auto_2K|auto_3K|auto_4K`，固定比例合成为宽高对象。`num_images` 和 `max_images` 各 1–6；不展示 `sync_mode`、内部 BytePlus URL 开关。
- 价格：`$0.035/实际输出图`，多图模式最终数量可能介于 `num_images` 与 `num_images × max_images`，界面按上限估算。
- 来源：[Fal 可读文档](https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image/llms.txt)。
