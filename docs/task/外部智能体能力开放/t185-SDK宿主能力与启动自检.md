# t185：SDK 宿主必需能力与启动自检

状态：待验证，宿主实现和离线检查交总管理者审查；尚未做正式 Electron 启动及供应商实测。基线 `4671bc48f`，worktree `D:/VibeCode/henji-wt-opt2`，分支 `codex/host-selfcheck`。禁止 Git 写操作、主仓写入、依赖安装、SDK 文件修改/发布、开发实例启停、Reality、密钥读取与真实付费调用。

## 根因及修复边界

t179 已把 `createNativeFileUpload` 接到唯一 `electronTransport`，但仍先声明为 SDK `Transport`，再赋值可选方法。删掉赋值行仍能编译，缺失能力只在执行本地百炼文件识别时暴露。盘点还发现 `fetchStream`、`media.describe/readChunk` 没有实现，其他本地文件 ASR 会退回整文件读取。

采用宿主侧 `ElectronHostTransport = Required<Transport>`、`ElectronHostMediaReader = Required<MediaReader>` 和 `ElectronHostRuntime`。构造时一次性提供全部已启用 HTTP 宿主钩子，不再允许组装后补可选属性。检查表通过映射类型穷尽 SDK RuntimeContext 及其各适配器的方法；后续 SDK 新增可选钩子也要求宿主明确归属和实现决定。没有改变 SDK 公共接口，外部受限宿主仍可使用原来的可选能力契约。

## 宿主能力盘点

以下以 `packages/ai-sdk/src/runtime/*`、`capabilities/types.ts`、`generation/core.ts`、`llm/chat.ts` 和 `llm/modules/types.ts` 的实际接口为准。可选配置值、模型参数、返回 DTO 的可选数据不算宿主方法。

| SDK 宿主接口/适配点 | SDK 必需性与作用 | Electron 基线 | 本轮结果及保证 |
|---|---|---|---|
| `Transport.fetch` | 必填；标准 HTTP 请求、SSE 响应及 AbortSignal | diagnostic fetch 已实现 | 保留；上传/流式请求也经同一诊断 fetch，不新建网络入口 |
| `Transport.uploadFile` | 可选；百炼本地异步文件识别必需 | t179 已实现，但类型不能阻止遗漏 | `Required<Transport>` 必填，复用 t179 的 scoped 文件检查、openAsBlob、FormData、取消及不重投语义 |
| `Transport.fetchStream` | 可选；分块 ASR 请求体需要 | 缺失 | 补齐 Node `Readable.from` + 原 fetch，背压、Content-Length、duplex、取消及迭代器关闭；不收集全量 body |
| `MediaReader.read` | 必填；生成/LLM 等完整媒体读取 | 已实现本地文件/data URI | 保留异步读取及原 DTO；未改旧有完整读取路径的范围 |
| `MediaReader.describe` | 可选；ASR 在读内容前获知字节数和 MIME | 缺失 | 补齐已授权本地普通文件元数据，不读文件内容 |
| `MediaReader.readChunk` | 可选；有界分块 | 缺失 | 补齐按 offset/length 读取，finally 关闭文件；上限 64 KiB 来自 SDK 接口真实技术约束 |
| `CredentialStore.get` | 必填；generation/llm/speech-recognition 等 scope | 已实现；ASR 复用正式供应商凭据 | 保留；自检只检查方法存在，不读取凭据或判断用户是否配置 |
| `RuntimeContext.logger` → info/warn/error | 可选；SDK 缺省 no-op | 已接 createMainLogger | 本宿主必填，检查三个方法；缺 logger 时通过独立的既有主进程诊断 logger 报错 |
| `RuntimeContext.tracer` → startSpan/end | 可选；SDK 缺省 no-op | 显式 SDK noopTracer | 保留显式实现并要求必填；startSpan 自检，span.end 不为检查而调用，生命周期仍归 SDK |
| `RuntimeContext.realtime` → connect | 可选；实时识别专用 | 未实现；未注册实时模块/会话入口 | 保持未启用；按 realtime-asr 检查时明确宿主不支持，不创建假 connect 或展示不可用模型 |
| RealtimeConnection.messages/send/close | 连接建立后必填 | 无连接入口 | 与实时传输一起待接；启动检查不为探测而打开网络连接 |
| CapabilityExecutionContext.signal/emit | 必填；取消、事件背压 | SDK createCapabilityClient 提供；宿主 execute 转发 signal/onEvent | 已接，保持既有取消链，不手写第二份 capability client |
| CapabilityExecuteOptions.signal/timeoutMs/onEvent | 可选调用选项 | ASR owner 提供请求 ID、取消与事件；SDK 管超时 | 按请求用途传入；不是启动必填方法 |
| CapabilityModule.dispose；RealtimeModule.dispose；RealtimeDriver.result/close | 可选模块生命周期实现点 | ASR 模块由 SDK 提供；无自定义/实时模块 | 归模块/client 管理，不是宿主漏实现；不把可选驱动钩子伪装成 transport 要求 |
| 百炼 realtime taskIdFactory；火山文件/realtime requestIdFactory | 可选模块配置回调；SDK 提供合法 ID 缺省实现 | 文件 ASR 使用 SDK 默认；实时模块未启用 | 无需宿主自行造 ID；若覆盖需遵守对应 UUID/请求 ID 契约 |
| capability/LLM modules、realtimeModules；AIClient models/providers/generation.packs | 可选模块/目录选择与注册 | 生成显式 applicationModelProfile packs；文件 ASR 显式模块数组；LLM 根客户端 | 注册点已核对；选择模块不是额外网络适配，不隐式装入实时模块 |
| Generation provider preprocess/testConnection；ProviderPreprocessStrategy.preprocessObject | 可选供应商扩展点 | 应用选择的 provider packs 注入 SDK 正式实现 | 属于 SDK provider，不在 Electron 复制协议或强制全部供应商实现可选算法 |
| Generation hooks.onRequestBuilt/onCompleted | 可选观察回调 | generate 使用 onRequestBuilt；轮询由诊断 transport 观察；生成回执由宿主自身保存 | 已有等价正式完成/落盘日志，不强制冗余 onCompleted |
| LlmChatStreamHooks.onRequestBuilt/onCompleted；模型步 emit | 观察/流式事件 | llm/runtime 两个流式观察钩子及模型步事件已接 | 保留，使用同一个 runtime；没有新日志通道 |
| LlmModule.discover/dispose；onEvent/signal/timeoutMs | 可选模块及调用扩展点 | 根 AIClient 供 LLM；未另建自定义 LlmModuleClient | 按模块拥有者处理，不列为宿主启动漏项 |
| AIClient.cancel/dispose；CapabilityClient.cancel/dispose | 客户端生命周期 API，非 RuntimeContext 适配方法 | 生成/LLM 转发 cancel；ASR owner 通过 AbortController 取消 | 保留；本轮验证了 HTTP 上传/流式发送取消，不启动运行中实例做退出验收 |

`media.describe/readChunk` 是已授权本地文件通道；data URI 在生成/LLM 的原 `read` 通道保留。ASR 文件入口的预检要求真实可读授权文件，不引入媒体 URL 文本输入或新的文件权限。

## 各宿主入口核对

| 入口及构造处 | 使用的 runtime/transport | 上传 | 分块读取及流式请求 | 日志/凭据/取消 | 本轮处理 |
|---|---|---|---|---|---|
| 生成 `ai-runtime/sdk-runtime.ts` → createHenjiAIClient；`ai-runtime/runtime.ts` → generate/continuePolling | 唯一 sdkRuntimeContext/electronTransport | 已接 t179 | 新钩子随共享 context 具备；生成自己的读取契约不变 | 已接 | 编译必填约束、启动自检 |
| 口播识别 `audio-edit/asr.ts` → timestampedAsrService | `timestamped-asr.ts` 唯一 createCapabilityClient，同一个 context | 已接 | 原缺；本轮补齐 | SDK logger + owner signal/onEvent + generation 凭据 | preflight 和新提交 execute 均检查宿主钩子，未向供应商发送请求前拒绝 |
| 讲解转写 `audio-edit/explanation-audio.ts` → 同一个 service | 共用上行 | 已接 | 本轮补齐 | 已接 | 复用同一 preflight/execute，无独立 transport |
| ASR 可恢复任务 | 同一个 service 的 resumeTaskId | 不要求新上传 | 只查询既有任务，不重新读取/上传原音频 | 原请求事实保留 | 跳过新提交检查，避免把已付费任务误标成未计费 |
| LLM `llm/runtime.ts` → sdkAIClient.chat.stream/modelStep | 同一个 context | 具备；无 ASR 上传需求 | 具备；SSE 响应使用正常 fetch | 两个观察钩子/emit、日志、凭据、cancel 已接 | 无第二份 runtime |
| LLM 发现、能力 smoke；供应商连接检测/TTS voices；端点预热 | IPC/services 引用相同 context | 具备 | 具备 | 已接 | 不创建额外客户端传输，本轮不运行网络检查 |
| 实时识别 | electron/src 中没有 registerRealtime/realtimeModules/ASR openSession 调用 | 不适用 | 不适用 | 无正式入口 | 不启用；缺 connect 的检查测试证明明确拒绝 |
| 内置 Pi | 使用 Pi 的提供商执行机制，并非构造另一份 SDK runtime | 不适用 | 不适用 | Pi 生命周期/附件自有适配 | 仅只读确认 SDK 用于纯 provider helper；未修改助手或其状态台账 |

## 启动自检与失败语义

`app.whenReady` 恢复媒体授权根后、注册 AI IPC 前调用 `runElectronHostSelfCheck(sdkRuntimeContext)`。自检只检查函数，不读文件/密钥、不连接网络。当前启用范围为 generation、llm、file-asr；无实时模块时不因未启用 realtime 把健康启动标成失败。

缺失时聚合为一条 error：domain `main.ai-runtime.host`，event `ai_runtime.host_selfcheck.failed`，context 包含 `missing` 和 `affectedCapabilities`。正常启动只记录 completed 和已检查能力范围。复用 createMainLogger → 既有 JSONL/日志窗口实时及历史/查询链路，没有新增 IPC、查看器或诊断状态副本。

新提交的 ASR 在费用确认前 preflight 以及 execute 再核对，缺失抛 `host_capability_unsupported`，说明宿主不支持、未提交、未计费，携带 `billing=not_charged`、`retryable=false`、`execution.notExecuted=true`。补充事实字段使既有 asr 错误映射可读到零提交事实；不改外部工具 schema、EXTERNAL_CONTRACT_VERSION 或目录指纹。恢复既有付费任务不作零计费声明。

## 选型及设计自查

比较手写流式迭代桥、引入额外 fetch/form-data 库与 Electron 已内置 Node 实现。采用 Node 原生 Readable.from、fetch、FileHandle.read/close，复用 t179 scopedUploadFile：已有实现足以提供背压、取消与有界读取，无需新增依赖或自己实现 multipart/provider 协议。依据：[Node 流文档](https://nodejs.org/api/stream.html#streamreadablefromiterable-options)、[Node 文件读取文档](https://nodejs.org/api/fs.html#filehandlereadbuffer-offset-length-position)、[Node fetch 文档](https://nodejs.org/api/globals.html#fetch)。64 KiB 仅是 SDK 分块接口技术限制，不限制文件/素材/任务/文件夹数量；供应商 maxBytes 继续由 SDK/供应商决定。

覆盖分级：内部宿主结构性缺陷修复，无新增用户工具、实体、权限、Surface 或外部 schema。没有改 SDK 或用户落盘格式；无需新增 MCP 工具、契约版本或助手台账。

1. 助手只凭名称和说明能否用对？能；继续调用既有口播/讲解/字幕能力，预检会给出可理解的宿主不支持错误，缺钩子细节仅进诊断。
2. 能否 AI 先做、人只确认？能；宿主自检和文件可读性检查自动执行，缺能力时不弹注定失败的付费确认；执行仍走既有费用授权。
3. 产物能否直接流进其他工作区？能；继续产出正式口播/讲解转写及字幕结果，保持原领域服务、稳定引用、撤销和保存流程。

## 检查结果

L2：共享宿主契约、网络/文件 I/O 和取消改动；只执行用户指定的精确测试、三套 tsc、改动文件 ESLint 与 check:main-imports。tsc 使用 --noEmit，渲染/主进程附 --incremental false；Vitest 使用 --silent --cache=false，ESLint 不开缓存，避免写入指向主仓的 node_modules junction。

| 检查 | 结果 |
|---|---|
| host-capabilities.test.ts | 3 条通过；@ts-expect-error 证明缺 uploadFile 不可赋给 ElectronHostRuntime；聚合缺失日志及实时禁用预检 |
| native-stream-fetch.test.ts | 2 条通过；真实本地 HTTP fixture 接收字节与长度；取消/失败关闭迭代器，预取消不发送 |
| native-media-chunks.test.ts | 2 条通过；元数据、有界读取/EOF、技术范围与真实路径授权拒绝 |
| sdk-runtime.test.ts | 4 条通过；实际单例组装完整性及原媒体读取 DTO/错误日志 |
| native-file-upload.test.ts（实现未改，验证继续复用） | 6 条通过；t179 的真实本地 multipart、范围/大小、取消、变更检测、不重投 |
| timestamped-asr.test.ts | 8 条通过；供应商 fixture、预检/直接 execute 零提交失败、取消及原任务恢复 |
| tsconfig.json | 通过；最终宿主细节修改后复验也通过 |
| tsconfig.electron.json | 首次失败：主进程没有 BodyInit 全局；改用 RequestInit['body'] 后通过；最终细节修改后复验通过 |
| packages/ai-sdk/tsconfig.json | 通过，只读源码，未修改/构建 SDK |
| 改动的 11 个 TS 文件 ESLint | 通过；最终细节修改后复验受影响 5 个文件也通过 |
| check:main-imports | 通过，扫描 648 个 main/preload 文件 |

最后修改后重新运行 host-capabilities/native-stream-fetch/sdk-runtime/timestamped-asr 四个精确文件，17 条通过；未再修改的另外两份测试复用本轮有效结果，总计六文件 25 条。renderer 工程直接包含这些宿主文件，因此最终修改后再做 renderer 类型复验并通过；SDK 源码/主进程导入关系未再修改，不重复已通过检查。

## 改动文件与总管理者注意事项

| 文件 | 改动 |
|---|---|
| electron/main/index.ts | app ready 后接唯一宿主启动自检 |
| electron/main/services/ai-runtime/host-capabilities.ts | 必填宿主类型、穷尽检查表、预检错误、结构化启动诊断 |
| electron/main/services/ai-runtime/host-capabilities.test.ts | 编译期拒绝断言、启动错误聚合及实时未启用检查 |
| electron/main/services/ai-runtime/native-stream-fetch.ts | 原生有界流、取消、长度及关闭适配 |
| electron/main/services/ai-runtime/native-stream-fetch.test.ts | 本地真实 HTTP 及迭代器释放 |
| electron/main/services/ai-runtime/native-media-chunks.ts | 复用原授权根的文件元数据及分块读取 |
| electron/main/services/ai-runtime/native-media-chunks.test.ts | 范围、EOF 与授权拒绝 |
| electron/main/services/ai-runtime/sdk-runtime.ts | 一次性以必填类型组装 transport/media/runtime |
| electron/main/services/ai-runtime/sdk-runtime.test.ts | 实际组装完整性检查 |
| electron/main/services/audio-edit/timestamped-asr.ts | 共享文件识别的宿主预检及新提交复核 |
| electron/main/services/audio-edit/timestamped-asr.test.ts | 对齐完整宿主替身与流式 fixture，验证缺失时无提交 |
| docs/task/外部智能体能力开放/00-任务总览.md | 仅增加本任务一行 |
| docs/task/外部智能体能力开放/t185-SDK宿主能力与启动自检.md | 盘点、设计、验证和未补项 |

未补项：realtime.connect 及返回连接的 messages/send/close。当前没有正式实时识别入口，不能为了满足类型放空方法。后续真正接实时识别时应使用支持鉴权头和取消/关闭的成熟 WebSocket transport，并把 realtime-asr 加入启动启用集合及会话打开预检；禁止只注册模型而不实现 transport。

边界与风险：仅函数存在性自检不等于供应商可达、模型效果或用户凭据有效；这些不在本轮启动探测中。实际 Electron 日志窗口可见性依赖现有日志链，未做容器验收；本地 HTTP 夹具不代表真实供应商成功。流式/文件适配已作精确测试，没有大文件性能基准。总管理者应注意 index.ts、sdk-runtime.ts、timestamped-asr.ts 与其他任务可能冲突；集成后需构建新主进程并在自己的验收边界加载，当前运行实例尚未加载新代码。本任务不提交、不推送、不重启、不发布。
