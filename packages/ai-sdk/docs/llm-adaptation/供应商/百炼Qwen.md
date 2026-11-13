# 阿里云百炼 / Qwen

> 核对时间：2026-11-07（第 2b 节模型清单、价格与 Responses 支持范围）；其余部分 2026-08-26。信息来源见文末「原始链接索引」。**控制台模型详情页（`bailian.console.aliyun.com`）需要登录**，实测自动化浏览器访问会被拦截（`请求失败，请检查网络设置`）；本文档内容全部来自 `help.aliyun.com` 的公开文档页，未登录也能完整核对协议、模型清单与价格。仅当需要交互式"体验中心"截图或账号级用量数据时才必须登录控制台。

## 2026-11-14 地域通用域名、联网与模型列表

来源：[地域与域名](https://help.aliyun.com/zh/model-studio/regions)、[Responses 兼容](https://help.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api)、[联网搜索](https://help.aliyun.com/zh/model-studio/web-search)、[模型列表](https://help.aliyun.com/zh/model-studio/list-models)。

- 除业务空间域名外，有不带 WorkspaceId 的通用域名（所有业务空间的密钥可用，密钥按地域独立）：北京 `dashscope.aliyuncs.com`、新加坡 `dashscope-intl.aliyuncs.com`、美国 `dashscope-us.aliyuncs.com`、香港 `cn-hongkong.dashscope.aliyuncs.com`；德国、日本没有。通用域名自 2026-09-30 起不再支持新特性，现有能力照常；超时 600 秒（业务空间域名 3600 秒）。Chat 与 Responses 都在 `{base}/compatible-mode/v1` 下；旧 `/api/v2/apps/protocols/compatible-mode/v1/responses` 已停止维护。SDK 未传 `baseUrl` 时按 `endpointProfile`（地域，缺省 cn-beijing）用通用域名。
- 联网：Responses `{"type":"web_search"}`（可配 `web_extractor`、`code_interpreter`）；Chat `enable_search: true`，Qwen 与 DeepSeek 系支持，`glm-5.2`、`kimi-k3` 仅 Responses，`kimi-k3.1-pro` 不支持 Chat。计费 turbo 3 元/千次、max 与 agent 4 元/千次（新加坡 agent 73.39 元/千次）。
- Responses 思考事件为 `response.reasoning_text.delta`；`response.failed` 未在官方事件表列出。
- 模型列表官方是原生 `GET {base}/api/v1/models`（`output.models[]`）；兼容路径 `/compatible-mode/v1/models` 路由存在但文档未写。思考时采样行为未写明。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定） | `bailian` / `dashscope` |
| 对应项目 `adapter` | `openai`（Chat Completions）；官方也提供 Responses API |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | 官方列入 Responses 支持清单的模型默认走 **Responses API**（见第 2b 节）；其余走 Chat Completions；官方没有 Anthropic Messages API |
| 鉴权 | `Authorization: Bearer $DASHSCOPE_API_KEY` |
| Base URL | 推荐业务空间域名 `https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`（从控制台“查看代码”复制）；也可用地域通用域名，见上方 2026-11-14 |
| 官方协议 | OpenAI Chat Completions（`/chat/completions`）+ OpenAI Responses API（`/responses`），同一 Base URL 下两个路径 |

## 2. 模型：`qwen3.8-max`

千问最新旗舰 MoE 模型，强化编程、办公、原生视觉理解、超长文档与长视频能力。

**关键适配陷阱**：`qwen3.8-max` 必须使用**多模态接口**格式发送消息，不能用给纯文本模型（如 `qwen-plus`）准备的简单文本接口——官方原文警告"直接替换模型会导致 `url error` 错误"。也就是说即便请求内容是纯文字对话，`qwen3.8-max` 的 `content` 字段也要按多模态消息数组的形式组织（`[{"type":"text","text":"..."}]`），不能直接传字符串。这是从"模型能力标注含图片/视频"这句话本身看不出来的隐藏约束，写 `request.builder()` 时必须按多模态 schema 走。

同样要求多模态接口的还有：`qwen3.8-27b`、`qwen3.7-max-2026-06-08`、Qwen3.6/Qwen3.5 系列；仅需纯文本接口的是：`qwen3.8-2.4t-a95b`、`qwen3.7-max`、`qwen3.7-max-2026-05-20`、`qwen3.6-max-preview`。两类接口不能混用模型 ID。

### 价格（元/百万 tokens，`0 < Token ≤ 1M`，服务部署范围"全球"）

| 模型 ID | 输入 | 输出（思维链+回答） | 免费额度 |
|---|---|---|---|
| `qwen3.8-max` | 12 | 36 | 100 万 Token（有效期 90 天） |
| `qwen3.8-max-prime`（优速模式 Prime） | 24 | 72 | 无免费额度 |

`qwen3.8-max-prime` 是此前资料遗漏的一个变体——"优速模式"，价格是标准版的整整 2 倍，用于对延迟更敏感的场景，属于同一发布线下的独立计价档位，接入时应作为一个可选的产品级参数（渠道/模式）而不是隐藏细节。

国际（`国际`）与欧盟区域价格更高（`qwen3.8-max` 国际区 14.988/44.965 元），实际扣费以当前请求命中的区域为准；Batch 调用半价，上下文缓存命中享折扣（具体折扣比例见 [上下文缓存文档](https://help.aliyun.com/document_detail/2862577.html)）。

## 2b. 其他文本模型（2026-11-07 核对）

按[文本生成模型选型](https://help.aliyun.com/zh/model-studio/text-generation-model)与[模型调用计费](https://help.aliyun.com/zh/model-studio/model-pricing)（华北2 北京）核对。官方推荐：默认 `qwen3.7-plus`，效果优先 `qwen3.8-max`，成本优先 `qwen3.8-flash`；Plus、Max、Flash 都接收文本、图像和视频，输出文本。

| 模型 ID | 上下文 / 最大输出 | 思考 | 工具 | 内置工具 | 结构化输出 | 输入 / 输出（元/百万 tokens） |
|---|---|---|---|---|---|---|
| `qwen3.8-max`（含快照 `qwen3.8-max-0902`） | 1M / 128K | 思考与非思考 | 支持 | 支持 | 支持 | 12 / 36 |
| `qwen3.8-flash` | 1M / 128K | 思考与非思考 | 支持 | 支持 | 支持 | 0.8 / 2.7 |
| `qwen3.7-plus` | 1M / 128K | 思考与非思考 | 支持 | 支持 | 支持 | ≤256K：2 / 8；256K–1M：6 / 24（页面标注限时 8 折，表内为原价） |
| `deepseek-v4.1-flash`（含 `-1017`） | 1M / 未列 | 支持 | 支持 | 支持 | 支持 | 忙时 2 / 8，闲时 1 / 4 |
| `deepseek-v4-pro-0813` | 1M / 未列 | 支持 | 支持 | — | — | 忙时 9 / 27，闲时 4.5 / 13.5 |
| `kimi-k3.1-pro` | 1M / 未列 | 思考与非思考（默认开） | 支持 | 支持（仅 Responses） | JSON Mode | 13 / 68（缓存命中输入 1.3） |
| `kimi-k3` | 1M / 未列 | 仅思考 | 支持 | 不支持 | 支持 | 20 / 100 |
| `glm-5.3` | 1M / 未列 | 思考与非思考 | 支持 | 不支持 | 支持 | 8 / 28 |
| `MiniMax/MiniMax-M3.1-Flash` | 1M / 未列 | 仅思考 | 支持 | 不支持 | 不支持 | 1 / 4 |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | 1M / 未列 | 支持 | 支持 | 不支持 | 支持 | 30 / 60 |
| `stepfun/step-5-preview` | 1M / 未列 | 支持 | 支持 | 不支持 | 支持 | 7 / 20 |

图像与视频参数（Max / Flash / Plus 相同）：单图最大 16M 像素、最多 2048 张图；视频最长 2 小时、最大 2GB、最多 64 段。

忙时为北京时间 08:00–22:00。Batch 调用半价；上下文缓存只给输入打折，二者不能同时生效。三方模型在华北2以外地域没有免费额度。

**Responses 支持的模型**（[OpenAI 兼容-Responses](https://help.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api)，2026-11-07）：Qwen 3.5–3.8 各档（含 `qwen3.8-flash`、`qwen3.7-plus`），以及 `deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017`、`deepseek-v4-pro`、`deepseek-v4-pro-0813`、`deepseek-v4-flash-0731`、`glm-5.3`、`glm-5.2`、`kimi-k3`。列表里没有 `kimi-k3.1-pro`、`MiniMax-M3.1-Flash`、`mimo-v2.6-pro-ultraspeed`、`step-5-preview`，项目对它们走 Chat。Responses 下 `reasoning.effort` 优先于 `enable_thinking`。

三方直供模型的 API Model ID 带厂商前缀（计费页“模型 ID”列，如 `MiniMax/MiniMax-M3.1-Flash`、`kimi/kimi-k3`），选型页只写短名；`kimi-k3` 与 `kimi/kimi-k3` 是百炼代运营与月之暗面直供两个渠道，同价。带日期后缀的四位快照（`-0902`、`-1017`、`-0813`）不在目录的自动去快照规则内，项目目录用别名登记。`qwen3.8-omni-flash` 面向音视频输入，需要按 Omni 调用指南走流式输出，暂不进预设。

## 3. Responses API 接入示例

```python
client = OpenAI(api_key=..., base_url="https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
response = client.responses.create(model="qwen3.8-max", input="简要介绍下你能做什么？")
```

- 返回结构里 `output` 数组包含 `reasoning`（仅思考模式开启时出现）和 `message`。
- **已知限制**：Responses API 路径**不支持** `enable_source`/`enable_citation`/`citation_format` 参数，不会在回复正文里自动插入 `[1]` 角标引用——如果产品需要角标标注，只能退回传统 DashScope 原生调用方式，不能靠 Responses API 实现。

## 4. 思考模式

用 `extra_body={"enable_thinking": true}`（Chat Completions/Responses 均适用）控制是否开启深度思考；官方没有像 GLM/Kimi 那样给出离散的 `reasoning_effort` 档位字符串，是布尔开关而非强度分级。

## 5. 联网搜索与内置工具

Responses API 下可以在 `tools` 数组里组合声明三个内置工具，模型自主决定调不调用：

```python
response = client.responses.create(
    model="qwen3.8-max",
    input="杭州天气",
    tools=[
        {"type": "web_search"},
        {"type": "web_extractor"},
        {"type": "code_interpreter"},
    ],
    extra_body={"enable_thinking": True},
)
```

- `web_search`：联网搜索，价格 4 元/1,000 次。
- `web_extractor`：网页正文抓取，官方页面标注限时免费。
- `code_interpreter`：代码解释器，官方页面标注限时免费。
- 搜索来源在响应 `output` 数组里 `type=web_search_call` 的元素、其 `action.sources` 字段里，不在正文文本中自动标注引用。
- **Chat Completions 路径的等价用法更简单**：直接传 `enable_search: true`（布尔值），不需要声明完整的 `tools` 数组，但拿不到 `web_extractor`/`code_interpreter` 这类独立工具，只有联网搜索一项。两条路径的联网搜索能力不完全对等，接入时要按实际选的协议决定暴露哪种开关。

## 6. 与其它供应商在百炼上共存（了解即可，不改变本文档定位）

百炼控制台除了阿里自有的 Qwen 系列，还以"三方直供"名义上架了 Kimi K3、智谱 GLM-5.3、MiniMax-M3、`mimo-v2.5-pro` 等——即这几家供应商也可以通过百炼这个统一入口调用。本项目的供应商划分以官方原生 API 为准（各自单独一份文档），百炼上的"三方直供"版本只是同一模型的另一个接入口，不单独维护文档，只在这里作为背景记录。

## 原始链接索引

- [模型概览（含所有可用模型清单）](https://help.aliyun.com/zh/model-studio/models) — 无需登录
- [文本生成（含 Chat Completions/Responses 双协议代码示例、多模态接口区分表）](https://help.aliyun.com/zh/model-studio/text-generation) — 无需登录
- [联网搜索工具](https://help.aliyun.com/zh/model-studio/web-search) — 无需登录
- [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing) — 无需登录（2026-11-07 核对）
- [文本生成模型选型](https://help.aliyun.com/zh/model-studio/text-generation-model) — 无需登录（2026-11-07 核对）
- [OpenAI 兼容-Responses 支持模型](https://help.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api) — 无需登录（2026-11-07 核对）
- [Qwen 使用指南](https://help.aliyun.com/zh/model-studio/user-guide/qwen) — 无需登录
- [OpenAI 兼容-Responses（完整迁移指南）](https://help.aliyun.com/document_detail/3016539.html) — 无需登录
- 百炼控制台模型详情页（`bailian.console.aliyun.com/.../model-market/detail/qwen3.8-max`）—— **需要登录**，自动化访问被拦截；需要交互式体验或账号级信息时再手动登录查看
