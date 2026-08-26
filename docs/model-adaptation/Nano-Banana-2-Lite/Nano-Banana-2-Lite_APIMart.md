# Nano Banana 2 Lite · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `gemini-3.1-flash-lite-image`（官方渠道）/ `gemini-3.1-flash-lite-image-ext`（EXT 渠道，本项目当前接入这个） |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |
| 项目对照 | [src/models/apimart/nano-banana-2-lite.model.ts](../../../src/models/apimart/nano-banana-2-lite.model.ts)，`canonicalModelId: 'nano-banana-2-lite'`，与 [Nano Banana 2](../Nano-Banana-2/Nano-Banana-2_APIMart.md) 是**两个独立的产品模型**，不是同一模型下的渠道/分辨率选项 |

> Nano Banana 2 Lite 是 Gemini 3.1 系列里**最快、最便宜**的图像模型，走 Developer API 的 `interactions` 端点，主打规模化低成本出图。它与 Nano Banana 2 主模型共享同一份 API 文档页（`generation-lite` 是主文档页的姊妹页），但**能力集合、限制、计费方式都不同**，本项目在代码里已经把它拆成独立模型（`canonicalModelId: nano-banana-2-lite`），本文件把它对应拆成独立文档，不再挂在 Nano Banana 2 文件里。

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/images/generations` → `{ code, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`，读 `result.images`
- **回调**：支持 `webhook` 参数（base 地址，平台回调 `webhook + /callback`），桌面端不用，走轮询

## 2. 与 Nano Banana 2 主模型的能力差异（文档明列）

| 项 | 主模型（Nano Banana 2） | Lite |
|---|---|---|
| 分辨率 | 0.5K / 1K / 2K / 4K | **仅 1K**。传 2K/4K/0.5K 会**静默降级为 1K，不报错**，前端不应暴露分辨率选项 |
| 比例 | 15 个（含 1:4 / 4:1 / 1:8 / 8:1 极端比例） | **11 个**（`auto`、`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16`、`5:4`、`4:5`、`21:9`），**无极端比例** |
| `n` | 只能 1 | **1–4**（`n>1` 后端并发多次上游请求，按实际成功张数计费；文档建议前端固定传 1） |
| `google_search` / `google_image_search` | 支持 | **不支持**。上游未开放 Search 工具（会返回 "Search as tool is not enabled for this model"），平台适配器也不下发。**传了不报错、照常出图，但没有任何搜索增强效果** |
| `official_fallback` | 支持 | **不支持**，且无 `-official` 变体 |
| 计费 | 按张固定价 | **按 token** |
| `mask_url` 局部重绘 | 不支持 | 不支持（Gemini 系列走 aspect ratio + 参考图，不走蒙版） |

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | `gemini-3.1-flash-lite-image` | 官方渠道；本项目代码当前用的是 EXT 别名 `gemini-3.1-flash-lite-image-ext`（见「项目对照」） |
| `prompt` | string | 必填 | — | 图像生成描述 |
| `size` | string | 可选 | — | 11 个比例（见第 2 节），无极端比例；`auto` 行为与主模型一致，建议始终显式指定 |
| `n` | integer | 可选 | `1` | 1–4，建议前端固定传 1 |
| `image_urls` | array | 可选 | — | 参考图，最多 **14 张**；单张 ≤ 10 MB；格式 jpeg/png/webp；支持公网 URL 或完整 Data URI |
| `nsfw_check` | boolean | 可选 | `false` | `true` 时用 `omni-moderation-latest` 预审 |
| `webhook` | string | 可选 | — | 回调基址，桌面端不使用 |

## 4. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → `NANO-BANANA-2-LITE-EXT` / `NANO-BANANA-2-LITE`（2026-08-22，1 Credit ≈ $0.1）。

| 计费口径 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| `NANO-BANANA-2-LITE-EXT`（按张，1K） | 0.125 Credits/张 ≈ **$0.0125/张** | $0.015625 | 20% |
| `NANO-BANANA-2-LITE`（官方渠道，按 token）文本/图片输入 | 2 Credits/M ≈ $0.2/M | — | — |
| `NANO-BANANA-2-LITE`（官方渠道，按 token）文本输出 | 12 Credits/M ≈ $1.2/M | — | — |
| `NANO-BANANA-2-LITE`（官方渠道，按 token）图片输出 | 240 Credits/M ≈ **$24/M** | — | — |

文档另有粗略估算：输入约 $0.25/百万 token、图片输出约 $30/百万 token，1K 单张 ≈ 1120 output token ≈ $0.0336/张（实际以后台倍率配置为准，与上表按张价格对不上，以定价中心的按张价为准）。

## 5. 水印

所有 Lite 生成的图片含 Google **SynthID** 隐形水印（上游行为，**无法关闭**）。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本模型没有这两个字段。
- **必须与 Nano Banana 2 主模型分开建模**：分辨率档位、比例集合、`n` 上限、搜索增强、计费方式全都不同，这点在代码里已经落实（`nano-banana-2-lite.model.ts` 独立文件、独立 `canonicalModelId`），文档现在也拆开，避免下次调研时把两者当成同一模型的参数分支去理解。
- 「传高分辨率静默降级」和「传 `google_search` 静默无效」两处是**沉默失败**，UI 上不要暴露这些开关，否则用户会以为生效了。
- 当前代码用的是 EXT 渠道（`gemini-3.1-flash-lite-image-ext`，按张计费），如果之后要接官方渠道（按 token 计费），计价模型需要整个换掉，不是简单加参数。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Nano Banana Lite 图像生成 | https://docs.apimart.ai/cn/api-reference/images/gemini-3.1-flash/generation-lite | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（搜 NANO-BANANA-2-LITE-EXT / NANO-BANANA-2-LITE） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
