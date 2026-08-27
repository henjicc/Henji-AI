# Seedance 2.5 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `bytedance/seedance-2.5/text-to-video`、`bytedance/seedance-2.5/image-to-video`、`bytedance/seedance-2.5/reference-to-video` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`；**队列**：`POST https://queue.fal.run/<endpoint-id>`，`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 文生视频 | `bytedance/seedance-2.5/text-to-video` |
| 图生视频（首帧，可选尾帧） | `bytedance/seedance-2.5/image-to-video` |
| 参考生视频（图 / 视频 / 音频多模态） | `bytedance/seedance-2.5/reference-to-video` |

## 3. 请求参数

### 3.1 三个端点共有

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 视频描述 |
| `resolution` | string | 可选 | `720p` | `480p` / `720p` / `1080p`（**无 4k**） |
| `duration` | string | 可选 | `auto` | `auto`、`"4"` ~ **`"30"`**（**字符串枚举**，2.0 只到 `"15"`） |
| `aspect_ratio` | string | 可选 | `auto` | `auto`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16` |
| `generate_audio` | boolean | 可选 | **`true`** | 是否生成同步音频 |
| `bitrate_mode` | string | 可选 | `standard` | `standard` / `high` |
| `end_user_id` | string | 可选 | — | 终端用户唯一 ID |

### 3.2 仅 `image-to-video`

`image_url`（必填，首帧图）、`end_image_url`（可选，尾帧图）。JPEG / PNG / WebP，≤ 30 MB。

### 3.3 仅 `reference-to-video`

`image_urls` / `video_urls` / `audio_urls`，在 prompt 中用 `@Image1` / `@Video1` / `@Audio1` 引用。

> 具体上限以端点 `llms.txt` 为准（2.5 上游支持 30 图 / 10 视频 / 10 音频）。

## 4. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" }, "seed": 42 }
```

## 5. 价格

来源：三个端点的 `llms.txt`（2026-08-22 读取）。

| 项 | 价格 |
|---|---|
| 720p（按秒，约） | **$0.4730 / 秒** |
| 480p（按秒，约） | **$0.2205 / 秒** |
| token 价（480p / 720p） | **$0.0214 / 1000 tokens** |
| token 价（1080p，约） | **$0.0234 / 1000 tokens** |

token 数约为 `(输出视频高 × 输出视频宽 × 时长 × 24) / 1024`。

`reference-to-video` 有视频输入时：token 数按 `(高 × 宽 × (输入视频时长 + 输出视频时长) × 24) / 1024`，且**价格 × 0.6**——有视频输入 + 720p 时约 **$0.2838 / 秒**。**有视频参考时输入与输出视频都要计费。**

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 入参没有 `seed`（只在输出里回传），也没有负面提示词。
- `duration` 是**字符串枚举**且 2.5 支持到 `"30"`，与 2.0 的 `"15"` 上限不同。
- `aspect_ratio` 用 `auto`，APIMart / KIE 用 `adaptive`。
- Fal 上**没有 `output_format`（mov）、没有 `omni_reference_task_type`、没有 watermark**，视频编辑 / 延长这类子任务类型无法显式声明。
- 三种输入形态是三个独立 endpoint，需要按有无图 / 有无参考素材路由。
- 有视频输入时价格 × 0.6，但按「输入 + 输出总时长」计费。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema + 价格 | https://fal.ai/models/bytedance/seedance-2.5/text-to-video/llms.txt | 否 |
| 图生视频 schema + 价格 | https://fal.ai/models/bytedance/seedance-2.5/image-to-video/llms.txt | 否 |
| 参考生视频 schema + 价格 | https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
