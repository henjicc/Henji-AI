# Grok Imagine 2.0 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `grok-imagine-image-2-0/text-to-image`、`grok-imagine-image-2-0/image-edit`、`grok-imagine-image-2-0/segment-map`、`grok-imagine-image-2-0/segment-edit` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> KIE 上 Grok Imagine 2.0 有 **4 个端点**，其中 `segment-map` + `segment-edit` 是完整的「分割 → 按分割索引编辑」工作流。上一版适配只覆盖了基础生成，这两个端点被遗漏。

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model, callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **结果**：`JSON.parse(resultJson)`；普通生成为 `{ resultUrls: [...] }`，分割类为 `{ resultObject: {...} }`

## 2. 能力清单

| 能力 | model |
|---|---|
| 文生图 | `grok-imagine-image-2-0/text-to-image` |
| 图片编辑（1–5 张参考图） | `grok-imagine-image-2-0/image-edit` |
| **分割图**（拿到对象分割结果） | `grok-imagine-image-2-0/segment-map` |
| **按分割索引编辑** | `grok-imagine-image-2-0/segment-edit` |

## 3. 请求参数

### 3.1 `grok-imagine-image-2-0/text-to-image`

| 字段 | 类型 | 必填 | 取值与说明 |
|---|---|---|---|
| `input.prompt` | string | 必填 | 图像描述 |
| `input.aspect_ratio` | string | **必填** | **只有 5 个**：`1:1`、`2:3`、`3:2`、`16:9`、`9:16`（**没有 `auto`**） |

文生图端点**没有 `n`、`resolution`、`quality`**。

### 3.2 `grok-imagine-image-2-0/image-edit`

> 该端点的文档页路径是 `.../image-to-image`，但 `model` 值与 `operationId` 都是 **`image-edit`**。

| 字段 | 类型 | 必填 | 取值与说明 |
|---|---|---|---|
| `input.image_urls` | array | **必填** | 参考图 URL 数组，**1–5 张**（比 APIMart 官方渠道的 3 张多） |
| `input.aspect_ratio` | string | **必填** | `1:1`、`2:3`、`3:2`、`16:9`、`9:16`、**`auto`**（6 个） |
| `input.prompt` | string | 可选 | 最多 **390000** 字符（异常宽松，疑似文档写错，接入前实测） |

### 3.3 `grok-imagine-image-2-0/segment-map`（分割图）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `input` | object | 必填 | **`oneOf` 两种形态，二选一**：<br>① `{ "task_id": "task_grok_imagine_..." }` —— 对现有任务的图做分割<br>② `{ "image_url": "https://..." }` —— 对指定参考图做分割 |

### 3.4 `grok-imagine-image-2-0/segment-edit`（按分割索引编辑）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `input.prompt` | string | 必填 | 描述所需图像的提示词 |
| `input.task_id` | string | 必填 | 源任务 ID。可以是 `grok-imagine-image-2-0/text-to-image` 生成的 taskId，**也可以是 `segment-map` 通过 `image_url` 生成的 taskId** |
| `input.mask_indexs` | array | 可选 | 要使用的分段数组项的**索引编号**（至少 1 项）。注意字段名拼写是 `mask_indexs`（少一个 e） |

## 4. 响应结构

- 普通生成 / 编辑：`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`
- 分割类：`resultJson` 走 `{ "resultObject": {...} }` 形态（KIE 通用任务详情文档明确：文本 / 结构化结果用 `resultObject`）

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `grok`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| `grok-imagine-image-2-0`, Text to Image | 4 /张 | **$0.02/张** | $0.06 | 66.7% |
| `grok-imagine-image-2-0`, Image Edit | 4 /张 | **$0.02/张** | $0.06 | 66.7% |

定价页未单独列出 `segment-map` / `segment-edit` 的价格档位，接入前需确认这两个动作如何计费。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本组接口都没有这两个字段。
- **4 个端点里有 2 个是分割工作流**，`segment-map` → 拿分割索引 → `segment-edit` 按索引编辑，必须作为独立能力分支，不能塞进普通出图。
- `aspect_ratio` 在文生图端点是**必填且无 `auto`**，在编辑端点才有 `auto`——两个端点的比例集合不同。
- 文生图没有分辨率/质量档位，比 APIMart 官方渠道和 Fal 都少。
- 编辑端点参考图上限 5 张，比 APIMart（3 张）和 Fal（3 张）都多。
- `mask_indexs` 字段名拼写不规范，容易写成 `mask_indexes`。
- `image-edit` 的 `prompt` 上限标注 390000 字符，明显异常，接入前实测确认。
- `resultJson` 是 JSON 字符串，必须二次 parse；分割类走 `resultObject` 而不是 `resultUrls`。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Grok Imagine Image 2.0 文生图 | https://docs.kie.ai/cn/market/grok-imagine-image-2-0/text-to-image | 否 |
| Grok Imagine Image 2.0 图片编辑 | https://docs.kie.ai/cn/market/grok-imagine-image-2-0/image-to-image | 否 |
| Grok Imagine Image 2.0 Segment Map | https://docs.kie.ai/cn/market/grok-imagine-image-2-0/segment-map | 否 |
| Grok Imagine Image 2.0 Segment Edit | https://docs.kie.ai/cn/market/grok-imagine-image-2-0/image-edit | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `grok`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
