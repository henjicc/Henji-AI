状态：第 3 步的逻辑修复与验证已完成，可提交；改动保留在 main，未提交、未推送。
决定：按实际依赖复用帧表，保留历史窗口给撤回使用；缺帧重试与当前序列调度不依赖下一轮自动预渲染。
证据：最终 L2 的 21 份测试/643 项及 12 项门禁通过，能力检查通过；独立审查 3 轮结束，真实窗口未复测。

## 审查清单处理

| 编号 | 决定与实现事实 | 验证事实 |
| --- | --- | --- |
| 1（必须改） | 渲染规划、逐帧渲染、清理均以实例存在与 contentVersion 判断内容是否有效；自动任务的内容身份也使用 contentVersion。改名、创作意图、导出记录替换 document 不因此取消任务。 | 覆盖元数据替换后继续渲染和清理、实际内容变更取消在途任务；既有实例关闭与重开测试保留。 |
| 2 | 帧表条目只纳入当前代码片段引用的素材、片子数据、网页、版本内容、画面字段及相关转场/跟随。与窗口键共用 videoEditRenderPictureClip，排除 name 和声音字段。版本内容身份排除容器位置等元信息。 | 未引用的素材/片子数据/网页和片段改名沿用同一帧表；真正的版本变化重新计算。 |
| 3 | 校验字体、分析、网页环境与快照身份，拒收环境改变后的迟到批次。全局计算槽按批次选择当前序列，历史窗口回收不触发其他序列整片指纹计算。 | 环境中途改变不接收旧结果；当前序列先于另一序列的后续区间计算；播放头跳转重排窗口。 |
| 4 | 可重建内存帧表按最近使用淘汰；按每帧 160 字节估算，32 MiB 或 128 个条目触发非当前条目回收。当前计算所需条目保留，不限制作品规模。旧快照持有的被淘汰帧表也清空。 | 经过 130 个版本后早期条目被回收，再次读取可补算恢复。 |
| 5 | Worker 基础设施失败保留成功帧，不写永久 fingerprint-session-failed。等待 1 秒后通知重新补算缺帧；作者自身无法提供指纹仍使用正式版本回退。 | 偶发 Worker 失败后缺帧补齐，帧表没有基础设施失败伪造的回退值。 |
| 6 | 指纹等待改为依赖/实例通知；等待旧任务、索引和指纹的前置阶段共享取消信号与 30 秒超时，结束时释放 clearing、监听器与定时器。文件选择始终按当前窗口键；实际删除调用发出后等待正式 I/O 结果。 | 覆盖拖动/导出导致缺帧时取消和超时、关闭实例、元数据变化后继续、索引读取中取消，以及平移后的范围选择。 |
| 7 | 窗口就绪通知首个立即发布，其余按 50ms 间隔合并，并保留最后一次通知。 | 1000 帧、200 个窗口的确定性测试验证通知少于 10 次，最终帧表完整；未做节目主线程真实耗时测量。 |
| 8（必须改） | 入口文件始终参与 authorFrameCodeIdentity，即使被写入 dataFiles；作者类型与助手参考说明同口径。 | 声明 frameKey 且 dataFiles 包含入口时，修改入口绘制代码仍改变身份；非入口数据文件按声明排除。 |
| 9 | needed 在缺帧补齐后重新读取实测状态；已经属于 realtime 的窗口从请求范围与任务总数中移除，不创建编码会话。 | 覆盖 pending → realtime 后不编码，保留 all 包含实时段的既有测试。 |
| 10 | 导出预取打开或首帧解码失败后移除该坏预览窗口，后续帧现场合成；同一窗口的重复失败处理只记录一次。 | 详见 ../02-导出复用预览/result.md。 |
| 11 | 已核实：导出原路径会通过节目缓存入口启动自动调度。导出改为只读取共享索引与就绪窗口，不注册节目加载状态、不启动自动定时器。 | 导出专用读取后推进时钟不出现自动渲染；详见 02 结果。 |
| 12 | screen_recording v46 样本的 scriptCapture.baselines 中增加真实嵌入导出记录，含 usePreviews:false。 | 三份当前样本由正式生成器生成，持久兼容测试与门禁覆盖读取。 |
| 13 | usePreviews 的缺省物化、内置预设、执行分支、助手/反射说明、界面勾选与迁移说明统一为关闭。 | 详见 02 结果；省略与 false 不复用，显式 true 保留。 |
| 14 | 删除无人调用的 transport.fingerprintCodeFrame 和 Worker 单帧请求/响应分支；保留预算约束的区间请求。 | 搜索无 fingerprintCodeFrame 调用或定义；会话与 Worker 区间测试覆盖正式路径。 |

清单 14 条均处理，没有保留不修项。

## 撤回到版本 A

- 按内容依赖复用已计算的 A 帧表；A → B → A 的精确测试确认恢复 A 时不新增 Worker 帧请求。
- 已取消或环境过期的快照不阻挡同一合成继续补缺帧；调度开始会记录“开始计算代码帧指纹”，不等自动预渲染空闲周期。
- 预渲染完成时不按当前文档立即删除历史窗口；历史文件交给既有媒体缓存按容量与保留天数回收，使撤回能够复用仍存在的 A 预览文件。
- 用户此前实测“只改数据时只有改动处 3 段变黄”作为已有事实保留；本轮未访问原片工程，没有新增真实片子 ready 延迟或整片 10 秒达标结论。

## 独立审查

- 第 1 轮：1 个重要问题已修。助手能力仅等待 onStarted，未启动即正常返回 cancelled 会永久等待；现同时结算渲染 Promise 的提前结束结果，公共调用测试证明取消后启动工具结束。
- 同轮发现同源原有取消竞态：首次索引读取前未登记 planning、清理未中止 planning。已纳入本次取消生命周期修复，并验证取消/清理后旧请求不会迟到启动。
- 第 2 轮：1 个小问题已修。清理的索引/旧任务等待未覆盖取消；现所有前置等待使用同一信号和超时，补充索引挂起时取消的回归测试。
- 第 3 轮只审增量，未发现仍未解决的重要或小问题。审查未启动应用、构建或测试实例。

## 验证事实

- 分级 L2：涉及共享帧指纹、异步调度/取消、导出读取及持久格式；新增测试覆盖真实缺陷与调度/恢复/数据完整性，符合 testing.md 第三节。
- 最终 L2：通过。显式限定本任务 54 个实现、测试、说明和样本文件，21 份/643 项精确测试、文件 ESLint、双工程类型检查及对应专项共 12 项门禁均通过；单次命令 NODE_OPTIONS 为 12 GiB，不改项目配置。表面检查产生 356 条启发式告警、0 处语法错误，严格门禁通过，未扩展修改其他界面。
- check:assistant-capabilities：通过。结构、Application Control 覆盖 15 项、行为不变量 31 份/237 项均通过。
- check:persistence-compat：通过，64 种格式。仅同步用户授权的未发布 v43/v46/v2 指纹与样本；已发布版本、最低可读版本和黄金样本未改写。
- HENJI_FRAME_KEY_BENCHMARK=1 的作者键基准：两个 20000 帧样本分别为 301.1ms、270.5ms。只包含作者函数、序列化和散列，不包含编译、IPC、字体准备、解码或 GPU，不能据此认定真实整片 10 秒达标。
- 第 1 步拖动相关的既有渲染器用例保留在 L2 范围，包括快慢拖动/反向逐帧读取 ready 缓存，以及缓存与现场合成的迟到上屏顺序；本轮没有真实窗口拖动性能取证。
- 未执行 commit、push、bundle、Reality 或开发环境操作；未访问 D:\视频制作；未改界面视觉。既有未提交内容保留。

最终 L2 命令：

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=12288'
& npm run verify:changed -- --level L2 --test 'src/core/persistence/persistence.test.ts' --test 'src/core/videoEdit/exportPresets.test.ts' --test 'src/core/videoEdit/renderBitrate.test.ts' --test 'src/core/videoEdit/renderCache.test.ts' --test 'src/features/videoEdit/application/videoEditExportPreviews.test.ts' --test 'src/features/videoEdit/application/videoEditExportQueue.test.tsx' --test 'src/features/videoEdit/application/videoEditRenderCache.test.ts' --test 'src/features/videoEdit/application/videoEditRenderFingerprints.test.ts' --test 'src/features/videoEdit/engine/videoEditAuthorApiContract.test.ts' --test 'src/features/videoEdit/engine/videoEditAuthorFingerprint.test.ts' --test 'src/features/videoEdit/engine/videoEditCodeFingerprint.test.ts' --test 'src/features/videoEdit/engine/videoEditCodeSources.test.ts' --test 'src/features/videoEdit/engine/videoEditRenderSession.test.ts' --test 'src/features/videoEdit/engine/videoEditRenderer.test.ts' 'resources/assistant-skills/video-edit-code-creation/references/author-api.md' 'resources/video-edit-author/author-api.d.ts' 'scripts/generate-persistence-fixtures.ts' 'src/core/application-control/domains/videoEdit/videoEditExportCapabilities.ts' 'src/core/application-control/domains/videoEdit/videoEditRenderCacheCapability.ts' 'src/core/documents/kinds/screenRecording.ts' 'src/core/documents/kinds/videoEdit.ts' 'src/core/persistence/formatMigrations.ts' 'src/core/persistence/formats.ts' 'src/core/persistence/releasedCompatibility.json' 'src/core/persistence/schemaBaseline.json' 'src/core/persistence/schemaVersions.ts' 'src/core/persistence/versionedJson.ts' 'src/core/videoEdit/exportPresets.ts' 'src/core/videoEdit/exportPresets.test.ts' 'src/core/videoEdit/renderBitrate.test.ts' 'src/core/videoEdit/renderBitrate.ts' 'src/core/videoEdit/renderCache.test.ts' 'src/core/videoEdit/renderCache.ts' 'src/core/videoEdit/renderFingerprint.ts' 'src/features/videoEdit/application/videoEditExport.ts' 'src/features/videoEdit/application/videoEditExportPresetReflection.ts' 'src/features/videoEdit/application/videoEditExportPreviews.test.ts' 'src/features/videoEdit/application/videoEditExportPreviews.ts' 'src/features/videoEdit/application/videoEditExportQueue.test.tsx' 'src/features/videoEdit/application/videoEditFields.ts' 'src/features/videoEdit/application/videoEditRenderCache.test.ts' 'src/features/videoEdit/application/videoEditRenderCache.ts' 'src/features/videoEdit/application/videoEditRenderCacheCapability.ts' 'src/features/videoEdit/application/videoEditRenderFingerprints.test.ts' 'src/features/videoEdit/application/videoEditRenderFingerprints.ts' 'src/features/videoEdit/engine/videoEditAuthorApiContract.test.ts' 'src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.ts' 'src/features/videoEdit/engine/videoEditAuthorDeterminism.ts' 'src/features/videoEdit/engine/videoEditAuthorFingerprint.test.ts' 'src/features/videoEdit/engine/videoEditAuthorFingerprint.ts' 'src/features/videoEdit/engine/videoEditAuthorLayers.ts' 'src/features/videoEdit/engine/videoEditAuthorModule.ts' 'src/features/videoEdit/engine/videoEditAuthorTypeCheck.ts' 'src/features/videoEdit/engine/videoEditCodeFingerprint.test.ts' 'src/features/videoEdit/engine/videoEditCodeFingerprint.ts' 'src/features/videoEdit/engine/videoEditCodeSources.test.ts' 'src/features/videoEdit/engine/videoEditCodeSources.ts' 'src/features/videoEdit/engine/videoEditRenderSession.test.ts' 'src/features/videoEdit/engine/videoEditRenderTransport.ts' 'src/features/videoEdit/engine/videoEditRenderer.test.ts' 'src/features/videoEdit/engine/videoEditRenderer.ts' 'src/features/videoEdit/engine/videoEditWorker.ts' 'src/features/videoEdit/panels/VideoEditExportFields.tsx' 'src/features/videoEdit/timeline/VideoEditRenderBar.tsx' 'tests/fixtures/persistence/document.screen_recording/v46.json' 'tests/fixtures/persistence/document.video_edit/v43.json' 'tests/fixtures/persistence/export-presets/v2.json' 'src/features/videoEdit/application/videoEditRenderCacheCapability.test.ts'
```


## 第 2 轮复审返工（2026-10-31）

- 状态：本轮两处复审意见已处理，第 3、4 步可进入提交环节；按本次约束保留未提交、未推送。
- 必须改：删除把通知次数当环境身份的 fingerprintEnvironmentRevision。传给指纹调度器的有效性校验直接比较字体版本、跟踪/智能区域结果的 JSON、该合成引用的网页内容身份。只有进度或同内容结果通知时保持在途快照有效；真实内容变化仍使校验失败，沿用调度器的迟到批次拒收路径。
- 建议项采用“给出准确语义”的允许方案，保留即时启动回执：onStarted.requestedFrames 是启动时所选候选窗口的完整帧数，包含指纹未就绪窗口；pendingWindows 是其中尚无有效预览、按候选键去重后的待处理窗口数；readyFrames 只计已有有效预览的窗口。needed 在指纹就绪后可能剔除判定可实时播放的窗口（包括预测轻量的窗口），因此启动计划可能大于最终范围；最终帧数以 Promise 返回结果为准。源码入口注释已同步说明。
- 新增 1 个回归用例：连续跟踪/智能区域进度通知、同内容对象替换后，原快照的环境校验持续有效；真实跟踪结果、智能区域结果或字体版本变化时失效。扩展既有 needed 用例，验证启动候选计划为 3 帧，指纹就绪后判定实时则最终为 0 帧且不开编码会话。
- 同类排查范围：检查唯一正式调用链 videoEditRenderCacheWindows → videoEditRenderFingerprints、跟踪/智能区域/网页通知、节目与导出缓存读取、预渲染及助手启动回执消费方。分析进度打断问题在共享入口修复；未发现需要另改的同源调用方。网页按实际引用身份比较，未引用网页变化不会打断本快照。未重新验证真实窗口的 ready 延迟、拖动或播放性能，上一轮真机证据保持原结论，本节不新增性能达标结论。
- 独立审查：仅针对本轮增量审查 1 轮，未发现重要问题或小问题；按审查核对将说明中的“实测流畅段”准确写为“判定可实时播放的段”。
- 验证：L2 通过，4 份精确测试共 53 项通过；本次 TS 文件 ESLint、渲染层增量类型检查、导入/装配依赖图、主进程传递导入共 5 项验证步骤全部通过。修改后的 diff 空白检查通过。最终只调整注释和测试标题措辞，运行逻辑与断言未变，复用同次验证证据（testing.md 第二节）。
- 本轮文件范围：src/features/videoEdit/application/videoEditRenderCache.ts、src/features/videoEdit/application/videoEditRenderCache.test.ts、本文件；其余既有未提交改动保留，videoEditRenderFingerprints.ts 无需修改。
- 未执行 commit、push、bundle、Reality 或开发环境操作；未访问 D:\视频制作；未改界面。

本轮验证命令（L2 依据：共享缓存的异步状态与多个直接消费者，testing.md 第一节 L2）：

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=12288'
npm run verify:changed -- --level L2 --test src/features/videoEdit/application/videoEditRenderCache.test.ts --test src/features/videoEdit/application/videoEditRenderFingerprints.test.ts --test src/features/videoEdit/application/videoEditRenderCacheCapability.test.ts --test src/features/videoEdit/application/videoEditExportPreviews.test.ts src/features/videoEdit/application/videoEditRenderCache.ts src/features/videoEdit/application/videoEditRenderCache.test.ts tickets/01-帧指纹缓存/result.md
```

## /code-review（high）六项返工（2026-10-31）

- 范围：仅本节列出的 6 个应用层源码/测试文件及本文件；保留开始时 main 上其他未提交改动。未提交、未推送，未运行构建、Reality 或开发版，未访问 D:\视频制作，未改界面。
- 分级 L2：修改共享帧表、异步调度、等待与取消，以及导出预览选择；按 testing.md 第一节 L2 执行精确测试、所属工程类型检查及依赖专项。

### 六条处理事实

1. 场景、媒体与网页依赖统一读取 videoEditCodeInputs 返回的 parameters，不混用原始实例参数。实际场景记录变更的回归证明新快照得到空的新帧表并重新请求 Worker。**原评审所称“scene 声明默认值直接引用场景”不符合当前正式契约**：src/core/imaging/parameterTypes.ts 的 scene.default 为 null，codeMaterial/parameterTypes.ts 的正式解析器拒绝非空默认引用，codeInputParameters.ts 只解析实例显式场景引用；已补正式解析器拒绝默认引用的测试，没有放宽契约或用伪造解析替身声称复现。已询问具体合法样例，尚未收到；因此本节不声称“默认场景引用改记录”的原样例已经通过。
2. 导出不再整体暂停本实例指纹：busy 时 Worker 每批最多一帧、1ms 预算，批间至少让出 50ms 或本批耗时的 19 倍；拖动继续暂停，队列实际执行前再次检查拖动状态。有同输出 profile 的候选历史预览时，导出在准备阶段等当前指纹就绪，再固定预览表；主循环不等待或刷新指纹。无候选时直接继续。准备等待支持取消，持续失败/缺帧 30 秒后抛错，交给既有导出入口记录 warning 并现场合成，清理所有等待订阅与定时器。测试覆盖 busy 期间推进、拖动暂停、准备等待后取到旧预览、取消与持续缺帧超时。1ms 是批次预算，单次作者函数不可抢占，不宣称真实导出耗时已实测不变。
3. 用 WeakMap 按不可变合成对象缓存每个片段的依赖键；环境字符串或解析 inputs 身份改变时重新构建，同一快照的反复读取不再序列化、散列场景与源码。回归以场景序列化计数证明反复读取 10 次只进行首次场景序列化；声明补齐产生的新 inputs 不复用旧键。
4. 拖动、导出与播放预算只读取 owner 本实例。逐项覆盖另一工程 scrubbing/busy/playing，不暂停本工程，也不降低其空闲预算。
5. 导出等待前只序列化一次当前合成和一次导出快照（合计两次），等待后用不可变文档身份、contentVersion 与 revision 复核。测试覆盖两次序列化、同 revision 的不同画面、等待中替换文档与推进内容版本，均拒绝旧预览。
6. trim 仅从缓存 Map 移除条目，不清 frames 或 signature。130 个版本触发淘汰后，旧快照仍保有完整帧表与签名；再次访问已淘汰版本可创建独立条目并补算。

### 排查、审查与验证

- 同源排查：videoEditRenderCacheWindows 的唯一指纹入口、节目/渲染条与导出读取、共享 calculationTurn 批次分配、代码输入解析及声明读取、clearVideoEditRenderCache 的既有等待路径、导出预览的唯一调用方 videoEditExport.ts。共享等待用于导出和删除；删除原有取消/超时路径的测试保留。未发现另外需要修改的调用方；未验证真实窗口性能、真实视频导出耗时或 ready 延迟。
- 独立审查 2 轮：第 1 轮 1 项重要问题（导出准备在持续指纹失败时无限等待），已通过 30 秒退路、profile 候选过滤及超时/取消测试修复；第 2 轮只审增量，未发现新问题。
- 最终 L2：通过。显式限定本轮 7 个文件，4 份精确测试共 63 项全部通过；文件 ESLint、渲染层增量类型检查、导入/装配依赖图、主进程传递导入共 5 个验证步骤全部通过。源码 diff 空白检查通过。本次未修改 core、持久格式或能力声明，不扩大为双工程/持久化/助手专项。
- 本轮状态：6 条均已作对应处理；第 1 条指定的默认场景样例违反当前契约，只能证明合法显式引用的场景记录变更失效，以及默认引用被正式解析器拒绝。代码检查已完成，但不能据此无条件声称用户指定的默认场景验收通过或第 3、4 步全部满足原完成标准；该项验收口径待用户确认。
- 本轮文件：src/features/videoEdit/application/videoEditRenderFingerprints.ts、videoEditRenderFingerprints.test.ts、videoEditExportPreviews.ts、videoEditExportPreviews.test.ts、videoEditRenderCache.ts、videoEditRenderCache.test.ts（以上同目录），以及 tickets/01-帧指纹缓存/result.md。

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=12288'
npm run verify:changed -- --level L2 --test src/features/videoEdit/application/videoEditRenderFingerprints.test.ts --test src/features/videoEdit/application/videoEditExportPreviews.test.ts --test src/features/videoEdit/application/videoEditRenderCache.test.ts --test src/features/videoEdit/application/videoEditRenderCacheCapability.test.ts src/features/videoEdit/application/videoEditRenderFingerprints.ts src/features/videoEdit/application/videoEditRenderFingerprints.test.ts src/features/videoEdit/application/videoEditExportPreviews.ts src/features/videoEdit/application/videoEditExportPreviews.test.ts src/features/videoEdit/application/videoEditRenderCache.ts src/features/videoEdit/application/videoEditRenderCache.test.ts tickets/01-帧指纹缓存/result.md
```
