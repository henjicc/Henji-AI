# Nano Banana 2 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `nano-banana-2` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> **Nano Banana 2 Lite 已拆分为独立文档**：[Nano-Banana-2-Lite_KIE.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_KIE.md)。它在代码里对应独立的 `canonicalModelId: nano-banana-2-lite`（[src/models/kie/nano-banana-2-lite.model.ts](../../../src/models/kie/nano-banana-2-lite.model.ts)），是独立产品模型——本文件只覆盖主模型 `nano-banana-2`。

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model, callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`

## 2. 能力清单

`nano-banana-2`：文生图 + 图生图合一（有无 `image_input` 都走同一个 model）。KIE **没有把文生图/图生图拆成两个 model**，这与它家 Seedream / Qwen 的做法不同。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 最多 **20000** 字符 |
| `input.aspect_ratio` | string | 可选 | `auto` | 15 个取值：`1:1`、`2:3`、`3:2`、`1:4`、`4:1`、`3:4`、`4:3`、`4:5`、`5:4`、`1:8`、`8:1`、`9:16`、`16:9`、`21:9`、`auto`（**含极端比例**） |
| `input.image_input` | array | 可选 | — | 输入图。**最多 14 张**。注意字段名是 **`image_input`**，不是 `image_urls`。传上传后的文件 URL；支持 `image/jpeg`、`image/png`、`image/webp`；**单张 ≤ 30 MB** |
| `input.output_format` | string | 可选 | **`jpg`** | `jpg` / `png`（注意是 `jpg` 不是 `jpeg`） |
| `input.resolution` | string | 可选 | `1K` | `1K` / `2K` / `4K`（**没有 0.5K**） |

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `nano banana`；1 Credit = $0.005）。

**Google nano banana 2**

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 1K | 8 /张 | **$0.04/张** | $0.08 | 50% |
| 2K | 12 /张 | **$0.06/张** | $0.12 | 50% |
| 4K | 18 /张 | **$0.09/张** | $0.16 | 43.8% |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口两个字段都没有。
- `output_format` 默认不显示、不请求；注意取值是 `jpg`（不是 `jpeg`），且默认 `jpg` 与其他供应商的 `png` 不同。
- 比例集合含 4 个极端比例（1:4 / 4:1 / 1:8 / 8:1）。
- 无 `google_search` 类搜索增强参数。
- `resultJson` 是 JSON 字符串，必须二次 parse。
- Lite 版本不要并入本模型：图片字段名（`image_urls` vs `image_input`）、数量上限（10 vs 14）都不同，是独立产品，见 [Nano-Banana-2-Lite_KIE.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_KIE.md)。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| nano-banana-2 | https://docs.kie.ai/cn/market/google/nanobanana2 | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `nano banana`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
