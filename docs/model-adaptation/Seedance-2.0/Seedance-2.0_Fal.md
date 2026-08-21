# Seedance 2.0 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `bytedance/seedance-2.0/text-to-video`、`bytedance/seedance-2.0/image-to-video`、`bytedance/seedance-2.0/reference-to-video` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`；**队列**：`POST https://queue.fal.run/<endpoint-id>`，`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单（Fal 把每种输入形态拆成独立端点）

| 能力 | endpoint id |
|---|---|
| 文生视频 | `bytedance/seedance-2.0/text-to-video` |
| 图生视频（首帧，可选尾帧） | `bytedance/seedance-2.0/image-to-video` |
| 参考生视频（图 / 视频 / 音频多模态） | `bytedance/seedance-2.0/reference-to-video` |

## 3. 请求参数

### 3.1 三个端点共有

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 视频描述 |
| `resolution` | string | 可选 | `720p` | `480p` / `720p` / `1080p` / `4k` |
| `duration` | string | 可选 | **`auto`** | `auto`、`"4"` ~ `"15"`（**字符串枚举，不是数字**） |
| `aspect_ratio` | string | 可选 | **`auto`** | `auto`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`（**7 个，没有 `adaptive`**） |
| `generate_audio` | boolean | 可选 | **`true`** | 是否生成同步音频（音效、环境音、口型同步语音）。**开不开音频价格相同** |
| `bitrate_mode` | string | 可选 | `standard` | `standard` / `high`（更高码率、更大文件） |
| `end_user_id` | string | 可选 | — | 终端用户唯一 ID |

### 3.2 仅 `image-to-video`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_url` | string | **必填** | 首帧图 URL。JPEG / PNG / WebP，**≤ 30 MB** |
| `end_image_url` | string | 可选 | 尾帧图 URL；提供后视频从首帧过渡到尾帧。JPEG / PNG / WebP，≤ 30 MB |

### 3.3 仅 `reference-to-video`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | 可选 | 参考图。**在 prompt 中用 `@Image1`、`@Image2` 引用**。JPEG / PNG / WebP，单张 ≤ 30 MB，**最多 9 张**。**所有模态的文件总数不得超过 12** |
| `video_urls` | string[] | 可选 | 参考视频。prompt 中用 `@Video1` 引用。MP4 / MOV，**最多 3 个**，合计时长 2–15 s，总大小 < 50 MB，分辨率须在 ~480p (640×640) 与 ~720p (834×1112) 之间 |
| `audio_urls` | string[] | 可选 | 参考音频。prompt 中用 `@Audio1` 引用。MP3 / WAV，**最多 3 个**，合计时长 ≤ 15 s，单个 ≤ 15 MB。**提供音频时必须至少有一张参考图或一个参考视频** |

## 4. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" }, "seed": 42 }
```

`video` 与 `seed` 都是必返回字段。

## 5. 价格

来源：三个端点的 `llms.txt`（2026-08-22 读取）。

| 项 | 价格 |
|---|---|
| 720p（按秒） | **$0.3034 / 秒** |
| 1080p（按秒） | **$0.682 / 秒** |
| token 价（480p / 720p / 1080p） | **$0.014 / 1000 tokens** |
| token 价（4k） | **$0.008 / 1000 tokens** |

token 数计算：`(输出视频高 × 输出视频宽 × 时长 × 24) / 1024`。

`reference-to-video` 有视频输入时：token 数按 `(高 × 宽 × (输入视频时长 + 输出视频时长) × 24) / 1024` 计算，且**价格 × 0.6**——有视频输入 + 720p 时约 **$0.1814 / 秒**。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 入参**没有 `seed`**（只在输出里回传），也没有负面提示词。
- `duration` 是**字符串枚举**（`"5"` 而不是 `5`），与 APIMart / KIE 的整数不同，序列化时容易出错。
- `aspect_ratio` 用 `auto` 表示自适应，APIMart / KIE 用 `adaptive`——名字不同，不能共用常量。
- 三种输入形态在 Fal 上是**三个不同的 endpoint**，而 APIMart / KIE 是同一个 model 靠字段区分；适配层要按有无图 / 有无参考素材做端点路由。
- `reference-to-video` 的 prompt 里要用 `@Image1` / `@Video1` / `@Audio1` 显式引用素材，这是 Fal 独有的约定，提示词模板要跟着改。
- 有视频输入时价格 × 0.6，但按「输入 + 输出总时长」计费。
- `generate_audio` 默认 `true`，但开关不影响价格。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema + 价格 | https://fal.ai/models/bytedance/seedance-2.0/text-to-video/llms.txt | 否 |
| 图生视频 schema + 价格 | https://fal.ai/models/bytedance/seedance-2.0/image-to-video/llms.txt | 否 |
| 参考生视频 schema + 价格 | https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
