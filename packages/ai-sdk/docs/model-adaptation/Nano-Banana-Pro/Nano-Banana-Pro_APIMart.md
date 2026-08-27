# Nano Banana Pro · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | 标准版 `gemini-3-pro-image-preview`（别名 `nano-banana-pro-ext`）<br>官方版 `gemini-3-pro-image-preview-official`（别名 `nano-banana-pro`） |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/images/generations` → `{ code, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`，读 `result.images`
- **结果时效**：文档标注生成的图像链接 **有效期 24 小时**，请尽快保存

## 2. 能力清单

文生图 / 图生图 / 图像编辑；最多 14 张参考图；1K / 2K / 4K。

> Pro 在 APIMart 上**没有 `google_search` / `google_image_search`**（Nano Banana 2 主模型有），也没有极端宽高比。

## 3. 请求参数（Body）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | `gemini-3-pro-image-preview` | 标准版 `gemini-3-pro-image-preview`（别名 `nano-banana-pro-ext`）；官方版 `gemini-3-pro-image-preview-official`（别名 `nano-banana-pro`） |
| `prompt` | string | 必填 | — | 图像生成描述 |
| `size` | string | 可选 | — | 比例：`auto`、`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`（**11 个，无极端比例**）。**`auto` 时文生图默认 `1:1` 或 `16:9`；图生图按上游返回比例为准——建议显式指定** |
| `resolution` | string | 可选 | `1K` | `1K` / `2K` / `4K`。**用 base64 生成 4K 时处理时间较长** |
| `n` | integer | 可选 | `1` | **取值只能是 1**。必须传纯数字 |
| `image_urls` | array | 可选 | — | 参考图。**最多 14 张**；**单张 ≤ 30 MB**（Nano Banana 2 是 10 MB）；格式 .jpeg / .jpg / .png / .webp；支持公网 URL 或完整 Data URI（前缀不能省） |
| `official_fallback` | boolean | 可选 | `false` | 官方渠道兜底。**使用 `-official` 模型时不能带此参数** |
| `nsfw_check` | boolean | 可选 | `false` | `true` 时用 `omni-moderation-latest` 预审 |

## 4. 响应结构

提交返回 `{ code, data: [{ status: "submitted", task_id }] }`；轮询 `GET /v1/tasks/{task_id}` 读 `result.images[].url`（数组）。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)与[Nano Banana 2 模型页](https://apimart.ai/zh/model/nano-banana-2-api)（2026-08-28，1 Credit ≈ $0.1）。

**NANO-BANANA-PRO-EXT**（按张）

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认（1K / 2K） | 0.3 Credits/张 ≈ **$0.03/张** | $0.0375 | 20% |
| 4K | 0.4 Credits/张 ≈ **$0.04/张** | $0.05 | 20% |

**NANO-BANANA-PRO**（官方渠道，按 token）

| 计费项 | 我们的价格 | 官方价 |
|---|---|---|
| 文本输入 | 16 Credits/M ≈ $1.6/M | $2/M |
| 图片输入 | 16 Credits/M ≈ $1.6/M | $2/M |
| 文本输出 | 96 Credits/M ≈ $9.6/M | $12/M |
| 图片输出 | 960 Credits/M ≈ **$96/M** | $120/M |

SDK 对官方渠道采用模型页当前单张估算：1K/2K **$0.1072**、4K **$0.192**；实际账单仍按 token 结算。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口两个字段都没有。
- `n` 只能是 1；必须是数字类型。
- 比例集合 11 个，**不包含** Nano Banana 2 的 `1:4` / `4:1` / `1:8` / `8:1`，跨模型不能共用比例集合。
- 标准版按张计费、官方版按 token 计费，两条渠道的成本模型完全不同。
- SDK 用首位 `apimartNanoBananaProChannel` 参数表达渠道，默认 `standard` 保持 0.1.5 的 EXT 请求；`official` 只切换精确官方模型 ID，不发送 `official_fallback`。
- `size: auto` 在文生图与图生图下行为不同，建议永远显式下发。
- 参考图单张上限 30 MB，比 Nano Banana 2 的 10 MB 宽松。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Nano banana Pro 图像生成 | https://docs.apimart.ai/cn/api-reference/images/gemini-3-pro/generation | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（搜 NANO-BANANA-PRO-EXT / NANO-BANANA-PRO） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
