# Gemini Omni 1.2 Flash · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-gemini-omni-1.2-flash`（通用标识 `gemini-omni-1.2-flash`） |
| 平台模型 ID | 官方：`gemini-omni-1.2-flash`；Ext：`gemini-omni-1.2-flash-ext` |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/videos/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`，每 5–10 秒轮询，建议整体超时 10 分钟；完成后读 `data.result.videos[0].url[0]`，`data.cost` 为最终结算
- 输出 24fps、含音频，带 SynthID 水印；参数类错误（`invalid_*`）使任务立即 `failed` 且不扣费

## 2. 能力

| 能力 | 官方 `gemini-omni-1.2-flash` | Ext `gemini-omni-1.2-flash-ext` |
|---|---|---|
| 文生视频 | 3–15 秒 | 3–15 秒 |
| 首帧图生视频 | 支持 | 支持 |
| 首尾帧插值 | 支持（3–10 秒） | **不支持**（`last_frame_image` 报 400） |
| 多图参考 | 图片与首尾帧合计 ≤ 10 | 1–10 张 |
| 视频编辑 | `video_urls` 1 段 ≤ 15 秒，`duration` 被忽略 | 同左，**传 `duration` 报错** |
| 视频续写 | `omni_reference_task_type: "extend"`，新增 ≤ 10 秒 | 同左，新增 3–10 秒 |
| `extend_from_task_id` | 支持 | 支持（需本账号已完成的 Ext 任务） |

## 3. 请求参数

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | 见上表 | 必填 |
| `prompt` | string | **所有模式必填**，缺少返回 400 |
| `duration` | 3–15 | 默认 10；首尾帧与续写 ≤ 10；编辑不传 |
| `resolution` | `360p` / `720p` / `1080p` / `4k`（`2160p` 视为 `4k`） | 默认 `720p`；1080p / 4k 为上采样 |
| `aspect_ratio` | `16:9` / `9:16` | 官方其他值按 16:9；Ext 不传时跟随素材 |
| `image_urls` | 公网 HTTP(S) | 不支持 Data URL / Base64 |
| `first_frame_image` / `last_frame_image` / `image_with_roles` | 公网 HTTP(S) | Ext 无尾帧 |
| `video_urls` | 1 段，≤ 15 秒（Ext 另限 MP4/MOV/WebM、≤ 64 MB） | |
| `omni_reference_task_type` | `auto` / `edit` / `extend` / `reference`（及 `text_to_video` 等别名） | Ext 带视频时必须传 |
| `extend_from_task_id` | 平台任务 ID | 项目不显示、不请求（界面拿不到供应商任务 ID） |
| `negative_prompt` / `system_prompt` | 仅 Ext | 项目不请求 |

## 4. 价格

来源：[Gemini Omni 1.2 Flash 模型页](https://apimart.ai/zh/model/gemini-omni-1-2-flash)（2026-11-07 读取，黄金价 = 当前价）；定价中心起步价 `gemini-omni-1.2-flash $0.02/秒` 一致。

| 分辨率 | 官方（每秒） | Ext（每秒） |
|---|---|---|
| 360p | $0.02 | $0.016 |
| 720p | $0.06 | $0.024 |
| 1080p | $0.0904 | $0.024 |
| 4k | $0.1808 | $0.056 |

计费秒数：文生 / 图生 / 多图参考按 `duration`；编辑按源视频时长（Ext 文档：扣除 0.15 秒容器误差后向上取整，最少 1 秒）；续写只按新增秒数。官方文档写“按 token 计费”，模型页按分辨率给出每秒价，项目按每秒价估算。官方提交时按 `max(10, duration)` 秒预扣，带视频按 15 秒预扣，成功后多退少补。

## 5. 项目适配

- 新建独立模型而不并入 `apimart-gemini-omni-flash`：旧模型的通用标识是 `gemini-omni-video`（对应 Gemini Omni Flash 预览版），1.2 Flash 是另一个跨供应商的通用模型 `gemini-omni-1.2-flash`，合并会让同一模型卡片挂两个通用标识。
- 顶层 `role: 'channel'` 渠道（默认官方）+ `role: 'mode'` 模式：文/图生视频（0 张文生、1 张首帧、2 张首尾帧；Ext 最多 1 张）、多图参考、视频编辑、视频续写。
- 时长默认 10；编辑模式隐藏并不发送；续写模式范围收为 3–10；首尾帧在请求构建时收为 ≤ 10。
- 比例：编辑与续写跟随输入视频；Ext 渠道带首帧或参考图时不传 `aspect_ratio` 以跟随素材。这些情况下比例选项隐藏且不发送。
- 不显示、不请求：`extend_from_task_id`、`negative_prompt`、`system_prompt`。
- APIMart 没有通用视频上传端点，视频素材必须是公网 URL。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 官方渠道 API 文档 | https://docs.apimart.ai/cn/api-reference/videos/gemini-omni-1.2-flash/generation | 否 |
| Ext 渠道 API 文档 | https://docs.apimart.ai/cn/api-reference/videos/gemini-omni-1.2-flash-ext/generation | 否 |
| 模型页（两渠道价格） | https://apimart.ai/zh/model/gemini-omni-1-2-flash | 否 |
| 定价中心（起步价） | https://apimart.ai/zh/pricing | 否 |
