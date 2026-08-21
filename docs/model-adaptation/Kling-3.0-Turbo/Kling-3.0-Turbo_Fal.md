# Kling 3.0 Turbo · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/kling-video/v3/turbo/{pro,standard}/{text-to-video,image-to-video}` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`；**队列**：`POST https://queue.fal.run/<endpoint-id>`，`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 档位 | 文生视频 | 图生视频 |
|---|---|---|
| Turbo Pro（1080P） | `fal-ai/kling-video/v3/turbo/pro/text-to-video` | `fal-ai/kling-video/v3/turbo/pro/image-to-video` |
| Turbo Standard（720P） | `fal-ai/kling-video/v3/turbo/standard/text-to-video` | `fal-ai/kling-video/v3/turbo/standard/image-to-video` |

## 3. 请求参数

### 3.1 `text-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 可选 | — | 建议 **≤ 2500 字符**。**与 `multi_prompt` 互斥** |
| `multi_prompt` | array | 可选 | — | 多镜头故事板（**1–6 个镜头**），每个镜头有自己的 prompt 与时长，**总时长不得超过 15 s**。**与 `prompt` 互斥** |
| `aspect_ratio` | string | 可选 | `16:9` | `16:9`、`9:16`、`1:1` |
| `duration` | string | 可选 | `"5"` | **字符串枚举** `"3"` ~ `"15"` |

### 3.2 `image-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 可选 | — | 可选文本提示词，建议 ≤ 2500 字符。**与 `multi_prompt` 互斥** |
| `multi_prompt` | array | 可选 | — | 同上 |
| `image_url` | string | **必填** | — | 首帧参考图。格式 `.jpg` / `.jpeg` / `.png`；**≤ 50 MB**；单边 **≥ 300 px**；宽高比 `1:2.5` ~ `2.5:1` |
| `duration` | string | 可选 | `"5"` | `"3"` ~ `"15"` |

> 图生视频端点**没有 `aspect_ratio`**。Turbo 系列**没有 `generate_audio`、`negative_prompt`、`cfg_scale`、`elements`**（`kling-video/v3` 非 Turbo 有）。

## 4. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" } }
```

## 5. 价格

来源：各端点 `llms.txt`（2026-08-22 读取）。

| 档位 | 单价 |
|---|---|
| Turbo Pro | **$0.14 / 秒**（5 秒 = $0.70） |
| Turbo Standard | **$0.112 / 秒**（5 秒 = $0.56） |

Turbo 没有音频开关，因此没有有声 / 无声的价差。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 的 Turbo 端点这两个字段都没有（**与非 Turbo 的 v3 不同，Turbo 没有带默认值的 `negative_prompt`**）。
- `duration` 是**字符串枚举**。
- 档位通过 endpoint 路径选择（turbo/pro、turbo/standard），不是参数。
- **`prompt` 与 `multi_prompt` 互斥**，且多镜头总时长 ≤ 15 s。
- 图生视频字段是 `image_url`（**单字符串**），与 KIE 的 `image_urls`（数组）、APIMart 的 `first_frame_image` 都不同。
- Turbo 没有音频，产品上若强调「有声」需引导用户改用 Kling 3.0 或 Omni。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Turbo Pro 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/turbo/pro/text-to-video/llms.txt | 否 |
| Turbo Pro 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/turbo/pro/image-to-video/llms.txt | 否 |
| Turbo Standard 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/turbo/standard/text-to-video/llms.txt | 否 |
| Turbo Standard 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/turbo/standard/image-to-video/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
