# Kling 4.0 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-08 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `kling/v4/{text-to-video,image-to-video,reference-to-video,video-to-video/edit}` |
| 痕迹AI 模型 ID | `fal-ai-kling-4.0`（canonical `kling-video-4.0`） |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

Flash 版见 [Kling-4.0-Flash_Fal.md](../Kling-4.0-Flash/Kling-4.0-Flash_Fal.md)。

## 1. 请求参数（OpenAPI，2026-11-07 读取）

### 1.1 `text-to-video`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `prompt` | string | 与 `multi_prompt` 二选一 | — | ≤26000 字符 |
| `multi_prompt` | array | 否 | — | 分镜列表，至少 1 镜；每镜 `prompt`（必填，1–512 字符）+ `duration`（整数 1–30，默认 5），成片时长为各镜之和 |
| `aspect_ratio` | string | 否 | `16:9` | `16:9` / `9:16` / `1:1` / `21:9` |
| `duration` | integer | 否 | `5` | 3–30 |
| `resolution` | string | 否 | `1080p` | `720p` / `1080p` |

### 1.2 `image-to-video`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `start_image_url` | string | 是 | 首帧；≤30MB，宽高 ≥300px，宽高比 0.4–2.5 |
| `end_image_url` | string | 否 | 尾帧 |
| `middle_image_urls` | array | 否 | 首尾之间按顺序的关键帧，最多 8 张 |
| `prompt` / `multi_prompt` | | 否 | 可都不给 |
| `duration` / `resolution` | | 否 | 同上；无 `aspect_ratio` |

### 1.3 `reference-to-video`

| 字段 | 类型 | 说明 |
|---|---|---|
| `prompt` | string | 用 `@Image1`、`@Video1`、`@Element1` 引用素材；与 `multi_prompt` 二选一 |
| `image_urls` | array | 参考图，最多 10 |
| `video_urls` | array | 参考视频，最多 5；每段 3–30 秒，与元素视频合计 ≤30 秒 |
| `multi_prompt` | array | 分镜，结构同 1.1 |
| `elements` | array | 角色/物体元素，最多 7，其中视频元素最多 3、带 `voice_id` 的最多 3；结构见 1.5 |
| `voice_ids` | array | 声音，最多 3（未接入） |
| `start_image_url` / `end_image_url` / `middle_image_urls` | | 可选，计入图片上限（未接入） |
| `aspect_ratio` | string | `auto` / `16:9` / `9:16` / `1:1` / `21:9`，默认 `16:9` |
| `duration` / `resolution` | | 同上 |

### 1.4 `video-to-video/edit`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 修改说明，源视频记作 `@Video1` |
| `video_url` | string | 是 | 源视频 3–30 秒，≤300MB，宽高 700–4553px，宽高比 0.4–2.5 |
| `video_urls` | array | 否 | 参考视频 `@Video2…`，最多 4；源、参考、元素视频合计 ≤30 秒 |
| `image_urls` | array | 否 | 参考图 |
| `elements` | array | 否 | 同 1.3，结构见 1.5 |
| `duration` | integer | 否 | 3–30，默认等于源视频长度（不下发） |
| `aspect_ratio` | string | 否 | 不给则跟随源视频 |
| `resolution` | string | 否 | `720p` / `1080p`，默认 `1080p` |

没有 `multi_prompt`；另有 `voice_ids`、`start_image_url` / `end_image_url` / `middle_image_urls`（未接入）。OpenAPI 中没有 `generate_audio` 字段。

### 1.5 元素（`KlingV4Element`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `frontal_image_url` | string | 正面主图；≤30MB，宽高 ≥300px，宽高比 0.4–2.5 |
| `reference_image_urls` | array | 其他角度，1–3 张（schema 只写 maxItems 3，最少 1 张见字段说明） |
| `video_url` | string | 代替图片的元素视频，3–8 秒，宽高 700–4553px |
| `voice_id` | string | 绑定声音，需先用 `fal-ai/kling-video/create-voice` 创建（未接入） |

提示词按顺序用 `@Element1`、`@Element2` 引用。

## 2. 响应结构

```json
{ "video": { "url": "https://.../output.mp4" } }
```

## 3. 价格（模型页 pricingInfoOverride / publicEndpointBilling，2026-11-07 读取）

| 情形 | 720p | 1080p | 计费时长 |
|---|---|---|---|
| 文生 / 图生 / 只用参考图 | $0.157/秒 | $0.235/秒 | 输出时长 |
| 带参考视频或视频元素 / 视频编辑 | $0.094/秒 | $0.141/秒 | 输入 + 输出时长，且至少为输出的 2 倍 |

参考生视频页原文把“视频元素”和参考视频并列为低价档的触发条件（“With video references or video elements”）。分镜成片时长等于各镜之和，按这个总和计费。

## 4. 适配要点

- 素材尺寸前置校验（2026-11-08）：`videoConstraints` 源视频与元素视频宽高 700–4553 px，视频编辑另校验宽高比 0.4–2.5；元素其他角度图文档未写尺寸，不校验图片。提交前读取素材实际宽高，不合格直接提示，不发付费请求。
- 一个模型、显式 `mode`：文/图生视频、参考生视频、视频编辑。
- 文/图生视频：0 张图走文生；有图时第 1 张作首帧、最后一张作尾帧、中间按顺序作关键帧（最多 10 张）。
- 视频编辑：第 1 个视频是源视频，其余作参考（最多 4）；不下发 `duration`，比例选智能时不下发（跟随源视频）。
- 视频编辑计费按「源视频时长作输出」估算：`max(全部输入时长 + 源时长, 2 × 源时长)`；参考视频时长来自宿主注入的 `__videoDurationSeconds`，未知时每段按 5 秒估。
- 分镜（`falKling40Shots`，面板 `shot-list`）：文/图生视频与参考生视频可用，视频编辑隐藏且不发送。值为 `[{ id, prompt, duration }]`；非空时只发 `multi_prompt`，不发 `prompt` 与 `duration`，时长参数隐藏；平台两者二选一，项目把主提示词当整体描述拼到每一镜提示词前（换行连接，拼接后仍按每镜 ≤512 字符校验），主提示词可留空。各镜之和按时长参数范围校验为 3–30 秒（schema 没有单独写总和范围），估价按总和。
- 元素（`falKling40Elements`，面板 `subject-elements`）：参考生视频与视频编辑可用。值为 `[{ id, kind, images, videos, videoSeconds? }]`（`videoSeconds` 只用于估价，不发送）；图片元素 2–4 张，第 1 张作 `frontal_image_url`、其余作 `reference_image_urls`；视频元素只发 `video_url`。媒体字段由公共上传预处理按字段名上传。视频元素估价用上传时读到的时长，读不到按上限 8 秒计入输入时长，避免付费授权偏低。
- 未接入：`voice_ids` 与元素 `voice_id`（需另建声音）、参考模式里的首尾帧字段。源、参考与元素视频合计 ≤30 秒在提交前无法核对（元素视频时长未知），由平台校验。
- 官方请求 schema 落在 `tests/fixtures/model-requests-2026-11/fal-kling-4.0-*.json`（含 Flash 两份），由 `tests/catalog/kling-4.0-shots-elements.test.ts` 校验；未做付费真网验收。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/text-to-video | 否 |
| 图生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/image-to-video | 否 |
| 参考生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/reference-to-video | 否 |
| 视频编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/video-to-video/edit | 否 |
| 模型页与价格 | https://fal.ai/models/kling/v4/text-to-video | 否 |
| 参考生视频价格 | https://fal.ai/models/kling/v4/reference-to-video | 否 |
| 视频编辑价格 | https://fal.ai/models/kling/v4/video-to-video/edit | 否 |
