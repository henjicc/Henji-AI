# Grok Imagine 2.0

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个通用模型；APIMart 仅文生图，KIE 有文生图、Segment Map、图片编辑三条链路，应使用显式 `mode` 路由 |
| 项目默认隐藏 | `seed`、负面提示词；`response_format` 固定为 URL，不作为用户选项 |
| 官方接口 | 本清单未提供 Grok Imagine 2.0 官方接口链接，仅核查 APIMart/KIE |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `grok-imagine-2.0-ext` | [Grok Imagine 2.0 API](https://docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/generation.md) | 当前实时价格 `$0.015/张`；生成文档中的 `$0.08/张` 为未同步旧值 | 文档、价格页与价格查询接口公开；生成需要 API Key |
| KIE | 支持；模型广场显示名为 `Grok Imagine Image 2.0` | `grok-imagine-image-2-0/text-to-image`、`segment-map`、`image-edit` | [Grok 模型页](https://kie.ai/grok-imagine-image-2)及页面 `API` Tab；[文生图](https://docs.kie.ai/market/grok-imagine-image-2-0/text-to-image)、[分割图](https://docs.kie.ai/market/grok-imagine-image-2-0/segment-map)、[图片编辑](https://docs.kie.ai/market/grok-imagine-image-2-0/image-edit) | 文生图/图片编辑 `$0.02/张`；Segment Map 免费 | 模型页、API Tab 与价格均公开，无需登录；实际调用需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；提交 `POST /v1/images/generations`；轮询 `GET /v1/tasks/{task_id}?language=en`；使用 Bearer API Key。
- 请求建议增加 `X-APIMart-Response-Version: 2026-07-27`；建议增加唯一 `Idempotency-Key` 防止重复生成。成功 HTTP 状态为 202，任务 ID 在 `data.id`，兼容旧响应中的 `data[0].task_id`。
- 成功结果读取 `data.result.images`；图片链接约 72 小时有效。失败读取 `data.error`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `model` | `grok-imagine-2.0-ext` | 固定模型 ID |
| `prompt` | string | 必填；生成或区域编辑提示词 |
| `n` | integer `1–12` | 输出数量 |
| `size` | `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`9:16`、`16:9` 及文档列出的像素别名 | 只使用 API 文档白名单 |
| `resolution` | `quality` | 该字段是平台质量档位，不把它转换为通用 1K/2K/4K 枚举 |
| `image_urls` | 不支持 | 不要把其他模型的图生图字段复用到本模型 |
| `response_format` | `url` | 平台固定返回 URL，默认不显示 |
| `seed` / 负面提示词 | — | 项目约定：绝对不显示、不请求 |

### 价格校准

生成文档的 Billing 仍写 `$0.08/张`，但 [APIMart 定价中心](https://apimart.ai/zh/pricing)显示 `$0.015/张`；无鉴权价格接口 `GET https://api.apimart.ai/api/pricing/model?model=grok-imagine-2.0-ext` 返回列表价 `$0.01875` 和 20% 折扣，对应实付 `$0.015`。因此本次按实时价格中心/价格接口采用 `$0.015/张`，并把生成文档的 `$0.08` 标记为未同步旧值。

## KIE 适配

- Base URL `https://api.kie.ai`；三条能力均提交 `POST /api/v1/jobs/createTask`，返回 `data.taskId`；查询 `GET /api/v1/jobs/recordInfo?taskId={taskId}`。
- 专属内容入口是 [KIE Grok 模型页](https://kie.ai/grok-imagine-image-2)。页面内切换 `Text To Image`、`Segment Map`、`Image Edit` 后，再切换 `API` Tab，分别加载三份真实接口文档；不能只查文档首页或总价格表。
- 文生图：`model=grok-imagine-image-2-0/text-to-image`；`input.prompt` 和 `input.aspect_ratio` 必填，比例为 `1:1|2:3|3:2|16:9|9:16`。
- Segment Map：`model=grok-imagine-image-2-0/segment-map`；`input` 二选一传已有 `task_id` 或 `image_url`；结果 JSON 读取 `resultObject.segments_count` 与 `resultObject.segments[]`。
- 图片编辑：`model=grok-imagine-image-2-0/image-edit`；`input.prompt`、`input.task_id` 必填，可传 `mask_indexs` 指定分割区域。`task_id` 可来自文生图任务或 Segment Map 任务。
- 成功任务的普通图片结果从 JSON.parse `data.resultJson` 后读取 `resultUrls`；生产环境建议配置 `callBackUrl`。
- KIE 模型页逐模式显示：文生图与图片编辑均为 4 credits，即 `$0.02/张`；切换到 Segment Map 时页面明确显示免费。来源：[KIE Grok 模型页](https://kie.ai/grok-imagine-image-2)。

## 原始链接索引

- [APIMart Grok Imagine 2.0 API](https://docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/generation.md)：模型 ID、请求字段、版本头、轮询与 Billing。
- [APIMart 定价](https://apimart.ai/zh/pricing)：当前实付价格；生成文档 Billing 未同步。
- [APIMart 实时价格查询](https://api.apimart.ai/api/pricing/model?model=grok-imagine-2.0-ext)：公开接口，返回列表价和折扣信息。
- [KIE Grok 模型页](https://kie.ai/grok-imagine-image-2)：三种能力入口、模型别名、逐模式价格和 `API` Tab。
- [KIE Grok 2.0 文生图](https://docs.kie.ai/market/grok-imagine-image-2-0/text-to-image)：文生图模型 ID 与字段。
- [KIE Grok 2.0 Segment Map](https://docs.kie.ai/market/grok-imagine-image-2-0/segment-map)：任务/图片分割输入与结果结构。
- [KIE Grok 2.0 图片编辑](https://docs.kie.ai/market/grok-imagine-image-2-0/image-edit)：编辑模型 ID、任务依赖和掩码索引。
- [KIE 创建任务](https://docs.kie.ai/cn/common-api/quickstart.md)：通用创建协议。
- [KIE 查询任务](https://docs.kie.ai/cn/market/common/get-task-detail.md)：通用轮询协议。
- [KIE 定价](https://kie.ai/pricing)：公开总定价入口；文生图和图片编辑价格也可在此交叉核对。
