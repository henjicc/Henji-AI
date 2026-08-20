# Kling 3.0 Turbo

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 独立模型；Turbo 与标准版、Omni 的模型 ID、输入能力和价格不同 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示 |
| 官方接口 | [Kling 视频能力图](https://www.klingai.com/document-api/guides/capability-map/video)，仅用于能力参考，暂不适配官方接口 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| 官方 Kling | 仅参考 | `kling-3.0-turbo` | [官方视频能力图](https://www.klingai.com/document-api/guides/capability-map/video) | 页面未提供本项目所需价格 | 页面公开可见；本任务不接官方调用 |
| APIMart | 支持 | `kling-3.0-turbo` | [Kling 3.0 Turbo API](https://docs.apimart.ai/en/api-reference/videos/kling-3.0-turbo/generation.md) | 720P `$0.1144/秒`；1080P `$0.1432/秒` | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `kling/v3-turbo-text-to-video`、`kling/v3-turbo-image-to-video` | [Turbo 文生视频](https://docs.kie.ai/cn/market/kling/v3-turbo-text-to-video.md)、[Turbo 图生视频](https://docs.kie.ai/cn/market/kling/v3-turbo-image-to-video.md) | 文生/图生：720P `$0.09/秒`；1080P `$0.1125/秒` | 价格与 API 文档无需登录；实际调用需要 API Key |

## 官方能力参考

官方能力图列出 `kling-3.0-turbo`，支持 3–15 秒视频；Turbo 的官方能力页面显示 720p/1080p 等能力。官方链接只用于确认模型名称与能力，不作为本项目的调用端点。

## KIE 适配

- Base URL `https://api.kie.ai`；统一提交 `POST /api/v1/jobs/createTask`，查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`，返回 `data.taskId`。成功时 JSON.parse `data.resultJson`，读取 `resultUrls`；可传 `callBackUrl`。
- 文生视频使用 `model=kling/v3-turbo-text-to-video`；图生视频使用 `model=kling/v3-turbo-image-to-video`。这两个 KIE 模型 ID 与官方 `kling-3.0-turbo` 不同，必须在供应商适配配置中显式映射。

| KIE 输入字段 | 适配说明 |
|---|---|
| `prompt` | 文生视频必填；页面最大长度约 2,500 字符 |
| `image_urls` | 图生视频输入；按页面要求提供图片 URL |
| `duration` | 默认约 5 秒；按页面允许值传递 |
| `aspect_ratio` | `16:9`、`9:16`、`1:1` 等页面枚举 |
| `resolution` | `720p`、`1080p` |
| `sound` | 若该模式支持声音，按 KIE 页面开关传递 |
| `seed` / 负面提示词 | 项目约定：绝对不显示、不请求 |

KIE 定价页按 `kling 3.0` 搜索可见 Turbo 四条价格，文生与图生同价。来源：[KIE 定价](https://kie.ai/pricing)。

## APIMart 适配与价格

- Base URL `https://api.apimart.ai`；提交 `POST /v1/videos/generations`，`model=kling-3.0-turbo`；轮询 `GET /v1/tasks/{task_id}`。
- `prompt`：文生视频必填，图生视频可为空；图生视频使用 `first_frame_image`，不使用通用 `image_urls`。
- `aspect_ratio` 仅文生视频有效；`resolution=720p|1080p`；`duration` 为 3–15 秒；支持 `watermark`。多镜头通过文档规定的固定格式 prompt 表达。
- APIMart 定价页按 `kling` 搜索可见 `KLING-3.0-TURBO`：720P `$0.1144/秒`、1080P `$0.1432/秒`。来源：[APIMart 定价](https://apimart.ai/zh/pricing)。

## 原始链接索引

- [Kling 官方视频能力图](https://www.klingai.com/document-api/guides/capability-map/video)：官方模型名称、时长与能力参考；暂不接官方接口。
- [APIMart Kling 3.0 Turbo API](https://docs.apimart.ai/en/api-reference/videos/kling-3.0-turbo/generation.md)：模型 ID、文生/图生字段、分辨率与时长。
- [APIMart 定价](https://apimart.ai/zh/pricing)：搜索 `kling` 获取 Turbo 价格。
- [KIE Turbo 文生视频](https://docs.kie.ai/cn/market/kling/v3-turbo-text-to-video.md)：KIE 模型 ID 与字段。
- [KIE Turbo 图生视频](https://docs.kie.ai/cn/market/kling/v3-turbo-image-to-video.md)：KIE 图生视频字段。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建与回调。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询与结果。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `kling 3.0`。

## Fal 适配（2026-08-21）

- Fal 端点：`fal-ai/kling-video/v3/turbo/{standard|pro}/{text-to-video|image-to-video}`；图生端点需要单一 `image_url`。
- 参数：`duration=3–15`；文生比例 `16:9|9:16|1:1`。Fal schema 不提供音频、尾帧与显式分辨率字段；画布的分辨率栏按路由档位显示“标准/专业”。
- 价格：Turbo Standard `$0.112/秒`，Turbo Pro `$0.14/秒`。
- 来源：[Fal Turbo Standard 文档](https://fal.ai/models/fal-ai/kling-video/v3/turbo/standard/text-to-video/llms.txt)、[Fal Turbo Pro 文档](https://fal.ai/models/fal-ai/kling-video/v3/turbo/pro/text-to-video/llms.txt)。
