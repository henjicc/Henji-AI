# MiniMax H3 Max（含 Max Turbo）· Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `minimax/h3-max/{text-to-video,image-to-video,reference-to-video}`、`minimax/h3-max-turbo/{同上}` |
| 痕迹AI 模型 ID | `fal-ai-minimax-h3-max`（canonical `minimax-h3-max`），Max / Max Turbo 用「版本」切换 |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 请求参数（OpenAPI，2026-11-07 读取；Max 与 Turbo 字段基本相同）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | ≤50000 字；参考模式用「Image 1 / Video 1 / Audio 1」指代 |
| `prompt_expansion_mode` | string | **是** | `balanced` | `disabled` / `balanced`（约 1 秒）/ `quality`（最多约 30 秒） |
| `duration` | number | 否 | `5` | 0.92–15 秒，输出可能比请求长约 0.7 秒 |
| `resolution` | string | 否 | `768P` | `480P` / `768P` / `1080P`（1080P 为 768P 原生结果的潜空间精修） |
| `aspect_ratio` | string | 否 | 文生 `16:9`，参考 `adaptive` | 文生 `21:9`/`16:9`/`4:3`/`1:1`/`3:4`/`9:16`；参考另有 `adaptive`；图生无此字段（跟随图片） |
| `image_url` / `end_image_url` | string | 否 | — | 图生首帧 / 尾帧；只给尾帧也可 |
| `reference_image_urls` | array | 否 | — | ≤9 |
| `reference_video_urls` | array | 否 | — | ≤3，每段 2–15 秒，合计 ≤15 秒 |
| `reference_audio_urls` | array | 否 | — | ≤3，每段 2–15 秒，合计 ≤15 秒；图片、视频、音频合计 ≤12 个 |
| `target_audio_url` | string | 否 | — | 钉住输出配乐，未接入 |
| `reference_conditions` / `middle_image_url` / `middle_frame_time` | | 否 | | 仅 Max 参考端点部分支持；未接入 |
| `sync_mode` / `enable_safety_checker` | | 否 | | 不展示、不下发 |

响应：`{ "video": { "url" }, "expanded_prompt", "timings" }`；参考端点另有 `reference_tokens`。

## 2. 价格（模型页 pricingInfoOverride / publicEndpointBilling，2026-11-07 读取）

| 版本 / 端点 | 480P | 768P | 1080P |
|---|---|---|---|
| Max 文生 / 图生 / 参考（标准价） | $0.05/秒 | $0.08/秒 | $0.16/秒 |
| Max Turbo 文生 / 图生（标准价） | $0.025/秒 | $0.04/秒 | $0.08/秒 |
| Max Turbo 参考生视频 | $0.05/秒 | $0.08/秒 | $0.16/秒 |

- 2026-11-01 至 11-15 文生 / 图生有 7 折促销（Max $0.035/$0.056/$0.112，Turbo $0.0175/$0.028/$0.056），11-16 起恢复标准价；痕迹AI 按标准价估算。
- 参考生视频含 4096 个参考 token，超出部分另计（Turbo 页面为 $0.016/千 token），无法在提交前预估。

## 3. 适配要点

- 与现有 `fal-ai-minimax-h3`（H3，480P/768P/2K/4K，canonical `minimax-h3`）分辨率档、价格、端点都不同，新建模型而不是并进 H3 文件。
- 两个主选择器：「版本」（Max / Max Turbo，切端点前缀）与「模式」（文/图生视频、参考生视频）。
- 文/图生按图片数自动路由：0 张文生、1 张首帧、2 张首尾帧。
- `prompt_expansion_mode` 是必填字段，始终下发。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Max 文生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max/text-to-video | 否 |
| Max 图生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max/image-to-video | 否 |
| Max 参考 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max/reference-to-video | 否 |
| Turbo 文生 / 图生 / 参考 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max-turbo/text-to-video （另两个端点同理） | 否 |
| Max 价格 | https://fal.ai/models/minimax/h3-max/text-to-video | 否 |
| Max 参考价格 | https://fal.ai/models/minimax/h3-max/reference-to-video | 否 |
| Turbo 价格 | https://fal.ai/models/minimax/h3-max-turbo/text-to-video | 否 |
| Turbo 参考价格 | https://fal.ai/models/minimax/h3-max-turbo/reference-to-video | 否 |
