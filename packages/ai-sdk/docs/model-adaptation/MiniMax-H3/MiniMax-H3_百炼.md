# MiniMax H3 · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-08 |
| 模态 | 视频 |
| 供应商 | 阿里云百炼（托管，推理服务供应商为 MiniMax） |
| 项目模型 ID | `bailian-minimax-h3`（通用标识 `minimax-h3`） |
| 平台模型 ID | `MiniMax/MiniMax-H3` |
| 接口形态 | 异步任务（HTTP 只支持异步） |
| 文档 / 价格可见性 | 公开，无需登录 |
| 开通 | 需在百炼控制台搜索 “MiniMax”，在模型卡片上单击“立即开通”并确认授权；未开通时返回未开通错误，应用提示用户去开通 |

## 1. 接入协议

- 提交：`POST /api/v1/services/aigc/video-generation/video-synthesis`，请求头必须带 `X-DashScope-Async: enable`；返回 `output.task_id`、`output.task_status: PENDING`
- 查询：`GET /api/v1/tasks/{task_id}`；官方建议约 15 秒查询一次，`task_id` 24 小时内可查；状态 PENDING → RUNNING → SUCCEEDED / FAILED（另有 CANCELED、UNKNOWN）
- 官方示例用空间专属域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`；项目沿用百炼统一的 `https://dashscope.aliyuncs.com`（与万相 3.0 相同，见 [百炼.md](../供应商/百炼.md) 第 1 节）。只适用北京地域
- 结果 `output.video_url`（MP4，H.264，30 天有效）；`usage` 给出 `output_seconds`、`input_seconds`（参考视频总秒数）、`image_count`（超过 5 张的计费图片数）、`SR`、`size`
- 生成通常 1–5 分钟

## 2. 能力（按 `input.media[].type` 组合）

| 场景 | media |
|---|---|
| 文生视频 | 不传 media |
| 首帧 / 尾帧 / 首尾帧 | `first_frame` ≤ 1、`last_frame` ≤ 1 |
| 多模态参考生视频 | `image_url` ≤ 9、`feature`（参考视频）≤ 3、`driving_audio`（参考音频）≤ 3 |

图生视频与参考生视频互斥，不能混用。项目“文/图生视频”模式下 1 张图为首帧、2 张为首尾帧（不提供单独的“仅尾帧”）；参考音频与 MiniMax 其他渠道一致要求搭配参考图或参考视频。

素材限制：
- 图片：JPG/JPEG/PNG/WEBP/HEIC/HEIF，宽高 256–5760 px，宽高比 0.4–2.5，≤ 30MB；URL 文档写 HTTP/HTTPS
- 视频：MP4/MOV，H.264/H.265，单段 2–15 秒、合计 ≤ 15 秒，宽高 256–5760 px，宽高比 0.4–2.5，23.976–60 fps，≤ 50MB
- 音频：WAV/MP3，单段 2–15 秒、合计 ≤ 15 秒，≤ 15MB

## 3. 请求参数

| 字段 | 取值 | 项目处理 |
|---|---|---|
| `model` | `MiniMax/MiniMax-H3` | 固定 |
| `input.prompt` | 必填，≤ 7000 字符 | 空提示词在提交前拒绝 |
| `parameters.resolution` | 必填，`768P` / `2K` | 「分辨率」，默认 2K（与其他渠道一致） |
| `parameters.ratio` | `adaptive`（默认）、`16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9` | 文生视频必须具体比例（智能比例落到 16:9）；图生视频由图片决定，界面隐藏且不发送；参考生视频智能比例发 `adaptive` |
| `parameters.duration` | 必填，4–15 整数 | 「时长」，默认 6 |
| `parameters.watermark` | 默认 false | 固定 false |

## 4. 价格（北京，刊例价）

| 项 | 价格 |
|---|---|
| 输出 768P | ¥0.50 / 秒 |
| 输出 2K | ¥0.80 / 秒 |
| 输入参考视频 | 按输入时长与生成分辨率同价（768P ¥0.50 / 秒、2K ¥0.80 / 秒） |
| 输入图片 | 5 张以内免费，超出 ¥0.20 / 张 |
| 输入音频 | 免费 |

限流：RPM 300，同时处理中任务 5。

## 原始链接索引

| 内容 | 链接 | 需登录 |
|---|---|---|
| API 文档 | https://help.aliyun.com/zh/model-studio/minimax-video-generation-api-reference | 否 |
| 模型信息与价格 | https://help.aliyun.com/zh/model-studio/minimax-h3 | 否 |
