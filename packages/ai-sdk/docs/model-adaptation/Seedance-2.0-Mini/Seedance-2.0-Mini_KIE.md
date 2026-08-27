# Seedance 2.0 Mini · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `bytedance/seedance-2-mini` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model: "bytedance/seedance-2-mini", callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **终态**：`state` ∈ `waiting` / `queuing` / `generating` / `success` / `fail`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: [...] }`

## 2. 能力清单

KIE 把 Seedance 2.0 系列做成**单端点多能力**：有无首帧/尾帧/参考图/参考视频/参考音频，都在同一个 `model` 下靠字段区分。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 见说明 | — | 文本提示词。schema 标为可选但描述写「必填字段」，长度 3–**20000** 字符 |
| `input.first_frame_url` | string | 可选 | — | 首帧图片地址，或 `asset://{assetId}` |
| `input.last_frame_url` | string | 可选 | — | 尾帧图片地址，或 `asset://{assetId}` |
| `input.reference_image_urls` | array | 可选 | — | 参考图，**最多 9 张**（**与首尾帧张数之和不得超过 9 张**）。格式 jpeg/png/webp/bmp/tiff/gif；宽高比 (0.4, 2.5)；边长 (300, 6000) px；单张 < 30 MB |
| `input.reference_video_urls` | array | 可选 | — | 参考视频，**最多 3 个**。格式 mp4/mov；分辨率 480p/720p；单个时长 [2, 15] s 且总时长 ≤ 15 s；宽高比 [0.4, 2.5]；边长 [300, 6000] px；总像素 [409600, 927408]；单个 ≤ 50 MB；帧率 [24, 60] |
| `input.reference_audio_urls` | array | 可选 | — | 参考音频，**最多 3 段**。格式 wav/mp3；单个时长 [2, 15] s 且总时长 ≤ 15 s；单个 ≤ 15 MB |
| `input.generate_audio` | boolean | 可选 | **`true`** | 是否生成与画面同步的音频 |
| `input.resolution` | string | 可选 | `720p` | **仅 `480p` / `720p`** |
| `input.aspect_ratio` | string | 可选 | `16:9` | `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`21:9`、`adaptive` |
| `input.duration` | integer | 可选 | `5` | **4–15 秒** |
| `input.web_search` | boolean | 可选 | — | 是否启用联网搜索 |
| `input.nsfw_checker` | boolean | 可选 | `false` | `false` 时关闭内容过滤，结果直接返回 |

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://....mp4"] }`。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `seedance`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 480P no video | 3.8 /秒 | **$0.019/秒** | $0.0721 | 73.7% |
| 480P with video | 2.4 /秒 | **$0.012/秒** | $0.0433 | 72.3% |
| 720P no video | 8.2 /秒 | **$0.041/秒** | $0.1547 | 73.5% |
| 720P with video | 5 /秒 | **$0.025/秒** | $0.0928 | 73.1% |

> KIE 的计费说明：**无视频输入时 总价 = 单价 × 输出时长；有视频输入时 总价 = 单价 × (输入 + 输出) 时长**——这就是「with video」单价更低的原因。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本接口两个字段都没有。
- `generate_audio` 默认 `true`，会产生有声视频。
- 参考图与首尾帧**共享 9 张的总额度**，UI 计数要把首帧/尾帧算进去。
- `resolution` 档位是 480p / 720p。
- 有视频输入时计费口径变成「输入 + 输出总时长」，成本预估要区分。
- **Mini 没有 `return_last_frame`**（标准版与 Fast 有），做不了「取尾帧接着生成」的连续视频链路。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Seedance 2.0 Mini 文档 | https://docs.kie.ai/cn/market/bytedance/seedance-2-mini | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `seedance`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
