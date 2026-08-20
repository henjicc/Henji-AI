# Seedance 2.0 Fast

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 视频 |
| 建议拆分 | 独立模型；不能复用标准版的模型 ID 或价格 |
| 项目默认隐藏 | `seed`、负面提示词；供应商的 `output_format` 默认不显示 |
| 官方接口 | 本清单未提供官方接口链接，按 APIMart/KIE 适配 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `seedance-2.0-fast` | [Seedance 2.0 API](https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md) | 480P `$0.03984/秒`；720P `$0.0856/秒`；参考输入价格见页面 | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `bytedance/seedance-2-fast` | [KIE Seedance 2 Fast](https://docs.kie.ai/cn/market/bytedance/seedance-2-fast.md) | 无视频输入：480P `$0.059/秒`、720P `$0.124/秒`；有视频输入：480P `$0.034/秒`、720P `$0.075/秒` | 价格与 API 文档无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；使用 Bearer API Key。
- `model=seedance-2.0-fast`。与标准版共用请求形态：文生视频、首尾帧、参考图/视频/音频、音频生成和返回最后一帧。成功视频读取 `data.result.videos[].url[]`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填 |
| `duration` | number | 默认 5 秒 |
| `size` | 比例 | 默认 `16:9` |
| `resolution` | `480p`、`720p` | 本次价格页核实到这两个 Fast 档位；不要默认开放 1080p/4K |
| `generate_audio` | boolean | 默认 `true` |
| `image_urls` / `image_with_roles` | URL 数组/结构化数组 | 首帧、尾帧或参考图 |
| `video_urls` / `audio_urls` | URL 数组 | 参考视频、音频 |
| `return_last_frame` / `tools` | boolean / 数组 | 平台能力，默认按 schema 配置 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。Fast 价格独立于标准版；输出按秒计费，参考输入另计。若未来价格页增加其他分辨率，应以实时页面更新模型价格配置。

## KIE 适配

- Base URL `https://api.kie.ai`；创建 `POST /api/v1/jobs/createTask`，`model=bytedance/seedance-2-fast`，返回 `data.taskId`。
- 查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`；成功后 JSON.parse `data.resultJson` 读取 `resultUrls`。可选 `callBackUrl` 接收完成回调。
- KIE 页面列出的字段包括 `prompt`、首帧/尾帧、参考图/视频/音频、`generate_audio`、`resolution`、`aspect_ratio`、`duration`、`return_last_frame` 等。Fast 常用分辨率为 480p/720p，具体以页面枚举校验。
- KIE 价格按“是否有视频输入”拆分；有视频输入时应按平台说明计入输入视频时长。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [APIMart Seedance 2.0 API](https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md)：Fast 与同系列请求字段。
- [APIMart 定价](https://apimart.ai/zh/pricing)：Fast 价格。
- [KIE Seedance 2 Fast](https://docs.kie.ai/cn/market/bytedance/seedance-2-fast.md)：KIE 模型 ID 和字段。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：创建与回调。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：查询与结果。
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `seedance`。
