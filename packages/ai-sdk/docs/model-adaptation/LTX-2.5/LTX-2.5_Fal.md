# LTX-2.5 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `lightricks/ltx-2.5/{text-to-video,image-to-video,audio-to-video}/{pro,fast}` |
| 痕迹AI 模型 ID | `fal-ai-ltx-2.5`（canonical `ltx-2.5`），与 `fal-ai-ltx-2.3` 并存 |
| 接口形态 | Fal 队列异步（`queue.fal.run`），与其他 Fal 模型同协议 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与端点

| 能力 | Pro | Fast |
|---|---|---|
| 文生视频 | `lightricks/ltx-2.5/text-to-video/pro` | `lightricks/ltx-2.5/text-to-video/fast` |
| 图生视频 / 首尾帧 | `lightricks/ltx-2.5/image-to-video/pro` | `lightricks/ltx-2.5/image-to-video/fast` |
| 音频生视频 | `lightricks/ltx-2.5/audio-to-video/pro` | `lightricks/ltx-2.5/audio-to-video/fast` |

前缀是 `lightricks/`（2.3 是 `fal-ai/ltx-2.3`）。探测为 404：无后缀的文生 / 图生、`extend-video`、`retake-video`、`keyframes-to-video`、`video-to-video`。即 2.5 没有延长与重拍。另有后处理端点 `upscale`、`hdr`、`alpha-gen`、`reframe`（video-to-video），不在本模型范围。

## 2. 请求参数（OpenAPI，2026-11-14 读取）

### 2.1 文生视频 / 图生视频

| 字段 | 类型 | 必填 | 默认 | Pro | Fast |
|---|---|---|---|---|---|
| `prompt` | string | 是 | — | 1–5000 字符 | 同 |
| `image_url` | string | 图生必填 | — | 首帧 | 同 |
| `end_image_url` | string \| null | 否 | — | 尾帧，给出即首尾帧过渡 | 同 |
| `duration` | integer \| `"auto"` | 否 | `auto` | `6` `8` `10` `auto` | `6`–`20` 偶数 + `auto`；720p/1080p 下 24/25 FPS 最长 20 秒、48/50 FPS 最长 10 秒；1440p/2160p 最长 10 秒 |
| `resolution` | enum | 否 | `1080p` | `720p` `1080p` | `720p` `1080p` `1440p` `2160p` |
| `fps` | integer | 否 | `25` | `24` `25` `50` | `24` `25` `48` `50` |
| `aspect_ratio` | enum | 否 | 文生 `16:9`，图生 `auto` | 文生 `16:9` `9:16`；图生另有 `auto`（按首图） | 同 |
| `generate_audio` | boolean | 否 | `true` | | |
| `camera_motion` | enum \| null | 否 | 不传 | `dolly_in` `dolly_out` `dolly_left` `dolly_right` `jib_up` `jib_down` `static` `focus_shift` | 同 |

没有 `seed`。

### 2.2 音频生视频

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `audio_url` | string | 是 | — | 2–20 秒；Pro 最长 10 秒 |
| `image_url` | string \| null | 否 | — | 首帧；不传时 `prompt` 必填 |
| `prompt` | string \| null | 无图时必填 | — | 1–5000 字符 |
| `aspect_ratio` | enum | 否 | `auto` | `auto` / `16:9` / `9:16` |
| `enable_safety_checker` | boolean | 否 | `true` | 不展示、不下发 |

没有 `duration`、`resolution`、`fps`、`generate_audio`、`camera_motion`。

## 3. 响应结构

`{ "video": VideoFile }`，`url` 必有，可选 `content_type`、`file_name`、`file_size`、`width`、`height`、`fps`、`duration`、`num_frames`。

## 4. 价格（模型页 llms.txt，2026-11-14 读取）

| 端点 | 720p | 1080p | 1440p | 2160p |
|---|---|---|---|---|
| 文生 / 图生 Pro | $0.12/秒 | $0.17/秒 | — | — |
| 文生 / 图生 Fast | $0.09/秒 | $0.13/秒 | $0.19/秒 | $0.30/秒 |
| 音频生视频 Pro | | $0.17/秒输入音频 | | |
| 音频生视频 Fast | | $0.13/秒输入音频 | | |

原生音频已含在价格内，音频开关不影响价格。

## 5. 适配要点

- 独立模型（不并入 2.3）：端点集合不是 2.3 的超集（缺延长 / 重拍），价格约为 2.3 的 2 倍，Fal 未写明取代关系。
- 写法照 LTX-2.3：显式 `falLtx25Mode`（文/图生视频：0 张文生、1 张首帧、2 张首尾帧自动路由；音频生视频），「快速模式」开关（默认开）切 `/fast` 与 `/pro`。
- 时长发确定秒数，不发 `auto`（`auto` 时秒数事先未知，无法估价）。展示层联动：Pro 收回到 720p/1080p 与 24/25/50 FPS；非“快速 + 720p/1080p + 24/25 FPS”时隐藏 12–20 秒；builder 对不合法的长时长组合直接报错，不静默改时长。
- 智能比例：有图发 `auto`，无图回退 `16:9`（与 2.3 一致）。
- `camera_motion` 是低频参数，放在参数最后，默认“自动”（不下发），只在文/图生视频显示。
- 音频生视频估价 = 音频时长 × 档位单价，时长由 `pricing.mediaContext` 补进 `__audioDurationSeconds`；读不到时按档位上限（Pro 10 秒、Fast 20 秒）估。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生 Pro schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=lightricks/ltx-2.5/text-to-video/pro | 否 |
| 文生 Fast schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=lightricks/ltx-2.5/text-to-video/fast | 否 |
| 图生 Pro schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=lightricks/ltx-2.5/image-to-video/pro | 否 |
| 图生 Fast schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=lightricks/ltx-2.5/image-to-video/fast | 否 |
| 音频生视频 Pro schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=lightricks/ltx-2.5/audio-to-video/pro | 否 |
| 音频生视频 Fast schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=lightricks/ltx-2.5/audio-to-video/fast | 否 |
| 文生 Pro 说明与价格 | https://fal.ai/models/lightricks/ltx-2.5/text-to-video/pro/llms.txt | 否 |
| 文生 Fast 说明与价格 | https://fal.ai/models/lightricks/ltx-2.5/text-to-video/fast/llms.txt | 否 |
| 图生 Pro 说明与价格 | https://fal.ai/models/lightricks/ltx-2.5/image-to-video/pro/llms.txt | 否 |
| 图生 Fast 说明与价格 | https://fal.ai/models/lightricks/ltx-2.5/image-to-video/fast/llms.txt | 否 |
| 音频生视频 Pro 说明与价格 | https://fal.ai/models/lightricks/ltx-2.5/audio-to-video/pro/llms.txt | 否 |
| 音频生视频 Fast 说明与价格 | https://fal.ai/models/lightricks/ltx-2.5/audio-to-video/fast/llms.txt | 否 |
| 端点枚举 | https://fal.ai/api/models?keywords=ltx-2.5&limit=100 | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
