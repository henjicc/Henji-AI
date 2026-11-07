# FLUX 3 Video · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | Fal |
| 项目模型 ID | `fal-flux-3-video`（通用标识 `flux-3-video`，与 APIMart 一致） |
| 平台端点 | 标准版 `blackforestlabs/flux-3/{text-to-video,image-to-video,extend-video,edit-video}`；Max `blackforestlabs/flux-3-max/{text-to-video,image-to-video}`；草稿 `blackforestlabs/flux-3/{text-to-video,image-to-video,extend-video}/draft`、`blackforestlabs/flux-3/draft-enhance` |
| 接口形态 | Fal 队列（提交 → status → result） |
| 文档 / 价格可见性 | 公开，无需登录（各端点 `llms.txt` 同时含 schema 与价格） |

## 1. 端点探测

按《文档采集手册》对 `https://fal.ai/models/<endpoint>/llms.txt` 探测（2026-11-07）：

- 200：上表全部端点。
- 404：`flux-3/video-to-video`、`flux-3/video-continuation`、`flux-3/reference-to-video`、`flux-3-max/{video-to-video,extend-video,reference-to-video}`、`flux-3-max/text-to-video/draft`、`flux-3-max/extend-video/draft`、`flux-3/enhance*`。
- FLUX 3 Max 页面说明它是“fal 对 FLUX 3 Video 的后训练变体，提示词遵循与画质更好、延迟更低”。

## 2. 各端点字段

结果统一为 `video: File`（`video.url`），另有 `seed`；Max 额外 `timings`；草稿端点额外 `draft_cache: File | null`（OpenAPI：加密的持久缓存包，传给 `draft-enhance` 做全质量渲染；合作方没返回缓存包时为空）。`draft-enhance` 输入只有 `draft_cache_url`（必填，URL 或 data URI）与 `safety_tolerance`，输出只有 `video: File`，沿用草稿的种子与运动、不重新规划。

| 字段 | t2v / i2v | extend-video | edit-video | Max t2v / i2v | 草稿 t2v/i2v/extend |
|---|---|---|---|---|---|
| `prompt` | 必填 | 必填 | 必填 | 必填 | 必填 |
| `image_url` | i2v 必填（单张首帧，PNG/JPEG/WebP） | — | — | i2v 必填 | i2v 必填（URL 或 data URI） |
| `end_image_url` | — | — | — | i2v 可选（尾帧） | — |
| `video_url` | — | 必填，MP4 < 50MB、< 15 秒 | 必填，MP4 < 50MB、< 15 秒 | — | extend 必填，≤ 50 MiB |
| `aspect_ratio` | `auto`(默认) `21:9` `2:1` `16:9` `4:3` `1:1` `3:4` `9:16` | 同左 | — | 同左（`auto`：文生 16:9、图生跟随首图） | 同左 |
| `resolution` | `720p`(默认) `1080p` `1440p` `2160p` | 同左 | — | `720p`(默认) `1080p` `2K` `4K` | — |
| `duration` | `auto`(默认) / 5–20 | 同左 | — | 5–20，默认 5 | `auto` / 5–20 |
| `generate_audio` | 默认 true | 默认 true | — | 默认 true | 默认 true |
| `safety_tolerance` | 0–4，默认 2 | 同左 | 同左 | — | 同左 |
| `reasoning_level` | — | — | — | `low` / `high`(默认)，越高越慢 | — |
| `seed` | — | — | — | 可选 | — |
| `draft_cache_url` | — | — | — | — | 仅 `draft-enhance` 必填 |

`edit-video` 按提示词重绘输入视频，保留运动、节奏与构图。

## 3. 价格（2026-11-07 各端点 llms.txt）

| 端点 | 单价 |
|---|---|
| 标准 t2v / i2v | 720p $0.17/秒、1080p $0.29/秒、2K(1440p) $0.32/秒、4K(2160p) $0.47/秒 |
| extend-video | 720p $0.41/秒、1080p $0.53/秒（2K/4K 未公布价格） |
| edit-video | $0.03/秒（720p，按生成视频秒数） |
| Max t2v / i2v | 标准价 720p $0.17/秒、1080p $0.29/秒；2026-11-07 前 75% 折扣（$0.0425/$0.0725），11-08 至 11-22 五折（$0.085/$0.145），11-23 起恢复标准价；2K/4K 未公布价格 |
| 草稿 t2v / i2v | $0.06/秒（720p） |
| 草稿 extend | $0.12/秒（720p） |
| draft-enhance | $0.29/秒（1080p 全质量） |

## 4. 项目适配

- 一个产品模型：版本（标准 / Max）与模式（文/图生视频、视频续写、视频编辑）都 `role: 'mode'`；Max 只有文/图生视频，选 Max 时隐藏模式。
- 文/图生视频按是否有图自动切 `text-to-video` / `image-to-video`；标准版图生只用 1 张首帧，Max 第 2 张图映射 `end_image_url`（因此打 `start-end-frame`）。
- 比例只在纯文生视频显示，智能回退 `16:9`；有首帧发 `auto` 跟随图片。
- 分辨率：标准 t2v/i2v 四档；续写与 Max 只开放 720p/1080p（其他档位没有公布价格，展示联动裁剪并重置，builder 回退 720p）。编辑不发分辨率、时长、音频。
- 时长固定 5–20 整数，默认 5，不发 `auto`（按秒计费需要确定秒数）。
- 计价：时长 × 档位单价；编辑按输入视频时长 × $0.03（读不到时长按上限 15 秒估）；Max 按 11-23 起的标准价预估，标为估算价。
- 草稿：开关参数 `falFlux3VideoDraft`（默认关），只在标准版文/图生视频与续写显示（Max 与视频编辑没有草稿端点）；开启时路由到对应 `/draft` 端点，不发 `resolution`（草稿固定 720p），分辨率参数隐藏；计价 $0.06/秒、续写草稿 $0.12/秒。
- 草稿转正片：模型声明续接 `finalize-draft`（仅草稿结果可用），完成时从结果 metadata 的 `draft_cache.url` 取缓存地址作为引用（为空则不能转正片）；续接参数关掉草稿、分辨率记为 1080p，直接提交。请求走 `blackforestlabs/flux-3/draft-enhance`，只发 `draft_cache_url`；计价 $0.29/秒 × 草稿时长。缓存地址只在请求构建里使用，不进入界面。
- 结果解析：Fal provider 收集媒体地址时跳过 `draft_cache`，避免缓存包被当成第二段视频；它仍原样保留在 metadata 中。
- 不显示、不请求：`safety_tolerance`（平台默认 2）、Max 的 `seed`。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema 与价格 | https://fal.ai/models/blackforestlabs/flux-3/text-to-video/llms.txt | 否 |
| 图生视频 schema 与价格 | https://fal.ai/models/blackforestlabs/flux-3/image-to-video/llms.txt | 否 |
| 视频续写 schema 与价格 | https://fal.ai/models/blackforestlabs/flux-3/extend-video/llms.txt | 否 |
| 视频编辑 schema 与价格 | https://fal.ai/models/blackforestlabs/flux-3/edit-video/llms.txt | 否 |
| Max 文生视频 | https://fal.ai/models/blackforestlabs/flux-3-max/text-to-video/llms.txt | 否 |
| Max 图生视频 | https://fal.ai/models/blackforestlabs/flux-3-max/image-to-video/llms.txt | 否 |
| 草稿文生 / 图生 / 续写 | https://fal.ai/models/blackforestlabs/flux-3/text-to-video/draft/llms.txt 、 …/image-to-video/draft/llms.txt 、 …/extend-video/draft/llms.txt | 否 |
| 草稿增强 | https://fal.ai/models/blackforestlabs/flux-3/draft-enhance/llms.txt | 否 |
| OpenAPI（草稿与草稿增强，含 `draft_cache` 输出结构） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=blackforestlabs/flux-3/text-to-video/draft 、 …?endpoint_id=blackforestlabs/flux-3/draft-enhance | 否 |
| OpenAPI（各端点） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=blackforestlabs/flux-3/text-to-video | 否 |
