# Nano Banana 2 Lite · Grsai

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | Grsai（聚合中转，详见 [Grsai 基础文档](../供应商/Grsai.md)） |
| 平台模型 ID（渠道） | `nano-banana-2-lite`、`nano-banana-fast`（两者规格与价格完全相同，关系未确认，见下） |
| 接口形态 | 提交 `POST /v1/api/generate` + 轮询 `GET /v1/api/result`（新版统一接口，`replyType` 三选一） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（dashboard「模型列表」页） |
| 项目当前状态 | 仅完成调研文档，未接入代码 |

> 本项目把 Nano Banana 2 Lite 当作独立产品模型（`canonicalModelId: nano-banana-2-lite`），与 [Nano Banana 2](../Nano-Banana-2/Nano-Banana-2_Grsai.md) 主模型分开建档，这两个 Grsai 平台模型名原本记录在 Nano Banana 2 的 Grsai 文档里，现拆分到本文件，与 APIMart / KIE 的文档结构保持一致。

## 1. 两个平台模型名的关系（未完全确认）

dashboard「模型列表」页把 `nano-banana-2-lite` 和 `nano-banana-fast` 列为两个独立条目，但**积分消耗（440/次）、价格区间（¥0.022~¥0.044/次）、能力标签（仅「文生图」「图生图」，无分辨率档位标签）完全相同**。公告历史给出一点线索：2026-07-01 公告「谷歌官方下架 gemini-2.5-flash-image（香蕉1）模型……下架模型 nano-banana，切换底层模型 na[no-banana-fast]」（原文在页面截断，未看到完整句子），暗示 `nano-banana-fast` 是旧款「香蕉 1」体系里保留下来的名字，事件后切换到了新的 Gemini 3.1 Lite 底层模型；而 `nano-banana-2-lite` 是随 Nano Banana 2 一起上线的新命名。

**两者是否指向同一个后端实现，还是历史遗留的两个独立入口，Grsai 官方文档没有正面说明，接入前必须实测确认**：可以用同一个 prompt 分别调用两个 model 名，比较返回结果的图像风格、耗时、错误信息是否一致。如果确认等价，产品上只需要保留一个作为「渠道」选项；如果存在细微差异（例如審核策略、限流阈值不同），需要都保留并在文案里说明差别。

## 2. 请求参数（新版统一接口）

`POST /v1/api/generate`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 必填 | `nano-banana-2-lite` 或 `nano-banana-fast` |
| `prompt` | string | 必填 | 提示词 |
| `images` | array\<string\> | 可选 | 参考图，base64 或 URL 混填，无需单独上传 |
| `aspectRatio` | string | 可选 | 通用 11 档（`auto`/`1:1`/`16:9`/`9:16`/`4:3`/`3:4`/`3:2`/`2:3`/`5:4`/`4:5`/`21:9`）；极端比例（`1:4`/`4:1`/`1:8`/`8:1`）文档标注为「nano-banana-2 系列额外支持」，Lite 是否包含在内未逐渠道验证 |
| `imageSize` | string | 可选 | dashboard 页面未给这两个渠道标注分辨率档位标签，推断只输出默认档（类比 APIMart/KIE 的 Lite 均固定 1K），**接入前需实测确认传 `2K`/`4K` 时是报错还是静默降级** |
| `replyType` | string | 可选 | `json` / `stream` / `async` |

## 3. 价格

来源：[dashboard 模型列表](https://grsai.com/zh/dashboard/models)（2026-08-26 实测，未登录可见）。价格区间由「积分消耗 × 积分单价区间」得出，详见 [Grsai 基础文档 §5.1](../供应商/Grsai.md)。

| 渠道 | 积分消耗 | 价格区间 | 支持分辨率 |
|---|---|---|---|
| `nano-banana-2-lite` | 440/次 | ¥0.022~¥0.044/次 | 未标注（推断仅默认档） |
| `nano-banana-fast` | 440/次 | ¥0.022~¥0.044/次 | 未标注（推断仅默认档） |

作为对照，同为 Lite 定位的其他供应商价格：APIMart EXT 渠道 **$0.0125/张**（约¥0.09，2026-08-22 汇率粗算）、KIE **$0.02/张**（约¥0.14）。Grsai 的 ¥0.022~¥0.044 区间在同类里明显更低，与「渠道更便宜」的定位一致。

## 4. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。两个渠道文档都没有这两个字段。
- **先实测澄清 `nano-banana-2-lite` 与 `nano-banana-fast` 的关系**（见第 1 节），不要在 schema 里同时注册两个看起来重复的选项而不做说明。
- 分辨率参数在这两个渠道上的真实行为（报错 / 静默降级 / 直接忽略）需要实测，不要照抄主模型的 `imageSize` 选项集合。
- 与 [Nano Banana 2 主模型的 Grsai 文档](../Nano-Banana-2/Nano-Banana-2_Grsai.md) 共享同一套响应结构、状态枚举、结果链接有效期等不确定项，见 [Grsai 基础文档](../供应商/Grsai.md) 第 3、7 节，不在本文件重复。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| nano-banana 接口（新版统一生成，含渠道枚举与比例说明） | https://qmy27nhsd9.apifox.cn/452392911e0 | 否 |
| 异步生成结果查询接口 | https://qmy27nhsd9.apifox.cn/452409577e0 | 否 |
| Nano Banana API 旧版文档 | https://grsai.ai/zh/dashboard/documents/nano-banana | 否 |
| dashboard 模型列表（当前权威价格） | https://grsai.com/zh/dashboard/models | 否 |
| dashboard 公告（`nano-banana-fast` 底层模型切换历史） | https://grsai.com/zh/dashboard/announcements | 否 |
| API Key 管理 | https://grsai.ai/zh/dashboard/api-keys | **是** |
