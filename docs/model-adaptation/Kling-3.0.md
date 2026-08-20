# Kling 3.0

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 独立模型；与 Turbo、Omni 分开注册，标准版使用 `kling-v3` / KIE `kling-3.0/video` |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示 |
| 官方接口 | [Kling 视频能力图](https://www.klingai.com/document-api/guides/capability-map/video)，仅用于能力参考，暂不适配官方接口 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| 官方 Kling | 仅参考 | `kling-v3` | [官方视频能力图](https://www.klingai.com/document-api/guides/capability-map/video) | 页面未提供本项目所需价格 | 页面公开可见；本任务不接官方调用 |
| APIMart | 支持 | `kling-v3` | [Kling v3 API](https://docs.apimart.ai/en/api-reference/videos/kling-v3/generation.md) | 默认 `$0.0672/秒`；4K `$0.42856/秒`；Pro `$0.0896/秒`；带声音档位另计 | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `kling-3.0/video` | [KIE Kling 3.0](https://docs.kie.ai/cn/market/kling/kling-3-0.md) | 720P 无/有音频 `$0.07/$0.10/秒`；1080P `$0.09/$0.135/秒`；4K `$0.335/秒` | 价格与 API 文档无需登录；实际调用需要 API Key |

## 官方能力参考

官方能力图列出标准模型 ID `kling-v3`，支持 3–15 秒；能力包括文生视频、图生视频、视频输入、多镜头和音频等，并按 720p/1080p/4K 区分。该链接只用于能力核对，不作为本项目官方调用端点。

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交视频生成使用 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；使用 Bearer API Key。
- `model=kling-v3`。`image_urls` 为空时文生视频，1 张为首帧，2 张为首尾帧；`mode=std|pro|4k` 对应 720P/1080P/4K；`duration` 3–15 秒；支持 `audio`、`multi_shot`、`multi_prompt` 与元素输入。成功视频按通用任务结果读取 `data.result.videos[].url[]`。
- APIMart 文档含 `negative_prompt`，按项目约定不显示且不请求。

## KIE 适配

- Base URL `https://api.kie.ai`；创建 `POST /api/v1/jobs/createTask`，`model=kling-3.0/video`，返回 `data.taskId`；查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`。
- 成功后 JSON.parse `data.resultJson`，读取 `resultUrls`；失败状态为 `fail`；生产环境建议传 `callBackUrl`。

| KIE 输入字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 生成描述；与 `multi_prompt`、`multi_shots` 共同控制镜头 |
| `image_urls` | URL 数组 | 图生视频或参考图 |
| `sound` | boolean | 声音开关；会影响价格/能力 |
| `duration` | `3–15` 秒 | 页面允许范围 |
| `aspect_ratio` | `16:9`、`9:16`、`1:1` | 比例枚举 |
| `mode` | 默认 `pro` 等页面枚举 | 质量/速度模式；不要将其误称为另一个模型 |
| `multi_shots` / `multi_prompt` | boolean / 结构化数组 | 多镜头生成与分镜提示 |
| `kling_elements` | 结构化数组 | 角色/元素输入及其图片、音频 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

KIE 公开价格按分辨率和音频拆分：720P 无/有音频 `$0.07/$0.10/秒`，1080P `$0.09/$0.135/秒`，4K 当前有无音频均列 `$0.335/秒`。来源：[KIE 定价](https://kie.ai/pricing)。

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。价格页列出默认、4K、Pro、声音等多个计费模式；最终价格按分辨率、质量模式和是否带声音选择，不能只记录一个静态单价。

## 原始链接索引

- [Kling 官方视频能力图](https://www.klingai.com/document-api/guides/capability-map/video)：官方模型 ID、输入类型、时长和分辨率能力。
- [APIMart Kling v3 API](https://docs.apimart.ai/en/api-reference/videos/kling-v3/generation.md)：模型 ID、模式、首尾帧、多镜头与音频字段。
- [APIMart 定价](https://apimart.ai/zh/pricing)：`KLING-V3` 价格档位。
- [KIE Kling 3.0](https://docs.kie.ai/cn/market/kling/kling-3-0.md)：KIE 模型 ID、字段和模式。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建与回调。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询与结果。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `kling 3.0`。

## Fal 适配（2026-08-21）

- Fal 分成标准/专业与文生/图生四个端点：`fal-ai/kling-video/v3/{standard|pro}/{text-to-video|image-to-video}`。图生端点支持首帧 `start_image_url` 和可选尾帧 `end_image_url`。
- 共有 `duration=3–15`、`generate_audio`、`shot_type`；文生支持 `aspect_ratio=16:9|9:16|1:1` 与 `cfg_scale`。复杂多镜头/语音控制 schema 本次不暴露，避免构造不完整结构。
- 画布将比例与档位独立：Fal 没有单独的 `resolution` 字段，因此分辨率栏按官方端点名显示“标准/专业”。价格为标准 `$0.084/$0.126 每秒`、专业 `$0.112/$0.168 每秒`（无/有音频）；语音控制未暴露且不纳入估算。
- 来源：[Fal Standard 文档](https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/llms.txt)、[Fal Pro 文档](https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video/llms.txt)。
