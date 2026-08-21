# Qwen Image 3.0 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `qwen-image-3.0`（标准）、`qwen-image-3.0-pro`（Pro） |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/images/generations` → `{ "code": 200, "data": [{ "status": "submitted", "task_id": "..." }] }`
- **查询**：`GET /v1/tasks/{task_id}`，读 `result.images`
- **轮询建议**：每 **3–5 秒**一次，超时约 **3 分钟**（2K + 多张更慢）
- **结果存储**：图片已镜像到平台 CDN，文档称**返回地址长期可用**

## 2. 支持的模型

| 模型名 | 说明 | 最大张数 | 分辨率 |
|---|---|---|---|
| `qwen-image-3.0` | 指令理解清晰，文字渲染稳定，常规出图更划算 | 6 张 | 1K / 2K |
| `qwen-image-3.0-pro` | 内容更丰实，适合报纸、分镜、菜单、试卷等密集排版 | 6 张 | 1K / 2K |

> 排版密集、字多的场景优先用 `-pro`。**模型名与 2.0 系列不兼容互换。**

## 3. 能力清单

| 能力 | 触发方式 |
|---|---|
| 文生图 | 只传 `prompt` |
| 图生图 / 图像编辑（1–3 张参考图） | `image_urls` |
| 提示词智能改写 | `prompt_extend: true` + `prompt_extend_mode` |
| 多张输出 | `n`（1–6） |
| 反向提示词 | `negative_prompt` |

## 4. 请求参数（Body）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | `qwen-image-3.0` / `qwen-image-3.0-pro` |
| `prompt` | string | 必填 | — | 最长约 **4.5k token** |
| `image_urls` | string[] | 可选 | — | **1–3 张**。公网 `http(s)://` URL 或 `data:image/png;base64,...`（base64 会先转存）。格式 JPG/JPEG/PNG/BMP/TIFF/WEBP/GIF；单张 ≤ 10 MB；宽高建议 384–2048 px |
| `resolution` | string | 可选 | `1K` | `1K`（兼容小写）/ `2K`。也可跳过档位在 `size` 中直接写像素；**直接给像素时，面积 > 225 万像素按 2K 档计费** |
| `size` | string | 可选 | `1:1` | 比例 `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`；兼容 `16x9` 写法；或直接像素 `1024x1024`。自定义像素时**宽与高各自**须在 512–2048，宽高比 1:8 ~ 8:1。**不传 `size` 也不传 `resolution` 时固定出 1024×1024** |
| `n` | integer | 可选 | `1` | **1–6，超过 6 自动截断为 6** |
| `negative_prompt` | string | 可选 | — | 反向提示词。**本项目规则：绝对不显示**，不下发 |
| `prompt_extend` | boolean | 可选 | **`false`** | 提示词智能改写。APIMart **默认关闭**（官方百炼默认是开启），以保证结果可预测 |
| `prompt_extend_mode` | string | 可选 | — | 仅 3.0 系列，且需 `prompt_extend: true`。`direct`（T2I/I2I 都可）/ `agent`（**仅文生图**，改写更激进）。取值非法时忽略该字段 |
| `nsfw_check` | boolean | 可选 | `false` | `true` 时用 `omni-moderation-latest` 预审提示词与输入图 |

### 尺寸对照表（`resolution` 档位 × `size` 比例）

| 分辨率 | 1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3 |
|---|---|---|---|---|---|---|---|
| 1K | 1024×1024 | 1152×864 | 864×1152 | 1280×720 | 720×1280 | 1248×832 | 832×1248 |
| 2K | 2048×2048 | 2048×1536 | 1536×2048 | 2048×1152 | 1152×2048 | 2048×1360 | 1360×2048 |

> APIMart 的比例集合**没有 `21:9`**（KIE 有），也没有 `2:1` / `1:2`。

## 5. 限制汇总（文档明列）

| 项 | 限制 |
|---|---|
| 提示词 | ≤ 4.5k token |
| 输出尺寸 | 自定义像素时宽、高各自 512–2048；宽高比 1:8 ~ 8:1 |
| 出图张数 | 1–6（超出自动截断） |
| 参考图数量 | 1–3 张 |
| 参考图格式 | JPG / JPEG / PNG / BMP / TIFF / WEBP / GIF |
| 参考图大小 | ≤ 10 MB，宽高建议 384–2048 px |

常见 400 错误：自定义 `size` 宽或高不在 512–2048、比例越界、`agent` 用在图生图、参考图不可访问或超 10 MB。限流返回 429。

## 6. 响应结构

提交返回 `{ code, data: [{ status: "submitted", task_id }] }`；轮询 `GET /v1/tasks/{task_id}` 读 `result.images`（`url` 为数组，多张时一个任务含多个结果）。

## 7. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22 读取，1 Credit ≈ $0.1）。

**QWEN-IMAGE-3.0**（3 个档位，默认/1K/2K 同价）

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 / 1K / 2K | 0.205712 Credits/张 ≈ **$0.0205712/张** | $0.025714/张 | 20% |

**QWEN-IMAGE-3.0-PRO**

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 / 1K | 0.285712 Credits/张 ≈ **$0.0285712/张** | $0.035714/张 | 20% |
| 2K | 0.571432 Credits/张 ≈ **$0.0571432/张** | $0.071429/张 | 20% |

计费规则（文档）：按实际出图张数 × 分辨率档位计费；档位按**实际像素面积**判定（> 225 万像素为 2K）。`qwen-image-3.0` 的 1K/2K 同价；`-pro` 的 2K 为 1K 的两倍。**任务失败全额退款；参考图不额外收费。**

## 8. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口**有 `negative_prompt`**，必须主动不注册、不下发（无 `seed` 字段）。
- `prompt_extend` 在 APIMart 默认 `false`，与百炼官方默认 `true` 相反；跨供应商同一模型的默认行为不一致，需在 schema 层显式指定。
- 比例集合仅 7 个（无 `21:9`），与 KIE 的 8 个不一致；`n > 6` 会**静默截断**而非报错。
- 不传 `size` 与 `resolution` 时固定 1024×1024，不是「模型自动推荐」——与百炼官方行为不同。
- `output_format` 该接口未提供，无需处理。

## 9. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Qwen Image 3.0 图像生成 API | https://docs.apimart.ai/cn/api-reference/images/qwen-image-3.0/generation | 否 |
| 同页纯 Markdown | https://docs.apimart.ai/cn/api-reference/images/qwen-image-3.0/generation.md | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（搜 QWEN-IMAGE-3.0 / QWEN-IMAGE-3.0-PRO） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
