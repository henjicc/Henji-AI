# GPT-Image-2

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个模型；无图/有图自动路由；APIMart `n` 固定为 1 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示且不请求 |
| 官方接口 | 本清单未提供官方 GPT-Image-2 接口链接，仅核查 APIMart/KIE |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `gpt-image-2`（兼容 `gpt-image-2-ext`） | [GPT-Image-2 API](https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md) | 默认/1K `$0.0085/张`；2K `$0.014/张`；4K `$0.021/张` | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `gpt-image-2-text-to-image`、`gpt-image-2-image-to-image` | [文生图](https://docs.kie.ai/cn/market/gpt/gpt-image-2-text-to-image.md)、[图生图](https://docs.kie.ai/cn/market/gpt/gpt-image-2-image-to-image.md) | 文生图/图生图：1K `$0.03/张`、2K `$0.05/张`、4K `$0.08/张` | 价格与 API 文档无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/images/generations`；轮询 `GET /v1/tasks/{task_id}`。
- `model=gpt-image-2`；兼容别名 `gpt-image-2-ext`。成功返回任务 ID，结果读取 `data.result.images[0].url[0]`，失败读取 `data.error.message`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填；支持中文英文 |
| `n` | integer | 固定 1，不显示为用户参数 |
| `size` | `auto`、`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`5:4`、`4:5`、`16:9`、`9:16`、`2:1`、`1:2`、`3:1`、`1:3`、`21:9`、`9:21` | 只展示比例；不要把比例扩展到未被文档允许的值 |
| `resolution` | `1k`、`2k`、`4k` | 价格按分辨率档位 |
| `image_urls` | URL 数组 | 图生图输入；KIE 与 APIMart 字段名不同 |
| `official_fallback` | boolean | APIMart 路由策略字段；除非产品明确需要，否则不暴露 |
| `seed` / 负面提示词 | — | 不支持或非项目参数，绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。当前价格页列出 `GPT-IMAGE-2-EXT`：默认与 1K `$0.0085/张`、2K `$0.014/张`、4K `$0.021/张`。

## KIE 适配

- Base URL `https://api.kie.ai`；提交 `POST /api/v1/jobs/createTask`。
- 无图使用 `model=gpt-image-2-text-to-image`；有图使用 `model=gpt-image-2-image-to-image`，图生图字段为 `input.input_urls`，最多 16 张。
- 两个 KIE 端点都支持 `prompt`（最多 20,000 字符）、`aspect_ratio`（含 `auto`、`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`5:4`、`4:5`、`16:9`、`9:16`、`2:1`、`1:2`、`3:1`、`1:3`、`21:9`、`9:21`）和 `resolution=1K|2K|4K`。
- 创建返回 `data.taskId`；查询 `GET /api/v1/jobs/recordInfo?taskId=...`；成功后 JSON.parse `data.resultJson` 并读取 `resultUrls`。
- KIE 定价页按 `gpt image` 搜索可见文生图和图生图的 1K/2K/4K 价格，两种模式价格一致。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart GPT-Image-2 API](https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md)
- [APIMart 定价](https://apimart.ai/zh/pricing)
- [KIE GPT Image 2 文生图](https://docs.kie.ai/cn/market/gpt/gpt-image-2-text-to-image.md)
- [KIE GPT Image 2 图生图](https://docs.kie.ai/cn/market/gpt/gpt-image-2-image-to-image.md)
- [KIE 任务详情](https://docs.kie.ai/cn/market/common/get-task-detail.md)
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `gpt image`。
