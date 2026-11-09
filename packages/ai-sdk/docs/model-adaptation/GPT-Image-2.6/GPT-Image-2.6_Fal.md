# GPT Image 2.6 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-09 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `openai/gpt-image-2.6/{flare,sunburst}/{text-to-image,edit}` |
| 痕迹AI 模型 ID | `fal-ai-gpt-image-2.6`（canonical `gpt-image-2.6`） |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 请求参数（OpenAPI，2026-11-07 读取；Flare 与 Sunburst 字段相同）

与 [GPT Image 2.5 · Fal](../GPT-Image-2.5/GPT-Image-2.5_Fal.md) 相比新增：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `reasoning_effort` | string | `high` | `low` / `medium` / `high`；出图前的规划程度（OpenAI `complexity`），独立于 `quality` |
| `output_format` | string | `png` | 新增 `gif`（动图，文生图与编辑端点都有）与 `svg`（只在文生图端点）；选动图 / 矢量图时发送 |
| `frame_count` / `frame_duration_ms` | integer | 9 / 200 | 仅 GIF：帧数 2–16，每帧 20–2000 ms、按 10 ms 取整；`image_size` 是单帧尺寸，所有输出的所有帧共用像素预算 |
| `svg_model` | string | `gpt-6-astra` | 仅 SVG：`gpt-6-astra` / `gpt-5.5` / `gpt-5.4` / `gpt-5.6-terra` / `gpt-6-luna`，负责把参考图转成矢量路径；`num_images` 必须为 1 |
| `markup_image_url` | string | — | 仅编辑：只含标注的透明 PNG，与 `mask_url` 互斥；未接入 |

沿用字段：`prompt`（必填）、`image_size`（预设名、`{width,height}` 或 `auto`；宽高为 16 的倍数、最长边 3840、宽高比 ≤3:1、总像素 655,360–8,294,400）、`quality`（`auto/low/medium/high/xhigh/max`，默认 `high`）、`background`（`auto/transparent/opaque`）、`num_images`（1–10）、编辑端 `image_urls`（必填，≤16）、`mask_url`（白色区域重绘）。

响应：`{ "images": [{ "url", ... }] }`。

## 2. 价格（模型页 pricingInfoOverride，2026-11-07 读取）

| 类别 | 输入 | 缓存输入 | 输出 |
|---|---|---|---|
| 文本 token（每百万） | $5.00 | $1.25 | $10.00 |
| 图像 token（每百万） | $8.00 | $2.00 | $30.00 |

与 2.5 单价相同。页面称“规范尺寸费用见页面底部说明”，但抓取内容中没有该表；痕迹AI 沿用 2.5 的同型号尺寸/token 参考表（APIMart 公开表）按 $30/百万输出 token 估算，提示词与参考图输入另计。

## 3. 适配要点

- 「输出类型」图片 / 动图 / 矢量图（2026-11-09 按用户要求开放）。动图：显示帧数（2–12）与每帧时长，收起分辨率、数量、背景、遮罩；单帧取比例下不低于 655,360 像素的 16 倍数尺寸，帧数 × 单帧像素 > 8,294,400 时提交前报错并给出最多帧数（1:1 为 12 帧）；`num_images` 固定 1。矢量图：只能文生图，显示「矢量化模型」（默认 `gpt-6-astra`），`num_images` 固定 1，背景不发送。
- 估价：动图按 1:1 1K 输出 token × 全部帧总像素折算（$30/百万），加参考图每张 1536 token × $8/百万；矢量图只估参考图出图，矢量化模型文本费用不在估价内。

- 「版本」Flare / Sunburst 切端点；有图自动走 `edit`，无图走 `text-to-image`。
- 比例 + 分辨率（1K/2K/4K）换算成具体 `image_size`，智能比例按首图匹配最近比例，无图回退 1:1。
- 新增「构思深度」参数映射 `reasoning_effort`。
- 遮罩复用 GPT Image 2 已登记的遮罩创作契约，`mask_url` 通过 `runtimeConstraints.mediaFields` 上传。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Flare 文生图 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai/gpt-image-2.6/flare/text-to-image | 否 |
| Flare 编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai/gpt-image-2.6/flare/edit | 否 |
| Sunburst 文生图 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai/gpt-image-2.6/sunburst/text-to-image | 否 |
| Sunburst 编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai/gpt-image-2.6/sunburst/edit | 否 |
| 模型页与价格 | https://fal.ai/models/openai/gpt-image-2.6/flare/text-to-image | 否 |
| 尺寸/token 参考表（估算用） | https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation.md | 否 |
