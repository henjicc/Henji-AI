# Kling 3.0 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `kling-3.0/video` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model: "kling-3.0/video", callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: ["https://....mp4"] }`

## 2. 能力清单

单端点承载：文生视频、图生视频（首帧 / 首尾帧）、有声视频、多镜头分镜、引用元素（含**视频角色主体**与**角色音频**）。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 视频生成提示词。**当 `multi_shots=false` 时生效** |
| `input.image_urls` | array | 可选 | — | 首尾帧图片链接。`multi_shots=false` 时：长度 2 → 索引 0 首帧、索引 1 尾帧；长度 1 → 作为首帧。**`multi_shots=true` 时只支持首帧** |
| `input.sound` | boolean | **必填** | `false` | 是否开启音效。**`multi_shots=true` 时字段值默认为 `true`** |
| `input.duration` | string | **必填** | `"5"` | **字符串枚举** `"3"` ~ `"15"` |
| `input.aspect_ratio` | string | **必填** | `16:9` | `16:9`、`9:16`、`1:1` |
| `input.mode` | string | **必填** | **`pro`** | `std` / `pro` / `4K`（**注意 4K 是大写**）。分辨率映射见下 |
| `input.multi_shots` | boolean | **必填** | `false` | 是否多镜头 |
| `input.multi_prompt` | array | **必填** | — | 镜头提示词。`multi_shots=true` 时生效。**最多 5 段**（APIMart 是 6 段），每段时长 1–12 秒 |
| `input.kling_elements` | array | **必填** | — | 引用元素，**最多 3 个** |

> ⚠️ KIE 把 `sound` / `duration` / `aspect_ratio` / `mode` / `multi_shots` / `multi_prompt` / `kling_elements` 都标成了 **required**，但显然 `multi_prompt` / `kling_elements` 在单镜头无元素时不应必填。接入前需实测最小请求体。

### `mode` 的分辨率映射（文档明列）

| mode | 16:9 | 9:16 | 1:1 |
|---|---|---|---|
| `std` | 1280×720 | 720×1280 | 720×720 |
| `pro` | 1920×1080 | 1080×1920 | 1080×1080 |
| `4K` | 3840×2160 | 2160×3840 | 2160×2160 |

### `multi_prompt` 元素

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 必填 | 该镜头提示词，**单个镜头最多 500 字符，每个 `@element` 占 37 个字符** |
| `duration` | integer | 必填 | 该镜头时长，**1–12 秒** |

> 「如果需要使用 element，则需加在 prompt 后。」

### `kling_elements` 元素

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 必填 | 元素名称，prompt 中用 `@` 前缀引用（如 `@element_dog`） |
| `description` | string | 必填 | 元素描述 |
| `element_input_urls` | array | 必填 | 元素图片链接，**需要 2–4 个 URL**。JPG / PNG，**每张 ≤ 10 MB** |
| `element_input_audio_urls` | array | 可选 | **角色音频素材 URL 列表，音频时长必须为 5–30 秒**（APIMart 侧没有这个字段） |
| `start_time` | integer | 可选 | 视频角色素材截取开始时间（毫秒），默认 `0`。**仅 `element_input_urls` 上传视频时生效** |
| `end_time` | integer | 可选 | 截取结束时间（毫秒），默认 `8000`。必须大于 `start_time`，且 `end_time - start_time` 须在 **3000–8000 ms** |

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://....mp4"] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `kling 3`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 720P 无声 | 14 /秒 | **$0.07/秒** | $0.084 | 16.7% |
| 720P 有声 | 20 /秒 | **$0.1/秒** | $0.126 | 20.6% |
| 1080P 无声 | 18 /秒 | **$0.09/秒** | $0.112 | 19.6% |
| 1080P 有声 | 27 /秒 | **$0.135/秒** | $0.168 | 19.6% |
| 4K 无声 | 67 /秒 | **$0.335/秒** | $0.42 | 20.2% |
| 4K 有声 | 67 /秒 | **$0.335/秒** | $0.42 | 20.2% |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口两个字段都没有。
- **`duration` 是字符串**（`"5"`），而 APIMart 是整数——跨供应商序列化必须区分。
- **`mode` 默认是 `pro`**（APIMart 默认 `std`），不显式下发会直接落到更贵的档位。
- `4K` 是**大写**，APIMart 是小写 `4k`。
- `multi_prompt` 上限 **5 段**（APIMart 6 段），单镜头 prompt ≤ 500 字符且 `@element` 按 37 字符计。
- `multi_shots=true` 时 `sound` 默认变成 `true`，会静默产生有声视频与更高费用。
- KIE 侧的引用元素支持**视频角色主体**（`start_time` / `end_time` 截取 3–8 秒）与**角色音频**，比 APIMart 更全。
- 多个字段被标为 required 但语义上不合理，接入前实测最小请求体。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Kling 3.0 | https://docs.kie.ai/cn/market/kling/kling-3-0 | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `kling 3`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
