# Seedance 2.5 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `bytedance/seedance-2-5` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model: "bytedance/seedance-2-5", callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **终态**：`state` ∈ `waiting` / `queuing` / `generating` / `success` / `fail`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`；开启 `return_last_frame` 时为 `{ resultUrls: [], firstFrameUrl: [], lastFrameUrl: [] }`

## 2. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 可选 | — | 文本提示词，最多 **30000** 字符 |
| `input.first_frame_url` | string | 可选 | — | 首帧图片地址或 `asset://{assetId}`。**不能与 `reference_image_urls` / `reference_video_urls` / `reference_audio_urls` 同时使用** |
| `input.last_frame_url` | string | 可选 | — | 尾帧图片地址或 `asset://{assetId}`。**不可单独只传 `last_frame_url`，必须同时传 `first_frame_url`** |
| `input.reference_image_urls` | array | 可选 | — | 参考图，**最多 30 张**（与首尾帧张数之和不超过 30）。格式 jpeg/png/webp/bmp/tiff/gif；宽高比 (0.4, 2.5)；边长 (300, 6000) px；单张 < 30 MB。**与首尾帧场景互斥** |
| `input.reference_video_urls` | array | 可选 | — | 参考视频，**最多 10 个**。格式 mp4/mov；分辨率 480p/720p；宽高比 [0.4, 2.5]；边长 [300, 6000] px；总像素 [409600, 927408]；单个 ≤ **200 MB**；帧率 [24, 60]；单个时长 [2, 30] s；**总时长 ≤ 30 s**。**与首尾帧场景互斥** |
| `input.reference_audio_urls` | array | 可选 | — | 参考音频，**最多 10 段**。格式 wav/mp3；单个 ≤ 15 MB；单段时长 [2, 30] s；总时长 ≤ 30 s。**与首尾帧场景互斥** |
| `input.return_last_frame` | boolean | 可选 | `false` | 是否返回视频最后一帧图片。**`draft=true` 时不支持传 `true`** |
| `input.generate_audio` | boolean | 可选 | **`true`** | 是否生成与画面同步的音频 |
| `input.resolution` | string | 可选 | `720p` | `480p` / `720p` / `1080p`（**无 4k**） |
| `input.aspect_ratio` | string | 可选 | **`adaptive`** | `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`21:9`、`adaptive` |
| `input.duration` | integer | 可选 | `5` | **4–30 秒**。特殊值 **`-1`**：自动选择时长——视频编辑任务下匹配输入视频时长，其他任务类型在有效范围内自主选择 |
| `input.output_format` | string | 可选 | `mp4` | `mp4` / `mov` |
| `input.web_search` | string | 可选 | — | 是否开启联网搜索（**schema 类型标注为 string，不是 boolean，接入前实测确认**） |
| `input.nsfw_checker` | boolean | 可选 | `false` | `false` 时关闭内容过滤 |

> KIE 的 schema 里出现了 `draft` 的说明（`return_last_frame` 描述提到 `draft=true`），但请求体中**没有 `draft` 字段**，接入前需确认。

### 与 APIMart 的差异

- KIE **没有 `omni_reference_task_type`**（APIMart 用它把编辑 / 延长的异步报错提前成同步报错）
- KIE 没有 `watermark`、没有 `tools`（改为 `web_search` 布尔/字符串开关）
- KIE 把首尾帧与参考素材做成**硬互斥**（APIMart 是自动降级为 `reference_image`）

## 3. 响应结构

`state=success` 后 `JSON.parse(resultJson)`：
- 普通：`{ "resultUrls": ["https://....mp4"] }`
- 开启 `return_last_frame`：`{ "resultUrls": [], "firstFrameUrl": [], "lastFrameUrl": [] }`

## 4. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `seedance`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 480p no video | 28 /秒 | **$0.140/秒** | $0.2205 | 36.5% |
| 480p with video | 17 /秒 | **$0.085/秒** | $0.1323 | 35.8% |
| 720p no video | 63 /秒 | **$0.315/秒** | $0.4730 | 33.4% |
| 720p with video | 38 /秒 | **$0.190/秒** | $0.2838 | 33.0% |
| 1080p no video | 114 /秒 | **$0.570/秒** | $1.1372 | 49.9% |
| 1080p with video | 68.5 /秒 | **$0.3425/秒** | $0.6823 | 49.8% |

> 计费规则：**无视频输入时 总价 = 单价 × 输出时长；有视频输入时 总价 = 单价 × (输入 + 输出) 时长**。

## 5. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口两个字段都没有。
- `output_format` 默认不显示、不请求。
- **首尾帧与参考素材在 KIE 上是硬互斥**，UI 必须二选一，不能像 APIMart 那样自动降级。
- `last_frame_url` 不能单独传，必须配 `first_frame_url`。
- `aspect_ratio` 默认 `adaptive`（2.0 系列默认 `16:9`），跨代不能共用默认值。
- `web_search` 的 schema 类型是 string 而非 boolean，接入前实测。
- 有视频输入时计费按「输入 + 输出总时长」。
- `resultJson` 是 JSON 字符串，必须二次 parse；`return_last_frame` 会改变结构。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Bytedance Seedance 2.5 | https://docs.kie.ai/cn/market/bytedance/seedance-2-5 | 否 |
| 获取任务详情（含 return_last_frame 结果结构） | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `seedance`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
