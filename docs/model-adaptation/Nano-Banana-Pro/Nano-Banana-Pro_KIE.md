# Nano Banana Pro · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `nano-banana-pro` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> KIE 的文档标题是「Nano Banana Pro 图生图」，路径在 `market/google/pro-image-to-image`，但 `image_input` 是**可选**的——同一个 model 同时承载文生图与图生图。

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model: "nano-banana-pro", callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`

## 2. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 最多 **10000** 字符（Nano Banana 2 是 20000） |
| `input.image_input` | array | 可选 | — | 输入图。**最多 8 张**（比 APIMart / Fal 的 14 张少）。字段名是 `image_input`。传上传后的文件 URL；支持 `image/jpeg`、`image/png`、`image/webp`；单张 ≤ 30 MB |
| `input.aspect_ratio` | string | 可选 | **`1:1`** | `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`、`auto`（11 个，无极端比例） |
| `input.resolution` | string | 可选 | `1K` | `1K` / `2K` / `4K` |
| `input.output_format` | string | 可选 | `png` | `png` / `jpg`（注意是 `jpg` 不是 `jpeg`） |

## 3. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`。

## 4. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `nano banana pro`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 1/2K | 18.0 /张 | **$0.09/张** | $0.15 | 40% |
| 4K | 24.0 /张 | **$0.12/张** | $0.3 | 60% |

## 5. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口两个字段都没有。
- `output_format` 默认不显示、不请求；取值是 `jpg` 不是 `jpeg`。
- **参考图上限只有 8 张**，是所有 Nano Banana Pro 供应商里最少的；跨供应商的上传上限要按供应商取值。
- 图片字段名是 `image_input`（不是 `image_urls`）。
- `aspect_ratio` 默认 `1:1`，而 APIMart / Fal 的编辑端点默认 `auto`。
- 提示词上限 10000 字符。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Nano Banana Pro（图生图页，同时承载文生图） | https://docs.kie.ai/cn/market/google/pro-image-to-image | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `nano banana pro`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
