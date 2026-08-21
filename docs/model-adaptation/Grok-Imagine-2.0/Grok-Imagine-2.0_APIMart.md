# Grok Imagine 2.0 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | **两条独立渠道**：`grok-imagine-2.0-ext`（EXT）与 `grok-imagine-image-2.0`（官方） |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> APIMart 上 Grok Imagine 2.0 有**三份文档、两条渠道**：
>
> - **`grok-imagine-2.0-ext`**：仅文生图 + **图层与选区编辑（segment / region_edit）**
> - **`grok-imagine-image-2.0`（官方渠道）**：文生图 + 单图编辑 + 多图参考（1–3 张）
>
> 上一版适配只覆盖了基础生成，**图层与选区编辑整块能力被遗漏**。

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/images/generations`
- **查询**：`GET /v1/tasks/{task_id}`，状态 `pending` / `processing` / `completed` / `failed`
- **轮询建议**（图层编辑文档）：从 **2 秒**间隔开始，逐步退避到最多 **5 秒**，总超时 **10 分钟**；切换源图或离开页面时用 `AbortController` 终止旧轮询
- ⚠️ **任务查询即使返回 HTTP 200，`data.status` 仍可能是 `failed`**，必须按 `data.status` 判断成败并展示 `data.error`

### 推荐请求头

| Header | 要求 | 说明 |
|---|---|---|
| `Authorization` | 必须 | `Bearer <APIMart API Key>` |
| `Content-Type` | 必须 | `application/json` |
| `Accept` | 推荐 | `application/json` |
| `Idempotency-Key` | **强烈推荐** | 每次「用户确认的一次逻辑生成」用新 UUID（1–191 个可见 ASCII 字符）；**网络重试必须复用同一 key 与完全相同的 body**。同 key 任务仍在处理时可能返回 `409 idempotency_in_progress`；返回 `idempotency_result_indeterminate` 时**停止自动重提并保留原 Key**，尤其不要为结果不确定的付费 `region_edit` 换新 Key |
| `X-APIMart-Response-Version` | 强烈推荐 | 固定 `2026-07-27`，确保响应结构稳定（`data.id`） |

> 安全提示（文档反复强调）：不要把 API Key 写进浏览器包（`VITE_*` / `NEXT_PUBLIC_*`）、LocalStorage、URL 或前端日志；浏览器只调业务 BFF，由服务端持有 Key。

---

## 2. 渠道 A：`grok-imagine-2.0-ext`（文生图）

### 2.1 能力与限制

| 维度 | 说明 |
|---|---|
| 模型名 | 固定 `grok-imagine-2.0-ext` |
| 能力 | **仅文生图** |
| 张数 `n` | `1`–`12`，默认 `1` |
| 比例 `size` | 7 种比例 + 5 种兼容像素写法 |
| 输出 | **仅 `response_format=url`** |
| 不支持 | 图生图、`stream=true`、`quality` 字段、`style`、`b64_json` / `base64` |
| 计费 | 固定单价，按**实际成功交付张数**计费 |
| 结果时效 | 图片链接有效期 **72 小时** |

### 2.2 请求参数

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | string | 是 | — | 固定 `grok-imagine-2.0-ext` |
| `prompt` | string | 是 | — | 去空格后不能为空，提交前请 `trim` |
| `n` | integer | 否 | `1` | `1`–`12`。**显式传 `0` 会报错** |
| `size` | string | 否 | — | 比例：`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`9:16`、`16:9`。兼容像素写法：`1024x1024`、`1024x1792`、`1792x1024`、`720x1280`、`1280x720`。**不在白名单内（如 `1:2`、`2:1`、`4:5`、`auto`）返回 `400 invalid_size`** |
| `nsfw_check` | boolean | 否 | `false` | `true` 时用 `omni-moderation-latest` 预审 |

> 同一比例下实际像素可能与兼容表不一致（如 `1:1` 可能返回 1408×1408）。**以返回图片为准，不要反推改写 `size`。**

---

## 3. 渠道 A 扩展：图层与选区编辑（`segment` / `region_edit`）

两者都复用同一个异步图片入口 `POST /v1/images/generations`，靠 `operation` 字段区分。

| 操作 | 用途 | 关键输入 | 完成结果 | 计费 |
|---|---|---|---|---|
| `segment` | 识别对象并获取图层、边界框和精确遮罩 | 已完成单图任务的 `source_task_id` | `image_id`、`image_url`、`objects` | **免费**（`cost` / `credits_cost` 均为 0） |
| `region_edit` | 修改多边形、矩形或对象所在区域 | segment 返回的 `image_id` + 编辑提示词 + 选区 | 新图片 URL 和新 `image_id` | **按完成任务结算** |

> ⚠️ `source_task_id` 与 `image_id` **不可互换**：`segment` 用来源**任务** ID；`region_edit` 用**图片资产** ID。编辑后要重新取图层时，把本次 `region_edit` 的 `task_id` 作为新的 `source_task_id`。

### 3.1 `segment` 请求参数

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | string | 是 | `grok-imagine-2.0-ext` | 固定 |
| `operation` | string | 是 | `segment` | 固定 `segment` |
| `source_task_id` | string | 是 | — | 当前用户**已完成**的 Grok **单图**任务 ID（必须成功、属于图片任务、最终结果仅 1 张图）。**不要同时发 `image_id` 或 `image_index`** |
| `include_mask_rle` | boolean | 否 | `true` | 是否返回 COCO compressed RLE。需要精确描边 / 画笔 / 多边形编辑时应显式设为 `true` |
| `cache_only` | boolean | 否 | `false` | 仅查缓存，未命中不回源。**不能与 `refresh=true` 同用** |
| `cached_only` | boolean | 否 | `false` | 传给上游的缓存提示，不代表本地一定命中 |
| `refresh` | boolean | 否 | `false` | 强制跳过缓存重取。不要用于普通编辑器流程，**不能与 `cache_only=true` 同用** |
| `nsfw_check` | boolean | 否 | `false` | 审核来源图片 |

`segment` **不需要 `prompt`**，也不要发送 `billing_model_name`、`n`、`size`、`response_format`。

### 3.2 `segment` 完成响应

`data.result` **直接是分段结果，不包在 `images` 里**：

```json
{ "code": 200, "data": { "id": "task_...", "status": "completed", "progress": 100,
  "cost": 0, "credits_cost": 0,
  "result": { "created": 1786784507, "source_task_id": "task_...",
    "image_id": "6b78a7c3-...", "image_url": "https://.../source.jpg",
    "cached": false, "from_cache": true, "cache_status": "hit",
    "objects": [ { "index": 0, "name": "red sports car",
      "box_xyxy": [38.1, 689.8, 945.8, 1065.4], "score": 0.9765625,
      "mask_size": [1792, 1008], "mask_url": "",
      "mask_rle": { "size": [1792, 1008], "counts": "..." } } ] } } }
```

| 字段 | 说明 |
|---|---|
| `result.image_id` | 来源图片的资产 ID，后续 `region_edit` 使用此值 |
| `result.image_url` | 与 `image_id` 对齐的公网图片 URL |
| `objects[].index` | 服务端原始对象索引；使用 `object_indices` 时**必须原样保留** |
| `objects[].box_xyxy` | mask 像素坐标 `[x1,y1,x2,y2]` |
| `objects[].score` | 识别置信度，**可能为 `null`** |
| `objects[].mask_size` | **`[height, width]`**，不可写死图片尺寸 |
| `objects[].mask_rle` | COCO compressed RLE，精确描边的首选数据 |
| `objects[].mask_url` | 可选的遮罩图片 URL，**可能为空** |

没有有效 `mask_rle` 或 `mask_url` 的对象只能用于矩形近似编辑，不能标记为精确图层。

### 3.3 `region_edit` 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 是 | 固定 `grok-imagine-2.0-ext` |
| `operation` | string | 是 | 固定 `region_edit` |
| `image_id` | string | 是 | 当前源图资产 ID。首次编辑用 segment 的 `result.image_id`；连续编辑用上次编辑返回的新 `image_id` |
| `prompt` | string | 是 | 描述如何修改选区，去空格后不能为空 |
| `selection_regions` | array | △ | **精确多边形选区**，推荐用于正式图层和画笔编辑。坐标**归一化到 0~1**，支持 `outer` 与可选 `holes`；`points` 可用扁平数组或 `[[x0,y0],...]`；每个 ring 至少 3 对坐标 |
| `boxes` | array | △ | 矩形选区，每项 `[x1,y1,x2,y2]`。可用归一化坐标；**用像素坐标时必须同时传 `mask_size`**。每个 box 恰好 4 个非负有限数字且 `x2>x1`、`y2>y1` |
| `object_indices` | array | △ | segment 返回的原始 `objects[].index`。上游按**对象边界框**编辑，**只适合快速联调或矩形近似**。索引必须来自同一 `image_id` 的 segment 响应，不要用前端过滤 / 排序后的数组下标 |
| `mask_size` | array | 条件 | 像素 `boxes` 使用的 `[height, width]`，两个值都必须为正整数 |
| `nsfw_check` | boolean | 否 | 审核编辑提示词与输入图 |

`selection_regions` / `boxes` / `object_indices` **至少有一个非空**；接口允许组合，但建议一次只用一种。

**不要发送**：`billing_model_name`、`size`、`aspect_ratio`、`source_aspect_ratio`、`source_size`、`image_urls`。`n` 只能省略或为 `1`；`claim_asset` 只能省略或为 `false`；`response_format` 只能省略或为 `url`；不支持 Base64 输出与 `stream=true`。

### 3.4 错误码

| HTTP | 错误码 | 常见原因 | 处理 |
|---|---|---|---|
| 400 | `invalid_operation` | `operation` 缺失或不支持 | 只用 `segment` / `region_edit` |
| 400 | `invalid_source_task` | segment 来源任务不可用，或传了 `image_id` / `image_index` | 用当前用户已完成的 Grok 单图任务 ID |
| 400 | `conflicting_cache_flags` | 同时用 `cache_only` 和 `refresh` | 二选一 |
| 400 | `missing_image_id` | region edit 缺资产 ID | 用 segment 返回的 `result.image_id` |
| 400 | `empty_prompt` | 编辑提示词为空 | 前端阻止提交 |
| 400 | `invalid_selection_regions` | 无选区、坐标、点数或 box 非法 | 前端校验并标记 |
| 400 | `invalid_object_index` | 对象索引非法 | 保留原始索引 |
| 400 | `invalid_claim_asset` | `claim_asset=true` | 省略或设 `false` |
| 400 | `invalid_n` | `n` 不是 1 | 省略或设 1 |
| 400 | `invalid_response_format` | 请求 Base64 等 | 省略或用 `url` |
| 400 | `invalid_stream` | 请求流式 | 移除 `stream` |
| 401 / 403 | — | Key 无效或模型未开通 | 检查 Key 与账户权限 |

---

## 4. 渠道 B：`grok-imagine-image-2.0`（官方渠道）

### 4.1 能力

| 模型 | 分辨率 | `quality` | 输入图 | 输出张数 |
|---|---|---|---|---|
| `grok-imagine-image-2.0` | `1k`、`2k` | **仅文生图**支持 `low`、`medium` | 0–3 张 | **1–10 张** |

| 场景 | `image_urls` | 处理方式 |
|---|---|---|
| 文生图 | 不发送 | 根据提示词生成 |
| 单图编辑 | 1 张 | 根据提示词编辑参考图 |
| 多图参考 | 2–3 张 | 按数组顺序融合或参考多张图 |

**提交成功时 HTTP 状态为 `202`**，任务 ID 在 `data.id`，可用 `data.poll_url` 或 `GET /v1/tasks/{task_id}` 轮询。

### 4.2 请求参数

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | string | 是 | `grok-imagine-image-2.0` | 固定值 |
| `prompt` | string | 是 | — | 去首尾空格后不能为空，**最多 8000 字符**。多图参考时可用 `<IMAGE_0>` / `<IMAGE_1>` / `<IMAGE_2>` 按数组顺序引用 |
| `n` | integer | 否 | `1` | `1`–`10` |
| `aspect_ratio` | string | 否 | — | 完整允许值：`1:1`、`3:4`、`4:3`、`9:16`、`16:9`、`2:3`、`3:2`、`9:19.5`、`19.5:9`、`9:20`、`20:9`、`1:2`、`2:1`、`auto`（**14 种**）。**新接入不要发送像素尺寸字符串** |
| `resolution` | string | 否 | `1k` | `1k` / `2k` |
| `quality` | string | 否 | `medium` | `low` / `medium`。**仅文生图支持；请求含 `image_urls` 时不要发送**（加参考图时要清除表单遗留值） |
| `image_urls` | array | 否 | — | 参考图，**1–3 张**。仅接受公网可访问的绝对 `http(s)` URL。**没有参考图时应省略本字段，不要发空数组**；数组顺序保留；重复图片按多张输入处理并按张计费 |
| `nsfw_check` | boolean | 否 | `false` | 审核提示词与输入图 |

### 4.3 上传本地参考图

`POST /v1/uploads/images`，表单字段固定为 `file`（`multipart/form-data`）。支持 JPEG / PNG / WebP，单张 **≤ 10 MiB**；使用 `FormData` 时不要手动设置 `Content-Type`。

### 4.4 报价接口（推荐）

官方渠道提供**预估价格接口**。参数：`model`（必填）、`n`、`aspect_ratio`、`resolution`、`quality`（仅 2.0 文生图传）、`input_images`（等于 `image_urls.length`，无参考图为 0）。

返回字段：`final_usd`（**唯一应展示的预估总价**）、`unit_price_usd`、`input_surcharge_usd`、`image_count`、`input_images`、以及服务端规范化后的 `resolution` / `quality` / `aspect_ratio`。

> ⚠️ **不要用 `unit_price_usd × image_count + input_surcharge_usd` 替代 `final_usd`**——用户折扣、分组价格和整单取整会让自算结果不同。输入图片从第 1 张开始计费，按输入张数计算，**不乘输出数量 `n`**。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22 读取，1 Credit ≈ $0.1）。

**GROK-IMAGINE-2.0-EXT**

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 | 0.15 Credits/张 ≈ **$0.015/张** | $0.01875 | 20% |
| `region-edit` | 0.15 Credits/张 ≈ **$0.015/张** | $0.01875 | 20% |

> 注：`grok-imagine-2.0-ext` 的 API 文档正文写「$0.08/张」，与定价中心的 $0.015/张不一致，**以定价中心与报价接口的 `final_usd` 为准**。

**GROK-IMAGINE-IMAGE-2.0**（官方渠道）

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 1K@low | 0.32 Credits/张 ≈ **$0.032/张** | $0.04 | 20% |
| 1K@medium | 0.48 Credits/张 ≈ **$0.048/张** | $0.06 | 20% |
| 2K@low | 0.48 Credits/张 ≈ **$0.048/张** | $0.06 | 20% |
| 2K@medium | 0.64 Credits/张 ≈ **$0.064/张** | $0.08 | 20% |
| 输入参考图 | 0.08 Credits/张 ≈ **$0.008/张** | $0.01 | 20% |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 这两条渠道都没有这两个字段。
- **两条渠道能力互补，不要合成一个模型**：EXT 只能文生图但有图层/选区编辑；官方渠道能图生图和多图参考但没有 segment。
- **图层与选区编辑是完整的第二套工作流**（segment → region_edit → 连续编辑），需要「结果卡片 → 分割 → 框选/多边形 → 编辑」的交互载体，不能塞进普通出图参数里。
- `segment` 免费但 `region_edit` 付费，且强烈依赖 `Idempotency-Key` 防重复扣费；结果不确定时不能自动换 Key 重提。
- `mask_size` 是 `[height, width]`，不是 `[width, height]`，写反会导致选区错位。
- 官方渠道的 `quality` **只在文生图时能发**，加了参考图必须清掉，否则报错。
- 比例白名单差异极大：EXT 只有 7 种且不支持 `auto`；官方渠道有 14 种且支持 `auto`、`9:19.5`、`20:9` 这类罕见比例。
- 官方渠道提交返回 **202**（不是 200），状态机要覆盖。
- 价格应走报价接口取 `final_usd`，不要前端硬编码。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Grok Imagine 2.0 Ext 图像生成 | https://docs.apimart.ai/cn/api-reference/images/grok-imagine-2.0-ext/generation | 否 |
| Grok Imagine 2.0 Ext 图层与选区编辑 | https://docs.apimart.ai/cn/api-reference/images/grok-imagine-2.0-ext/layer-region-edit | 否 |
| Grok Imagine Image 2.0 官方图像生成与编辑 | https://docs.apimart.ai/cn/api-reference/images/grok-imagine-2.0-ext/official | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（搜 GROK-IMAGINE-2.0-EXT / GROK-IMAGINE-IMAGE-2.0） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
