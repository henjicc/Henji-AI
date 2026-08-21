# Seedream 5.0 Lite · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `seedream/5-lite-text-to-image`、`seedream/5-lite-image-to-image` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model, callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **终态**：`state` ∈ `waiting` / `queuing` / `generating` / `success` / `fail`；成功后 `JSON.parse(resultJson)` 取 `resultUrls`
- **失败**：读 `failCode` / `failMsg`

## 2. 能力清单

| 能力 | model |
|---|---|
| 文生图 | `seedream/5-lite-text-to-image` |
| 图片编辑 / 多参考图 | `seedream/5-lite-image-to-image` |

> KIE 上的 Seedream 5.0 Lite **没有组图（sequential）专用端点**，`input` 中也没有数量字段——单次请求出 1 张。需要组图请走火山引擎官方或 APIMart。

## 3. 请求参数

### 3.1 `seedream/5-lite-text-to-image`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 3–3000 字符 |
| `input.aspect_ratio` | string | 必填 | `1:1` | `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9` |
| `input.quality` | string | 必填 | `basic` | **`basic` = 2K，`high` = 3K，`ultra` = 4K** |
| `input.output_format` | string | 可选 | `png` | `png` / `jpeg` |
| `input.nsfw_checker` | boolean | 可选 | `false` | 设 `false` 关闭内容过滤；平台声明不保证全部过滤 |

### 3.2 `seedream/5-lite-image-to-image`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 3–3000 字符 |
| `input.image_urls` | array | 必填 | — | **最多 14 张**。传上传后的文件 URL；支持 image/jpeg、image/png、image/webp；单张 ≤ 30 MB |
| `input.aspect_ratio` | string | 必填 | `1:1` | 同上 8 个比例 |
| `input.quality` | string | 必填 | `basic` | `basic` = 2K，`high` = 3K，`ultra` = 4K |
| `input.output_format` | string | 可选 | `png` | `png` / `jpeg` |
| `input.nsfw_checker` | boolean | 可选 | `false` | 同上 |

> 参考图上限 **14 张**（Pro 是 10 张），与火山官方 Lite 的 14 张一致。

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `seedream 5.0 Lite`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 |
|---|---|---|---|
| 文生图 | 5.5 /张 | **$0.0275/张** | $0.035 |
| 图片编辑 | 5.5 /张 | **$0.0275/张** | $0.035 |

KIE 的 Lite 价格不分 2K/3K/4K 档位，统一单价。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本接口无这两个字段。
- `output_format` 默认不显示、不请求。
- **`quality` 的语义在 Lite 与 Pro 完全不同**：Lite 是 `basic/high/ultra` → 2K/3K/4K，Pro 是 `basic/high` → 1K/2K。不能共用映射。
- 无参考图走 `text-to-image`，1–14 张走 `image-to-image`，在同一模型下路由。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Seedream 5.0 Lite 文生图 | https://docs.kie.ai/cn/market/seedream/5-lite-text-to-image | 否 |
| Seedream 5.0 Lite 图片编辑 | https://docs.kie.ai/cn/market/seedream/5-lite-image-to-image | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 文件上传 | https://docs.kie.ai/cn/file-upload-api/upload-file-url | 否 |
| 定价页（搜 `seedream 5.0 Lite`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
