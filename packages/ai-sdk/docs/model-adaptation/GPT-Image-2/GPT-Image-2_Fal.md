# GPT-Image-2 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `openai/gpt-image-2`、`openai/gpt-image-2/edit` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`
- **队列**：`POST https://queue.fal.run/<endpoint-id>` → `{ request_id, status_url, response_url, cancel_url }`；`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）；`GET .../requests/{id}` 取结果
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 文生图 | `openai/gpt-image-2` |
| 图像编辑 + **局部重绘（mask）** | `openai/gpt-image-2/edit` |

## 3. 请求参数

### 3.1 `openai/gpt-image-2`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 生成描述 |
| `image_size` | 枚举或对象 | 可选 | `landscape_4_3` | 预设名、`{ width, height }`，或 `'auto'` 让模型自选。**明确尺寸时：宽高都必须是 16 的倍数、最长边 ≤ 3840 px、宽高比 ≤ 3:1、总像素在 655,360 ~ 8,294,400 之间** |
| `quality` | string | 可选 | **`high`** | `auto` / `low` / `medium` / `high`。**Fal 默认 `high`，显著影响成本** |
| `num_images` | integer | 可选 | `1` | 1–4 |
| `output_format` | string | 可选 | `png` | `jpeg` / `png` / `webp` |
| `sync_mode` | boolean | 可选 | `false` | `true` 时以 data URI 返回且不入请求历史 |

### 3.2 `openai/gpt-image-2/edit`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 编辑描述 |
| `image_urls` | string[] | **必填** | — | 参考图 URL 列表，**最多 16 张** |
| `image_size` | 枚举或对象 | 可选 | **`auto`** | `auto` 时从输入图推断 |
| `quality` | string | 可选 | `high` | 同上 |
| `num_images` | integer | 可选 | `1` | 1–4 |
| `output_format` | string | 可选 | `png` | `jpeg` / `png` / `webp` |
| `sync_mode` | boolean | 可选 | `false` | 同上 |
| `mask_url` | string | 可选 | — | 遮罩图 URL，指明要编辑的区域（局部重绘） |

## 4. 响应结构

```json
{ "images": [ { "url": "https://...", "content_type": "image/png", "width": 1024, "height": 768 } ] }
```

## 5. 价格（按 token）

来源：两个端点的 `llms.txt`（2026-08-22 读取）。

| 计费项 | 单价（每 1M token） |
|---|---|
| 文本输入 | **$5.00** |
| 文本缓存输入 | **$1.25** |
| 文本输出 | **$10.00** |
| 图片输入 | **$8.00** |
| 图片缓存输入 | **$2.00** |
| 图片输出 | **$30.00** |

> **`quality` 参数显著影响成本，Fal 默认用 `high`**——这是最贵的档位，接入时应按产品定位显式设置。总费用向上取整到 $0.0001。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点两个字段都没有。
- `output_format`、`sync_mode` 不展示、不请求。
- **`quality` 默认 `high` 是成本陷阱**：Fal 与 APIMart 官方渠道（默认 `auto`≈`low`）默认值相反，必须显式下发。
- `image_size` 的明确尺寸约束很硬（16 的倍数、≤ 3840、比例 ≤ 3:1、总像素区间），画布比例换算必须做对齐，否则报错。
- SDK 保留旧参数 ID `falGptImage2Resolution` 以兼容 0.1.5，但展示语义已校正为 `quality`，并补齐官方合法的 `auto`；独立的 `falGptImage2ImageSize`（默认 `provider`，可选 `1MP` / `2K`）避免把质量与尺寸混为一谈。GPT Image 2 在通用比例之外单独开放 `2:1`，不会把该比例无差别扩散到其他 Fal 模型。
- `2K + 2:1` 显式映射为官方自定义尺寸约束内的 `2688×1344`（两边均为 16 的倍数、比例 2:1、约 3.61MP）；请求仍单独使用 `quality=auto/low/medium/high`，不会把产品分辨率语义误传为质量值。
- `edit` 的 `image_urls` 是**必填**；`mask_url` 让 Fal 成为除 APIMart 官方渠道外唯一支持局部重绘的 GPT-Image-2 供应商。
- 按 token 计费，成本估算不能按张算。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/openai/gpt-image-2 | 否 |
| 文生图 schema + 价格 | https://fal.ai/models/openai/gpt-image-2/llms.txt | 否 |
| 编辑模型页 | https://fal.ai/models/openai/gpt-image-2/edit | 否 |
| 编辑 schema + 价格 | https://fal.ai/models/openai/gpt-image-2/edit/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
