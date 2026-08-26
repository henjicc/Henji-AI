# Grsai · 供应商基础文档

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 供应商类型 | 聚合中转（转发 Google Nano Banana 系列、OpenAI GPT Image 系列等第三方模型，非模型原厂） |
| 项目内 providerId | `grsai` |
| 控制台域名 | `grsai.ai` 与 `grsai.com` 两个域名，页面结构、数据、API 域名完全一致（互为镜像，可视为同一站点） |
| API 域名 | 全球节点 `grsaiapi.com`；国内直连节点 `grsai.dakka.com.cn`，已接入连通性探测 + 自动切换 |
| 鉴权 | `Authorization: Bearer <API Key>` |
| 任务模型 | 提交接口按 `replyType` 三选一：`json`（同步返回结果）/ `stream`（SSE 流）/ `async`（返回 `task_id`，另起轮询）。本项目在发送边界统一强制 `async`，走轮询模式 |
| 文档可见性 | 公开，无需登录（Apifox 文档站与 dashboard「模型列表」页均可匿名访问） |
| 价格可见性 | 公开，无需登录（dashboard「模型列表」页直接给出每个模型的价格区间） |
| 项目当前状态 | **已接入生成 runtime**（[electron/main/services/ai-runtime/providers/grsai.ts](../../../electron/main/services/ai-runtime/providers/grsai.ts)），已适配 GPT-Image-2 / Nano Banana 2 / Nano Banana 2 Lite / Nano Banana Pro 四个模型的全部渠道，见第 9 节「项目对照」 |

> Grsai 的核心特点是**同一个模型家族在其内部又拆成多个「渠道」**（官方叫法，如 `-cl`、`-vip`、`-vt`、`-lite` 后缀），渠道之间价格差异可达 10 倍以上，越便宜的渠道官方公告历史上出现过越多次限流 / 维护 / 降级事件（见第 8 节）。接入时建议把「渠道」做成模型内的顶层可选参数，而不是把每个渠道拆成独立模型卡片——具体取舍见各模型文档「适配要点」。**本项目只适配 Nano Banana 第 2 代与 Nano Banana Pro 两个家族，初代 Nano Banana 相关的平台模型名已被明确排除，见第 7 节。**

## 1. 端点

### 1.1 Base URL 与节点

官方文档在每个接口页面都重复给出两条节点：

| 节点 | 地址 | 定位 |
|---|---|---|
| 全球节点 | `https://grsaiapi.com` | 海外访问 |
| 国内节点 | `https://grsai.dakka.com.cn` | 国内直连 |

与 APIMart 的「主线路 + 大陆备用域名」不同，Grsai 官方文档没有说明这两条线路是否共享同一套账号 / 任务数据、是否只在故障时切换——**两条线路的关系未实测确认**，接入前需要用同一个 API Key 分别探测两条线路的可用性与数据一致性，再决定是走 APIMart 式「连通性探测 + 记忆」还是简单固定一条。

### 1.2 API 端点一览

**新版统一接口（Apifox 文档站给出，官方在公告中标注为「新文档」，推荐新对接使用）**

| 用途 | 方法与路径 | 说明 |
|---|---|---|
| 生成 | `POST /v1/api/generate` | 图片（文档目录标注含视频，但当前 dashboard 定价列表未见任何视频模型，见第 8 节）统一生成入口，`model` 字段决定具体模型与渠道 |
| 查询结果 | `GET /v1/api/result?id=<task_id>` | 统一异步结果查询，返回结构与生成接口一致 |

**旧版分模型接口（官方声明「永久有效」，字段集合与新接口不完全一致，见第 3.5 节差异）**

| 用途 | 方法与路径 | 说明 |
|---|---|---|
| Nano Banana 系列生成 | `POST /v1/draw/nano-banana` | 早于统一接口的专用入口 |
| GPT Image 系列生成 | `POST /v1/draw/completions` | 多一个新接口没有的 `quality` 参数，见第 3.5 节 |
| Veo3 视频生成 | `POST /v1/video/veo` | 仅在 dashboard 文档导航「Veo API」下出现，未见于「模型大全」定价列表，可用性 / 计费未知，见第 8 节 |
| 旧接口统一结果查询 | `POST /v1/draw/result` | 与 `/v1/api/result` 平行存在，两套接口不要混用 |

**OpenAI 兼容接口（面向能直接换 `base_url` 接入的客户端，文档未详细展开字段，仅作为备选记录）**

| 用途 | 方法与路径 | 说明 |
|---|---|---|
| 对话 / 多模态 | `POST /v1/chat/completions` | 文档写「支持所有模型」；示例模型为纯文本 LLM（`gemini-3.1-pro` 等），不在本项目图片/视频/音频生成范围内 |
| 图片生成 | `POST /v1/images/generations` | 文档写「支持所有图片生成模型」，`model` 传 `gpt-image-2` 等即可，参数与新版统一接口的 `aspectRatio`/`imageSize` 近似但字段名不同（`image`/`size`/`response_format`） |

**账户与状态接口（旧版，路径不带 `base_url` 前缀，直接挂在控制台域名下）**

| 用途 | 方法与路径 | 说明 |
|---|---|---|
| 查询 API Key 积分余额 | `POST /client/openapi/getAPIKeyCredits` | 返回 `data.credits`；文档正文未列出请求体字段，**鉴权方式未确认**（是否走 `Authorization: Bearer` 还是账户登录 `token`），接入前需登录控制台用「生成代码」示例核实 |
| 查询账户积分余额 | `POST /client/openapi/getCredits` | 同上，字段与鉴权方式待确认 |
| 查询模型状态 | `GET /client/common/getModelStatus?model=<modelName>` | 返回 `data.status`（布尔）与 `data.error`（异常时的说明文本） |

## 2. 鉴权

```
Authorization: Bearer <API Key>
```

生成与查询接口的 `Authorization` 头在 OpenAPI 定义里标了 `required: false`，但示例与说明都指向「不带 Key 用不了」，按必填处理。API Key 在 https://grsai.ai/zh/dashboard/api-keys 创建（**需登录**）。

## 3. 提交、轮询与结果（新版统一接口）

### 3.1 提交 `POST /v1/api/generate`

请求体（图片，具体 `model` 枚举见各模型文档）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 必填 | 模型名（含渠道后缀，如 `nano-banana-2-cl`） |
| `prompt` | string | 必填 | 提示词 |
| `images` | array\<string\> | 可选 | 参考图，**支持 base64 与 URL 混填，没有独立上传接口**——图片直接以 base64 或已公开 URL 塞进请求体即可 |
| `aspectRatio` | string | 可选 | 比例，取值集合因模型而异，见各模型文档 |
| `imageSize` | string | 可选 | `1K` / `2K` / `4K`，是否可用取决于渠道，见各模型文档 |
| `replyType` | string | 可选 | `json`（同步等待结果）/ `stream`（SSE 流）/ `async`（立即返回 `task_id`，走轮询）。本项目按 Electron 轮询模式，接入时固定传 `async` |

### 3.2 响应（`json` / `async` 首包共用结构）

```json
{
  "id": "14-5f3cf761-a4bb-486a-8016-77f490998f80",
  "status": "succeeded",
  "progress": 100,
  "results": [{ "url": "https://file1.aitohumanize.com/file/....png" }],
  "error": null
}
```

| 字段 | 说明 |
|---|---|
| `id` | 任务 id，`async` 模式下用它调 `/v1/api/result` |
| `status` | `running`（进行中）/ `violation`（违规，独立终态）/ `succeeded`（成功）/ `failed`（失败） |
| `progress` | 0–100 |
| `results[].url` | 图片 / 视频链接 |
| `error` | 仅失败 / 违规时出现的报错信息 |

`violation` 是与 `failed` 平级的独立终态（内容审核不通过），轮询逻辑要把它当终态处理，不能只判断 `succeeded`/`failed` 两种。公告原文提到「当生成失败时，会返还积分」，`violation` 是否同样返还未在文档中写明。

### 3.3 轮询 `GET /v1/api/result?id=<id>`

参数只有 `id`（query）与 `Authorization`（header），响应结构与 3.2 完全一致，`400` 时同样返回 `{id, status, error}`。

### 3.4 结果链接有效期

新版接口文档未写有效期。旧版 GPT Image 专用接口（`/v1/draw/completions`）文档明确写「结果图片的 URL（有效期为 2 小时）」。两套接口是否共用同一套文件存储、有效期是否一致未验证——**建议按 2 小时保守处理，接入前用真实任务实测确认**。

### 3.5 新旧接口字段差异

| 差异点 | 新版 `/v1/api/generate` | 旧版 `/v1/draw/completions`（仅 GPT Image） |
|---|---|---|
| `quality` 参数 | **没有** | 有：`auto` / `low` / `medium` / `high` |
| `webHook` 回调 | 文档未提及 | 有：不轮询时可用 `webHook` 收异步回调，传 `"-1"` 则立即返回 `id` 转轮询 |
| `shutProgress` | 无 | 有：关闭进度中间态，只回最终结果 |
| 结果字段 `url` | 只在 `results[]` 数组里 | 额外在顶层保留 `url`（等价 `results[0].url`，标注「旧参数，不会废弃」） |

桌面端没有公网回调地址，`webHook` 用不上；`quality` 的缺失是新接口一个实打实的能力缺口，若后续要接 GPT Image 的画质档位，需要用旧接口或等新接口补齐，**接入前需二次确认**。

## 4. 文件上传

**没有独立的图片上传接口。** 生成请求的 `images`（新接口）/ `urls`（旧接口）参数直接接受 base64 编码字符串或已公开的 URL，由 Grsai 服务端自己处理，不需要供应商级别的预上传步骤。这点与 APIMart / KIE 都不同，接入时公共媒体预处理层对 Grsai 可以走「本地图转 base64 直接塞进请求体」，不必调用上传 API。

## 5. 计价与余额

### 5.1 积分与充值折扣

Grsai 用积分计费，dashboard「充值」页给出六档套餐（¥10 起，最高¥999），充值金额越大赠送比例越高：

| 充值金额 | 到账积分（含赠送） |
|---|---|
| ¥10 | 100,000（送 25%） |
| ¥20 | 250,000（送 50%） |
| ¥49 | 750,000（送 60%） |
| ¥99 | 1,600,000（送 80%） |
| ¥499 | 9,000,000（送 100%） |
| ¥999 | 20,000,000 |

据此换算，积分单价区间约为 **¥0.0001/积分（无优惠，小额充值）到 ¥0.00005/积分（¥999 档，约 5 折）**。dashboard「模型列表」页给每个模型标注的价格区间（如 gpt-image-2 的「¥0.03~¥0.06/次」）就是「积分消耗 × 积分单价区间」算出来的，是最权威的价格来源，本轮各模型文档的价格表都来自这里（2026-08-26 实测，未登录可见）。

### 5.2 余额查询

`POST /client/openapi/getAPIKeyCredits` 返回 `{ code, msg, data: { credits } }`；请求体字段与鉴权方式文档正文未写全，**接入前需要登录控制台核实**（见第 1.2 节表格备注）。

## 6. 错误与状态

- 任务状态枚举：`running` / `violation` / `succeeded` / `failed`
- 错误信息在 `error` 字段（string），没有结构化的 `code` / `type` 分类
- 部分接口在失败时返回 HTTP `400`，body 结构与 200 成功响应类似（`{id, status, error}`）
- 文档未提供限流（429）相关说明

## 7. 明确排除的模型（不适配，容易与在售渠道混淆）

| 平台模型名 | 状态 | 排除原因 |
|---|---|---|
| `nano-banana` | 已下架（2026-07-01 公告：谷歌官方下架其底层模型 `gemini-2.5-flash-image`，Grsai 随即下架该模型名） | 属于最早期的「香蕉 1」世代，官方已停售，本来就没有可适配的意义 |
| `nano-banana-fast` | 当前 dashboard「模型列表」页仍在售，**本项目不适配** | 同属「香蕉 1」世代衍生出的命名，2026-07-01 公告显示它在 `nano-banana` 下架后「切换底层模型」，此后实际跑在新的 Gemini 3.1 Lite 底层上。它的积分消耗（440/次）、价格区间（¥0.022~¥0.044/次）与 `nano-banana-2-lite` **完全相同**，两个名字长得像、报价一样，极易在选型或写 schema 时混进来 |

本项目适配范围只有 **Nano Banana 2**（[Nano-Banana-2_Grsai.md](../Nano-Banana-2/Nano-Banana-2_Grsai.md)）、**Nano Banana 2 Lite**（[Nano-Banana-2-Lite_Grsai.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_Grsai.md)）、**Nano Banana Pro**（[Nano-Banana-Pro_Grsai.md](../Nano-Banana-Pro/Nano-Banana-Pro_Grsai.md)）三个家族，`nano-banana` 与 `nano-banana-fast` 不在其中，不要在渠道枚举、价格对照或 schema 里出现这两个名字。以后如果 Grsai dashboard 上出现新的「香蕉 1」世代衍生渠道（例如再切换底层模型后改个新名字），按同样理由排除，不需要重新讨论。

## 8. 已知不确定项

以下几项在真机核实前仍是假设，不代表官方已确认；代码里已按标注的方式处理，未来发现假设不成立时优先改文档、再改代码。

1. **国内节点与全球节点的关系**：是同账号双活线路，还是各自独立环境，未实测。**处理方式**：已实现连通性探测 + 进程内记忆（[grsai-endpoints.ts](../../../electron/main/services/ai-runtime/grsai-endpoints.ts)，与 APIMart 同款策略），只在能证明尚未建立连接时切换，不重放已建立连接后的失败；底层数据是否互通仍未验证。
2. **新版接口结果 URL 有效期**：旧接口写 2 小时，新接口未写，两者是否一致未知。**处理方式**：项目在任务完成时立即把结果下载转存到本地（`saveMediaFromUrl`），不依赖长期持有远程链接，实际风险已被规避。
3. **`replyType: async` 首包与轮询响应字段是否完全一致**：示例数据看起来一致，但没有逐字段的官方说明。**处理方式**：`execute()` 对提交响应做了防御性判断——如果 `status` 已经是 `succeeded` 且带 `results`，直接按完成态返回，不强制走一次多余的轮询。
4. **`getAPIKeyCredits` / `getCredits` 的鉴权方式**：走生成用的 `Authorization: Bearer`，还是账户登录 `token` 字段，文档正文没写清楚。**处理方式**：本轮**没有**接入余额探测（`provider-connection.ts` 的 `PROVIDER_PROBES` 里没有 `grsai` 条目），保持"已保存未校验"，避免拿不确定契约误判用户 Key 状态；接口方法也对不上（余额是 POST，探测框架统一用 GET）。
5. **Veo3（`veo3.1-fast`）是否可用**：只出现在「在线体验/文档」导航的「Veo API」旧版文档里，**没有出现在 dashboard「模型列表」的定价清单中**，说明它可能是未正式计价 / 未上线 / 已下线的状态，不作为可接入模型，仅存档以免下次调研重复发现。
6. **`violation`（违规）终态是否返还积分**：公告只写了 `failed` 会返还，`violation` 未提及，不影响本项目实现（两种状态在轮询里都按终止性失败处理）。

## 9. 项目对照

| 层级 | 位置 |
|---|---|
| 生成执行 / 轮询 | [electron/main/services/ai-runtime/providers/grsai.ts](../../../electron/main/services/ai-runtime/providers/grsai.ts) |
| 双线路探测 | [electron/main/services/ai-runtime/grsai-endpoints.ts](../../../electron/main/services/ai-runtime/grsai-endpoints.ts) |
| Provider 分发注册 | [electron/main/services/ai-runtime/providers/index.ts](../../../electron/main/services/ai-runtime/providers/index.ts) |
| Key 存储 | [electron/main/services/keystore.ts](../../../electron/main/services/keystore.ts) → `KNOWN_AI_PROVIDER_IDS` |
| 启动预热 | [electron/main/index.ts](../../../electron/main/index.ts)（仅在已配置 Key 时触发，不阻塞启动） |
| 前端 Key 元信息 | [src/core/config/providers.ts](../../../src/core/config/providers.ts) |
| 本地图片上传策略 | [electron/main/services/ai-runtime/upload.ts](../../../electron/main/services/ai-runtime/upload.ts)（内联 base64，无独立上传接口） |
| 模型定义 | `src/models/grsai/{gpt-image-2,nano-banana-2,nano-banana-2-lite,nano-banana-pro}.model.ts` |
| 国际化 | `src/i18n/locales/{zh-CN,en-US}/models-grsai.json`、`settings.json` 的 `apiKeys.providers.grsai` |
| 测试 | `electron/main/services/ai-runtime/grsai-endpoints.test.ts`、`electron/main/services/ai-runtime/providers/grsai.test.ts`、`src/models/grsai/model-adaptation-images.test.ts` |

已知欠账（记录在案，不阻塞当前交付）：

- 余额查询未接入（见第 8 节第 4 项），设置页无法显示 Grsai 账户余额，只能显示"已保存"状态。
- 未做真实 API Key 下的端到端联调（本地没有可用的 Grsai Key），当前实现完全基于文档与单元测试验证，接入前建议先用真实任务跑一轮 `npm run assistant:cli` 或手动生成核实请求/响应字段。

## 10. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Apifox 文档总索引（llms.txt） | https://qmy27nhsd9.apifox.cn/llms.txt | 否 |
| nano-banana 接口（新版统一生成，含全部图片模型枚举） | https://qmy27nhsd9.apifox.cn/452392911e0 | 否 |
| gpt-image-2 接口（新版统一生成） | https://qmy27nhsd9.apifox.cn/452409160e0 | 否 |
| 异步生成结果查询接口 | https://qmy27nhsd9.apifox.cn/452409577e0 | 否 |
| OpenAI 兼容 `/v1/chat/completions` | https://qmy27nhsd9.apifox.cn/452418916e0 | 否 |
| OpenAI 兼容 `/v1/images/generations` | https://qmy27nhsd9.apifox.cn/452417029e0 | 否 |
| dashboard 公告（渠道调价 / 模型上下架历史） | https://grsai.com/zh/dashboard/announcements | 否 |
| dashboard 模型大全（当前权威价格与可用性） | https://grsai.com/zh/dashboard/models（同 `grsai.ai/zh/dashboard/models`） | 否 |
| dashboard 充值套餐（积分折扣档位） | https://grsai.com/zh/dashboard/billing | 否 |
| Nano Banana API 旧版文档（`/v1/draw/nano-banana`） | https://grsai.ai/zh/dashboard/documents/nano-banana | 否 |
| GPT Image API 旧版文档（`/v1/draw/completions`，含 `quality` 参数） | https://grsai.ai/zh/dashboard/documents/gpt-image | 否 |
| Veo API 旧版文档（`veo3.1-fast`，未出现在定价列表） | https://grsai.ai/zh/dashboard/documents/veo | 否 |
| 其他接口（账户 / API Key 管理，含余额与模型状态查询） | https://grsai.ai/zh/dashboard/documents/other | 否 |
| API Key 管理 | https://grsai.ai/zh/dashboard/api-keys | **是** |
