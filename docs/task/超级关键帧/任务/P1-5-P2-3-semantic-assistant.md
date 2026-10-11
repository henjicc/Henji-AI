# t156 / P1-5 通用实体与 P2-3 文本语义

状态：部分实现，不能登记整单完成。2026-10-11。无 Git 写操作、无 SDK 改动、无付费调用、未启动或重启开发实例。

## 已实现

- 双端注册 `intent_draft / intent_take / intent_pin / intent_candidate`，由现有文档头与候选服务提供数据，不建 MCP 业务表或助手专用原稿 Store。
- 剪辑可通过正式 describe → change/invoke → read 修改原稿名称/保真度、选择示范、增删钉点、整理和选择候选、确认应用。应用继续走 `applyVideoMotion`，普通曲线与正式历史为唯一真相。
- 候选 details 读回经过原资源完整性校验的真实曲线/布局内容；`applied` 与 `saved` 分开表示应用事实和保存回执。保存失败后写 `saved=true` 调原服务恢复，不再增加作品历史。钉点批量修改失败回滚原稿头；取消传给原宿主整理器。
- 图片可读全部原稿实体、修改名称、选择预览；本地整理算法接入同一 `ImageEditLayoutDraft`。图片参数、钉点、应用的通用事务暂时显式阻断，原因见下文，不以静态登记冒充可用。
- 封闭语义计划仅允许 motion/layout/slower、保护引用和澄清问题；禁止 pins、任意命令/代码/开放 patch。原稿摘要、目标/属性、示范、否定保护和歧义在本地检查。慢一点缺目标结束时间时只请求确认，不推断作品时长。
- 讲解 JSONL 复用正式序列化，按事件类型归并分页；采用校正稿，排除被删除的讲解片段，不读取音频页或原音资源。纯文本入口关闭图像附件。语义调用失败不自动重试收费调用，受控测试验证回退本地整理。
- 能力分为 C1 本地整理和 C2 私密讲解解析/读取。C2 入口标记 internal，并保留公共授权拒绝；未降级为 C1。

## 必须由总管理者继续处理的阻塞

1. **统一 C2 授权**：`src/core/application-control/callerContext.ts` 的 `assertApplicationCapabilityAllowed` 拒绝非 C0/C1；`applicationCallerAccess` 也固定仅接受 C0/C1。该文件不在本任务所有权内。现有本机录制 consent 还需要独立、不可伪造的 textUpload/imageUpload 确认入口。不能仅修改本任务能力的 dataClasses 来绕过。需共同完成授权、Pi/MCP 目录投影与撤销后再公开 C2 能力；本任务未修改此核心文件。
2. **图片事务保存死锁**：`ImageEditLayoutDraft.configure/apply` 内部等待 `ports.confirm`；正式图片通用事务先 `ImageEditPersistenceOwnerV3.begin()`，其 `confirm()` 返回等待整批结束的 Promise。若直接在通用 mutation 中 await 现有方法，事务和步骤会相互等待。需要原服务拥有者添加可信的事务上下文/延迟确认入口，并同步替身；不能再复制一份布局应用业务。本任务未改该服务文件，发现接口与执行器明确拒绝这些路径。
3. **剪辑后台目标**：`reopenVideoMotion` 会切序列、选中片段、跳播放头；本次入口要求目标片段已被选中，避免后台隐式切页。完整后台原稿服务还应由原服务拥有者拆开“载入原稿”和“导航到原稿”。
4. **图像附加与真实语义效果**：单帧/contact sheet 的授权、实际附件消费、图像费用、完整跨批输入身份及 token 预算未完成。本轮纯文本路径不发送图像，不能声称模型已看画面。真实模型理解和 ASR 效果均未验证。
5. **语义编译范围**：剪辑当前适配单个 motion 意图与选定 take；多段时序编排、明确的新结束时间、“这里停一下”的局部区间映射没有完整接入。slow/歧义返回确认，复杂组合回退本地。图片布局语义校验和原有约束编译接线保留，但 C2 公共调用仍被授权边界阻断。
6. **整单验收**：没有新的正式 Electron 截图、留出样本或完整双端公共候选应用证据，不能引用历史截图将本轮登记为验收通过。
7. **完整 CRUD 与原稿元数据撤销**：本轮接入已有原稿的属性、示范采用状态、钉点增删和候选选择/应用；未实现原稿/示范的创建删除全闭环。剪辑作品应用已验证公共一次撤销；原稿名称等元数据由原服务刻意保留在作品撤销之外。本轮执行器提供事务补偿/撤销 token，但现有通用 change 输出未公开 undoRef，不能声称助手已能公共撤销每种元数据修改；需总管理者协调正式元数据历史与通用撤销投影，不能直接改掉采集历史语义。

## 选型

- 沿用仓内 Zod 的 strict object、discriminated union 和同源 JSON Schema 投影；[官方对象文档](https://zod.dev/api?id=objects)、[JSON Schema 文档](https://zod.dev/json-schema) 支持同一声明用于校验与工具参数。与另引入 Ajv/第二份 JSON Schema 表相比，复用已存在的模型与能力 schema 能减少漂移；未新增依赖。
- 整理和编译复用现有 Worker、P1/P2 算法与正式宿主候选服务；不另造曲线拟合器、图层布局器或播放器。
- 语义预定经已有 Pi/正式能力投影，不在 core 或 UI 直连供应商；本轮未接通实际 LLM/Pi 输入生成，受控 propose 端口只用于零付费契约验证。未增加价格表、供应商分支或付费重试。
- 钉点集合每批最多 256 是现有 `application-control/reflection.ts` 的单事务协议约束，讲解每批 128 行是输出批次预算，均不限制原稿、钉点或讲解总数。

## 设计自查

1. **助手只凭名称和说明能否用对？** 剪辑实体/本地整理已经有正式发现、修改、读回结果测试；图片阻塞动作在动态可用性中说明原因。C2 语义尚不能经公共调用使用，不宣称已通。
2. **能否 AI 先做、人只确认？** 本地算法先生成候选，用户确认后走既有应用入口；歧义、否定和缺时间槽均先确认。真实意图模型路线仍待 C2 授权和效果验收。
3. **产物能否直接流进其他工作区？** 剪辑应用仍生成普通关键帧；图片原服务仍生成正式图层变换，沿现有文档/导出流转。没有新媒体格式；本轮未单独验收跨工作区导出重开。

## 检查记录

按 testing.md L2（共享 core 契约及公共应用入口）执行；用户另明确指定七目录及原生 SQLite 验收。所有 Vitest 使用静音、隔离单 fork，避免并行争抢本机提交量。

- 新增精确测试：2 文件共 14 项，模型/进程/存储边界使用受控替身；最终结果见下。
- 正式公共结果测试：剪辑描述→名称修改→钉点→整理→真实候选内容→应用→读回→公共撤销；权限拒绝 provider 零调用、关闭实例、名称保存失败恢复、候选保存回执恢复不重复应用、过期候选拒绝、批量钉点失败补偿；图片名称读写保存与一次撤销，以及事务未接通动作拒绝。
- 语义：权限拒绝 provider 零调用、歧义先确认、否定保护、封闭 schema 拒绝非法字段/过期原稿、失败只回退一次、取消不重试、不外发原音、多次校正采用最后一版、删除片段排除及页归属拒绝。
- 门禁最初发现跨 feature 深导入增量，已改成各宿主在原 applicationDomain 出口提供适配器、渲染装配注入。覆盖最初发现 C2 不在公开目录，已明确 internal 原因，保持授权拒绝。
- 渲染 tsc 最初被并行图片讲解代码的类型错误阻断；之后两套 tsc 均通过。
- ESLint 首轮两处冗余分号已修复。
- 一轮 Vitest 因本机分页文件不足发生 worker unexpected exit，不计通过；串行降低堆后精确重跑通过。没有关闭用户程序。
- 七目录 unit：190 文件、1274 项，首轮 1273 通过、1 失败；失败揭示应用已完成后的属性 no-op 与保存回执多记历史问题，已修复。复测公共入口及原剪辑服务：2 文件、19 项通过；语义 9 项通过。无需重复运行未失效的 189 文件证据。
- `npm run test:assistant-persistence`：9 文件、83 项通过、0 跳过，使用 Electron 原生 SQLite。
- 助手能力门禁按子步骤去重复用：structure 通过；coverage/invariants 中已有的七目录证据复用，剩余与最后字段变化相关的 26 文件、159 项通过，0 跳过。最终引用校验补充后公共入口 5 项再通过。
- `npm run check:dead-code`：退出 0；1 个存量未使用文件、0 个存量未使用依赖，2110 个导出/类型仅报告，未新增基线例外。脚本仍输出已有 unlisted/unresolved 诊断，本轮没有夹带修改。
- `npm run check:dependency-graph`：最终退出 0；无新增冻结跨层边或基线例外。
- `npm run check:main-imports`：629 文件检查通过；`npm run check:ipc-contract`：352 请求、2 端口、25 订阅检查通过。
- `npm run check:ui-residue`：通过；本轮未新增或改动 TSX/正式 UI。
- 本轮 18 个 TS 文件 ESLint 全部通过，最后引用/说明调整的 3 文件也已重验；两套 TypeScript 工程通过。相关测试失败均按上述精确范围修复重验，没有把首轮失败隐藏成全程零失败。
- `assistant:cli` 未执行：实际 `electron/main/assistant-cli/embedded-runner.ts` 会选择已配置模型并调用 `service.prompt`；read 权限不代表免费，当前无受控模型 CLI 路径。按零付费约束跳过，不把静态描述测试等同真实 Pi 自主发现效果。

## 本任务文件

- `src/core/creativeIntent/semanticIntent.ts`：封闭计划、本地审阅和授权/失败回退契约。
- `src/core/creativeIntent/semanticIntentRecording.ts`：受授权的讲解分页投影、校正/排除和指代核验。
- `src/core/creativeIntent/semanticIntent.test.ts`：零付费语义保护测试。
- `src/core/creativeIntent/recordingSerializer.ts`：支持显式关闭图像附件投影。
- `src/core/application-control/domains/creativeIntent/creativeIntentCapabilities.ts`：双端本地整理及内部 C2 能力声明。
- `src/core/application-control/builtinApplicationCapabilityRegistry.ts`：登记上述能力。
- `src/features/application-control/creativeIntentHost.ts`：公共宿主端口和稳定实体引用。
- `src/features/application-control/creativeIntentFields.ts`：同源字段描述、读取与写表。
- `src/features/application-control/creativeIntentReflection.ts`：双端实体反射、schema、可用性与分页。
- `src/features/application-control/creativeIntentMutationExecutors.ts`：正式属性写入、结果、应用级联与撤销。
- `src/features/application-control/creativeIntentCollectionExecutor.ts`：钉点集合增删及补偿。
- `src/features/application-control/creativeIntentDomain.ts`：通用装配、讲解读取和候选算法处理器。
- `src/features/application-control/creativeIntentDomain.test.ts`：真实公共入口结果验证。
- `src/features/application-control/applicationDomains.ts`：装配宿主与新领域。
- `src/features/videoEdit/application/videoEditCreativeIntentReflection.ts`：剪辑原服务适配。
- `src/features/videoEdit/application/applicationDomain.ts`：公开宿主适配器，并将仅保存回执变化排除在新增作品历史之外。
- `src/features/imageEdit/v3/application/imageEditCreativeIntentReflection.ts`：图片原服务适配和保存屏障拒绝。
- `src/features/imageEdit/application/applicationDomain.ts`：公开上述宿主适配器用于装配。
- `docs/rules/assistant-status.md`：如实登记新增通路与未接通边界。
- `docs/task/超级关键帧/02-实施拆分.md`：仅追加 t156 状态行。
- 本文件：任务设计、证据与交接边界。


## t158 接通

2026-10-11，状态：部分接通，待总管理者审查；不能登记整单完成。未执行 Git 写操作、未修改 SDK、未跑 Reality/assistant:cli、未启动或重启开发环境、无真实付费调用。

### 本轮实现与覆盖分级

- C2 原等级保留；统一 caller grant 增加可信宿主 policy，连接权限和会话 textUpload consent 共同成立才放行，每次使用及读取资源后复核，撤权同时取消在途请求。C2 能力进入正式目录；工具参数不能创建授权。普通原稿属性和增删为通用实体覆盖，语义整理仍是既有算法能力。
- JSONL 与必要受管图像经同一公共工具返回，再转换为 Pi 原生 image 内容块；沿正式 Pi 模型、费用/额度及工具授权通路，不新增供应商 client，不读取原音。连续文字及图片分页完成后才发 inputReceipt；过期/遗漏输入不能提交封闭计划。长句分片而不截断；模型不支持视觉时不交付图像完成回执。
- 附图按未解决指代与外观请求挑选，区分不同时间/visit/状态，按最多 3 帧常规批次传输；既有多帧拼图先按每帧矩形裁取原像素，逐帧缩放至长边不超过 640px 并继续分批，不因六帧预算截掉未解决指代，单附件校验 2.5MP 像素预算。manifest 保留时间、指向与缩放后的矩形；尚未完成图内图注/指针叠层及复杂指代前后帧最优挑选，不能把此项称为 §6.1 全部完成。
- 图片 configure/apply 复用 ImageEditLayoutDraft；事务内步骤登记保存后回调并立即返回，整批统一确认，消除原保存互等。失败保持应用事实，恢复只确认当前快照，不重放图层修改、不增加作品历史；公共 saved 由持久化 owner 的真实确认状态投影。
- 共享事务引擎在所有业务步骤完成而保存失败时也保留 undoRef；change_application_entities 返回 undoRef，新增领域无关的 undo_application_changes，核对连接归属、原事务权限和版本。原稿名称、钉点与原稿增删通过公共入口撤销；剪辑原稿可从同文档真实示范复制创建/删除，示范可复用同目标/同采集时钟证据、删除并清理关联钉点。删除同步原宿主缓存，避免复活被删原稿。图片静态 take 仍只读，不能声称完整双端 CRUD 已完成。
- 封闭计划错误摘要和不能编译的组合回退本地整理；真实 Pi SDK 通过本机受控 HTTP/SSE transport 验证讲解和 JPEG 字节确实进入模型请求。没有外部模型请求，真实理解质量未验证。Pi 上游网络/模型失败后的自动本地降级尚未在生产调度层接通，不能仅凭 core propose 替身称其完成。

### 需要协调的阻塞

1. 私密正文写入与公共撤销尚未接通。图片 ImageEditExplanation 当前校正会等待原 confirm，且内存 collector 会覆盖直接修改的文档头；需要 t157 提供事务内校正及恢复会话接口。已在会话中请求总管理者协调，未越权修改 imageEditExplanation*.ts/editor/recording。
2. textUpload/imageUpload 的本机可信确认入口仍缺失，现有新建会话默认 false；本轮只消费授权事实，未将其改成默认授权，也未开放让助手自行写 true 的旁路。因此普通新录制会话会被正确拒绝，不能宣称用户语义闭环已可用。
3. 公共 undoRef 当前为当前宿主进程内回执，重启后应沿正式历史恢复；共享引擎已补“业务全部完成、仅保存失败”的公共撤销回执，图片已验证失败→恢复保存→原公共回执撤销；部分执行或补偿后的事务不会冒充全事务可撤销。
4. 两端后台整理仍要求原宿主有效；剪辑要求目标片段已选中，不隐式切换编辑目标。未覆盖真实 Electron、真实图像编码像素效果、真实模型/ASR 效果和完整跨工作区视觉验收。

### 选型与设计自查

沿用现有 Zod 封闭 schema、官方 Pi SDK、原通用事务引擎、图片持久化 owner 和布局服务；图片转码复用 Chromium 原生 createImageBitmap/OffscreenCanvas，不新增依赖/模型执行器。与引入第二套审批、LLM client、图片保存器相比，此选择保留原权限、费用与恢复责任；本轮没有新的算法库选型。

1. 助手只凭名称和说明能否用对？已接通入口说明了读取分页、图像授权、完整输入回执、候选确认与保存恢复；正文写入尚未注册，不能声称全套可用。
2. 能否 AI 先做、人只确认？本地整理和封闭计划先出候选，歧义/否定保护先确认，应用仍沿原工具；本机外发同意必须由用户完成，当前 UI 入口待协调。
3. 产物能否直接流进其他工作区？应用产物仍是原图片文档/普通剪辑曲线，沿已有资源与作品链路流转；本轮无新中间作品格式，跨工作区真实验收未运行。

### t158 检查结果

按 testing.md L2（统一授权、公共契约与持久化屏障）及本次用户指定目录执行；分目录、单 fork、--silent，不运行全量/Reality。最终以下记录去重复用本轮已通过且未失效的精确证据，历史 t156 证据不替代本轮。

- core/creativeIntent：首轮 13 文件 122 项中 1 项同步授权时机失败，恢复同步前置检查后精确重跑通过；本轮新增的拼图分批测试也通过。
- core/application-control：28 文件 146 项 + callerContext 1 项通过；共享引擎补保存失败 undoRef 后，engine/failureReporting 17 项再通过。
- features/application-control：16 文件 96 项 + creativeIntentDomain 9 项 + creativeIntentImages 1 项通过；公共失败回执修复后 domain 9 项与 adapter 16 项已精确复验。
- src/tests：20 文件 82 项通过，1 文件/1 项既有性能基准按默认配置跳过，0 失败。
- videoEdit/application：77 文件 629 项通过，1 文件/1 项既有性能基准按默认配置跳过，0 失败。
- 两套 tsc 在最后共享引擎改动后均通过；本轮曾修复新测试 afterEach 返回 VitestUtils 的类型错误。
- 图片输入/Pi 新测试 32 项首轮 31 通过、1 项测试夹具缺 pointer 失败，补显式 pointer:null 后对应 5 项通过；Pi SDK transport 的 25 项通过，无外部付费请求。
- check:assistant-capabilities:structure、check:main-imports（629 文件）、check:ipc-contract（352 请求/2 端口/25 订阅）、check:persistence-compat（41 格式）、check:ui-residue 通过。
- check:dead-code 退出 0：1 个存量未使用文件、0 个存量未使用依赖、2113 导出/类型仅报告；另有既有 unlisted/unresolved 诊断，未改基线。
- check:dependency-graph 首轮失败于并行 t157 的三条讲解面板跨 feature 导入；对方随后改为公共 index 入口，本轮复验退出 0（363 条跨 feature 非 index 导入，0 条冻结跨层边）。未修改对方文件或扩大基线。
- imageEdit/v3/application：剩余 24 文件 120 项通过、1 项既有分页性能基准跳过；复用本轮 owner 10 项和 layout 8 项，目录共 26 文件、138 项通过、1 项跳过，0 失败。
- embedded-agent：剩余 6 文件 29 项，加 Pi 25 项及 toolResult 5 项，8 文件 59 项全部通过。
- 七目录按去重证据合计 193 文件、1283 项通过、3 项既有性能基准跳过，0 个未解决失败；不将跳过的性能基准称为已验证。
- npm run test:assistant-persistence：9 文件、83 项通过、0 跳过。只使用无窗口原生 SQLite 运行器，没有启动开发实例。
- check:assistant-capabilities 按 structure / coverage / invariants 去重完成：structure 通过；coverage 13 项复用本轮 core 目录；invariants 复用已通过目录项，剩余 22 文件加共享引擎受影响的 2 个公共失败测试，共 24 文件 134 项通过。没有以命令尚未运行或历史结果冒充门禁通过。
- 本轮文件 ESLint 已通过，最后修改文件也分别补验。图片目录命令首轮重复传 --exclude 被当前 Vitest CLI 拒绝，没有执行测试；改用单个 brace glob 后继续。

### t158 文件清单

- `electron/main/services/embedded-agent/piEngine.test.ts`：正式 Pi SDK 配受控本机 HTTP/SSE transport，验证正文和图片进入真实消息。
- `electron/main/services/embedded-agent/toolResult.ts`：将公共语义附件转换为 Pi 原生图片，拒绝无效附件及无视觉完成回执。
- `electron/main/services/embedded-agent/toolResult.test.ts`：补充图像字节隔离、非视觉模型与无效附件边界。
- `src/core/application-control/callerContext.ts`：统一可信 C2 policy、实时撤权与不可变 grant。
- `src/core/application-control/callerContext.test.ts`：验证 C2 默认拒绝、可信放行、伪造/撤权/写权限拒绝。
- `src/core/application-control/domains/creativeIntent/creativeIntentCapabilities.ts`：正式发现、图文批次与封闭计划输入回执契约。
- `src/core/application-control/domains/shared/applicationReflectionApplicationCapabilities.ts`：公开通用 change 的 undoRef 与通用撤销能力。
- `src/core/application-control/externalCapabilityPolicy.ts`：允许 C2 元数据发现，执行仍受统一 grant 约束。
- `src/core/creativeIntent/semanticIntentRecording.ts`：长 JSONL 记录分片，保留同步授权前置检查。
- `src/core/creativeIntent/semanticIntentInput.ts`：必要视觉选帧、拆分既有拼图与像素预算。
- `src/core/creativeIntent/semanticIntentInput.test.ts`：验证跨批不丢帧、不同时间不误去重、矩形缩放及大拼图分批。
- `src/features/application-control/applicationCapabilityService.ts`：正式能力发现不再一刀切隐藏 C2。
- `src/features/application-control/capabilities/applicationReflectionAdapter.ts`：同连接事务撤销回执与版本核验。
- `src/features/application-control/capabilities/registry.ts`：通用撤销处理器注册。
- `src/features/application-control/creativeIntentAuthorization.ts`：从正式会话同意与当前宿主构建可信授权检查。
- `src/features/application-control/creativeIntentCollectionExecutor.ts`：原稿/剪辑示范增删与公共撤销，读取冲突不回滚外部编辑。
- `src/features/application-control/creativeIntentDomain.test.ts`：公共 C2/原稿 CRUD/元数据撤销/双端保存恢复结果回归。
- `src/features/application-control/creativeIntentDomain.ts`：连续图文读取回执、授权复核、必要附图和集合执行器接线。
- `src/features/application-control/creativeIntentFields.ts`：配置/应用透传事务上下文，增加复用源引用属性。
- `src/features/application-control/creativeIntentHost.ts`：宿主保存/恢复/视觉资源端口及保存回执投影。
- `src/features/application-control/creativeIntentImages.ts`：原生图像编解码、按帧裁切和 manifest 坐标转换。
- `src/features/application-control/creativeIntentImages.test.ts`：裁切/缩放、原稿不变与编码失败释放测试。
- `src/features/application-control/creativeIntentMutationExecutors.ts`：向原业务 writer 传递统一执行上下文。
- `src/features/application-control/creativeIntentReflection.ts`：移除已修图片事务阻断，注册原稿与示范集合写入。
- `src/features/application-control/localApplicationHost.ts`：在可信唯一宿主入口创建私密授权，撤权取消在途任务。
- `src/features/imageEdit/v3/application/imageEditCreativeIntentReflection.ts`：图片原布局服务事务接线、保存恢复与受管附图读取。
- `src/features/imageEdit/v3/application/imageEditLayoutDraft.ts`：原布局配置/应用支持事务内延迟确认。
- `src/features/imageEdit/v3/application/imageEditPersistenceOwner.test.ts`：批次无互等、失败恢复与无效事务范围回归。
- `src/features/imageEdit/v3/application/imageEditPersistenceOwner.ts`：统一保存屏障后回调与真实保存状态。
- `src/features/videoEdit/application/videoEditCreativeIntentReflection.ts`：元数据提交同步宿主、原应用恢复及视觉资源读取。
- `src/features/videoEdit/application/videoEditMotionDraft.ts`：必要范围扩展：删除或改变示范后同步原宿主缓存，防止复活已删数据。
- `docs/rules/assistant-status.md`：登记已接通部分并保留正文授权写入等欠账。
- `docs/task/超级关键帧/02-实施拆分.md`：仅更新 P1-5 的 t156/t158 状态行。
- `docs/task/超级关键帧/任务/P1-5-P2-3-semantic-assistant.md`：在末尾追加本节及验证/风险/设计自查。

- `src/core/application-control/execution/engine.ts`：必要共享范围扩展，保存屏障失败后保留完整业务事务的撤销回执，不给部分/已补偿执行伪造整组撤销。

### t158 交接结论

35 个文件留在工作区，交总管理者审查及 Git 提交。代码与单测阶段已结束，以上明确欠账仍在；不得把“七目录零失败”写成整单完成。主进程 toolResult 已改变，后续实际验收须由总管理者构建新产物；本轮按要求不 bundle、不跑 Reality、不启停开发实例。共享引擎新增分支的排查覆盖完整执行后保存失败、部分失败报告、公共回执归属、图片恢复及原回执撤销；未扩展为全项目审计。

## t166 部分接线，待协调

2026-10-11。本轮仅在 `D:/VibeCode/henji-wt-batch` 的 `codex/minimal-batch` 工作区修改指定文件；没有 Git 写操作、SDK 修改、依赖安装、付费调用、Reality、构建或开发实例启停。**t166 未完成，不能按本节测试通过判断已经满足实际使用的隐私闭环。**

### 已实现

- ExplanationPanel 增加最小 UiModal：指定标题、发送文字/画面数量/模型/费用一行、一次会话复选框，以及取消/发送两个按钮。预检不返回外发请求时直接沿原本地生成；取消不生成，发送防重复，宿主切换使旧预检失效。`prepareGeneration` 是待生产宿主提供的入口，当前没有真实调用方，组件不自行伪造模型、费用或会话同意。
- 双端注册 C2 `explanation_body`，校正词稿和完整绑定走既有通用属性与事务执行器，不新增专用助手工具。读取/写入仍要求连接权限和当前会话 textUpload 同意，不把正文降为 C1；UI 修改使用同一个事务引擎。词稿追加不可变校正事件，保留原文、时钟和指向，读回投影为最新校正。
- 活跃图片宿主支持事务内确认和正文恢复，并同步普通撤销后的 collector，防止下一次保存覆盖已撤销的正文。剪辑修改透传通用事务上下文，不额外重复保存。通用事务执行器的单步撤销有精确证据。
- 删除事件失效所有会捕获该会话正文的通用意图撤销令牌；剪辑仍沿既有全历史与文件擦除。图片只删除当前头和失效通用令牌，尚未擦除命令历史中的正文/画面。

### 文件所有权之外的阻塞

已通过会话问题请求协调，未得到扩大文件所有权的答复，因此以下文件没有修改：

1. `src/features/creativeIntent/ui/CreativeIntentControls.tsx` 属于 t165；需实际消费 `prepareGeneration`，从真实生产模型请求生成预检，并将用户同意写入 t158 会话 consent。两个现有“生成候选”应用函数均为本地整理，当前不会外发，也没有模型路径可由弹窗确认。
2. `src/features/application-control/capabilities/applicationReflectionAdapter.ts` 需用真实公共 undoRef 和原目标调用 `rememberExplanationUndoAccess`。当前只有通用引擎内部撤销已验证，公共助手撤销的 C2 grant 尚未生产接通；不能把单测中手动注册映射当成正式接线。
3. `src/features/imageEdit/v3/application/imageEditCommandBus.ts` 与其历史领域需提供针对会话的彻底擦除，覆盖冷历史、撤销/重做、页资源和历史画面；当前普通图片历史仍可能恢复已删除会话，**不能宣称删除后不可找回**。
4. 两端 `*CreativeIntentReflection.ts` 需给冷宿主提供正式正文编辑端口；当前未打开原讲解的宿主明确只读。共享外部实体目录的 C2 属性过滤也需要总管理者核对，未以降低等级绕开。
5. `electron/main/services/embedded-agent/piEngine.ts` 等正式模型调度需要失败后调用已有本地整理回退；本轮没有生产接线，仅确认原 core fallback 精确测试通过，**模型失败自动降级仍未完成**。

### 选型与设计自查

复用现有 UiModal/UiCheckbox、Zod、Application Control 通用属性/事务与两端 collector；不需要新增 npm 依赖，也不创建第二套模型调用、授权或保存框架。本文说明选型依据，不另建文档。

1. 助手只凭名称和说明能否用对？正文属性使用“校正词稿”和“确认讲解指向”，明确读回 eventId 和完整绑定；已接通的活跃宿主事务可用，公共 C2 撤销与冷宿主仍需接线，不能称全套可用。
2. 能否 AI 先做、人只确认？沿原生成候选和指向校正；外发弹窗只留一个主操作，外发同意必须由人完成。生产模型预检和同意保存尚未接通。
3. 产物能否直接流进其他工作区？校正仍写原私密会话，候选仍是既有 MotionDraft/图片布局；不增加中间作品格式，本轮没有跨工作区或真实视觉验收。

### 检查结果

按 testing.md L2 的权限/共享事务及用户指定五目录执行；Vitest 使用 `--silent --pool forks --minWorkers 1 --maxWorkers 1` 分目录，复用本轮有效证据，不跑全量或 Reality。

- `src/core/creativeIntent`：18 文件、149 项通过。
- `src/features/creativeIntent`：7 文件、29 项通过。
- `src/features/application-control`：普通 Node 下 19 文件、108 项通过；原生 `mcpWriteIntegration` 不能在普通 Node 收集，随后由正式原生运行器补验通过。最后正文与外部目录精确复验：2 文件、10 项通过。
- `src/features/videoEdit/application`：80 文件通过、1 个既有性能基准文件跳过；650 项通过、1 项跳过。
- `src/features/imageEdit/v3/application`：26 文件、145 项通过、1 项既有性能基准跳过。图片测试只 mock 通用 writer 接线边界；真实 adapter 校正/读回/collector 恢复有证据，通用引擎事务由独立正文测试覆盖。
- `npm run test:assistant-persistence`：9 文件、83 项通过、0 跳过；无窗口原生 SQLite runner，未启停用户开发实例。五个指定目录没有未解决失败，默认跳过的性能基准不计为已验证。
- 两条 `npx tsc -p tsconfig.json --noEmit` / `npx tsc -p tsconfig.electron.json --noEmit` 均通过。渲染层首轮曾被并行 t164 测试 hook 返回值阻断，对方修复后复验通过。
- 11 个本轮源代码/测试文件 `npx eslint <files> --max-warnings 0` 通过，0 警告。
- `check:surface`、`check:ui-residue` 通过；`check:assistant-capabilities` 按 structure/coverage/invariants 去重覆盖：structure 通过，复用应用控制及图片目录相交项，剩余 coverage/invariants 26 文件、170 项通过。
- `check:persistence-compat` 最终通过：41 种格式。首轮被并行任务 video_edit/subtitle 指纹变化阻断；对方更新基线后复验通过。本轮未改持久 schema，没有自己的 dev-break/黄金样本变更。
- 首轮 Vitest 仅传 maxWorkers 与默认 minWorkers 冲突、一个断言使用当前 Vitest 不支持的方法，均已修正并补验；正文候选绑定的对象键序比较问题改为 schema 规范化比较并复验。未将失败记录隐藏为成功。

### t166 文件清单与交接

- `src/core/creativeIntent/semanticIntentEdits.ts`：正文修改 schema、活跃宿主编辑桥与删除失效通知。
- `src/features/application-control/creativeIntentExplanation.ts`：双端 C2 正文实体/属性、通用事务执行器和 UI writer 接线。
- `src/features/application-control/creativeIntentExplanation.test.ts`：真实引擎的双端授权、读写、撤销、擦除失效与伪造引用检查。
- `src/features/application-control/creativeIntentDomain.ts`：注册双端正文实体及执行器。
- `src/features/application-control/creativeIntentAuthorization.ts`：基于会话同意的正文授权、纯目录发现及待消费的撤销映射。
- `src/features/application-control/creativeIntentMutationExecutors.ts`：正文删除后失效捕获该私密会话的原通用撤销令牌。
- `src/features/creativeIntent/ui/ExplanationPanel.tsx`：最小外发确认组件与宿主过期保护。
- `src/features/creativeIntent/ui/ExplanationPanel.test.tsx`：本地/确认/取消/复选框/重复发送及切换宿主测试。
- `src/features/imageEdit/v3/application/imageEditExplanation.ts`：正文校正、事务内保存和 collector 撤销同步；删除通知。
- `src/features/imageEdit/v3/application/imageEditExplanation.test.ts`：校正、重开、审阅读回、普通撤销和删除后 editor 失效测试。
- `src/features/videoEdit/application/videoEditExplanation.ts`：词稿/绑定改走正文事务，校正恢复与原隐私擦除通知。
- `docs/rules/assistant-status.md`：登记正文事务的部分进展与尚未接通的路线。
- `docs/task/超级关键帧/02-实施拆分.md`：只更新第七节本任务“讲解外发确认、私密正文写入与撤销”行。
- `docs/task/超级关键帧/任务/P1-5-P2-3-semantic-assistant.md`：末尾追加本节。

以上 14 文件交总管理者审查，未暂存/提交/推送。同源排查覆盖两端词稿/绑定、校正后读回、collector 与历史切换、通用正文事务及捕获私密会话的元数据撤销；没有扩大为全项目审计。生产外发/公共 C2 撤销/图片私密历史擦除/生产模型降级未完成，需先协调上述文件再交用户实际使用。Electron 截图与最终运行产物由总管理者统一处理。
