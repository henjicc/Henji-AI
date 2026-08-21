# Seedream 5.0 Lite · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `bytedance/seedream/v5/lite/text-to-image`、`bytedance/seedream/v5/lite/edit` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`
- **队列**：`POST https://queue.fal.run/<endpoint-id>` → `{ request_id, status_url, response_url, cancel_url }`；`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）；`GET .../requests/{id}` 取结果
- **Webhook**：提交时加 `?fal_webhook=<url>`
- **计费**：按输出计费，服务端错误与排队时间不计费
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 文生图（含组图） | `bytedance/seedream/v5/lite/text-to-image` |
| 图像编辑 / 多参考图（最多 10 张） | `bytedance/seedream/v5/lite/edit` |

## 3. 请求参数（两个端点共有）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 生成 / 编辑描述 |
| `image_size` | 枚举或对象 | 可选 | `auto_2K` | 枚举：`square_hd`、`square`、`portrait_4_3`、`portrait_16_9`、`landscape_4_3`、`landscape_16_9`、`auto_1K`、`auto_2K`；或 `{ width, height }`。**总像素须在 2560×1440 ~ 4096×4096 之间；不满足时 Fal 会自动缩放而不是报错** |
| `num_images` | integer | 可选 | `1` | 1–6，独立运行的生成次数 |
| `max_images` | integer | 可选 | `1` | 1–6。大于 1 时开启组图：每次生成最多返回 `max_images` 张，共跑 `num_images` 次，总数在 `num_images` ~ `max_images × num_images` 之间 |
| `sync_mode` | boolean | 可选 | `false` | `true` 时以 data URI 返回且不入请求历史 |
| `enable_safety_checker` | boolean | 可选 | `true` | 关闭需账号授权 |

**仅 `text-to-image` 有：**

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `return_byteplus_urls` | boolean | `false` | `true` 时返回 seedance-2 可信 URL，**该链接 24 小时过期** |

**仅 `edit` 有：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | 必填 | 输入图 URL 列表。**目前最多 10 张；超过时只取最后 10 张**（静默截断） |

> Fal 的 Lite 端点**没有 `output_format`**（Pro 有）。

## 4. 响应结构

```json
{ "images": [ { "url": "https://v3b.fal.media/files/b/.../xxx.png" } ], "seed": 42 }
```

`images` 与 `seed` 都是必返回字段——**`seed` 只是回传本次生成用的种子，不是入参**，本项目按规则不展示它。

## 5. 价格

来源：两个端点的 `llms.txt`（2026-08-22 读取）。

| 端点 | 单价 |
|---|---|
| `text-to-image` | **$0.035 / 张** |
| `edit` | **$0.035 / 张** |

Fal 未对 Lite 按分辨率分档，也未标注输入图加价。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。入参无 `seed`；输出里的 `seed` 只做记录，不要暴露成可编辑参数。
- `sync_mode`、`return_byteplus_urls` 不展示、不请求。
- 尺寸约束与 Pro 不同（Lite 是 2560×1440 ~ 4096×4096），越界会被**自动缩放**而不是报错，UI 上给出的固定比例需要按 Lite 的面积区间换算。
- 组图靠 `max_images`（Fal 独有写法），与 APIMart 的 `n` / 火山的 `sequential_image_generation` 都不一样。
- `image_urls` 超 10 张静默截断，需前端限制。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image | 否 |
| 文生图 schema + 价格 | https://fal.ai/models/bytedance/seedream/v5/lite/text-to-image/llms.txt | 否 |
| 编辑模型页 | https://fal.ai/models/bytedance/seedream/v5/lite/edit | 否 |
| 编辑 schema + 价格 | https://fal.ai/models/bytedance/seedream/v5/lite/edit/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
