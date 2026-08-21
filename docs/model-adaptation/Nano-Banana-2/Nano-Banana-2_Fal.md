# Nano Banana 2 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/nano-banana-2`、`fal-ai/nano-banana-2/edit` |
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
| 文生图 | `fal-ai/nano-banana-2` |
| 图像编辑（并可用**视频 / 音频 / PDF 作为上下文**） | `fal-ai/nano-banana-2/edit` |

> Fal 的 `edit` 端点是本模型所有供应商里能力最强的：除参考图外还接受 `video_url` / `audio_url` / `pdf_url` 作为输入上下文。

## 3. 请求参数

### 3.1 两个端点共有

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 生成 / 编辑描述 |
| `num_images` | integer | 可选 | `1` | 1–4 |
| `seed` | integer | 可选 | 随机 | **本项目规则：绝对不显示**，不下发 |
| `aspect_ratio` | string | 可选 | `auto` | `auto`、`21:9`、`16:9`、`3:2`、`4:3`、`5:4`、`1:1`、`4:5`、`3:4`、`2:3`、`9:16`、`4:1`、`1:4`、`8:1`、`1:8`（含极端比例） |
| `output_format` | string | 可选 | `png` | `jpeg` / `png` / `webp` |
| `safety_tolerance` | string | 可选 | `"4"` | `"1"`（最严）~ `"6"`（最松） |
| `sync_mode` | boolean | 可选 | `false` | `true` 时以 data URI 返回且不入请求历史 |
| `system_prompt` | string | 可选 | `""` | 系统指令，用于统一人设与输出风格；作为 system instruction 下发给 Gemini |
| `resolution` | string | 可选 | `1K` | `0.5K` / `1K` / `2K` / `4K` |
| `limit_generations` | boolean | 可选 | **`true`** | 实验性参数：限制每轮提示只出 1 张，**忽略 prompt 中关于生成数量的指令与模型的中间图**。文档提示这可能影响生成质量 |
| `enable_web_search` | boolean | 可选 | `false` | 联网搜索最新信息辅助生成 |
| `thinking_level` | string | 可选 | 不启用 | `minimal` / `high`。设置后启用模型思考并在生成中包含思考过程；**省略即关闭** |

### 3.2 仅 `edit` 有

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | **可选** | 图生图 / 图像编辑的输入图。当 `video_url` / `audio_url` / `pdf_url` 至少提供一个时可省略 |
| `video_url` | string | 可选 | 视频作为输入上下文。接受 http(s)/data URL（下载后内联，**≤ 15 MB**）或 YouTube URL（直接透传给模型，不下载） |
| `audio_url` | string | 可选 | 音频作为输入上下文。http(s)/data URL，下载内联，**≤ 15 MB** |
| `pdf_url` | string | 可选 | PDF 作为输入上下文。http(s)/data URL，下载内联，**≤ 15 MB** |

## 4. 响应结构

```json
{ "images": [ { "url": "https://...", "content_type": "image/png", "width": 1024, "height": 1024 } ],
  "description": "（模型对生成图像的描述）" }
```

`images` 与 `description` 都是必返回字段。

## 5. 价格

来源：两个端点的 `llms.txt`（2026-08-22 读取）。Fal 标注 **Pricing is subject to change**。

| 项 | 价格 |
|---|---|
| 基础（1K） | **$0.08 / 张**（$1.00 可跑 12 次） |
| 0.5K（512px） | 标准价 × **0.75** |
| 2K | 标准价 × **1.5** |
| 4K | 标准价 × **2** |
| `enable_web_search` | 额外 **+$0.015** |
| `thinking_level: high` | 额外 **+$0.002** |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点**有 `seed`**（不下发），无负面提示词字段。
- `output_format`、`sync_mode` 不展示、不请求。
- `limit_generations` 默认 `true`，会**忽略 prompt 中的数量指令并丢弃中间图**，且文档承认可能影响质量——若产品发现出图与提示词不符，先查这个默认值。
- `edit` 的 `image_urls` 是可选的，但必须至少提供 `image_urls` / `video_url` / `audio_url` / `pdf_url` 之一，参数校验要覆盖。
- 视频/音频/PDF 上下文是 Fal 独有能力（其他供应商都没有），若要用需注意 15 MB 上限。
- 搜索增强与 thinking 都会**额外加价**，开关要在成本估算里体现。
- Fal 是唯一提供 `safety_tolerance` 分级的 Nano Banana 2 供应商。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/fal-ai/nano-banana-2 | 否 |
| 文生图 schema + 价格 | https://fal.ai/models/fal-ai/nano-banana-2/llms.txt | 否 |
| 编辑模型页 | https://fal.ai/models/fal-ai/nano-banana-2/edit | 否 |
| 编辑 schema + 价格 | https://fal.ai/models/fal-ai/nano-banana-2/edit/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
