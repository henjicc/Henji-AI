# P1-image · t147 图片持久化与随手摆

日期：2026-10-11。工作区：main，共享脏工作区；本单不暂存、不提交、不推送，Git 由总管理者处理。

## 当前结论

图片存储和随手摆领域适配、两个可写宿主接线已实现，内部精确验证及最终指定目录广测通过：962 文件、6183 用例通过，0 失败；另跑原生 SQLite 9 文件、83 用例通过。**尚未完成 P1-3 独立验收**：未运行真实 Electron 双宿主截图/逐帧序列，R04 真人留出和 §5.5 盲评未执行，端到端呈现/滑杆/边缘采样预算未测。通用实体注册与正式助手结果回读由 P1-5 接收，不以内部 adapter 或共享门禁通过冒充已打通助手。

## 实现与关键决定

- 文档 v11；工作副本 v14；独立图片包与画布图层包 v12。按开发期 dev-break 登记，不加迁移。草稿头进入正式 schema；样本、完整几何和候选以不可变内容寻址 JSON 资源保存。
- 新 document.set-creative-intents 走既有命令/逆命令/分页历史。current、undo、redo、应用引用统一收集资源；输入/基态/几何摘要不是文件引用。仅正式图片文档的 creativeIntents 和草稿命令的 intents 字段特殊解释，普通效果参数中同名字段保持通用 JSON 行为；实际保存、fork、ZIP 复制/导出/重开与 GC 回归覆盖其资源存活。
- 保存、工作副本 fork、图片包复制/移动/导入、画布图层包复制/导入均沿既有仓库/ZIP 通路；新身份逐页重绑资源、候选输入身份、目标和双向历史引用。发布租约保持到保存完成，发送方退出和文档关闭释放，复用原 GC/日志通道。
- 复用 core/creativeIntent 的 Kiwi/硬约束消元内核，不改其生产实现；图片只包装“真实边缘对齐”“边缘等距”“保留主图”候选。原有图片编辑只有移动吸附，检索未发现独立的对齐/分布命令；没有另造第二套对齐内核，移动吸附保留原语义。采用既有成熟求解器和正式矢量栅格 Worker，不新增依赖。
- 对原始 mip0 Alpha 分瓦片取四个世界轴支撑点，使用正式 little-endian RGBA float32 瓦片，不把高位深的极小非零 Alpha 量化到 8 位而漏边缘；不透明源复用元数据快路，稀疏覆盖替换源图单元，擦除后的空瓦片不会继续计入旧边缘。矢量内容复用正式文字 shaping、路径解释与栅格器。
- 矢量粗扫描区域覆盖完整外描边、偏移阴影和文字背景/基线/字形外伸；修复原半线宽范围截断外描边的同源问题。保守范围只用于扫描，最终边缘来自正式栅格 Alpha，不把粗框当成候选几何。
- 保存完整 local/parent/world affine，语义 pose 只作摘要；候选仅改变平移，通过祖先逆矩阵写局部 e/f，a/b/c/d 原值保留。组与其已选子层去重；组内子层、裁剪输出、镜像、祖先变换、锁层/锁子树均覆盖。不改组结构、字体、层级或阅读顺序。
- 预览写 override，不写作品；最终全部图层平移与应用记录放在一次 document.atomic 内，一步撤销。保存失败进入“重试保存”，不重复应用。
- 举一反三检查重开已应用草稿：候选相对原稿的零位移不能当成相对当前作品的无操作；预览与应用都逐层比较完整绝对姿态，零位移候选也正确恢复原稿，一次撤销回到应用前作品。
- full 工具箱宿主和 canvas-edit 画布图片宿主共用 command bar、同一布局 adapter、已有 CreativeIntentControls/Overlay；quick/mask 不开放可写布局入口。钉点明确是“所选图层的原稿位置”。
- 首次整理明确至少三个独立目标；已有草稿时，选单独主图准备钉住后再次整理沿用原稿完整目标，不误当单图新布局。
- 静态残影使用真实世界轴边缘包围框；Alpha 支撑点可以重复，不能直接误连为三角形。钉点位于包围框中心，已有组件回归；不把包围框称为完整像素轮廓。
- 资源页按 64 条分批、单资源 4 MiB 作为 IPC/JSON 工作块技术预算，完整目标集合无产品数量上限；1000 层验证最后一层不截断。Worker 计算可取消，空闲 10 秒释放。

## 对外接口

覆盖分级：两个新面板入口属于**覆盖核对**；布局草稿头/页及优化/应用流程属于**能力增量**，需要 P1-5 完成正式实体、属性/集合和算法执行器的同源注册。本单不把接口接线当成完整覆盖，不复制业务 schema 或另加专用增删工具。

- src/features/imageEdit/index.ts 导出 getImageEditLayoutDraftV3(documentId)，要求正式图片实例仍存活，惰性取得同一领域适配器。
- ImageEditLayoutDraft：snapshot/subscribe、organize(ids)、preview(candidateId)、configure({fidelity,pinIds,unpin})、apply()、cancel()、reopen(draftId)。
- 新 document.set-creative-intents 叶子命令包含正式资源描述；业务应用复用 document.atomic。
- 已有 ImageEditorV3 PAL 增加布局资源 write/read/release；没有新上传链或独立文件服务。
- P1-5 可复用这些接口注册通用实体读写和 optimize 算法；本单没有新增旧式 Agent 工具。

## 基准与验收矩阵

| 项 | 本单证据 | 判定边界 |
|---|---|---|
| S13 | 粗摆三层、实际边缘等距、override 隔离、原子应用、一步 undo/redo、Alpha 边缘几何精确测试 | 内部先验通过；真实文字/多图混排画面未验 |
| S14 | 硬钉点与硬对齐冲突拒绝且可继续恢复；不改锁层 | 精确受控负例通过 |
| S17 | 工作副本/分页历史、fork、图片包改 ID、移动、真实 ZIP 导出重开、画布图层包复制重绑、GC、redo 存活 | 正式磁盘链通过；真实宿主保存重开像素未验 |
| S18 | 1000 层、16 页、最后目标 l999；Worker 取消/释放 | 无截断；超大真实媒体全链峰值未测 |
| R04 | 无真人留出输入、盲评或手调对照 | 未完成，不用合成案例替代 |
| §6 100 层 | 5 次预热、30 次记录；Node worker_threads 真实线程；CPU P95 1.9469 ms，往返 P95 2.0715 ms | 仅候选求解/传输，未含 Alpha 获取、IPC 保存、React/Electron 呈现 |
| §6 内存 | 单轮最大 heap 增量 2,633,952 bytes；共享进程 RSS 单轮最大增量 1,675,264 bytes | 增量数据，非完整链路可独立归因峰值 |
| §6 A/B/滑杆 | 组件语义与切换不叠加已验证 | 真实 P95≤100/300 ms 未测 |

基准命令：设置 HENJI_LAYOUT_BENCHMARK=1 后运行 src/core/imageEdit/v3/layoutCandidates.benchmark.test.ts，silent，threads 1–3。默认广测中的专项基准 skip 不能算实测；该基准已单独通过。

## 截图、逐帧序列与目视结论

**截图数量 0，逐帧序列数量 0，目视结论未形成。** 通用执行规则明确不跑 Reality、不启动/重启 electron:dev；验收同时要求真实截图，已请求澄清但截至本单记录未得到回复，因此不自行越过禁令。没有使用浏览器、组件 DOM 或工具箱图片冒充 Electron 画布宿主。

需总管理者/P1-5补验的两个真实入口，各自独立执行：粗摆 → 整理 → 候选切换 → 钉住 → 应用 → 一次撤销 → 保存重开。逐张核对：真实边缘等距、非均匀仿射/祖先与裁剪坐标、钉住不动、原稿/候选区别、一次撤销全姿态恢复、重开原稿与候选一致。没有稳定画布节点目标时不得猜 ID 或创建无关工程。截图锁只在实际 Reality 轮次持有，跑后立即释放。

## 检查记录

风险分级采用 testing.md L2：持久化 schema、共享命令/撤销契约与跨 IPC 的文件 I/O、取消和异步保存，运行两套 tsc、精确回归与相应门禁。指定验收目录广测依据 testing.md L3 的“用户明确要求全量验证”升级，仅执行本单用户列明范围；不由此追加构建、启动开发环境或 Reality。

- 精确领域/存储：layoutDraft 7、layoutPersistence 1；AlphaGeometry 5、WorkerClient 2；控件 5、残影 1；原预览交互/呈现、命令/codec/reducer/resourceRoles、正式 repository/ZIP/history/publication/画布包回归均通过，详见执行报告。
- 同名参数收集/复制修复后，layoutDraft 7、layoutPersistence 1、smartContent 5 共 13 项通过；浮点 Alpha 修复后，AlphaGeometry 5 与正式 source-color-boundary 5 共 10 项通过。两套 tsc、文件级 ESLint、main-imports/dependency-graph/dead-code 已按最后受影响范围补查通过。
- 当前黄金样本/正式 ZIP：persistence 88、persistence-golden 5 通过；两处 imageMark 版本断言随正式常量更新，6 用例通过。
- 两条 tsc：tsconfig.json 与 tsconfig.electron.json 均通过；修改后的主进程重绑已单独补查主进程 tsc。
- 本次 TS/TSX 文件 ESLint 通过，后续黄金生成器补改亦通过。
- check:dependency-graph、check:ui-residue、check:surface、check:colors、check:icons、check:persistence-compat（41格式）、check:main-imports（629文件）通过。
- check:dead-code 通过，保留报告中的存量 unlisted/unresolved 提示；不清理其他任务文件。
- check:assistant-capabilities：structure 通过；coverage 13 用例通过；invariants 31 文件 206 用例通过。此门禁没有代替 P1-5 新实体反射验收。
- test:assistant-persistence：正式原生 SQLite 运行器 9 文件 83 用例、0 skip、0 失败通过。
- 指定第一轮广测：9 文件失败 / 946 文件通过 / 20 文件跳过；4 断言失败 / 6136 通过 / 80 跳过。5 文件是原生边界必须由 Electron SQLite 运行器执行；2 个版本断言、1 个缺失 ZIP 已修并精确复测通过；并行 video explanation 的重复 schema 注册由其负责人修复，MCP 集成精确复测通过。
- 第二轮广测：同原指定目录，silent、threads 1–3，仅排除正式 NATIVE_TEST_FILES 9 文件并由上述原生运行器单独验证。运行中退出码 1，未形成完整统计，不能算通过；当时系统提交量 95%，退出原因不能仅据此归因。首次尝试重复 --exclude 被当前 CLI 拒绝，未执行测试；已改为单个 brace glob。
- 第三轮广测：同第二轮范围，改为 threads 1–1，测试进程单次 NODE_OPTIONS 附加 max-old-space-size=1536，降低内存提交压力；不改变持久环境、不关闭用户程序。1 文件失败、959 通过、15 跳过；1 用例失败、6172 通过、45 跳过，2164.80 秒。唯一失败为并行 src/features/videoEdit/application/videoEditExplanation.test.ts 的“彻底擦除失败仍保留待清路径，重试会完成而不会复活历史”断言期望 0、实际 2；其负责人随后更新文件，本单对当前文件精确复测 6 用例全部通过，未修改该文件。保留历史失败，不宣称该轮零失败。
- 第四轮广测：为落实交付前完整轮次零失败，当前目录重新执行，threads 1–2、同一临时堆预算、仅排除上述已由原生运行器验证的 9 文件。962 文件通过、15 文件跳过，6183 用例通过、45 用例跳过，0 失败；1123.53 秒，07:37:00 开始。最新图片领域/存储、浮点 Alpha、残影和控件均在本轮通过；现有条件跳过不冒充原生设备、真人或端到端呈现证据。
- dev-break 命令已登记 image-working-copy、image-package、canvas-layer-package，reason：t147 图片布局草稿头、不可变几何页与候选接入正式存储，开发期升版不迁移旧数据。

最终广测的可复现命令（PowerShell；堆预算仅该测试终端生效）：

```powershell
$env:NODE_OPTIONS=(($env:NODE_OPTIONS+' --max-old-space-size=1536').Trim())
npx vitest run src/core src/features/imageEdit src/features/imageMark src/features/maskEditor src/features/canvas/imageEditV3 src/features/creativeIntent src/features/videoEdit src/features/application-control src/tests src/components electron/main --silent --poolOptions.threads.maxThreads=2 --poolOptions.threads.minThreads=1 --exclude '{electron/main/services/asset-library/schema.storage.test.ts,electron/main/services/application-runtime/operationStore.test.ts,electron/main/services/application-runtime/mediaResources.native.test.ts,electron/main/services/ai-runtime/generation-submissions.test.ts,src/features/application-control/mcpWriteIntegration.test.ts,electron/main/services/assistant/memory-store.test.ts,electron/main/services/logging/agent-trace-store.test.ts,electron/main/services/documents/index.native.test.ts,electron/main/services/db-migrations.native.test.ts}'
npm run test:assistant-persistence
```

## 未完成项与总管理者注意

1. 双真实宿主截图、逐帧目视、R04 真人留出、§5.5 省操作/盲评及完整 §6 端到端预算未完成，不能登记整个 P1 或 P1-3 通过。
2. 蒙版、剪贴、非线性变形、启用滤镜以及含整体效果的组暂不支持“真实边缘整理”，明确拒绝；祖先同类状态也拒绝。普通实际 Alpha/矢量本体支持，整幅合成栈效果或混合模式最终可见边缘没有端到端证据，不夸大支持范围。
3. 应用记录 operationRef 使用 creative_intent.application/atomic commandId，receiptRef 暂为文档归属，saved:false 保守保留；真实保存后未补正式 operation receipt，也不自动改成 saved:true。由 P1-5 统一决定保存回执与通用实体回读契约；不能把该记录当正式助手成功凭据。
4. 最新 UI 读回最新 static 草稿；完整草稿集合 CRUD/删除、实体覆盖与助手操作由 P1-5 接收。本单提供领域入口，没有擅改公共 registry 或 assistant-status。
5. 新增主进程/preload IPC 与存储代码需总管理者在正式验收前生成最新运行产物；本单遵守禁令未启动、重启或关闭开发实例，未关闭用户程序，未付费。
6. 持久化/黄金生成器/共享候选控件是并行公共文件，提交时必须逐 hunk 审查并保留其他任务改动；未动 SDK、设置/音频/onboarding 所有权文件。

## 设计自查

1. **助手只凭名称和说明能否用对？** 领域入口以文档和图层身份、候选、原稿钉点、保真、整理/应用/取消表达意图，不暴露像素实现参数；普通正式 UI 同路调用。P1-5 尚未注册新实体，当前不能声称助手已能发现/调用全部布局功能。
2. **能否 AI 先做、人只确认？** 用户粗摆后自动取得共享内核候选，人切换、钉原稿位置、调整保真并一次应用；不要求从零逐项调矩阵。复杂可见边缘能力尚有明确拒绝范围，真人效果/省操作待验证。
3. **产物能否直接流进其他工作区？** 应用写正式图片图层与同一撤销栈，沿既有图片包、画布内嵌包和导出链流转，不引入独立作品格式；现有下游消费保持一致。跨工作区真实像素与助手回执仍需 P1-5 集成证据。

## 本单改动文件清单

- `electron/main/ipc/image-editor-v3.ts`：扩展既有图片 IPC，读写布局资源并按发送方生命周期释放发布租约。
- `electron/preload/image-editor-v3-api.ts`：在现有 preload 图片 API 暴露布局资源读写与释放。
- `src/platform/contracts/imageEditorV3.ts`：声明布局资源 PAL 契约。
- `src/platform/adapters/electron/imageEditorV3.ts`：实现 Electron 布局资源 PAL 转发。
- `electron/main/services/image-editor-v3/layout-resources.ts`：统一布局 JSON 资源 schema、摘要验证与单次读取技术预算。
- `electron/main/services/image-editor-v3/layout-rebind.ts`：复制和导入时重绑不可变页、候选与双向历史引用，保持发布租约。
- `src/features/imageEdit/v3/application/imageEditLayoutPersistence.test.ts`：实跑工作副本、画布图层包、副本、移动、ZIP 重开、GC 和 undo/redo 存活链。
- `electron/main/services/image-editor-v3/document-repository.ts`：文档 fork/重绑接入布局资源与历史页重写。
- `electron/main/services/image-editor-v3/history-pages/store.ts`：历史页准备支持逐页异步命令映射。
- `electron/main/services/image-editor-v3/image-document/image-document-service.ts`：图片文档包导入按新文档身份重绑草稿。
- `electron/main/services/image-editor-v3/image-document/package-file.ts`：独立图片包复制时通过正式流式导入/导出重绑内部身份。
- `electron/main/services/image-editor-v3/canvas-layers/canvas-layer-packages.ts`：画布图片包导入/分叉同步重绑布局草稿。
- `src/core/imageEdit/v3/documentTypes.ts`：图片文档升为 v11 并加入草稿头。
- `src/core/imageEdit/v3/documentCodec.ts`：严格解析新的草稿头。
- `src/core/imageEdit/v3/resourceReferences.ts`：收集草稿真正资源引用、排除基态摘要，并共用正式文档识别以保留同名普通参数扫描。
- `src/core/imageEdit/v3/commandTypes.ts`：增加设置草稿头的正式叶子命令及资源描述。
- `src/core/imageEdit/v3/commandHistoryCodec.ts`：校验并恢复草稿头历史命令。
- `src/core/imageEdit/v3/commandHistoryInverseCodec.ts`：校验草稿头逆命令。
- `src/core/imageEdit/v3/commandReducer.ts`：应用草稿头并构造逆命令。
- `src/core/imageEdit/v3/commandLayerResourceMetadata.ts`：纳入草稿头前后资源的历史存活元数据。
- `src/core/imageEdit/v3/historyPaging/projection.ts`：历史投影支持草稿头。
- `src/core/imageEdit/v3/layoutDraft.ts`：定义完整仿射原稿页/候选 schema 与局部平移反求。
- `src/core/imageEdit/v3/layoutCandidates.ts`：复用共享布局内核，包装对齐、等距、保留主图和保真候选。
- `src/core/persistence/imageSchemas.ts`：工作副本正式 schema 接入草稿头。
- `src/core/persistence/formats.ts`：登记图片布局几何页与候选格式。
- `src/core/persistence/schemaVersions.ts`：工作副本/图片包/画布图层包分别升为 14/12/12。
- `scripts/generate-persistence-fixtures.ts`：生成含布局头/页/候选的确定性黄金 JSON，保留既有软区域和原子历史证据。
- `src/features/imageEdit/v3/application/imageEditLayoutDraft.ts`：提供采样、保存、整理、override 预览、钉点、应用、取消和校验重开的一致适配器。
- `src/features/imageEdit/v3/application/imageEditLayoutDraft.test.ts`：验证 S13/S14/S17/S18 对应内部闭环及仿射、锁层、拒绝和恢复负例。
- `src/features/imageEdit/v3/application/imageEditLayoutGeometry.ts`：采集裁剪/镜像/祖先坐标下的完整几何并复用正式矢量栅格器。
- `src/features/imageEdit/v3/application/imageEditLayoutAlphaGeometry.ts`：分瓦片扫描正式浮点 Alpha 支撑点，稀疏擦除覆盖替换源图单元。
- `src/features/imageEdit/v3/application/imageEditLayoutResources.ts`：通过已有 PAL 存取布局资源并管理发布租约。
- `src/features/imageEdit/v3/application/imageEditLayoutWorker.ts`：在 Worker 执行共享布局计算。
- `src/features/imageEdit/v3/application/imageEditLayoutWorkerClient.ts`：管理 Worker 复用、取消、关闭和空闲释放。
- `src/features/imageEdit/v3/editor/liveAnnotationDisplayV3.test.ts`：更新正式图片版本断言。
- `src/features/imageEdit/v3/editor/ImageEditorCommandBarV3.tsx`：两个可写宿主共用随手摆入口。
- `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.tsx`：将图片适配器接到共享候选/保真/钉点/A-B/应用控件。
- `src/features/creativeIntent/ui/CreativeIntentControls.tsx`：向后兼容地调整布局整理状态和失败文案。
- `src/features/imageEdit/v3/editor/ImageEditorLayoutOverlayV3.tsx`：复用共享非交互残影组件显示图片原稿几何。
- `src/features/imageEdit/v3/editor/ImageEditorLayoutOverlayV3.test.tsx`：验证重复 Alpha 支撑点的完整包围框与钉点中心。
- `src/features/imageEdit/v3/editor/ImageEditorV3.tsx`：将布局残影接入现有图片预览覆盖层。
- `electron/main/services/image-editor-v3/raster-export-session.test.ts`：更新正式文档版本断言。
- `electron/main/services/image-editor-v3/raster-export-session-restart.test.ts`：更新正式文档版本断言。
- `src/core/imageEdit/v3/layoutCandidates.benchmark.test.ts`：记录 100 层真实线程候选计算的 CPU/往返/内存基准。
- `src/features/imageEdit/v3/application/imageEditLayoutAlphaGeometry.test.ts`：验证实际边缘、非均匀仿射、不透明快路、稀疏擦除及描边/文字外观扫描范围负例。
- `src/features/imageEdit/v3/application/imageEditLayoutWorkerClient.test.ts`：验证 Worker 取消和生命周期。
- `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.test.tsx`：验证 full/canvas-edit 同一接口与只读 profile 可写性。
- `src/features/imageEdit/v3/application/imageEditLayoutOperations.ts`：提供轻量公开图片领域入口，供 P1-5 复用同一适配器。
- `src/features/imageEdit/index.ts`：导出公开布局适配入口。
- `src/features/imageMark/viewer/ViewerMarkEditor.test.tsx`：跟随正式文档版本常量，保留 quick 保存契约。
- `src/features/imageMark/standalone/imageDocumentFromSource.test.ts`：跟随正式文档版本常量，保留新建和导入契约。
- `scripts/generate-persistence-packages.ts`：用正式仓库与 ZIP 导出器生成含实体资源的本次图片黄金归档。
- `src/core/persistence/schemaBaseline.json`：登记本次三个图片格式 dev-break 和两个新增资源格式指纹，保留其他任务登记。
- `tests/fixtures/persistence/image-layout-page/v1.json`：完整仿射原稿几何黄金页。
- `tests/fixtures/persistence/image-layout-candidate/v1.json`：静态布局候选黄金资源。
- `tests/fixtures/persistence/image-working-copy/v14.json`：含草稿头与正式分页历史的工作副本黄金样本。
- `tests/fixtures/persistence/image-package/v12.json`：正式导出生成的图片包清单。
- `tests/fixtures/persistence/canvas-layer-package/v12.json`：升版后的画布图层包头。
- `tests/fixtures/persistence/document.image_document/v12.henjiimg`：正式图片文档黄金 ZIP。
- `tests/fixtures/persistence/image-package/v12.henjiimg`：正式图片包黄金 ZIP。
- `tests/fixtures/persistence/image-header/v12.henjiimg`：正式图片头读取黄金 ZIP。
- `tests/fixtures/persistence/canvas-layer-package/v12.henjilayer`：含草稿不可变资源的画布图层黄金 ZIP。
- `docs/task/超级关键帧/任务/P1-image.md`：记录实现、接口、证据、限制及设计自查。
- `docs/task/超级关键帧/02-实施拆分.md`：只在 P1-0/P1-3/P1-4 末尾追加 t147 状态。
