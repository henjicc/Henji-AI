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
