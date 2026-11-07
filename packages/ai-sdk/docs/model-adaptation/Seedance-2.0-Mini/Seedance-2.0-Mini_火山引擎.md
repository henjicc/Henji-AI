# Seedance 2.0 Mini · 火山引擎

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | 火山方舟（官方） |
| 项目模型 ID | `volcengine-seedance-2.0-mini`（通用标识 `seedance-2.0-mini`） |
| 平台模型 ID | `doubao-seedance-2-0-mini-260615` |
| 接口形态 | 异步任务（提交 + 轮询） |
| 文档 / 价格可见性 | 公开，无需登录；开通 Seedance 2.x 需账户余额 > 200 元、200 元以上节省计划或资源包余量 |

## 1. 接入协议

- Base URL：`https://ark.cn-beijing.volces.com`；鉴权 `Authorization: Bearer <ARK_API_KEY>`
- 提交：`POST /api/v3/contents/generations/tasks` → `{ "id": "cgt-..." }`（响应只有 `id`）
- 查询：`GET /api/v3/contents/generations/tasks/{id}`；任务 ID 有效期 7 天，结果 URL 24 小时有效（Seedance 2.5 URL 最多下载 100 次），项目按统一媒体转存链路落盘
- 取消：`DELETE /api/v3/contents/generations/tasks/{id}` 只能取消 `queued` 任务，`running` 不可取消。SDK 取消只停止本地轮询，不调用 DELETE

## 2. 能力（按传入素材区分，三类互斥不可混用）

| 场景 | content |
|---|---|
| 文生视频 | 仅 `text` |
| 首帧 | 1 个 `image_url`，`role: first_frame`（或不填） |
| 首尾帧 | 2 个 `image_url`，`role` 必填 `first_frame` / `last_frame`；尾帧比例不一致时以首帧为准裁剪 |
| 全模态参考 | `image_url` + `role: reference_image`、`audio_url` + `role: reference_audio`、`video_url` + `role: reference_video`；参考图 1–9 张、参考音频最多 3 段（单段 2–15 秒，总 ≤ 15 秒）；音频不可单独传入，至少要有 1 张参考图 |

图片支持公网 URL、`data:image/<格式>;base64,` 与 `asset://`；单张 < 30 MB，宽高比 0.4–2.5，边长 300–6000 px，请求体 ≤ 64 MB。音频支持公网 URL、`data:audio/<格式>;base64,`（格式 wav / mp3）与 `asset://`；单段 ≤ 15 MB。**参考视频只收公网 URL 或 `asset://`，不收 Base64。** 方舟 Files API 的 File ID 只用于理解类接口，官方未声明可用于视频生成，因此项目不开放参考视频（视频编辑、延长同样依赖参考视频，一并不开放）。

不支持直接上传含真人人脸的参考图 / 视频（需走官方授权素材或虚拟人像库）。

## 3. 请求参数

| 字段 | 取值 | 项目处理 |
|---|---|---|
| `model` | `doubao-seedance-2-0-mini-260615` | 固定 |
| `content` | 见第 2 节 | 提示词为空时不发 text 项；文生视频必须有提示词 |
| `resolution` | `480p` / `720p`；默认 `720p` | 始终显式发送 |
| `ratio` | `16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `21:9` / `adaptive`；默认 `adaptive` | 「智能」发 `adaptive` |
| `duration` | 4–15，或 `-1` 智能时长 | 4 起，默认 5 |
| `generate_audio` | boolean，默认 true；输出固定双声道 | 开关 |
| `return_last_frame` | boolean，默认 false；为 true 时结果多一个 `content.last_frame_url`（jpeg，无水印） | 开关；结果按「视频 ‖ 尾帧」顺序返回 |
| `tools` | `[{ "type": "web_search" }]` | 「联网搜索」开关 |
| `watermark` | boolean，默认 false | 固定 false |
| `seed`、`camera_fixed`、`frames`、`service_tier` | 仅 Seedance 1.0 系列 | 不发送 |

## 4. 价格

来源：[模型价格](https://www.volcengine.com/docs/82379/1544106)（官方更新时间 2026-11-03，2026-11-07 读取，无需登录），在线推理，元 / 百万 token：

| 输出分辨率 | 输入不含视频 | 输入含视频 |
|---|---|---|
| 480p / 720p | ¥23 | ¥14 |

- 视频价格 = token 单价 × token 用量；token ≈ (输入视频时长 + 输出时长) × 输出宽 × 输出高 × 24 / 1024，准确值以查询结果 `usage.completion_tokens` 为准；仅成功生成计费。
- 典型价：480p 16:9 5 秒 ¥1.16；720p ¥2.48（官方「价格示例」）。
- 项目不开放参考视频，按「输入不含视频」单价与官方像素表（按所选比例，智能比例按 16:9）估算。

## 5. 事件 / 状态矩阵

| 状态 | 前置 | 字段契约 | 空值语义 | 下一状态 | 对外输出 | 终态 / 错误 |
|---|---|---|---|---|---|---|
| 提交成功 | — | `id` string 必有 | 缺 `id` 判 `invalid_response` | queued | pending + taskId | 否 |
| 提交失败 | — | HTTP 4xx/5xx，`error.code` / `error.message` | — | — | 无 | 是；余额、未开通、无权限按 `providerAccessErrors` 归类为不可重试 |
| `queued` | 提交 | `status`；`content` 可缺 | 无结果 | running / cancelled / expired | 无 | 否，继续查询 |
| `running` | queued | 同上 | 无结果 | succeeded / failed / expired | 无 | 否，继续查询 |
| `succeeded` | running | `content.video_url` 必有；`content.last_frame_url` 仅 `return_last_frame` 时有；`usage.completion_tokens` | `video_url` 缺失判 `empty_result` | — | completed，URL 为视频（+ 尾帧） | 是 |
| `failed` | queued / running | `error.code` / `error.message`（成功时 `error` 为 null） | `error` 缺失时用固定原因 | — | 无 | 是，`provider_task_failed`，不续查 |
| `cancelled` | queued | — | — | — | 无 | 是；记录 24 小时后自动删除 |
| `expired` | queued / running | `execution_expires_after`（默认 172800 秒） | 官方无 error 示例 | — | 无 | 是 |
| 缺 `status` / 查询 HTTP 5xx / 网络错误 | 任意 | — | — | 保持 | 无 | 计入连续查询失败，连续 20 次后 `provider_task_unreachable` |

不变量：只有 `succeeded` 且带 `video_url` 才算有效 final；用户取消时停止计时器与查询，不发 DELETE；官方未说明是否会乱序回退状态，SDK 不依赖状态顺序，只看当次状态。Seedance 2.5 部分任务类型要排到被消费时才返回报错（官方「报错机制」），因此失败可能在 `queued` 之后很久才出现。

## 6. 项目适配

- 产品模型 `volcengine-seedance-2.0-mini`，参数交互与 APIMart 同家族入口一致：`role: 'mode'` 模式（文/图生视频、参考生视频）+ 比例 + 分辨率 + 时长 + 声音 / 尾帧 / 联网搜索开关。
- 比例「智能」发 `adaptive`。
- 与 APIMart 同家族入口保持一致，不暴露智能时长。
- 未接入：`priority`、`callback_url`、`execution_expires_after`、`safety_identifier`。
- 本地图片、音频由方舟官方支持的 Data URI 发送；本地读出的 `audio/mpeg`、`audio/x-wav` 等 MIME 在发送前改成官方格式名 `mp3` / `wav`。
- Fixture：`packages/ai-sdk/tests/fixtures/volcengine/video-*.json`；状态迁移与取消测试：`packages/ai-sdk/tests/providers/video-async-official.test.ts`；请求构建与价格：`packages/ai-sdk/tests/catalog/official-videos.test.ts`。未做真实付费调用。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 创建视频生成任务 API | https://www.volcengine.com/docs/82379/1520757 | 否 |
| 查询视频生成任务 API | https://www.volcengine.com/docs/82379/1521309 | 否 |
| 取消或删除视频生成任务 | https://www.volcengine.com/docs/82379/1521720 | 否 |
| 模型列表（模型 ID、分辨率、时长、限流） | https://www.volcengine.com/docs/82379/1330310 | 否 |
| 模型价格 | https://www.volcengine.com/docs/82379/1544106 | 否 |
| 错误码 | https://www.volcengine.com/docs/82379/1299023 | 否 |
| Seedance 2.5 教程 / 2.0 系列教程 | https://www.volcengine.com/docs/82379/2607688 ; https://www.volcengine.com/docs/82379/2291680 | 否 |

> 机器可读原文：`https://docs.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=<id>&type=online`。
