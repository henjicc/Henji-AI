# Kling 3.0 Turbo · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `kling/v3-turbo-text-to-video`、`kling/v3-turbo-image-to-video` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model, callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: ["https://....mp4"] }`

## 2. 能力清单

| 能力 | model |
|---|---|
| 文生视频 | `kling/v3-turbo-text-to-video` |
| 图生视频 | `kling/v3-turbo-image-to-video` |

## 3. 请求参数

### 3.1 `kling/v3-turbo-text-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 最长 **2500 字符** |
| `input.duration` | string | **必填** | `"5"` | **字符串**，可选 3 s – 15 s |
| `input.aspect_ratio` | string | **必填** | `16:9` | `1:1`、`9:16`、`16:9` |
| `input.resolution` | string | **必填** | `720p` | `720p` / `1080p` |

### 3.2 `kling/v3-turbo-image-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 最长 2500 字符 |
| `input.image_urls` | array | **必填** | — | 用于生成视频的图像 URL（传上传后的文件 URL）。支持 `image/jpeg`、`image/png`；**单张 ≤ 10 MB** |
| `input.duration` | string | **必填** | `"5"` | 3 s – 15 s |
| `input.resolution` | string | **必填** | `720p` | `720p` / `1080p` |

> 图生视频端点**没有 `aspect_ratio`**（比例由输入图决定），与 APIMart 行为一致。

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://....mp4"] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `kling 3`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 文生视频 720P | 18 /秒 | **$0.09/秒** | $0.112 | 19.6% |
| 文生视频 1080P | 22.5 /秒 | **$0.1125/秒** | $0.14 | 19.6% |
| 图生视频 720P | 18 /秒 | **$0.09/秒** | $0.112 | 19.6% |
| 图生视频 1080P | 22.5 /秒 | **$0.1125/秒** | $0.14 | 19.6% |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本组接口都没有这两个字段。
- **`duration` 是字符串**（`"5"`），APIMart 是整数。
- 图片字段是 `image_urls`（**数组**），而 APIMart 是 `first_frame_image`（**单字符串**）——同一模型两家写法完全不同。
- **KIE 的图片单张上限只有 10 MB**，APIMart 侧上游限制是 50 MB。
- 文生 / 图生是两个 model，需要路由。
- 没有音频开关、没有分镜结构化字段、没有 4K。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Kling V3 Turbo 文生视频 | https://docs.kie.ai/cn/market/kling/v3-turbo-text-to-video | 否 |
| Kling V3 Turbo 图生视频 | https://docs.kie.ai/cn/market/kling/v3-turbo-image-to-video | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `kling 3`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
