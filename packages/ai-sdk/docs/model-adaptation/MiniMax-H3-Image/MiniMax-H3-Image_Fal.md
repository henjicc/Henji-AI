# MiniMax H3 Image · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `minimax/h3-image/{text-to-image,edit}`、`minimax/h3-image/highspeed/{text-to-image,edit}` |
| 痕迹AI 模型 ID | `fal-ai-minimax-h3-image`（canonical `minimax-h3-image`）；与视频模型 MiniMax H3（`fal-ai-minimax-h3`）是不同模型 |
| 接口形态 | Fal 队列异步（`queue.fal.run`），与其他 Fal 模型同协议 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与端点

| 能力 | 标准 | Highspeed |
|---|---|---|
| 文生图 | `minimax/h3-image/text-to-image` | `minimax/h3-image/highspeed/text-to-image` |
| 编辑 / 多图参考（1–16 张） | `minimax/h3-image/edit` | `minimax/h3-image/highspeed/edit` |

标准与 Highspeed 的输入字段、枚举、默认值完全相同，只有端点与价格不同。不支持遮罩重绘、透明背景。

## 2. 请求参数（OpenAPI，2026-11-14 读取）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | ≤32000；编辑时用 “Image 1/2…” 按 `image_urls` 顺序指代 |
| `image_urls` | string[] | 编辑必填 | — | 1–16 张，每边 128–8192 像素 |
| `image_size` | ImageSize \| enum | 否 | 文生 `{2048,2048}`；编辑 `auto` | 枚举 `square_hd` `square` `portrait_4_3` `portrait_16_9` `landscape_4_3` `landscape_16_9`（编辑另有 `auto`=沿用首图比例、2048² 面积内），或 `{width,height}`；面积 655,360–20,000,000，比例 1:3–3:1，单边 468–7745 |
| `num_images` | integer | 否 | `1` | 1–10，同一条扩写提示词出多张 |
| `enable_prompt_expansion` | boolean | 否 | `true` | 仅文生图有此字段；编辑恒开 |
| `output_format` | enum | 否 | `png` | `jpeg` / `png` / `webp` / `jpg`；按项目约定不展示、不下发 |
| `sync_mode` | boolean | 否 | `false` | 不展示、不下发 |

## 3. 响应结构

`{ images: ImageFile[], has_nsfw_concepts: boolean[], timings, actual_prompt?, usage? }`；`usage` 含 `input_tokens_details{text_tokens,image_tokens}`、`output_tokens_details{image_tokens}`。结果地址走 Fal 通用 `images[].url` 解析。

## 4. 价格（模型页 llms.txt，2026-11-14 读取，按 token 实际用量计费）

| 档 | 输入文本 | 输入图片 | 输出图片 |
|---|---|---|---|
| 标准 | $2.30 / 百万 token | $1.50 / 百万 token（编辑） | $3.80 / 百万 token |
| Highspeed | $2.30 / 百万 token | $3.00 / 百万 token（编辑） | $7.60 / 百万 token |

提示词扩写的文本计入输入文本 token。页面没有给出 token 与像素的换算；估价用调研经验值：输出约每 1024 像素 1 token（2K ≈ 4096、4K ≈ 16384），每张输入图约 2050 token，扩写后的提示词按约 4000 token 估（2K 单张标准版合计约 $0.025，与 MiniMax 官方单价约 $0.0236 接近）。实际扣费以 `usage` 为准。

## 5. 适配要点

- 一个模型，`falMiniMaxH3ImageVersion`（标准 / Highspeed，`role: mode`）切端点前缀；文生图与编辑按是否上传图片自动切换。
- 比例：智能比例本地换成具体比例（有图取首图最接近，无图 1:1），按 1K/2K/4K 面积算出 16 的倍数宽高发 `{width,height}`，不发 `auto`；所有组合在官方面积、比例与单边范围内。
- 提示词扩写开关只在未上传图片（文生图）时显示和下发。
- 未接入：`output_format`、`sync_mode`。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 标准文生图 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-image/text-to-image | 否 |
| 标准编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-image/edit | 否 |
| Highspeed 文生图 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-image/highspeed/text-to-image | 否 |
| Highspeed 编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-image/highspeed/edit | 否 |
| 标准文生图说明与价格 | https://fal.ai/models/minimax/h3-image/text-to-image/llms.txt | 否 |
| 标准编辑说明与价格 | https://fal.ai/models/minimax/h3-image/edit/llms.txt | 否 |
| Highspeed 文生图说明与价格 | https://fal.ai/models/minimax/h3-image/highspeed/text-to-image/llms.txt | 否 |
| Highspeed 编辑说明与价格 | https://fal.ai/models/minimax/h3-image/highspeed/edit/llms.txt | 否 |
| 模型介绍页 | https://fal.ai/minimax-h3-image | 否 |
| MiniMax 官方接口（契约参照，非本平台） | https://platform.minimax.io/docs/api-reference/image-generation-h3-generations.md | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
