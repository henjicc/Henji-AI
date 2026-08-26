# Grsai · 供应商基础文档

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 供应商类型 | 聚合中转（转发 Google Nano Banana 系列、OpenAI GPT Image 系列等第三方模型，非模型原厂） |
| 项目内 providerId（拟定，尚未接入代码） | `grsai` |
| 控制台域名 | `grsai.ai` 与 `grsai.com` 两个域名，页面结构、数据、API 域名完全一致（互为镜像，可视为同一站点） |
| API 域名 | 全球节点 `grsaiapi.com`；国内直连节点 `grsai.dakka.com.cn` |
| 鉴权 | `Authorization: Bearer <API Key>` |
| 任务模型 | 提交接口按 `replyType` 三选一：`json`（同步返回结果）/ `stream`（SSE 流）/ `async`（返回 `task_id`，另起轮询） |
| 文档可见性 | 公开，无需登录（Apifox 文档站与 dashboard「模型列表」页均可匿名访问） |
| 价格可见性 | 公开，无需登录（dashboard「模型列表」页直接给出每个模型的价格区间） |
| 项目当前状态 | **仅完成本轮 API / 价格调研文档，尚未接入生成 runtime**（无 `electron/main/services/ai-runtime/providers/grsai.ts`，无 `.model.ts`），本文件与下述模型文档只作为后续实现的资料源 |

> Grsai 的核心特点是**同一个模型家族在其内部又拆成多个「渠道」**（官方叫法，如 `-cl`、`-vip`、`-vt`、`-lite`、`-fast` 后缀），渠道之间价格差异可达 10 倍以上，越便宜的渠道官方公告历史上出现过越多次限流 / 维护 / 降级事件（见第 7 节）。接入时建议把「渠道」做成模型内的顶层可选参数，而不是把每个渠道拆成独立模型卡片——具体取舍见各模型文档「适配要点」。

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
| 生成 | `POST /v1/api/generate` | 图片（文档目录标注含视频，但当前 dashboard 定价列表未见任何视频模型，见第 7 节）统一生成入口，`model` 字段决定具体模型与渠道 |
| 查询结果 | `GET /v1/api/result?id=<task_id>` | 统一异步结果查询，返回结构与生成接口一致 |

**旧版分模型接口（官方声明「永久有效」，字段集合与新接口不完全一致，见第 3.5 节差异）**

| 用途 | 方法与路径 | 说明 |
|---|---|---|
| Nano Banana 系列生成 | `POST /v1/draw/nano-banana` | 早于统一接口的专用入口 |
| GPT Image 系列生成 | `POST /v1/draw/completions` | 多一个新接口没有的 `quality` 参数，见第 3.5 节 |
| Veo3 视频生成 | `POST /v1/video/veo` | 仅在 dashboard 文档导航「Veo API」下出现，未见于「模型大全」定价列表，可用性 / 计费未知，见第 7 节 |
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

## 7. 已知不确定项（接入前需要逐条确认，不建议直接照搬实现）

1. **国内节点与全球节点的关系**：是同账号双活线路，还是各自独立环境，未实测。
2. **新版接口结果 URL 有效期**：旧接口写 2 小时，新接口未写，两者是否一致未知。
3. **`replyType: async` 首包与轮询响应字段是否完全一致**：示例数据看起来一致，但没有逐字段的官方说明。
4. **`getAPIKeyCredits` / `getCredits` 的鉴权方式**：走生成用的 `Authorization: Bearer`，还是账户登录 `token` 字段，文档正文没写清楚。
5. **Veo3（`veo3.1-fast`）是否可用**：只出现在「在线体验/文档」导航的「Veo API」旧版文档里，**没有出现在 dashboard「模型列表」的定价清单中**，说明它可能是未正式计价 / 未上线 / 已下线的状态，本轮不建议作为可接入模型记录，仅在此存档以免下次调研重复发现。
6. **`violation`（违规）终态是否返还积分**：公告只写了 `failed` 会返还，`violation` 未提及。

## 8. 项目对照

尚未接入。后续若确认要做，按 `docs/rules/model-adaptation.md` 场景 A「新增供应商」流程：新建 `electron/main/services/ai-runtime/providers/grsai.ts`、在 `providers/index.ts` 注册分发、在 `keystore.ts` 的 `KNOWN_AI_PROVIDER_IDS` 与 `src/core/config/providers.ts` 补齐元信息、按需接入国际化文案。

## 9. 原始链接索引

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
