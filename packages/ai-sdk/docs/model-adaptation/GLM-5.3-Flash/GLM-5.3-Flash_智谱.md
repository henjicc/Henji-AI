# GLM-5.3-Flash · 智谱

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 模态 | 原生多模态 LLM/VLM：文本、图片、视频、文件输入 → 文本输出 |
| 供应商 / 项目 provider family | 智谱国内 BigModel + 国际 Z.AI / `bigmodel` |
| 平台模型 ID | `glm-5.3-flash` |
| API 协议 | OpenAI 兼容 Chat Completions；同步 JSON / SSE |
| API / 价格资料 | 公开无需登录；API Key 与真实调用需登录/付费 |
| 适配状态 | 仅完成官方资料；SDK 尚未登记；完整能力受第 10 节冲突项阻断 |

## 1. 身份与边界

GLM-5.3-Flash 是 2026-08-26 上线的 GLM-5 系列首个原生多模态模型，是既有
`bigmodel` 供应商族下的**新增独立模型**。它不是文本模型 `glm-5.3` 的别名，也不触发供应商
重命名。国内 BigModel 与国际 Z.AI 都正式提供该模型，展示名均为 `GLM-5.3-Flash`，API
Model Code 均为小写 `glm-5.3-flash`；公开资料没有第二个模型 alias。

当前仓库的 `bigmodel` preset 使用 `open.bigmodel.cn` 和国内 API Key 页面，因此它是国内配置，
不是国际站配置。`Z.AI` 是国际 endpoint profile，不应被当成现有 providerId 的别名直接换域名。

## 2. 端点与鉴权

| endpoint profile | Chat Completions 端点 | API Key 管理 | 账号 / 凭据边界 |
|---|---|---|---|
| `cn` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `https://bigmodel.cn/usercenter/proj-mgmt/apikeys` | 国内 BigModel；现有 preset 与存量 `bigmodel` 凭据归此 profile |
| `global` | `https://api.z.ai/api/paas/v4/chat/completions` | `https://z.ai/manage-apikey/apikey-list` | 国际 Z.AI；需要独立配置槽，不复用国内 key |

两者均使用 `Authorization: Bearer <API Key>` 与 JSON。两个官方 Quick Start 分别要求到各自平台注册/
登录并创建 Key；官方没有说明账号、余额或 API Key 可以跨区互通。本项目不读取/试投用户真实 key，
因此互通性保持“未知”，实现必须按不互通处理。

两区模型页都只链接 Chat Completions。国内相同供应商的 `glm-5.3` 另有 Responses 与 Anthropic 协议，
不能据此外推 Flash。订阅过 GLM Coding Plan（含过期）的账号还可能被限制为只能使用 Chat Completions。

## 3. 能力与限制

| 能力 | 官方值 / 结论 |
|---|---|
| 输入 | text / image / video / file |
| 输出 | text；未确认 audio 输入或输出 |
| 上下文 | 1,000,000 tokens |
| 最大输出 | 131,072 tokens |
| 思考 | 强制开启；`reasoning_effort=low/high/max`，默认 max |
| 流式 | SSE，文本/思考增量、最终 usage、`[DONE]` |
| 工具 | Function Calling；最多 128 个工具；仅确认 `tool_choice=auto` |
| 缓存 | 支持；标准 API 保留跨轮思考需显式 `clear_thinking=false` |
| 结构化输出 | 官方页面相互冲突，暂不得登记，见第 10 节 |

推荐请求参数：`temperature=1`、`top_p=0.95`、`reasoning_effort=max`、
`thinking={"type":"enabled"}`。官方建议不要同时调整 temperature 与 top_p；`max_tokens`
最大 131072，建议不低于 1024；`stop` 最多 4 个字符串。

## 4. 多模态请求

### 图片

```json
{"type":"image_url","image_url":{"url":"<host supplied URL or data URL>"}}
```

- 支持公网 URL 或 Base64 Data URL。
- 单张 <5 MB、最大 6000×6000，JPG/PNG/JPEG，最多 50 张。
- 消费界面不得提供媒体 URL 文本框；URL/Base64 必须来自宿主媒体选择、上传或转换链路。

### 视频

```json
{"type":"video_url","video_url":{"url":"<host supplied URL>"}}
```

- 官方 Chat 示例确认 URL；单文件 ≤200 MB，MP4/MKV/MOV。
- 官方没有给出 Flash 的视频时长上限或视频 Base64 写法，保持未知。

### 文件

- 推荐内容块类型 `file`；旧 `file_url` 类型仍可用但不推荐。
- `file_id` / `file_url` / `file_data` 三选一；单文件 ≤50 MB，最多 50 个文件。
- `file_data` 是带 MIME 的 Base64 Data URL；`file_url` 文档列举 PDF/TXT/Word/JSONL/XLSX/PPTX 等。
- Chat 文档说 `file_id` 来自文件上传接口，但 Files API 的 `purpose` 只列 `batch`、
  `code-interpreter`、`agent`、`voice-clone-input`，没有 Chat 用途，不能猜测。

官方没有说明图片、视频、文件能否跨模态混合，也没有给出混合总数量/体积上限。既不能套用
`glm-5v-turbo` 的互斥限制，也不能反向假设 Flash 可任意混合。

## 5. 思考与工具调用

- `thinking.type` 只能为 `enabled`，不能关闭。
- `reasoning_effort`：low / high / max，默认 max。
- 标准 API 默认清除历史思考；若保留跨轮思考，显式传 `thinking.clear_thinking=false`。
- 交错思考的工具续轮必须回传上一轮完整、原序的 `reasoning_content`、assistant tool calls，
  再附带包含 `tool_call_id` 的 role=tool 消息。
- 工具由宿主执行，不是模型或 SDK transport 代执行。
- 模型页建议 `stream=true` + `tool_stream=true`，但 Vision OpenAPI 未暴露 `tool_stream`，
  通用支持模型清单也没有 Flash。普通 Function Calling 已确认，专有工具流优化仍阻断。

## 6. Chat Completions 事件契约矩阵

| 事件 / 响应 | 前置状态 | required / optional / nullable | 空值 / 缺字段语义 | 状态迁移、输出、副作用 | 终态 / 连接 |
|---|---|---|---|---|---|
| 非流式成功 | 请求已发送 | `choices`；message.content 在工具调用时可 null；reasoning/tool_calls/usage 按场景可选 | 有工具调用但无文本合法 | 发出非空文本/思考；收集工具与 usage | HTTP 终态，消费后释放 |
| SSE 普通增量 | 流已建立 | choices 可缺失/为空；delta.content/reasoning_content/tool_calls 均可选，content 可 null/空串 | 空块与无 choices 块合法，忽略 | 非空文本/思考按序追加 | 非终态，保持连接 |
| SSE 工具增量 | 工具参数未完成 | tool_calls 分片含 index；id/函数名/arguments 可跨块 | 单片不完整合法 | 按 index 拼接；此时不执行工具 | 非终态，保持连接 |
| SSE 完成块 | 已有零到多个增量 | finish_reason 只在最终块；content 可空；usage 通常只在最终块 | 空文本+finish+usage 合法；纯工具调用也合法 | 保存开放 finish 字符串与 usage，不发空 token | 语义终态，继续消费 `[DONE]` |
| `[DONE]` | 最终块之后或服务端结束 | 非 JSON 哨兵 | 不解析为对象 | 停止读取并释放 reader/连接 | 流终态 |
| HTTP 错误 | 端点拒绝请求 | error.code 与 error.message | 不当作增量 | 转脱敏 SDK 错误，保留状态和诊断码 | 终态，释放响应 |
| 断线 / Abort / timeout | 流已建立 | 无官方专用恢复事件 | 不得当成 `[DONE]` / 成功 | 传播错误、停止工具副作用 | 终态；复用语义未知，宿主释放 |
| 工具结果续轮 | finish_reason=tool_calls | 保留完整 reasoning/tool_calls；工具消息含 tool_call_id | 丢字段会破坏续轮 | 宿主执行工具并发起新请求 | 新 HTTP/SSE 会话 |

官方流式示例证明最终增量可只有空 `content`、`finish_reason` 与 usage，之后再发 `[DONE]`；
官方 SDK 示例也先判断 `choices` 是否为空。因此合法空块、无 choices 块必须作为 parser 正例。

`finish_reason` schema 枚举包含 stop/length/tool_calls/sensitive/network_error，但同页说明另提
`model_context_window_exceeded`。解析器必须接受和保留开放字符串，不能用封闭枚举拒绝返回。

## 7. 官方示例与 fixture 清单

13.2 必须逐项保存下列字面示例并带来源 URL、抓取日期、原样/脱敏说明：

| fixture | 官方来源 | 真实性与用途 |
|---|---|---|
| Flash 图片请求 | 对话补全 API | 官方字面示例；替换 API Key/公网媒体即可，model ID 必须保留 |
| Flash 视频请求 | 对话补全 API | 官方字面示例；覆盖 `video_url` |
| Flash 文件请求 | 对话补全 API | 官方字面示例；分别识别 file_id/file_url/file_data，不猜上传 purpose |
| 普通 SSE 文本/思考/最终 usage/`[DONE]` | 流式输出 | 官方字面示例实际 model 为 `glm-5.2`，只能标“同端点相关模型”，不能冒充 Flash |
| 工具调用参数分块 | 流式工具调用 | 官方字面示例实际 model 为 `glm-5.3`，只能标“同端点相关模型” |
| 合法无 choices / 空终态 | 上述流式说明与 SDK 判断逻辑 | 可按官方字段表构造，元数据必须标明构造，不冒充原始响应 |
| 缺字段、乱序、重复、断线等负例 | 事件矩阵推导 | 合成负例，单独目录/元数据 |

当前没有 Flash 模型专属 SSE/工具流响应样本；要取得只能等待官方补充或在用户授权后做真实请求。

## 8. 区域价格

| profile | 币种 | 输入 / M | 输出 / M | 缓存命中 / M | 2026-08-28 促销 |
|---|---|---:|---:|---:|---|
| `cn` | CNY | 0.8 | 2.8 | 0.23 | 0.4 / 1.4 / 0.115；页面仅写“5 折限时两周”，无绝对截止日 |
| `global` | USD | 0.15 | 0.50 | 0.03 | 0.075 / 0.25 / 0.015；截至 2026-09-09 24:00（UTC+8，新加坡时间） |

两区缓存存储均显示限时免费。国内模型页称标准 API 价为 GLM-5.3 的 1/10、限时为 1/20；
Coding Plan 3 倍额度扣减是订阅用量规则，不是 token 单价。SDK/产品必须让价格随 endpoint profile
选择，不做静态汇率换算，也不把任何促销固化为长期标准价；实现或发布前分别重新核价。

## 9. 错误与资源边界

- 401：鉴权/令牌问题；429：余额或并发/频率限制；400/403：参数、模型权限或字段冲突；
  500：服务/网络异常；1261：prompt 过长；1301：敏感内容。
- 错误响应按 `{error:{code,message}}` 解析并脱敏，不能记录 Authorization、媒体 Base64 或完整用户内容。
- 官方没有定义中途断线恢复与连接复用。SDK/宿主仍需用 Abort/timeout 终止读取并释放 reader、
  transport、工具资源；不得把 EOF 当成功 `[DONE]`。

## 10. 未决项与编码阻断

完整能力适配目前被以下官方冲突/缺口阻断：

| 未决项 | 官方冲突 / 缺口 | 保守实现边界 |
|---|---|---|
| 结构化输出 | 模型页称支持；Vision OpenAPI 无 response_format，通用说明称仅文本模型支持 | `structuredOutputMode: none`，不发送 response_format |
| `tool_stream` | 模型页建议开启；Vision schema 无字段，通用支持列表缺 Flash | 只做普通工具调用，不发送 tool_stream |
| `file_id` 上传 | Chat 接受 file_id；Files API purpose 无 Chat 枚举 | 不实现 file_id 上传；不猜 purpose |
| 跨模态混合 | 是否可混合和总量限制未说明 | 不承诺/不自动开放任意组合 |
| Flash 专属事件样本 | 官方流式样本使用其他 GLM 模型 | 通用 parser 可用相关样本测试，但不宣称 Flash 真网事件已验证 |
| 国内 / 国际 Key 互通 | 两站分别要求到各自平台创建 Key，未声明账号、余额或 Key 可互通 | 分离 credential slot；禁止跨 endpoint 自动试投 |

结论：**完整能力暂不可编码；若 13.2 明确接受上述保守降级，只实现已确认子集，则可编码。**

## 11. 13.2 精确实现输入

- `packages/ai-sdk/src/llm/modelCatalogEntries.ts`：新增独立条目，image/video=true、audio=false、
  1M/128K；结构化输出保持保守值。
- `packages/ai-sdk/src/llm/providerPresets.ts`：保留现有国内 `bigmodel` 默认值，加入 Flash；以同一
  provider family 声明 `cn` / `global` endpoint profiles，不新增第二套 provider 内核。
- `packages/ai-sdk/src/llm/types.ts`：增加供应商族/endpoint profile/credential identity 的可移植数据契约；
  国内存量 `providerId=bigmodel` 默认迁为 `cn`，国际配置必须有不同实例 id 和凭据槽。
- SDK credential 获取与 Electron keystore：凭据不能只按供应商族共享；按配置实例或显式
  credential identity 区分国内/国际，且迁移不得移动、删除或拿国内 key 试国际端点。
- `packages/ai-sdk/src/llm/providerReasoningRequest.ts`：现有规则仅供应商感知；若下发
  clear_thinking=false，先加入模型感知，避免误伤 GLM-5V-Turbo。
- `packages/ai-sdk/src/llm/streaming.ts` / `chatTypes.ts`：工具增量、合法空块、无 choices、
  开放 finish reason 与 reasoning 续轮。
- `packages/ai-sdk/src/llm/sdk/provider.ts`：确认 image/video 在两条消费路径的真实能力；当前 Agent
  模型步骤不能表达视频，不得静默宣传全路径支持。
- 文件输入若进入范围，扩统一输入类型与宿主 media/upload 契约，不加手动 URL 或模型旁路。
- 精确测试：目录/预设/reasoning、多模态序列化、空块/空终态/无 final、工具分块、重复/乱序、
  错误、Abort/timeout/断线/资源归零；断牙时临时把合法空最终块判错，确认测试失败后恢复。

## 12. 官方来源索引

以下页面均于 2026-08-28 核对：

- [GLM-5.3-Flash 模型说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)：用户指定页面；模型身份、模态、上下文、参数、能力与相对价格。
- [新模型发布记录](https://docs.bigmodel.cn/cn/update/new-releases)：2026-08-26 上线日期。
- [模型总览](https://docs.bigmodel.cn/cn/guide/start/model-overview)：定位、上下文、最大输出与价格入口。
- [对话补全 API](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)：端点、Flash 多模态字面请求、请求/响应 schema 与限制。
- [流式输出](https://docs.bigmodel.cn/cn/guide/capabilities/streaming)：SSE、空最终块、usage 与 `[DONE]`。
- [流式工具调用](https://docs.bigmodel.cn/cn/guide/capabilities/stream-tool)：工具参数分块、tool_stream 与续轮。
- [Function Calling](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling)：工具声明、执行与 tool_call_id。
- [思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)：强制思考、交错思考与 clear_thinking。
- [文件上传 API](https://docs.bigmodel.cn/api-reference/文件-api/上传文件)：上传端点与 purpose 缺口。
- [错误码](https://docs.bigmodel.cn/cn/faq/api-code)：认证、参数、限流、内容安全与服务错误。
- [价格页](https://open.bigmodel.cn/pricing)：标准价与核对日促销价。
- [官方文档全量索引](https://docs.bigmodel.cn/llms.txt)：相关能力页发现与覆盖复核。
- [国内 Quick Start](https://docs.bigmodel.cn/cn/guide/start/quick-start)：国内 Base URL、API Key 页面与 Flash 模型入口。
- [国际 GLM-5.3-Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash)：国际站模型 ID、模态、上下文、参数与能力。
- [国际 Quick Start](https://docs.z.ai/guides/overview/quick-start)：国际 Base URL、API Key 页面与 Flash 模型入口。
- [国际 HTTP API](https://docs.z.ai/guides/develop/http/introduction)：国际通用端点与 Bearer 鉴权。
- [国际价格](https://docs.z.ai/guides/overview/pricing)：USD 标准价、促销价和绝对截止时间。
