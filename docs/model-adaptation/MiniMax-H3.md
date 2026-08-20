# MiniMax H3

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 一个模型；APIMart 按统一模型 ID 路由，KIE 按文生视频/图生视频/参考生视频能力拆分请求 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示 |
| 官方接口 | 本清单未提供 MiniMax H3 官方接口链接，按 APIMart/KIE 适配 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `MiniMax-H3` | [MiniMax H3 API](https://docs.apimart.ai/en/api-reference/videos/minimax-h3/generation.md) | 2K/默认 `$0.09144/秒`；768P `$0.05712/秒`；参考图首 5 张免费后 `$0.02288/张` | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `minimax-h3/text-to-video`、`minimax-h3/image-to-video`、`minimax-h3/reference-to-video` | [KIE 文生视频](https://docs.kie.ai/cn/market/minimax-h3/text-to-video.md)、[图生视频](https://docs.kie.ai/cn/market/minimax-h3/image-to-video.md)、[参考生视频](https://docs.kie.ai/cn/market/minimax-h3/reference-to-video.md) | 768P `$0.08/秒`；2K `$0.13/秒`；超过前 5 张的额外输入图 `$0.04/张` | 价格与 API 文档无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；使用 Bearer API Key。
- `model=MiniMax-H3`。支持文生视频、首帧/尾帧图生视频和多模态参考素材；成功读取 `data.result.videos[0].url`。任务轮询建议间隔 5–10 秒，超时可设 15 分钟。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 文生视频或对参考素材的说明 |
| `duration` | `4–15` 秒 | 按平台时长枚举传递 |
| `resolution` | `2K`、`768P` | 价格按档位变化 |
| `aspect_ratio` | 比例 | 与分辨率、输入模式共同校验 |
| `first_frame_image` / `last_frame_image` | URL | 首帧、尾帧图生视频 |
| `image_urls` / `image_with_roles` | URL 数组/结构化数组 | 多模态参考图 |
| `video_urls` / `audio_urls` | URL 数组 | 参考视频、音频；参考视频按平台规则计费 |
| `watermark` | boolean | 默认不显示，按产品要求设置 |
| `webhook` | URL | 异步回调，可选 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。`MiniMax-H3` 按输出秒数计费，参考图前 5 张免费、之后按张计费；参考视频的具体计费以实时价格页为准。`MINIMAX-H3-REGENERATION` 是另一个再生成模型，不要误用。

## KIE 适配

- 统一使用 `POST /api/v1/jobs/createTask`。文生视频用 `model=minimax-h3/text-to-video`，图生视频用 `minimax-h3/image-to-video`，参考生视频用 `minimax-h3/reference-to-video`；返回 `data.taskId`。
- 查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`；成功后 JSON.parse `data.resultJson` 读取 `resultUrls`；建议传 `callBackUrl`。
- 文生视频主要字段为 `prompt`、`aspect_ratio`、`duration`、`resolution`；图生视频使用首帧/尾帧；参考生视频使用最多 9 张参考图、最多 3 个参考视频和最多 3 个参考音频。KIE 文档对不同模式的比例和必填项有差异，路由时必须按模式选择 schema。
- KIE 计费公式为“单价 ×（生成视频时长 + 输入视频时长）+ 额外图片成本”；前 5 张输入图免费，之后 `$0.04/张`，输入音频免费。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart MiniMax H3 API](https://docs.apimart.ai/en/api-reference/videos/minimax-h3/generation.md)：模型 ID、字段、结果和轮询建议。
- [APIMart 定价](https://apimart.ai/zh/pricing)：输出与参考图价格。
- [KIE 文生视频](https://docs.kie.ai/cn/market/minimax-h3/text-to-video.md)：文生视频模型 ID 与字段。
- [KIE 图生视频](https://docs.kie.ai/cn/market/minimax-h3/image-to-video.md)：首帧/尾帧输入。
- [KIE 参考生视频](https://docs.kie.ai/cn/market/minimax-h3/reference-to-video.md)：多模态参考输入。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建与回调。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询与结果。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `minimax`。

## Fal 适配（2026-08-21）

- 端点：`minimax/h3/text-to-video`、`minimax/h3/image-to-video`、`minimax/h3/reference-to-video`；分别覆盖文生、首尾帧和图片/视频/音频联合参考。
- 参数：`duration=5–15`；分辨率 `480P|768P|2K|4K`；文生/参考模式比例为 `21:9|16:9|4:3|1:1|3:4|9:16`，参考模式可用 `adaptive`。参考上限为图片 9、视频 3、音频 3。
- 价格：480P/768P/2K/4K 分别 `$0.05/$0.06/$0.13/$0.16 每秒`；参考模式前 5 张图免费，第 6 张起 `$0.08/张`。
- 来源：[Fal 文生视频文档](https://fal.ai/models/minimax/h3/text-to-video/llms.txt)、[Fal 参考生视频文档](https://fal.ai/models/minimax/h3/reference-to-video/llms.txt)。
