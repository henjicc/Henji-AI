# 阿里云百炼 / Qwen

> 核对时间：2026-08-26。信息来源见文末「原始链接索引」。**控制台模型详情页（`bailian.console.aliyun.com`）需要登录**，实测自动化浏览器访问会被拦截（`请求失败，请检查网络设置`）；本文档内容全部来自 `help.aliyun.com` 的公开文档页，未登录也能完整核对协议、模型清单与价格。仅当需要交互式"体验中心"截图或账号级用量数据时才必须登录控制台。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定） | `bailian` / `dashscope` |
| 对应项目 `adapter` | `openai`（Chat Completions）；官方也提供 Responses API |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | **Responses API 优先**（`web_extractor`/`code_interpreter` 只在这条路径有）→ Chat Completions 兜底（已实现）；官方**没有** Anthropic Messages API |
| 鉴权 | `Authorization: Bearer $DASHSCOPE_API_KEY` |
| Base URL | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（**地域相关，`{WorkspaceId}` 和区域后缀需要从控制台"查看代码"复制当前值，不要硬编码**） |
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
- [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing) — 无需登录
- [Qwen 使用指南](https://help.aliyun.com/zh/model-studio/user-guide/qwen) — 无需登录
- [OpenAI 兼容-Responses（完整迁移指南）](https://help.aliyun.com/document_detail/3016539.html) — 无需登录
- 百炼控制台模型详情页（`bailian.console.aliyun.com/.../model-market/detail/qwen3.8-max`）—— **需要登录**，自动化访问被拦截；需要交互式体验或账号级信息时再手动登录查看
