# Nano Banana 2 Lite · Grsai

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | Grsai（聚合中转，详见 [Grsai 基础文档](../供应商/Grsai.md)） |
| 平台模型 ID（渠道） | `nano-banana-2-lite`（只有这一个渠道，见下方排除说明） |
| 接口形态 | 提交 `POST /v1/api/generate` + 轮询 `GET /v1/api/result`（新版统一接口，`replyType` 三选一） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（dashboard「模型列表」页） |
| 项目当前状态 | 仅完成调研文档，未接入代码 |

> 本项目把 Nano Banana 2 Lite 当作独立产品模型（`canonicalModelId: nano-banana-2-lite`），与 [Nano Banana 2](../Nano-Banana-2/Nano-Banana-2_Grsai.md) 主模型分开建档，这个 Grsai 平台模型名原本记录在 Nano Banana 2 的 Grsai 文档里，现拆分到本文件，与 APIMart / KIE 的文档结构保持一致。

## 1. `nano-banana-fast` 已被明确排除，不要与本模型混淆

dashboard「模型列表」页还有一个 `nano-banana-fast`，积分消耗（440/次）、价格区间（¥0.022~¥0.044/次）、能力标签都与 `nano-banana-2-lite` **完全相同**，非常容易被当成同一个模型的两个入口收进 schema。

**它不是 Nano Banana 2 Lite，本项目不适配它**：`nano-banana-fast` 属于最早期「香蕉 1」世代的命名——2026-07-01 公告显示，谷歌官方下架 `gemini-2.5-flash-image`（香蕉 1）后，Grsai 下架了 `nano-banana`，`nano-banana-fast` 这个名字保留了下来并「切换底层模型」，此后实际跑在新的 Gemini 3.1 Lite 底层上，只是名字还留着旧世代的痕迹。本项目适配范围只到 Nano Banana 第 2 代与 Nano Banana Pro，不包含初代「香蕉」体系的任何遗留命名。完整排除记录见 [Grsai 基础文档 §7](../供应商/Grsai.md)。

后续调研如果发现价格/规格与 `nano-banana-2-lite` 一样接近的新名字，先去 Grsai 基础文档 §7 确认是否已经记录过，不要重复讨论是否该收进来。

## 2. 请求参数（新版统一接口）

`POST /v1/api/generate`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 必填 | `nano-banana-2-lite` |
| `prompt` | string | 必填 | 提示词 |
| `images` | array\<string\> | 可选 | 参考图，base64 或 URL 混填，无需单独上传 |
| `aspectRatio` | string | 可选 | 通用 11 档（`auto`/`1:1`/`16:9`/`9:16`/`4:3`/`3:4`/`3:2`/`2:3`/`5:4`/`4:5`/`21:9`）；极端比例（`1:4`/`4:1`/`1:8`/`8:1`）文档标注为「nano-banana-2 系列额外支持」，Lite 是否包含在内未逐渠道验证 |
| `imageSize` | string | 可选 | dashboard 页面未给这个渠道标注分辨率档位标签，推断只输出默认档（类比 APIMart/KIE 的 Lite 均固定 1K），**接入前需实测确认传 `2K`/`4K` 时是报错还是静默降级** |
| `replyType` | string | 可选 | `json` / `stream` / `async` |

## 3. 价格

来源：[dashboard 模型列表](https://grsai.com/zh/dashboard/models)（2026-08-26 实测，未登录可见）。价格区间由「积分消耗 × 积分单价区间」得出，详见 [Grsai 基础文档 §5.1](../供应商/Grsai.md)。

| 渠道 | 积分消耗 | 价格区间 | 支持分辨率 |
|---|---|---|---|
| `nano-banana-2-lite` | 440/次 | ¥0.022~¥0.044/次 | 未标注（推断仅默认档） |

作为对照，同为 Lite 定位的其他供应商价格：APIMart EXT 渠道 **$0.0125/张**（约¥0.09，2026-08-22 汇率粗算）、KIE **$0.02/张**（约¥0.14）。Grsai 的 ¥0.022~¥0.044 区间在同类里明显更低，与「渠道更便宜」的定位一致。

## 4. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本渠道没有这两个字段。
- **不要把 `nano-banana-fast` 收进本模型的渠道枚举**，它属于已排除的初代「香蕉」命名，见第 1 节与 [Grsai 基础文档 §7](../供应商/Grsai.md)。
- 分辨率参数在本渠道上的真实行为（报错 / 静默降级 / 直接忽略）需要实测，不要照抄主模型的 `imageSize` 选项集合。
- 与 [Nano Banana 2 主模型的 Grsai 文档](../Nano-Banana-2/Nano-Banana-2_Grsai.md) 共享同一套响应结构、状态枚举、结果链接有效期等不确定项，见 [Grsai 基础文档](../供应商/Grsai.md) 第 3、8 节，不在本文件重复。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| nano-banana 接口（新版统一生成，含渠道枚举与比例说明） | https://qmy27nhsd9.apifox.cn/452392911e0 | 否 |
| 异步生成结果查询接口 | https://qmy27nhsd9.apifox.cn/452409577e0 | 否 |
| Nano Banana API 旧版文档 | https://grsai.ai/zh/dashboard/documents/nano-banana | 否 |
| dashboard 模型列表（当前权威价格） | https://grsai.com/zh/dashboard/models | 否 |
| dashboard 公告（`nano-banana-fast` 排除依据的来源公告） | https://grsai.com/zh/dashboard/announcements | 否 |
| API Key 管理 | https://grsai.ai/zh/dashboard/api-keys | **是** |
