实现：ticket 05 已完成代码、迁移、冻结效果库和技能更新；单提交 a06dca9fb，未推送。
验证：精确测试 39 文件 / 756 项、真实 GPU 12 项已通过；L2、生成器、持久兼容与助手能力门禁全部通过。
待办：Claude 完成 pose.blur 人眼对比及开发版观感验收；风格件优先与旋钮按 C3 留给后续票。

## 范围与交付

- 工作目录：`D:/VibeCode/Henji-AI-t05`；分支：`task/05-图层效果链`；起点：`2f49fd3c8`。最终提交：`a06dca9fb`（相对起点仅 1 个提交）。
- 仅修改本 worktree；本文件和 `layer-effects-test.ts` 按要求写入 tickets 目录。未 push、未重装依赖、未修改 node_modules 联接点、未操作 9334、未运行 Reality、未导出、未打开或修改 `D:/视频制作` 与《元宝搜索》。没有 UI 视觉改动。
- Diff：97 文件，5663 行新增 / 257 行删除；其中三份生成声明、冻结发行与五份持久黄金样本占多数新增行。
- 同目录 `layer-effects-test.ts` 是可导入的新代码素材源码，已用正式作者类型检查器检查通过；新建版本使用作者 API 7，固定 `henji-effects@1.0.0` 与 `henji-layout@1.2.0`。

## 实现与裁定

1. 作者图层支持 `effects(t)`，描述严格校验、补齐正式默认值，支持 glow、四种 blur、色差、调色、锐化、黑白、马赛克及全局 look。参数与声明来自正式内置登记表，工厂只返回描述；不另写效果算法。
2. 小 bounds 的空间量仍以完整作者高度换算，外扩由邻域支撑累加并分档；发光金字塔、马赛克、噪声网格绑定内容原点，外扩尺寸不决定视觉半径。
3. 共用正式 GPU 编码器，整帧统一提交、每道工序独立 uniform、逐层缓存，成功提交后才发布缓存；失败/取消清理待提交纹理和观察，删层与 dispose 回收附件。
4. C1：内部发光输出零 alpha 的编码预乘颜色；最终片段仍是一张普通 `VideoEditCodePicture`，没有双信号 picture。C2：显式后缀只处理主图，保留产生时的光；最终 pose.blur 处理两者。
5. `pose.blur` 保持画面像素、缩放、亚像素阈值和 blurShape 语义；删除 Canvas 第二张 blur 栅格与独立 lens 分支，复用共用 Gaussian / 96 点 lens。兼容虚化固定 final 规划，编码预乘语义不反预乘零 alpha 光。观感兼容尚未获得人眼验收结论。
6. C3：只按精确名字找全局效果预设；缺失、重名、非空旋钮、音频/蒙版/非图层预设明确报错。预设 amount、enabled、曲线与 LUT 解析进入实际结果；离屏/联系表任务固定快照，复用会话时刷新，并发工程显式快照互不覆盖。未扩展风格 schema；计划范围 5 的风格包优先部分未完成，按裁定归后续风格件 ticket。
7. API 7 的 recording / frameKey 指纹纳入实际效果链、look 内容、LUT 内容身份与兼容 blur；旧 API 4–6 的 frameKey 不新增 layers 求值。恒定 draw cacheKey 不遮住动态效果。没有改《元宝搜索》六模块的源码、API 或库锁定；旧 pose.blur 的观感不能仅凭这些自动测试宣称不变。
8. 公开取帧及元素读回提供同帧求值参数、look 展开与 pose.blur 来源。复核通过 TypeScript AST 给出带文件/行列/证据的建议，静态建议与执行失败分开；遮蔽导入的同名局部变量不误判。没有新增 MCP 工具。
9. 持久接口：作者 API 7、代码版本记录 8、代码资产 13、剪辑内容 44、录制内容 47；逐版本迁移保留旧 apiVersion 与 libraries，新增五份黄金样本、登记指纹与发布承诺。风格格式不变。
10. 更新设计 8.1 所列技能及参考：author-api、approach、color-texture、review、performance、parameters-curves、recipes-text、recipes-glass-lines。

## 有证据的实现调整

- 设计 C1 认为合成器已经可原样保留零 alpha 光；真实设备测试发现片段采样和精确呈现路径存在 `RGB <= alpha` 钳制。只解除这两处钳制，保留原预乘 source-over 协议；否则零 alpha 光会被清零。
- 旋转/缩放/曝光测试发现把 underlay 先叠到已有背景，会在 8 位纹理中提前饱和，使作者内部背景与独立下方片段出现 15/255 的差异。现在先在透明层内依次合成 underlay 和主图，再统一施加位姿、不透明度、clip 与曝光权重；真实 GPU 两种背景入口比较满足 1 LSB。仍是编码域普通 RGBA，没有新增线性浮点累计或外部附件协议。
- VGPU MCP 不在当前工具中；查阅了本地官方 VGPU CLI 文档。没有调整现有 Dawn 初始化接口，shader/设备失败不会跳过后报通过。

## 自动验证证据

- `node scripts/generate-author-effects.ts --check`：通过。冻结库完整性校验 `validateFrozenAuthorHistory(process.cwd())`：通过，既有冻结版本未改动。
- `npm run check:persistence-compat`：通过，64 种格式；精确迁移/前向兼容测试包括在 L2 测试集合内。
- `npm run check:assistant-capabilities`：通过结构、覆盖及不变量检查；不变量 31 文件 / 237 项。
- `npm run test:gpu -- src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts`：12 项通过。包括作者内部背景和独立下方图片片段在黑、深灰、浅灰、彩色背景上的一致性；光晕处只提亮、不压暗；零强度、纯光、整层透明、停帧稳定、层透明度、旋转/非等比缩放/裁剪/多曝光权重/上层遮挡；小幅及强光 shoulder/screen 数值参照；显式效果顺序与最终虚化；跨外扩档位、不同质量、资源缓存和弃帧。
- L2：39 个精确测试文件 / 756 项通过，包括 API 契约、冻结库、类型诊断、空间规划、运行时/资源、公共观察/复核、片段合成、Renderer、CodeSources、指纹、旧格式读取。`npm run verify:changed -- --level L2` 对下列 97 文件整体通过：精确测试、改动文件 ESLint、渲染层与 Electron 两套增量类型检查、依赖图、主进程传递导入、持久基线。
- ticket 01/02 的指纹、帧缓存及 renderer 原有精确回归已跑；ticket 03 的网页取帧、网页输入和调度回归包含在 Renderer / CodeSources 的原有用例中。没有跑用户真实工程，也没有以单入口测试声称全部功能已实机验收。
- 独立审查共 3 轮：修复两条重要问题（离屏复用旧 look 快照、源码读取失败使整个结构复核失败）和一条小问题（工厂名称遮蔽误判）；最后一轮审查每层 RGBA 合成与零虚化/调用增量，未发现新问题。pose.blur 迁移按审定第 5 节授权，观感结论保留给 Claude。

## Claude：在开发版建立测试时间线

本次没有启动/接管开发版。请在接入本提交后，按开发版既有构建启动流程更新产物；不要用旧运行产物验收。需要重新生成运行产物时用 `npm run electron:bundle`，不需要完整 electron:build。

1. 新建独立剪辑工程，名称例如“05 图层效果验收”，1280×720、30 fps、8 秒。不要打开《元宝搜索》。
2. 在代码素材入口新建素材，把同目录 `layer-effects-test.ts` 完整导入/粘贴为 `main.ts`，保存新源码版本；确认编译成功，拖到上方视频轨，从 0 秒开始持续 8 秒。
3. 单模块背景测试：背景依次设 1 黑、2 深灰、3 浅灰、4 彩色，发光强度 40，主体不透明度 100，整层不透明度 1。暂停在 0/2/4/6 秒，检查“光晕 LIGHT”外侧只增亮；反复停帧不抖动。播放检查 radius 随时间连续增长，切换“先发光后模糊”比较主体与光晕顺序。
4. 跨片段测试：复制该素材实例到下方视频轨，两段都从 0 秒持续 8 秒。下方开启“仅背景”，背景在 1–4 间切换；上方背景改 0 透明，关闭“仅背景”。和步骤 3 的同色背景比较；也可把下方换为新导入的测试图片/视频。只操作此测试工程。
5. 上方主体不透明度设 0，应留下纯光；整层不透明度设 0，应完全消失。开启“旋转与非等比缩放”，检查图层光晕随内容一起运动。再用时间线片段裁剪/遮挡测试图层边缘。
6. 下半屏左侧为 Canvas Gaussian blur 参照，右侧为共用 GPU pose.blur。关闭镜头散焦，虚化像素依次 0、阈值附近、小/中/大半径；并排、快速 A/B、暂停和连续播放比较白线、红蓝线及半透明圆点。此源码只提供 Gaussian 的直接参照；lens 要与审定基线的 96 点镜头结果比较，不能把左侧 Gaussian 当 lens 的等价基线。
7. 补齐设计第 5 节人工矩阵：真实测试图像、scale 0.5/1/2、非等比、旋转、clip、参数动画、预览 1/2 与 1/4，并对齐显示尺寸。当前样例中的运动开关作用于标题；下半屏完整变换矩阵需 Claude 在测试素材副本中设置，不能把未覆盖的项目判成通过。
8. 如果 Gaussian 或 lens 有可见亮度、边缘、颜色、裁切或跳变差异，记录模式/时间/参数/预览倍率并回修核或空间映射；不要调整作者参数掩盖差异。本票未运行导出；需要预渲染/导出观感对比时由 Claude 在获得相应授权后另外执行。

## 明确限制与未验收部分

- 会先反预乘的片段级效果（例如线性光调色）作用于带光的代码片段时，会丢失零 alpha 光；需要给光调色时放到作者 effects 中。透明导出仍是普通预乘 RGBA，背景相关的相加需要实际背景，本次没有导出验证。
- 风格包优先、风格旋钮、投影类附件、效果融合/金字塔共用与性能基准不在本票完成范围。
- pose.blur 人眼兼容、整个第 5 节观感矩阵尚待 Claude；没有声称提速或测得性能百分比。
- GPU picture 直接合成已验证；容量驱逐后的 ImageBitmap 桥接、Canvas 输入转换中的零 alpha 光保真尚未在真实 Electron 环境取证。这里是尚未验证边界，不作“已证实丢光”结论。

## 精确验证范围

执行 `verify:changed --level L2` 时显式传入下列本次文件，未扫描其他任务工作区。另用 `--test` 明确补充直接消费者：

- `src/features/videoEdit/engine/videoEditAuthorApiContract.test.ts`
- `src/features/videoEdit/engine/videoEditAuthorLayers.test.ts`
- `src/features/videoEdit/engine/videoEditAuthorRuntimeResolution.test.ts`
- `src/features/videoEdit/engine/videoEditCompositeScene.test.ts`
- `src/features/videoEdit/engine/videoEditCodeSources.test.ts`
- `src/features/videoEdit/engine/videoEditCodeGpu.test.ts`
- `src/features/videoEdit/engine/videoEditRenderSession.test.ts`
- `src/features/videoEdit/application/videoEditEffectPresets.test.ts`
- `src/features/videoEdit/application/videoEditCodeTypeCheck.test.ts`
- `src/features/videoEdit/application/videoEditRenderFingerprints.test.ts`
- `src/core/persistence/persistence.test.ts`
- `src/core/persistence/forwardCompat.test.ts`

<details><summary>本次 97 文件</summary>

- `resources/assistant-skills/video-edit-code-creation/SKILL.md`
- `resources/assistant-skills/video-edit-code-creation/references/approach.md`
- `resources/assistant-skills/video-edit-code-creation/references/author-api.md`
- `resources/assistant-skills/video-edit-code-creation/references/color-texture.md`
- `resources/assistant-skills/video-edit-code-creation/references/parameters-curves.md`
- `resources/assistant-skills/video-edit-code-creation/references/performance.md`
- `resources/assistant-skills/video-edit-code-creation/references/recipes-glass-lines.md`
- `resources/assistant-skills/video-edit-code-creation/references/recipes-text.md`
- `resources/assistant-skills/video-edit-code-creation/references/review.md`
- `resources/video-edit-author/author-api.d.ts`
- `src/core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts`
- `src/core/application-control/domains/videoEdit/videoEditReviewCapability.ts`
- `src/core/documents/kinds/screenRecording.ts`
- `src/core/documents/kinds/videoEdit.ts`
- `src/core/persistence/formatMigrations.ts`
- `src/core/persistence/formats.ts`
- `src/core/persistence/releasedCompatibility.json`
- `src/core/persistence/schemaBaseline.json`
- `src/core/persistence/schemaVersions.ts`
- `src/core/videoEdit/builtinEffects.ts`
- `src/core/videoEdit/chromaticAberration.ts`
- `src/core/videoEdit/codeAsset.ts`
- `src/core/videoEdit/codeAuthorProgram.ts`
- `src/core/videoEdit/codeElementSelection.ts`
- `src/core/videoEdit/codeMaterial/authorLibraries.test.ts`
- `src/core/videoEdit/codeMaterial/authorLibraries.ts`
- `src/core/videoEdit/codeMaterial/typeDiagnostics.ts`
- `src/core/videoEdit/codeMaterialPersistence.ts`
- `src/core/videoEdit/colorGrade.ts`
- `src/core/videoEdit/document.ts`
- `src/core/videoEdit/effectsRegistry.ts`
- `src/core/videoEdit/glow.ts`
- `src/core/videoEdit/review.ts`
- `src/features/videoEdit/application/applicationDomain.ts`
- `src/features/videoEdit/application/videoEditCodeElements.ts`
- `src/features/videoEdit/application/videoEditCodeTrial.test.ts`
- `src/features/videoEdit/application/videoEditCodeTrial.ts`
- `src/features/videoEdit/application/videoEditContactSheet.ts`
- `src/features/videoEdit/application/videoEditFrameObservation.test.ts`
- `src/features/videoEdit/application/videoEditFrameObservation.ts`
- `src/features/videoEdit/application/videoEditRenderFingerprints.ts`
- `src/features/videoEdit/application/videoEditReview.test.ts`
- `src/features/videoEdit/application/videoEditReview.ts`
- `src/features/videoEdit/engine/chromaticAberration.ts`
- `src/features/videoEdit/engine/glow.ts`
- `src/features/videoEdit/engine/videoEditAuthorBundle.test.ts`
- `src/features/videoEdit/engine/videoEditAuthorDeterminism.ts`
- `src/features/videoEdit/engine/videoEditAuthorFingerprint.test.ts`
- `src/features/videoEdit/engine/videoEditAuthorFingerprint.ts`
- `src/features/videoEdit/engine/videoEditAuthorGpu.ts`
- `src/features/videoEdit/engine/videoEditAuthorGpuLifecycle.test.ts`
- `src/features/videoEdit/engine/videoEditAuthorModule.ts`
- `src/features/videoEdit/engine/videoEditAuthorPrograms.ts`
- `src/features/videoEdit/engine/videoEditAuthorRuntime.test.ts`
- `src/features/videoEdit/engine/videoEditAuthorRuntime.ts`
- `src/features/videoEdit/engine/videoEditAuthorTypeCheck.test.ts`
- `src/features/videoEdit/engine/videoEditAuthorTypeCheck.ts`
- `src/features/videoEdit/engine/videoEditAuthorTypeEnvironment.ts`
- `src/features/videoEdit/engine/videoEditBuiltinEffectPasses.test.ts`
- `src/features/videoEdit/engine/videoEditBuiltinEffectPasses.ts`
- `src/features/videoEdit/engine/videoEditBuiltinEffectShaders.ts`
- `src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts`
- `src/features/videoEdit/engine/videoEditBuiltinEffectsGpu.ts`
- `src/features/videoEdit/engine/videoEditCodeFingerprint.ts`
- `src/features/videoEdit/engine/videoEditCodeGpu.ts`
- `src/features/videoEdit/engine/videoEditCodeSources.test.ts`
- `src/features/videoEdit/engine/videoEditCodeSources.ts`
- `src/features/videoEdit/engine/videoEditGpuShaders.ts`
- `src/features/videoEdit/engine/videoEditRenderSession.test.ts`
- `src/features/videoEdit/engine/videoEditRenderSession.ts`
- `src/features/videoEdit/engine/videoEditRenderTransport.ts`
- `src/features/videoEdit/engine/videoEditRenderer.test.ts`
- `src/features/videoEdit/engine/videoEditRenderer.ts`
- `resources/video-edit-author/author-effects.d.ts`
- `resources/video-edit-author/effects-library.d.ts`
- `resources/video-edit-author/frozen/henji-effects/1.0.0/LICENSE`
- `resources/video-edit-author/frozen/henji-effects/1.0.0/index.mjs`
- `resources/video-edit-author/frozen/henji-effects/1.0.0/release.json`
- `resources/video-edit-author/frozen/henji-effects/1.0.0/types.json`
- `scripts/freeze-effects-library.ts`
- `scripts/generate-author-effects.ts`
- `src/core/videoEdit/authorEffectObservation.ts`
- `src/core/videoEdit/authorEffects.generated.ts`
- `src/core/videoEdit/authorEffects.test.ts`
- `src/core/videoEdit/authorEffects.ts`
- `src/core/videoEdit/codeEffectReview.test.ts`
- `src/core/videoEdit/codeEffectReview.ts`
- `src/core/videoEdit/layerEffectGeometry.ts`
- `src/features/videoEdit/authorLibraries/effects.generated.ts`
- `src/features/videoEdit/authorLibraries/effects.ts`
- `src/features/videoEdit/engine/videoEditAuthorEffectDiagnostics.ts`
- `src/features/videoEdit/engine/videoEditAuthorEffects.ts`
- `tests/fixtures/persistence/code-asset/v13.json`
- `tests/fixtures/persistence/code-author-api/v7.json`
- `tests/fixtures/persistence/code-version/v8.json`
- `tests/fixtures/persistence/document.screen_recording/v47.json`
- `tests/fixtures/persistence/document.video_edit/v44.json`

</details>

## 变基

- 2026-10-31：已执行 `git rebase main`，基于本仓库本地 main `02c1ca54e7266ec5aa799333a0b8a45fd89fcd92`；最终单提交 `060ebd192`，分支仍为 `task/05-图层效果链`，父提交就是上述 main，`main..HEAD` 为 1 个提交，工作区干净。本文前述 `a06dca9fb` 与格式 44/47 是变基前记录，以本节为准。
- 保留 06 的导出比例封顶 1、按输出分辨率渲染开关、按墙钟时间发布进度与 `renderScale <= 1` 作者说明；05 的 effects、效果环境、质量及取消检查叠加其上。冲突测试同时保留连续输出比例、放大封顶和 look 快照用例。
- 持久格式：`document.video_edit` 44→45（最低可读 45）、`document.screen_recording` 47→48（最低可读 48）；`code-asset` 12→13、`code-version` 7→8、`code-author-api` 6→7。后三项未与 main 冲突；`export-presets` 保持 main 的 v3。迁移从 main 最新版本逐步接续，旧 apiVersion 和 libraries 保留原值。
- 使用正式构造器生成 v45/v48 样本，并复生成核对全部五份新格式样本（只规范化随机 UUID，保留引用关系，其余结构与内容一致）。已重新生成 schemaBaseline、releasedCompatibility；06 的 video_edit v44、screen_recording v47、export-presets v3 样本与 main 逐字节一致，发布承诺仅追加。
- 生成器 `--check` 兼容 Windows 检出的 CRLF：沿用仓内生成器的换行归一化比较，LF / CRLF 均实测通过，没有放宽实际内容检查。
- 验证全部通过：`npm run check:persistence-compat`（64 种格式）、`node scripts/generate-author-effects.ts --check`、`npm run check:assistant-capabilities`（结构；覆盖 15 项；不变量 31 文件 / 237 项）、`npm run test:gpu -- src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts`（真实 GPU 12 项）。提交后持久兼容与生成器再次通过。
- 完整 L2：`npm run verify:changed -- --level L2 <本票全部 97 文件> --test <精确消费者>` 通过，46 文件 / 890 项测试、文件 ESLint、两套 TypeScript 类型检查、依赖图、主进程导入边界、持久基线均通过。文件范围沿用上文 97 文件清单，只将两份样本改为 v45/v48；额外覆盖 06 的 exportPresets、playbackResolution、videoEditExportFrame、videoEditExportPreviews、videoEditExportQueue、videoEditGpuCompositor、videoEditWebInputs 测试。
- L2 首次在渲染层 tsc 耗尽 Node 默认 4 GiB 堆（退出码 134）；按 CI 的 `NODE_OPTIONS=--max-old-space-size=6144` 重跑同一完整命令后全部通过，未改变类型或测试标准。验证日志位于本 worktree `.tmp/rebase-*.log`，未入提交。
- 独立审查 1 轮：变基增量、冲突交汇处、共享调用方和发布承诺未发现重要或小问题。已检查的同类路径包括作者生成器、滤镜参数、Renderer、Worker 传输、网页输入、GPU 合成和导出进度；未重新全面审计原 05 实现。原有 pose.blur 人眼兼容与开发版观感仍待验收。
- 没有 fetch/pull/push、没有合并或修改 main；没有改主工作区代码（仅按交付要求追加本 result.md），未删除或重装 node_modules 联接点，未运行 Reality，未操作端口 9334 或 `D:/视频制作`。

## 2026-10-31：Opus 交叉审查修复（基于 060ebd192）

本节更新上文“统一解除 RGB≤alpha 钳制”和“取消清空观察”的结论。修复限定在 `D:/VibeCode/Henji-AI-t05` 的 `task/05-图层效果链`；保留原提交，追加一个修复提交。原 result.md 只读复制到本 worktree 后追加本节，主工作区文件未修改。没有合并、推送、修改 main、重装依赖、删除联接点、运行 Reality、操作 9334 或访问用户视频工程。本轮没有修改持久格式、版本、迁移或黄金样本。

### 按裁定修复

1. 片段采样恢复默认 RGB≤alpha 钳制；仅 API 7 作者本帧实际产生 underlay 的输出标记 `carriesLight`。嵌套合成向上传递，重用目标时逐帧更新；运动模糊累计和叠回使用相同标记。精确上屏路径保留原修复。
2. 弃帧只使本次改写的 surface 内容失效，保留未改写缓存、上一成功帧的 history/lastFrame/观察；AbortError 原样保留。已覆盖 API 4–7、静态批组与运动层、重复取消和恢复。
3. API 4–6 的 effects 按未知属性忽略，不求值、不校验、不拆静态组、不改变 recording/frameKey 指纹。API 7 根据实际 underlay 发布标记，空链和未产光帧不会沿用。
4. 效果输出与中间纹理经正式宿主分配器；完整 mip 按实际逐级尺寸计费，按尺寸/格式复用工作纹理，提交前不覆盖已发布缓存。连续变尺寸弃帧回收空闲输出与 scratch；动态调色表在弃帧时同样推进复用/回收。共享 rgba32float 计费修正为 16 字节/像素并归高精度预算，片段最终质量高斯也使用该修复。候选代码预览同样注入该分配器，字体资源重置与关闭时先释放候选运行时，再释放宿主；重置保留输入图片。
5. 镜头模糊登记为 layer-only，从片段目录移除，作者工厂、生成类型、运行时与静态参数诊断仍可用；说明去掉采样实现细节。pose.blur 观察使用登记的 radius_fraction_height / sigma_fraction_height 与逻辑作者画幅比例，不再输出栅格 radius_pixels。
6. 声明 effects 的空链保留最小外扩档；缩放模糊按中心到边缘距离及反向采样保守上界外扩。技能明确：片段反预乘效果与 gl-transitions 按原规则处理，转场期间零 alpha 光晕会消失。
7. 新增 `check:author-effects` npm 脚本，CI checks 必跑该生成器 `--check`，继续进入原 quality-gate。

### 本轮验证

- 真实 GPU：`npm run test:gpu -- src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts`，14 项通过。覆盖旧 API / 未产光 API 7 的 RGB>alpha 钳制、实际光晕相加、两层嵌套、运动模糊、标记复位、连续 24 次动态调色弃帧及恢复像素。
- 关键回归断牙：临时移除弃帧 lookup 生命周期推进，新增 GPU 用例立即失败（纹理分配 2→3）；随后已恢复修复。最终 L2 中同一真实 GPU 文件全数通过。
- `npm run check:persistence-compat`：64 种格式通过；本轮持久相关 diff 为空。
- `node scripts/generate-author-effects.ts --check` 与 `npm run check:author-effects`：通过，生成声明和既有冻结发行未改动。
- `npm run check:assistant-capabilities`：结构门禁、15 项覆盖与 31 文件 / 237 项业务不变量通过。
- 最终 L2：显式本票 104 文件；42 测试文件 / 825 项、ESLint、渲染层/Electron 类型、依赖图、主进程导入及持久基线全部通过。候选预览预算和字体重置/关闭顺序已纳入回归。途中两处新增测试的字面量/mock 类型约束报错均修复，最终完整重跑退出码 0。
- package/CI 有界专项：20 项现有 `scripts/lib/validationScripts.test.cjs` 通过；另用 JSON/YAML 解析核对脚本、无条件 CI 步骤及 quality-gate 对 checks 的依赖，全部通过。未推送，未声称远端 CI 已运行。
- 验证口径例外：`verify:changed --level L2 --dry-run` 对初始完整 104 文件清单明确拒绝 package.json 与 workflow，这是 testing.md 规定的工具边界；没有修改或绕过验证器。这两文件按该规则单独检查，最终清单 106 文件中的其余 104 文件走正式 L2（含 result.md 与新增候选预览回归）。类型检查首次遇到 Node 默认 4GB 堆不足，正式 L2 用单次进程 NODE_OPTIONS=--max-old-space-size=8192 重跑，不修改项目配置。

### 独立审查与排查边界

独立复核共三轮：第一轮发现变尺寸弃帧纹理累积、rgba32float 计费错误及镜头虚化静态诊断遗漏；第二轮指出动态调色 lookup 的同源弃帧回收遗漏；全部修复并补回归。第三轮仅审增量，未发现重要问题。

实际检查了作者 API 4–7 的分组/指纹/观察/取消、作者生成输出、片段与嵌套合成、运动模糊、共用效果分配器、最终质量高斯、镜头虚化目录/类型生成/静态诊断和 CI 接线。三轮审查后主代理调用方核对补齐候选预览的分配器注入与资源释放顺序，该增量由预算及字体重置/关闭回归验证，未另开第四轮独立审查。片段效果与转场丢光是本轮明确接受的边界，不扩展修改。

明确保留两项：frameKey 路径在 layers 读取资产时放弃指纹，属于保守正确；AuthorAssetPending 内部图片准备重试复用旧 mip 是原有问题，本轮按裁定未修。pose.blur 人眼兼容、真实开发版观感与 ImageBitmap 桥接的光保真仍沿用上文未验收边界，未冒充本次 GPU 自动测试已证明。

相对原票 97 文件，本轮另涉及 `.github/workflows/build.yml`、`package.json`、`src/core/videoEdit/builtinEffects.test.ts`、`src/features/videoEdit/engine/videoEditAuthorEffects.test.ts`、`src/features/videoEdit/engine/videoEditCodePicture.ts`、`src/features/videoEdit/engine/videoEditGpuCompositor.ts`、`src/features/videoEdit/engine/videoEditGpuCompositor.test.ts`、`src/features/videoEdit/engine/videoEditGpuFrame.ts` 与本 result.md。L2 使用上述来源形成的明确清单，并显式补直接消费者测试；未扫描主工作区或其他任务的脏文件。

## 2026-10-31：第 2 轮复审问题修复（基于 778b58bf8）

本节替代上轮关于保留旧整套效果缓存、理论支撑外扩及片段丢光范围的描述。只在 `task/05-图层效果链` 追加修复提交，不合并、不推送、不修改 main。没有变更持久格式，没有运行 Reality、操作 9334、访问用户视频工程或重装 node_modules。交付时把本文件缺失的上轮历史与本节一并合入 `D:/VibeCode/Henji-AI/tickets/05-图层效果链/result.md`，保留其已有内容；这是主工作区唯一获准写入的文件。

### 修复内容

1. 发光外扩使用正式正权卷积核的一维有限白条投影上界，包含各层衰减权重、实际内容宽高、旋转高斯、tent、sRGB 暗部斜率及抖动增益，按编码光贡献小于半级（1/510）截断；额外留半精度舍入余量。外扩按 64 栅格像素分档，空链保留最小 16 像素。沿用项目正式核与权重，没有引入另一套发光算法或图像库。连续链的后一效果使用已外扩的内容范围。
2. 缓存仅持有当前最终合成画面；内容键变化先撤销旧缓存资格，同尺寸覆写。主图、光及中间结果供后续图层复用，只有最终需要缩放采样的画面和镜头虚化输入建立 mip。不同尺寸先回收未被当前 encoder 引用的闲置附件。
3. 助手片段效果列表、单项读取与公共片段写入入口统一排除 `space: layer-only`。现有 `space: layer` 表示片段/图层均可用，保留高斯等双用效果；镜头模糊仅图层可用。
4. 两份作者说明明确：发光“相加照亮下方”仅在片段直接合成时成立。片段上的任何效果、任何转场（含内置擦除、交叉溶解与 gl-transitions）都会生成普通画面，零 alpha 光被截掉，转场首尾可能跳变。
5. final 高斯保留 rgba32float，按工序最后一次使用回收借用，缩放金字塔共用两幅全尺寸 backing，viewport/scissor 限定有效写入。未降精度、放宽预算或修改高斯核；已有跨宿主逐像素一致性验证通过。
6. 弃帧只释放本次新建 scratch，保留已预热池；API 4–6 共用的 pose.blur 路径也覆盖连续弃帧与恢复。调色从 `colorGradeOut` 根因收口：视频片段与图层输出前钳直通 RGB 至 [0,1] 再乘 alpha，CPU 参考同步；修图现有 extendedRange 路径保持 HDR，未把视频输出约束强加给图片。

### 真实 GPU 预算记录

通过正式 `VideoEditCodeGpu.effectAllocator` 分配、真实 Dawn/WebGPU 编码与提交，按完整 mip/格式字节统计所持纹理峰值。下表每项均包含两层默认静止、三层逐帧半径/强度动画 60 帧；同尺寸预热后没有新增纹理分配，设备验证无错误。1×覆盖输出栅格，2×另覆盖作者静态层栅格。计量是宿主拥有的纹理字节，不冒充驱动总显存。

| 画幅 | 内容大小 | 栅格倍率 | 外扩像素 | 8 位峰值 MiB | 高精度峰值 MiB | 合计峰值 MiB |
|---|---|---:|---:|---:|---:|---:|
| 1080p | 100×40 | 1 | 384 | 27.53 | 5.35 | 32.88 |
| 1080p | 100×40 | 2 | 704 | 74.84 | 18.26 | 93.10 |
| 1080p | 800×200 | 1 | 384 | 50.37 | 11.58 | 61.95 |
| 1080p | 800×200 | 2 | 704 | 160.05 | 41.49 | 201.54 |
| 4K | 100×40 | 1 | 704 | 92.72 | 16.66 | 109.39 |
| 4K | 100×40 | 2 | 1408 | 275.98 | 66.64 | 342.62 |
| 4K | 800×200 | 1 | 704 | 130.96 | 27.09 | 158.05 |
| 4K | 800×200 | 2 | 1408 | 428.93 | 108.35 | 537.28 |

现有宿主为 8 位与高精度各设独立 512 MiB 预算，未改预算；最重 2× 场景的两池合计 537.28 MiB，但两池均低于各自限额，没有 BUDGET。4K 10-bit 数值素材经 rgba16float 输入/输出及额外在途表面，叠加 final 高斯三档半径，实测高精度峰值 **442.97 MiB**；中心像素半精度值与输入完全一致。默认抖动的未裁切参考全像素检查证实，规划边界之外量化为零，内部仍有可见光。该回归验证正式 GPU 工序，不等同于真实文件解码、封装和整段导出验收。

### 验证与复审

- 真实 GPU 效果文件 19 项通过；含预算矩阵、默认抖动裁切边界、连续弃帧、4K 高斯和半透明调色。其他层发光强度在 0/0.1/40/0 间切换，调色输出一致且 RGB≤alpha。
- `check:persistence-compat` 通过（64 种格式）；作者生成器 `--check` 通过；`check:assistant-capabilities` 结构、15 项覆盖、31 文件/237 项不变量通过。
- 本 ticket 全部 115 文件形成显式清单。验证器按 testing.md 拒绝 package.json 与 workflow 两项，仍按有界配置专项处理（现有 validationScripts 20 项通过，复用上轮未变化的 CI 接线证据）；其余 113 文件走正式 L2，未修改验证器。完整测试 49 文件、874 项通过，2 项可选性能探针未启用。ESLint、渲染层/Electron 两套类型检查、依赖图、主进程传递导入及持久基线全部通过，正式 L2 退出码 0；单次验证进程使用 8 GiB Node 堆，不改项目配置。
- 共享调色排查覆盖视频片段、图层、CPU 参考、LUT 导出和修图 CPU/GPU；GPU 池排查覆盖图层/片段、缓存命中/失效、变尺寸、弃帧/恢复及 final 高斯。修图 HDR 曾被直接钳制方案影响，已通过既有 extendedRange 选项保留并回归。
- 独立复审 **1 轮**：无确认的重要新增问题；小问题“能量阈值漏计抖动”已修，默认抖动真实 GPU 边界及预算测试通过。复审另发现原有 `glow + pose.blur>0` 非 lens 路径会把零 alpha underlay 清零，属于本轮基线已有缺陷，按 testing.md 不夹带修复，明确留待后续处理；不能据现有“虚化结果有变化”的断言声称光被正确保留。
- 未验证边界：真实开发版观感、pose.blur 人眼兼容、ImageBitmap 光保真及真实媒体整段导出。未运行远端 CI，未把自动测试通过当作上述人工/桌面验收已完成。

## 2026-10-31：第 3 轮复审定点修复（基于 d7a284a7a）

本节修正上轮关于片段调色钳制和 pose.blur 光纹理的结论。只在 task/05-图层效果链 追加一个修复提交，留待 Claude 核对；没有合并或推送。持久格式、9334 开发版、node_modules 联接点及用户视频工程均未改动，没有运行 Reality。主工作区仅向本 result.md 追加同一节。

### 五项处理结果

1. 重要 1：colorGradeOut 在非 extendedRange 下仅对图层模式（u.layer.z > 0）或 alpha < 1 的像素钳直通色；不透明片段超亮值继续传给后续工序。CPU 参考同步，原 GPU 超范围真值断言恢复，新增半透明推亮与不透明曝光后继续经过 HSL/晕影的真实像素回归。共享 WGSL 用显式 layerCoordinates 选项传递宿主语义，替换原来的结构文本补丁；修图 extendedRange 保持原行为。
2. 重要 2：glowEnergySupport 按参数值、内容宽高、参考高度和质量跨帧缓存，最多保留 128 个标量结果，按 LRU 逐出。只缓存正式能量计算结果，不复制卷积算法；现有租借式纹理缓存不适合这类无资源数值。确定性测试验证跨帧命中、键变化失效和逐出。显式性能专项的默认 / aspect=100 / radius=100+resolution=100 冷计算分别约 1.84 / 9.96 / 20.74 ms，命中 P95 分别为 0.00442 / 0.00372 / 0.00396 ms，均低于 0.2 ms。
3. 重要 3：共用高斯 load/sample/convolve 显式接收 preserveZeroAlpha；uniform 默认关闭，仅 planAuthorDefocus 处理光纹理时开启，主体、片段公开高斯与修图仍用原行为。真实设备验证纯光高斯虚化后 RGB 总能量误差 <5%，alpha 保持 0，0.249/0.251px 两侧像素总差 <1%；有明显虚化时像素确实改变。author-api.md:191 的“最终 pose.blur 同时处理主体与光”现在与实现一致，未修改作者接口或说明。
4. 小 a：abandon 不调用 releaseIdle，只释放本批新建 scratch，保留未用到的预热档位；lookup 生命周期单独推进，避免动态调色弃帧积累。新增“预热高斯→连续无模糊弃帧→返回高斯”的实际 GPU 分配回归；既有动态 lookup 弃帧/恢复测试继续通过。
5. 小 b：已确认绕过成立，applyVideoEditBuiltinEffect 的预设/模板展开路径不经过 makeVideoEditBuiltinEffect。展开时按相同 space 判断过滤 layer-only，助手预设 creation_items 同步过滤；双用 layer 效果保留。导入原预设内容不删改，纯 layer-only 预设及裸/带前缀 lens_blur 模板不能写入片段。测试覆盖真实领域写入、混合预设保留高斯、原预设完整及失败不改文档。

### 验证与独立审查

- 真实 GPU：videoEditBuiltinEffects.gpu.test.ts、videoEditColorGrade.gpu.test.ts、gaussianHosts.gpu.test.ts，共 38 项通过、1 项既有可选性能探针未启用；共享图片/剪辑高斯一致性通过。额外性能专项 glowEnergy.test.ts 两项通过。
- check:persistence-compat：64 种格式通过；作者生成器 --check 通过；check:assistant-capabilities 的结构、15 项覆盖和 31 文件/237 项不变量通过。
- 本 ticket 显式完整清单共 120 文件。按 testing.md 的验证器边界，package.json 与 .github/workflows/build.yml 两项单独做有界专项：validationScripts 20 项通过，另核对作者生成检查 npm 脚本、无条件 CI 步骤与 quality-gate 依赖。其余 118 文件执行正式 verify:changed --level L2：47 文件/863 项测试通过、2 项可选性能探针未启用；ESLint、渲染层与 Electron 两套类型检查、依赖图、主进程传递导入及持久基线通过，退出码 0。性能探针已用显式环境变量单独执行。过程中的唯一 lint 失败为新增性能测试的 console.info，已修为测试标准输出并完成定向及完整 L2 重跑。
- 独立审查 1 轮，无确认的重要或小问题。实际沿 CPU/GPU 调色、修图与片段高斯、作者主体/光纹理、弃帧 scratch/lookup，以及预设的界面与助手展开调用方检查，未发现本轮新增的同源缺陷。审查后仅改测试日志输出，无运行时代码增量。
- 未验证边界：Claude 的真实开发版目视核对、pose.blur 人眼观感兼容、ImageBitmap 光保真及真实媒体整段导出仍待后续验收；本轮未运行远端 CI，也未把自动测试当作这些验收的替代。

## Claude 观感验收（10-31 17:40，合并后 698fecaef，独立测试项目“图层效果验收（测试）”，1280×720 30fps）
- 测试源码修正：layoutText 的 fill.color 不接受 "white"，改为 "#FFFFFF" 才能通过试渲染（Codex 称已过类型检查，但运行时校验拒绝）。
- 跨片段相加：上方透明底标题发光叠到下方浅灰与深灰背景片段上，光晕处只提亮、不压暗、无灰雾 —— 通过。
- 深色背景观感：强度 15 霓虹感、字清楚，半径随时间连续增长；强度 40 更饱满仍可读；浅灰背景上强度 40 白字会糊成一片（光叠到顶，物理正确）。
- 强度 0：字清楚，带色差彩边（源码里的 chromaticAberration amount 8）。主体不透明度 0：只剩光。
- pose.blur 高斯 30 像素：GPU 与 Canvas 参照大小、亮度一致 —— 通过。
- **pose.blur 镜头散焦 30 像素：出现明显横向条纹（回归）** → 派 Codex 定点修复（lens 输入纹理的 mip 是否完整、是否在同一批次先生成）。
- 未验：旋转与非等比、clip 裁切、预览 1/2 与 1/4、真实图像素材、导出。
- 镜头散焦横纹的根因（Codex 17:38）：mip 完整且在 lens 前生成、LOD≈1.93 未越界；横纹来自固定的 96 点黄金角圆盘取样图案与高光加权本身，CPU 复算同样复现 —— 属于 lens 算法原有问题，不是合并回归。Claude 批准改算法：按像素交错梯度噪声旋转圆盘、样本层级按覆盖不小于平均间距选、保留亮斑特点，修前修后亮度/能量误差 < 3%；已加两种输入的真实 GPU 回归测试。
- 修复结果（Codex 18:20，Claude 审核并目视核对）：只改 lens 着色器，每个像素按 Jimenez 交错梯度噪声旋转取样圆盘（与帧无关、不闪）；第 2、3 步没有用到。高频横纹指标 4.93 → 0.93（阈值 1.5），平均亮度误差 0.041%、能量误差 0.012%，同参数下逐帧结果一致；GPU 24/24、L2 33/33 通过。测试时间线上，30 像素镜头散焦后的细线成了平滑色带，只剩极细的噪点，没有平行条纹。
