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

## t149 真实宿主验收

日期：2026-10-11。总管理者负责审查与 Git；本任务禁止 Git 写操作、SDK 源码修改、真实付费调用及 electron:dev 启停。正式 Reality 截图由本任务明确授权，使用隔离数据与单轮原子截图锁。

### 实现与选型

- 默认模型格式升为 v2，transcription 字段归入权威 preferenceSchemas/modelDefaultsSchema；管理器移除局部 Zod schema 组合，格式登记名称及类型来源同步。当前黄金样本使用真实 SDK moduleId，旧 v1 样本保留供明确拒绝验证；baseline 通过正式 `--write --dev-break model-defaults` 登记，不加开发数据迁移。
- 复用已有正式 ui:tour/Reality 启动器、Electron capturePage、正式图片文档构造器、资源 ingest/save/create、画布文档节点与 UI 图层选择/候选/滑杆/历史。没有另造浏览器宿主、合成器、布局求解器或截图通道，没有新增依赖。布局内核仍用 t147 已选成熟 Kiwi；本任务只增加正式呈现测量与回归场景。
- 两个独立场景为 `image-edit-layout-draft`、`image-edit-layout-draft-node`；透明留白的四张真实图片资源包含主图、组内镜像子层、旋转层和锁层。文档姿态与截图一起对账，残影命中须为 pointer-events:none。蒙版负例在同一宿主通过正式 UI 添加后重新整理。
- 5 次预热后测 30 次，候选生成与保真重算统计新候选合成回执后的下一帧，排除清除旧预览的中间帧；A/B 统计输入到合成回执后的下一帧。软件呈现时钟不能冒称物理屏幕/相机端到端延迟。测量不保存永久 Performance 时间线条目。

### 真实宿主发现及修复

1. 已完成候选仍被当作连续拖动的低清预览：给静态求解结果标记 stable，由原合成会话完成清晰目标呈现；普通拖动仍沿原草稿质量。两类质量各有精确回归。
2. 草稿元数据保存升版后，显示基底按像素身份复用旧 revision，导致新候选覆盖被视为过期、画面不移动：基底同时核对权威 revision。真实候选变化、应用姿态和预览投影都有读回证据。
3. 保真/钉点先保存空候选、再保存完整候选，同一次停手产生两份持久提交：改成完整结果一次提交；失败保留原持久设置，撤销恢复上次保真。
4. 含仿射组的 CPU 回退 A/B 重复求值：缓存已完成的正式清晰合成，键包含正式像素状态、资源及视口，复用原资源额度租约。32 MiB 是额外缓存字节预算，不限制图层/候选数量；超预算仍正常求值。淘汰/关页与正在显示的借用各有释放回归。未另造像素合成器或求解库。
5. 100 层覆盖逐层广播造成反复创建快照：整组先校验、一次替换发布，不呈现中间半成品；任一覆盖非法时保留上一组。批量命令与图片适配器测试覆盖广播次数和失败原子性。
6. 候选原稿残影与真实像素难区分、长说明撑宽面板，以及拒绝文案重复：图片残影使用虚线并在控件解释，overlay 不接收指针；约束控件宽度；共享错误与图片错误只显示一次。共享组件增加可选布局变体，动画默认样式保持原契约。
7. CPU 性能记录发现，资源描述更新会让图层/历史面板重建缩略图会话，百层保真重算期间重复 URL 生成占约 7.5 s。两个调用方按会话和历史端口维持服务，资源描述通过最新引用读取，不因元数据增减销毁像素缓存；保留原缩略图渲染、预算与释放实现。测试验证两个面板更新资源时复用、切换会话及关闭时释放；没有给公共类加方法或修改其替身契约。
8. 百层画布复测仍为 365.7 ms，不能以缩略图修复宣告预算通过。性能记录显示保存 owner 在多个身份检查处反复取得完整历史快照：正式文档实例提供权威当前文档读取，身份/陈旧检查走这条轻量路径，真正写入仍取完整历史。保存队列只在同 revision 时序列化比较历史，新 revision 直接进入既有保存流程；不裁历史、不减校验、不改 CAS 或失败重试。9 项 owner 测试和保存队列/实例/分页/历史的 31 项通过、1 项原有跳过。
9. 上述优化后的百层画布滑杆仍为 327.3 ms。进一步检查发现，清晰帧缓存把候选 JSON 的资源描述也算进键，重算后新增候选资源会使相同像素的缓存失效。现复用权威资源遍历，只以完整像素状态（geometry/color/layers，包含嵌套组、蒙版与效果参数）的资源描述参与键；原稿/候选资源仍按原生命周期保存及回收，不丢弃。测试覆盖未引用 JSON 不使像素失效、实际像素资源描述改变必须失效，以及视口/姿态/租约释放；新构建真实复测结果见下节，不以精确测试代替宿主预算。
10. 缓存键修正后百层画布仍为 321.5 ms，且随连续历史增长。唯一文档实例原订阅已取得命令发布时的独立历史 DTO，保存确认却再复制一遍；现在内部保存复用该已发布快照，只在权威文档仍相同时接纳。确认后的历史分页变化使其失效；同版本清历史会发布新快照。公开 getPersistenceSnapshot 保持独立复制语义，不截断历史或合并不同用户操作。
11. 复测百层画布仍为 321.7 ms，继续检查发现，预览循环为每个图层读取完整总线快照（其中会统计历史资源），而预览构建期间文档并未改变。改成一次读取当前文档供整组使用，保留同版本核对；三次候选切换的读取次数回归与广播原子性共同验证，避免规模乘以历史资源统计成本。24 项直接消费者测试通过，最终真实预算见下节，没有降低门槛。

### 失败轮次与场景修正

- 1536/3072 MiB Node 构建堆不足，保留失败；构建预算仅本轮进程提高到 6144 MiB，没有关用户程序。共享源码写入使部分轮次被正式产物新鲜度校验拒绝，保留拒绝、不绕检查。
- 早轮场景后缀含中文、百层文档身份共用、关闭面板竞态、画布 dialog 阻断冒泡输入时钟、撤销后抢先读取异步保存均已在场景修正。正式候选/锁层/原稿读回未被放宽。
- 工具箱夹具是未命名草稿，离开时产品正确要求保存和起名；早轮场景漏处理该对话框并刷新打断保存，现按正式保存流程起名后重开，不把场景缺陷登记成产品保存故障。
- `.reality/t149-final-run.log` 保留百层画布保真 P95 368.3 ms 超预算及工具箱保存场景失败；这是批量发布修复前的证据，不能报为最终通过。PowerShell 5 将 Cargo 正常 stderr 当异常的中断另存 `.reality/t149-accepted-powershell5-failed.log`，改用 PowerShell 7。
- 随后的百层画布复测依次为 378.1、395.1（诊断启用 CPU profiler）、365.7、327.3、321.5、321.7 ms；均超 300 ms，不能冒称通过。诊断轮 `.reality/t149-confirmation-profile/metrics-canvas-100.json` 为 362.2 ms，CPU profile 同目录保留；profile 有采样开销，不作为最终交付指标。`.reality/t149-delivery-run.log` 对应三个通过/一个百层画布失败，正式完整操作序列和工具箱百层通过，但四场景整体失败。最后两次重构建又因并行任务修改运行源码而被新鲜度检查拒绝，未执行场景；最终轮等待运行源码稳定后重新构建和验收。

### 最终验收证据

正式命令 `npm run test:reality -- --suite ui --build --only image-edit-layout-draft --out .reality/t149-delivery-quiet` 退出 0，四场景全部通过，26 张 PNG 全部通过 view_image 逐张目视。该轮在运行源码稳定三分钟后才取得原子截图锁，构建及巡检结束立即释放；没有跳过产物新鲜度检查。完整 [截图索引](../../../../.reality/t149-delivery-quiet/index.md)、[正式回执](../../../../.reality/t149-delivery-quiet/evidence.json) 和 [运行日志](../../../../.reality/t149-delivery-quiet-run.log) 保留。

本轮副屏经系统核对为 DISPLAY1（2560,0），使用 DIP 坐标 2561,1；机器为 Windows 10 专业版、Ryzen 9 5900X、RTX 4090、约 64 GiB RAM。请求窗口为 1440×900，PNG 原始像素为 2162×1353；窗口、缩放和视口以正式回执为准，没有修改或拼接截图。

两宿主十步序列如下；每步都在真实编辑器完成，画布一列从对应文档节点进入，工具箱列经历正式草稿保存、起名和重开。

| 步骤 | 目视/读回结论 | 工具箱 | 画布文档节点 |
|---|---|---|---|
| 01 粗摆 | 四图层；组内镜像、旋转与锁层可辨。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-01.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-01.png) |
| 02 整理 | 清晰候选出现，虚线原稿框可辨。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-02.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-02.png) |
| 03 切候选 | 按实际边缘等距的结果与前一候选明显不同。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-03.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-03.png) |
| 04 钉主图 | 解钉控件出现；主图原稿位置保持。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-04.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-04.png) |
| 05 调保真 | 保真回显与重算候选正确。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-05.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-05.png) |
| 06 应用 | 真实像素边缘对齐、等距；主图、锁层、组祖先姿态读回不变。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-06.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-06.png) |
| 07 撤销 | 一次恢复粗摆，读取已保存姿态核对。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-07.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-07.png) |
| 08 重做 | 恢复同一应用结果，读取已保存姿态核对。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-08.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-08.png) |
| 09 保存重开 | 草稿、候选、主图钉点仍在，正式作品姿态一致。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-09.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-09.png) |
| 10 蒙版负例 | 单条明确拒绝和恢复建议，原合成不变。 | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-10.png) | [帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-10.png) |

两宿主末帧及百层各两帧也全部目视（总数 26）：[工具箱末帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft.png)、[画布末帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node.png)、[工具箱百层候选](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-100-step-01.png)、[工具箱百层末帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-100.png)、[画布百层候选](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-100-step-01.png)、[画布百层末帧](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-100.png)。一个主带、至多一个从属带；前景候选面板只有一个主动作。工具箱背景命令带的导出属于其独立表面。没有内部 ID/版本文案，残影不挡图层命中（正式 pointer-events:none 断言通过）。

应用帧还以只读像素扫描核对透明留白外的真实实色边缘：工具箱三段空隙 121/120/120 px，顶边 628/628/628/627 px；画布 121/122/120 px，顶边 627/627/628/626 px。抗锯齿与像素取整范围内差不超过 2 px，不能只看中心等距。原始 [工具箱像素数据](../../../../.reality/t149-delivery-quiet/pixels-toolbox.json) 和 [画布像素数据](../../../../.reality/t149-delivery-quiet/pixels-canvas.json) 保留。

性能表的每格依次为 **P95 / P99 / worst（ms）**。整理预热 5 次；A/B 与滑杆各预热 5 轮往返；三指标正式样本均为 30 次。百层在实际透明 Alpha 测量完成后预热，符合 §6「已提供几何、不含像素分析」口径；冷启动与首次像素测量未冒充暖求解成绩。软件时钟测到新候选合成回执后的下一帧，未宣称物理屏幕端到端。

| 真实宿主/规模 | 全部候选（≤900） | A/B（≤100） | 停手重算（≤300） | 原始样本 |
|---|---|---|---|---|
| 工具箱，四图层 | 69.5 / 101.0 / 101.0 | 63.2 / 63.8 / 63.8 | 54.8 / 56.9 / 56.9 | [JSON](../../../../.reality/t149-delivery-quiet/metrics-toolbox.json) |
| 画布节点，四图层 | 53.0 / 53.1 / 53.1 | 62.2 / 62.7 / 62.7 | 63.6 / 74.1 / 74.1 | [JSON](../../../../.reality/t149-delivery-quiet/metrics-canvas.json) |
| 工具箱，百层 | 80.6 / 97.3 / 97.3 | 30.7 / 30.9 / 30.9 | 152.4 / 155.0 / 155.0 | [JSON](../../../../.reality/t149-delivery-quiet/metrics-toolbox-100.json) |
| 画布节点，百层 | 96.6 / 113.5 / 113.5 | 30.0 / 45.9 / 45.9 | 298.9 / 300.3 / 300.3 | [JSON](../../../../.reality/t149-delivery-quiet/metrics-canvas-100.json) |

百层画布滑杆 P95 仅比门槛低 1.1 ms，余量小，P99/最慢 300.3 ms；不得宣称各次都低于 300 ms 或跨设备稳定达标。基准中的百层等距候选保留原尺寸、可超出画幅，截图只证明性能和呈现，不代替百层自动适配画幅或构图质量验收。100 是基准规模，不是数量上限。

本单实际排查覆盖两图片宿主的共享预览/草稿、总线批量广播、正式 CPU 回退及租约、图层与历史两处缩略图会话、唯一文档实例/owner/保存队列，以及默认模型格式读写。同源缺陷均在上述范围修复并有定向回归。未做 R04 真人留出、三评审盲评与省操作量测试、物理屏幕相机测量、冷启动/长会话/千层内存与取消矩阵、P1-5 助手实体反射和正式回执；不能以本单四场景通过宣称整个 P1-3/P1 全部完成。

### 设计自查

1. **助手只凭名称和说明能否用对？** 转写沿已登记的 transcription.default_model 通用属性，由同一权威持久 schema 读写；图片沿原稿、候选、钉点、保真、一次应用语义，未增加专用 Agent 工具。P1-5 图片实体反射欠账不由截图替代。
2. **能否 AI 先做、人只确认？** 复用共享本地求解器先生成候选，人切换、钉主图与调保真后确认；蒙版等不支持边缘明确拒绝，保留原稿，不猜测可见边缘。
3. **产物能否直接流进其他工作区？** 结果写正式图片图层和同一撤销栈，沿原独立图片文档包与画布内嵌图层包保存和流转。设置仍沿原默认管理器与本地存储，未另建格式或 Store。

### t149 检查记录

- 两条 tsc 通过：`npx tsc -p tsconfig.json --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit`。后续渲染层改动以 `.reality/t149-preview-read-tsc.log` 的通过证据更新，主进程/core 格式未再改。缓存测试最初有 readonly 仿射 tuple/资源 DTO 错误，缩略图测试有资源引用类型过宽，均修正后重查，不隐去初次失败。
- 改动文件 ESLint 通过；最新改动分别见 `.reality/t149-preview-read-eslint.log`、`.reality/t149-published-eslint.log`、`.reality/t149-pixel-cache-final-eslint.log`；缩略图三文件及场景/测试见 `.reality/t149-thumbnail-eslint.log`、`.reality/t149-last-eslint.log`，其余本单文件也已逐文件通过。
- `check:persistence-compat` 41 个格式通过；正式 `--write --dev-break model-defaults` 已登记 version/supportedFrom=2 与原因，不手写 baseline 指纹。`check:surface`、`check:ui-residue`、`check:dependency-graph` 通过，最新日志为 `.reality/t149-surface-thumbnail.log`、`.reality/t149-residue-cache.log`、`.reality/t149-dependency-published.log`。没有主进程源码改动，不额外升级 main-imports 或完整构建门禁。
- 指定五目录测试覆盖：`src/features/imageEdit src/features/settings src/core/persistence electron/main/services/documents electron/main/services/image-editor-v3`。SQLite 原生项目必须用 Electron Node ABI，首轮 234 文件/1319 测试通过、3 跳过，但 11 个 GPU Worker 退出，不能称该命令整体成功；这 11 文件改用普通 Node 精确补验后 93 测试通过、1 跳过、0 失败。两组覆盖全部 245 文件，合计 1412 测试通过/4 跳过，日志 `.reality/t149-tests.log`、`.reality/t149-gpu-tests.log`。
- 后续代码变化只重验失效范围：稳定质量 4 文件/30 测试，草稿配置 1/8，显示版本 3/12，控件/残影/草稿 3/17，帧缓存/合成/hook 3/13，缓存直接消费者 5/25，类型修正后的缓存精确项 2/9，批量覆盖 4/27，缩略图/图片交互/资源用途 3/8，最后测试类型修正精确项 1/2，保存确认直接消费者 5/31（另有 1 项既有跳过），全部 0 失败；日志使用 `.reality/t149-*-tests.log`。保存优化后的 tsc/ESLint 也通过，见 `.reality/t149-confirmation-tsc.log`、`.reality/t149-confirmation-eslint.log`。静音及线程 max=3/min=1；原生环境分进程串行，不通过跳过失败测试取得成绩。
- 像素资源缓存键最后修改后，三份直接消费者测试 13 项通过，fixture 类型收窄后单份 2 项复验通过；最新渲染层 tsc、两改动文件 ESLint、依赖图通过，分别见 `.reality/t149-pixel-cache-tests.log`、`.reality/t149-pixel-cache-final-tests.log`、`.reality/t149-pixel-cache-tsc-fixed.log`、`.reality/t149-pixel-cache-eslint.log`、`.reality/t149-pixel-cache-final-eslint.log`、`.reality/t149-dependency-pixels.log`。初次 fixture 在 union 图层上写 source 的 TS 错误已修复并重查。
- 发布快照复用后，保存 owner/队列/实例 3 文件 22 项及分页/历史/公共入口/MCP 4 文件 16 项通过、1 项既有跳过。预览读取去重后 3 文件 24 项通过；相应最新渲染层 tsc、ESLint 均通过，日志 `.reality/t149-published-{tests,consumers-tests,tsc,eslint}.log`、`.reality/t149-preview-read-{tests,tsc,eslint}.log`；依赖图最新 `.reality/t149-dependency-published.log` 通过。
- `node --test scripts/lib/uiInspection.test.cjs` 41 项通过，验证正式场景登记与筛选；本单文件显式 `git diff --check` 通过，只有 LF/CRLF 提示。没有全量测试、vitest related、付费调用、Git 写操作或 electron:dev 启停。
- 收尾只读核对通过：本节 35 个证据链接全部存在，36 个本单文件去重一致，新增文件无行尾空白；最终回执四场景无浏览器/日志错误，26 张 PNG 与索引一致，四组各三项 30 个样本及 P95 门槛重新核对通过。

### t149 文件范围（供总管理者精确审查）

| 文件 | 本单改动 |
|---|---|
| `src/core/persistence/preferenceSchemas.ts` | 默认模型格式升 v2，加入权威转写字段。 |
| `src/core/persistence/formats.ts` | 默认生成与转写模型名称及类型来源归位。 |
| `src/core/persistence/schemaBaseline.json` | 正式工具生成 model-defaults dev-break，保留其他登记。 |
| `tests/fixtures/persistence/model-defaults/v2.json` | 新格式黄金样本及真实 ASR moduleId。 |
| `scripts/generate-persistence-fixtures.ts` | 黄金生成器消费权威默认模型 schema。 |
| `src/features/settings/modelDefaultsManager.ts` | 移除局部 schema 组合，消费唯一权威格式。 |
| `src/features/settings/application-control/transcriptionSettings.test.ts` | 通用写入、重开、SDK 请求链增加权威格式断言。 |
| `src/features/imageEdit/v3/application/imageEditCommandBus.ts` | 静态候选质量及整组预览一次发布。 |
| `src/features/imageEdit/v3/application/imageEditCommandBus.test.ts` | 批量预览与非法成员原子性回归。 |
| `src/features/imageEdit/v3/application/imageEditLayoutDraft.ts` | 完整候选一次提交、清晰批量预览、整组只读一次当前文档与诊断时钟。 |
| `src/features/imageEdit/v3/application/imageEditLayoutDraft.test.ts` | 保存次数、质量、撤销和完整快照回归。 |
| `src/features/imageEdit/v3/application/imageEditPersistenceOwner.ts` | 身份检查读权威当前文档，不反复复制完整历史。 |
| `src/features/imageEdit/v3/application/imageEditDocumentInstances.ts` | owner 的权威读取和已发布独立快照复用，保留公共复制契约。 |
| `src/features/imageEdit/v3/application/imageEditDocumentInstances.test.ts` | 发布快照复用、确认后失效和同版本清历史回归。 |
| `src/features/imageEdit/v3/application/imageEditPersistenceQueue.ts` | 新 revision 不重复序列化历史，同版本历史变化仍保存。 |
| `src/features/imageEdit/v3/application/imageEditPersistenceOwner.test.ts` | 完整快照次数、批次、并发编辑、失败和投影回归。 |
| `src/features/imageEdit/v3/execution/useImageEditorViewportCompositeV3.ts` | 已完成候选使用正式清晰质量并允许复用。 |
| `src/features/imageEdit/v3/execution/useImageEditorViewportCompositeV3.test.ts` | 静态与拖动质量契约回归。 |
| `src/features/imageEdit/v3/execution/imageEditorRenderSessionFrameCacheV3.ts` | 正式 CPU 成品的字节预算缓存与租约，键只遍历像素引用资源。 |
| `src/features/imageEdit/v3/execution/imageEditorRenderSessionFrameCacheV3.test.ts` | 像素/资源/视口失效、淘汰和释放回归。 |
| `src/features/imageEdit/v3/execution/imageEditorRenderSessionContractsV3.ts` | 可缓存静态快照的可选提示。 |
| `src/features/imageEdit/v3/execution/imageEditorRenderSessionIdentityV3.ts` | 快照同一性包含缓存提示。 |
| `src/features/imageEdit/v3/execution/imageEditorRenderSessionV3.ts` | 同一正式会话复用已完成候选，关闭时释放。 |
| `src/features/imageEdit/v3/execution/imageEditorRenderSessionV3.test.ts` | A→B→A 升版复用与求值次数回归。 |
| `src/features/imageEdit/v3/editor/ImageEditorPreviewV3.tsx` | 显示基底同步权威 revision，接纳真实候选覆盖。 |
| `src/features/imageEdit/v3/editor/ImageEditorPreviewV3.test.tsx` | 元数据升版后的实际投影与不改正式姿态回归。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutOverlayV3.tsx` | 使用共享残影的布局变体。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.tsx` | 控件宽度、虚线解释及单条拒绝提示。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayersPanelV3.tsx` | 资源描述刷新时保留同一缩略图会话。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayersPanelV3.scale.test.tsx` | 两面板缓存复用、会话切换及关闭释放回归。 |
| `src/features/imageEdit/v3/panels/history/ImageEditorHistoryPanelV3.tsx` | 历史面板同步复用会话并读取最新资源描述。 |
| `src/features/creativeIntent/ui/CreativeIntentOverlay.tsx` | 可选布局虚线变体，保持动画默认行为。 |
| `scripts/lib/uiInspectionSceneImageEditLayoutDraft.cjs` | 双真实宿主十步及百层正式场景，计时/读回/拒绝证据。 |
| `scripts/lib/uiInspectionScenes.cjs` | 登记四个正式巡检场景。 |
| `docs/task/超级关键帧/任务/P1-image.md` | 追加本节实现、问题、验收与设计自查。 |
| `docs/task/超级关键帧/02-实施拆分.md` | 只追加/更新 P1-3 本单 t149 状态行。 |

临时执行脚本、日志、截图和 CPU profile 位于被忽略的 `.reality/` / `node_modules/.cache/t149-layout-*`，不是应提交源码；未创建额外任务/总结文档。未手改 SDK 或并行任务所有权源码；授权的正式 bundle 会更新 SDK 生成索引，工作区还有其他任务的 SDK 改动，不纳入本单、不还原，总管理者需核对生成产物来源并逐 hunk 审查共享文件。证据目录被 Git 忽略，交接时须单独保留或归档。

## t152 面板打磨

### 范围与设计决定

- 移除常驻使用说明；只有首次整理缺少三个独立图层时显示简短条件提示。已有草稿选中单个主图后仍沿用原稿目标集合。
- 图片侧组合既有 UiGroup、UiOptionButton、UiRangeInput、PanelTrigger、UiEmpty/UiLoading/UiError；候选统一为同宽单选行，名称为“原稿 / 边缘对齐 / 等距排列 / 保留主图”，移除 A/B 后缀和原稿独有图标。“整理”为静默动作，“应用”为唯一主动作。
- 面板从 w-72 收至 w-64；钉点列表按实际行数收缩，超过三行仅限制可见高度并继续虚拟滚动，不限制图层或钉点总数。长名称截断并保留完整可访问名称。
- 保留默认 fidelity=0：共享布局求解器以 (1-fidelity) 缩放位置改变量，0 表示完整对齐/等距，1 表示保持原位，不影响图片质量。界面改为“保留原稿位置”，两端为“完全整理 / 保持原位”，百分比独立回显。
- 候选提供 radiogroup/radio、单一 Tab 停靠点、方向键循环和 Home/End。滑杆支持停手/失焦提交、Escape 放弃未提交值；Escape 沿现有 PanelTrigger 的捕获规则关闭浮层，不另改共享组件。
- 应用、撤销、重做、取消和单候选结果使用普通状态提示；拒绝和保存失败只显示一个错误块。保存失败可重试，异步动作期间阻止重复应用。
- 沿根因检查 full / canvas-edit 两宿主共用面板、草稿订阅、应用/保存重试、撤销重做、蒙版拒绝、原稿残影及共享 CreativeIntentControls。残影实现未发现本单相关缺陷，未修改；共享控件归 t151 所有，未修改。
- 开源与复用选型：现有 Ui* 和 react-virtuoso 已覆盖全部需要；继续使用既有 Kiwi 布局求解器，不引入新库或第二份业务算法。建议共享 CreativeIntentControls 后续开放候选标签与对照选择呈现配置，并区分普通状态与失败；本单按文件所有权在图片侧组合。
- 能力覆盖分级为展示调整：没有新增业务操作、实体、持久格式或助手工具，继续走现有 ImageEditLayoutDraft。P1-5 的正式助手实体/回执欠账没有因本单消失。

### 设计自查

1. **助手只凭名称和说明能否用对？** 整理、候选预览、钉住原稿位置、保真与一次应用仍调用同一领域入口；本单仅澄清面板语义，不将 UI 接线冒充 P1-5 已完成。
2. **能否 AI 先做、人只确认？** 仍由既有求解器先产生布局候选，人选择、钉住和确认；默认完整整理，不要求先调参数。蒙版等不支持情况明确拒绝。
3. **产物能否直接流进其他工作区？** 继续写入正式图片图层、同一撤销栈和原有文档保存链，工具箱与画布图片宿主共享结果，没有新增导入导出格式。

### 验证记录（代码检查通过，双宿主截图未闭环）

- 精确测试：领域 8 项、残影 1 项通过；控件 10 项最终通过。首轮控件 1 项失败源于测试误以为 Escape 不关闭公共浮层，已按实际公共规则修正。日志 `.reality/t152-tests.log`、`.reality/t152-controls-final-tests.log`。
- 两条 tsc 均已运行：主进程通过；渲染层首次报告本单测试替身两处类型错误及并行 t154 测试错误。本单改成只声明控件消费字段的替身并修正 Promise<void>，渲染层最终复查通过，见 `.reality/t152-tsc-final2.log`；不修改 t154 文件。
- 改动文件 ESLint 通过；check:surface、check:colors、check:icons、check:ui-residue 通过。钉点收缩后的控件精确复验、ESLint 与 ui-residue 也通过。正式场景工具 41 项通过；日志 `.reality/t152-*-tests.log`、`.reality/t152-*.log`。
- 改前新的正式截图尝试先被产物新鲜度检查拒绝；随后轻量构建在 renderer transforming 阶段异常退出，执行会话退出码 -1073741571，日志 `.reality/t152-before.log` 与 `.reality/t152-before-build.log`。当时系统可用提交内存不足 1 GB，但未据此断言唯一原因；没有关闭用户程序。确认本轮构建进程结束后立即清除本单截图锁。
- 改前对比暂复用并逐张目视 t149 的两个正式 Electron 截图：[工具箱](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-step-03.png)、[画布文档节点](../../../../.reality/t149-delivery-quiet/1440x900-image-edit-layout-draft-node-step-03.png)。两张均确认常驻说明、A/B 名称、混排候选与原稿图标问题；不是本轮新拍基线。
- 改后标准内存轮在 esbuild 阶段出现明确 `Out of memory` / `The service was stopped`，见 `.reality/t152-after.log`。随后仅为本轮进程设置 `GOMAXPROCS=2`、`GOMEMLIMIT=512MiB`、`NODE_OPTIONS=--max-old-space-size=6144`；正式轻量构建成功（205.66 秒），没有修改持久配置。
- 低内存轮正式 Electron **1440×900 画布文档节点场景通过**：不足三层、粗摆、整理、候选切换、键盘焦点、钉主图、滑杆、应用、撤销、重做、保存重开、蒙版拒绝共 12 步及末帧 1 张，13 张全部逐张 view_image 目视。确认无常驻使用说明、无 A/B 后缀、同宽候选行与唯一主动作、原稿位置百分比、明确焦点环、单条拒绝提示；保存/撤销/重做同时读回正式姿态。目录 `.reality/t152-after-low-memory/`，日志 `.reality/t152-after-low-memory.log`。
- 同轮 **960×640 画布场景失败**，原因是脚本跨尺寸复用了文档 ID（expected 0, actual 8）。其失败截图也已目视，停留在夹具画布，不能算面板验收。已给 panel 模式的文档身份及证据目录增加窗口宽度区分；脚本 ESLint 与语法检查通过，运行补验尚未完成。
- 进入工具箱宿主前又被新鲜度校验拒绝：并行任务修改运行源码晚于该轮产物，正式工具提前退出，故本轮没有完整 evidence.json/index.md，不能称整轮通过。随后等待 t154 释放截图锁并复用其最新构建再次尝试，仍被拒绝（产物 11:57:42，源码 12:02:26），见 `.reality/t152-final.log`。没有跳过新鲜度校验，也没有触碰其他任务代码。
- **尚未完成：本轮新拍改前基线、工具箱改后截图、960 窄窗口截图，以及完整双宿主最终回执。** 已请求总管理者协调稳定窗口，尚未获得确认。剩余验收必须在 src/ 与 electron/ 暂停写入、其他共享构建停止时进行；低内存环境复用上述进程级预算，持锁运行 `npm run test:reality -- --suite ui --build --only image-edit-layout-draft-panel,image-edit-layout-draft-node-panel --size 1440x900 --size 960x640 --out .reality/t152-accepted`，结束立即释放锁。新产物已就绪时去掉 `--build`。不能以已通过的单一宿主宣称两个宿主全部验收。
- 本单场景新增 panel 模式覆盖不足三层、候选键盘焦点、窄宽度、应用/撤销/重做反馈、保存重开与蒙版拒绝，不附带百层性能测量。副屏系统核对为右侧 DISPLAY1，DIP 点 2561,1。

### 改后已目视截图

已目视的 13 张为同一正式画布图片宿主（1440×900），文件均在 `.reality/t152-after-low-memory/`：

| 序号 | 状态 | 结论 |
|---|---|---|
| 01 | 不足三层 | 条件提示简短，整理/应用禁用。 |
| 02 | 粗摆 | 原稿位置及锁层正常。 |
| 03 | 整理候选 | 三个选项同宽、边缘对齐选中、默认值含义清晰。 |
| 04 | 切换等距 | 等距排列选中，可见边缘结果与原稿残影可区分。 |
| 05 | 键盘焦点 | Home/ArrowDown 后边缘对齐有焦点环，与悬停色可区分。 |
| 06 | 钉主图 | 钉点与单行解钉项可辨，列表未额外空占三行。 |
| 07 | 滑杆 | 1% 读数明确，主图位置保留。 |
| 08 | 应用 | 普通“已应用，可撤销”提示，应用禁用防重做。 |
| 09 | 撤销 | 普通“已撤销布局”提示，粗摆恢复。 |
| 10 | 重做 | 普通“已重做布局”提示，布局恢复。 |
| 11 | 保存重开 | 原稿、候选及钉点仍可读回。 |
| 12 / 末帧 | 蒙版拒绝 | 只出现一个错误块与恢复建议，应用禁用。 |

代表图：[候选](../../../../.reality/t152-after-low-memory/1440x900-image-edit-layout-draft-node-panel-step-04.png)、[键盘焦点](../../../../.reality/t152-after-low-memory/1440x900-image-edit-layout-draft-node-panel-step-05.png)、[应用](../../../../.reality/t152-after-low-memory/1440x900-image-edit-layout-draft-node-panel-step-08.png)、[撤销](../../../../.reality/t152-after-low-memory/1440x900-image-edit-layout-draft-node-panel-step-09.png)、[拒绝](../../../../.reality/t152-after-low-memory/1440x900-image-edit-layout-draft-node-panel-step-12.png)。

### 本单文件范围

- `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.tsx`：图片侧面板组合、短名称、统一单选、滑杆语义、条件状态、键盘与防重复动作。
- `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.test.tsx`：双宿主、只读宿主、候选键盘、条件提示、滑杆、保存失败/重试及状态语义回归。
- `src/features/imageEdit/v3/application/imageEditLayoutDraft.ts`：瞬态消息语气、应用/历史/取消反馈与默认值注释；不改持久格式。
- `src/features/imageEdit/v3/application/imageEditLayoutDraft.test.ts`：默认保真、应用、撤销、重做和保存重试反馈断言。
- `scripts/lib/uiInspectionSceneImageEditLayoutDraft.cjs`：沿正式双宿主场景增加局部面板验收，更新控件选择器与就绪条件；原性能场景预算保留。
- `scripts/lib/uiInspectionScenes.cjs`：只新增一行双宿主 panel 场景登记；其余 diff 属其他任务。
- `docs/task/超级关键帧/任务/P1-image.md`：追加本节。
- `docs/task/超级关键帧/02-实施拆分.md`：仅新增 t152 状态行。

无 Git 写操作、付费调用、electron:dev 启停或 SDK 源码手改。授权的正式 bundle 调用了目录索引生成器；SDK 开始时已有大量其他任务改动，不还原、不归入本单。总管理者须按上述文件逐 hunk 审查共享登记与总览。
