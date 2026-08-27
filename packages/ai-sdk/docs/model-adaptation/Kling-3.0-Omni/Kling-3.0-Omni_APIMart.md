# Kling 3.0 Omni · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `kling-v3-omni` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |
| 上游官方模型标识 | `kling-v3-omni`（与可灵官方能力地图一致：全能多模态输入、有声角色驱动、直出音画和分镜） |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`

## 2. 能力清单

统一文生 / 图生接口 + **图片引用语法**、**参考视频（视频编辑 / 特征参考）**、有声视频、多镜头分镜、引用元素（主体一致性）。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | `kling-v3-omni` |
| `prompt` | string | 必填 | — | 支持 **`<<<image_N>>>`** 语法引用 `image_urls` 中的图片（N 从 1 开始）。例：`"让<<<image_1>>>中的人物向镜头挥手"` |
| `negative_prompt` | string | 可选 | — | 负面提示词，**最大 2500 字符**。**本项目规则：绝对不显示**，不下发 |
| `mode` | string | 可选 | `std` | `std`（720P）/ `pro`（1080P）/ `4k`（4K 超清） |
| `duration` | integer | 可选 | `5` | **3–15 秒**。必须是纯数字 |
| `aspect_ratio` | string | 可选 | `16:9` | `16:9`、`9:16`、`1:1` |
| `image_urls` | array | 可选 | — | 图片 URL 数组，用于 `<<<image_N>>>` 引用。URL 必须公开可访问、不能有防盗链。图生视频时 `aspect_ratio` 可能被图片实际比例覆盖 |
| `image_with_roles` | array | 可选 | — | `{ url, role }`，`role` ∈ `first_frame` / `last_frame` / **`reference`**。**与 `image_urls` 二选一** |
| `video_list` | array | 可选 | — | 参考视频列表，**最多 1 段**，见下 |
| `multi_shot` | boolean | 可选 | `false` | 是否启用多镜头分镜 |
| `shot_type` | string | 条件 | — | `customize` / `intelligence`。**`multi_shot=true` 时必填** |
| `multi_prompt` | array | 条件 | — | `{ index, prompt, duration }`。**`multi_shot=true` 且 `shot_type=customize` 时必填** |
| `element_list` | array | 可选 | — | 引用元素，**最多 3 个主体** |
| `watermark` | boolean | 可选 | — | 是否添加水印 |
| `audio` | boolean | 可选 | **`false`** | 是否生成有声视频。**与 `video_list` 互斥**——`video_list` 有值时该参数会被忽略 |
| `nsfw_check` | boolean | 可选 | `false` | 提交前内容审核 |

### `image_urls` 的图片引用语法（Omni 独有）

| 语法 | 说明 |
|---|---|
| `<<<image_1>>>` | 引用 `image_urls` 数组中的第 1 张图片 |
| `<<<image_2>>>` | 引用第 2 张图片 |

**自动引用**：若已传入 `image_urls` 但提示词中没有任何 `<<<image_N>>>`，**系统会自动在提示词前添加 `<<<image_1>>>`**。

### `video_list`

| 字段 | 取值 | 说明 |
|---|---|---|
| `video_url` | URL | **不能为空**，且需可访问 |
| `refer_type` | `base`（默认）/ `feature` | `base` = 待编辑视频；`feature` = 特征参考视频 |
| `keep_original_sound` | `no`（默认）/ `yes` | 是否保留原声 |

约束：
- `refer_type=base` 时：**不能定义视频首尾帧**；参考视频需 **3–10 秒**；**生成视频时长以上传视频为准**
- `refer_type=feature` 且 `video_url` 非空时：`image_urls` **只可上传首帧图片**
- 视频要求：仅支持 **MP4 / MOV**；时长不少于 3 秒；分辨率 **720px–2160px**；帧率 **24–60 fps（输出为 24 fps）**；大小 **≤ 200 MB**

### `multi_prompt` 约束

最少 1 个、最多 **6 个**分镜；每个分镜 `duration` 为整数且 ≥ 1；**所有分镜 `duration` 之和必须等于顶层 `duration`**；`index` 从 1 连续递增。

### `element_list`

现场创建主体时 `name`、`description`、`element_input_urls` 必填；`element_input_urls` 每个主体**至少 2 张、最多 4 张**（第 1 张正面图 + 其余参考图）；prompt 中用 **`@name`** 引用。

### 参数互斥与边界（汇总）

- `image_urls` 与 `image_with_roles` **二选一**
- `mode=4k` 在 `kling-v3-omni` 可用
- **仅尾帧输入（只有 `last_frame`）会报错，必须配首帧**
- **首/尾帧与视频编辑互斥**：`video_list.refer_type=base`（或缺省）时不允许首尾帧
- 有 `video_list` 时 `audio` 被忽略
- `video_list` 最多 1 段
- `multi_prompt` 最多 6 个分镜，`index` 从 1 连续递增

## 4. 响应结构

提交返回 `{ code, data: [{ status: "submitted", task_id }] }`；轮询 `GET /v1/tasks/{task_id}`，成功后读 `result.videos[]`。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → 视频标签页 `KLING-V3-OMNI`（2026-08-22，**8 个档位**，1 Credit ≈ $0.1）。

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认（std 无声） | 0.672 Credits/秒 ≈ **$0.0672/秒** | $0.084 | 20% |
| `sound`（std 有声） | 0.896 Credits/秒 ≈ **$0.0896/秒** | $0.112 | 20% |
| `video`（std + 参考视频） | 1.008 Credits/秒 ≈ **$0.1008/秒** | $0.126 | 20% |
| `pro`（1080P 无声） | 0.896 Credits/秒 ≈ **$0.0896/秒** | $0.112 | 20% |
| `pro-sound` | 1.12 Credits/秒 ≈ **$0.112/秒** | $0.14 | 20% |
| `pro-video`（1080P + 参考视频） | 1.344 Credits/秒 ≈ **$0.1344/秒** | $0.168 | 20% |
| `4k`（无声） | 4.2856 Credits/秒 ≈ **$0.42856/秒** | $0.5357 | 20% |
| `4k-sound` | 4.2856 Credits/秒 ≈ **$0.42856/秒** | $0.5357 | 20% |

> Omni 比 `kling-v3` 多了 `video` / `pro-video` 两个「带参考视频」的档位。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口**有 `negative_prompt`**，必须主动不注册、不下发。
- **`<<<image_N>>>` 图片引用语法是 Omni 独有**：不写引用时系统会**静默**在 prompt 前加 `<<<image_1>>>`，产品若不想要这种行为必须显式管理引用。
- `audio` 默认 `false`；**有 `video_list` 时 `audio` 被忽略**（不是报错，是静默忽略）。
- **`refer_type=base` 时生成时长由上传视频决定**，用户设置的 `duration` 不生效——UI 要禁用时长选择。
- 首尾帧与视频编辑互斥，且只传尾帧会报错。
- 参考视频只允许 1 段、3–10 秒（`base` 模式）。
- 多镜头分镜与引用元素是两套独立子能力，与 `kling-v3` 一致。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Kling v3 Omni 视频生成 | https://docs.apimart.ai/cn/api-reference/videos/kling-v3-omni/generation | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页搜 KLING-V3-OMNI） | https://apimart.ai/zh/pricing | 否 |
| 可灵官方视频能力地图（仅参考） | https://www.klingai.com/document-api/guides/capability-map/video | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
