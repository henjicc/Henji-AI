# Kling 3.0 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `kling-v3` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |
| 上游官方模型标识 | `kling-v3`（与可灵官方能力地图一致） |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`

## 2. 能力清单

文生视频、图生视频（首帧 / 首尾帧）、有声视频、**多镜头分镜**、**引用元素（主体一致性）**。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | `kling-v3` |
| `prompt` | string | 必填 | — | 正向提示词。**建议使用英文提示词**。`multi_shot=true` 时顶层 `prompt` 可省略 |
| `negative_prompt` | string | 可选 | — | 负面提示词。**本项目规则：绝对不显示**，不下发 |
| `mode` | string | 可选 | `std` | `std`（720P）/ `pro`（1080P）/ `4k`（4K 模式） |
| `duration` | integer | 可选 | `5` | **3–15 秒**。必须是纯数字，加引号会报错 |
| `aspect_ratio` | string | 可选 | `16:9` | `16:9`、`9:16`、`1:1`。图生视频时**可能被图片实际比例覆盖** |
| `image_urls` | array | 可选 | — | **最多 2 张**：传 1 张 = 首帧；传 2 张 = 自动分配为首帧 + 尾帧。URL 必须公开可访问、**不能有防盗链** |
| `watermark` | boolean | 可选 | — | 是否添加水印 |
| `audio` | boolean | 可选 | **`false`** | 是否生成有声视频 |
| `multi_shot` | boolean | 可选 | `false` | 是否启用多镜头分镜模式 |
| `shot_type` | string | 条件 | — | `customize`（自定义）/ `intelligence`（智能）。**`multi_shot=true` 时必填** |
| `multi_prompt` | array | 条件 | — | 各分镜信息 `{ index, prompt, duration }`。**`multi_shot=true` 且 `shot_type=customize` 时必填** |
| `element_list` | array | 可选 | — | 引用元素列表，**最多 3 个主体** |
| `nsfw_check` | boolean | 可选 | `false` | 提交前内容审核 |

### 多镜头分镜（`multi_prompt`）约束

- 最多 **6 个**分镜，最少 1 个
- 每个分镜相关内容的最大长度 **≤ 512**
- 每个分镜的时长 **不大于当前任务总时长，且不小于 1**
- **所有分镜时长之和必须等于当前任务总时长**
- `index` 从 1 连续递增

### 引用元素（`element_list`）

现场创建主体时 `name`、`description`、`element_input_urls` 均必填。
`element_input_urls`：每个主体**至少 2 张、最多 4 张**（第 1 张正面图 + 其余参考图）。
在 `prompt` 中通过 **`@name`** 引用，例如 `"@element_dog 和 @element_cat 在草地上追逐玩耍"`。

### 参数互斥与边界

- `mode=4k` 在 `kling-v3` 可用
- `image_urls` 最多 2 张
- **仅尾帧输入（只有 `last_frame`）会报错，必须配首帧**
- `multi_shot=true` 时顶层 `prompt` 可省略
- `multi_prompt` 最多 6 个分镜，`index` 从 1 连续递增

### 功能支持矩阵（文档给出）

| 类型 | 功能 | std 5s | std 10s | std 15s | pro 5s | pro 10s |
|---|---|---|---|---|---|---|
| 文生视频 | 视频生成 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 图生视频 | 视频生成 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 图生视频 | 首帧 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 图生视频 | 尾帧 | ✅ | ✅ | ✅ | ✅ | ✅ |

系统会根据 `image_urls` 自动判断文生 / 图生模式。

## 4. 响应结构

提交返回 `{ code, data: [{ status: "submitted", task_id }] }`；轮询 `GET /v1/tasks/{task_id}`，成功后读 `result.videos[]`。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → 视频标签页 `KLING-V3`（2026-08-22，6 个档位，1 Credit ≈ $0.1）。

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认（std 无声） | 0.672 Credits/秒 ≈ **$0.0672/秒** | $0.084 | 20% |
| `sound`（std 有声） | 1.008 Credits/秒 ≈ **$0.1008/秒** | $0.126 | 20% |
| `pro`（1080P 无声） | 0.896 Credits/秒 ≈ **$0.0896/秒** | $0.112 | 20% |
| `pro-sound`（1080P 有声） | 1.344 Credits/秒 ≈ **$0.1344/秒** | $0.168 | 20% |
| `4k`（无声） | 4.2856 Credits/秒 ≈ **$0.42856/秒** | $0.5357 | 20% |
| `4k-sound` | 4.2856 Credits/秒 ≈ **$0.42856/秒** | $0.5357 | 20% |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口**有 `negative_prompt`**，必须主动不注册、不下发（无 `seed` 字段）。
- `audio` **默认 `false`**（与 Seedance 的 `generate_audio: true` 相反），且有声比无声贵 33%~50%。
- `duration` 必须以数字类型下发。
- 图生视频时 `aspect_ratio` 可能被图片比例覆盖——UI 上应提示或禁用。
- **多镜头分镜是一整套子能力**：`multi_shot` + `shot_type` + `multi_prompt`，且分镜时长之和必须等于总时长，需要专门的编辑交互。
- **引用元素（主体一致性）是另一套子能力**：每个主体 2–4 张图，prompt 中用 `@name` 引用，最多 3 个主体。
- 只传尾帧会报错，必须配首帧。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Kling v3 视频生成 | https://docs.apimart.ai/cn/api-reference/videos/kling-v3/generation | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页搜 KLING-V3） | https://apimart.ai/zh/pricing | 否 |
| 可灵官方视频能力地图（仅参考，不适配官方接口） | https://www.klingai.com/document-api/guides/capability-map/video | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
