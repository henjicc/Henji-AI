# Seedance 2.5

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 独立模型；不要与 Seedance 2.0、2.0 Fast、2.0 Mini 共用模型 ID |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示 |
| 官方接口 | 本清单未提供官方接口链接，按 APIMart/KIE 适配 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `seedance-2.5` | [Seedance 2.5 API](https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md) | 480P `$0.09608/秒`；720P `$0.216/秒`；1080P `$0.38488/秒`；参考输入另计 | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `bytedance/seedance-2-5` | [KIE Seedance 2.5](https://docs.kie.ai/cn/market/bytedance/seedance-2-5.md) | 无视频输入：480/720/1080P 为 `$0.14/$0.315/$0.57/秒`；有视频输入为 `$0.085/$0.19/$0.3425/秒` | 价格与 API 文档无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；使用 Bearer API Key。
- `model=seedance-2.5`。支持文生视频、首尾帧、参考图片/视频/音频、音频生成、工具和返回最后一帧；成功结果读取 `data.result.videos[].url[]`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填；文档允许的最大长度约 30,000 字符 |
| `duration` | number | 最长约 30 秒；以平台允许值为准 |
| `resolution` | `480p`、`720p`、`1080p` | 价格按分辨率和输出秒数计算 |
| `size` | 比例或 `adaptive` | 默认可使用自适应比例 |
| `generate_audio` | boolean | 是否生成音频 |
| `image_urls` / `image_with_roles` | URL 数组/结构化数组 | 最多约 30 张参考图，按文档角色字段组织 |
| `video_urls` | URL 数组 | 最多约 10 个参考视频；参考视频的计费包含参考与生成时长 |
| `audio_urls` | URL 数组 | 最多约 10 个参考音频 |
| `return_last_frame` / `tools` | boolean / 数组 | 平台能力；复杂工具默认隐藏 |
| `output_format` | `mp4`、`mov` | 默认不展示，除非调用方确实需要非默认格式 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。输出视频按秒和分辨率计费，参考图片/视频/音频按平台输入规则另计；不能只用输出秒数估算参考视频请求成本。

## KIE 适配

- Base URL `https://api.kie.ai`；创建 `POST /api/v1/jobs/createTask`，`model=bytedance/seedance-2-5`，返回 `data.taskId`。
- 查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`；成功时 JSON.parse `data.resultJson` 并读取 `resultUrls`；失败状态为 `fail`。推荐使用 `callBackUrl`。
- KIE 页面字段包括 `prompt`、参考图片/视频/音频、`generate_audio`、`resolution`、`aspect_ratio`、`duration`、`output_format`、`return_last_frame` 等；输入上限按页面的 30 张图片、10 个视频、10 个音频执行。
- KIE 价格按“是否有视频输入”和分辨率拆分；参考视频请求必须计入输入视频时长。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart Seedance 2.5 API](https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md)：字段、限制、结果与参考素材计费说明。
- [APIMart 定价](https://apimart.ai/zh/pricing)：输出和输入价格。
- [KIE Seedance 2.5](https://docs.kie.ai/cn/market/bytedance/seedance-2-5.md)：KIE 模型 ID 与字段。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建与回调。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询与结果。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `seedance`。

## Fal 适配（2026-08-21）

- 端点：`bytedance/seedance-2.5/{text-to-video|image-to-video|reference-to-video}`；图生支持首尾帧，参考模式支持图片、视频和音频数组。
- 参数：比例与分辨率独立；分辨率 `480p|720p|1080p`，时长 `4–30`，支持原生音频与标准/高码率。
- 价格：480p 约 `$0.2205/秒`、720p 约 `$0.4730/秒`；1080p 按官方约 `$0.0234/千 token` 估算约 `$1.137/秒`。参考视频输入按 0.6 倍费率另计，720p 输入约 `$0.2838/秒`。
- 来源：[Fal 文生视频文档](https://fal.ai/models/bytedance/seedance-2.5/text-to-video/llms.txt)、[Fal 参考生视频文档](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/llms.txt)。
