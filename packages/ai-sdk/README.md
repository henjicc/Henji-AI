# @henjicc/ai-sdk

痕迹AI 的多供应商模型 SDK：内含 8 个生成供应商、99 个图片/视频/音频模型，以及
7 家 LLM 供应商预设（加上派欧云聚合入口共 8 个预设项）。SDK 负责目录、请求构建、媒体预处理、
供应商调用、轮询、SSE 与错误归一化；宿主只需注入网络、凭据、媒体读取和日志。

## 5 分钟快速开始

SDK `0.2.6` 私有发布在 GitHub Packages。先在**消费项目**的 `.npmrc` 配置：

```ini
@henjicc:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Token 至少需要 `read:packages` 和私有仓库读取权限。不要把 token 本身写入 `.npmrc` 或提交到 Git。

```bash
npm install @henjicc/ai-sdk@0.2.6
```

然后提供 4 个宿主能力（`Transport` / `CredentialStore` / `MediaReader` / `Logger`），创建客户端：

```ts
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { createAIClient, type RuntimeContext } from '@henjicc/ai-sdk'

const runtime: RuntimeContext = {
  transport: { fetch: (url, init) => fetch(url, init) },
  credentials: {
    get: (scope, providerId) =>
      scope === 'generation' && providerId === 'kie' ? process.env.KIE_API_KEY : undefined,
  },
  media: {
    read: async (ref) => ({
      bytes: new Uint8Array(await readFile(ref)),
      mimeType: 'image/png',
      filename: basename(ref),
    }),
  },
  logger: {
    info: console.log,
    warn: console.warn,
    error: console.error,
  },
}

const client = createAIClient({ runtime })
try {
  const params = { prompt: 'A blue paper boat', kieZImageAspectRatio: '1:1' }
  const created = await client.generate({ modelId: 'kie-z-image', params })
  const result = created.status === 'pending' && created.taskId
    ? await client.continuePolling({ modelId: 'kie-z-image', taskId: created.taskId, params })
    : created
  console.log(result.url) // SDK 返回 URL；宿主决定是否下载落盘
} finally {
  client.dispose()
}
```

可直接运行的 Node 版本在 [examples/minimal-node](examples/minimal-node/README.md)；它先提供零网络
`dry-run`，并为付费创建请求加了单次外网闸门。

## 宿主契约

| 接口 | 宿主必须保证 |
|---|---|
| `Transport.fetch` | 返回标准 `Response`，保留 4xx/5xx 响应，网络失败抛异常，尊重 `AbortSignal` |
| `CredentialStore.get` | 按 scope/providerId 读取明文密钥；未配置或丢失时返回 `undefined` |
| `MediaReader.read` | 将宿主的本地/受管引用转成 `Uint8Array + mimeType + filename` |
| `Logger` | 可选；不得记录 API key/token/cookie/授权头 |
| `Tracer` | 可选；缺省为 no-op |

生成和 LLM 取消都必须带命名空间：
`client.cancel({ namespace: 'generation' | 'llm', taskId })`。自定义 provider 使用进程级注册表，
同 ID 并发注册会拒绝；持有它的 client 退出时必须 `dispose()`。

供应商官网与 API Key 入口由 SDK 统一提供，宿主不需要再维护一份链接表：

```ts
import { findProviderMetadata } from '@henjicc/ai-sdk'

const provider = findProviderMetadata('kie')
console.log(provider?.websiteUrl, provider?.apiKeyUrl)

// 同一供应商的区域站点通过 endpointProfile 选择。
const zAi = findProviderMetadata('bigmodel', { endpointProfile: 'global' })
```

`websiteUrl` 是面向用户的实际跳转入口；派欧云、KIE、APIMart 会保留项目配置的邀请码，
其余供应商使用正常官网。未知的自定义供应商返回 `null`，SDK 不猜测地址。

## 接入文档与示例

- [SDK 消费项目清单](docs/consumers.md)
- [Electron 主进程适配](docs/接入指南/Electron.md)
- [Tauri 2 适配](docs/接入指南/Tauri.md)
- [Photoshop UXP 适配](docs/接入指南/UXP.md)
- [供应商域名与白名单](docs/接入指南/供应商域名.md)
- [错误处理](docs/接入指南/错误处理.md)
- [Node KIE 生成](examples/minimal-node/README.md)
- [5 模型表单契约](examples/form-renderer/README.md)
- [LLM 流式对话](examples/llm-chat/README.md)

## 发布形式与可移植性

发布产物是保留模块边界的 ESM + `.d.ts`，没有 CJS `require` 入口。CommonJS 项目请用
动态 `import()`。UXP/Tauri 必须在构建期用 Vite/Rollup/webpack/esbuild 打包实际使用的 ESM 依赖。
SDK 源码不得依赖 `@/`、`node:`、Electron、`import.meta.glob`、`eval`/`new Function`/`node:vm`；
`npm run check:sdk` 会守住这些边界。Photoshop/受限宿主只做生成时应从
`@henjicc/ai-sdk/generation` 导入 `createGenerationClient`；该入口不静态带入 LLM、Vercel AI SDK、
Node 内置模块或 Fal 官方客户端，发布门禁会把它打成 IIFE 并在无网络生命周期中核对 99 个模型。

## 按需装配生成模型

`@henjicc/ai-sdk/generation` 是兼容入口，默认始终装入 99 个模型。真正需要缩小 Photoshop/Tauri
包体时，从不含任何内置 catalog/provider 的 `generation/core` 创建模块化客户端，并只导入完整 pack：

```ts
import { createModularGenerationClient } from '@henjicc/ai-sdk/generation/core'
import { pack as kieZImage } from '@henjicc/ai-sdk/models/kie/z-image'

const client = createModularGenerationClient({ runtime, packs: [kieZImage] })
console.log(client.catalog.list().map((model) => model.meta.id)) // ['kie-z-image']
```

完整单模型 pack 同时携带该模型的唯一真实 schema、provider adapter 与 provider-scoped 媒体预处理/
上传策略；宿主不需要知道内部上传模块。`@henjicc/ai-sdk/provider-packs/kie` 可一次装入 KIE 的全部
27 个模型；`provider-adapters/kie` 只装入 KIE 执行与上传策略、不装任何模型。所有 99 个单模型路径和
8 个供应商路径由 catalog 生成器自动产出并由 bundle 门禁穷举，新增模型不会靠手工维护 exports。

每个 `models/<provider>/<model>` 子路径也导出名为 `model` 的低层定义，供目录分析或高级自定义组合；
直接传裸 `model` 而不传同文件的 `pack` 不保证媒体上传或供应商执行完整，普通宿主应使用 `pack`。
包根 `createAIClient` 仍默认 99 模型；若确实需要根 client 的 chat 与按需生成共存，可显式传：

```ts
const client = createAIClient({
  runtime,
  generation: { mode: 'modular', packs: [kieZImage] },
})
```

普通 LLM 宿主可直接导入 `@henjicc/ai-sdk/llm`。Photoshop UXP 等禁止字符串代码生成的受限宿主
必须改用 `@henjicc/ai-sdk/llm/streaming`：它只提供原生 OpenAI-compatible SSE 的
`runLlmChatStream`、`cancelLlmChatTask` 与必要类型/错误，不会进入 modelStep、Zod、Vercel AI SDK
或 generation 静态图。两条入口复用同一份原生流式实现，不存在功能分叉。

```ts
import {
  cancelLlmChatTask,
  runLlmChatStream,
  type LlmChatRequestDto,
  type RuntimeContext,
} from '@henjicc/ai-sdk/llm/streaming'

const request: LlmChatRequestDto = {
  requestId: 'chat-1', providerId: 'openai', modelId: 'gpt-5-mini',
  messages: [{ role: 'user', content: '你好' }],
}
const result = await runLlmChatStream(request, 'chat-1', onStreamEvent, runtime as RuntimeContext)
console.log(result.output, result.reasoningOutput, result.usage, result.finishReason)
cancelLlmChatTask('chat-1')
```

### 可选模型分发包与统一能力筛选

图像消除等工具模型不会混入默认 99 模型。宿主可选择单个完整工具模型 pack，也可一次装入 Fal 图片编辑工具模型集合：

```ts
import { createModularGenerationClient } from '@henjicc/ai-sdk/generation/core'
import { createModelCapabilityDiscovery } from '@henjicc/ai-sdk/discovery'
import { pack as falImageEditTools } from '@henjicc/ai-sdk/tool-packs/fal-image-edit-tools'

const discovery = createModelCapabilityDiscovery({ generationPacks: [falImageEditTools] })
const erasers = discovery.search({
  providerIds: 'fal',
  outputModalities: 'image',
  operations: 'image-edit',
  features: 'erase',
})
const client = createModularGenerationClient({ runtime, packs: [falImageEditTools] })
console.log(erasers.map((item) => item.id))
```

单模型入口为 `tool-models/fal/flux-pro-erase`、`tool-models/fal/bria-eraser`、
`tool-models/fal/finegrain-eraser`；每个只导出 `model`、`provider` 与完整 `pack`。
聚合 `tool-packs/fal-image-edit-tools` 是方便选择的模型分发集合，只携带这 3 个模型、Fal adapter 和 Fal CDN
上传，不携带其余 99 模型或 LLM。能力筛选与分发是两层：`search()` 只过滤已经导入的候选，
不会让已经进入 bundle 的代码自动消失；缩小包体仍必须显式选择单模型/provider/collection pack。

## 两类模型的公共边界

生成模型与 LLM 共用以下基础设施：

| 能力 | 统一实现 | 约束 |
|---|---|---|
| 凭据 | `RuntimeContext.credentials` / `CredentialStore` | 用 `generation`、`llm` scope 隔离宿主密钥空间 |
| 网络 | `Transport` + `fetchProvider` | 只自动重试可证明尚未建连的错误，避免重放可能计费的请求 |
| 错误 | `runtime/errors.ts` + `runtime/error-classify.ts` | 生成错误码字符串保持稳定；LLM 保留鉴权、余额、限流、上下文、内容过滤等细分类 |
| 取消 | `runtime/task-registry.ts` | 单一 registry，以 `generation` / `llm` 命名空间隔离同名任务 |
| 重试判断 | `shouldRetry(error, mode)` | `safe-preconnect`、`request`、`poll-query` 共用分类，但策略生命周期不同 |
| 追踪 | `RuntimeContext.tracer` | SDK 只报告通用 span；助手专属 trace 由痕迹AI 宿主持有 |

以下协议刻意保持分离：

- 生成模型是“创建任务 → 可选轮询 → 提取媒体结果”，允许长时间轮询，并容忍状态查询的连续瞬态失败。
- LLM 是 SSE 流式或 Vercel 模型步，持续输出 token / tool call，单次请求失败按模型步策略处理。

二者的终止条件、进度含义、结果形状和可安全重试边界都不同。把它们压成一个通用 `execute()`
只会隐藏协议差异，无法形成可靠抽象；第五阶段统一客户端只应在入口层分组编排，不应合并生命周期。

## 目录与参数表单契约

消费方从 client 私有目录读取模型，不需要自行复刻 canonical/alias 索引规则：

```ts
const images = client.catalog.listByType('image')
const falModels = client.catalog.listByProvider('fal')
const editors = client.catalog.listByTag('supports-image-editing')
const params = client.catalog.getParams('fal-ai-gpt-image-2')
const defaults = client.catalog.getDefaultValues('fal-ai-gpt-image-2')
const price = client.catalog.estimatePrice('fal-ai-gpt-image-2', defaults)
```

`getParams()` 返回纯运行时 `RuntimeParamDef[]`。参数名、选项 label、图标、分组布局、linkages 和
痕迹AI 特有 composite 面板配置属于应用 presentation，不在 SDK 目录里；通用消费方可以用参数 ID
作最小标签，也可以在宿主维护自己的本地化展示层。`composite` 只保证值类型/default/API 契约，宿主
必须按参数 ID 注入自定义组件，不能从 SDK 还原痕迹AI 专属面板。

### 参数类型 → 控件

以下 13 种是 `RuntimeParamDef` 的完整公开联合；括号内是当前真实 99 catalog 的出现数量。未出现不代表
类型无效，而是当前目录没有对应模型。

| type | 99 catalog | 消费方控件 | 关键运行时字段 |
|---|---:|---|---|
| `dropdown` | 285 | 下拉选择 | `options[].value`、`default`、`required?` |
| `switch` | 89 | 布尔开关 | `default` |
| `number` | 79 | 数值输入/步进器 | `min?`、`max?`、`step?`、`default` |
| `text` | 7 | 单行文本 | `maxLength?`、`default` |
| `image-upload` | 5 | 图片上传 | `maxCount?`、`accept?`、`maxSize?`、`format?` |
| `composite` | 4 | 宿主自定义组件钩子 | `valueType?`、`default`；panel/config 不在 SDK |
| `textarea` | 3 | 多行文本 | `maxLength?`、`default` |
| `file-upload` | 1 | 文件上传 | `maxCount?`、`accept?`、`maxSize?` |
| `radio` | 0 | 单选组 | `options[].value`、`default` |
| `panel` | 0 | 递归分组容器 | `children[]`；布局样式由宿主决定 |
| `video-upload` | 0 | 视频上传 | `maxCount?`、`accept?`、`maxSize?`、时长范围 |
| `resolution` | 0 | 分辨率选择 | `presets[].value`、`allowCustom?` |
| `aspect-ratio` | 0 | 比例选择 | `options[].value` |

所有参数共有 `id`、`type`、`order`、`default`，并可带 `required`、`valueType`、API 映射、
`transferKey`、`visible`、`disabled`。实际 99 catalog 的字段集合与数量由
`packages/ai-sdk/tests/catalog-consumer-contract.test.ts` 穷举锁定，不以旧 ParamDef 文件或示例推断。

### 条件与媒体输入

- `evaluateRuntimeCondition()` 是条件显隐/inputLimits/requirements 的公共判断入口。函数条件直接调用；
  字符串条件使用受限 parser，支持真实 catalog 用到的标识符、`.length`、字面量、`typeof`、比较、
  `&&`/`||`/`!`、括号和 `Array.isArray()`。它不使用 `eval`/`new Function`；未知 token、属性或调用
  会抛出明确错误，不会静默判为 false。
- `resolveRuntimeInputLimits()` 解析数据型/函数型输入限制并应用条件规则。
- `getRuntimeMediaInputContract()` 把 `inputLimits` 的通用图片/视频/音频入口、显式
  `image-upload`/`video-upload`/`file-upload` 参数，以及 `runtimeConstraints.mediaFields` 的特殊请求字段
  分层返回。消费方必须据此渲染上传组件；不存在 URL 文本框 fallback。

最小无框架验证器位于 `examples/form-renderer/`。它用 5 个真实模型覆盖普通选择、数值范围、条件显隐、
通用与特殊媒体上传、composite 自定义钩子，可作为无 UI 框架的最小接入参考。

本包不发布 JSON catalog 快照。Tauri/UXP 消费端都能在构建期使用 ESM，而真实目录包含 builder、
计价、显隐和 inputLimits 函数，JSON 无法无损表达；并行发布不完整快照会形成第二份真相。未来只有出现
明确的非 JavaScript/TypeScript 消费方时，才应另行设计带版本的可序列化投影契约。

## 扩展模型类型与供应商

`ModelType` 与 `ProviderId` 都采用“内置字面量 + 开放字符串”的形式：编辑器仍会提示
`image` / `video` / `audio` 和 8 个内置供应商，同时消费方可以直接声明自己的类型与 provider id。
下面的 TypeScript 示例不新增真实模型或供应商，只演示完整的注册、索引与请求构建机制：

```ts
import {
  buildRequest,
  createModelIndex,
  defineModel,
  registerProvider,
  unregisterProvider,
} from '@henjicc/ai-sdk'

const providerId = 'acme-transcript'

async function main(): Promise<void> {
  registerProvider(providerId, {
    execute: async (input) => ({
      status: 'completed',
      url: 'memory://result',
      metadata: { requestBody: input.body },
    }),
    continuePolling: async () => ({
      status: 'failed',
      url: '',
      metadata: { reason: 'not-supported' },
    }),
  })

  try {
    const model = defineModel({
      meta: {
        id: 'acme-transcript-v1',
        canonicalModelId: 'acme-transcript-v1',
        provider: providerId,
        type: 'transcript',
      },
      params: [{ id: 'text', type: 'text', order: 1, default: '' }],
      endpoints: '/v1/transcript',
      request: { builder: (params) => ({ input: params.text }) },
      pricing: { currency: '$', fixed: 0 },
    })

    const index = createModelIndex([model])
    const request = await buildRequest(
      { text: 'hello' },
      index.get('acme-transcript-v1'),
    )
    console.log(request)
  } finally {
    unregisterProvider(providerId)
  }
}

void main()
```

注册表语义是确定的：`registerProvider` 遇到同名 id 会抛
`provider_already_registered`，不会覆盖既有适配器；`unregisterProvider` 删除成功返回 `true`，
未登记返回 `false`；`listProviders` 返回快照，修改返回数组不会改动注册表。插件与测试应使用唯一 id，
并在 `finally` / `afterEach` 中注销。SDK 在首次访问 provider 注册表时惰性初始化 APIMart、Bailian、
Volcengine、PPIO、KIE、ModelScope、Fal、Grsai 八个内置供应商；调用方无需手工初始化。惰性初始化
避免依赖仅靠模块加载保留的副作用，使 `sideEffects: false` 与 tree-shaking 语义一致。

### 跨模型类型的统一能力画像

`@henjicc/ai-sdk/discovery` 只负责发现和筛选，不改变 generation、LLM 或扩展模块各自的执行协议。
画像从已导入候选的真实 schema 派生，统一提供 provider、输出模态、operation、输入/输出内容类型、
features 与原始 tags。顶层查询维度默认 AND，也可设 `mode: 'any'`；单一维度可用
`{ anyOf: [...] }` / `{ allOf: [...] }` 表达 OR/AND。

标准 operation 覆盖图片生成/编辑、视频文生/图生/参考/编辑、音频生成、chat、语音识别和 OCR，
同时保留开放字符串。筛选结果用 `sourceKind` 区分 `generation-model`、`llm-model`、`extension`，
调用方随后交给对应执行 handle；SDK 不提供一个掩盖协议差异的通用 `generate()`。

能力画像是运行时选择层，不是打包器。`createModelCapabilityDiscovery({ generationPacks: [...] })` 只会看
传入的 pack；它既不会隐式导入默认 99，也不会从 bundle 删除已导入代码。真正的按需分发仍以 import
单模型/provider/collection pack 为边界。

### ASR/OCR 等开放能力

ASR、OCR 不属于图片/视频/音频生成的 `ModelType`，SDK 不再要求把它们伪装成媒体生成模型。
`@henjicc/ai-sdk/capabilities` 提供独立的开放模块协议：

```ts
import { createCapabilityClient, type CapabilityModule } from '@henjicc/ai-sdk/capabilities'

const speechRecognition: CapabilityModule<{ audio: Uint8Array }, { text: string }> = {
  descriptor: {
    id: 'my.speech-recognition',
    kind: 'speech-recognition',
    source: { kind: 'external', namespace: '@example/my-asr' },
    contract: {
      input: [{ kind: 'audio', required: true }],
      output: [{ kind: 'text', required: true }],
    },
  },
  execute: async ({ audio }, { signal }) => runLocalAsr(audio, signal),
}

const capabilities = createCapabilityClient({ runtime })
const asr = capabilities.register(speechRecognition)
const result = await asr.execute({ audio: bytes }, { requestId: 'asr-1' })
await capabilities.unregister(speechRecognition.descriptor.id)
await capabilities.dispose()
```

`CapabilityKind` 与输入/输出 `CapabilityContentKind` 都是开放字符串；`source.namespace` 是包或插件的
稳定所有者 ID，用于冲突诊断和批量卸载。模块执行上下文统一带
`RuntimeContext`、`AbortSignal`、requestId、Logger 与 Tracer。client 提供注册、发现、类型化执行、取消、
注销、`unregisterSource(namespace)` 和 dispose，并统一错误边界。跨类型筛选使用上面的
`ModelCapabilityProfile`；执行仍走各自稳定的轮询、流式或扩展 handle，不复制协议。

`0.2.0` 新增以下可选供应商入口，只有显式 import 才进入消费方 bundle：

- `capabilities/speech-recognition/bailian`：5 个百炼短音频/文件 ASR；
- `capabilities/speech-recognition/bailian/realtime`：4 个百炼 Fun-ASR/Qwen 实时 ASR；
- `capabilities/translation/bailian`：Qwen-MT Flash/Plus/Lite；
- `llm/groq`：Groq GPT-OSS 20B 默认配置、流式聊天和模型发现。
- `llm/bigmodel`：智谱同一 provider family 下的中国大陆/Global 端点 profile、独立凭据槽与 GLM-5.3-Flash 能力。
- `llm/modules`：外部包、插件与内置 LLM 共用的注册、执行、发现、取消和 namespace 卸载边界。

百炼 ASR module ID 固定为 `bailian.speech-recognition.<modelId>`，翻译固定为
`bailian.translation.<modelId>`；供应商 ID 使用 `bailian` / `groq`，没有 `funasr` 兼容供应商别名。

外部 LLM 不属于 ASR/translation `CapabilityModule`。宿主从插件 manifest 构造 `LlmModule`，插件本身
只实现宿主约定的轻量 ABI，无需导入或打包 SDK：

```ts
import { createLlmModuleClient, type LlmModule } from '@henjicc/ai-sdk/llm/modules'

const pluginModule: LlmModule = {
  descriptor: {
    id: 'com.example.chat',
    source: { kind: 'plugin', namespace: 'com.example.provider' },
    providerId: 'example',
    modelId: 'example-chat',
    capabilities,
    executionModes: ['request-response', 'event-stream'],
  },
  execute: async (request, context) => pluginAdapter.invoke(request, context),
  discover: async (context) => pluginAdapter.discover(context),
  dispose: async () => pluginAdapter.dispose(),
}

const llmModules = createLlmModuleClient({ runtime, modules: [pluginModule] })
const result = await llmModules.execute(pluginModule.descriptor.id, { messages }, {
  requestId: 'chat-1',
  mode: 'event-stream',
  onEvent,
})
await llmModules.unregisterSource('com.example.provider')
```

client 统一拥有 Usage/Finish/Done/Error 终态、Abort/timeout、结构化日志、trace、冲突诊断和资源 drain；
module 只发送 Token/ReasoningToken 增量并返回最终结果。`createGroqLlmModule()` 把现有 Groq 共享内核
包装成同一注册边界，插件占用 `groq/openai/gpt-oss-20b` 时会列出双方 source 并拒绝覆盖。

## 已知限制与验证边界

- 私有 GitHub Packages 消费方必须配置 `read:packages` 与对应私有仓库读权限；SDK 不提供无认证的公开 npm 镜像。
- Electron 宿主已经完整构建、桌面冒烟与真实 KIE/LLM 请求验证；`0.1.2` 已在真实 macOS Tauri 2.11.0 WebView + Rust `tauri-plugin-http` 中以 loopback fixture 跑通 create/poll、multi-chunk SSE 与 AbortSignal。`0.2.0` 的 generation-only、单工具、Fal erase tool pack、ASR、翻译、Groq 与 UXP LLM streaming 入口已通过静态依赖、受限 VM 和零网络生命周期门禁；窄 LLM 入口在完全没有 `TextEncoder` / `TextDecoder` 的 VM 中覆盖 UTF-8 跨 chunk、reasoning、text、usage、stop、`[DONE]` 与取消。百炼 ASR/翻译和 Groq 本轮使用官方/脱敏 fixture，未发起付费网络请求。Photoshop UXP 真机网络稳定性仍由插件集成任务验证，Grayscale/LAB/CMYK 图层字节读取也未真机复验。
- Fal 官方存储上传已在 Electron/Node real profile 中用无隐私合成 PNG 跑通真实端到端：119 字节上传与 Range 回读 SHA-256 一致，未触发模型请求或费用。`0.1.4` 将同一 initiate + signed PUT 协议收口到 `RuntimeContext.transport`，不再依赖 `@fal-ai/client` 或构造 `File`，并补齐成功、失败与取消 fixture；真实证据仍来自迁移前已核对的同一官方协议。CDN URL 公开，生产代码未显式设置 lifecycle，保留期依赖 Fal 账户设置。
- 四个历史 override 模型均已完成真实供应商 create/poll/result URL 验证。KIE Seedream 4.0/4.5 首轮各一次完成；Fal Seedream 4.0 首轮 create 后暴露 `0.1.2` status route 重建 405 并按首败停止，后在新的独立费用授权下，修复后 4.0 completed 才继续 4.5，两者均 completed 且无 create 重试。优先保存供应商完整 `status_url` 的修复已在私有 `0.1.3` 发布，并通过远程干净安装与标准 Vite 五入口回归。
- KIE、APIMart、PPIO 的正式只读 probe 均已得到 HTTP 200 且分类为 connected/verified；KIE/APIMart 余额已在正式 Electron real-profile 设置页显示，对应截图已实际打开目视。首轮场景选择器失败仍保留在 6.6 交接，没有用后台日志冒充 UI 证据。
- 8 家 provider fixture 中只有 Grsai 来自真实日志；其余按已核对测试断言与供应商文档构建。准确来源逐条记在 `tests/fixtures/README.md`，未冒充真实日志。
- `llm-chat` 已离线验证显式关闭 reasoning 后的文本 token 路径；唯一一次 DeepSeek 真实请求只返回 reasoning，修正版未再发起付费复验。
- 真实供应商的取消响应与错误 Key body 形状仅有注入 `Transport` 的契约测试，没有额外发起付费或故意失败的外网请求。

## 相关文档

- 任务定义：`docs/task/模型SDK抽离/任务/第一阶段-可行性验证与基础设施/1.2-建立SDK包骨架.md`
- 重要决定记录：`docs/task/模型SDK抽离/重要记录.md`
- 本包内的调研资料索引：[docs/README.md](docs/README.md)
- 版本记录：[CHANGELOG.md](CHANGELOG.md)
