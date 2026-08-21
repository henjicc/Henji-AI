# MiniMax H3 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `minimax-h3/text-to-video`、`minimax-h3/image-to-video`、`minimax-h3/reference-to-video` |
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
| 文生视频 | `minimax-h3/text-to-video` |
| 图生视频（首帧 / 尾帧 / 首尾帧） | `minimax-h3/image-to-video` |
| 参考生视频（图 + 视频 + 音频） | `minimax-h3/reference-to-video` |

> KIE 上**没有 Context-IR 提示词增强，也没有 Regeneration 再生成**（APIMart 有）。

## 3. 请求参数

### 3.1 `minimax-h3/text-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 1–7000 字符 |
| `input.aspect_ratio` | string | **必填** | — | `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。**文生视频必填，不支持 `adaptive`** |
| `input.duration` | integer | **必填** | `6` | 枚举 4–15 的整数（注意 **KIE 默认是 6**，APIMart / Fal 是 5） |
| `input.resolution` | string | 可选 | `2K` | `768P` / `2K` |

### 3.2 `minimax-h3/image-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 1–7000 字符 |
| `input.first_frame_url` | string | 可选 | — | 首帧图 URL。支持 HTTP / HTTPS / OSS；JPG、JPEG、PNG、WEBP、HEIC、HEIF；≤ 30 MB；边长 256–5760 px；宽高比 0.4–2.5。**注意：首尾帧必须二选一** |
| `input.last_frame_url` | string | 可选 | — | 尾帧图 URL，**可单独传**，限制同上。**注意：首尾帧必须二选一** |
| `input.duration` | integer | **必填** | `6` | 4–15 |
| `input.resolution` | string | 可选 | `2K` | `768P` / `2K` |

> ⚠️ KIE 的文档在这里自相矛盾：`last_frame_url` 描述既说「可单独传」又说「首尾帧必须二选一」；同时该端点**没有 `aspect_ratio`**。接入前需实测确认能否同时传首尾帧。

### 3.3 `minimax-h3/reference-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 1–7000 字符 |
| `input.reference_image_urls` | array | 可选 | — | **最多 9 张**。HTTP / HTTPS / OSS；JPG、JPEG、PNG、WEBP、HEIC、HEIF；≤ 30 MB；边长 256–5760 px；宽高比 0.4–2.5 |
| `input.reference_video_urls` | array | 可选 | — | **最多 3 个**。MP4 / MOV；视频编码 H.264 / H.265，音频编码 AAC / MP3；单个 ≤ 50 MB；单段 2–15 s，合计 ≤ 15 s；边长 256–5760 px；宽高比 0.4–2.5；帧率 23.976–60 |
| `input.reference_audio_urls` | array | 可选 | — | **最多 3 个**。WAV / MP3；单个 ≤ 15 MB；单段 2–15 s，合计 ≤ 15 s。**不能单独传入，必须同时传 `reference_image_urls` 或 `reference_video_urls`** |
| `input.aspect_ratio` | string | 可选 | **`adaptive`** | `adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16` |
| `input.duration` | integer | **必填** | `6` | 4–15 |
| `input.resolution` | string | 可选 | `2K` | `768P` / `2K` |

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://....mp4"] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `h3`；1 Credit = $0.005）。

**计费公式（KIE 页面明示）**：
`总价 = 单价 × (生成视频时长 + 输入视频时长) + 额外图片费用`
- 输入图片：**前 5 张免费**，超出部分单独计费
- 输入音频：**免费**

| 规格 | 积分 | 我们的价格 |
|---|---|---|
| 文生视频 768p | 16 /秒 | **$0.08/秒** |
| 文生视频 2K | 26 /秒 | **$0.13/秒** |
| 图生视频 768p | 16 /秒 | **$0.08/秒** |
| 图生视频 2K | 26 /秒 | **$0.13/秒** |
| 参考生视频 768p | 16 /秒 | **$0.08/秒** |
| 参考生视频 2K | 26 /秒 | **$0.13/秒** |
| 视频输入 768p | 16 /秒 | **$0.08/秒** |
| 视频输入 2k | 26 /秒 | **$0.13/秒** |
| 图片输入（768p / 2k，超出免费额度后） | 8 /张 | **$0.04/张** |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本组接口都没有这两个字段。
- **`duration` 在 KIE 是必填且默认 6 秒**，与 APIMart / Fal 的 5 秒默认不同，跨供应商不能共用默认值。
- 文生视频的 `aspect_ratio` **必填且不支持 `adaptive`**；图生视频端点**根本没有 `aspect_ratio`**；参考生视频默认 `adaptive`。三个端点行为都不一样。
- `resolution` 默认 `2K`（最贵档），控成本要显式下发 `768P`。
- 图生视频端点关于首尾帧的描述自相矛盾，接入前必须实测。
- 输入视频时长会**叠加进计费秒数**；输入图片前 5 张免费。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| MiniMax H3 文生视频 | https://docs.kie.ai/cn/market/minimax-h3/text-to-video | 否 |
| MiniMax H3 图生视频 | https://docs.kie.ai/cn/market/minimax-h3/image-to-video | 否 |
| MiniMax H3 参考生视频 | https://docs.kie.ai/cn/market/minimax-h3/reference-to-video | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `h3`，含计费公式） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
