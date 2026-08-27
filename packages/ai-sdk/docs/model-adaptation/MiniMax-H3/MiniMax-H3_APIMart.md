# MiniMax H3 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `MiniMax-H3`、`MiniMax-H3-Context-IR`、`MiniMax-H3-Regeneration` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> APIMart 上 MiniMax H3 是**三个模型、三份文档**：视频生成、**Context-IR 提示词增强**、**Regeneration 再生成（768P → 2K）**。后两个是上一版适配遗漏的能力。

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`。**建议每 5~10 秒轮询一次，客户端超时设为 15 分钟**
- **结果**：`result.videos[0].url` 为 mp4 地址；**视频 URL 约 24 小时有效**，请及时转存。任务失败自动退款
- **回调**：用 `webhook` 参数（**不要传官方的 `callback_url`**，该字段由平台内部使用，不接受用户传入）
- 与 MiniMax-Hailuo-02 / MiniMax-Hailuo-2.3 共用统一提交与查询接口

---

## 2. 模型 A：`MiniMax-H3`（视频生成）

### 2.1 生成模式（靠字段自动路由，**无需 `mode` 字段**）

| 模式 | 触发条件 | 能力 |
|---|---|---|
| 文生视频（T2V） | 只传 `prompt` 及通用字段 | 纯文本驱动生成 |
| 图生视频（I2V） | `first_frame_image` / `last_frame_image`（或 `image_with_roles` 的 `first_frame` / `last_frame`） | 首帧、尾帧、首尾帧控制 |
| 多模态参考（R2V） | `image_urls` / `video_urls` / `audio_urls`，或 `image_with_roles` 的 `reference_image` | 参考图 + 参考视频 + 参考音频 |

> ⚠️ **严格互斥**：图生视频字段与多模态参考字段**不能同时出现，混用返回 400**。
> ⚠️ **不能只给音频**：传了 `audio_urls` 时必须至少再配一个参考图或参考视频。

### 2.2 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | 固定 `MiniMax-H3`。**必须显式传递** |
| `prompt` | string | **必填** | — | **任何场景都必填且不能为空**，单条 ≤ **7000** 字符 |
| `duration` | integer | 可选 | `5` | **4 ~ 15 的整数** |
| `resolution` | string | 可选 | **`2K`** | `2K`（默认）/ `768P` |
| `aspect_ratio` | string | 可选 | 见「宽高比规则」 | `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。**也可用 `size` 或 `ratio` 传，效果相同** |
| `watermark` | boolean | 可选 | `false` | AIGC 水印。兼容字段名 `aigc_watermark` |
| `webhook` | string | 可选 | — | 任务终态时主动推送 |
| `first_frame_image` | string | 可选 | — | 首帧图 URL |
| `last_frame_image` | string | 可选 | — | 尾帧图 URL，可与首帧组合实现首尾帧控制 |
| `image_urls` | string[] | 可选 | — | **一律按参考图（`reference_image`）处理，不管传几张，不会按张数自动当成首帧 / 首尾帧**。≤ **9** 张 |
| `video_urls` | string[] | 可选 | — | 参考视频，≤ **3** 个 |
| `audio_urls` | string[] | 可选 | — | 参考音频，≤ **3** 个。**不能单独使用，必须搭配参考图或参考视频** |
| `image_with_roles` | object[] | 可选 | — | `{ url, role }`，`role` ∈ `first_frame`（也接受 `first`）/ `last_frame`（也接受 `last`）/ `reference_image`（也接受 `reference`）。可替代上面三个字段 |
| `nsfw_check` | boolean | 可选 | `false` | 提交前内容审核 |

### 2.3 宽高比规则（**易踩坑**）

| 场景 | `aspect_ratio` 行为 |
|---|---|
| 文生视频（只有 prompt） | **必须是具体比例；不传或传 `adaptive` 会回落到 `16:9`** |
| 图生视频（有首 / 尾帧） | **由输入图片决定，传什么都会被忽略**（恒 `adaptive`） |
| 多模态参考生视频 | 可选，默认 `adaptive`；也可显式指定具体比例 |

### 2.4 输入媒体限制

**请求体总大小 ≤ 64 MB。大文件请使用公网 URL，不要使用 Base64。**

| 图片 | 限制 |
|---|---|
| 格式 | JPG / JPEG / PNG / WEBP / HEIC / HEIF |
| 单文件 | ≤ 30 MB |
| 宽高 | 256 ~ 5760 px |
| 长宽比（宽/高） | 0.4 ~ 2.5 |
| 数量 | 首帧 ≤ 1、尾帧 ≤ 1、参考图 ≤ 9 |

| 视频（仅多模态参考场景） | 限制 |
|---|---|
| 格式 | MP4（`.mp4`）、MOV（`.mov`） |
| 编码 | 视频 H.264/AVC、H.265/HEVC；音频 AAC、MP3 |
| 单文件 | ≤ 50 MB |
| 个数 | ≤ 3 |
| 时长 | 单段 2 ~ 15 s；**总时长 ≤ 15 s** |
| 宽高 / 长宽比 / 帧率 | 256 ~ 5760 px / 0.4 ~ 2.5 / 23.976 ~ 60 |

| 音频（仅多模态参考场景） | 限制 |
|---|---|
| 格式 | WAV、MP3 |
| 单文件 | ≤ 15 MB |
| 个数 | ≤ 3 |
| 时长 | 单段 2 ~ 15 s；总时长 ≤ 15 s |

### 2.5 参数约束（违反返回 400，敏感内容可能 422，**均不产生计费**）

| 参数 | 约束 |
|---|---|
| `prompt` | 任何场景必填且非空，≤ 7000 字符 |
| `duration` | 仅接受 4 ~ 15 的整数 |
| `resolution` | `2K`（默认）或 `768P` |
| `aspect_ratio` | 见「宽高比规则」 |
| 首尾帧与参考素材 | **互斥**，不能混用 |
| `audio_urls` | 不能单独输入 |
| 参考图 / 参考视频 / 参考音频 | ≤ 9 / ≤ 3 / ≤ 3 |
| 参考视频探测失败 | 返回 `input_video_probe_failed`（URL 不可访问或文件损坏），**未扣费** |

---

## 3. 模型 B：`MiniMax-H3-Context-IR`（提示词增强）

多模态上下文理解，产出增强后的**结构化提示词**（**不生成视频**）。通常 20~40 秒出结果。

**结果在 `result.prompt`（不是 `result.videos`）**，把它**原样**作为 `MiniMax-H3` 的 `prompt` 即可继续生成。

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | 固定 `MiniMax-H3-Context-IR` |
| `prompt` | string | 必填 | — | 原始想法描述，**≤ 7000 字符** |
| `duration` | integer | 可选 | `5` | 目标视频时长 4~15，影响增强结果中的节奏描述 |
| `aspect_ratio` | string | 条件 | — | 目标画幅。**纯文本输入时必填，且不能是 `adaptive`** |
| `first_frame_image` / `last_frame_image` | string | 可选 | — | 首帧 / 尾帧图 URL |
| `image_urls` | string[] | 可选 | — | 参考图，≤ 9 张 |
| `image_with_roles` | object[] | 可选 | — | 同生成接口 |
| `video_urls` | string[] | 可选 | — | 参考视频，≤ 3 段；单段 2~15 s，总时长 ≤ 15 s |
| `audio_urls` | string[] | 可选 | — | 参考音频，≤ 3 段；**不能单独输入** |
| `nsfw_check` | boolean | 可选 | `false` | — |

素材字段与视频生成**校验规则一致**（首尾帧与参考互斥、不能只给音频）。

**计费：按 token（H3 家族中唯一按 token 结算的模型）**——输入 **$0.87 / 百万 tokens**，输出 **$3.45 / 百万 tokens**。典型一次调用（约 5.6k 输入 + 3.4k 输出）约 **$0.0167**。

---

## 4. 模型 C：`MiniMax-H3-Regeneration`（768P → 2K 再生成）

> ⚠️ **不是通用超分。** 源视频必须是 **MiniMax-H3 生成的 768P 成片**，外部视频（手机拍摄、其他模型生成等）会被拒绝。

**推荐用法：只传 `source_task_id`**，服务端自动回填 `prompt`、素材与源视频。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 必填 | 固定 `MiniMax-H3-Regeneration` |
| `source_task_id` | string | 必填 | 上一条**成功的 MiniMax-H3 · 768P** 任务 ID。传入后**无需**再传 `prompt`、源视频与参考素材 |
| `nsfw_check` | boolean | 可选 | — |

`source_task_id` 须**同时满足**以下条件，否则**同步 400**（不建任务、不扣费）：归属当前账号；模型为 `MiniMax-H3`；状态为成功（`completed`）；分辨率为 `768P`。

**源视频规格**（不符会在任务失败时返回原因并退款）：

| 项目 | 要求 |
|---|---|
| 音轨 | **必须有**，不支持无音轨视频 |
| 帧率 | 24 fps |
| 宽 / 高 | 均能被 32 整除 |
| 面积 | ≤ 768 × 1344（1,032,192 像素） |
| 总帧数 | 107 ~ 362 帧，每档递增 17 帧（约 4 ~ 15 秒） |

**计费**（按秒，结构与 H3 生成同构，单价不同）：

| 项目 | 单价 |
|---|---|
| 输出（768P → 2K） | **$0.045 / 秒** |
| 输入参考视频 | **$0.045 / 秒** |
| 输入图片 | 5 张以内免费，超出 **$0.0225 / 张** |
| 输入音频 | 免费 |

> 原 768P 任务用过的素材在再生成时会**重新计费**，不只收输出秒数。
> 算例：5 秒源视频无额外素材 = $0.225；10 秒源视频 + 2 张图 = $0.45（图 ≤ 5 免费）。

### Full 2K Workflow（官方推荐的省钱路径）

① `Context-IR` 增强 prompt → ② `MiniMax-H3` 用 `768P` 出预览 → ③ `Regeneration` 升 2K。
**三步单价合计等于直出 2K，但试错成本更低。**

---

## 5. 价格（定价中心）

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → 视频标签页（2026-08-22，1 Credit ≈ $0.1）。

**MINIMAX-H3**（7 个档位）

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 / 2K | 0.9144 Credits/秒 ≈ **$0.09144/秒** | $0.1143 | 20% |
| 768P | 0.5712 Credits/秒 ≈ **$0.05712/秒** | $0.0714 | 20% |
| 输入参考图（**前 5 张免费**） | 0.2288 Credits/张 ≈ **$0.02288/张** | $0.0286 | 20% |
| 输入参考视频（规格与生成视频相同，**与生成时长叠加计费**，参考视频最多 15 秒） | 默认/2K 0.9144 Credits/秒 ≈ $0.09144/秒；768P 0.5712 ≈ $0.05712/秒 | — | 20% |

**MINIMAX-H3-REGENERATION**（5 个档位）

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 / 2K | 0.3432 Credits/秒 ≈ **$0.03432/秒** | $0.0429 | 20% |
| 输入参考图（**前 5 张免费**） | 0.1712 Credits/张 ≈ **$0.01712/张** | $0.0214 | 20% |
| 输入参考视频（与生成时长叠加计费，最多 15 秒） | 0.3432 Credits/秒 ≈ $0.03432/秒 | $0.0429 | 20% |

**MINIMAX-H3-CONTEXT-IR**

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 | 0.8 Credits/次 ≈ **$0.08/次** | $0.1 | 20% |

> 定价中心的 Context-IR 是「按次」，而 API 文档写的是「按 token」（约 $0.0167/次）。两处口径不同，以定价中心与任务返回的 `cost` 为准。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 这三个模型都没有这两个字段。
- **`aspect_ratio` 的行为按模式变化**：文生视频不传会回落 `16:9`；图生视频**传了也被忽略**。UI 上在图生视频模式下应禁用比例选择，否则用户以为选了却没生效。
- **`image_urls` 永远是参考图**，不会因为传 1 张就变成首帧——首帧必须显式用 `first_frame_image` 或 `image_with_roles`。这是与 Seedance 完全不同的语义。
- 首尾帧与多模态参考**严格互斥**，混用直接 400。
- 请求体总大小 ≤ 64 MB，禁止 Base64 大文件。
- `resolution` **默认 `2K`**（最贵的档），若产品要控成本必须显式下发 `768P`。
- Context-IR 与 Regeneration 是两条独立能力：前者只产出文本、后者只接受本平台自家的 768P 任务 ID。要做「预览再升级」的省钱链路就必须把三者串起来。
- 参考视频与生成时长**叠加计费**，成本估算不能只算输出秒数。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| MiniMax-H3 视频生成 | https://docs.apimart.ai/cn/api-reference/videos/minimax-h3/generation | 否 |
| MiniMax-H3 Context-IR 提示词增强 | https://docs.apimart.ai/cn/api-reference/videos/minimax-h3/context-ir | 否 |
| MiniMax-H3 Regeneration 再生成 | https://docs.apimart.ai/cn/api-reference/videos/minimax-h3/regeneration | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页搜 MINIMAX-H3） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
