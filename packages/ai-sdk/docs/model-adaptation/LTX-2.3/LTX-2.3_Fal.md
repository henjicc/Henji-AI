# LTX-2.3 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/ltx-2.3/{text-to-video,image-to-video}[/fast]`、`fal-ai/ltx-2.3/extend-video`、`fal-ai/ltx-2.3/retake-video`、`fal-ai/ltx-2.3/audio-to-video` |
| 痕迹AI 模型 ID | `fal-ai-ltx-2.3`（canonical `ltx-2.3`），取代已下线的 `fal-ai-ltx-2` |
| 接口形态 | Fal 队列异步（`queue.fal.run`），与其他 Fal 模型同协议 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与端点

| 能力 | 标准（Pro） | 快速（Fast） |
|---|---|---|
| 文生视频 | `fal-ai/ltx-2.3/text-to-video` | `fal-ai/ltx-2.3/text-to-video/fast` |
| 图生视频 / 首尾帧 | `fal-ai/ltx-2.3/image-to-video` | `fal-ai/ltx-2.3/image-to-video/fast` |
| 延长视频 | `fal-ai/ltx-2.3/extend-video` | — |
| 视频重拍（局部重生成） | `fal-ai/ltx-2.3/retake-video` | — |
| 音频生视频 | `fal-ai/ltx-2.3/audio-to-video`（单一端点，不分标准/快速） | — |

同家族另有 `reframe`、`ltx-2.3-quality/*`、`ltx-2.3-22b/*` 端点，本次未接入（见第 6 节）。

## 2. 请求参数（OpenAPI，2026-11-07 读取）

### 2.1 文生视频 / 图生视频

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | |
| `image_url` | string | 图生必填 | — | 首帧 |
| `end_image_url` | string | 否 | — | 尾帧，给出即生成首尾帧过渡（标准与快速图生都支持） |
| `duration` | integer | 否 | `6` | 标准：`6/8/10`；快速：`6/8/10/12/14/16/18/20`，**超过 10 秒只支持 25 FPS + 1080p** |
| `resolution` | string | 否 | `1080p` | `1080p` / `1440p` / `2160p` |
| `fps` | integer | 否 | `25` | `24` / `25` / `48` / `50` |
| `aspect_ratio` | string | 否 | 文生 `16:9`，图生 `auto` | 文生 `16:9` / `9:16`；图生另有 `auto`（按首图） |
| `generate_audio` | boolean | 否 | `true` | |
| `enable_safety_checker` | boolean | 否 | `true` | 不展示、不下发 |

### 2.2 延长视频 `extend-video`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `video_url` | string | 是 | — | |
| `prompt` | string | 否 | — | 延长部分的描述 |
| `duration` | number | 否 | `5` | 2–20 秒 |
| `mode` | string | 否 | `end` | `end` 接在结尾 / `start` 加在开头 |
| `context` | number | 否 | 自动 | 用作上下文的秒数（1–20）；不展示、不下发 |

### 2.3 视频重拍 `retake-video`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `video_url` | string | 是 | — | |
| `prompt` | string | 是 | — | |
| `start_time` | number | 否 | `0` | 0–20 秒 |
| `duration` | number | 否 | `5` | 2–20 秒 |
| `retake_mode` | string | 否 | `replace_audio_and_video` | `replace_audio` / `replace_video` / `replace_audio_and_video` |

### 2.4 音频生视频 `audio-to-video`

OpenAPI `required` 只有 `audio_url`；字段顺序 `audio_url, image_url, prompt, guidance_scale, aspect_ratio, enable_safety_checker`。没有 `duration`、`resolution`、`fps`、`generate_audio`、`seed` 字段。

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `audio_url` | string | 是 | — | 2–20 秒（描述另写“pro models support a maximum of 10 seconds”，本端点未标明属于哪一档）；模型页接受 mp3 / ogg / wav / m4a / aac |
| `image_url` | string \| null | 否 | — | 首帧图；不传时 `prompt` 必填 |
| `prompt` | string \| null | 无图时必填 | — | 1–5000 字符；有图时描述如何让图动起来 |
| `guidance_scale` | number \| null | 否 | 官方说明：文生 5、有图 9 | 1–50；不展示、不下发，交给官方按有无图取默认 |
| `aspect_ratio` | string | 否 | `auto` | `auto` / `16:9` / `9:16`；`auto` 按首帧图，无图回退 16:9 |
| `enable_safety_checker` | boolean | 否 | `true` | 不展示、不下发 |

## 3. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" } }
```

音频生视频的 `video` 是 `VideoFile`：必有 `url`，可选 `content_type`、`file_name`、`file_size`、`width`、`height`、`fps`、`duration`、`num_frames`，与其他端点同一解析路径。

## 4. 价格（模型页 pricingInfoOverride，2026-11-07 读取）

| 端点 | 1080p | 1440p | 2160p |
|---|---|---|---|
| 文生 / 图生（标准） | $0.08/秒 | $0.16/秒 | $0.32/秒 |
| 文生 / 图生（快速） | $0.06/秒 | $0.12/秒 | $0.24/秒 |
| 延长视频 | $0.10/秒 | | |
| 视频重拍 | $0.10/秒 | | |
| 音频生视频 | $0.10/秒（不分分辨率） | | |

音频生视频模型页原文：“$0.10 per second of generated video. Pay-per-second, no minimums.” 按生成视频秒数计费；schema 没有时长参数，视频长度跟随输入音频，所以估价 = 音频时长 × $0.10（“视频与音频等长”是据此推断，页面未逐字写明）。

## 5. 适配要点

- 一个模型、显式 `mode`：文/图生视频（0 张图文生、1 张首帧、2 张首尾帧自动路由）、延长视频、视频重拍、音频生视频。快速/标准用「快速模式」开关切端点。
- 时长下拉含 12–20 秒；展示层联动在非「快速 + 1080p + 25 FPS」时隐藏这些选项，builder 也会拒绝不合法组合。
- 智能比例：有图时发 `auto`，无图回退 `16:9`。
- 延长视频计费按延长秒数，重拍按重拍秒数。
- 音频生视频是第四个 `mode`：必须 1 段音频，可选 1 张首帧图，无图时 builder 要求提示词；只保留比例（智能 → `auto`），分辨率、时长、帧率、生成音频、快速模式都隐藏且不下发。
- 音频时长走 `pricing.mediaContext`（`mediaType: 'audio'`、`metric: 'durationSeconds'`、`targetParam: '__audioDurationSeconds'`，只在音频生视频模式生效）：宿主用 ffprobe 读容器时长补进 calculator，生成面板、画布节点估价与提交前的付费确认共用这一份；calculator 通过 `resolveUploadedAudioDurationSeconds` 读取，读不到时按最长 20 秒估。

## 6. 未接入的端点

- `reframe`、`ltx-2.3-quality/*`、`ltx-2.3-22b/*`：不在本次范围。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3/text-to-video | 否 |
| 文生视频（快速）schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3/text-to-video/fast | 否 |
| 图生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3/image-to-video | 否 |
| 图生视频（快速）schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3/image-to-video/fast | 否 |
| 延长视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3/extend-video | 否 |
| 视频重拍 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3/retake-video | 否 |
| 音频生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ltx-2.3/audio-to-video | 否 |
| 模型页与全家族价格 | https://fal.ai/models/fal-ai/ltx-2.3/text-to-video | 否 |
| 音频生视频模型页与价格 | https://fal.ai/models/fal-ai/ltx-2.3/audio-to-video | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
