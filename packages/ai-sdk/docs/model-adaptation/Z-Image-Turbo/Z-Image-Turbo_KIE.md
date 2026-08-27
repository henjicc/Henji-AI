# Z-Image Turbo · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `z-image` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> KIE 的 model 名是 **`z-image`**（不带 `-turbo`），定价页条目名为 `Qwen z-image`。

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model: "z-image", callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **终态**：`state` ∈ `waiting` / `queuing` / `generating` / `success` / `fail`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`；失败读 `failCode` / `failMsg`

## 2. 能力清单

仅**文生图**一个端点 `z-image`。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | `z-image` | 必须是 `z-image` |
| `input.prompt` | string | 必填 | — | **最长 1000 字符**（官方百炼是 800，APIMart 是 800） |
| `input.aspect_ratio` | string | 必填 | `1:1` | **只有 5 个**：`1:1`、`4:3`、`3:4`、`16:9`、`9:16` |
| `input.nsfw_checker` | boolean | 可选 | `false` | `false` 时关闭内容过滤，结果直接返回 |

> ⚠️ **文档自相矛盾**：`aspect_ratio` 的描述文字写了「选择 `auto` 可匹配首张输入图像的比例（需传入输入图像）」，但枚举里**没有 `auto`**，`input` 中也**没有输入图字段**。这段描述应属复制粘贴残留，接入时按枚举的 5 个比例处理，不要下发 `auto`。

**没有分辨率档位参数**（无 `resolution` / `size`），也**没有 `prompt_extend`**——这两点与百炼官方和 APIMart 都不同。

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `z-image`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| `Qwen z-image`, text-to-image, 1.0s | 0.8 /张 | **$0.004/张** | $0.005 | 20% |

KIE 只有一个价格档，不区分分辨率，也不区分是否开启提示词改写。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口两个字段都没有。
- 比例集合只有 5 个，是所有供应商里最少的；跨供应商共享比例集合时必须按供应商裁剪。
- 没有分辨率档位，输出尺寸完全由比例决定，UI 不要出现 1K/2K 选择。
- 提示词上限 1000 字符（与另两家的 800 不同）。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| z-image 生成端点 | https://docs.kie.ai/cn/market/z-image/z-image | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `z-image`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
