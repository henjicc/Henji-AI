# GPT-Image-2 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `gpt-image-2-text-to-image`、`gpt-image-2-image-to-image` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model, callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **终态**：`state` ∈ `waiting` / `queuing` / `generating` / `success` / `fail`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`

## 2. 能力清单

| 能力 | model |
|---|---|
| 文生图 | `gpt-image-2-text-to-image` |
| 图生图（最多 16 张输入图） | `gpt-image-2-image-to-image` |

> KIE 上的 GPT-Image-2 **没有 mask 局部重绘、没有 quality、没有透明背景、没有多张输出**。这些能力只在 APIMart 官方渠道或 Fal 上有。

## 3. 请求参数

### 3.1 `gpt-image-2-text-to-image`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 1–**20000** 字符（远高于其他供应商） |
| `input.aspect_ratio` | string | 可选 | `auto` | `auto`、`1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`5:4`、`4:5`、`16:9`、`9:16`、`2:1`、`1:2`、`3:1`、`1:3`、`21:9`、`9:21` |
| `input.resolution` | string | 可选 | — | `1K` / `2K` / `4K`（**大写**） |

**档位限制（文档明列）**：`2K` 和 `4K` **不支持** `5:4`、`4:5`、`3:1`、`1:3`、`9:21` 这 5 个比例。

### 3.2 `gpt-image-2-image-to-image`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 最多 20000 字符 |
| `input.input_urls` | array | 必填 | — | 输入图片 URL 数组，**最多 16 张**。注意字段名是 **`input_urls`**，不是 `image_urls` |
| `input.aspect_ratio` | string | 可选 | `auto` | 同上 16 个取值 |
| `input.resolution` | string | 可选 | — | `1K` / `2K` / `4K` |

**图生图的档位限制（与文生图不同，文档明列）**：
- `5:4` 和 `4:5` 比例**只支持 1K**
- `1:1` 比例**无法生成 4K**
- `auto` 比例或未传比例参数时**只能生成 1K**，否则**无法创建任务**

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `gpt image`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 文生图 1k | 6 /张 | **$0.03/张** | $0.219 | 86.3% |
| 文生图 2k | 10 /张 | **$0.05/张** | $0.234 | 78.6% |
| 文生图 4k | 16 /张 | **$0.08/张** | $0.413 | 80.6% |
| 图生图 1k | 6 /张 | **$0.03/张** | $0.219 | 86.3% |
| 图生图 2k | 10 /张 | **$0.05/张** | $0.234 | 78.6% |
| 图生图 4k | 16 /张 | **$0.08/张** | $0.413 | 80.6% |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口两个字段都没有。
- **比例 × 分辨率的组合有硬性禁区**，且文生图与图生图规则不同：图生图侧 `auto`/不传比例只能出 1K，否则**任务直接创建失败**。UI 层必须做联动禁用，不能让用户选出非法组合。
- 图生图的图片字段名是 `input_urls`（不是通用的 `image_urls`），容易写错。
- 提示词上限 20000 字符，是所有供应商里最宽松的。
- KIE 版没有 quality / 透明背景 / mask / 多张输出，能力集合明显小于 APIMart 官方渠道与 Fal。
- `resolution` 用大写 `1K/2K/4K`，APIMart 用小写 `1k/2k/4k`，不要共用常量。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| GPT Image 2 文生图 | https://docs.kie.ai/cn/market/gpt/gpt-image-2-text-to-image | 否 |
| GPT Image 2 图生图 | https://docs.kie.ai/cn/market/gpt/gpt-image-2-image-to-image | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `gpt image`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
