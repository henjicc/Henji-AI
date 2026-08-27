# Nano Banana 2 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | 标准版 `gemini-3.1-flash-image-preview`（别名 `nano-banana-2-ext`）<br>官方版 `gemini-3.1-flash-image-preview-official`（别名 `nano-banana-2`） |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> **Nano Banana 2 Lite 已拆分为独立文档**：[Nano-Banana-2-Lite_APIMart.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_APIMart.md)。它在代码里对应独立的 `canonicalModelId: nano-banana-2-lite`（[catalog/apimart/nano-banana-2-lite.model.ts](../../../src/catalog/apimart/nano-banana-2-lite.model.ts)），是独立产品模型，不是本模型的渠道或分辨率选项——本文件只覆盖主模型的标准版 / 官方版两条渠道。

---

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/images/generations` → `{ code, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`，读 `result.images`
- **回调**（仅 Lite 文档明确提供）：`webhook` 参数传 base 地址，平台回调 `webhook + /callback`（不转发上游），仍建议保留轮询兜底

---

## 2. 主模型 `gemini-3.1-flash-image-preview` / `-official`

### 2.1 能力

文生图 / 图生图；最多 **14 张**参考图；最高 **4K**；支持**极端宽高比**（1:4、4:1、1:8、8:1）；集成 **Google Search 搜索增强**。

### 2.2 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | `gemini-3.1-flash-image-preview` | 标准版 `gemini-3.1-flash-image-preview`（别名 `nano-banana-2-ext`）；官方版 `gemini-3.1-flash-image-preview-official`（别名 `nano-banana-2`） |
| `prompt` | string | 必填 | — | 图像生成描述 |
| `size` | string | 可选 | — | `auto`、`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16`、`5:4`、`4:5`、`21:9`、`1:4`、`4:1`、`1:8`、`8:1`。**`auto` 时文生图默认 `1:1` 或 `16:9`；图生图按上游返回比例为准——建议始终显式指定** |
| `resolution` | string | 可选 | `1K` | `0.5K`（约 512px）/ `1K`（约 1024px）/ `2K`（约 2048px）/ `4K`（约 4096px）。**不同分辨率计费不同** |
| `n` | integer | 可选 | `1` | **取值只能是 1**。必须传纯数字 |
| `image_urls` | array | 可选 | — | 参考图。**最多 14 张**（建议最多 10 张物体参考 + 4 张角色参考）；单张 ≤ 10 MB；格式 jpeg/png/webp；支持公网 URL 或完整 Data URI（前缀不能省） |
| `google_search` | boolean | 可选 | `false` | Google **文字**搜索增强，适合需要真实信息的场景 |
| `google_image_search` | boolean | 可选 | `false` | Google **图片**搜索增强。**必须配合 `google_search: true`** |
| `official_fallback` | boolean | 可选 | `false` | 官方渠道兜底。**使用 `-official` 模型时不能带此参数** |
| `nsfw_check` | boolean | 可选 | `false` | `true` 时用 `omni-moderation-latest` 预审 |

### 2.3 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22，1 Credit ≈ $0.1）。

**NANO-BANANA-2-EXT**（按张，5 档）

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 / 0.5K / 1K | 0.15 Credits/张 ≈ **$0.015/张** | $0.01875 | 20% |
| 2K | 0.2 Credits/张 ≈ **$0.02/张** | $0.025 | 20% |
| 4K | 0.25 Credits/张 ≈ **$0.025/张** | $0.03125 | 20% |

**NANO-BANANA-2**（官方渠道，按 token）

| 计费项 | 我们的价格 | 官方价 |
|---|---|---|
| 文本输入 | 4 Credits/M ≈ $0.4/M | $0.5/M |
| 图片输入 | 4 Credits/M ≈ $0.4/M | $0.5/M |
| 文本输出 | 24 Credits/M ≈ $2.4/M | $3/M |
| 图片输出 | 480 Credits/M ≈ **$48/M** | $60/M |

---

## 3. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 这两个渠道都没有这两个字段。
- 主模型 `n` 只能是 1；`n` 必须是数字类型。
- `size: auto` 在文生图与图生图下行为不同，建议永远显式下发比例。
- `google_image_search` 依赖 `google_search`，两者要做联动。
- Lite 版本不要并入本模型：分辨率档位、比例集合、`n` 上限、搜索增强、计费方式都不同，是独立产品，见 [Nano-Banana-2-Lite_APIMart.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_APIMart.md)。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Nano banana2 图像生成（主模型） | https://docs.apimart.ai/cn/api-reference/images/gemini-3.1-flash/generation | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（搜 NANO-BANANA-2-EXT / NANO-BANANA-2） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
