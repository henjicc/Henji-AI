# Seedream 5.5 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `bytedance/seedream/v5.5/text-to-image`、`bytedance/seedream/v5.5/edit`、`bytedance/seedream/v5.5/layerize`（无 `fal-ai/` 前缀） |
| 痕迹AI 模型 ID | `fal-ai-seedream-5.5`（canonical `seedream-5.5`） |
| 接口形态 | Fal 队列异步（`queue.fal.run`），与其他 Fal 模型同协议 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与端点

| 能力 | 端点 |
|---|---|
| 文生图（含原生透明背景） | `bytedance/seedream/v5.5/text-to-image` |
| 图片编辑 / 多图参考（1–10 张） | `bytedance/seedream/v5.5/edit` |
| 图层拆分（底图 + 最多 99 层） | `bytedance/seedream/v5.5/layerize` |

## 2. 请求参数（OpenAPI，2026-11-14 读取）

### 2.1 文生图 / 编辑

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | |
| `image_urls` | string[] | 编辑必填 | — | 最多 10 张，超过只取最后 10 张 |
| `image_size` | ImageSize \| enum | 否 | `auto_2K` | 枚举 `square_hd` `square` `portrait_4_3` `portrait_16_9` `landscape_4_3` `landscape_16_9` `auto_1K` `auto_1.5K` `auto_2K`，或 `{width,height}`；总像素 921,600–4,624,220，比例 1/16–16 |
| `num_images` | integer | 否 | `1` | 1–6 |
| `background` | enum | 否 | `auto` | `auto` / `opaque` / `transparent`；`transparent` 需要 PNG 输出 |
| `output_format` | enum | 否 | `png` | `jpeg` / `png`；按项目约定不展示、不下发 |
| `watermark` | boolean | 否 | `false` | 不展示、不下发 |
| `sync_mode`、`enable_safety_checker` | boolean | 否 | `false` / `true` | 不展示、不下发 |

### 2.2 图层拆分 `layerize`

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `image_url` | string | 是 | — | 512×512–6000×6000 总像素，比例 1/16–16，≤30MB |
| `prompt` | string | 否 | `""` | 空则自动拆主要元素；支持 `<bbox>left top right bottom</bbox>` 归一化坐标 |
| `image_size` | enum | 否 | `auto` | `auto` / `auto_1K` / `auto_1.5K` / `auto_2K` |
| `max_images` | integer | 否 | `30` | 2–100，含底图；>30 时一律返回 URL |
| `enable_text_recognition` | boolean | 否 | `false` | 返回 `text_recognition` 富文本 OCR；不展示、不下发 |
| `output_format` | enum | 否 | `png` | 只控制底图，图层恒 PNG；不展示、不下发 |
| `watermark`、`sync_mode`、`enable_safety_checker` | boolean | 否 | — | 不展示、不下发 |

## 3. 响应结构

- 文生图 / 编辑：`{ images: Image[] }`，`Image` 必有 `url`，可选 `content_type`、`file_name`、`file_size`、`width`、`height`。
- 图层拆分：`{ images: Image[], layers: SeedDream55Layer[] }`。`images` 与 `layers` 同序（底图在前，按 `z_index` 递增），供画廊展示；`layers[]` 每项 `image`（Image）、`z_index`（0–99，底图 0）、可选 `name`、`description`、`bounding_box{absolute,normalized}`、`text_recognition`。

## 4. 价格（模型页 llms.txt，2026-11-14 读取）

| 端点 | 价格 |
|---|---|
| 文生图 | 每张输出：1K / 1.5K $0.03，2K $0.0405；自定义尺寸 ≤2,610,000 像素 $0.03，以上 $0.0405 |
| 编辑 | 同上输出价，另加 **每张输出 × 每张输入图 $0.012**（例：2 张输入、1 张 2K 输出 $0.0645） |
| 图层拆分 | 每张返回图（底图 + 各层）1K / 1.5K $0.03、2K $0.0405；`auto` 按底图像素定档（≤2,610,000 $0.03，以上 $0.0405）；输入图每次请求 $0.012 |

## 5. 适配要点

- 一个模型，`falSeedream55Mode` 显式两档：「生成 / 编辑」与「图层拆分」（`transferKey: layer-decomposition-mode`，与其他 Seedream 图层拆分模型一致）。生成档内文生图与编辑按是否上传图片自动切端点。
- 比例：智能比例在本地换成具体比例（有图取首图最接近比例，无图 1:1），再按 1K/1.5K/2K 面积算出 16 的倍数宽高发 `{width,height}`；所有组合都落在官方像素范围内，1K/1.5K 落在 $0.03 档。
- 背景：`auto`（默认）/ `opaque` / `transparent`，打 `transparent-background` 标签；不发 `output_format`，官方默认 PNG 满足透明要求。
- 图层拆分：固定请求 `max_images: 17`。SDK 图层结果契约（`layer-stack` V1）只接受底图 + 16 层，超出会让整份结果解析失败；结构化输出由 `parseSeedreamLayerStack('fal', …)` 从 `layers[].image` 读取地址、宽高与 `content_type`。层数由模型决定，提交前不估总价（calculator 返回 NaN，与火山同类模型一致）。
- 未接入：`enable_text_recognition`（结果契约未承载 OCR 字段）。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedream/v5.5/text-to-image | 否 |
| 编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedream/v5.5/edit | 否 |
| 图层拆分 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedream/v5.5/layerize | 否 |
| 文生图说明与价格 | https://fal.ai/models/bytedance/seedream/v5.5/text-to-image/llms.txt | 否 |
| 编辑说明与价格 | https://fal.ai/models/bytedance/seedream/v5.5/edit/llms.txt | 否 |
| 图层拆分说明与价格 | https://fal.ai/models/bytedance/seedream/v5.5/layerize/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
