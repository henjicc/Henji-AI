# Z-Image Turbo · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/z-image/turbo`、`fal-ai/z-image/turbo/image-to-image` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> **Fal 是唯一提供 Z-Image 图生图能力的供应商**（百炼官方、APIMart、KIE 都只有文生图）。

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`
- **队列**：`POST https://queue.fal.run/<endpoint-id>` → `{ request_id, status_url, response_url, cancel_url }`；`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）；`GET .../requests/{id}` 取结果
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 文生图 | `fal-ai/z-image/turbo` |
| 图生图（单图 + 强度） | `fal-ai/z-image/turbo/image-to-image` |

## 3. 请求参数（两个端点共有）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 生成描述 |
| `image_size` | 枚举或对象 | 可选 | 文生图 `landscape_4_3`；图生图 `auto` | 枚举 `square_hd`、`square`、`portrait_4_3`、`portrait_16_9`、`landscape_4_3`、`landscape_16_9`（图生图还支持 `auto`），或 `{ width, height }` |
| `num_inference_steps` | integer | 可选 | `8` | **1–8**。Turbo 模型步数很低 |
| `seed` | integer | 可选 | 随机 | **本项目规则：绝对不显示**，不下发 |
| `sync_mode` | boolean | 可选 | `false` | `true` 时以 data URI 返回且不入请求历史 |
| `num_images` | integer | 可选 | `1` | **1–4** |
| `enable_safety_checker` | boolean | 可选 | `true` | 关闭需账号授权；**被判定为不安全的图会返回黑图** |
| `output_format` | string | 可选 | `png` | `jpeg` / `png` / `webp` |
| `acceleration` | string | 可选 | `regular` | `none` / `regular` / `high` |
| `enable_prompt_expansion` | boolean | 可选 | `false` | 提示词扩写。**每次请求加价 0.0025 credits** |

**仅 `image-to-image` 有：**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `image_url` | string | 必填 | — | **单张**输入图 URL（不是数组） |
| `strength` | float | 可选 | `0.6` | 图生图条件强度 |

## 4. 响应结构

```json
{
  "images": [ { "url": "https://.../z-image-turbo-output.png", "content_type": "image/png", "width": 1024, "height": 768 } ],
  "timings": { },
  "seed": 42,
  "has_nsfw_concepts": [false],
  "prompt": "（实际用于生成的提示词）"
}
```

`images`、`timings`、`seed`、`has_nsfw_concepts`、`prompt` 都是必返回字段。`images[]` 元素带 `content_type` / `width` / `height`，比其他供应商信息更全。

## 5. 价格

来源：两个端点的 `llms.txt`（2026-08-22 读取）。

| 项 | 价格 |
|---|---|
| 基础 | **$0.005 / 百万像素（megapixel）** |
| `enable_prompt_expansion: true` | 每次请求额外 **+0.0025 credits** |

> Fal 这里按**像素面积**计价，与百炼（按张 0.1/0.2 元）、APIMart（按张 $0.01/$0.02）、KIE（按张 $0.004）的计价口径完全不同。1024×1024 约 1.05 MP，折合约 $0.00524/张。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点**有 `seed`**（不下发），无负面提示词字段。
- `output_format`、`sync_mode`、`acceleration`、`num_inference_steps` 按项目约定不展示、不请求（保持默认）。
- 这是唯一有图生图的 Z-Image 供应商，`image_url` 是**单张字符串**，不是数组。
- `num_images` 最多 4（其他供应商固定 1），是否开放由产品决定。
- 关闭安全检查时不安全图会返回**黑图**而不是报错，结果解析要能识别。
- 计价按像素面积，成本估算逻辑不能沿用「按张」的模型。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/fal-ai/z-image/turbo | 否 |
| 文生图 schema + 价格 | https://fal.ai/models/fal-ai/z-image/turbo/llms.txt | 否 |
| 图生图模型页 | https://fal.ai/models/fal-ai/z-image/turbo/image-to-image | 否 |
| 图生图 schema + 价格 | https://fal.ai/models/fal-ai/z-image/turbo/image-to-image/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
