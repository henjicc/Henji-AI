# Gemini Omni Flash

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 独立模型；APIMart 与 KIE 的平台模型 ID 不同，按供应商配置路由 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示 |
| 官方接口 | 本清单未提供 Gemini Omni Flash 官方接口链接，按 APIMart/KIE 适配 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `gemini-omni-flash-preview` | [Gemini Omni Flash API](https://docs.apimart.ai/en/api-reference/videos/gemini-omni-flash-preview/generation.md) | 720P `$0.088/秒` | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持同名能力 | `gemini-omni-video` | [KIE Gemini Omni Video](https://docs.kie.ai/cn/market/gemini-omni-video.md) | 无视频输入：720/1080P 的 4/6/8/10 秒为 `$0.315/$0.42/$0.525/$0.63/条`；4K 为 `$0.735/$0.84/$0.945/$1.05/条`；有视频输入另见价格页 | 价格与 API 文档无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；使用 Bearer API Key。
- `model=gemini-omni-flash-preview`。支持文生视频、图生视频、视频到视频和多轮编辑；默认 720p、24fps，带音频时常见时长为 3–10 秒。成功读取 `data.result.videos[].url[]`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填；生成或编辑说明 |
| `image_urls` | URL 数组 | 图生视频参考图 |
| `video_urls` | URL 数组 | 视频到视频/多轮编辑输入 |
| `aspect_ratio` | 默认 `16:9` | 按文档支持的比例传递 |
| `resolution` | 默认 `720p` | 当前价格按 720P 计费 |
| `extend_from_task_id` | string | 从已有任务继续/扩展，需保留前序任务上下文 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。`GEMINI-OMNI-FLASH-PREVIEW` 当前显示 720P `$0.088/秒`；视频时长和后续编辑任务应按实时价格计算。

## KIE 适配

- Base URL `https://api.kie.ai`；创建 `POST /api/v1/jobs/createTask`，`model=gemini-omni-video`，返回 `data.taskId`；查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`。
- 成功后 JSON.parse `data.resultJson`，读取 `resultUrls`；失败状态为 `fail`。建议传 `callBackUrl`。

| KIE 输入字段 | 适配说明 |
|---|---|
| `prompt` | 页面最大约 20,000 字符 |
| `image_urls` | 图片输入 |
| `audio_ids` | 音频输入 ID |
| `video_list` | 视频 URL、开始时间、结束时间；单个视频约 100MB/30 秒，片段最长约 10 秒 |
| `character_ids` | 角色输入 |
| `duration` | 无视频输入时使用；视频输入时由素材时长约束 |
| `aspect_ratio` | `16:9`、`9:16` |
| `resolution` | `720p`、`1080p`、`4K` |
| `seed` / 负面提示词 | 项目约定：绝对不显示、不请求 |

KIE 的 `gemini-omni-video` 与 APIMart 的 `gemini-omni-flash-preview` 名称不同，但均是本清单要求核查的 Gemini Omni 视频能力；适配层必须保留供应商级模型映射，不应把平台 ID 当成全局 ID。

KIE 有视频输入时，720P/1080P 当前均 `$0.84/条`、4K `$1.26/条`；无视频输入按分辨率与 4/6/8/10 秒固定档计费。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart Gemini Omni Flash API](https://docs.apimart.ai/en/api-reference/videos/gemini-omni-flash-preview/generation.md)：模型 ID、输入类型、默认分辨率和扩展任务。
- [APIMart 定价](https://apimart.ai/zh/pricing)：720P 价格。
- [KIE Gemini Omni Video](https://docs.kie.ai/cn/market/gemini-omni-video.md)：KIE 模型 ID、视频列表、角色、音频与输出参数。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建与回调。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询与结果。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `gemini omni`。
