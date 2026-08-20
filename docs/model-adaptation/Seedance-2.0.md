# Seedance 2.0

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 独立模型；与 Fast、Mini 使用不同模型 ID 和价格，不合并为一个前端模型 |
| 项目默认隐藏 | `seed`、负面提示词；供应商的 `output_format` 默认不显示 |
| 官方接口 | 本清单未提供 Seedance 2.0 官方接口链接，按 APIMart/KIE 适配 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `seedance-2.0` | [Seedance 2.0 API](https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md) | 480P `$0.066/秒`；720P `$0.142/秒`；1080P `$0.3544/秒`；4K `$0.722/秒`；参考输入另计 | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `bytedance/seedance-2` | [KIE Seedance 2](https://docs.kie.ai/cn/market/bytedance/seedance-2.md) | 无视频输入：480/720/1080/4K 为 `$0.095/$0.205/$0.51/$1.04/秒`；有视频输入为 `$0.057/$0.125/$0.31/$0.64/秒` | 价格与 API 文档无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；鉴权使用 Bearer API Key。
- `model=seedance-2.0`。请求支持文生视频、首帧/尾帧图生视频、参考视频/音频和多模态输入；成功结果读取 `data.result.videos[].url[]`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填；APIMart 文档列出的多模态提示词 |
| `duration` | number | 默认 5 秒；按文档允许值传递 |
| `size` | 比例 | 默认 `16:9`；按平台支持的比例枚举 |
| `resolution` | `480p`、`720p`、`1080p`、`4K` | 标准 Seedance 2.0 支持更高档位；价格随档位变化 |
| `generate_audio` | boolean | 默认 `true`；是否生成音频 |
| `image_urls` | URL 数组 | 首帧/尾帧或参考图；URL 必须能被 APIMart 访问 |
| `image_with_roles` | 结构化数组 | 为图片指定首帧、尾帧或参考角色 |
| `video_urls` / `audio_urls` | URL 数组 | 参考视频、音频；数量按文档限制 |
| `return_last_frame` | boolean | 是否返回最后一帧 |
| `tools` | 数组 | 平台工具能力；默认不显示 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。标准模型按生成秒数和分辨率计费，参考输入有独立价格档位；实现成本估算时需要同时考虑输出时长和输入素材时长。

## KIE 适配

- Base URL `https://api.kie.ai`；提交 `POST /api/v1/jobs/createTask`，请求体为 `{ model: "bytedance/seedance-2", callBackUrl?, input }`；返回 `data.taskId`。
- 查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`；`data.state=success` 后 JSON.parse `data.resultJson`，从 `resultUrls` 读取视频 URL；`state=fail` 为失败终态。生产环境优先配置 `callBackUrl`，避免长轮询。

| KIE 输入字段 | 适配说明 |
|---|---|
| `prompt` | 最多约 20,000 字符 |
| `first_frame_url` / `last_frame_url` | 首帧、尾帧图生视频 |
| `reference_image_urls` | 最多 9 张参考图 |
| `reference_video_urls` / `reference_audio_urls` | 最多 3 个参考视频/音频 |
| `generate_audio` | 默认 `true` |
| `resolution` / `aspect_ratio` / `duration` | 默认 720p、16:9、4–15 秒范围；按页面枚举传值 |
| `return_last_frame` / `web_search` / `nsfw_checker` | 平台开关；项目默认不暴露 seed 和负面提示词 |

KIE 价格按“是否有视频输入”和分辨率拆分；有视频输入档位会把输入视频时长计入总成本，不能只按输出秒数估算。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart Seedance 2.0 API](https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md)：请求字段、输入类型、输出结构。
- [APIMart 定价](https://apimart.ai/zh/pricing)：输出与参考输入价格。
- [KIE Seedance 2](https://docs.kie.ai/cn/market/bytedance/seedance-2.md)：KIE 模型 ID 和字段。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建、回调与鉴权。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询和结果解析。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `seedance`。

## Fal 适配（2026-08-21）

- 端点：`bytedance/seedance-2.0/{text-to-video|image-to-video|reference-to-video}`；图生支持首尾帧，参考模式支持图片最多 9、视频 3、音频 3。
- 参数：比例 `auto|21:9|16:9|4:3|1:1|3:4|9:16`；分辨率 `480p|720p|1080p|4k`；时长 `4–15`；原生音频；标准/高码率。画布比例和分辨率独立，智能比例在有媒体时发送 `auto`。
- 价格：Fal 明示 720p `$0.3034/秒`、1080p `$0.682/秒`；其余按 token 公式估算为 480p 约 `$0.1345/秒`、4K 约 `$1.5552/秒`。参考视频输入按输出分辨率另计。
- 来源：[Fal 文生视频文档](https://fal.ai/models/bytedance/seedance-2.0/text-to-video/llms.txt)、[Fal 参考生视频文档](https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/llms.txt)。
