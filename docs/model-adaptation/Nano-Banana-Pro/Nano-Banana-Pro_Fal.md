# Nano Banana Pro · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/nano-banana-pro`、`fal-ai/nano-banana-pro/edit` |
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
| 文生图 | `fal-ai/nano-banana-pro` |
| 图像编辑 | `fal-ai/nano-banana-pro/edit` |

> 与 Nano Banana 2 的 `edit` 不同，**Pro 的 `edit` 没有 `video_url` / `audio_url` / `pdf_url` 上下文输入**。

## 3. 请求参数

### 3.1 两个端点共有

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 生成 / 编辑描述 |
| `num_images` | integer | 可选 | `1` | 1–4 |
| `seed` | integer | 可选 | 随机 | **本项目规则：绝对不显示**，不下发 |
| `aspect_ratio` | string | 可选 | 文生图 **`1:1`**；编辑 **`auto`** | `auto`、`21:9`、`16:9`、`3:2`、`4:3`、`5:4`、`1:1`、`4:5`、`3:4`、`2:3`、`9:16`（11 个，**无极端比例**） |
| `output_format` | string | 可选 | `png` | `jpeg` / `png` / `webp` |
| `safety_tolerance` | string | 可选 | `"4"` | `"1"`（最严）~ `"6"`（最松） |
| `sync_mode` | boolean | 可选 | `false` | `true` 时以 data URI 返回且不入请求历史 |
| `system_prompt` | string | 可选 | `""` | 系统指令，作为 system instruction 下发给 Gemini |
| `resolution` | string | 可选 | `1K` | `1K` / `2K` / `4K`（**无 0.5K**，Nano Banana 2 有） |
| `limit_generations` | boolean | 可选 | **`true`** | 实验性参数：限制每轮提示只出 1 张，**忽略 prompt 中关于生成数量的指令** |
| `enable_web_search` | boolean | 可选 | `false` | 联网搜索最新信息辅助生成 |

> Pro **没有 `thinking_level`**（Nano Banana 2 有）。

### 3.2 仅 `edit` 有

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | **必填** | 用于图生图 / 图像编辑的输入图 URL 列表 |

## 4. 响应结构

```json
{ "images": [ { "url": "https://...", "content_type": "image/png", "width": 1024, "height": 1024 } ],
  "description": "（模型对生成图像的描述）" }
```

## 5. 价格

来源：两个端点的 `llms.txt`（2026-08-22 读取）。Fal 标注 **Pricing may change in the future**。

| 项 | 价格 |
|---|---|
| 基础（1K / 2K） | **$0.15 / 张**（$1.00 可跑 7 次） |
| 4K | 标准价 × **2** = $0.30 / 张 |
| `enable_web_search` | 额外 **+$0.015** |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点**有 `seed`**（不下发），无负面提示词字段。
- `output_format`、`sync_mode` 不展示、不请求。
- `aspect_ratio` 的默认值在两个端点上不同（文生图 `1:1`、编辑 `auto`），若要统一行为必须显式下发。
- `limit_generations` 默认 `true`，会忽略 prompt 中的数量指令。
- Fal 是四家里最贵的 Nano Banana Pro 渠道（$0.15/张 vs KIE $0.09、APIMart $0.03），成本敏感场景需要注意。
- `edit` 的 `image_urls` 是必填。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/fal-ai/nano-banana-pro | 否 |
| 文生图 schema + 价格 | https://fal.ai/models/fal-ai/nano-banana-pro/llms.txt | 否 |
| 编辑模型页 | https://fal.ai/models/fal-ai/nano-banana-pro/edit | 否 |
| 编辑 schema + 价格 | https://fal.ai/models/fal-ai/nano-banana-pro/edit/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
