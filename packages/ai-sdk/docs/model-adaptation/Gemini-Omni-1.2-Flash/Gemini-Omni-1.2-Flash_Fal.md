# Gemini Omni 1.2 Flash · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `google/gemini-omni-flash/v1.2/{text-to-video,image-to-video,reference-to-video,edit,extend}` |
| 痕迹AI 模型 ID | `fal-ai-gemini-omni-1.2-flash`（canonical `gemini-omni-1.2-flash`，与 1.0 的 `fal-ai-gemini-omni-flash` 同属 `gemini-omni` 系列） |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 请求参数（OpenAPI，2026-11-07 读取）

| 端点 | 字段 |
|---|---|
| `text-to-video` | `prompt`（必填，≤20000 字）、`aspect_ratio`（`16:9`/`9:16`，默认 `16:9`）、`resolution`（`360p`/`720p`/`1080p`/`4k`，默认 `720p`）、`duration`（3–15，默认 8） |
| `image-to-video` | 上述字段 + `image_url`（必填，首帧）+ `end_image_url`（可选尾帧；给出时时长最长 10 秒） |
| `reference-to-video` | 上述文生字段 + `image_urls`（≤10）+ `reference_video_urls`（≤3，每段 ≤15 秒） |
| `edit` | `prompt`（必填）、`video_url`（必填，≤15 秒）、`resolution` |
| `extend` | `prompt`（必填）、`video_url`（必填，任意长度，模型以最后 10 秒为条件续写）、`resolution`、`duration`（3–10，默认 8） |
| `upscale`（未接） | `video_url`、`resolution`（`720p`/`1080p`/`4k`，须高于源） |

响应：`{ "video": { "url" } }`。

## 2. 价格（模型页 pricingInfoOverride / publicEndpointBilling，2026-11-07 读取）

| 分辨率 | 单价（按输出秒数） |
|---|---|
| 360p | $0.0273/秒 |
| 720p | $0.0819/秒 |
| 1080p | $0.1229/秒 |
| 4K | $0.2457/秒 |

- 含原生音频；图生的输入图、参考图与参考视频不计费。
- 编辑按编辑后的输出秒数计费（输出与源视频等长）；延长只计新生成部分，输入视频不计费。
- 放大（未接）：360p→720p 或 720p→1080p $0.041/秒，360p→1080p $0.0819/秒，720p/1080p→4K $0.1638/秒。

## 3. 适配要点

- 1.0 的现有模型只有图生与参考，且 canonical 为 `gemini-omni-video`；1.2 能力、参数与价格都不同，新建模型而不是在 1.0 文件里加版本选项。
- 一个模型、显式 `mode`：文/图生视频（0/1/2 张图自动路由）、参考生视频、视频编辑、延长视频。
- 时长按分支钳制：首尾帧与延长 ≤10 秒，其余 ≤15 秒；编辑不下发时长，计价按源视频时长（≤15 秒，未知按 8 秒估）。
- `upscale` 属于放大工具，计价依赖源分辨率，未接入。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.2/text-to-video | 否 |
| 图生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.2/image-to-video | 否 |
| 参考生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.2/reference-to-video | 否 |
| 视频编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.2/edit | 否 |
| 延长视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.2/extend | 否 |
| 放大 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/gemini-omni-flash/v1.2/upscale | 否 |
| 模型页与价格 | https://fal.ai/models/google/gemini-omni-flash/v1.2/text-to-video | 否 |
| 编辑 / 延长价格 | https://fal.ai/models/google/gemini-omni-flash/v1.2/edit 、https://fal.ai/models/google/gemini-omni-flash/v1.2/extend | 否 |
