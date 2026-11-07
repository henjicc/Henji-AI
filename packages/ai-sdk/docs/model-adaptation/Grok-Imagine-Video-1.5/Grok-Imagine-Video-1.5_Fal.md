# Grok Imagine Video 1.5 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `xai/grok-imagine-video/v1.5/{text-to-video,image-to-video,reference-to-video}`、`xai/grok-imagine-video/v1.5/lite/{text-to-video,image-to-video}` |
| 痕迹AI 模型 ID | `fal-ai-grok-imagine-video-1.5`（canonical `grok-imagine-video-1.5`），标准 / Lite 用「版本」切换 |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 请求参数（OpenAPI，2026-11-07 读取）

| 端点 | 字段 |
|---|---|
| 文生（标准 / Lite） | `prompt`（必填，≤4096 字）、`duration`（1–15，默认 6）、`aspect_ratio`（`16:9`/`4:3`/`3:2`/`1:1`/`2:3`/`3:4`/`9:16`，默认 `16:9`）、`resolution`（`480p`/`720p`/`1080p`，默认 `720p`） |
| 图生（标准 / Lite） | `prompt`（必填）、`image_url`（必填）、`duration`、`resolution`；无 `aspect_ratio` |
| 参考生视频（仅标准） | `prompt`（必填，用 `<IMAGE_0>` 等引用）、`reference_image_urls`（1–7）、`duration`（默认 8）、`aspect_ratio`、`resolution`（**只有 `480p`/`720p`**，默认 `480p`） |

`enable_safety_checker` 不展示、不下发。响应：`{ "video": { "url" } }`。

## 2. 价格（模型页 pricingInfoOverride，2026-11-07 读取）

| 版本 | 480p | 720p | 1080p | 图片附加 |
|---|---|---|---|---|
| 标准 | $0.08/秒 | $0.14/秒 | $0.25/秒 | 每张输入/参考图 +$0.01（1–7 张）；参考音频不另收 |
| Lite | $0.02/秒 | $0.03/秒 | $0.14/秒 | 图生每张输入图 +$0.01 |

## 3. 适配要点

- 两个主选择器：「版本」（标准 / Lite）与「模式」（文/图生视频、参考生视频；Lite 时隐藏模式，只有文/图生）。
- 文/图生按是否有图自动路由。
- 参考生视频不支持 1080p：展示层联动裁掉选项，builder 也会回落到 720p。
- 智能比例按首图比例匹配最近选项，无图回退 16:9。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 标准文生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=xai/grok-imagine-video/v1.5/text-to-video | 否 |
| 标准图生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=xai/grok-imagine-video/v1.5/image-to-video | 否 |
| 参考生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=xai/grok-imagine-video/v1.5/reference-to-video | 否 |
| Lite 文生 / 图生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=xai/grok-imagine-video/v1.5/lite/text-to-video （图生同理） | 否 |
| 标准版价格 | https://fal.ai/models/xai/grok-imagine-video/v1.5/text-to-video | 否 |
| Lite 价格 | https://fal.ai/models/xai/grok-imagine-video/v1.5/lite/image-to-video | 否 |
