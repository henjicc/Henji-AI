# Qwen Image 3.0 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | 标准版 `qwen3/text-to-image`、`qwen3/image-to-image`；Pro 版 `qwen3-pro/text-to-image`、`qwen3/pro-image-to-image` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> ⚠️ **文档不一致，接入前必须实测确认**：Pro 文生图页面的 `model` 字段中，`enum` 写的是 `qwen3-pro/text-to-image`，而 `default` 与描述文字写的是 `qwen3/pro-text-to-image`；Pro 图生图页面则统一为 `qwen3/pro-image-to-image`。

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model, callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **终态**：`state` ∈ `waiting` / `queuing` / `generating` / `success` / `fail`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`；失败读 `failCode` / `failMsg`

## 2. 能力清单

| 能力 | model |
|---|---|
| 标准版 文生图 | `qwen3/text-to-image` |
| 标准版 图生图 | `qwen3/image-to-image` |
| Pro 版 文生图 | `qwen3-pro/text-to-image`（见上方不一致提示） |
| Pro 版 图生图 | `qwen3/pro-image-to-image` |

> KIE 上 Qwen Image 3.0 **没有多张输出参数**（无 `n` / `num_images`），一次任务出 1 张。

## 3. 请求参数（四个端点共有）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 0–5000 字符，支持中英文 |
| `input.resolution` | string | 可选 | `1K` | `1K` / `2K` |
| `input.image_size` | string | 可选 | **`16:9`** | `1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16`、`21:9`。注意**默认不是 1:1** |
| `input.output_format` | string | 可选 | `png` | `png` / `jpeg` |
| `input.prompt_extend` | boolean | 可选 | **`true`**（推荐） | 智能提示词改写 |
| `input.nsfw_checker` | boolean | 可选 | `false` | `false` 时关闭内容过滤，结果直接返回 |
| `input.negative_prompt` | string | 可选 | — | 0–5000 字符。**本项目规则：绝对不显示**，不下发 |
| `input.seed` | integer | 可选 | `1` | `[0, 2147483647]`。**本项目规则：绝对不显示**，不下发 |

**图生图端点额外必填：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `input.image_urls` | array | 必填 | **1–3 张**。传上传后的文件 URL。支持 `image/jpeg`、`image/png`、`image/webp`、`image/bmp`、`image/tiff`、`image/gif`；每张 ≤ 10 MB |

> KIE 没有 `prompt_extend_mode`（百炼与 APIMart 有 `direct` / `agent`）。

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `qwen image 3`；1 Credit = $0.005）。

**Qwen image 3.0**

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 |
|---|---|---|---|
| 文生图 1K | 4.8 /张 | **$0.024/张** | $0.03 |
| 文生图 2K | 4.8 /张 | **$0.024/张** | $0.03 |
| 输出 1K / 2K | 4.8 /张 | **$0.024/张** | $0.03 |
| 输入图 1K / 2K | 0.5 /张 | **$0.0025/张** | $0.003 |

**Qwen image 3.0 Pro**

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 |
|---|---|---|---|
| 文生图 1K | 6.4 /张 | **$0.032/张** | $0.04 |
| 文生图 2K | 12 /张 | **$0.06/张** | $0.075 |
| 输出 1K | 6.4 /张 | **$0.032/张** | $0.04 |
| 输出 2K | 12 /张 | **$0.06/张** | $0.075 |
| 输入图 1K / 2K | 0.5 /张 | **$0.0025/张** | $0.003 |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口**两个字段都存在**，必须主动不注册、不下发。
- `image_size` 默认 `16:9`，与其他供应商的 `1:1` 默认不同；若产品语义是「默认方形」，必须显式下发 `1:1`。
- 比例集合含 `21:9`（APIMart 没有）。
- `prompt_extend` 默认 `true`，与 APIMart（`false`）相反。
- Pro 端点的 model 字符串在官方文档中自相矛盾，接入时先用两种写法各打一次任务确认。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Qwen3 文生图 | https://docs.kie.ai/cn/market/qwen3/text-to-image | 否 |
| Qwen3 图生图 | https://docs.kie.ai/cn/market/qwen3/image-to-image | 否 |
| Qwen3 Pro 文生图 | https://docs.kie.ai/cn/market/qwen3-pro/text-to-image | 否 |
| Qwen3 Pro 图生图 | https://docs.kie.ai/cn/market/qwen3-pro/image-to-image | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `qwen image 3`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
