# Kling 4.0 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-kling-4.0`（通用标识 `kling-video-4.0`） |
| 平台模型 ID | `kling-v4`（模型页标题“Kling 4.0 API（可灵 4.0，模型 ID：kling-v4）”） |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/videos/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`（文档也给出 `GET /v1/videos/generations/{task_id}`），完成后读 `data.result.videos[0].url[0]`，结果保留 72 小时
- 生成耗时参考：3 秒 720p 约 3 分钟，15 秒约 3.5 分钟

## 2. 能力（同一模型名，按素材与 `omni_reference_task_type` 自动路由）

| 模式 | 传参 |
|---|---|
| 文生视频 | 不传素材 |
| 图生视频 | `image_urls` 第 1 张首帧、第 2 张尾帧；`image_with_roles` 还可加最多 8 张 `keyframe`，首尾中间帧合计 ≤ 10 |
| 参考生视频 | `image_urls`（≤ 10）/ `video_urls`（≤ 5，合计用 30 秒）/ `audio_urls`（≤ 3，每段 5–30 秒），三类合计 ≤ 15；`omni_reference_task_type: "reference"` |
| 视频编辑 | `omni_reference_task_type: "edit"` + `video_url`（≥ 3 秒，超过 30 秒截前 30 秒），可加参考图 ≤ 10 |
| 视频续写 | `omni_reference_task_type: "extend"` + `video_url`，`duration` 为新增时长，可用 `last_frame_image` 指定目标尾帧 |

始终生成带立体声的视频；V4 没有 `mode`（std/pro/4k）。

## 3. 请求参数

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `kling-v4` | 必填 |
| `prompt` | string | 图生视频可省略，其余必填；参考模式可用 `@Image1` `@Video1` `@Audio1` |
| `duration` | 3–30 | 默认 5；编辑不传时跟随输入视频；续写表示新增时长 |
| `resolution` | `720p` / `1080p` | 默认 `720p` |
| `aspect_ratio` | `16:9` / `9:16` / `1:1` / `21:9`，参考模式另有 `auto` | 文生默认 16:9，图生跟随首帧，编辑跟随输入视频，续写不支持 |
| `image_urls` / `image_with_roles` / `first_frame_image` / `last_frame_image` | 见第 2 节 | 公网 URL |
| `video_urls` / `video_url` | 见第 2 节 | 只传 `video_url` 不指定 edit/extend 返回 400 |
| `audio_urls` | ≤ 3 段 | 仅参考模式 |
| `omni_reference_task_type` | `auto` / `reference` / `edit` / `extend` | |
| `audio_setting` | `origin` / `auto` | 编辑默认保留原声；带参考视频的参考生视频默认重新生成；续写不支持 |
| 报 400 | `mode`、`negative_prompt`、`watermark: true`、`audio: false`、`multi_shot`、`multi_prompt`、`element_list`、`video_list`、`camera_control`、`voice_list` | |

## 4. 价格

来源：[Kling 4.0 模型页](https://apimart.ai/zh/model/kling-4-0)（2026-11-07 读取，黄金价 = 当前价）；定价中心起步价 `kling-v4 $0.084/秒` 与模型页的视频输入档一致。

| 规格 | 单价 |
|---|---|
| 720P 生成 | $0.14 / 秒 |
| 1080P 生成 | $0.21 / 秒 |
| 720P 视频输入（720P-input） | $0.084 / 秒 |
| 1080P 视频输入（1080P-input） | $0.126 / 秒 |

计费秒数（API 文档）：文生、图生、仅图片或音频的参考生视频按输出秒数；续写按新增秒数；视频编辑与带参考视频的参考生视频按视频输入单价，计 `输出秒数 + max(输出秒数, 输入视频秒数)`，输入秒数各段相加向上取整，最多 30 秒（例：3.04 秒视频编辑不传时长，输出 4 秒，计 8 秒）。模型页 5 秒 720p 文生示例 “run ≈ 7 Credits” 与 $0.14/秒吻合。

## 5. 项目适配

- 显式 `role: 'mode'` 模式：文/图生视频（0 张文生，1 张首帧，2 张首尾帧）、参考生视频、视频编辑、视频续写。
- 比例默认“智能”：文生发 16:9，图生不发（跟随首帧），参考模式发 `auto`，编辑不发（跟随输入视频）；续写隐藏比例。
- 时长 3–30，编辑模式隐藏且不发送（输出跟随输入视频，按输入秒数 ×2 估价）。
- 编辑模式提供“保留视频原声”开关（默认开 → `origin`，关 → `auto`）。
- 未接入：中间帧 `keyframe`（需要专门的多帧排序入口）、续写目标尾帧之外的 `image_with_roles` 写法。
- APIMart 没有通用视频 / 音频上传端点，视频与音频素材必须是公网 URL（见供应商文档第 4 节）。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| API 文档 | https://docs.apimart.ai/cn/api-reference/videos/kling-v4/generation | 否 |
| 模型页（价格） | https://apimart.ai/zh/model/kling-4-0 | 否 |
| 定价中心（起步价） | https://apimart.ai/zh/pricing | 否 |
