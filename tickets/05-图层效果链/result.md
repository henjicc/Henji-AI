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
