# FLUX 3 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `blackforestlabs/flux-3/text-to-image`、`blackforestlabs/flux-3/edit-image` |
| 痕迹AI 模型 ID | `fal-ai-flux-3`（canonical `flux-3`） |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 请求参数（OpenAPI，2026-11-07 读取）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | |
| `resolution` | string | 否 | `1k` | `768sq` / `1k` / `1.5k` / `2k` / `4k`（模型页说明文字还列了 `512sq`，OpenAPI 枚举没有，以 OpenAPI 为准）；4k 可能要几分钟 |
| `aspect_ratio` | string | 否 | `auto` | `auto` / `21:9` / `2:1` / `16:9` / `3:2` / `7:5` / `4:3` / `5:4` / `1:1` / `4:5` / `3:4` / `5:7` / `2:3` / `9:16` / `1:2`；编辑时 `auto` 跟随第一张参考图 |
| `enable_prompt_expansion` | boolean | 否 | `false` | 扩写提示词并保留意图与参考角色 |
| `image_urls` | array | 编辑必填 | — | 1–10 张，每边 ≥256px，超过 4MP 自动缩小；第一张决定 `auto` 比例 |
| `safety_tolerance` | integer | 否 | `2` | 0–4；不展示、不下发 |
| `output_format` | string | 否 | `jpeg` | 按产品约定不展示、不下发 |
| `version` / `sync_mode` | | 否 | | 不展示、不下发 |

响应：`{ "images": [{ "url", ... }] }`。

## 2. 价格（模型页 pricingInfoOverride / publicEndpointBilling，2026-11-07 读取）

- 计费单位为百万像素：**$0.048/MP**；模型页写明“一档一价”，并只给出 1K（1MP）= $0.048 一个示例。
- 其余档位页面未列具体价格。痕迹AI 按档位边长的正方形像素数估算（768 ≈ 0.59MP、1.5K = 2.25MP、2K = 4MP、4K = 16MP），并标为估算价。

## 3. 适配要点

- 有图自动走 `edit-image`，无图走 `text-to-image`。
- 智能比例：编辑时下发 `auto`（平台按第一张参考图），纯文生图回退 `1:1`。
- FLUX 3 Klein（`blackforestlabs/flux-3/klein/*`，按尺寸逐档定价）与 FLUX 3 / FLUX 3 Max 视频端点不在本次范围。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=blackforestlabs/flux-3/text-to-image | 否 |
| 编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=blackforestlabs/flux-3/edit-image | 否 |
| 模型页与价格 | https://fal.ai/models/blackforestlabs/flux-3/text-to-image | 否 |
| 编辑价格 | https://fal.ai/models/blackforestlabs/flux-3/edit-image | 否 |
