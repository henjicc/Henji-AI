# Nano Banana 2 Lite · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `nano-banana-2-lite` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |
| 项目对照 | [src/models/kie/nano-banana-2-lite.model.ts](../../../src/models/kie/nano-banana-2-lite.model.ts)，`canonicalModelId: 'nano-banana-2-lite'`，与 [Nano Banana 2](../Nano-Banana-2/Nano-Banana-2_KIE.md) 是**两个独立的产品模型**，不是同一模型下的分辨率选项 |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model: 'nano-banana-2-lite', input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`

## 2. 与 Nano Banana 2 主模型的差异

| 字段 | 主模型（`nano-banana-2`） | Lite（`nano-banana-2-lite`） |
|---|---|---|
| 参考图字段名 | `input.image_input` | **`input.image_urls`**（字段名不同，容易写错） |
| 参考图数量上限 | 14 张 | **10 张** |
| `input.resolution` | 支持（`1K`/`2K`/`4K`） | **没有** |
| `input.output_format` | 支持（`jpg`/`png`） | **没有** |
| `input.aspect_ratio` 必填性 | 可选，默认 `auto` | **必填**，默认 `auto` |

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 最多 20000 字符 |
| `input.aspect_ratio` | string | **必填** | `auto` | 15 个取值：`1:1`、`2:3`、`3:2`、`1:4`、`4:1`、`3:4`、`4:3`、`4:5`、`5:4`、`1:8`、`8:1`、`9:16`、`16:9`、`21:9`、`auto`（含极端比例，与主模型一致） |
| `input.image_urls` | array | 可选 | `[]` | 最多 **10 张**。纯文生图可传空数组或不传。支持 `image/jpeg`、`image/png`、`image/webp`；单张 ≤ 30 MB |

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`，与主模型完全一致。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `nano banana`；1 Credit = $0.005）。定价页**未单独列出 `nano-banana-2-lite` 条目**，当前代码固定价 **$0.02/张**（见 [src/models/kie/nano-banana-2-lite.model.ts](../../../src/models/kie/nano-banana-2-lite.model.ts) 的 `pricing.calculator`），这个数字未在定价页找到直接对应来源，接入前建议用真实任务核实一次实际扣费。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本模型没有这两个字段。
- **参考图字段名与主模型不同**（`image_urls` vs `image_input`），数量上限也不同（10 vs 14），是最容易写错的一处。
- 没有 `resolution`、没有 `output_format`，不要照抄主模型的参数面板。
- `aspect_ratio` 在 Lite 上是必填（虽然有默认值 `auto`），建模时仍要按必填处理请求体拼装。
- `resultJson` 是 JSON 字符串，必须二次 parse，与主模型一致。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Nano Banana 2 Lite | https://docs.kie.ai/cn/market/google/nano-banana-2-lite | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `nano banana`，未见独立 Lite 条目） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
