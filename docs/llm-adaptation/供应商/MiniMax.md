# MiniMax

> 核对时间：2026-08-26。信息来源见文末「原始链接索引」，均无需登录。

## 1. 摘要

| 项目 | 取值 |
|---|---|
| `providerId`（项目内约定） | `minimax` |
| 对应项目 `adapter` | `openai`（Chat Completions / Responses 均可）。官方推荐的 Anthropic 路径在本项目没有可选的 adapter——那个选项从未接通，已删除，见下方"接入优先级" |
| 官方协议 | Anthropic Messages（官方推荐）、OpenAI Chat Completions、OpenAI Responses API 三选一，同域名不同路径 |
| 接入优先级（本项目约定，见 [README 第三节](../README.md)） | **Responses API 优先** → Chat Completions 兜底（已实现）→ Anthropic **最低优先级**——注意这与官方自己的推荐顺序相反，见第 6 节说明 |

MiniMax 是本次调研 7 家里**唯一把 Anthropic 协议列为默认推荐接入方式**的供应商——官方"通过 SDK 接入"快速开始页第一步就是装 `anthropic` SDK，不是 `openai`；原因是 Anthropic 协议能拿到原生 `thinking` 块和 interleaved thinking，Chat/Responses 路径下这部分体验打折扣。**但本项目按统一的协议接入优先级执行，不因为某一家官方推荐就单独提高 Anthropic 的实现顺序**——MiniMax 官方文档自己也说 Chat Completions 与 Responses 两条路径"功能对等，只是拿不到原生 thinking 块"，所以 Responses API 仍然是够用的第一选择。

## 2. Base URL

| 协议 | Base URL |
|---|---|
| Anthropic Messages（推荐） | `https://api.minimaxi.com/anthropic` |
| OpenAI Chat Completions | `https://api.minimaxi.com/v1`（路径 `/chat/completions`） |
| OpenAI Responses API | `https://api.minimaxi.com/v1`（路径 `/responses`） |

## 3. 模型清单

| 模型 ID | 简介 | 输入 → 输出 | 上下文 | 最大输出 |
|---|---|---|---|---|
| `MiniMax-M3` | 当前最新旗舰，原生多模态，1M 上下文，面向 Frontier Coding、复杂推理、Agent | 文本、图片、视频 → 文本 | 1,000,000 | 官方建议 131,072，硬上限 524,288 |

`MiniMax-M2.7`（含 `-highspeed`）仍在正常提供服务，属于上一代仍在售的并行线，不是 M3 的档位变体；`M2.5`/`M2.1`/`M2` 系列已归入官方"历史模型"分组。

### 价格（元/百万 tokens，当前促销"永久五折"后）

| 输入长度 | 输入 | 输出 | 缓存读取 |
|---|---|---|---|
| ≤ 512K | 2.10 | 8.40 | 0.42 |
| > 512K | 4.20 | 16.80 | 0.84 |

`service_tier: "priority"` 优先服务档按上表 1.5 倍计费，可换取更快响应与更低失败率。

## 4. Anthropic 协议接入要点（官方推荐路径，但本项目最低优先级，仅供顺手接入时参考）

```python
import anthropic
client = anthropic.Anthropic(base_url="https://api.minimaxi.com/anthropic", api_key="<KEY>")
message = client.messages.create(model="MiniMax-M3", max_tokens=1000, messages=[...])
for block in message.content:
    if block.type == "thinking": ...   # 原生 thinking 块
    elif block.type == "text": ...
```

- 支持 `thinking` 内容块和 interleaved thinking（推理与工具调用交替）——这是官方文档反复强调的 M3 核心卖点，Chat Completions 路径下只能拿到扁平化的 `reasoning_content` 字符串，信息密度不如原生 `thinking` 块。
- 官方 Mini-Agent 示例项目就是用 Anthropic 协议 + interleaved thinking 演示"如何用 M3 搭 Agent"的最佳实践，可作为项目内 Agent 集成的参考实现。

## 5. 联网搜索（Server Tools，Beta，两个协议都支持——这与此前认知不同）

**更正**：此前认为 MiniMax 的 `web_search` 只在 Anthropic Messages 文档出现，OpenAI/Responses 路径不支持——这是过时信息。**官方当前 Server Tools 文档明确写：Anthropic Messages API 和 OpenAI Responses API 都支持**，只是工具类型标识不同：

| 接口 | 工具声明 |
|---|---|
| Anthropic Messages API | `{"type": "web_search_20250305", "name": "web_search"}` |
| OpenAI Responses API | `{"type": "web_search"}` |

服务端工具（Server Tools）与项目自研的 function-calling 工具是两套机制：模型在 MiniMax 服务端自动执行搜索并把结果直接嵌进响应，调用方不需要多轮回传 `tool_result`，一次请求内完成。

- Anthropic 路径响应里会依次出现 `text`（引导语）→ `server_tool_use`（`name=web_search`, `input.query`）→ `web_search_tool_result`（含 `title`/`url`/`page_age`/`content`）→ `text`（最终答案），直接读最后一个 `text` 块即可。
- Responses API 路径的 `output` 数组包含 `web_search_call`（含 `action.query`）和 `message`，可以直接读顶层聚合字段 `output_text`。
- **纯 Chat Completions（`/v1/chat/completions`）不支持这个工具**——只有 Anthropic Messages 和 Responses 两条路径能用，选型时要注意。
- 价格 ¥0.03/次；处于 **Beta 阶段**，官方提示行为与参数可能随时调整，服务端全程执行导致单次请求耗时可能更长，客户端超时要放宽。

## 6. 兼容性说明

- OpenAI Chat Completions 与 Anthropic Messages 是"等价的两套非流式样例"，官方文档明确"如果你的项目已经接入 OpenAI SDK，把 base_url 和 model 换成 MiniMax 的值即可直接复用，无需迁移 SDK"——即两条路径功能对等（除服务端工具的可用面略有差异），选哪个更多是团队已有技术栈的问题，不是能力取舍。这也是本项目仍把 Responses API 排在 Anthropic 前面的依据：不用 Anthropic 也不会丢失核心能力，只是拿不到原生 `thinking` 块和 interleaved thinking 这部分体验加成。
- 已有项目机制 `LlmProviderConfig.adapter` 目前只有 `deepseek`/`openai` 两个可选值；曾经存在的 `anthropic` 从未接入实际运行时（`provider.ts` 只注册了 `openai-compatible` 协议），已删除。MiniMax 是除 DeepSeek、GLM、MiMo 之外第四家把 Anthropic Messages 列为官方一等协议的供应商，且是唯一"官方推荐首选"的一家——**这一点只作为背景记录**，本项目的实现顺序仍按 README 里统一的 Responses → Chat → Anthropic 优先级执行，不为 MiniMax 单独提前。

## 原始链接索引（均无需登录）

- [模型概览](https://platform.minimaxi.com/docs/guides/models-intro)
- [模型调用（URL 配置、双协议示例）](https://platform.minimaxi.com/docs/guides/text-generation)
- [通过 SDK 接入（Anthropic SDK 快速开始）](https://platform.minimaxi.com/docs/guides/quickstart-sdk)
- [服务端工具（Server Tools / web_search）](https://platform.minimaxi.com/docs/guides/server-tools)
- [工具使用 & 交错思维链](https://platform.minimaxi.com/docs/guides/text-m3-function-call)
- [按量计费](https://platform.minimaxi.com/docs/guides/pricing-paygo)
- [MiniMax 文档全量索引](https://platform.minimaxi.com/docs/llms.txt)
