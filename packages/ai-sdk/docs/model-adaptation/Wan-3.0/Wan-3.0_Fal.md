# Wan 3.0（含 Prime）· Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `alibaba/wan-3.0/{text-to-video,image-to-video,reference-to-video}`、`alibaba/wan-3.0-prime/{同上}` |
| 痕迹AI 模型 ID | `fal-ai-wan-3.0`（canonical `wan-3.0`），标准 / Prime 用「版本」切换 |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 请求参数（OpenAPI，2026-11-07 读取；标准与 Prime 字段相同）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `prompt` | string | 文生必填 | — | 最长 20000 字；参考模式用「Image 1 / Video 1」按位置指代 |
| `resolution` | string | 否 | `1080p` | `480p` / `720p` / `1080p` |
| `aspect_ratio` | string | 否 | `adaptive` | `adaptive` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` |
| `duration` | integer \| null | 否 | `5` | 2–30；`null` 为智能时长（未接入） |
| `audio` | boolean | 否 | `true` | 生成声音 |
| `enable_prompt_expansion` | boolean | 否 | `true` | 关闭可省 20–60 秒，但通常降低质量 |
| `enable_thinking` | boolean | 否 | `false` | 生成前推理 |
| `seed` / `enable_safety_checker` | | 否 | | 不展示、不下发 |
| `start_image_url` | string | 图生必填 | — | 首帧 |
| `end_image_url` | string | 否 | — | 尾帧，需要首帧 |
| `reference_image_urls` | array | 参考 | — | 最多 10 |
| `reference_video_urls` | array | 参考 | — | 最多 5，合计 ≤15 秒，每段 ≥16fps；**输入视频时长另计费** |
| `reference_audio_urls` | array | 参考 | — | 最多 5，合计 ≤15 秒 |
| `web_url` / `file_url` | string | 参考 | — | 需要 `enable_thinking=true`；未接入 |

响应：`{ "video": { "url" }, "seed", "duration", "actual_prompt" }`。

## 2. 价格（模型页 pricingInfoOverride，2026-11-07 读取；页面注明价格可能调整）

| 版本 | 480p | 720p | 1080p |
|---|---|---|---|
| 标准 | $0.05/秒 | $0.10/秒 | $0.20/秒 |
| Prime | $0.068/秒 | $0.14/秒 | $0.28/秒 |

参考生视频的参考视频输入时长与输出时长一起计费。

## 3. 适配要点

- 一个模型、两个主选择器：「版本」（标准 / Prime，切端点前缀）与「模式」（文/图生视频、参考生视频）。
- 文/图生视频按图片数自动路由：0 张文生、1 张首帧、2 张首尾帧。
- 智能比例下发 `adaptive`，交给平台按素材与提示词决定。
- 计价：`单价 × (输出时长 + 参考视频总时长)`。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 标准文生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=alibaba/wan-3.0/text-to-video | 否 |
| 标准图生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=alibaba/wan-3.0/image-to-video | 否 |
| 标准参考生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=alibaba/wan-3.0/reference-to-video | 否 |
| Prime 文生 / 图生 / 参考 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=alibaba/wan-3.0-prime/text-to-video （另两个端点同理） | 否 |
| 标准版价格 | https://fal.ai/models/alibaba/wan-3.0/text-to-video | 否 |
| Prime 价格 | https://fal.ai/models/alibaba/wan-3.0-prime/text-to-video | 否 |
