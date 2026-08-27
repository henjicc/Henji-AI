# Seedream 5.0 Lite · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `seedream-5-0-lite`（兼容 `seedream-5.0-lite`、`Seedream-5.0-lite`） |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/images/generations` → `{ "code": 200, "data": [{ "status": "submitted", "task_id": "..." }] }`
- **查询**：`GET /v1/tasks/{task_id}`（可加 `?language=zh`），`status` 取 `pending` / `processing` / `completed` / `failed` / `cancelled`，结果在 `result.images[]`
- **结果时效**：文档标注生成的图像链接 **有效期 72 小时**，请尽快保存

任务查询字段与错误类型与平台其他模型一致（`progress`、`cost`、`credits_cost`、`created`、`completed`、`estimated_time`、`actual_time`、`error.{code,message,type}`）。

## 2. 能力清单

| 能力 | 触发方式 |
|---|---|
| 文生图 | 只传 `prompt` |
| 图生图（参考图） | `image_urls` |
| 组图生成 | `n > 1`（自动置 `sequential_image_generation: auto`），或显式 `sequential_image_generation: "auto"` + `sequential_image_generation_options.max_images` |

## 3. 请求参数（Body）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | `seedream-5-0-lite` | 也接受 `seedream-5.0-lite`、`Seedream-5.0-lite` |
| `prompt` | string | 必填 | — | 图像生成的文本描述 |
| `size` | string | 可选 | `1:1` | 宽高比：`1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`、`2:1`、`1:2`、`21:9`、`auto`（自动匹配参考图比例，需配合 `image_urls`）。`2x1`≡`2:1`、`1x2`≡`1:2`，别名中的 `x` 必须小写且无空格。**不支持 `9:21`** |
| `resolution` | string | 可选 | `2K` | `2K` / `3K` / `4K`。**不支持 1K** |
| `n` | integer | 可选 | `1` | 1–15。**必须是纯数字，加引号会报错**。`n > 1` 自动启用组图模式；按生成数量预扣费 |
| `image_urls` | array | 可选 | — | 参考图 URL 或完整 Data URI（`data:image/{jpeg|png};base64,{数据}`，前缀不能省） |
| `output_format` | string | 可选 | `jpeg` | `jpeg` / `png`。文档注明该参数为 Seedream-5.0-Lite 特有，其他图片模型传入会被忽略 |
| `sequential_image_generation` | string | 可选 | `disabled` | `disabled` / `auto` |
| `sequential_image_generation_options.max_images` | integer | 可选 | — | 指定生成图片数量 |
| `watermark` | boolean | 可选 | `false` | 是否加水印 |
| `nsfw_check` | boolean | 可选 | `false` | `true` 时用 `omni-moderation-latest` 预审提示词与输入图 |

> **硬约束**：`image_urls` 中的参考图数量 + `n` 指定的生成数量必须 **≤ 15 张**。

### 分辨率 × 比例 → 实际像素

| 比例 | 2K | 3K | 4K |
|---|---|---|---|
| 1:1 | 2048×2048 | 3072×3072 | 4096×4096 |
| 4:3 | 2304×1728 | 3456×2592 | 4704×3520 |
| 3:4 | 1728×2304 | 2592×3456 | 3520×4704 |
| 16:9 | 2848×1600 | 4096×2304 | 5504×3040 |
| 9:16 | 1600×2848 | 2304×4096 | 3040×5504 |
| 3:2 | 2496×1664 | 3744×2496 | 4992×3328 |
| 2:3 | 1664×2496 | 2496×3744 | 3328×4992 |
| 2:1 | 2880×1440 | 4320×2160 | 5760×2880 |
| 1:2 | 1440×2880 | 2160×4320 | 2880×5760 |
| 21:9 | 3136×1344 | 4704×2016 | 6240×2656 |

### 参考图限制（比 Pro 更严）

- 格式：jpeg、png
- 宽高比（宽/高）：**`[1/3, 3]`**（Pro 是 `[1/16, 16]`）
- 单边 > 14 px
- 单张 ≤ **10 MB**（Pro 是 30 MB）
- 总像素 ≤ 6000×6000

## 4. 响应结构

提交返回 `task_id`；轮询 `GET /v1/tasks/{task_id}`，成功后读 `result.images[]`，每个元素的 `url` 是**数组**（组图时一个任务返回多张）。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22 读取，图像标签页，1 Credit ≈ $0.1）。

| 规格 | 价格 |
|---|---|
| 默认（唯一档位） | 0.228 Credits/张 ≈ **$0.0228/张** |

定价中心显示 `SEEDREAM-5-0-LITE` 只有 1 个价格档位，未按 2K/3K/4K 分档，也未标注官方价与折扣。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本接口无这两个字段。
- `output_format` 默认不显示、不请求。
- 比例集合与 Pro 不同：Lite 支持 `auto`，但不支持 `9:21`；分辨率档位是 2K/3K/4K。
- SDK 对 `4:5` / `5:4` 等官方列表外比例显式报错，不再静默回退 1:1；旧 Photoshop 插件应从本模型的比例选项中移除这两档。
- `n` 必须以数字类型下发，序列化时不要变成字符串。
- 组图模式下一个任务返回多张图，`result.images[].url` 数组需要整体消费。
- 参考图宽高比被限制在 `[1/3, 3]`、单张 ≤ 10 MB，上传前应做校验，否则会被拒。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Seedream-5.0-Lite 图像生成 API | https://docs.apimart.ai/cn/api-reference/images/seedream-5-lite/generation | 否 |
| 同页纯 Markdown | https://docs.apimart.ai/cn/api-reference/images/seedream-5-lite/generation.md | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| Webhook 回调 | https://docs.apimart.ai/cn/api-reference/tasks/webhook | 否 |
| 定价中心（搜 SEEDREAM-5-0-LITE） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
