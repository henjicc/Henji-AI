# Wan 3.0 · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | 阿里云百炼（官方） |
| 项目模型 ID | `bailian-wan-3.0`（通用标识 `wan-3.0`） |
| 平台模型 ID | `wan3.0-video`（标准版）、`wan3.0-video-prime`（官方称“高速版”：能力对齐标准版，端到端更快，单价更高） |
| 接口形态 | 异步任务（HTTP 只支持异步） |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /api/v1/services/aigc/video-generation/video-synthesis`，请求头必须带 `X-DashScope-Async: enable`（缺少时报 “current user api does not support synchronous calls”）；成功返回 `output.task_id` 与 `output.task_status: PENDING`
- 查询：`GET /api/v1/tasks/{task_id}`；官方建议约 15 秒查询一次，查询 RPS 默认 20；`task_id` 24 小时内可查
- 官方示例使用空间专属域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`；项目沿用百炼供应商统一的 `https://dashscope.aliyuncs.com`（官方保证历史地址可用，见 [百炼.md](../供应商/百炼.md) 第 1 节）。模型、Endpoint 与 API Key 必须同属北京地域
- 结果 `output.video_url` 为 MP4（H.264），24 小时有效，按统一媒体转存链路落盘
- 生成通常 1–5 分钟，最长可出 30 秒视频，30 fps

## 2. 能力（按 `input.media[].type` 组合）

| 场景 | media |
|---|---|
| 文生视频 | 不传 media，只传 `prompt` |
| 首帧 / 首尾帧 | `first_frame` 1 张（+ `last_frame` 1 张）；不可与其他类型混用 |
| 参考生视频 | `reference_image` ≤ 10、`reference_video` ≤ 5（单段 1–15 秒，总 ≤ 15 秒）、`reference_audio` ≤ 5（同上），自由组合；提示词用“图1”“视频1”“音频1”指代，图 / 视频 / 音频分别计数 |
| 文件 / 网页生视频 | `file`（docx、pdf、pptx 等 ≤ 100MB / 50 页）或 `link`（公开网页）二选一，可再组合参考素材；此时 `prompt_extend` 必须为 true |
| 视频编辑 / 延长 | 至少 1 个 `reference_video`，提示词写编辑或延长意图；延长需 `ratio: adaptive` |

`prompt` 与 `media` 至少填一项；`prompt` ≤ 20000 字符，超出自动截断。

输入格式：图片支持公网 URL、`oss://` 临时 URL 与 `data:{MIME};base64,` Data URI（JPEG/JPG/PNG/BMP/WEBP，单边 240–8000 px，长宽比 ≤ 8:1，≤ 20MB）；**视频、音频、文件只收公网 URL 或 `oss://` 临时 URL**。

## 3. 请求参数

| 字段 | 取值 | 项目处理 |
|---|---|---|
| `model` | `wan3.0-video` / `wan3.0-video-prime` | 由「版本」切换 |
| `input.prompt` | string | 空提示词不发送 |
| `input.media` | 见第 2 节 | 文/图生视频：1 张发 `first_frame`、2 张再加 `last_frame`；参考模式发 `reference_image`（最多 10 张） |
| `parameters.resolution` | `1080P`（默认，最贵）/ `720P` / `480P` | 默认 720P，始终显式发送 |
| `parameters.ratio` | `adaptive`（默认）/ `21:9` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` | 「智能」发 `adaptive` |
| `parameters.duration` | 2–30，默认 5；`-1` 智能时长；有视频输入时输入总时长 + 输出时长 ≤ 30 | 2–30 |
| `parameters.audio` | boolean，默认 true，开关同价 | 开关 |
| `parameters.watermark` | boolean，默认 false | 固定 false |
| `parameters.prompt_extend` | boolean，默认 true | 不发送（用官方默认） |
| `parameters.seed` | -1 或 0–2147483647 | 不显示、不发送 |

## 4. 价格

来源：[模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)「万相3.0-视频生成」（2026-11-07 读取，无需登录），华北2（北京），输入视频与输出视频同价，按秒计费，失败不计费：

| 分辨率 | wan3.0-video（原价，当前限时 7 折） | wan3.0-video-prime |
|---|---|---|
| 480P | ¥0.3/秒 | ¥0.45/秒 |
| 720P | ¥0.6/秒 | ¥0.9/秒 |
| 1080P | ¥1.2/秒 | ¥1.8/秒 |

- 计费时长 = 输入视频时长 + 输出视频时长；读不到参考视频时长时按输出时长估，封顶合计 15 秒。
- 北京地域标准版有 30 秒免费额度（90 天内），Prime 无。
- 项目按标准版**原价**预估，折扣期内实际账单更低；新加坡等地域单价不同，项目只用北京。

## 5. 事件 / 状态矩阵

| 状态 | 前置 | 字段契约 | 空值语义 | 下一状态 | 对外输出 | 终态 / 错误 |
|---|---|---|---|---|---|---|
| 提交成功 | — | `output.task_id` string、`output.task_status: PENDING`、`request_id` | 缺 `task_id` 判 `invalid_response` | PENDING | pending + taskId | 否 |
| 提交失败 | — | 顶层 `code` / `message` / `request_id` | — | — | 无 | 是；`Arrearage`、`AccessDenied.Unpurchased`、`Model.AccessDenied` 与“模型未开通”文案按 `providerAccessErrors` 归类为不可重试 |
| `PENDING` | 提交 | `output.task_status` | 无结果 | RUNNING | 无 | 否，继续查询 |
| `RUNNING` | PENDING | 同上 | 无结果 | SUCCEEDED / FAILED | 无 | 否，继续查询 |
| `SUCCEEDED` | RUNNING | `output.video_url` 必有；`usage.duration` / `output_video_duration` / `SR` / `ratio` | `video_url` 缺失或非 http(s) 判 `empty_result` | — | completed，URL 为视频 | 是 |
| `FAILED` | PENDING / RUNNING | `output.code` / `output.message` | message 缺失时用固定原因 | — | 无 | 是，`provider_task_failed`（`code: message`），不续查 |
| `CANCELED` | PENDING | — | — | — | 无 | 是 |
| `UNKNOWN` | 任意 | 只有 `task_id` / `task_status` | 任务不存在或超过 24 小时查询期 | 保持 | 无 | 计入连续查询失败，连续 20 次后 `provider_task_unreachable` |
| 缺状态 / 查询 HTTP 5xx / 网络错误 | 任意 | — | — | 保持 | 无 | 同上 |

不变量：只有 `SUCCEEDED` 且带 `video_url` 才算有效 final；用户取消只停止本地查询（官方取消接口见「管理异步任务」，SDK 未接）；SDK 只看当次状态，不依赖状态顺序。

## 6. 项目适配

- 一个产品模型，`role: 'mode'` 版本（标准 / Prime）+ `role: 'mode'` 模式（文/图生视频、参考生视频），与 APIMart、Fal 同家族入口一致（KIE 把 Prime 拆成独立模型 `kie-wan-3.0-prime`）。
- 图片走 Data URI；参考视频（≤ 5）、参考音频（≤ 5）由百炼预处理按请求的 `model` 申请临时存储凭证（`/api/v1/uploads?action=getPolicy`）上传成 `oss://`，请求体含 `oss://` 时提交自动带 `X-DashScope-OssResourceResolve: enable`。视频编辑 / 延长不单设模式：参考模式带上视频、提示词写明意图即可（延长需「智能」比例）。
- 未接入：`file` / `link`、`duration: -1`、`seed`、`prompt_extend` 开关、地域与业务空间域名配置。有视频输入时官方要求输入总时长 + 输出时长 ≤ 30 秒：读得到素材时长时，提交前把输出时长收进这个范围。
- Fixture：`packages/ai-sdk/tests/fixtures/bailian/video-*.json`（提交成功、提交失败、成功、失败、UNKNOWN 均为官方原样示例）；状态迁移与请求头测试：`packages/ai-sdk/tests/providers/video-async-official.test.ts`；请求构建与价格：`packages/ai-sdk/tests/catalog/official-videos.test.ts`。未做真实付费调用。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 万相 3.0 视频生成 API 参考 | https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference | 否 |
| 模型价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| 模型列表 | https://help.aliyun.com/zh/model-studio/models | 否 |
| 上传文件获取临时 URL | https://help.aliyun.com/zh/model-studio/get-temporary-file-url | 否 |
| 控制台模型卡片 | https://bailian.console.aliyun.com/cn-beijing/model/market/detail/wan3.0-video | 是 |
