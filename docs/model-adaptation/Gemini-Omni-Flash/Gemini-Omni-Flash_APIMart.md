# Gemini Omni Flash · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | **两条独立渠道**：`gemini-omni-flash-preview`（官方直连）与 `Omni-Flash-Ext` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> APIMart 上 Gemini Omni Flash 是两个平台模型、两份文档，能力集合与限制差异很大；Henji 产品中统一为一个“Gemini Omni Flash”入口，通过首项“渠道”（普通 / 官方）切换，运行时仍严格按各渠道契约、价格和限制分支。

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`
- **轮询建议**（`Omni-Flash-Ext` 文档）：提交后等 **5–10 秒**再开始查询，之后每 5–10 秒一次；**单个任务通常约 3–5 分钟完成**

---

## 2. 渠道 A：`gemini-omni-flash-preview`（Google 官方直连）

Google 官方 Gemini Omni Flash 全能多模态视频生成模型。支持文生视频、图生视频、**视频生视频（编辑）**，可混合文本 + 图片 + 视频输入。输出 **720p / 24fps / 3–10 秒 / 含音频**；支持**对话式多轮编辑**。

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | 固定 `gemini-omni-flash-preview` |
| `prompt` | string | 必填 | — | 文本指令。文生视频为场景描述；图/视频生视频为动作/风格/编辑指令。**`prompt` 与参考素材（`image_urls` / `video_urls`）至少提供其一** |
| `image_urls` | array | 可选 | — | 参考图，**最多 16 张**。`http(s)://` URL，支持 JPEG / PNG。多主体可传多张并在 prompt 中描述互动 |
| `video_urls` | array | 可选 | — | 参考 / 待编辑视频，**最多 1 个**（不支持多视频引用）。`http(s)://` 直链或 `data:video/...`。**参考视频 1–24 秒，官方建议 ≤ 3 秒**。**与 `extend_from_task_id` 互斥** |
| `aspect_ratio` | string | 可选 | `16:9` | **仅 `16:9` / `9:16`**，其它值按 `16:9` 处理。**传入 `video_urls` 后本参数失效** |
| `resolution` | string | 可选 | `720p` | **当前仅支持 `720p`** |
| `extend_from_task_id` | string | 可选 | — | 上一次生成任务的 `task_id`（对话式多轮编辑）。**与 `video_urls` 互斥** |
| `nsfw_check` | boolean | 可选 | `false` | 提交前内容审核 |

### 价格（`GEMINI-OMNI-FLASH-PREVIEW`）

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22，1 个档位）。

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 720P | 0.88 Credits/秒 ≈ **$0.088/秒** | $0.11 | 20% |

---

## 3. 渠道 B：`Omni-Flash-Ext`

统一视频生成模型。支持文生视频、单图生视频、**参考视频**和 **3 张参考图融合**；支持 **720p / 1080p / 4k**，**4 / 6 / 8 / 10 秒**。

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | 固定 `Omni-Flash-Ext` |
| `prompt` | string | 必填 | — | 建议详细描述场景、人物、动作、环境、镜头运动、画面风格和**音频提示** |
| `duration` | integer | 可选 | `6` | **仅支持 `4`、`6`、`8`、`10`**；传 5、7 等返回 `invalid_duration`。**传入 `video_urls` 时不需要也不能同时传 `duration`** |
| `resolution` | string | 可选 | `720p` | `720p` / `1080p` / `4k`（**不区分大小写**）；其它返回 `invalid_resolution` |
| `aspect_ratio` | string | 可选 | `16:9` | `16:9` / `9:16` |
| `size` | string | 可选 | — | 兼容字段，含义同 `aspect_ratio`；同时传入时建议保持一致 |
| `generation_type` | string | 可选 | — | `frame`（首帧模式，`image_urls` **只能 1 张**）/ `reference`（参考模式，`image_urls` **可 1 张或 3 张**） |
| `image_urls` | array | 可选 | — | 可不传（文生视频）/ 1 张（单图生视频）/ 3 张（参考图融合，仅 `generation_type=reference`）。**不支持 2 张图的首尾帧模式**，传 2 张返回 `unsupported_image_count`；4 张及以上未实测验证，不建议使用。只支持公网可访问 URL |
| `video_urls` | array | 可选 | — | **0 或 1 个**参考视频；2 个及以上返回 `unsupported_video_count`。**可与 `image_urls` 同时传入**（图片作身份/构图参考，视频作动态参考）。只支持公网 HTTP/HTTPS URL |
| `nsfw_check` | boolean | 可选 | `false` | 提交前内容审核 |

### 错误码

| HTTP | 错误类型 | 含义 | 处理建议 |
|---|---|---|---|
| 400 | `invalid_request_error` | `model` 不是 `Omni-Flash-Ext`、`prompt` 为空或 JSON 格式错误 | 检查请求体 |
| 400 | `invalid_duration` | `duration` 不是 4/6/8/10 | 改成支持的时长 |
| 400 | `invalid_resolution` | `resolution` 不是 720p/1080p/4k | 改成支持的分辨率 |
| 400 | `unsupported_image_count` | `image_urls` 数量不受支持（常见于传 2 张） | 改成 0、1 或 3 张 |
| 400 | `unsupported_video_count` | `video_urls` 传了 2 个及以上 | 改成 0 或 1 个 |
| 401 | `authentication_error` | Token 无效 | 检查 Bearer Token |
| 402 | `payment_required` | 余额不足 | 充值后重试 |
| 429 | `rate_limit_error` | 触发限流 | 降低并发或稍后重试 |

任务失败时，任务查询接口在 `data.error` 返回失败原因，常见为上游配额暂时耗尽、内容审核未通过或上游超时。

### 价格（`OMNI-FLASH-EXT`）

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22，**16 个档位，按次计费**，1 Credit ≈ $0.1）。

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 | 3.5 Credits/次 ≈ **$0.35/次** | $0.4375 | 20% |
| 720P-4S | 2.5 ≈ **$0.25/次** | $0.3125 | 20% |
| 720P-6S | 3 ≈ **$0.3/次** | $0.375 | 20% |
| 720P-8S | 3.5 ≈ **$0.35/次** | $0.4375 | 20% |
| 720P-10S | 4 ≈ **$0.4/次** | $0.5 | 20% |
| 720P-VIDREF | 0.8 ≈ **$0.08/次** | $0.1 | 20% |
| 1080P-4S | 2.5 ≈ **$0.25/次** | $0.3125 | 20% |
| 1080P-6S | 3 ≈ **$0.3/次** | $0.375 | 20% |
| 1080P-8S | 3.5 ≈ **$0.35/次** | $0.4375 | 20% |
| 1080P-10S | 4 ≈ **$0.4/次** | $0.5 | 20% |
| 1080P-VIDREF | 0.8 ≈ **$0.08/次** | $0.1 | 20% |
| 4K-4S | 7.5 ≈ **$0.75/次** | $0.9375 | 20% |
| 4K-6S | 8 ≈ **$0.8/次** | $1 | 20% |
| 4K-8S | 8.5 ≈ **$0.85/次** | $1.0625 | 20% |
| 4K-10S | 9 ≈ **$0.9/次** | $1.125 | 20% |
| 4K-VIDREF | 2.4 ≈ **$0.24/次** | $0.3 | 20% |

> **按次计费**（不是按秒），且 720P 与 1080P 同价；`VIDREF`（有参考视频）档位便宜很多。

## 4. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 这两条渠道都没有这两个字段。
- **两条渠道差异极大**：官方渠道只有 720p、时长 3–10 秒、参考图最多 16 张、支持 `extend_from_task_id` 多轮编辑；Ext 渠道有 1080p/4k、时长只能 4/6/8/10、参考图只能 0/1/3 张、没有多轮编辑。产品入口可以合并，但渠道选择必须驱动参数显隐、校验、请求、轮询与计价，不能把两套契约混用。
- Ext 渠道**不支持 2 张图的首尾帧**——这是与几乎所有其他视频模型都不同的限制，UI 必须挡住。
- Ext 渠道传参考视频时**不能同时传 `duration`**。
- 官方渠道传 `video_urls` 后 `aspect_ratio` 失效。
- Ext 渠道按次计费，时长与分辨率决定档位，成本估算逻辑与「按秒」模型完全不同。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Gemini Omni Flash 视频生成（官方渠道） | https://docs.apimart.ai/cn/api-reference/videos/gemini-omni-flash-preview/generation | 否 |
| Omni-Flash-Ext 视频生成 | https://docs.apimart.ai/cn/api-reference/videos/omni-flash-ext/generation | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页搜 GEMINI-OMNI-FLASH-PREVIEW / OMNI-FLASH-EXT） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
