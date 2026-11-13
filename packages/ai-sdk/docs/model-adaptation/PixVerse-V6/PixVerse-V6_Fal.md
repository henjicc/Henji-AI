# PixVerse V6 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | 标准 `fal-ai/pixverse/v6/{text-to-video,image-to-video,transition,extend}`；Max `pixverse/v6/max/{text-to-video,image-to-video}`（Max 无 `fal-ai/` 前缀） |
| 痕迹AI 模型 ID | `fal-ai-pixverse-v6`（canonical `pixverse-v6`） |
| 接口形态 | Fal 队列异步（`queue.fal.run`），与其他 Fal 模型同协议 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与端点

| 能力 | 标准 | Max |
|---|---|---|
| 文生视频 | `fal-ai/pixverse/v6/text-to-video` | `pixverse/v6/max/text-to-video` |
| 首帧图生视频 | `fal-ai/pixverse/v6/image-to-video` | `pixverse/v6/max/image-to-video` |
| 首尾帧 | `fal-ai/pixverse/v6/transition` | 无 |
| 视频续写 | `fal-ai/pixverse/v6/extend` | 无 |

探测为 404：Max 的 transition / extend / lipsync / sound-effects / reference-to-video / effects，以及 V6 的 lipsync / sound-effects / reference-to-video / effects / swap。

## 2. 请求参数（OpenAPI，2026-11-14 读取；Max 与标准同名端点字段完全相同）

| 字段 | 文生 | 图生 | 首尾帧 | 续写 | 类型 / 默认 / 取值 |
|---|---|---|---|---|---|
| `prompt` | 必填 | 必填 | 必填 | 必填 | string，上限 2048 UTF-8 字节 |
| `image_url` | — | 必填 | — | — | 首帧 |
| `first_image_url` / `end_image_url` | — | — | 必填 | — | 首帧 / 尾帧 |
| `video_url` | — | — | — | 必填 | 要续写的视频 |
| `aspect_ratio` | ✔ | — | ✔ | — | 默认 `16:9`；`16:9` `4:3` `1:1` `3:4` `9:16` `2:3` `3:2` `21:9` |
| `resolution` | ✔ | ✔ | ✔ | ✔ | 默认 `720p`；`360p` `540p` `720p` `1080p` |
| `duration` | ✔ | ✔ | ✔ | ✔ | integer，默认 5，1–15 |
| `style` | ✔ | ✔ | ✔ | ✔ | 可不传；`anime` `3d_animation` `clay` `comic` `cyberpunk` |
| `thinking_type` | ✔ | ✔ | ✔ | — | 可不传；`enabled` `disabled` `auto` |
| `generate_audio_switch` | ✔ | ✔ | ✔ | ✔ | boolean，默认 `false` |
| `generate_multi_clip_switch` | ✔ | ✔ | ✔ | — | boolean，默认 `false` |
| `negative_prompt`、`seed` | ✔ | ✔ | ✔ | ✔ | 不展示、不下发 |
| `enable_safety_checker` | ✔ | ✔ | ✔ | — | 不展示、不下发 |

OpenAPI 与模型页均未写输入图片、视频的格式与大小限制（未查到）。

## 3. 响应结构

`{ "video": File }`，`url` 必有，其余文件字段可选；与仓库现有 Fal 视频模型同一解析路径。

## 4. 价格（模型页 llms.txt，2026-11-14 读取，按生成秒数）

| 档 | 分辨率 | 无音频 /秒 | 有音频 /秒 |
|---|---|---|---|
| 标准（文生、图生、首尾帧、续写同价） | 360p | $0.025 | $0.035 |
| | 540p | $0.035 | $0.045 |
| | 720p | $0.045 | $0.060 |
| | 1080p | $0.090 | $0.115 |
| Max（文生、图生） | 360p | $0.054 | $0.081 |
| | 540p | $0.081 | $0.099 |
| | 720p | $0.099 | $0.135 |
| | 1080p | $0.198 | $0.252 |

页面示例：标准 5 秒 720p 无音频 $0.225、有音频 $0.300；Max 8 秒 1080p 有音频 $2.016。Max 页写明多镜头无附加费；标准页未提附加费。

## 5. 适配要点

- 标准与 Max 是同一模型（V6）的两个档：字段、枚举、默认值与结果结构完全相同，只有端点前缀与单价不同，按“同模型多端点归并”做成一个模型，用 `falPixverseV6Version`（`role: mode`）切换。
- 显式 `falPixverseV6Mode`：「文/图生视频」（0/1/2 张图自动走文生 / 图生 / 首尾帧）与「视频续写」。续写引入视频输入，按规则升级为显式模式。
- Max 没有首尾帧与续写：选 Max 时隐藏模式、输入限制收为最多 1 张图，selector 只走 Max 文生 / 图生，builder 拒绝 2 张图。
- 比例只在文生与首尾帧显示和下发（图生跟随首图、续写跟随原视频）；智能比例本地换成具体比例（有图取首图最接近，无图 1:1）。
- 时长按官方 1–15 整数秒发送；生成音频默认开（与 V5.5 一致，官方默认关），开关直接决定单价。
- 续写只发官方续写字段（不发比例、思考模式、多镜头）。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 标准文生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/pixverse/v6/text-to-video | 否 |
| 标准图生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/pixverse/v6/image-to-video | 否 |
| 首尾帧 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/pixverse/v6/transition | 否 |
| 续写 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/pixverse/v6/extend | 否 |
| Max 文生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=pixverse/v6/max/text-to-video | 否 |
| Max 图生 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=pixverse/v6/max/image-to-video | 否 |
| 标准文生说明与价格 | https://fal.ai/models/fal-ai/pixverse/v6/text-to-video/llms.txt | 否 |
| 标准图生说明与价格 | https://fal.ai/models/fal-ai/pixverse/v6/image-to-video/llms.txt | 否 |
| 首尾帧说明与价格 | https://fal.ai/models/fal-ai/pixverse/v6/transition/llms.txt | 否 |
| 续写说明与价格 | https://fal.ai/models/fal-ai/pixverse/v6/extend/llms.txt | 否 |
| Max 文生说明与价格 | https://fal.ai/models/pixverse/v6/max/text-to-video/llms.txt | 否 |
| Max 图生说明与价格 | https://fal.ai/models/pixverse/v6/max/image-to-video/llms.txt | 否 |
| 端点枚举 | https://fal.ai/api/models?keywords=pixverse&limit=100 | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
