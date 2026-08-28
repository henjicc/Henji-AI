# LLM 供应商适配清单（总索引）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 覆盖供应商 | 火山引擎（Doubao）、Kimi（Moonshot）、智谱 GLM、DeepSeek、小米 MiMo、阿里云百炼（Qwen）、MiniMax |
| 覆盖模型 | 7 家供应商的当前旗舰文本/多模态系列；供应商专属模型见各自文档内的“模型清单” |

## 一、这是什么，和 `docs/model-adaptation/` 有什么不一样

`../model-adaptation/` 管的是**生成模型**（图片/视频/音频）：每个 (模型, 供应商) 组合对应一份 SDK catalog 定义，包含参数 schema、提交/轮询/结果解析与计价，文档和代码是 1:1 影子关系，所以按"一个模型一个文件夹、每个支持它的供应商一份文件"组织。

LLM（本目录）是完全不同的架构：

- **供应商和模型是用户运行时自建的**（设置页手填 `providerId`/`baseUrl`/API Key，模型 ID 靠手填或探测），不是代码里为每个模型写一份文件。三个消费方——智能助手 Agent、画布文本处理节点、提示词优化——共用同一份 `LlmConfigState`（`providers` + `models`），走同一条 `runModelStep` → AI SDK `streamText` 管线（[modelStep.ts](../../src/llm/modelStep.ts)、[SDK modelStep.ts](../../src/llm/sdk/modelStep.ts)）。
- 真正需要"文档变了就要回去改代码"的东西只有两处，且都是**供应商级**而不是模型级：
  1. [providerProtocol.ts](../../src/llm/providerProtocol.ts) 里按 `providerId` 收口的协议怪癖（额外认证头、请求体字段改名）
  2. [providerAdapter.ts](../../src/llm/sdk/providerAdapter.ts) 里的 `ModelStepProviderAdapterRegistry`——按协议注册的适配器
- 因此本目录按**供应商**组织，不按模型：`供应商/<供应商名>.md`，每份文件自包含该供应商的 Base URL、协议现状、模型速查表、思考参数、联网搜索能力和已知怪癖。

```
docs/llm-adaptation/
├── README.md              # 本文件：协议矩阵 + 供应商速查 + 代码现状
├── 文档采集手册.md          # 怎么发现/抓取 LLM 供应商文档（调研前先看）
└── 供应商/
    ├── 火山引擎.md
    ├── Kimi.md
    ├── 智谱GLM.md
    ├── DeepSeek.md
    ├── 小米MiMo.md
    ├── 百炼Qwen.md
    └── MiniMax.md
```

## 二、代码现状（先看这个，再看下面的协议矩阵）

### 2.1 已经落到代码里的（2026-08-26）

| 能力 | 落点 | 说明 |
|---|---|---|
| 内置模型能力目录 | [modelCatalog.ts](../../src/llm/modelCatalog.ts) + [modelCatalogEntries.ts](../../src/llm/modelCatalogEntries.ts) | 本目录里核对过的模型按 ID 登记输入模态、工具调用、结构化输出、上下文与输出上限。添加模型（手动、探测、预设三个入口）时自动标好，用户不用自己勾；存量配置在归一化时补标一次并盖 `catalogId` 戳，之后用户的手工修改不再被覆盖 |
| 内置供应商预设 | [providerPresets.ts](../../src/llm/providerPresets.ts) | 七家供应商 + 派欧云的 Base URL、思考默认值、推荐模型打包，设置页「管理供应商」里选一下即可建好 |
| 思考参数按供应商翻译 | [providerReasoningRequest.ts](../../src/llm/providerReasoningRequest.ts) | 把统一的五档强度映射到各家实际接受的字段与取值（第六节那张表就是它的数据来源），原生流式与 SDK 模型步骤两条路径共用 |

改动前的状态：思考模式下拉**只对 DeepSeek 有效**，其余六家发出去的请求里根本没有对应字段；而且两条路径给 DeepSeek 发的还不一样（原生流式发 `reasoning: true`，不是官方要求的 `thinking` + `reasoning_effort`）。

### 2.2 仍然只有一条协议

- `LlmApiProtocol` 目前**只有一个值**：`'openai-compatible'`（[providerProtocol.ts](../../src/llm/providerProtocol.ts)）。
- `ModelStepProviderAdapterRegistry` 目前**只注册了一个协议适配器**（[provider.ts](../../src/llm/sdk/provider.ts)）。
- 设置页供应商类型下拉曾经有第三个选项 `anthropic`，但代码里从来没有对应实现，选了它只是预览文案变成 `/v1/messages`，实际发出去的仍是 Chat Completions 请求。该选项**已删除**，存量配置由 `LlmConfigService` 归一化成 `openai`；等 Anthropic 协议真正接上再加回来。

也就是说，本目录记录的"官方支持 Responses API / Anthropic Messages API"这些信息目前仍是**资料，不是项目已实现的能力**——三个消费方现在都只能通过 `openai-compatible`（Chat Completions）这一条路径访问下表里的全部供应商。好消息是 SDK 的 `modelStep.ts` 执行层完全构建在 AI SDK 的 `LanguageModel` 抽象之上，接一个新协议**不需要碰** `agent-runtime/**`、画布节点、提示词优化任何一行代码，只需要：扩 `LlmApiProtocol` 枚举 → 写一个新的 `ModelStepProviderAdapter` → 注册进 registry → 设置页加一个 adapter 选项。

### 2.3 一个容易踩的坑：两条请求路径能表达的输入模态不同

- 画布文本处理、提示词优化走**原生流式路径**（[streaming.ts](../../src/llm/streaming.ts)），`image_url` / `video_url` / `input_audio` 三种内容块都能发。
- 智能助手走 **AI SDK 模型步骤**（[provider.ts](../../src/llm/sdk/provider.ts)），当前转换器只能表达 **image 与 audio**，视频会被 `assertInputModalities` 拦下。

所以模型能力目录里的 `input` 记的是"**本项目当前请求路径下真实可用**"的模态，不是模型宣传的模态：只在尚未实现的协议上可用的模态一律记为 false 并在 `note` 里写明原因（例如 DeepSeek 的视觉模型只在 Responses API 上收图，走 Chat Completions 发图会被静默替换成占位文本）。智能助手的能力验证里视频显示"失败"就是这条的表现，属于预期结果。

## 三、本项目的协议接入优先级（产品决策，不是能力强弱排序）

新写协议适配器、给某个供应商挑协议时，按下面顺序取舍——这是本项目的既定优先级，**不因某家供应商官方推荐哪个协议就单独提高它的顺序**（MiniMax 官方推荐 Anthropic，但本项目仍按下表顺序执行，见 [MiniMax.md 第 6 节](供应商/MiniMax.md)）：

1. **Responses API 优先**。结构化输出、上下文管理、内置工具（联网搜索等）通常最先在这条协议上落地，是新协议适配器要覆盖的首要目标。
2. **Chat Completions 兜底**。项目当前唯一已实现的协议，任何供应商至少都能通过它接入；Responses API 做不到的部分（或还没排上的供应商）继续用它兜底，不阻塞任何一家的可用性。
3. **Anthropic Messages API 最低优先级**。即便官方原生支持（DeepSeek、GLM、小米 MiMo、MiniMax 四家，MiniMax 甚至官方推荐），也不作为下一步要投入的方向——只有当某个协议适配器顺手就能覆盖到它时才简单接一下，不单独立项去做。

每个供应商文件的「摘要」表里都有一行"接入优先级"，按这三条给出该供应商的具体落点（例如 Kimi/百炼没有 Anthropic，MiMo 没有 Responses API，落点就相应收窄）。

## 四、协议矩阵（官方支持面，供路线图参考）

| 供应商 | Chat Completions | Responses API | Anthropic Messages API | 联网搜索可用协议 |
|---|---|---|---|---|
| [火山引擎](供应商/火山引擎.md) | ✅ | ✅ | ❌ 官方未提供 | **仅 Responses API**（Chat API 完全不支持内置工具） |
| [Kimi](供应商/Kimi.md) | ✅ | ❌ 官方未提供 | ❌ 官方未提供 | Chat Completions（`$web_search`，官方标注"近期不建议用于生产"） |
| [智谱 GLM](供应商/智谱GLM.md) | ✅（`glm-5.3-flash` 目前仅确认此协议） | ✅（仅 `glm-5.3`） | ✅（仅 `glm-5.3`） | Chat Completions 工具 / 独立 Web Search API 均可，GLM-Coding-Plan 订阅账号暂时只能走 Chat Completions |
| [DeepSeek](供应商/DeepSeek.md) | ✅ | ✅ | ✅ | **仅 Responses API**（Chat Completions 不支持 `web_search`） |
| [小米 MiMo](供应商/小米MiMo.md) | ✅ | ❌ 官方未提供 | ✅ | **仅 Chat Completions**（官方原文："其他 API 协议暂不支持"），且需先在控制台激活插件 |
| [百炼 Qwen](供应商/百炼Qwen.md) | ✅ | ✅ | ❌ 官方未提供 | 两条协议都支持，但 Responses 路径能力更全（额外有 `web_extractor`/`code_interpreter`） |
| [MiniMax](供应商/MiniMax.md) | ✅ | ✅ | ✅（**官方推荐首选**） | Anthropic Messages + Responses API 均支持，纯 Chat Completions 不支持 |

**两条对制定路线图有直接影响的结论**：

1. **7 家里有 6 家原生支持 Responses API 或与之等价的能力**（火山引擎、GLM-5.3、DeepSeek、百炼、MiniMax 直接支持 Responses API；Kimi、小米 MiMo 没有 Responses API，只能走 Chat Completions）——这与第三节"Responses API 优先"的既定优先级吻合，先做 Responses API 适配器能覆盖到的供应商数量最多，也是联网搜索等内置工具最主要的解锁路径。
2. **联网搜索能不能用，很大程度上取决于选了哪个协议**，不是"这家供应商支不支持"这么简单：火山引擎和 DeepSeek 的联网搜索**必须**走 Responses API，MiMo 的联网搜索**必须**走 Chat Completions，MiniMax 的联网搜索 Anthropic/Responses 都行但纯 Chat Completions 不行。做 Responses API 适配器时可以顺带核对一下能不能同时把对应供应商的联网搜索也接上，性价比更高。
3. **4 家（DeepSeek、GLM、MiMo、MiniMax）原生支持 Anthropic Messages API，MiniMax 官方甚至推荐它作为首选**——这是资料记录，供未来"顺手就能接"时参考，**不代表应该优先做**：按第三节的既定优先级，Anthropic 排在 Responses API 和 Chat Completions 之后，不单独立项。

## 五、供应商速查表

| 供应商 | Base URL（OpenAI 兼容） | 旗舰模型 | 上下文 | 价格量级（输入/输出，元/百万 tokens） |
|---|---|---|---|---|
| 火山引擎 | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-evolving` | 1024K | 6 / 30 |
| Kimi | `https://api.moonshot.cn/v1` | `kimi-k3` | 1,048,576 | 20 / 100 |
| 智谱 GLM | 国内 `https://open.bigmodel.cn/api/paas/v4`；国际 `https://api.z.ai/api/paas/v4` | `glm-5.3` / `glm-5.3-flash`（原生多模态） | 1M | 国内 GLM-5.3：8 / 28；Flash：CNY 0.8 / 2.8、USD 0.15 / 0.50 |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-pro` | 1M | 4.5 / 13.5（闲时） |
| 小米 MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro` | 1M | 3 / 6 |
| 百炼 Qwen | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | `qwen3.8-max` | ~1M | 12 / 36 |
| MiniMax | `https://api.minimaxi.com/v1` | `MiniMax-M3` | 1,000,000 | 2.10 / 8.40（≤512K，促销价） |

价格列只取旗舰模型的标准档，完整价格表（含缓存命中价、批量价、区域差异）见各供应商文件；价格会变，不要把这张表当长期不变的计费合同。

## 六、思考参数速查（各家字段名一致但取值集合不同，不要共用常量）

| 供应商 | 字段 | 取值 | 默认 | 能否关闭 |
|---|---|---|---|---|
| 火山引擎 | `reasoning_effort` | `none`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`（7 档） | `high` | 可以（`thinking` 开关） |
| Kimi | `reasoning_effort` | `low`/`high`/`max` | `max` | **不可以**，K3 始终思考 |
| 智谱 GLM | `reasoning_effort` + `thinking` | `low`/`high`/`max`（`glm-5.3`、`glm-5.3-flash`） | `max` | GLM-5.3 / Flash 不可以；GLM-5V-Turbo 可以 |
| DeepSeek | `reasoning_effort` + `thinking.type` | 字符串透传，无固定枚举 | — | 可以 |
| 小米 MiMo | 无强度分级，仅 `reasoning_content` 回传约定 | — | — | 未见明确开关文档 |
| 百炼 Qwen | `enable_thinking`（布尔） | `true`/`false` | 视模型而定 | 可以 |
| MiniMax | 仅 Anthropic 协议下确认为原生 `thinking` 内容块；Chat/Responses 路径的思考强度字段未在公开文档中找到，接入 Responses API 时需要单独实测确认 | — | — | 视协议而定 |

## 七、维护方式

- **动手前**：先读 [文档采集手册.md](文档采集手册.md)——LLM 供应商的文档比生成模型更碎，同一模型的思考参数、联网搜索、工具调用往往各自独立成页，只看模型主页会漏掉大半内容。
- **新增供应商**：在本文件协议矩阵、供应商速查表、思考参数速查三张表里各加一行 → 在 `供应商/` 下新建 `<供应商名>.md`，按现有文件的结构写（摘要 → Base URL → 协议现状 → 模型清单 → 思考模式 → 联网搜索/工具 → 适配要点 → 原始链接索引）→ 再把它落到代码的三处：[modelCatalogEntries.ts](../../src/llm/modelCatalogEntries.ts) 加模型条目、[providerPresets.ts](../../src/llm/providerPresets.ts) 加供应商预设、思考参数写法与通用 `reasoning_effort` 不同时在 [providerReasoningRequest.ts](../../src/llm/providerReasoningRequest.ts) 加一条映射。
- **文档与代码的对齐由测试守着**：`modelCatalog.test.ts` 断言每条目录条目的 `docs` 路径真实存在，`providerPresets.test.ts` 断言每个预设的推荐模型都能在目录里查到、且有专门思考写法的供应商 id 与映射表一致。改了文件名或 providerId 而没同步，测试会红。
- **只登记文档明确写出的能力**：目录里的每一项都要能在对应供应商文档里找到出处，文档没写的保持保守取值（false / null），交给用户手工勾或走「验证此模型」动态探测，不靠模型名猜。
- **更新已有供应商**：直接改对应文件，同步更新该文件与本文件头部的"最后更新"。
- **信息来源要求**：每条参数/价格都要能追溯到文件末尾"原始链接索引"里的某个链接；需要登录才能看到的页面必须标注，且优先尝试公开镜像（如 `help.aliyun.com` 之于百炼控制台）而不是直接要求登录。
- **代码侧一旦补上新协议适配器**：回来更新本文件第二节"代码现状"，把对应协议从"资料"状态标记为"已实现"，否则这份文档会长期落后于代码。
