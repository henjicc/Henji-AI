# Seedream 5.0 Pro

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个模型；无图/有图自动路由；图层拆分作为独立能力分支，不与普通出图混发 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示且不请求 |
| 官方接口 | 火山方舟（已核查） |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| 火山方舟（官方） | 支持 | 官方 Endpoint ID 以控制台模型列表为准 | [图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh) | 本次页面未提取到价格 | 正文本次可见；调用需要 API Key |
| APIMart | 支持 | `seedream-5-0-pro` | [Seedream-5.0-Pro API](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md) | 约 `$0.02928–$0.05856/张`；图层档约 `$0.01464–$0.02928/张` | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `seedream/5-pro-text-to-image`、`seedream/5-pro-image-to-image`、`seedream/5-pro-layer-decomposition` | [文生图](https://docs.kie.ai/cn/market/seedream/5-pro-text-to-image.md)、[图片编辑](https://docs.kie.ai/cn/market/seedream/5-pro-image-to-image.md)、[图层拆分](https://docs.kie.ai/41313512e0.md) | 普通生成 1K `$0.035/张`、2K `$0.07/张`；图层拆分 1K/1.5K `$0.035/张`、2K `$0.07/张`；额外输入图 `$0.0025/张`（首张免费） | 价格与 API 文档无需登录；实际调用需要 API Key |

## 适配结论

- 普通生成合并为一个模型：0 张参考图选文生图，1–10 张选图生图。Pro 是单图模型，普通端点不要发送 `n>1`。
- 图层拆分与普通生成的核心字段、返回结构不同：若产品要支持，应设计显式 mode/独立能力；否则先只适配普通文生图与图生图。
- APIMart 的 `resolution` 为 `1K` / `1.5K` / `2K` 或精确 `size`；KIE 用 `quality=basic/high` 映射 1K/2K。

## APIMart 适配

- Base URL：`https://api.apimart.ai`；提交 `POST /v1/images/generations`；鉴权使用 Bearer API Key。
- `model` 固定 `seedream-5-0-pro`；`prompt` 必填；轮询 `GET /v1/tasks/{task_id}`。
- 成功读取 `data.result.images[].url[]`；失败读取 `data.error.message`。普通生成预计 1K 约 90 秒、2K 约 160 秒，建议每 5–10 秒轮询并把客户端超时设为 5 分钟。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填 |
| `resolution` | `1K`、`1.5K`、`2K` | 价格按档位；1.5K 适合在质量与成本间折中 |
| `size` | 比例或精确像素 | 支持 `auto`、`1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`、`21:9`，也可传像素 |
| `image_urls` | URL 数组 | 普通图生图最多 10 张；多图参考生图也最多 10 张 |
| `background` | `opaque` / `transparent` | 透明背景相关场景才发送 |
| `layer_decomposition` | boolean | 图层拆分时为 true；会改变结果数组和计费，不要默认发送 |
| `optimize_prompt_options` | object | 仅在启用提示词优化时发送 |
| `watermark` | boolean | 文档默认 false；按产品策略决定 |
| `n` | integer | 普通 Pro 端点固定单图，不显示、不请求 |
| `output_format` | `jpeg` / `png` | 项目默认不显示且不请求 |

### 价格

APIMart 定价页显示：默认 `$0.036/张`、1K `$0.02928/张`、2K `$0.05856/张`；图层拆分 1K-layer `$0.01464/张`、2K-layer `$0.02928/张`。来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。

## KIE 适配

- Base URL `https://api.kie.ai`；提交 `POST /api/v1/jobs/createTask`，请求 `{ model, callBackUrl?, input }`。
- 无图：`model=seedream/5-pro-text-to-image`；有图：`model=seedream/5-pro-image-to-image`，`input.image_urls` 最多 10 张。
- `input` 普通字段为 `prompt`、`aspect_ratio`、`quality`、`output_format`；比例为 `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9`，`quality` 为 `basic` / `high`。
- 图层拆分：`model=seedream/5-pro-layer-decomposition`，字段为 `prompt`、单张 `image_url`、`size`、`output_format`；返回 `resultUrls` 与图层元数据，不能按普通单图 URL 解析。
- 任务：创建返回 `data.taskId`；查询 `GET /api/v1/jobs/recordInfo?taskId=...`；`state=success` 后 JSON.parse `resultJson`，普通结果看 `resultUrls`。
- KIE 公开定价页可直接搜索 `seedream` 查看普通生成、图层拆分和额外输入图价格，无需登录。来源：[KIE 定价](https://kie.ai/pricing)。

## 官方适配参考

火山方舟统一使用 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`。官方页面明确列出 Pro 的单图/多图生图、交互编辑、图层拆分、`image`、`layer_decomposition`、`size`、`background`、`response_format`、`watermark` 等字段，并提醒 Pro 不支持组图生成。来源：[火山方舟图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh)。

## 原始链接索引

- [火山方舟官方 API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh)
- [APIMart Pro API](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md)
- [APIMart 定价](https://apimart.ai/zh/pricing)
- [KIE Pro 文生图](https://docs.kie.ai/cn/market/seedream/5-pro-text-to-image.md)
- [KIE Pro 图片编辑](https://docs.kie.ai/cn/market/seedream/5-pro-image-to-image.md)
- [KIE Pro 图层拆分](https://docs.kie.ai/41313512e0.md)
- [KIE 任务详情](https://docs.kie.ai/cn/market/common/get-task-detail.md)
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `seedream` 获取 Pro 各档价格。
