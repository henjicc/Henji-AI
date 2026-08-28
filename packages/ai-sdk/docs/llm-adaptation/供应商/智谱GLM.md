# 智谱 GLM（BigModel / Z.ai）

> 最后核对：2026-08-28。信息来源见文末「官方来源索引」，均为无需登录的官方页面。

`glm-5.3-flash` 的模型级请求、事件、fixture、价格和编码门槛以
[GLM-5.3-Flash_智谱.md](../../model-adaptation/GLM-5.3-Flash/GLM-5.3-Flash_智谱.md) 为唯一详细来源；
本文件只承担智谱供应商级协议汇总。若两处摘要不一致，以模型级文件为准并同步修正本页。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目唯一约定） | `bigmodel` |
| 品牌与 SDK 名称 | 智谱 / BigModel / Z.ai；官方 Python SDK 已从 `zhipuai` 迁到 `zai-sdk`，**这些都不是项目运行时 provider alias** |
| 对应项目 `adapter` | `openai`（Chat Completions）；`glm-5.3` 官方还提供 Responses 与 Anthropic 协议 |
| 鉴权 | `Authorization: Bearer <API Key>` |
| `glm-5.3-flash` 接入结论 | 既有 `bigmodel` 供应商下的**新增独立原生多模态模型**，不是 `glm-5.3` 的别名，也不触发供应商重命名 |
| 本轮状态 | 官方资料已核对；SDK 尚未登记 `glm-5.3-flash`，完整能力编码仍受第 9 节冲突项阻断 |

`glm-5.3-flash` 的展示名为 `GLM-5.3-Flash`，官方 API Model Code 为小写的
`glm-5.3-flash`。公开资料没有给出第二个 API 别名，不要把展示名、`Z.ai` 或 SDK 包名当成别名注册。

## 2. Base URL 与协议边界

| 协议 | Base URL | 已确认模型范围 |
|---|---|---|
| OpenAI Chat Completions | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.3`、`glm-5.3-flash`、`glm-5v-turbo` |
| OpenAI Responses | `https://open.bigmodel.cn/api/v1` | `glm-5.3`；`glm-5.3-flash` 模型页未列出 |
| Anthropic Messages | `https://open.bigmodel.cn/api/anthropic` | `glm-5.3`；`glm-5.3-flash` 模型页未列出 |

`glm-5.3-flash` 官方模型页只链接 `POST /paas/v4/chat/completions`，本项目只能把
Chat Completions 视为已确认协议，不能因同一供应商的 `glm-5.3` 支持另外两种协议而外推。

**账号限制**：订阅过 GLM Coding Plan（含已过期）的账号，官方文档写明暂时只能通过
Chat Completions 调用模型 API。同一账号在不同协议上的可用性可能不同。

## 3. 模型清单

| 模型 ID | 简介 | 输入 → 输出 | 上下文 / 最大输出 | 标准价格（元/百万 tokens） |
|---|---|---|---|---|
| `glm-5.3` | 最新旗舰文本模型，面向软件工程与 Agent 任务 | 文本 → 文本 | 1M / 128K | 输入 8；输出 28；缓存命中 2 |
| `glm-5.3-flash` | GLM-5 系列首个原生多模态模型；2026-08-26 上线 | 文本、图片、视频、文件 → 文本 | 1M / 128K | 输入 0.8；输出 2.8；缓存命中 0.23 |
| `glm-5v-turbo` | 面向看图、看视频写代码的多模态 Coding 基座 | 文本、图片、视频、文件 → 文本 | 200K / 128K | 官方模型页未直接列出，发布前重新查价格页 |

2026-08-28 价格页对 `glm-5.3-flash` 显示“5 折限时两周”：输入 0.4、输出 1.4、
缓存命中 0.115 元/百万 tokens，缓存存储限时免费。页面没有显示促销开始日或绝对结束日，
所以这里把划线前价格记录为标准价，促销价只作为带核对日期的动态事实，发布或展示前必须重新核对。

`glm-5.3-flash` 的模型页还写明 API 价格为 `glm-5.3` 的 1/10、限时价格为 1/20；
与价格页上述数值一致。Coding Plan 中按 3 倍用量扣减属于订阅额度规则，不是 API token 单价。

## 4. `glm-5.3-flash` 输入契约

### 4.1 通用请求

- 端点：`POST /paas/v4/chat/completions`。
- `messages[].content` 可以是文本字符串，或多模态内容块数组。
- 输出仅为文本；公开模型页没有声明音频输入，不能因对话端点的通用 schema 含音频类型就给本模型登记音频能力。
- 推荐参数：`temperature: 1`、`top_p: 0.95`、`reasoning_effort: "max"`、
  `thinking: {"type":"enabled"}`。官方建议不要同时调整 `temperature` 与 `top_p`。
- `max_tokens` 最大 131072，官方建议不低于 1024。
- `stop` 最多 4 个字符串。

### 4.2 图片

- 内容块为 `{"type":"image_url","image_url":{"url":"..."}}`。
- 支持公网 URL 或 Base64 Data URL；每张小于 5 MB，最大 6000×6000，格式为 JPG/PNG/JPEG，
  最多 50 张。
- SDK 与宿主必须继续遵守媒体上传约束：消费界面不得提供手动 URL 文本框；URL/Base64 由媒体选择、
  上传或宿主转换链路产生。

### 4.3 视频

- 内容块为 `{"type":"video_url","video_url":{"url":"..."}}`。
- 官方 Chat 示例确认公网 URL；文件不超过 200 MB，格式为 MP4/MKV/MOV。
- 官方页面没有给出本模型的视频时长上限，也没有给出视频 Base64 写法，均保持未知，不得猜测。

### 4.4 文件

- 推荐内容块类型是 `file`；旧 `file_url` 仍可用但官方标记为不推荐。
- `file` 中 `file_id`、`file_url`、`file_data` 三选一；单文件最大 50 MB，最多 50 个文件。
- `file_data` 是带 MIME 的 Base64 Data URL；`file_url` 页面列举 PDF/TXT/Word/JSONL/XLSX/PPTX 等。
- 官方 Chat 文档说 `file_id` 由文件上传接口取得，但文件上传接口的公开 `purpose` 仅列
  `batch`、`code-interpreter`、`agent`、`voice-clone-input`，没有 Chat 用途。13.2 不得猜一个
  `purpose`；这个分支必须等官方补充或经授权的真实请求验证。

公开资料没有说明图片、视频、文件能否跨模态混合，也没有给出混合后的总数量/体积上限；
不要套用 `glm-5v-turbo`“三者不能同时理解”的限制，也不要反向假定 Flash 一定支持任意混合。

## 5. 思考模式与工具调用

- `glm-5.3` 与 `glm-5.3-flash` 都是强制思考模型，`thinking.type` 只能是 `enabled`。
- `reasoning_effort` 支持 `low` / `high` / `max`，默认 `max`。
- 官方对标准 API 建议显式传 `thinking.clear_thinking: false` 保留跨轮思考；Coding Plan 默认保留，
  标准 API 默认清除。现有项目仅有供应商级思考映射，13.2 需要先确认如何只对需要的模型下发，
  不能无差别改变同供应商旧模型。
- Function Calling 已确认；工具最多 128 个，`tool_choice` 的公开说明只给出 `auto`，不要显式发送
  其他取值。工具由宿主执行，再以 `role: "tool"` 与 `tool_call_id` 回传。
- 交错思考的多轮工具调用必须把上一轮完整、原序的 `reasoning_content` 与工具调用一起回传；
  不得只保留可见文本。

模型页建议流式工具调用时同时传 `stream: true` 与 `tool_stream: true`，但对话 OpenAPI 的视觉请求
schema 未暴露 `tool_stream`，通用字段说明列出的支持模型也未包含 `glm-5.3-flash`。基础工具调用已确认，
专有的 `tool_stream` 优化暂不可登记为稳定能力，见第 9 节。

## 6. Chat Completions 事件契约矩阵

下表区分官方 schema 的可空性与项目解析策略。官方没有给某些字段标 `required` 时保持 optional，
不能把示例中“恰好存在”提升为协议必填。

| 事件 / 响应 | 前置状态 | required / optional / nullable | 空值与缺字段语义 | 状态迁移、输出与副作用 | 终态 / 连接 |
|---|---|---|---|---|---|
| 非流式 HTTP 成功 | 请求已发送 | 响应对象包含 `choices`；`message.content` 在工具调用时可为 `null`；`reasoning_content`、`tool_calls`、`usage` 按场景可选 | 工具调用时无文本是合法响应，不能报“结果无文本” | 发出非空文本/思考，收集工具调用与 usage | 单次 HTTP 终态，响应消费后释放 |
| SSE 普通增量 | 流已建立、尚未终止 | `choices` 可能缺失或为空；`delta.content`、`delta.reasoning_content`、`delta.tool_calls` 均可选，content 可为 `null` 或空串 | 无 choice/空内容块合法，忽略而不是制造 token | 非空文本/思考按序追加；工具参数按 `index` 拼接 | 非终态，保持连接 |
| SSE 工具增量 | 流已建立、工具参数未完成 | `delta.tool_calls[]` 分片含 `index`；`id`、函数名、arguments 会分块出现 | 单片不完整合法，不能逐片解析完整 JSON | 按 index 保留顺序并拼接；本事件不执行工具 | 非终态，保持连接 |
| SSE 完成块 | 已有零到多个增量 | `finish_reason` 只在最终块出现；`delta.content` 可为空；`usage` 通常只在最终块出现 | “空文本 + finish_reason + usage”是合法终态；无有效文本但有工具调用同样合法 | 保存开放字符串形式的 finish reason 与 usage，不额外发空 token | 语义终态，但仍应消费 `[DONE]` |
| `data: [DONE]` | 最终块之后，或供应商直接终止 | 非 JSON 哨兵 | 不解析为对象 | 停止读取并释放 reader/连接 | 流终态 |
| HTTP 错误 | 请求被端点拒绝 | 官方错误对象含 `error.code` 与 `error.message` | 不应把错误正文当增量事件 | 转换为脱敏 SDK 错误，保留状态码与可诊断代码 | 终态，释放响应 |
| 中途断线 / Abort / timeout | 流已建立 | 官方没有定义专用恢复事件 | 不能把断线当 `[DONE]` 或成功终态 | 传播取消/超时/网络错误，停止工具副作用 | 终态；是否连接复用未由官方说明，宿主必须释放 |
| 工具结果续轮 | 上一轮 `finish_reason=tool_calls` | assistant 历史需保留完整 `reasoning_content`、`tool_calls`；工具消息需 `tool_call_id` | 丢掉思考或工具 id 会破坏后续推理 | 宿主执行工具，把结果作为新消息发起下一次请求 | 新 HTTP/SSE 会话，不是旧连接复用 |

官方流式示例还显示：最终增量可只有空 `content`、`finish_reason` 与 usage，随后再发 `[DONE]`；
官方 SDK 示例会先判断 `choices` 是否为空再读取。因此合法空块、无 choices 块必须进入 fixture 和解析测试。

`finish_reason` 的 schema 枚举列出 `stop`、`length`、`tool_calls`、`sensitive`、`network_error`，
但同页字段说明还提到 `model_context_window_exceeded`。这是官方页面内部不一致；解析器必须接受并保留
未知字符串，不能用封闭枚举拒绝服务器返回。

## 7. 结构化输出与流式能力

- 普通文本流式已确认：SSE `data:` JSON 帧、最终 `finish_reason`/usage、`data: [DONE]`。
- 思考过程通过增量 `reasoning_content` 返回。
- 模型页声称支持结构化输出，但视觉请求 OpenAPI 未暴露 `response_format`，通用字段说明又写
  “仅文本模型支持”。在官方澄清前，13.2 必须保守登记为不支持结构化输出，不能宣称 JSON schema。
- 模型页建议 `tool_stream: true`，但 API schema 的模型支持清单未包含本模型；基础流式和基础工具调用
  不受此冲突影响，只有 `tool_stream` 专有优化被阻断。

## 8. 联网搜索

智谱有三套不同产品，不要混为一谈：

| 产品 | 调用方式 | 边界 |
|---|---|---|
| Web Search API | `POST /paas/v4/web_search` | 独立检索端点，拿结构化结果后由宿主拼入 prompt |
| Chat Completions 网络搜索工具 | `tools[].type = "web_search"`，另带 `web_search` 嵌套配置 | 让模型结合搜索结果作答；不是 OpenAI 扁平工具 schema |
| Search Agent | Assistant API 的 `assistant.conversation()` | 更重的调研式工作流，不属于普通 Chat 工具 |

搜索引擎价格：`search_std` ¥0.01/次、`search_pro` ¥0.03/次、
`search_pro_sogou` / `search_pro_quark` ¥0.05/次。搜索是独立计费工具，不含在模型 token 单价中。

## 9. 未决项与 13.2 编码门槛

按“官方资料先行”规则，当前**不可按完整能力进入 13.2 编码**。若 13.2 接受保守降级，
可只实现已经确认的子集；否则必须先取得官方澄清或用户授权真实请求验证：

| 未决项 | 官方冲突 / 缺口 | 13.2 保守边界 |
|---|---|---|
| 结构化输出 | 模型页称支持；Vision OpenAPI 不含 `response_format`，通用说明称仅文本模型支持 | `structuredOutputMode: none`，不得发送 `response_format` |
| `tool_stream` | 模型页建议开启；OpenAPI Vision schema 缺字段，通用支持模型清单缺 Flash | 只支持普通 Function Calling；不发送 `tool_stream` |
| `file_id` 上传 | Chat 接口允许 `file_id`，上传接口 `purpose` 无 Chat 枚举 | 不实现/不测试 `file_id`；若扩文件能力只能先走官方明确的 `file_url`/`file_data`，且继续遵守宿主上传与无 URL 文本框规则 |
| 跨模态混合 | 未说明图片/视频/文件能否混合及总量限制 | 不承诺混合；测试和 UI 不自动开放任意组合 |
| 模型专属流式样本 | 官方字面 SSE/工具流样本使用 `glm-5.2`/`glm-5.3`，不是 Flash | 可作为“同端点官方相关模型样本”验证通用 parser，不能冒充 Flash 专属 fixture；模型专属事件正确性仍需官方样本或授权真网 |

## 10. 13.2 精确代码与测试输入

确认采用上表保守边界后，13.2 至少需要检查并改动：

- `packages/ai-sdk/src/llm/modelCatalogEntries.ts`：新增独立 `glm-5.3-flash` 条目；
  `image=true`、`video=true`、`audio=false`，1M / 128K；结构化输出保持保守值。
- `packages/ai-sdk/src/llm/providerPresets.ts`：加入 BigModel 预设模型列表，不新增 `zhipu` alias。
- `packages/ai-sdk/src/llm/providerReasoningRequest.ts`：现有 `bigmodel` 是供应商级规则；需要模型感知后再决定
  `thinking.clear_thinking=false`，不得为 Flash 修改而误伤 `glm-5v-turbo`。
- `packages/ai-sdk/src/llm/streaming.ts` 与 `packages/ai-sdk/src/llm/chatTypes.ts`：核对工具调用增量、
  无 choices/合法空块、finish reason 开放字符串与 reasoning 保留；当前文本 parser 不能被模型目录登记替代。
- `packages/ai-sdk/src/llm/sdk/provider.ts` 及模型步骤输入转换：确认 image/video 在两个正式消费路径的真实能力；
  智能助手路径当前不支持视频，目录与 UI 不得静默宣称全路径可用。
- 文件输入若进入范围，先扩统一 LLM 输入种类、宿主 media/upload 接口与安全边界；不能在 UI 添加 URL 文本框，
  也不能仅为 Flash 写专属旁路。
- fixture：逐项保存官方 Flash 图片、视频、文件字面请求；通用 SSE/工具流样本必须标注实际示例模型 ID。
- 精确测试：目录/预设/思考请求、多模态序列化、合法空 SSE、无 choices、空终态、无有效 final、
  工具参数分块、重复/乱序、错误、Abort/timeout/断线与资源释放，并执行断牙验证。

## 官方来源索引

以下页面均于 2026-08-28 核对：

- [GLM-5.3-Flash 模型说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)（用户指定来源；模型 ID、模态、上下文、参数、能力与相对价格）
- [新模型发布记录](https://docs.bigmodel.cn/cn/update/new-releases)（2026-08-26 上线日期）
- [模型总览](https://docs.bigmodel.cn/cn/guide/start/model-overview)（模型定位、上下文、最大输出与价格入口）
- [对话补全 API](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)（端点、请求/响应 schema、Flash 多模态字面示例与限制）
- [流式输出](https://docs.bigmodel.cn/cn/guide/capabilities/streaming)（SSE、空最终块、usage 与 `[DONE]`）
- [流式工具调用](https://docs.bigmodel.cn/cn/guide/capabilities/stream-tool)（工具参数分块、`tool_stream` 与宿主续轮）
- [Function Calling](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling)（工具声明、执行与 `tool_call_id`）
- [思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)（强制思考、交错思考与 `clear_thinking`）
- [文件上传 API](https://docs.bigmodel.cn/api-reference/文件-api/上传文件)（上传端点与 purpose 缺口）
- [错误码](https://docs.bigmodel.cn/cn/faq/api-code)（认证、限流、参数、内容安全与服务错误）
- [智谱模型价格](https://open.bigmodel.cn/pricing)（标准价与 2026-08-28 可见的限时价）
- [智谱文档全量索引](https://docs.bigmodel.cn/llms.txt)（相关页面发现与交叉核对）
- [GLM-5.3 模型说明](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)
- [GLM-5V-Turbo 模型说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5v-turbo)
- [联网搜索](https://docs.bigmodel.cn/cn/guide/tools/web-search)
