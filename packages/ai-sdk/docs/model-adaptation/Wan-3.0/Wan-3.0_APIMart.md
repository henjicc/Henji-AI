# Wan 3.0 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-08 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-wan-3.0`（通用标识 `wan-3.0`） |
| 平台模型 ID | `wan3.0-video`、`wan3.0-video-prime`（参数一致，独立型号与价格） |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/videos/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`；通常 1–5 分钟；结果转存平台 CDN，返回地址可长期使用
- 参数错误均为同步 400，不建任务、不扣费

## 2. 能力（统一入口，按传参自动承接）

| 模式 | 传参 |
|---|---|
| 文生视频 | 仅 `prompt` |
| 首帧 / 首尾帧 | `image_urls` 1 / 2 张（首尾帧族），或 `image_with_roles` |
| 参考生视频 | 参考图 ≤ 10、参考视频 ≤ 5（单段 1–15 秒，总 ≤ 15 秒）、参考音频 ≤ 5（同上）；`prompt` 用“图1”“视频1”“音频1”指代 |
| 参考文件 / 网页 | `file_url` 或 `link_url`（二选一，可无 `prompt`） |

首尾帧族与参考族不能混用；裸 `image_urls` 由 `generation_type`（`frame` / `reference`）决定归属，未传时有参考族输入归参考图，否则归首尾帧。

## 3. 请求参数

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `wan3.0-video` / `wan3.0-video-prime` | 必填 |
| `prompt` | ≤ 20000 字符（超出自动截断） | 与素材至少填其一 |
| `resolution` | `480P` / `720P` / `1080P` | **默认 1080P（最贵）**，项目始终显式传 |
| `size`（或 `aspect_ratio`） | `adaptive` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` | 默认 `adaptive` |
| `duration` | 2–30，或 `-1`（模型决定） | 默认 5；有参考视频时输入总时长 + 输出时长 ≤ 30 |
| `audio` | boolean | 默认 true，开关同价 |
| `generation_type` | `frame` / `reference` | |
| `image_urls` / `image_with_roles` / `video_urls` / `audio_urls` / `audio_url` | 公网 URL | 图片单边 240–8000 px；视频 mp4/mov ≤ 100MB；音频 wav/mp3 ≤ 15MB |
| `file_url` / `link_url` | 文档 / 公开网页 | 项目暂不接入 |
| `nsfw_check` | boolean | 默认 false，项目固定 false |
| `seed` / `watermark` | | 项目不显示、不请求 |

## 4. 价格

来源：[Wan 3.0 模型页](https://apimart.ai/zh/model/wan-3-0) 与 [Wan 3.0 Prime 模型页](https://apimart.ai/zh/model/wan-3-0-prime)（2026-11-07 读取，黄金价 = 当前价）；定价中心起步价 `wan3.0-video $0.0329/秒`、`wan3.0-video-prime $0.0514/秒` 一致。

| 分辨率 | wan3.0-video（每秒） | wan3.0-video-prime（每秒） |
|---|---|---|
| 480P | $0.03288 | $0.05143 |
| 720P | $0.06575 | $0.10286 |
| 1080P | $0.1315 | $0.20571 |

计费按 `duration` 秒数 × 分辨率单价；`duration: -1` 按实际产出秒数；音频开关同价。API 文档写的人民币刊例（480P ¥0.30/秒等）是官方刊例，项目以 APIMart 模型页美元价为准。

## 5. 项目适配

- 素材尺寸前置校验（2026-11-08）：`imageConstraints` 图片单边 240–8000 px。提交前读取素材实际宽高，不合格直接提示，不发付费请求。
- 一个产品模型，`role: 'mode'` 版本（标准 / Prime）+ `role: 'mode'` 模式（文/图生视频、参考生视频）。
- 文/图生视频：0 张文生，1 张首帧，2 张首尾帧，显式发 `generation_type: "frame"`；参考模式显式发 `generation_type: "reference"`。
- 比例默认“智能”→ 发 `adaptive`（平台原生取值，有素材跟随素材）。
- 分辨率默认 720P 并始终显式发送，避免平台按 1080P 计费。
- 未接入：`file_url` / `link_url`（APIMart 没有文档上传端点）、`duration: -1`、`seed`、`watermark`。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| API 文档 | https://docs.apimart.ai/cn/api-reference/videos/wan3.0-video/generation | 否 |
| Wan 3.0 模型页（价格） | https://apimart.ai/zh/model/wan-3-0 | 否 |
| Wan 3.0 Prime 模型页（价格） | https://apimart.ai/zh/model/wan-3-0-prime | 否 |
| 定价中心（起步价） | https://apimart.ai/zh/pricing | 否 |
