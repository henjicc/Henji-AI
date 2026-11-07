# FLUX 3 Video · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-flux-3-video`（通用标识 `flux-3-video`，与 Fal 一致） |
| 平台模型 ID | `flux-3-video` |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST https://api.apimart.ai/v1/videos/generations`，`Authorization: Bearer <key>`。
- 提交响应（官方示例）：`{"code":200,"data":[{"status":"submitted","task_id":"task_01J9HA7JPQ9A0Z6JZ3V8M9W6PZ"}]}`。
- 查询：`GET /v1/tasks/{task_id}`，官方建议每 5–10 秒一次、客户端超时 15 分钟（20 秒 fhd 更慢；实测 t2v+hd+5 秒约 60 秒出片）；成功后取 `result.videos[0].url`，`cost` 为最终扣费。失败全额退款，内容审核拒绝进入 `failed`。
- 错误：400 参数无效、401、402、422 参数互斥或取值非法、429。

## 2. 生成模式

统一入口，按传参自动判定，也可用 `mode` 显式指定（显式优先级最高）：

| 模式 | 触发 | 说明 |
|---|---|---|
| `t2v` | 只传 `prompt` | 文生视频 |
| `i2v` | 传 `image_urls` | 1 张=起始帧；2 张=起止帧；3–10 张=首尾起止、中间均匀分布；顺序即语义，不排序去重 |
| `v2v` | 传 `video_url` / `video_urls`（取第一个） | 视频续写，单价更高；同时有图和视频时按续写处理；实际时长可能短于请求，按实际退差额 |
| `draft_enhance` | `draft:true` / `draft_from_task_id` | 草稿（约 1/3 价、仅 hd）→ 草稿转正片（仅可改 `resolution`，全价，与 `draft` 互斥） |

`mode` 还接受官方拼写 `text-to-video` / `image-continuation` / `video-continuation`。

## 3. 请求参数

| 字段 | 类型 / 取值 | 说明 |
|---|---|---|
| `model` | 固定 `flux-3-video` | |
| `prompt` | 必填 | 草稿转正片时不能传 |
| `duration` | 整数 5–20，默认 5 | 不支持 `auto`；不传/非整数按 5 秒；21 被拒 |
| `resolution` | `hd`(默认，也接受 `720p`) / `fhd`（也接受 `1080p`） | 实测 hd 16:9 约 1280×704，fhd 约 1920×1088；草稿只能 hd |
| `aspect_ratio` | `21:9` `2:1` `16:9` `4:3` `1:1` `3:4` `9:16` / `auto`(默认) | |
| `image_urls` | string[]，1–10 | 公网 URL 或 base64 |
| `video_url` / `video_urls` | mp4，公网 URL 或 base64 | 官方未写时长/大小上限 |
| `audio` | boolean，默认 true | 关闭出无声视频，不降价 |
| `draft` / `draft_from_task_id` | | 见上 |
| `safety_tolerance` | 0–4，默认 2 | |
| `nsfw_check` | boolean，默认 false | provider 强制 false |
| `mode` | 见上 | |

## 4. 价格

来源：模型页价格表（2026-11-07 读取，“黄金价 = 当前价格”，较官方价省 20%）。定价中心只列起价 `$0.048/秒`（即草稿档）。

| 规格 | 当前价（黄金） | 官方价 |
|---|---|---|
| DRAFT | $0.048/秒 | $0.06/秒 |
| V2V-DRAFT | $0.096/秒 | $0.12/秒 |
| **HD**（文/图生） | **$0.136/秒** | $0.17/秒 |
| **FHD**（文/图生） | **$0.232/秒** | $0.29/秒 |
| **V2V-HD**（续写） | **$0.328/秒** | $0.41/秒 |
| **V2V-FHD**（续写） | **$0.424/秒** | $0.53/秒 |

模型页 FAQ 的“原价（2026 年 10 月）”即上表官方价列；最终扣费以任务结果 `cost` 为准。

## 5. 项目适配

- 模式参数 `role: 'mode'`：文/图生视频（按是否有图在请求里显式发 `t2v` / `i2v`）与视频续写（`v2v`，必须 1 段视频、不带图）。显式发送 `mode`，避免平台在图视频同传时静默丢图。
- 比例默认“智能”：只在纯文生视频显示；纯文生视频智能回退 `16:9`，有图或续写发 `auto` 交给平台跟随素材。
- 计价：时长 × 档位单价（文/图生 hd/fhd，续写 v2v-hd/fhd）。
- 不显示、不请求：`safety_tolerance`（平台默认 2）、`nsfw_check`（provider 强制 false）。
- 暂不接：草稿与草稿转正片——转正片需要引用上一条草稿任务 ID，当前参数体系没有对应入口；单独出草稿只得低质预览、无法转正，先不提供。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| API 文档（中文） | https://docs.apimart.ai/cn/api-reference/videos/flux-3-video/generation | 否 |
| API 文档（英文） | https://docs.apimart.ai/en/api-reference/videos/flux-3-video/generation | 否 |
| 任务查询 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 模型页（价格表、FAQ） | https://apimart.ai/zh/model/flux-3-video | 否 |
| 定价中心（起价） | https://apimart.ai/zh/pricing | 否 |
