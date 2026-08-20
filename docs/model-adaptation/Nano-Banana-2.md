# Nano Banana 2

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个模型；APIMart 默认路由与官方通道用平台配置区分 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示且不请求 |
| 官方接口 | 本清单未提供 Google 官方 API 链接，仅核查 APIMart 与 KIE |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | 默认 `gemini-3.1-flash-image-preview`；别名 `nano-banana-2-ext`；官方通道 `gemini-3.1-flash-image-preview-official` / `nano-banana-2` | [Gemini 3.1 Flash Image API](https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md) | Ext 默认/0.5K/1K `$0.015/张`；2K `$0.02/张`；4K `$0.025/张`；官方通道按 token 计费 | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `nano-banana-2` | [KIE Nano Banana 2](https://docs.kie.ai/cn/market/google/nanobanana2.md) | 1K `$0.04/张`；2K `$0.06/张`；4K `$0.09/张` | 价格与 API 文档无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/images/generations`；轮询 `GET /v1/tasks/{task_id}`。鉴权为 `Authorization: Bearer <API_KEY>`。
- 默认 `model=gemini-3.1-flash-image-preview`；若产品要使用官方通道，切换为 `gemini-3.1-flash-image-preview-official`。别名只用于平台路由配置，不建议写入模型通用 schema。
- 成功结果读取 `data.result.images[].url[]`；图片链接约 72 小时有效。任务失败读取 `data.error`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填；文生图或图像编辑提示词 |
| `image_urls` | URL 数组 | 参考图/编辑输入，最多 14 张；应先保证 URL 可被供应商服务端访问 |
| `size` | 比例或尺寸 | 以平台文档允许的比例/尺寸为准；不要在前端硬编码超出平台范围的值 |
| `resolution` | `1K`、`2K`、`4K` | Nano Banana 2 支持的输出档位；价格按档位变化 |
| `n` | integer | 多图输出参数；默认按平台默认值，只有产品明确需要时才暴露 |
| `official_fallback` | boolean | APIMart 路由回退控制；默认隐藏 |
| `google_search` / `google_image_search` | boolean | 联网检索能力开关；默认关闭，只有产品有联网生成需求时才开放 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。价格页同时列出 Ext 按张计费和官方通道按 token 计费；官方通道应以实时价格页和响应中的计费信息为准，不要把两种计费模型合并。

## KIE 适配

- Base URL `https://api.kie.ai`；提交 `POST /api/v1/jobs/createTask`，请求体为 `{ model: "nano-banana-2", callBackUrl?, input }`；返回 `data.taskId`。
- `input.prompt` 必填，最多 20,000 字符；`input.image_input` 为参考图数组，最多 14 张，支持 JPEG/PNG/WEBP，单张最大 30MB。
- `input.aspect_ratio` 支持 `1:1`、`2:3`、`3:2`、`1:4`、`4:1`、`3:4`、`4:3`、`4:5`、`5:4`、`1:8`、`8:1`、`9:16`、`16:9`、`21:9`、`auto`；默认 `auto`。
- `input.resolution` 为 `1K|2K|4K`，默认 1K。KIE 文档支持 `output_format=jpg|png`，但按项目约定默认不显示且不请求。
- 查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`；成功时 JSON.parse `data.resultJson` 并读取 `resultUrls`。生产环境建议传 `callBackUrl`。
- KIE 公开价格为 1K `$0.04/张`、2K `$0.06/张`、4K `$0.09/张`。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart Nano Banana 2 / Gemini 3.1 Flash Image API](https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md)：模型 ID、输入字段、分辨率、结果结构。
- [APIMart 定价](https://apimart.ai/zh/pricing)：Ext 与官方通道价格。
- [KIE Nano Banana 2 API](https://docs.kie.ai/cn/market/google/nanobanana2.md)：模型 ID、输入字段、限制与回调。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：通用创建协议。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：通用轮询协议。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `nano banana` 获取 1K/2K/4K 价格。

## Fal 适配（2026-08-21）

- 端点：[生成](https://fal.ai/models/fal-ai/nano-banana-2/api) `fal-ai/nano-banana-2`；[编辑/多模态输入](https://fal.ai/models/fal-ai/nano-banana-2/edit/api) `fal-ai/nano-banana-2/edit`。编辑端点支持图片，并可选视频、音频或 PDF 上下文。
- 参数：比例含 `auto` 与 14 个固定比例；分辨率 `0.5K|1K|2K|4K`；数量 1–4；可选联网搜索与 `minimal|high` 思考。项目固定 `limit_generations=true`，不展示或发送 `seed`、`output_format`。
- 价格：1K `$0.08/张`，0.5K/2K/4K 分别为 0.75/1.5/2 倍；联网搜索 `+$0.015`，高思考 `+$0.002`。
- 来源：[Fal 可读文档](https://fal.ai/models/fal-ai/nano-banana-2/llms.txt)。
