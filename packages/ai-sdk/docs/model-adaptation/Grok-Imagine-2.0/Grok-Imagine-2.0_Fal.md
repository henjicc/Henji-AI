# Grok Imagine 2.0 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `xai/grok-imagine-image/v2.0/text-to-image`、`xai/grok-imagine-image/v2.0/edit` |
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
| 文生图 | `xai/grok-imagine-image/v2.0/text-to-image` |
| 图像编辑（最多 3 张输入图） | `xai/grok-imagine-image/v2.0/edit` |

> Fal 上 Grok Imagine 2.0 **没有分割 / 选区编辑端点**（APIMart 与 KIE 有）。

## 3. 请求参数（两个端点共有）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 图像描述 |
| `num_images` | integer | 可选 | `1` | 1–4 |
| `aspect_ratio` | string | 可选 | 文生图 **`1:1`**；编辑 **`auto`** | `2:1`、`20:9`、`19.5:9`、`16:9`、`4:3`、`3:2`、`1:1`、`2:3`、`3:4`、`9:16`、`9:19.5`、`9:20`、`1:2`（编辑端点另有 `auto`——保持第一张输入图的比例） |
| `resolution` | string | 可选 | `1k` | `1k`（标准）/ `2k`（高清） |
| `output_format` | string | 可选 | `jpeg` | `jpeg` / `png` / `webp` |
| `sync_mode` | boolean | 可选 | `false` | `true` 时以 data URI 返回且不入请求历史 |
| `quality` | string | 可选 | `medium` | `low` / `medium`。**Fal 在编辑端点也允许发 `quality`**（APIMart 官方渠道明确禁止编辑时发 `quality`） |

**仅 `edit` 有：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | **可选** | 要编辑的图片 URL 列表，**最多 3 张** |

## 4. 响应结构

```json
{ "images": [ { "url": "https://...", "content_type": "image/jpeg", "width": 1024, "height": 1024 } ],
  "revised_prompt": "（模型实际使用的增强提示词，可选字段）" }
```

## 5. 价格

来源：两个端点的 `llms.txt`（2026-08-22 读取）。

| 分辨率 | `quality: low` | `quality: medium` |
|---|---|---|
| 1K | **$0.04 / 张** | **$0.06 / 张** |
| 2K | **$0.06 / 张** | **$0.08 / 张** |

`edit` 端点在此基础上**每张输入图 +$0.01**。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点两个字段都没有。
- `output_format`、`sync_mode` 不展示、不请求。
- `aspect_ratio` 默认值在两个端点上不同（文生图 `1:1`、编辑 `auto`）。
- 比例集合有 13–14 种，含 `9:19.5`、`20:9` 等罕见比例，与 KIE（5–6 种）差距极大。
- `quality` 与 `resolution` 共同决定价格（4 个组合），成本估算要覆盖。
- Fal 没有分割 / 选区编辑，如果产品要做该能力只能走 APIMart 或 KIE。
- `revised_prompt` 是可选返回字段，可以展示给用户看模型实际用了什么提示词。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/xai/grok-imagine-image/v2.0/text-to-image | 否 |
| 文生图 schema + 价格 | https://fal.ai/models/xai/grok-imagine-image/v2.0/text-to-image/llms.txt | 否 |
| 编辑模型页 | https://fal.ai/models/xai/grok-imagine-image/v2.0/edit | 否 |
| 编辑 schema + 价格 | https://fal.ai/models/xai/grok-imagine-image/v2.0/edit/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
