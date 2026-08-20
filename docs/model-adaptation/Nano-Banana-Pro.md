# Nano Banana Pro

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个模型；APIMart Ext 与官方通道作为供应商路由配置区分 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示且不请求 |
| 官方接口 | 本清单未提供 Google 官方 API 链接，仅核查 APIMart 与 KIE |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | 默认 `gemini-3-pro-image-preview`；别名 `nano-banana-pro-ext`；官方通道 `gemini-3-pro-image-preview-official` / `nano-banana-pro` | [Gemini 3 Pro Image API](https://docs.apimart.ai/en/api-reference/images/gemini-3-pro/generation.md) | Ext 默认 `$0.03/张`；4K `$0.04/张`；官方通道按 token 计费 | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `nano-banana-pro` | [KIE Nano Banana Pro（切换至 API Tab）](https://kie.ai/nano-banana-pro) | 1K/2K `$0.09/张`；4K `$0.12/张` | 模型页、API Tab 与价格无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/images/generations`；轮询 `GET /v1/tasks/{task_id}`。请求使用 Bearer API Key。
- 默认使用 `model=gemini-3-pro-image-preview`；官方通道使用 `gemini-3-pro-image-preview-official`。Ext 与官方通道的计费单位不同，应由供应商配置决定，不能在公共模型 schema 中混用。
- 成功结果读取 `data.result.images[].url[]`；图片链接约 72 小时有效。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填；支持文生图和图像编辑 |
| `image_urls` | URL 数组 | 参考图/编辑输入，最多 8 张；URL 必须可由 APIMart 服务端访问 |
| `size` | `auto` 及平台支持的比例 | 默认用 `auto`；具体比例以 API 文档为准 |
| `resolution` | `1K`、`2K`、`4K` | 输出清晰度档位；4K 价格不同 |
| `n` | integer | 多图输出；默认不显示，除非产品有明确需求 |
| `official_fallback` | boolean | APIMart 路由策略字段，默认隐藏 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。页面列出 `NANO-BANANA-PRO-EXT` 的按张价格；官方通道另按 token 计费，正式接入时以实时价格页为准。

## KIE 适配

- KIE 的专属内容不在 `docs.kie.ai` 文档索引中，而是在 [Nano Banana Pro 模型页](https://kie.ai/nano-banana-pro)的 `API` Tab；该 Tab 无需登录即可查看。
- Base URL `https://api.kie.ai`；提交 `POST /api/v1/jobs/createTask`，`model=nano-banana-pro`，返回 `data.taskId`。
- `input.prompt` 必填；`input.image_input` 最多 8 张 JPEG/PNG/WEBP，单张最大 30MB；`input.aspect_ratio` 使用模型页下拉允许值；`input.resolution=1K|2K|4K`。
- API Tab 示例还包含 `output_format=png|jpg`，按项目约定默认不显示且不请求。
- 查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`；成功后 JSON.parse `data.resultJson` 并读取 `resultUrls`。可选 `callBackUrl`。
- KIE 公开价格为 1K/2K `$0.09/张`、4K `$0.12/张`。来源：[模型页价格说明](https://kie.ai/nano-banana-pro)与[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart Nano Banana Pro / Gemini 3 Pro Image API](https://docs.apimart.ai/en/api-reference/images/gemini-3-pro/generation.md)：模型 ID、参考图、分辨率与响应。
- [APIMart 定价](https://apimart.ai/zh/pricing)：Ext 与官方通道价格。
- [KIE Nano Banana Pro 模型页](https://kie.ai/nano-banana-pro)：价格、参数表；切换 `API` Tab 查看请求示例与模型 ID。
- [KIE Nano Banana Pro API Tab 直达内容](https://kie.ai/api/docs-proxy/market/google/pro-image-to-image?theme=light)：公开 API 示例。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：通用创建协议。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：通用轮询协议。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `nano banana`。
