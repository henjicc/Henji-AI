# Kling 3.0 Omni

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 独立模型；Omni 支持文生、图生、视频变换和参考生视频，KIE 按能力路由不同模型 ID |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示 |
| 官方接口 | [Kling 视频能力图](https://www.klingai.com/document-api/guides/capability-map/video)，仅用于能力参考，暂不适配官方接口 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| 官方 Kling | 仅参考 | `kling-v3-omni` | [官方视频能力图](https://www.klingai.com/document-api/guides/capability-map/video) | 页面未提供本项目所需价格 | 页面公开可见；本任务不接官方调用 |
| APIMart | 支持 | `kling-v3-omni` | [Kling v3 Omni API](https://docs.apimart.ai/en/api-reference/videos/kling-v3-omni/generation.md) | 默认 `$0.0672/秒`；4K `$0.42856/秒`；Pro `$0.0896/秒`；视频/声音档位另计 | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持；模型广场显示名为 `Kling O3` | `kling-3.0-omni/text-to-video`、`image-to-video`、`transformation`、`reference-to-video` | [Kling O3 模型页](https://kie.ai/kling-o3)及页面 `API` Tab；[文生](https://docs.kie.ai/market/kling/v3-omni-text-to-video)、[图生](https://docs.kie.ai/market/kling/v3-omni-image-to-video)、[视频变换](https://docs.kie.ai/market/kling/v3-omni-transformation)、[参考生](https://docs.kie.ai/market/kling/v3-omni-reference-to-video) | 文生/图生：720P 无/有原生音频 `$0.070/$0.090/秒`，1080P `$0.090/$0.115/秒`，4K `$0.335/秒`；视频变换为 `$0.100/$0.135/$0.335/秒` | 模型页、API Tab 与价格均公开，无需登录；实际调用需要 API Key |

## 官方能力参考

官方能力图列出 `kling-v3-omni`，支持 3–15 秒、720p/1080p/4K，以及视频输入、多镜头、音频和更丰富的参考输入。这里只使用官方页面核对能力，不接官方接口。

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；使用 Bearer API Key。
- `model=kling-v3-omni`。图片用 `image_urls` 并在 prompt 中以 `<<<image_N>>>` 引用；视频编辑使用 `video_list`。`mode=std|pro|4k`，支持 `duration`、`aspect_ratio`、音频、多镜头和元素输入；音频与 `video_list` 互斥。成功结果按通用视频结果读取 `data.result.videos[].url[]`。

## KIE 适配

- KIE 模型广场使用营销显示名 `Kling O3`，页面标题明确写为 “Kling 3.0 Omni”，页面内真实请求模型仍为 `kling-3.0-omni/...`。因此这里是同一模型的供应商别名，不是另一个 O3 模型。
- 统一提交 `POST /api/v1/jobs/createTask`，查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`；返回 `data.taskId`，成功后 JSON.parse `data.resultJson` 读取 `resultUrls`，可传 `callBackUrl`。
- KIE 的能力路由如下：

| 能力 | KIE model | 主要输入 |
|---|---|---|
| 文生视频 | `kling-3.0-omni/text-to-video` | `prompt`、多镜头/分镜、音频、元素 |
| 图生视频 | `kling-3.0-omni/image-to-video` | `image_urls`、`prompt`、时长、比例、分辨率 |
| 视频变换 | `kling-3.0-omni/transformation` | `video_urls`、可选图片、`prompt`、音频 |
| 参考生视频 | `kling-3.0-omni/reference-to-video` | 最多约 7 张参考图，可配视频、元素和多镜头 |

各模式共有的字段包括 `prompt`、`duration`（3–15 秒）、`resolution=720p|1080p|4k`、`aspect_ratio`、`audio`；多镜头使用互斥的 `customize_multi_shots` / `prefer_multi_shots`，自定义镜头写入最多 6 项的 `multi_prompt`。图生视频首帧 `image_urls` 必须恰好 1 张；视频变换 `video_urls` 必须恰好 1 条，且仅视频输入时 `aspect_ratio=auto`。必须按模式选择 schema，不要把所有字段拼成一个请求体。

### 价格

APIMart 来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。Omni 价格按默认、4K、Pro、视频、声音等模式拆分，最终成本取决于模式、分辨率、音频和时长。

KIE 价格应从 [Kling O3 模型页](https://kie.ai/kling-o3)逐个切换能力读取，而不是只按 `Omni` 精确搜索总定价表：

| KIE 能力 | 720P | 1080P | 4K |
|---|---:|---:|---:|
| 文生/图生，无原生音频 | `$0.070/秒` | `$0.090/秒` | `$0.335/秒` |
| 文生/图生，有原生音频 | `$0.090/秒` | `$0.115/秒` | `$0.335/秒` |
| 视频变换（要求视频输入） | `$0.100/秒` | `$0.135/秒` | `$0.335/秒` |
| 参考生视频，有视频输入 | `$0.100/秒` | `$0.135/秒` | `$0.335/秒` |

参考生视频在无视频输入时沿用文生/图生的有无音频档位。高档充值的额外积分优惠不写入模型基础价。

## 原始链接索引

- [Kling 官方视频能力图](https://www.klingai.com/document-api/guides/capability-map/video)：官方模型 ID、输入类型、时长和分辨率能力。
- [APIMart Kling v3 Omni API](https://docs.apimart.ai/en/api-reference/videos/kling-v3-omni/generation.md)：模型 ID、图片引用语法、视频编辑、模式和互斥约束。
- [APIMart 定价](https://apimart.ai/zh/pricing)：`KLING-V3-OMNI` 价格档位。
- [KIE Kling O3 模型页](https://kie.ai/kling-o3)：`Kling O3` 与 `Kling 3.0 Omni` 的名称映射、四种能力入口和逐模式价格；切换 `API` Tab 可打开对应接口文档。
- [KIE Omni 文生视频](https://docs.kie.ai/market/kling/v3-omni-text-to-video)：文生字段、3–15 秒、分辨率、多镜头与音频。
- [KIE Omni 图生视频](https://docs.kie.ai/market/kling/v3-omni-image-to-video)：首帧图、首尾帧、分辨率与多镜头字段。
- [KIE Omni 视频变换](https://docs.kie.ai/market/kling/v3-omni-transformation)：视频输入约束和自适应比例。
- [KIE Omni 参考生视频](https://docs.kie.ai/market/kling/v3-omni-reference-to-video)：参考图片、视频、元素和多镜头限制。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建与回调。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询与结果。
- [KIE 定价](https://kie.ai/pricing)：公开总定价入口；本模型的完整档位以模型页逐模式价格为准。

## Fal 适配（2026-08-21）

- Fal 使用 O3 路由名承载 Kling 3.0 Omni：`fal-ai/kling-video/o3/{standard|pro}/{text-to-video|image-to-video|reference-to-video}`。这与 KIE 的 “Kling O3” 命名一致。
- 文生支持比例；图生支持首尾帧；参考模式支持多张 `image_urls` 及更复杂的 `elements`。本项目接入文生、首尾帧与图片参考，暂不暴露结构化多镜头/元素对象。
- 公共参数为 `duration=3–15`、`generate_audio`、`shot_type`。Fal 无独立 `resolution` 字段，画布分辨率栏按端点档显示“标准/专业”。
- 价格：标准 `$0.084/$0.112 每秒`，专业 `$0.112/$0.14 每秒`（无/有音频）。
- 来源：[Fal O3 Standard 文档](https://fal.ai/models/fal-ai/kling-video/o3/standard/text-to-video/llms.txt)、[Fal O3 Pro 文档](https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/llms.txt)。
