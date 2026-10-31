摘要：已将 review.md 首轮 24 项、第 12.1 节裁定及第 2 轮 15 项全部并入实施正文；本文为最终设计，Claude 自查后按依赖顺序开工，不再送设计复审。
摘要：只扩展剪辑片段空间属性、序列摄像机和受管 three 作者场景；A 负责格式与曝光调度，B 负责作者运行时，C 负责算法能力与读回。
摘要：20、12、15、17、18、10、21、19-U12/U13 先合并；A 吸收最新 main 并提交冻结接口，B/C 从该提交叠加开工，A 合并后各自 rebase 到 main；19-U9/U15a 在 B 之后。

# 16 三维空间技术设计

## 1. 范围、依据与基线

- 范围以 [plan.md](plan.md)、[review.md](review.md) 的最终裁定和 [以后再做第 4 项](../../docs/task/代码效果与渲染改进/以后再做.md) 的收窄决定为准。[三维空间调研](../../docs/task/代码效果与渲染改进/三维空间调研.md) 仅作技术依据；SpaceScene 编辑器、镜头参考迁移、摄像机轨道、模型/HDR 导入优化不在本票。
- 图片、视频、文字、图形、代码和嵌套序列片段可成为空间卡片；几何体由标准 TS/JS 与原生 three API 创作。只面向 AI 操作，不新增人工三维界面、第二套时间线、业务状态或撤销栈。
- 裁定顺序：review.md 第 2 轮 15 项、第 12.1 节裁定、首轮 24 项依次优先，均已落实在第 1–13 节。第 14 节只记已定方向，review.md 保存完整审查记录。API 9、中心深度近似及其动态换序例外、原型标定与 Claude 目视样片均已定；Claude 自查后直接开工，不再送设计复审。
- 本次唯一写入为本文件；不改源码、不安装/卸载依赖、不切分支、不提交或 push，不操作 9334 开发实例与 D:/视频制作。node_modules 为联接点，仅只读核对。未启动 GPU 原型或应用，本轮不能当作渲染验收。
- 代码核对基线：D:/VibeCode/Henji-AI-t16，task/16-三维空间，HEAD 90103a8f3bceb6b3d8c88b87f7302a461c390797，工作区干净、无上游。该值是设计调查基线，非未来集成 main 的冻结值；实现按第 3、7 节重新吸收前置票。
- 规则依据：[架构](../../docs/rules/architecture.md)、[持久格式](../../docs/rules/persistence.md)、[助手目标](../../docs/rules/assistant-goal.md)、[助手现状](../../docs/rules/assistant-status.md)、[应用能力](../../docs/rules/assistant-capability.md)、[能力技能](../../.codex/skills/henji-application-capability/SKILL.md)、[日志](../../docs/rules/logging.md)、[媒体边界](../../docs/rules/media-url.md)、[验证](../../docs/rules/testing.md)。本轮为 L0 文档核查；以下实现文件和签名是冻结的新增/扩展契约，不表示源码已实现。

## 2. 现有代码事实与复用决定

| 位置 | 事实与决定 |
| --- | --- |
| [document.ts](../../src/core/videoEdit/document.ts)，videoEditClipStateSchema、videoEditSequenceSchema；[keyframes.ts](../../src/core/videoEdit/keyframes.ts) | 片段已有位置、缩放、Z 轴旋转、锚点和曲线；新增深度与 X/Y 旋转，不复制二维属性。序列摄像机采用一个可动画对象，不新增 camera 片段类型。 |
| [clipGeometry.ts](../../src/core/videoEdit/clipGeometry.ts)，videoEditClipToFrame | x/y 是相对画面中心的宽/高比例，正 y 向下；不是左上角绝对比例。fit、anchor、scaleAspect、源方向必须保留。 |
| [videoEditGpuShaders.ts](../../src/features/videoEdit/engine/videoEditGpuShaders.ts)，VIDEO_EDIT_LAYER_VERTEX | 现有 warp 把单应矩阵变成齐次 x/y/w，但 z 固定为 0，且 warp2.z 被用作启用判定。不能把任意摄像机投影直接塞入并声称近/远裁剪正确。三维使用独立顶点布局和完整 clip xyzw，二维 shader 保持原行为。 |
| [videoEditGpuCompositor.ts](../../src/features/videoEdit/engine/videoEditGpuCompositor.ts)，draw；[videoEditCompositeScene.ts](../../src/features/videoEdit/engine/videoEditCompositeScene.ts)，normalize、resolveClip | 画面与片段按数组下标配对；附加效果会先画到全画幅，再把片段几何改成 identity。三维排序必须排序完整绘制项，附加效果路径必须保留空间元数据，不能只排序 clips 或让 identity 丢掉投影。 |
| [compositing.ts](../../src/core/videoEdit/compositing.ts)，buildVideoEditCompositePlan | 调整层已有轨道范围树，转场已有原子合成节点。保留此树的语义，不能对全序列简单按 z 排序。 |
| [motionBlur.ts](../../src/core/videoEdit/motionBlur.ts)；[videoEditRenderer.ts](../../src/features/videoEdit/engine/videoEditRenderer.ts)，render 帧准备 | 片段路径为 180° 快门，最多 16 样本，播放最多 8；位移估计间距 1.5px，不是调研文档里的统一“每 4px”。当前逐层平均不能保证曝光期间换序的遮挡。三维沿用采样器与质量档；仅快门内换序组逐子时刻合成后平均，稳定层序复用变换曝光。 |
| [videoEditBuiltinEffectPasses.ts](../../src/features/videoEdit/engine/videoEditBuiltinEffectPasses.ts)，planAuthorDefocus；[videoEditAuthorEffects.ts](../../src/features/videoEdit/engine/videoEditAuthorEffects.ts) | 镜头虚化已收口到共享效果计划及执行器；复用它的 padding、预乘 alpha、高精度和光贡献处理。不新增另一套 blur shader，不再按旧调研调用不存在的 AuthorGpu.lens。 |
| [videoEditAuthorModule.ts](../../src/features/videoEdit/engine/videoEditAuthorModule.ts)，AuthorFrameInfo、AuthorModule；[videoEditAuthorRuntime.ts](../../src/features/videoEdit/engine/videoEditAuthorRuntime.ts)，renderFrame | 作者已有 createWebGL/createWebGPU；WebGL 画布每帧 copyExternalImageToTexture，WebGPU 借同一 device 画目标。layers 与 GPU 入口互斥。现有 info.time 是作者源时间，不能改成序列时间。 |
| [authorLibraries.ts](../../src/core/videoEdit/codeMaterial/authorLibraries.ts)、[package.json](../../package.json) | 已冻结 three 0.186.1、three/webgpu、three/tsl；应用镜头参考仍使用 three 0.169。本票复用作者版，禁止宿主适配器误导入应用的另一版 three。 |
| [videoEditFields.ts](../../src/features/videoEdit/application/videoEditFields.ts)、[videoEditExecutors.ts](../../src/features/videoEdit/application/videoEditExecutors.ts)、[videoEditService.ts](../../src/features/videoEdit/application/videoEditService.ts) | 通用字段、实体事务、文档实例、editVideoProject 和保存回读已存在。只增加声明和领域算法；Pi/MCP 自动投影，不手写工具白名单。 |
| [recipes-3d.md](../../resources/assistant-skills/video-edit-code-creation/references/recipes-3d.md) | 当前还教作者手写伪透视和摄像机。实施后新增能力的配方调用宿主操作；旧 API 说明保留版本边界，不能继续把宿主已实现的投影/虚化作为作者作业。 |

## 3. 三条实现线、最终文件所有权与集成顺序

### 3.1 唯一写入方

下表 core/ 路径以 src/core/ 为根，engine/ 以 src/features/videoEdit/engine/ 为根，application/ 以 src/features/videoEdit/application/ 为根；其他路径以主仓库根 D:/VibeCode/Henji-AI/ 为根；标为新增的文件当前不要求存在。同名文件只能由一条线写，其他线交接口需求或补丁说明。

| 线 | 最终独占文件范围 | 交付 |
| --- | --- | --- |
| A：格式、求值、合成、曝光调度 | 新增 core/videoEdit/{spatialSchema,spatialTypes,spatialEvaluation,spatialMatrices,spatialPropagation,keyframeSchema}.ts；修改 core/videoEdit/{document,keyframes,keyframeLanes,clipGeometry,compositing,motionBlur,renderCache,renderFingerprint,timelineEdits,sequenceCopy,nestedSequences,reframe}.ts 与 core/videoEdit/styles/{templateSchemas,nativeTemplates,styleTemplateMigration}.ts、core/videoEdit/{presetPackage,codeMaterialVersions}.ts；core/creativeIntent/{persistence,referenceTransforms}.ts、core/persistence/{resourceContracts,versionedJson}.ts；新增 engine/{videoEditSpatialContracts,videoEditSpatialExposure,videoEditSpatialComposite,videoEditSpatialShaders}.ts；修改 engine/{videoEditGpuCompositor,videoEditGpuShaders,videoEditCompositeScene,videoEditRenderer,videoEditRenderPrecision,videoEditGpuBudget,videoEditMotionWorkerProtocol,videoEditMotionWorker,videoEditBuiltinEffectPasses}.ts；application/{videoEditClipSpeed,videoEditTemplates,videoEditReframe,videoEditMotionWorkerClient}.ts 的空间传播/Worker 接入；第 10 节全部格式文件；scripts/check-dependency-graph.cjs 及其定向测试 | 冻结领域 DTO、曝光调度与 B 回调签名；全传播、旧片指纹/像素、景深与组曝光、版本迁移；A 是最终 Renderer 调度 owner；ticket 12 合并后串行扩 planAuthorDefocus/共享效果计划的 CoC 尺度换算和小半径归零 |
| B：作者场景、后端、时钟、内容键 | 新增 engine/{videoEditAuthorThree,videoEditAuthorThreeWebGpu,videoEditAuthorThreeClock}.ts；修改 engine/{videoEditAuthorModule,videoEditAuthorRuntime,videoEditAuthorPrograms,videoEditAuthorParameters,videoEditAuthorTypeEnvironment,videoEditCodeGpu,videoEditCodeSources,videoEditAuthorFingerprint,videoEditCodeFingerprint,videoEditAuthorDeterminism,videoEditAuthorBundle,videoEditAuthorJsLocations,videoEditAuthorProbeSources}.ts；core/videoEdit/codeTrackReview.ts、core/videoEdit/codeMaterial/{declarationReader,contract,typeDiagnostics}.ts；resources/video-edit-author/author-api.d.ts | 实现 A 冻结的 CodeSources 帧准备/逐样本渲染/释放接口；受管场景、显式依赖、同模块身份、时钟确定性、GPU 资源与 ticket 15 键失效；消费 17 模拟和 18 网页 DTO |
| C：公共属性、算法、结构读回、配方 | 新增 core/videoEdit/spatialLayout.ts、core/application-control/domains/videoEdit/videoEditSpatialCapabilities.ts、application/videoEditSpatial.ts；修改 application/{videoEditFields,videoEditReflection,videoEditExecutors,videoEditDocumentAlgorithm,applicationDomain,videoEditFrameObservation}.ts、core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts；core/creativeIntent/{stagger,motionCompiler,fitting}.ts、core/videoEdit/{motionDraft,stabilization,tracking}.ts、application/{videoEditMotionGroup,videoEditSuperKeyframes,videoEditStabilization,videoEditTrackingEdits,videoEditTrackingEditing}.ts；resources/assistant-skills/video-edit-code-creation/{SKILL.md,references/recipes-3d.md,references/camera.md,references/author-api.md} | 通用字段同源；布局/展开/压平/验证算法；正式写入、读回、撤销、保存闭环；消费 A 求值/传播接口，不另算相机；上述运动入口仅处理二维键并保留空间键 |

表内列出的新增文件明确标为新增，其余是现有文件的本票增量；不授予目录内其他文件的默认修改权。相邻精确测试归实现 owner。A 拥有共享契约的定义权和空间传播服务；C 的通用执行器调用 A 服务，不能在字段写入路径另做删除级联或曲线转换。C 的纯计算由 A 接入既有运动 Worker/消息协议；B/C 不分别扩 Worker 协议。新增 core 文件之间用相对导入，schema 与 DTO 不导入 feature 或 GPU 类型。

补充所有权：作者入口枚举的 AuthorDeterminism、AuthorBundle、AuthorJsLocations、AuthorProbeSources、codeTrackReview、declarationReader、contract、typeDiagnostics 全归 B；API 9 常量所在 codeMaterialVersions.ts 归 A，B 不改版本常量。C 的二维运动入口与 A 的通用四键传播分工见 10.3；A 不改 C 的拟合/运动策略。planAuthorDefocus 当前位于 videoEditBuiltinEffectPasses.ts，其在 ticket 12 后的落点及相邻精确测试由 A 串行接手，效果 owner 不与 A 并发写。

全局文件也有唯一责任人：A 汇总 schemaVersions、formats、formatMigrations、schemaBaseline、releasedCompatibility、格式夹具和公共契约版本；B 提供作者 API/类型增量，C 提供能力声明增量，均交 A 串行登记。Claude 负责主工作区依赖安装、package.json/锁文件与全局生成命令的串行执行，A 校验其产物并集成；三线不得自行安装，也不得分别生成全局文件互相覆盖。polygon-clipping 已获批准，由 Claude 安装后各线吸收，不重提选型。

### 3.2 实施次序

唯一执行表见 7.2。前置集合全部合入后，16-A 从最新 main 开工并负责吸收其接口与冲突。A 先提交 4.5/4.6 的可编译契约、schema 和数值夹具；B、C 分别从 **A 该接口提交的分支创建叠加分支**，以同一提交为父基线并行实现各自所有权内代码。A 合并 main 后，B/C 各自 rebase 到 main，移除已合入的 A 祖先，不重复 cherry-pick、不把另一条线未完成内容混入。

A 先集成格式和调度骨架；B 提供作者回调，C 提供领域算法与公共属性。A 串行接 Renderer、预算和运动 Worker，C 验正式事务闭环。三线完成后共用一份正式产物做 P1–P5 与匹配验证；Claude 自查设计后开工，实现提交前的独立代码审查仍遵循 AGENTS.md，不能混为再次设计送审。

API 9 在 17/18 首次登记后由 16 扩充，未发布前共用同一版本常量，16 不占 API 10。最终持久格式数字由 A 按最新 main 登记表递增，最低 reader 按第 10 节执行；这属于执行事项，不是待决设计。

## 4. 领域数据、坐标与冻结接口

### 4.1 片段空间属性并入既有动画系统

- spatial 对象**只新增 enabled**。depth、rotationX、rotationY、anchorDepth 是与 x/y/scale/rotation/anchorX/anchorY 并列的片段数值字段；曲线只存 clip.curves.depth / rotationX / rotationY / anchorDepth。没有 spatial.curves 或第二套空间动画轨道。
- 四个键加入 VIDEO_EDIT_ANIMATABLE_KEYS、videoEditClipAnimatedValueSchemas 和 videoEditClipCurvesSchema；初值均为 0。现有求值器对未提供键的 fallback 不能套用 anchor 的 0.5，空间默认值须显式为 0；旧二维字段的默认/限值不因扩枚举改变。空间关闭时保留数值与曲线，求值不产生空间贡献；已有 motion 内在区段禁用同样使空间变换失效。
- 关键帧沿用 videoEditKeyframesSchema：持久关键帧时刻为片段内整数帧，求值允许小数子帧；hold、Bezier、easeRange/easeValues、手工/自动来源与通用 slice/scale 语义不变。keyframeLanes、通用读写、修剪/分割/变速/改帧率等传播见第 10 节，不另写空间专用曲线切分器。
- depth/anchorDepth 单位为序列显示高度，正深度朝默认镜头；旋转为度。anchorDepth 只改变轴心，不作为排序或景深距离。x/y/scale/scaleAspect/Z 旋转、fit、源方向与角点贴合沿用原字段。

### 4.2 相机唯一表示与恒等判定

序列可选 spatialCamera 保存**相对默认机位的偏移 + 透视量**，不保存绝对 position、focalLength、矩阵和派生焦距副本。冻结结构如下，所有数值曲线复用既有关键帧值/插值契约，时间为序列帧：

| 持久属性 | 语义与默认 |
| --- | --- |
| offsetX / offsetY / offsetZ | 世界轴的机位平移偏移，显示高度单位，缺省 0 |
| rotationX / rotationY / rotationZ | 基准视向上的局部旋转偏移，度，缺省 0 |
| perspective | 透视量，缺省 0；改变它执行推拉变焦：f=80×2^perspective mm，F=f×a/36，未绑定时机位移到 (0,0,F)，同步改 FOV，使 z=0 平面取景恒定；不额外保存 f 或机位副本 |
| framing? | 取景对象（稳定 clip 引用或明确世界点/包围框）与 heightFraction；持久保存意图本身，目标引用只能 hold 切换，heightFraction 可动画；perspective 使用上方同一字段/曲线，不在 framing 另存一份 |
| aim? / focus? | 独立瞄准、对焦绑定；clip 或世界点，焦点也可用显式视深距离；离散绑定仅 hold。省略 aim 使用基准视向，省略 focus 使用默认参考平面 |
| defocus / fStop? | defocus 为 0 时无景深贡献，缺省 0；fStop 在启用后参与光学求值，缺省 fStop=5.6，由 schema 统一定义，不以是否存在 fStop 判断空间开启 |
| curves? / bindings? | curves 保存数值与点/包围框分量曲线；bindings 保存 framing/aim/focus 的完整目标 hold 曲线，解除用显式 null；不插值 clipId，不混进 clip.curves |

相机数值曲线键和绑定结构按 4.5 的 SpatialCamera 冻结。数值键无点号，由同一 schema 映射到对象字段；bindings 用完整目标的 hold 通道，世界点/包围框分量用数值通道，不能把 ApplicationRef 塞进数值曲线或插值 clipId。字段映射与传播遍历同一声明表。

相机求值在每个时刻先算当前画幅的默认机位 C0，再求 framing/aim 的派生机位与基准朝向，最后应用 offset 和旋转偏移。令 Δperspective=(0,0,F−F0)，无 framing/aim 时 C=C0+Δperspective+offset，故改变 perspective 同时推拉机位与焦距，z=0 平面大小不变，其他深度产生视差。只有 aim 时，以此机位求朝向后施加旋转偏移。framing 时，以目标可见几何中心及占高比例、同一 perspective 反解机位，得到相对 C0 的总派生增量 Δframing（已包含该透视量所需距离），再取 C=C0+Δframing+offset，不重复加 Δperspective。目标动画或改画幅会重新求解，不能把一次反解的绝对位置当持久真相。framing 与显式 aim 同时出现时 aim 决定视向，framing 沿该视向解占高；解不存在时返回具体几何事实。

- 原始光学读回返回派生焦距/距离/FOV；精确写入通过同一转换服务写回 perspective/偏移/取景意图，不能形成第二套绝对相机状态。对焦与瞄准独立，推近不会自动换焦点。
- **缺省相机，或无 framing/aim/非默认焦点绑定且offsetX/offsetY/offsetZ、rotationX/rotationY/rotationZ、perspective、defocus 的全部有效值均严格等于 0，是相机规范恒等。** fStop 等休眠参数不产生贡献；非零绑定/意图不凭数值近似判为恒等。零来自数据规范化或曲线端点，不使用 epsilon，不比较近似单位矩阵。全帧 flatIdentity 还要求曝光所有样本的有效卡片四个空间值为 0、没有可见 worldScene 贡献，见第 5 节。
- 一条序列只有一台相机，镜头切换用 hold。二维覆盖项不因存在相机变成空间卡片。目标不在有效时间内仍可求其曲线几何，targetActive=false；损坏引用明确失败，不使用上一帧焦点。
- 删除/分割目标、序列复制、部分复制、嵌套、尺寸/PAR/重构图变更由 A 的 spatialPropagation 处理，C 只调用；完整传播规则见第 10 节。引用解绑定须保存等价世界目标/取景轨迹和普通曲线，同一事务内完成、可撤销，不静默改目标。

### 4.3 坐标、中心、旋转与时间

- 逻辑显示宽 Wd=sequence.width×pixelAspectRatio，高 H=sequence.height，a=Wd/H；世界 X 向右、Y 向上、Z 朝默认摄像机，右手系。旧二维位置映射为 (x×a, −y, depth)，局部长度除以 H；像素长宽比只应用一次，preview divisor/导出缩放只改变栅格密度。
- 默认 f0=80mm、sensorWidth=36mm，F0=f0×a/36，C0=(0,0,F0)，视向 −Z，垂直 FOV=2 atan(0.5/F0)。当 perspective 非零时 F=f×a/36，无绑定默认机位同步移到 (0,0,F)，FOV=2 atan(0.5/F)，保持 z=0 平面恒定取景；three 使用显示 aspect，不用编码栅格 aspect 或 filmGauge 的长边语义代替横向传感器。
- 局部操作顺序与 AE 的 X→Y→Z 轴旋转一致：先锚点平移/缩放及参考平面的角点贴合，再绕空间轴心依次旋转 X、Y、Z，最后平移至片段位置。列向量组合写成 Rz·Ry·Rx；旧 Z 旋转的屏幕顺时针约定在边界转换为世界角度，X/Y 的正向由同一右手系转换固定，不能直接依赖 three 默认 Euler order。非交换旋转数值夹具固定此约定。
- 双面显示，背面可见且文字/图案镜像，不自动翻正 UV。lookAt 上向量默认 +Y；与视向平行时，按与视向绝对点积最小的世界轴确定回退，固定同值优先次序，不读取上一帧朝向。机位与目标重合返回不可求视向事实。
- 排序与景深中心采用**近/远及视口裁剪后的可见卡片多边形质心**，在卡片平面/视空间求面积质心后变换到视空间；为空则不绘制。未裁剪时即几何中心。另保留完整边界/视深范围作诊断与布局。锚点只作轴心。three 场景按宿主求得的场景包围几何中心作单层近似，不让作者锚点支配排序。
- 空间矩阵复用锁定 three 0.186.1 的数学类；core schema 不导入它。spatialEvaluation/spatialMatrices 在 Worker 或算法执行入口懒加载；这是“宿主不打包第二份场景 three”规则的唯一数学例外，只向外传数值数组/DTO，不传 Vector/Matrix 对象，不跨模块实例做 instanceof；WebGPU z∈[0,w] 与 WebGL z∈[−w,w] 由同一光学参数分别生成，不混用投影。
- 相机与卡片按精确 sequenceFrame/subframe 求值。info.time 是作者源时间，info.clip.time 是片段内时间；info.space 显式携带 sequenceTime、sampleTime、sourceTime，均注明秒。源时间按正式变速/倒放/重映射入口转换；不把序列时间直接传给 simulation.at。
- 嵌套子序列用自己的时间与相机，先合成，再成为父序列一张卡；不自动折叠内部三维。仅整序列复制保留相机，模板首期不携带相机。

### 4.4 core 拆分与依赖图门禁

依赖方向固定为：document/格式登记 → spatialSchema（外部依赖仅 zod 与共享纯 schema）；公共声明 → spatialTypes（纯 DTO/type-only）；运行时/算法入口 → dynamic import spatialEvaluation/spatialMatrices → 作者版 three 数学。spatialLayout 由 C 在 Worker 中调用这些求值器；schema 不得经 barrel 间接导出求值器。既有关键帧结构先由 A 抽出到仅含 zod 结构的 keyframeSchema.ts，keyframes.ts 继续导出原公开名称并提供求值/切分；spatialSchema 直接复用这个轻量结构，不能为复用曲线去静态导入含效果求值的 keyframes.ts，也不复制一份关键帧格式。GPU 纹理/lease 类型只在 engine/videoEditSpatialContracts.ts，不能倒灌进 core。

A 将 `henji-author-three-0.186.1`（含子路径，以及以后同前缀版本别名）加入 scripts/check-dependency-graph.cjs 的重包识别；现有裸 `three` 名单不能覆盖 npm alias。门禁覆盖直接静态导入、静态 re-export/barrel、动态入口被静态值边重新拉回首屏的情况。类型导入不算运行时依赖；不通过更新基线放行新的首屏重包。门禁定向夹具须证明别名可被拦截，正常懒加载可通过。

### 4.5 A/B/C 领域契约（冻结）

以下纯数值类型由 A 放在 core/videoEdit/spatialTypes.ts；schema 在 spatialSchema.ts。现有 VideoEditComposition/VideoEditClip、VideoEditKeyframe/VideoEditKeyframes、EffectQuality 均只做 type-only 导入，使用仓库已有定义。空间字段缺省不写入旧作品；下列可选字段只在求值时取 4.1/4.2 的默认值。

```ts
type SpatialKey = 'depth' | 'rotationX' | 'rotationY' | 'anchorDepth';
type SpatialVec2 = readonly [number, number];
type SpatialVec3 = readonly [number, number, number];
type SpatialMat4 = readonly [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number
];
interface SpatialRect { x: number; y: number; width: number; height: number }
interface SpatialBounds { min: SpatialVec3; max: SpatialVec3 }
type SpatialTarget =
  | { kind: 'clip'; clipId: string }
  | { kind: 'point'; point: SpatialVec3 }
  | { kind: 'bounds'; bounds: SpatialBounds };
type SpatialFocus = SpatialTarget | { kind: 'distance'; distance: number };
type SpatialHold<T> = readonly { time: number; value: T; interpolation: 'hold' }[];
type SpatialCameraNumericKey =
  | 'offsetX' | 'offsetY' | 'offsetZ'
  | 'rotationX' | 'rotationY' | 'rotationZ' | 'perspective'
  | 'framingHeightFraction' | 'defocus' | 'fStop' | 'focusDistance'
  | `${'framing' | 'aim' | 'focus'}${'X' | 'Y' | 'Z'}`
  | `${'framing' | 'aim' | 'focus'}${'Min' | 'Max'}${'X' | 'Y' | 'Z'}`;
interface SpatialCamera {
  offsetX?: number; offsetY?: number; offsetZ?: number;
  rotationX?: number; rotationY?: number; rotationZ?: number;
  perspective?: number; defocus?: number; fStop?: number;
  framing?: { target: SpatialTarget; heightFraction: number };
  aim?: SpatialTarget;
  focus?: SpatialFocus;
  curves?: Partial<Record<SpatialCameraNumericKey, VideoEditKeyframes>>;
  bindings?: {
    framing?: SpatialHold<SpatialTarget | null>;
    aim?: SpatialHold<SpatialTarget | null>;
    focus?: SpatialHold<SpatialFocus | null>;
  };
}
interface SpatialOutput {
  width: number; height: number; // 实际栅格像素
  displayWidth: number; displayHeight: number; // 含 PAR 的逻辑画幅
}
interface SpatialCameraFrame {
  position: SpatialVec3; target: SpatialVec3; up: SpatialVec3;
  focalLengthMm: number; sensorWidthMm: number;
  focusDistance: number; fStop: number; defocus: number;
  near: number; far: number; fovYRadians: number;
  view: SpatialMat4; projectionWebGpu: SpatialMat4; projectionWebGl: SpatialMat4;
  canonicalIdentity: boolean;
  resolvedAim: SpatialVec3; resolvedFocus: SpatialVec3;
  targetActive: boolean;
}
interface SpatialCardGeometry {
  clipId: string; ordinal: number; compoundGroup?: string;
  uvToWorld: SpatialMat4; clipFromUv: SpatialMat4;
  logicalBounds: SpatialRect;
  effectPadding: readonly [number, number, number, number]; // 左上右下，逻辑像素
  anchorWorld: SpatialVec3; centerWorld: SpatialVec3;
  originalQuad: readonly [SpatialVec3, SpatialVec3, SpatialVec3, SpatialVec3];
  visiblePolygon: readonly SpatialVec3[];
  screenPolygon: readonly SpatialVec2[]; // 归一化显示坐标
  screenBounds: SpatialRect;
  centerViewDepth: number; viewDepthRange: readonly [number, number];
  cocRadiusPx: number; cocRangePx: readonly [number, number];
  behindCamera: boolean; clipped: boolean; ambiguousDepth: boolean;
}
interface SpatialFact {
  code: 'missing-target' | 'invalid-optics' | 'singular-aim'
    | 'clipped' | 'ambiguous-depth' | 'projection-residual' | 'unknown-scene';
  clipIds: readonly string[];
  sequenceFrame: number;
  message: string;
  values: Readonly<Record<string, number | string | boolean>>;
}
interface SpatialFrame {
  sequenceFrame: number; sequenceTime: number; output: SpatialOutput;
  camera: SpatialCameraFrame; cards: readonly SpatialCardGeometry[];
  flatIdentity: boolean; facts: readonly SpatialFact[];
}
interface SpatialSnapshot {
  composition: Readonly<VideoEditComposition>;
  sequenceId: string;
  revision: VideoEditComposition['revision'];
}
interface SpatialClipEdit {
  clipId: string;
  values: Partial<Pick<VideoEditClip,
    'x' | 'y' | 'scale' | 'scaleAspect' | 'rotation' | 'anchorX' | 'anchorY'
    | 'depth' | 'rotationX' | 'rotationY' | 'anchorDepth' | 'spatial'>>;
  curves?: VideoEditClip['curves'];
}
interface SpatialPatch {
  sequenceId: string; expectedRevision: VideoEditComposition['revision'];
  clips: readonly SpatialClipEdit[];
  camera?: { value: SpatialCamera | null };
  achievedParallaxRatio: number;
  maxProjectionErrorPx: number;
  facts: readonly SpatialFact[];
}
type SpatialLayoutIntent =
  | { kind: 'arrange'; clipIds: readonly string[]; referenceFrame: number;
      parallaxRatio: number; focusClipId: string; range?: readonly [number, number] }
  | { kind: 'expand'; clipIds: readonly string[]; range: readonly [number, number];
      parallaxRatio: number; focusClipId: string; perspective: number }
  | { kind: 'flatten'; clipIds: readonly string[]; range: readonly [number, number];
      focusClipId: string };
interface SpatialInspection {
  frame: SpatialFrame;
  cards: readonly {
    clipId: string; drawOrder: number; visibleFraction: number | null;
    occludedBy: readonly string[];
    visibility: 'proven-visible' | 'proven-occluded' | 'estimated' | 'unknown';
    approximation: 'layer-center';
    sceneBoundsSource: 'render-observation' | 'none';
  }[];
}
declare function evaluateSpatialFrame(
  composition: Readonly<VideoEditComposition>, sequenceFrame: number,
  output: SpatialOutput, quality: EffectQuality
): SpatialFrame;
declare function planSpatialLayout(
  snapshot: SpatialSnapshot, intent: SpatialLayoutIntent,
  output: SpatialOutput, signal: AbortSignal
): Promise<SpatialPatch>;
declare function inspectSpatialFrame(
  snapshot: SpatialSnapshot, frame: SpatialFrame
): SpatialInspection;
declare function applySpatialPatch(
  snapshot: SpatialSnapshot, patch: SpatialPatch
): VideoEditComposition;
interface SpatialPropagationRequest {
  before: SpatialSnapshot;
  proposed: VideoEditComposition;
  operation: 'fields' | 'trim' | 'split' | 'retime' | 'move' | 'ripple'
    | 'frame-rate' | 'resize' | 'reframe' | 'copy' | 'paste' | 'nest'
    | 'unnest' | 'delete' | 'template';
  clipMap: readonly {
    fromSequenceId: string; fromClipId: string;
    sourceRange: readonly [number, number];
    toSequenceId: string; toClipId: string | null;
  }[];
  sequenceTimeMap: readonly {
    sequenceId: string;
    sourceRange: readonly [number, number];
    targetRange: readonly [number, number] | null;
  }[];
  output: SpatialOutput; quality: EffectQuality; signal: AbortSignal;
}
declare function planSpatialPropagation(
  request: SpatialPropagationRequest
): Promise<{ composition: VideoEditComposition; facts: readonly SpatialFact[] }>;
```

A 定义全部公共 DTO、evaluateSpatialFrame、applySpatialPatch 与 planSpatialPropagation；C 实现 planSpatialLayout/inspectSpatialFrame，使用 A 的相机求值，Worker 接入由 A 完成。矩阵为列主序，逻辑坐标/单位按 4.3。SpatialPatch 是内部封闭计算结果，不是新开放 patch 工具；curves 若存在是合并后的完整片段曲线，必须保留未修改键，camera:null 表示移除相机对象，camera 省略表示不改。纯 apply 返回新 composition；C 的公共字段或算法先构造 proposed，再调 A 的 planSpatialPropagation，最后由同一文档算法守卫核对 revision、一次事务保存与撤销。传播服务不做 I/O；clipMap 表示身份变化及其原序列半开有效区间，toClipId:null 表示目标移除，未列出的身份不变；sequenceTimeMap 是半开区间的线性有理帧映射（targetRange:null 表示删除区间），空数组表示序列时钟不变，hold/区间边界按 10.2 保留。映射由正式时间线操作产生，C 不猜测映射；仅修改相机属性用 operation='fields' 与空映射。proposed 包含 before 的其他序列快照，传播据此处理跨序列引用，返回完整变更与事实后才提交。

bindings 的 time 为整数序列帧；value:null 是解除该绑定的明确事件，仅用于此联合类型，不代表任意可选字段接受 null。绑定采用完整 tagged target 的 hold 通道；数值曲线只保存数值，framing/aim/focus 的 X/Y/Z 对应 point，Min/Max 分量对应 bounds，focusDistance 仅用于 distance。有效 binding 覆盖静态目标，再叠加与当前种类匹配的数值通道；休眠通道保留但无贡献。frame 中的裁剪空集用空 polygon 表示，不制造 NaN；不可求相机/损坏引用由带 SpatialFact 的领域错误返回，不发布半张成功帧。

expand 的 perspective 是第 8.3 节公开的目标透视量；framingHeightFraction 从参考画面读取并持久化。公共入口用完整 ApplicationRef，C 通过已有解析器得到上述内部 clipId/sequenceId，返回时映射回完整引用，不能自己拼另一套身份。

### 4.6 曝光调度冻结签名（A 负责）

A 在 engine/videoEditSpatialContracts.ts 定义下列类型，videoEditSpatialExposure.ts 实施唯一调度；B 在 CodeSources/Runtime 实现 SpatialCodeSources。GPU 类型只在 engine。以下跨文件类型与函数均从所属契约模块 export，declare function 表示冻结签名，实施时提供函数体。下文 Spatial* 数值 DTO 来自 4.5；VideoEditGpuColorFormat 从 engine/videoEditGpuFrame.ts type-only 导入现有 GPU 格式类型，EffectQuality 使用现有质量枚举。type-only 类型导入不加载 three。

```ts
type SpatialContentKind = 'card' | 'worldScene';
interface SpatialSourceDescriptor {
  clipId: string; kind: SpatialContentKind; spaceDependency: boolean;
}
interface SpatialSample {
  index: number; sequenceFrame: number; weight: number;
  frame: SpatialFrame;
  clips: readonly {
    clipId: string; sequenceFrame: number; sourceTime: number;
    centerSourceTime: number; motionBlur: boolean;
  }[];
}
interface SpatialTargetSpec {
  key: string; width: number; height: number;
  format: VideoEditGpuColorFormat; usage: GPUTextureUsageFlags;
}
interface SpatialMaterialPlan {
  clipId: string; kind: SpatialContentKind;
  contentTime: 'center' | 'sample';
  centerFrame: number; centerSourceTime: number;
  referenceSize: { width: number; height: number };
  logicalBounds: SpatialRect;
  uvToReference: SpatialMat4;
  rasterScale: SpatialVec2; // 每逻辑像素的材料面纹素数
  supportBoundsPx: SpatialRect; // 材料面纹理内、含发光的支持域
  defocus: {
    centerCocRadiusPx: number; materialRadiusPx: SpatialVec2;
    workBoundsPx: SpatialRect; downsample: number; bypass: boolean;
    stage: 'center-material' | 'after-layer-accumulation' | 'per-scene-sample';
  };
  target: SpatialTargetSpec;
  highPrecision: boolean; carriesLight: boolean;
}
interface SpatialFrameRequest {
  composition: Readonly<VideoEditComposition>; sequenceFrame: number;
  output: SpatialOutput; quality: EffectQuality;
  sessionKind: 'preview' | 'prerender' | 'export' | 'observe';
  sources: readonly SpatialSourceDescriptor[];
  requestId: string; signal: AbortSignal; assertCurrent(): void;
}
interface SpatialGroupPlan {
  id: string; mode: 'single' | 'transform' | 'group';
  clipIds: readonly string[]; itemIds: readonly string[];
  orderBySample: readonly (readonly string[])[];
}
interface SpatialExposurePlan {
  centerFrame: SpatialFrame; samples: readonly SpatialSample[];
  shotRange: readonly [number, number];
  groups: readonly SpatialGroupPlan[];
  materials: readonly SpatialMaterialPlan[];
  workingSetBytes: number;
}
declare const preparedSpatialBrand: unique symbol;
interface PreparedSpatialFrame {
  readonly [preparedSpatialBrand]: true;
}
interface SpatialPrepareRequest {
  frame: SpatialFrameRequest; plan: SpatialExposurePlan;
}
interface SpatialSceneSample {
  clipId: string; sampleIndex: number; sequenceFrame: number;
  worldBounds: SpatialBounds | null; // null 是空场景
}
interface SpatialSampleRequest {
  prepared: PreparedSpatialFrame;
  clipId: string; sampleIndex: number; sequenceFrame: number;
  sourceTime: number; centerSourceTime: number;
  spatialFrame: SpatialFrame;
  target: SpatialTargetSpec;
  materialPlan: SpatialMaterialPlan;
}
interface SpatialPictureLease {
  readonly texture: GPUTexture;
  readonly owner: 'code-sources' | 'composite-host';
  readonly width: number; readonly height: number;
  readonly format: VideoEditGpuColorFormat;
  readonly highPrecision: boolean; readonly carriesLight: boolean;
  readonly completion: Promise<void>;
  readonly worldBounds?: SpatialBounds | null;
  release(afterUse: Promise<void>): Promise<void>;
}
interface SpatialCodeSources {
  describeSpatialSources(
    composition: Readonly<VideoEditComposition>, signal: AbortSignal
  ): Promise<readonly SpatialSourceDescriptor[]>;
  prepareSpatialFrame(request: SpatialPrepareRequest): Promise<PreparedSpatialFrame>;
  inspectSpatialSceneSamples(
    prepared: PreparedSpatialFrame
  ): Promise<readonly SpatialSceneSample[]>;
  renderSpatialSample(request: SpatialSampleRequest): Promise<SpatialPictureLease>;
  generatorTargetCapacity(width: number, height: number, format: VideoEditGpuColorFormat): number;
  releaseSpatialFrame(prepared: PreparedSpatialFrame): Promise<void>;
}
interface SpatialDrawItem {
  itemId: string; sourceKey: string; clipId: string;
  kind: SpatialContentKind | 'transition';
  picture: SpatialPictureLease; geometry: SpatialCardGeometry;
  opacity: number; groupId: string; ordinal: number;
  projection: 'material' | 'screen';
}
declare const spatialAccumulatorBrand: unique symbol;
interface SpatialAccumulator {
  readonly [spatialAccumulatorBrand]: true;
}
interface SpatialSubmission { readonly completion: Promise<void> }
interface SpatialCompositeHost {
  generatorTargetCapacity(width: number, height: number, format: VideoEditGpuColorFormat): number;
  reserveWorkingSet(plan: SpatialExposurePlan, signal: AbortSignal): Promise<void>;
  prepareCardMaterial(
    request: SpatialFrameRequest, materialPlan: SpatialMaterialPlan
  ): Promise<SpatialPictureLease>;
  consumePicture(
    picture: SpatialPictureLease, target: SpatialTargetSpec
  ): Promise<SpatialPictureLease>;
  applyCenterDefocus(
    picture: SpatialPictureLease, materialPlan: SpatialMaterialPlan,
    sampleSupportBoundsPx: SpatialRect
  ): Promise<SpatialPictureLease>;
  beginAccumulation(target: SpatialTargetSpec): Promise<SpatialAccumulator>;
  accumulateLayerSample(
    accumulator: SpatialAccumulator, item: SpatialDrawItem, weight: number
  ): Promise<SpatialSubmission>;
  finishLayer(accumulator: SpatialAccumulator): Promise<SpatialPictureLease>;
  compositeGroup(
    group: SpatialGroupPlan, sample: SpatialSample,
    orderedItems: readonly SpatialDrawItem[]
  ): Promise<SpatialPictureLease>;
  accumulate(
    accumulator: SpatialAccumulator, groupPicture: SpatialPictureLease, weight: number
  ): Promise<SpatialSubmission>;
  finish(accumulator: SpatialAccumulator): Promise<SpatialPictureLease>;
  compositeFrame(
    request: SpatialFrameRequest,
    groups: readonly { groupId: string; picture: SpatialPictureLease }[]
  ): Promise<SpatialPictureLease>;
  releaseAccumulation(accumulator: SpatialAccumulator): Promise<void>;
  releaseWorkingSet(): Promise<void>;
}
type SpatialExposurePicture = SpatialPictureLease;
declare function planSpatialExposure(
  request: SpatialFrameRequest, sceneSamples?: readonly SpatialSceneSample[]
): SpatialExposurePlan;
declare function renderSpatialExposure(
  request: SpatialFrameRequest, plan: SpatialExposurePlan,
  sources: SpatialCodeSources, host: SpatialCompositeHost
): Promise<SpatialExposurePicture>;
```

**类型与所有权规则**

- PreparedSpatialFrame 对 A 完全不透明，仅能原样传回 B；B 用私有 WeakMap 保存实例、输入 lease、取消身份和模拟准备结果，A 不拆字段、不持有作者实例。品牌 symbol 从契约模块导出，B 构造带该标记的空句柄并在私有 WeakMap 登记；A 只传句柄，构造和解析只在 B 内发生。releaseSpatialFrame 幂等，释放输入及实例借用，不销毁宿主 device。
- SpatialPictureLease 是只读借用。completion 指该输出已完成的既有 GPU 完成信号；调用方最后一次使用后用 release(afterUse) 交回，owner 等待生产与消费均结束才复用或销毁。Host 方法借用输入、不隐式释放；accumulateLayerSample/accumulate 返回提交回执，其 completion 传给输入 lease.release(afterUse)，不能把“已编码/已提交”的 Promise 当 GPU 消费完成；consumePicture 复制/接管为 Host 管理的独立输出借用，A 随后显式释放原借用。bypass 可以返回同纹理的新计数借用，不能给一个句柄重复释放。失败在 finally 中释放已取得的全部 lease/累积器/准备对象，不发布部分累积图。
- materialPlan 由 A 产生，B 只消费尺寸、参照映射、precision/carriesLight 与 contentTime，不自行执行景深。A 通过 centerCocRadiusPx、中心投影 Jacobian 与 rasterScale 换算材料面半径，worldScene 已投影则按输出/工作纹理倍率换算。中心参数不随样本重算；per-scene-sample 仅更新样本支持域与局部 workBounds，按 12.1 运行同一计划。
- **内容键只由 B 生成**。SpatialSampleRequest 没有 contentKey；A 只传精确时刻、相机/几何、输出规格与材料计划。源码/库/dataFiles/参数/frameKey/模拟 epoch 等作者指纹由 B 的唯一实现收口。target.key 是工作目标定位键，不能当内容身份。
- generatorTargetCapacity 的真实实现保留在 VideoEditCodeGpu；B 在 CodeSources 显式转接同名签名，Host 的同名方法注入委托 CodeSources，A 调 Host，不越层访问 CodeGpu，也不复制容量公式。A 再结合 videoEditGpuBudget 和 three 内部 RT 字节计算必要工作集。prepareCardMaterial 仅用于非代码卡片；代码卡片（含 space:true）统一由 B 的 renderSpatialSample 供图。

**规划与调用次序**

0. B 先 describeSpatialSources 读已获信任的不可变声明，A 根据结果生成 request.sources 和初始 plan。createThree 隐含空间依赖，非 three 仅显式 space:true；普通代码不受相机内容依赖污染。
1. A 调 prepareSpatialFrame 一次；B 准备中心媒体/网页输入、全部正式及探测源时间的模拟包络、实例与预热。只可在 ticket 15 允许且真实目标内容仍匹配时跳过昂贵输入准备。动态场景的排序探测仍须具有同一时间姿态，不能用旧输出键跳过必要的几何更新。
2. B 的 inspectSpatialSceneSamples 在受管串行队列按中心和计划样本取 simulation.at(sourceTime)、更新场景并返回数值 worldBounds，不产出 N 张纹理。中心用 sampleIndex=-1；其他索引与 plan.samples 一一对应。A 用这些数值调用 planSpatialExposure(request, sceneSamples) 完成质心、裁剪与换序判断并定稿 group/mode/materialPlan。初始 plan 的 mode 不能提前旁路场景探测；最终 plan 不增删采样时刻，探测覆盖中途交叉而非仅首尾。若采样器需追加时刻，释放准备对象后按完整新包络重做准备，禁止未 prepare 就 at(t)。真正 render 前 B 再按该时刻设置对象，不能使用探测最后时刻残留状态。对 clip.motionBlur=false，A 在该 clip 的请求中传中心 sequenceFrame/sourceTime/spatialFrame（含中心相机），其他 clip 仍传自己的有效样本时刻，不直接拿共享 sample.frame 覆盖冻结语义。
3. A 经 Host 查询容量、reserveWorkingSet。必要驻留为当前作者目标、中心材料面/可 spill 输入、组工作目标、曝光累积目标及效果临时目标，不按 N 分配 N 份输出。预算紧张按项/样本串行及既有 spill 处理；spill 使 B 的实际目标内容键失效；高精度/发光数据不得降成 8 位。最低必要工作集不能容纳则返回事实，不限卡片数、不静默减样本。
4. **普通卡片统一中心准备**：非代码走 prepareCardMaterial；代码走 renderSpatialSample，sampleIndex=-1，sequenceFrame/sourceTime/spatialFrame 全为中心，materialPlan.contentTime='center'。space:true 的非 three 亦如此。内部 pose 模糊在中心作者材料面流程内保留。consumePicture → applyCenterDefocus 一次，所得材料面在曝光子时刻只重投影，不再调 B。
5. **single**：中心生成/场景渲染 → 一次中心景深 → 按中心层序 compositeGroup；无曝光累积。序列/片段模糊关闭的有效时刻按 5.4 冻结。
6. **transform：稳定层序**：普通卡片以中心已虚化材料面及各样本 geometry 调 accumulateLayerSample。worldScene 则 beginAccumulation → 对每个样本 B.renderSpatialSample → consumePicture → accumulateLayerSample(weight) → 释放该样本借用 → finishLayer → **applyCenterDefocus 一次**。worldScene 的 projection='screen'，累积不再投影；普通卡片为 'material'，累积执行投影。完成的层输出均标为 screen、opacity=1（源 opacity 已在样本中应用），按稳定层序 compositeGroup，禁止二次应用片段 opacity/变换。A 独占逐层累积，B 必须逐样本渲染，不能只交中心图。
7. **group：快门内换序**：beginAccumulation → 每个子时刻依该时刻层序获取项：普通卡片重用第 4 步材料面，worldScene 经 B.renderSpatialSample → consumePicture → **若动态且启用景深则 applyCenterDefocus（中心 CoC、该样本局部支持域）** → compositeGroup → accumulate(weight) → 释放本样本临时借用 → 下一样本 → finish。静态且相机/根变换也不变的 worldScene 可复用中心已滤图；只要有效场景输出随样本变化即按动态处理。不先把世界场景逐层平均，否则会丢换序遮挡。
8. 各组完成后 Host.compositeFrame 将组图替换回原合成树对应节点，与二维屏障、调整层、嵌套输出按原语义完成整帧；不能把所有组再做一次全局深度排序。最终输出经 request.assertCurrent() 后发布；finally releaseSpatialFrame、releaseAccumulation、releaseWorkingSet，输出 lease 的资源归消费方持有直至 release；finish/finishLayer 转出的纹理借用独立计数，releaseAccumulation/releaseWorkingSet 只退还调度者持有份额，不销毁仍被最终输出借用的资源。A 根 GPU 调度队列串行 await 各操作的提交，不在每个 pass 等全队列空闲；B 内部队列不得反向等待持锁的 A。

orderBySample 用 itemId 排完整绘制项，双空间端转场只有一个 compound itemId，不能用两端 clipId 拆排序；clipIds 仅用于收集来源，itemIds/orderBySample 用于绘制。SpatialDrawItem 的 precision/carriesLight 唯一来自 picture，不另存可能漂移的副本。

**ticket 15 的键与目标**

B 在每次 renderSpatialSample 前重新核对目标的最后完整键，不能把 prepare 阶段的命中判断沿用到已被上一子样本覆写的目标。worldScene 使用精确子时刻键（片段关闭模糊时为实际中心取样键）；space:true 非 three 卡片只使用中心相机/中心源时间键；普通卡片不追加空间作者依赖。每次 clear/覆写/resize/spill/dispose 先失效，成功提交且身份匹配才记录 B 生成的实际键。最后子样本不得冒充中心，A 曝光终图不写回作者目标键。预渲染、导出、观察及含网页/序列输入仍按 15 排除复用。

## 5. 合成顺序、裁剪、景深与曝光

### 5.1 平面真值与接近恒等的连续性

- 真值是**本票改动前 main 在同一输入下输出的编码前原始帧**。在实现前固定 main commit、素材帧、字体、设备/驱动、输出尺寸/质量/颜色/精度，并保存原始 RGBA/half 与请求信息。不能只比较改完代码后的“关闭空间”和“开启空间”，因为两条路径可能一起退化。
- flatIdentity 检查曝光全部采样时刻：有效卡片 depth/rotationX/rotationY/anchorDepth 全为严格 0；相机符合第 4.2 节规范恒等；无景深/可见 worldScene 等空间贡献。保留 x/y/scale/Z 旋转、二维运动模糊等原行为；空间开关本身不会提高精度。
- 命中后直接走原 buildVideoEditCompositePlan、clips/pictures 顺序、shader、采样器、效果顺序、颜色/精度和二维运动模糊。没有三维中间 RT、MSAA、色调映射或额外量化。与 main 原始帧对照的差异像素数、最大通道差均为 0；不同 GPU/解码器/后端不作跨环境逐字节承诺。
- **非零空间量趋近零时，三维分支也必须收敛到同一个二维画面。** 材料面效果参数继续使用二维的逻辑单位、参照画幅、原点、padding 和蒙版映射；只改变承载表面的坐标与最终投影，不把原来的画幅比例改成局部纹理比例，不按预览 divisor 改虚化含义。原全画幅效果需要保留参考画幅映射，不能直接拿素材局部宽高调用。
- 精确恒等帧做零差比较，另检查**恒等前后各 1 帧人眼无跳变**：颜色、透明边缘、模糊、文字密度与相机放大率连续；数值扫查趋近零的一系列非零变换。不能用 epsilon 扩大二维分流区掩盖三维效果单位或采样差异。
- 平面覆盖纯图片、文字/字幕、透明代码、效果链、角点贴合、非中心锚点、非方形像素、嵌套、半分辨率、8/16 位与二维运动模糊。有损预渲染不是真值；three 网格不是真值生成器，平面样片开场网格贡献严格为 0。

### 5.2 三维绘制、转场与采样

1. 沿正式可见性、跟随、防抖、淡化与效果链取得输入；普通卡片保留材料面、逻辑边界及 UV→参考平面的映射。worldScene 由宿主相机直接渲染到屏幕输出，不再当普通卡片二次透视。
2. 材料面保留源方向、非中心轴心、效果扩边与参考画幅；视野外但运镜后可进入的内容不得提前按屏幕裁掉。既有 normalize 的全画幅结果必须带明确坐标映射，不能冒充原素材尺寸。
3. 角点贴合先作用于参考平面，之后完整 clip xyzw 投影和透视正确 UV 插值；近/远裁剪生成可见多边形，不能 clamp(w)。near/far 从场景边界派生，包含全部有效正视深，非法状态返回诊断、不提交 NaN。
4. 沿已有合成树 siblings 列表划连续空间组，按**可见多边形几何中心视深**从远到近稳定排序，同深度用原 ordinal。二维项、已压平调整层是屏障；调整层范围不因 z 改变吸入其他轨道。picture、lease、几何、原序号作为同一 SpatialDrawItem 一起排序。
5. **转场两端都是空间卡时**：两端分别求值并按既有转场生成一个 compound 绘制项，整体参与所在空间组排序；不能把两端拆到其他卡片两侧。该项的中心采用转场进度从两端几何中心插值得到的虚拟几何中心（hold/端点遵从转场进度），边界是两端可见支持域的并集；只剩一端时用该端。这是原子转场的单层深度近似，读回返回两端深度范围及 ambiguousDepth。有一端为二维时维持原屏幕屏障语义。嵌套输出是一张原子卡片。
6. 卡片与 three 场景层之间做中心层序，不做逐像素跨层深度融合；网格内部由 three 深度测试。循环遮挡/相交单层无法精确表示时标记 ambiguousDepth，不声称网格可穿过不同卡片的前后表面。
7. 缩小/斜视采用 mip 链与各向异性过滤，按设备能力选可用级别；源内容变化才重建 mip，格式/光贡献一并计预算。透视正确 UV 与裁剪后的屏幕导数决定采样；卡片外沿使用覆盖率抗锯齿/空间目标 MSAA，透明内容边缘保持预乘 alpha，避免黑边。恒等路径维持原采样，无额外 MSAA。
8. 推近文字、图形、Canvas/网页时，以可见区域最大投影密度（含倾斜局部 Jacobian）请求现有栅格倍率档位，不能只取中心 scale。倍率升档重新栅格，尺寸/倍率进入内容键；视频只能按源分辨率采样，不能伪称补出了细节。网页倍率沿 ticket 14，几何沿 18 同帧 DTO。

### 5.3 中心时刻材料面景深

- 首期为单层中心深度近似：按可见几何中心视深算 CoC，非锚点。斜卡/厚网格读回 viewDepthRange、cocRange、approximation='layer-center'；不承诺逐像素物理景深。
- 统一薄透镜公式：f、s（层距离）、sf（焦点距离）、sensorWidth 先换毫米，N=fStop，CoC 直径 c=abs(f²(s−sf)/(N·s·(sf−f)))，半径 r=0.5·c/sensorWidth×实际输出显示宽，再乘 defocus 的连续强度。1 世界单位=1000mm；s≤near 或 sf≤f 报无效光学状态，不用夹分母伪造结果。
- **所有路径每帧仅在中心求焦点/CoC。普通卡片在中心材料面做一次景深；稳定层序 worldScene 先逐样本累积成层材料面再做一次中心景深；动态 worldScene 在快门内换序且开启景深时，对每个场景子样本做局部、降采样景深，再按当时层序合成累积，CoC 始终复用中心值。** 复用 planAuthorDefocus 镜头模式、padding、高精度、预乘 alpha/carriesLight。以中心投影将屏幕 CoC 换算为材料面采样尺度；贴图、滤波参照与第 5.1 节一致，不能先烘成全屏再误当局部平面。
- 按可见支持域包围框加 CoC padding 建工作目标；大弥散圆使用已有 blur 降采样/重建计划，不为每层每样本开全画幅大 RT。降采样是效果内部计划，逻辑模糊半径不变；记录实际工作像素与峰值字节。零 alpha 发光支持域不能被普通 alpha 包围框裁掉。
- 可感知阈值以下旁路，r→0 连续。阈值以最终输出像素定义，通过小半径夹具确定；阈值连接段沿共享效果计划让贡献连续归零，不在阈值处突然切一幅不同锐度的图，不把该阈值用作相机恒等 epsilon。参数与阈值不新增用户设置。ticket 12 合并后由 16-A 串行修改 planAuthorDefocus/videoEditBuiltinEffectPasses 的平滑归零与材料面 CoC 尺度换算，B/C 只消费计划，不另写阈值或 blur 实现。
- worldScene 的场景层景深仍是中心深度近似，不接 three TSL dof，也不同时开宿主与 three 两套景深。稳定层序时先把本场景的内部变换子样本累积成一个材料面，再按中心 CoC 执行一次景深，作为该层曝光输出参与稳定层序合成；不对每个网格材质各开一个屏幕景深来假冒单层景深。动态 worldScene 的换序联合情况按第 12.1 节已定例外执行：每个子样本局部/降采样景深，不冻结模拟、不关闭模糊，不先混层再统一虚化。非换序场景仍为逐样本渲染、逐层累积后一次景深。

### 5.4 曝光与两类运动模糊

- 复用现有 180° 快门、播放最多 8/最终最多 16 样本；用投影角点/包围盒运动估计，含相机和中间往返，不仅看首尾。静止组单样本，hold/切点分段截断并重归一权重，不混合两个镜头。
- 普通卡片的材料面纹理、媒体时间、效果与景深冻结在中心时刻，曝光主要采片段/相机变换；普通视频不因 N 个样本解码 N 次，网页不重演 N 次；声明 space:true 的非 three 卡片也只在中心注入相机/时间并生成一次，曝光不逐样本重渲它，作者内容键只用中心时刻。three 内部对象变换与模拟姿态按源子时刻求值，场景光栅化由 B 逐样本提供，其他不随运动的准备复用。
- **保留卡片内部作者 pose 模糊**（逐字、图形层等），只替换片段外层二维变换模糊。中心材料面先得到原有内部 pose 曝光，空间曝光再处理卡片/相机变换；不能关闭所有作者位姿模糊，也不能把同一个片段变换采两次。createThree 的内部姿态由其场景子样本负责，不再对同一个网格动作叠加另一份内部采样。
- 稳定层序组复用现有逐层变换曝光语义；只有快门内层序变化才进入 group 模式，执行“子时刻场景 → 子时刻整组混合 → 权重累计”。这保留已批准的首期性能/遮挡边界；不宣称稳定层序半透明交叠等同无限精度光学积分。
- clip.motionBlur=false 在所有样本冻结该片段的自身变换、相机采样与场景姿态于中心；序列 motionBlur=false 单样本。混合开关下仍按各样本的有效几何求层序，不能让关闭模糊的层偷用邻层时间。
- A 的曝光计划是唯一采样真相，B/C 不另猜子时刻；流式工作集、完成/取消、目标复用和子时刻内容键按第 4.6 节。

## 6. 受管 three 场景、单一后端契约与宿主时钟

### 6.1 作者入口与依赖声明

新增 createThree(host) → { scene, update, dispose? }，它与 draw/layers/createWebGL/createWebGPU 这些**绘制入口**互斥，**可与 createSimulation 同用**。scene 是标准 THREE.Scene，update(params, assets, info) 设置场景对象；模拟只经 info.simulation.at(sourceTime) 读已准备视图。作者不拥有渲染器、不调用 render/setAnimationLoop，不自己另开 RAF 或累计物理 delta。

- host 暴露同一冻结作者库创建的 camera、逻辑尺寸和受管环境。update 前同步 camera，draw 前复核/重设相机；作者读取不会改变作品真相。场景根应用片段变换一次，输出 worldScene，由 A 直接混合。
- **显式空间依赖**：createThree 隐含 space=true；其他新 API 绘制入口只有模块声明 `space: true` 才获得 info.space。未声明时不注入该字段、不把相机加入作者内容键，旧 API 行为不变。类型环境区分声明了空间依赖的 AuthorFrameInfo，不能以 API 版本新就默认所有模块使用相机，也不能通过运行时是否访问属性猜依赖。
- info.space 含相机参数、中心/当前样本时刻与只读 project(point)；显式依赖必须进入实际输出键、逐帧指纹及窗口保守依赖。frameKey 常量不能覆盖相机、场景根或子时刻依赖。createThree 输出类型由工厂决定，不从 info.space 的读取行为推测。非 three 的 space:true 卡片只在中心生成，info.space 的 sampleTime 与 sample camera 都取中心，内容键亦只用中心；只有 worldScene 执行曝光子样本 update/render。
- 10 使用 API 8；16/17/18 共用尚未发布的 API 9，一处版本常量，声明读取、类型、编译器、运行时和持久最大版本同步。旧作品不自动升级 API，不改库 pin。

### 6.2 单一渲染器与模块身份

正式 createThree 的 G/W **都用 three.WebGPURenderer**。G 指 forceWebGL:true 的 WebGL2 后端加 OffscreenCanvas 拷贝；W 指共享 GPUDevice 的 WebGPU 后端。禁止拿 WebGLRenderer 的可工作样例当作 createThree 的基线，导致两条路径使用不同材质语言。

作者使用节点材质/TSL 或 WebGPURenderer 支持的标准材质；GLSL ShaderMaterial/RawShaderMaterial 在 createThree 的类型检查与发布校验阶段明确报错。普通既有 createWebGL 的 GLSL 作品仍按旧 API 运行，本限制不扩散到它。作者 Scene 本身类型较宽，不能只靠 scene: THREE.Scene 的签名假设已排除不支持材质；B 负责提供该入口的类型诊断，初始化/更新后的场景材质校验兜底动态 JS 内容并点名材质。

宿主创建 renderer/camera 时与作者 import map **使用完全相同的挂载 URL**，从现有 authorLibraries/库 pin 解析器取得 three、three/webgpu、three/tsl 及共享 core 的 URL；不另写地址表，不把 henji-author-three 或应用镜头参考的 three 0.169 打进渲染适配器。Core 数学模块是明确允许的例外，只按第 4.4 节懒加载数学类，只跨边界传数值，不跨实例 instanceof；宿主场景的 instanceof/材质转换始终属于作者同一 ESM 实例。验收比较模块构造器身份和实际加载模块，不能只比较版本字符串。

### 6.3 r186 内部时钟控制

B 唯一的 videoEditAuthorThreeClock.ts 封装锁定 **0.186.1 / r186** 的内部访问；其余代码不得散写 _animation/_nodes。本地源码显示 init 会启动 _animation，setAnimationLoop(null) 只清用户回调，不会停止内部 RAF。

1. 初始化完成后调用受控适配器停止 renderer._animation；预热、重建、后端重建后再次确保停止。空闲不得持续更新 NodeFrame，也不全局替换 Worker 的 performance.now。
2. 每次 compile/render 前，宿主设置 renderer._nodes.nodeFrame.time 为本次作者 sourceSeconds，deltaTime 固定为 0（非累积时间差），并推进仅供节点更新去重的 frameId；renderer.info.frame 与它一致。frameId 不是作者动画时钟，不可决定画面。动画/TSL time 用绝对时间；AnimationMixer 用 setTime。
3. r186 内部 compute/render 路径可能调用 nodeFrame.update()；适配器在受管调用范围把该更新收口为同一宿主样本时间及更新令牌，不能让它再读墙钟覆盖 time/deltaTime。预热也给明确固定样本时间。renderId 仍尊重 three 的嵌套 pass 约定，不混用作者时间和调用计数。
4. 升级库前必须验证字段存在及语义；不支持版本明确失败，不静默退回墙钟。回归覆盖 TSL time、NodeUpdateType.FRAME/RENDER、compute、compileAsync、0→37→12→37、重复时刻、等待后重复、尺寸/设备重建及预览/导出一致；只测自写 update 不足以证明 three 时钟受控。

three 场景与材质/几何长期复用，释放只处理本实例资源。禁止 TAA/跨帧累积对随机取帧产生历史依赖；模拟累积统一由 17 的确定性 session 管理。

### 6.4 G/W 原型与 ExternalTexture

| 路线 | 实施边界 |
| --- | --- |
| G：WebGL2 画布拷贝基线 | 同一 WebGPURenderer 设置 forceWebGL:true，使用标准/节点材质；每个场景样本由现有 copyExternalImageToTexture 导入合成 GPU。它是 GPU 画布拷贝，不是 CPU readback |
| W：共享 device、公开 ExternalTexture | WebGPURenderer 使用宿主 device。先验证公开 ExternalTexture(GPUTexture) 的接入与宿主目标/中间 RT 的公开组合：同 device 输入/输出、颜色转换、resolve、格式、重绑、释放均需真实探针。若无法公开直写目标，则用同设备 RT 与显式 GPU 拷贝；记录实际拷贝数，不称零拷贝 |
| Z：XR 私有接口 | 首期不做，不用 setXRRenderTargetTextures 作为备用实现，也不列入 P2 候选 |

ExternalTexture 的公开构造器和本地 r186 接入/外部纹理不销毁分支已只读核对；这只证明 API 存在，不证明把它装到 render target 后完整写入/颜色转换一定可行。本轮没有 GPU 实测，W 的采用必须过 P2/P3；失败保留符合契约的 G 或公开 W 中间 RT 路径，不能暗接 Z。

- three 初始化/compileAsync/预热与宿主合成使用**同一根 GPU 调度串行队列**；包括未来物体/材质预热，禁止一边合成一边改共享 device 状态。B 的实例串行队列遵守 A 根调度顺序，不相互持锁等待。首次显现的额外编译耗时须低于目标帧预算，否则继续修预热。
- G/W 使用相同场景、材质、镜头、时间序列和颜色契约。图文卡片不做 tone mapping；网格按已批准 Neutral 起点，由宿主统一输出为合成器预乘 SDR Rec.709 gamma 2.4，linear/sRGB/Rec.709 需实际转换。8 位 G 不能保留超白时明确列为能力差异，发光/高精度样本须验证合格路径，不能降质伪称等价。
- 宿主拥有 device、队列和目标；three 仅拥有自身 RT/材质/几何。外部纹理包装释放不得销毁借入纹理；usage、format、sampleCount、depth、viewport 与 resolve 匹配，尺寸/精度变化重绑目标。设备错误回调由根 owner 统一转发，init 不得覆盖其他 owner 的日志/处理器。
- 相同队列用既有 completion/lease 管理，不逐帧 await 全队列。three 的深度、MSAA、后期 RT 均进预算；4K RGBA8 约 31.6MiB，RGBA16F 约 63.3MiB，工作集按样本复用。取消/设备丢失废弃旧请求输出，不返旧纹理假装成功。
- G 达成同质量成片/性能门槛即可交付；W 仅在全部正确性门槛通过且实测有收益时采用。后端选择是宿主决定，无新增用户设置。

## 7. 内容键与 15/17/18 等并行票接缝

### 7.1 内容依赖与旧指纹

1. 无空间数据、无显式空间声明的文档，片段、序列、窗口及渲染内容指纹的序列化字节**逐字节保持不变**；不能无条件追加 undefined/null、空对象、默认相机、空间版本标签或新 tuple 槽位。A/B 对改前 main 的同输入指纹作精确对照，不用更新快照消除差异。构建自动派生的引擎版本变化按现有机制处理，不混称内容指纹变化。
2. 普通二维代码即使升级到 API 9，也不自动读取 info.space。卡片外部位置/相机只影响投影；作者源内容仅在原依赖、实际栅格密度等变化时重画。只有 createThree 或 `space: true` 的模块注入空间上下文。B 生成作者内容键：worldScene 追加实际子时刻相机/投影、场景根、焦点/光圈、精确序列及源时间、尺寸/质量；space:true 非 three 卡片追加这些依赖的**中心时刻**值，中心生成后冻结材料面，不逐样本重渲。
3. 空间片段最终合成键包括空间变换和材料面效果；显式空间作者的**作者输出键**还包含空间依赖。两种键不能混淆：普通代码在不同子时刻仅重投影时可以复用相同材料面，不能为复用而漏掉 worldScene 的子时刻键。
4. 15 只保留实际工作目标的最后完整键，不增加 LRU、RAM、跨 Worker 额度、额外设备代次键。键含完整源码/库身份（含 dataFiles）、参数、frameKey 或时间、尺寸、精度；16 空间摘要与 17 simulationEpoch 按声明追加。覆写/clear/spill/resize/dispose 先清键；成功提交后记录本次实际内容。
5. 预览以外及网页/序列输入的排除沿 15；观察正式渲染一次并返回对应结构事实，不复用旧观察快照。曝光终图和作者最后子样本是不同目标/身份。

### 7.2 最终执行顺序与集成矩阵

| 阶段 | 必须完成的前置 / 执行动作 | 执行方与产出 |
| --- | --- | --- |
| 0 | **先合并 20、12、15、17、18、10、21、19-U12/U13**（均在进行中）；集合内部按各票已有依赖串行合入，不要求其余 19 子项先做完 | Claude/各票 owner；完整前置 main，安装与共享生成命令串行 |
| 1 | 阶段 0 全部合入后，16-A 从最新 main 开工并负责吸收，先交 4.5/4.6 可编译接口提交和坐标/曲线夹具 | A；冻结提交及分支明确交给 B/C |
| 2 | B、C 各从 A 冻结接口提交所在分支建立叠加分支；A 继续合成/传播，B 作者运行时，C 算法/读回及二维运动保留 | A/B/C 按 3.1 并行，禁止 B/C 从旧 main 猜接口 |
| 3 | A 合入 main；B/C 各自 rebase 到 main，保留本线增量，串行解决共享依赖与生成产物 | A 负责主线吸收，B/C 各自负责本线 rebase 和受影响验证 |
| 4 | B 完成合入后才启动/合入 **19-U9/U15a** 的受管 three 配方与相关增量；C 按自身依赖完成 | B/19 owner；不并发改 B 的作者入口或让 19 抢先写另一套场景桥 |
| 5 | A/B/C 与所需接缝集成完成，共用正式产物验 P1–P5、同源公共调用与代码审查 | Claude 串行构建、样片目视和最终验收；不再设计送审 |

下表规定接口消费和文件交接，不改变上表前置集合。

| 票 | 先后顺序、冻结输入/输出和唯一责任 |
| --- | --- |
| [20 遗留清理](../20-遗留清理/plan.md) | 在 16-A 之前合入；A 吸收删改后的入口和实际目录，禁止恢复已退役实现 |
| [21 组件库静止复用](../21-组件库静止复用/plan.md) | 在 16-A 之前合入；B 扩作者指纹/入口时保留组件静止判定和复用语义，空间依赖不被静止声明覆盖 |
| [19 效果库第二批](../19-效果库第二批/plan.md) | **U12/U13 在 16-A 前合入，U9/U15a 在 16-B 后**。U12 的立方体/翻转/开门是二维着色器转场，在原二维转场内生成像素；16 的空间复合转场是把两张空间卡作为一个排序绘制项，是不同概念。前者可作为后者内部的转场效果，不能代替空间几何/深度排序，不另注册同名三维转场 |
| [10 文字排版](../10-文字排版/design.md) | 先合 API 8/冻结库与字体入口。16 B 在其后扩 author-api/Module/Runtime，A 传最大投影栅格倍率；字体生命周期与库构建仍归 10，不再造排版器 |
| [11 效果合并](../11-效果合并/plan.md)、[12 新效果](../12-新效果/plan.md) | 先获得合并后的共享 blur/色调/发光计划；16 A 消费材料面单位、padding、precision/carriesLight，不能写死旧 lens_blur ID 或重写效果核。12 合并后，由 16-A 串行改 planAuthorDefocus/videoEditBuiltinEffectPasses 的 CoC 尺度与阈值平滑归零；保留 12 的效果契约，不由 B/C 或效果 owner 并发修改 |
| [13 风格件](../13-风格件与技能三档/plan.md) | 16 A 接空间片段属性模板 pick/strip；模板不携带序列相机、不新建嵌套。C 合配方；全局格式由 A/Claude 串行登记，SKILL.md 不并发覆盖 |
| [14 网页时间缓存](../14-网页页面时间缓存/design.md) | A 仅提供实际需求栅格密度；页面时钟、GOP/解码、coverage、取消仍归 14。18 的实时几何先行，其缓存元数据按 14 DTO 定稿后接；16 不改服务/端口，不为曝光重复网页 seek |
| [15 代码输出缓存裁定](../15-代码片段输出缓存/review.md) | 先合“上次内容键”，再由 B 改 CodeSources/CodeGpu。A 调 B 的逐样本接口；实际目标内容写入和失效由 B 完成，A 消费 lease 并负责曝光终图。容量、spill、保护键遵从第 4.6 节，不能把中心准备键当 N 个子样本的身份 |
| [17 模拟运行时](../17-模拟运行时/design.md) | **先合 17，再由 16-A 吸收 main；B/C 从 A 冻结提交叠加**。createSimulation 是数据状态工厂，可与 createThree 同用。A 给完整精确源时间包络，B 调 17 的 prepare(range,input,signal) 一次；渲染前已可用，update/pose 经 info.simulation.at(t) 只读采样，不 step/restore，不用序列秒。共享 simulationEpoch/取消/实例队列，不自建模拟或快照；倒放只逆序取样，物理仍正向准备。曝光新增的探测/正式子时刻必须都落在准备范围 |
| [18 网页文本几何](../18-网页文本几何/design.md) | **先合 18，再由 16-A 吸收 main；B/C 从 A 冻结提交叠加**。消费 webText 静态声明与 info.web[param].text，不改其 DTO/采样器。纹理、text、viewportToImage、region、有效尺寸来自同一页面时间/票据；CSS 坐标先映射作者材料面，再由 A 做片段空间投影，DPR 不重复相乘。默认曝光冻结中心网页画面和几何，不能用子时刻相机配错时刻文字；有网页输入仍不启用 15 输出复用 |

共享热点 AuthorModule、Runtime、Programs、TypeEnvironment、CodeSources、CodeGpu、作者指纹和 author-api.d.ts 在 17/18 完成后由 B 唯一接手 16 的增量；Renderer/Compositor/预算归 A；通用属性与配方归 C。A 记录前置集合合入后的 main 基线与冻结接口提交，B/C 以该提交叠加并记录 API 9 支持状态，不能通过覆盖文件丢掉 simulation/webText。

## 8. AI 属性、两项写算法与结构化读回

### 8.1 同源通用属性与持久取景意图

本票是能力增量，无人工界面新增。通过 ApplicationFieldDefinition 一次登记片段 spatial.enabled、depth、rotationX、rotationY、anchorDepth 与既有关键帧字段；对外可用 snake_case 名称，由该唯一字段映射到第 4 节存储，不误存到 spatial.depth。序列摄像机挂 video_edit.sequence；读/改/增删走通用实体，不新增“设置深度”“设置相机”工具。

公开语义使用“靠近/远离画面平面”“向左/右转”“向上/下倾斜”“对焦对象”“主体占画面高度比例”“透视程度”“背景虚化”。camera.framing 的写入意图包含 targetRef、heightFraction、perspective，正式转换服务将目标/占高写入 framing、透视量写入相机同一 perspective 字段及曲线；**持久化意图，不把它丢掉后只保存一次解出的 position/focalLength**。按每帧目标动画和画幅重新求值，读回意图及派生机位/光学指标。原始光学精确写入也是该转换服务的输入，不另立光学状态。

相机和片段变更同一通用事务、同一撤销栈；传播委托 A。声明、字段读取、写入表、账本由唯一字段表派生，Pi/MCP 同源。不新增设置面板、审批、路径权限；外来代码在读声明、预热或试渲染之前沿已有信任确认，自创代码正常运行。

### 8.2 arrange_video_edit_depth：拉开景深层次

- 输入：documentRef、sequenceRef、按远→近排列的 clipRefs、referenceFrame、**parallaxRatio（最近层/最远层视差比，≥1）**、focusRef，可选过渡 range。ratio=1 表示同深度；不再以 depthSpan 这种内部世界距离让助手猜视觉强度。无显式顺序使用既有稳定层序，不额外调用模型猜主体。
- 视差定义为同一微小横向机位移动造成的屏幕位移系数 k=F/s，s 为中心视深；因此 parallaxRatio=kNear/kFar=sFar/sNear。围绕焦点/参考层的正视深 sRef 在 log(s) 空间均匀分配层位：令有序层位 u∈[0,1]，参考层为 uRef，s(u)=sRef×ratio^(uRef−u)。这样最近/最远比恰为 ratio，焦点层保持 sRef；单卡不制造层次。实际近裁剪不可行时返回可行几何与输入事实，不静默夹小 ratio。
- 参考帧先读取各卡片投影位置/大小。正对相机时旧倍率 k0=F0/s0，新倍率 k1=F1/s1，局部缩放及相对光轴位置乘 k0/k1，保持参考构图。倾斜/角点贴合用 three 反投影与确定性小规模求解保持投影质心和可见包围框，不保证所有透视角点完全不变；返回实际残差与遮挡变化。
- 只写指定范围内的普通数值和 clip.curves，保留范围外原值、边界切线及手工关键帧语义。原动作经同一求值器拟合/烘焙，最终像素最大角点误差目标≤0.25px；写不进既有值域或误差超标时返回事实，不先落半套 patch。重计算经既有运动 Worker 可取消，无卡片数硬上限。
- 返回 changedRefs、实际 achievedParallaxRatio、层中心/范围、投影误差、遮挡/裁剪事实、保存状态和 undoRef。几何不等于透明像素可见性。

### 8.3 transition_video_edit_space：展开 / 压平

- 输入：documentRef、sequenceRef、clipRefs、非空序列帧 range、mode=expand|flatten、focusRef，以及展开的 parallaxRatio、perspective（目标透视量，0 为默认取景）。强度统一用上节视差比，不并存另一个没有定义的 strength。只影响返回中列明的片段/相机字段。
- 展开从当前参考构图起步，空间四值为 0、相机偏移/透视量/defocus 为 0；调用上节算法解目标层深。“展开空间”的镜头透视变化就是相机 perspective 曲线，移动机位并同步导出焦距；不能只改 FOV 造成全平面缩放。使用现有 ease/Bezier 连续展开，持久 camera.framing 绑定焦点主体和占高曲线、perspective 曲线，逐时刻求机位以保持主体取景，其他层产生真实视差。
- 压平回到 depth/rotationX/rotationY/anchorDepth 严格 0，镜头偏移/透视量/defocus 严格 0。若此前有 framing/aim/focus 绑定，在尾点以等价默认点/距离完成规范化并解除非默认绑定，保证真正命中恒等；不能只清 offset 却留下 framing。空间绑定的离散切换用 hold，切换前后派生画面连续；保留尾帧主体中心与大小，其他卡片连续归位。
- 曲线是普通持久关键帧，不是另一套相机动画 DSL；拟合在输出帧与曝光子时刻验证，规范零值端点不能被简化掉。任意相交场景压平不保证全程所有轮廓/遮挡不变，结果明确标出首期近似。
- 算法不遍历改写任意 JS 场景对象；three 几何/灯光由作者源码根据同一时间更新。样片从第一帧预建物体，通过透明权重/姿态连续显现，不替换整块画面。
- 两项算法均先纯计算与校验完整 SpatialPatch，再经 editVideoProject/原子文档算法守卫一次提交。提交前核对 revision、完整目标和传播计划；撤销恢复整批片段/相机/引用。保存失败按既有 participant 保留真实脏状态，只重试落盘，不重复施加变换。

### 8.4 verify_video_edit_space：只读空间算法

输入 documentRef、sequenceRef、frames、可选 clipRefs；结果绑定精确时刻和内容身份，沿现有分页机制，无人为数量上限。它分析投影/裁剪/遮挡，不是复制某个字段读取工具。

- camera：持久取景意图、resolvedAim/resolvedFocus、目标活动状态、派生机位/焦距/对焦距离、near/far、flatIdentity；零值判定来源明确。
- cards：完整稳定引用、原四角、裁剪后多边形、几何质心、中心/范围视深、归一化 bounds、入画比例、drawOrder、compoundGroup、CoC/范围、behindCamera/clipped、景深近似类型。锚点单独返回，不当几何中心。
- occlusion：按真实绘制顺序做多边形交/并/差，候选遮挡者和覆盖区域可读。polygon-clipping 已获批准，Claude 安装后 C 使用其 MultiPolygon 结果；不自研布尔几何。仅已知完整不透明表面可证明几何完全遮挡；视频 alpha、文字空白、蒙版、半透明和作者场景为 unknown/estimated，不用 AABB 冒充像素不可见。
- focus：目标存在/活动状态、中心视深、CoC 与“焦点是否落在所选片段”的数值结论。three 返回正式渲染观测的包围盒/层深时注明来源；纯结构查询不执行源码，缺场景几何则如实 unknown。
- 视觉证据沿 observe_video_edit_frame → read_application_media(mode=image)，核对同一作品/帧；只做结构读回不能标视觉通过。节目预览、离屏取帧、导出和嵌套共用 A 求值器，不能各算相机/焦点。

C 更新配方为“风格件→内置效果→宿主空间能力→标准 three 内容”；不继续教作者手写伪透视、宿主已有布局或景深核。

## 9. 原型样片与验收顺序

### 9.1 连续样片

采用已批准的原型标定，8 秒、1920×1080、30fps，自有 6 张文字/图片卡和一个 three 物体，再扩展到 20/30 张与 4K。隔离作品/运行产物，不读写 D:/视频制作，不接 9334。Claude 按用户画面口味目视验收，无需用户看片。

- 0–1.5 秒：原二维排版，空间值/相机偏移与透视量/defocus 全 0，无有效绑定；网格已预建/预热、透明贡献为 0。保留改动前 main 的同输入原始帧作真值。
- 1.5–4.5 秒：真实时间线卡片连续展开，持久 framing 保持主体占高，透视量和镜头偏移形成推拉/横移，产生视差和遮挡；网格连续显现、侧转和光照过渡，无剪切、黑帧、突然替换。
- 4.5–6.5 秒：运镜并拉焦至前景，CoC 交换。厚场景标明中心深度近似；必须包含动态 worldScene 与其他层在快门内换序、同时开启景深的联合片段，按 12.1 逐样本局部景深，8/16 样本均验，不冻结模拟或关闭模糊。
- 6.5–8 秒：连续压平，尾点四个空间值与全部有效相机偏移/透视量/defocus 严格归零、绑定规范化，回到原二维路径。恒等帧零差；进入/离开恒等前后各 1 帧由 Claude 目视无跳变。

G 草样也必须使用 WebGPURenderer(forceWebGL:true)，与 W 同一材质/时钟契约；草样不证明正式卡片、共享相机、保存或能力已完成。正式样片必须经公共算法写入、createThree、结构读回和正式取帧验一次。

### 9.2 一次一个短实验

单次原型目标≤180秒，超过一分钟后台运行；正式性能用生产产物，正确性可先用隔离调试产物。本次只写文档，以下均为未来实施验收，除注明历史资料外没有新测量结果。

| 实验 | 数据与通过条件 |
| --- | --- |
| P0 数学与时钟 | 前版设计记录过 1000 组点/16:9/80mm 的 CPU 代数误差约 1.11e−16（平面）和 1.80e−16（补偿）；本次未复跑，不能替代新偏移/取景模型验证。实施补偏移零值、PAR/画幅变化、framing、AE 旋转、lookAt 回退、质心/锚点区分、three nodeFrame 受控夹具 |
| P1 改前 main 真值 | 固定 main commit 和同输入原始帧；无空间、恒等两种结果与真值差异像素数/最大通道差皆 0；无空间内容指纹序列化字节不变；另验恒等前后各 1 帧及非零趋零连续性 |
| P2 G/W 渲染桥 | G/W 各测 1080p/4K，**1、8、16 样本**，预热后 120 输出帧；分稳定层序与快门换序、单/多 three 场景、景深开/关。报 CPU 提交、可用时的 GPU timestamp、请求到完成 p50/p95/max、拷贝次数、普通卡片/稳定 worldScene/动态换序 worldScene 各自的景深执行次数、目标容量/峰值字节、冷编译/稳态；读回不计入 GPU 核计时。W 先过 ExternalTexture 公开组合的写入/颜色/释放探针，Z 不测 |
| P3 确定性/生命周期 | 固定前序请求，0→37→12→37、重复 t、实际等待后重复、compileAsync 前后、resize/精度切换、设备重建、取消迟到；同一路径同请求逐字节一致。TSL time/compute、模拟 at 子时刻、17 epoch、18 图像与文本同票据都覆盖；不能只测场景手写 update |
| P4 空间/传播 | 20 卡常规/30 卡压力，背面镜像、近裁剪、斜视、非中心轴心、同深度、子帧换序、透明文字内部 pose 模糊、双空间端转场、调整层、嵌套、改尺寸/PAR/重构图、目标分割/删除/复制、模板目标相机；写入→读回→取帧→撤销→保存重开一致 |
| P5 整帧性能 | 1080p60 连续预览无可归因本票的持续跳帧，整帧 p95≤16.7ms；4K 桥接阶段目标 p95≤8ms、20 卡空间阶段≤10ms，整帧目标仍≤16.7ms。8/16 样本与峰值内存单列；不关闭景深/模糊、漏算 three 内部 RT 或只报分项冒称同质量实时 |

P2 的计数按每个输出帧、每个可见源单列；下表为开启景深且未阈值旁路的执行次数，单位是一次效果计划执行，内部 GPU pass 数另报：

| 路径 | N=8：场景渲染 / 景深 | N=16：场景渲染 / 景深 | 次序 |
| --- | --- | --- | --- |
| 普通卡片（含 space:true 非 three） | 0 / 1 | 0 / 1 | 中心作者材料面生成一次（内部 pose 按原逻辑）→ 景深 → 各子时刻投影 |
| transform worldScene | 8 / 1 | 16 / 1 | B 逐样本渲染 → A 层累积 → 一次景深 → 稳定层序混合 |
| group 动态 worldScene + 换序 | 8 / 8 | 16 / 16 | B 子样本渲染 → A 局部降采样景深 → 子时刻组混合 → 累积 |

single 的 worldScene 为 1/1；关闭景深或旁路为 0 次景深。无变化的场景复用、源场景数量、实际有效样本数必须另列，不能把复用样本当成本例外 8/16 样本的测量结果。

每条证据记录 commit、Electron/Chromium、three pin、GPU/驱动、尺寸/质量、样本数、冷/热、缓存与其他 GPU 活动。G 满足门槛可先交付；W 只在正确性/资源门槛全过且稳定有收益时采用。没有 GPU timestamp 时不把全队列等待叫作某个 pass 的 GPU 耗时。

## 10. 最低可读版本、格式与传播清单

### 10.1 必须提高最低可读版本

调查基线 video-edit 内容版本 46、最低可读 45、code-author-api 7、code-version 8；10/17/18 等合并后数字会变。A 在最终 main 上逐个登记新版本，不预占固定 47；作者 API 按已批准 API 9 共用规则。

**本票空间数据自身也提高最低可读版本到首个完整理解本票语义的 reader。** 原因不是字段是否可选，而是旧程序忽略空间键后会错误修剪、分割丢属性、相机目标悬空；静默保存会破坏作品。不能只因 createThree 提升 API 门槛，却允许旧程序打开纯空间卡片工程。以登记格式为单位设置 minReaderVersion，不私设只检查某个空间字段的文件旁路。

| 直接/内嵌格式 | 必须核对的传播 |
| --- | --- |
| video-edit 内容/文档 | 片段四键与曲线、spatial.enabled、序列相机、语义绑定；content version 与 minReaderVersion 同步登记，外壳按实际 schema 变化传播 |
| screen-recording | 内嵌剪辑 schema/空间语义支持下限跟随，不只升独立 .hjvid |
| code-author-api / code-version / code-asset | API 9 的 createThree、space 声明及 17/18 增量均可读可执行，版本记录/可编辑代码资产/样片传播其最大 API 与最低 reader |
| creative-intent-candidate | core/creativeIntent/persistence.ts 的 storedMotionCandidateSchema.motions[].curves 直接嵌入 videoEditClipCurvesSchema；A 升版本/最低 reader、逐版本迁移与候选黄金样本，C 的二维编译/应用不得消除已有空间键 |
| title-templates | styleTemplateMigration.ts → titleTemplateMigrationSchema.content → videoEditNativeTemplateContentSchema.clips，间接嵌入模板片段；即使仅作旧库读取也受 schema 变更影响，由 A 登记版本/最低 reader 与迁移，保留旧库原件和旧夹具 |
| video-preset-package | presetPackage.ts → items[category=title].preset → titleTemplateMigrationSchema.content.clips，间接嵌入；A 同步格式版本/最低 reader、包读取迁移与往返，不能以新导出不含 title 为由漏掉旧包入口 |
| style-kits | 已核对 styleKitMigrationSchema：仅 guide/examples 源码，不嵌入模板片段或 clip.curves，本票四键不触发其版本升级；保留旧库导入到新风格的既有路径。它与 title-templates 不能合并判定 |
| native template / style / style package / code samples | 模板只带空间片段字段与 clip.curves，不带相机；其 pick/strip、嵌套片段与作者 API 固定字段更新，直接嵌入 schema 的父格式一起登记 |
| 单文档包/整项目包 | 包内作品保持正确内容版本/最低 reader；外壳只有自身结构或解释改变时升级，不为凑齐清单无条件改号 |

A 的落点：[schemaVersions.ts](../../src/core/persistence/schemaVersions.ts)、[documents/kinds/videoEdit.ts](../../src/core/documents/kinds/videoEdit.ts)、[codeMaterialPersistence.ts](../../src/core/videoEdit/codeMaterialPersistence.ts)、[codeAsset.ts](../../src/core/videoEdit/codeAsset.ts)、[documents/kinds/screenRecording.ts](../../src/core/documents/kinds/screenRecording.ts)、[formats.ts](../../src/core/persistence/formats.ts)、[formatMigrations.ts](../../src/core/persistence/formatMigrations.ts)，以及 core/creativeIntent/{persistence,referenceTransforms}.ts、core/persistence/{resourceContracts,versionedJson}.ts、core/videoEdit/{presetPackage,codeMaterialVersions}.ts、styles/{templateSchemas,nativeTemplates,styleTemplateMigration}.ts 的上述嵌入链。referenceTransforms 的采样页目标快照也引用 clip.curves，A 沿 creative-intent-page 登记与样本核对同源变更，不能只改候选外壳。schemaBaseline.json、releasedCompatibility.json、tests/fixtures/persistence 由 A 统筹串行生成，不能改已发布样本摘要。

各 N→N+1 迁移是纯函数，保留旧作品字段、曲线、源码和库 pin；不插入默认相机或 spatial.enabled，不批量写零值以污染旧指纹。旧版可读性继续保证；提高最低 reader 是阻止旧程序误解新文件，不是抛弃旧文件。读取只内存升级，沿既有备份边界保护原件，明确保存才写回。

### 10.2 A 负责的完整传播清单

所有操作先对原快照规划片段/相机/绑定变更，再同一事务提交与撤销；C 的公共字段执行器只调用 A 的传播服务。通用 keyframe slice/scale 是唯一曲线时钟变换，不能手写平行空间曲线处理。

| 操作 | 片段动画/相机/引用的确定语义与落点 |
| --- | --- |
| 关键帧派生/求值/读写 | keyframes.ts 四键枚举、schema、默认值、禁用 motion、值域；keyframeLanes.ts 派生轨道；document.ts 片段默认/解析；C 的字段表消费同一元数据。旋转曲线不因超过一圈被模运算抹掉；缺失空间键回 0，不回 0.5 |
| 左右修剪、滑动/滑移、分割 | timelineEdits/keyframes 用现有 sliceVideoEditClipKeyframes/sliceVideoEditCurves 保留边界值、Bezier/easeRange，片段内时间随新入点平移；四键一同传播。相机是序列时钟，不因切一个片段整体平移；若相机目标被分割，引用按时间段重定向到对应子片段，局部坐标保持，切点 hold，不留下只指向左半段的假身份 |
| 改速、倒放、静帧、时间重映射 | videoEditClipSpeed 与通用时间映射负责源时间；片段持续时间伸缩时四键按既有 scale keyframes 规则处理，滑移仅改变源时钟则不移动片段变换曲线；序列相机时钟不随单片段变速。绑定跟随目标当时几何，simulation.at 接正式映射后的源秒 |
| 移动片段/波纹编辑 | 保持片段内曲线；序列时间 ripple 时，相机及取景/焦点曲线用与其余序列事件相同时间映射平移/切分，边界与 hold 保留。单纯移动一个片段不移动全局相机曲线，目标绑定仍跟随同一身份 |
| 序列改帧率 | 保持实际秒语义，片段时长/片段内关键帧与序列相机/绑定曲线统一做帧率有理数变换和现有冲突归并；不能只改 fps 数字。新插值输出按相同秒取景，源时间映射仍归现有入口 |
| 改 width/height、像素比 PAR | 重算 a 与 C0/FOV。高度归一的 depth/anchorDepth/相机偏移保持语义值，x 按既有 x×a 映射；绝对派生机位不写回。零相机在任何画幅/PAR 下仍严格恒等；framing 以新画幅重新解占高，不沿用旧矩阵/裁剪/CoC/栅格密度缓存。若设置操作已有“保持构图”模式，其二维补偿与空间补偿由同一事务服务计算 |
| 自动重构图/裁切构图 | reframe/videoEditReframe 的二维自动曲线与空间补偿共用目标几何求值；framing 的主体/占高保持意图，新增偏移/补偿曲线记录在正式字段，不能缓存旧绝对相机。读取已重构目标位置再求相机一次，避免双重平移；手工覆盖和自动来源规则保持 |
| 整序列复制 | sequenceCopy 重映射 sequence/clip 身份与相机 framing/aim/focus 全部静态及曲线引用，复制相机意图/曲线，重算派生值；不复制 GPU/矩阵缓存 |
| 剪切/复制/粘贴部分片段 | 复制四键/曲线/开关；目标一同复制则按稳定身份重映射。跨序列粘贴沿目标序列相机，不覆盖目标相机；确需携带原序列空间构图的操作走正式嵌套入口。任何需迁出的相机引用若目标未随行，由 A 先烘成等价世界点/边界/焦点距离曲线，不能悬空；普通复制片段本身不偷带相机 |
| 嵌套/解除嵌套 | nestedSequences 保留子序列相机/独立时钟，父序列仅见输出卡片。创建子序列搬移绑定目标时，同步处理父相机引用（转等价世界目标轨迹），子相机所需外部目标也在搬移前烘焙；仅 whole-sequence 复制可直接复制完整相机。解除嵌套调用现有服务及空间转换，不能用 JSON 展开后忽略两套投影；无法无损表示时保留嵌套并说明具体原因 |
| 删除绑定目标 | 删除前按旧快照在其全有效绑定区间求 framing/aim/focus，转为世界点/边界或距离的普通曲线、保留输出误差门槛和关键边界；然后同一事务删除并按原回收/历史语义保留。撤销恢复对象与原绑定。暂时隐藏/停用不是删除，仍求几何并返回 targetActive=false |
| 创意候选/引用快照 | creative-intent-candidate 的 motions[].curves 与 referenceTransforms 中目标快照的 curves 都要能读取/保存四个空间键；A 负责 schema/格式链，C 负责候选应用仅合并二维键、保留目标空间曲线。候选内存在空间曲线不授权二维运动算法重写它；撤销/恢复保留原片段完整曲线 |
| 原生模板与风格件 | videoEditNativeTemplateClipSchema、styles/templateSchemas/nativeTemplates、videoEditTemplates 显式保留四数值/clip.curves/spatial.enabled。**首期仅带片段空间属性，沿用目标序列相机**；不带相机快照，不为模板自动新建嵌套，不承诺带回来源机位下的相同取景 |
| 保存/重开、撤销/重做、包导入导出、录制内嵌 | 全部经正式格式/事务服务保留同一数据及引用，纯迁移不补空间默认字段；包复制重映射稳定身份。指纹无空间字节不变；有空间时包含真实相机、片段与嵌套依赖 |

引用烘焙使用相同求值器与已有普通曲线，覆盖原目标整条有效时间及切点/hold/曝光样本；最终输出像素误差目标≤0.25px，不靠上一帧状态。无合法等价表示时在改动前报告具体不能保持的构图，不能提交半套删除/迁移。

黄金样本通过正式构造器/序列化器生成，覆盖旧平面、空间四键切分/缩放、相机偏移/framing/目标曲线、API 9、模板与录制/包往返；旧样本全部保留。精确迁移/读取/写回测试通过后串行执行 persistence:baseline 与 persistence:release-snapshot。不改 .hjstg、cameraStage、R3F 或镜头参考，也不新增 SpaceScene 格式。

### 10.3 C 负责的二维运动边界（首期冻结）

四个空间键参与 A 的通用时间操作（修剪、分割、改速、缩放等），**不扩入现有运动算法的处理键集合**。C 负责以下入口的声明、实现保护和语义测试；算法仍只改其原有二维键，不因 VIDEO_EDIT_ANIMATABLE_KEYS 增加而遍历全部键。此处不是禁止空间能力写空间键：第 8 节的专门空间算法仍按 SpatialPatch 写入。

| 入口与唯一 owner=C | 首期行为 / 必须保护的结果 |
| --- | --- |
| core/creativeIntent/stagger.ts | 错峰仅移动二维动作；目标 depth/rotationX/rotationY/anchorDepth 的数值及每条曲线原样保留，不把来源空间动画复制到目标 |
| core/creativeIntent/{motionCompiler,fitting}.ts | 编译、拟合误差与简化只覆盖现有二维 MotionCurveKey；不为未知空间键插入默认值、不裁剪或简化空间关键帧 |
| core/videoEdit/motionDraft.ts | merge/apply 候选仅合并受支持二维键；先保留目标完整 clip.curves，不以候选替换整个 curves，不以候选中的空间键覆盖目标 |
| application/videoEditMotionGroup.ts | 批量运动/错峰沿上面同一服务；提交与撤销保持每个成员的空间开关、四数值与四曲线 |
| application/videoEditSuperKeyframes.ts | 录制、拟合、应用、清除自动动作仅覆盖原二维动作范围；空间数据随原片段快照保留，不编译为空或重置为 0 |
| core/videoEdit/stabilization.ts、application/videoEditStabilization.ts | 稳定结果与关闭/移除稳定只处理二维校正及其来源，不改空间键 |
| core/videoEdit/tracking.ts、application/{videoEditTrackingEdits,videoEditTrackingEditing}.ts | 跟踪写入、替换和清除仅处理二维跟随/曲线；保留目标的全部空间数据 |

每个入口用真实混合片段验证：既有二维动画加四条非零空间曲线（含 Bezier/easeRange/手工来源）和空间数值，执行算法及清除/撤销后，二维结果符合原算法，空间字段深比较不变。不是断言键名单；保护的是泛化遍历、整体替换与清除操作可能误伤空间数据的行为。C 修改自己的算法入口，若需要 A 的通用键元数据/Worker 签名增量，由 A 在其独占文件落地。

## 11. 实施验证、资源与失败语义

### 11.1 本轮文档验证

本轮为 L0 文档核查：按首轮 24 项、第 12.1 节裁定及第 2 轮 15 项核对正文、TS 契约语法及类型引用、所有权、执行次序、主仓库链接和嵌入 schema 链；review.md 保持原文。只改本文件，不运行 lint、工程 tsc、Vitest、构建、安装或 GPU 实验，不提交、不 push。历史 CPU/GPU 记录不是本轮实测；设计定稿后由 Claude 自查直接开工，不再送设计复审，正式运行验收仍按 11.2 执行。

### 11.2 实施时的最小匹配验证

- A 的格式/共享合成、B 的 GPU/作者契约、C 的原子事务至少 L2；按本线实际文件运行精确测试、所属 tsc 与依赖图/持久化/能力专项。core 改动按规则跑双工程 tsc，verify:changed 显式给本次文件、先 dry-run；不得扫描其他任务脏工作区。
- 三线最终集成改变核心公共作者契约/关键依赖，满足 testing.md 的 L3 条件，由 Claude 在完整边界统一执行一次；不让每条线各自全仓构建。只需更新运行产物时用 electron:bundle；性能结论用隔离生产产物，一次一个，不接 9334。
- 数值测试保护真实语义：零相机与不同画幅/PAR、X/Y/Z 非交换旋转、可见质心与非中心轴心、lookAt 奇异、裁剪、层序切换、转场原子排序、焦点/取景求值、CoC→0 与二维收敛。
- 调度测试用可观察的调用序列证明 transform worldScene 是 B 逐样本渲染、A 按层累积后一次景深；group 动态换序场景是每样本局部景深→组合成→累积，8/16 样本各对应 8/16 次。space:true 非 three 只中心渲染/中心键，A 从未构造作者 contentKey；容量方法经 CodeSources/Host 转接。失败/取消验证 lease 无泄漏、部分累积不发布。
- C 对 10.3 每个运动入口做“二维发生预期变化、空间键及曲线原样保留”的行为验证，含应用、替换、清除与撤销；A 验 candidate/title-templates/preset 包的嵌入链，style-kits 保持无关格式不改。
- 状态/格式测试覆盖四键切分/缩放与旧零默认、相机引用级联/嵌套、向后读取与最低 reader 拒绝旧程序误读、模板目标相机、无空间指纹字节不变、17 模拟子时刻/18 同票据几何、15 键与目标实际内容一致。
- 生命周期验证覆盖 resize/精度升档、release/spill/dispose、共享 device 丢失、取消迟到、预热与合成串行、nodeFrame 墙钟停止、最后子样本键不得冒充中心帧；同一路径固定前序帧验确定性。
- 能力从 describe/change/read 的正式状态源验证成功/失败/撤销/保存重开；真实模型经 assistant:cli 在隔离工程完成“展开、对焦、压平、撤销”，外部 MCP 走同源正式调用。按已有付费策略，不放宽额度；schema 通过不能替代实际能力使用。
- 新测试只保留迁移/传播、数值不变量、所有权与取消、缓存错误、公共闭环这类风险，不把字段清单/版本号抄成断言。P1–P5 实测和目视按第 9 节；必须定向验证第 12.1 节联合场景的逐样本局部景深次序、8/16 次数与模拟姿态，不以冻结中心画面替代。

### 11.3 资源、日志与失败

- 日志复用 createLogger/现有帧阶段计时与 logs:query；规划/提交/保存、作者准备/预热/渲染记录 start/completed/failed。逐帧后端、copy 次数、样本数、中心 CoC、预算只放 debug/trace，正式界面不显示矩阵、revision、缓存计数。
- 媒体通过现有作者资产参数与宿主收口，交 Worker 的 URL 在边界转为可 fetch 形态，主进程保留真实路径；不让 B/C 每处自行拼地址。本票不新增模型/HDR 导入。
- 输出完成且 request/epoch 匹配才发布。取消/切序列/关闭实例后迟到 GPU 完成不能覆盖新画面；lease 按 completion 释放，异常不偷用旧图伪造观察/导出成功。预算不足报告必要工作集，不静默降精度或减少采样后声称质量一致。
- 密钥、Electron 隔离、外来代码首次信任、付费/删除与更新包五条底线沿项目现有服务，不加空间专属权限模型。保存失败保留脏状态，重试只重试保存，引用级联与删除共同撤销。
- 实现提交前按 AGENTS.md 由干净上下文审查，最多三轮；本次是 L0 文档改写且不提交，不另派实现审查代理、不改 assistant-status、不创建额外总结文档。

### 11.4 24 条裁定落点

| review 编号 | 正文落点 |
| --- | --- |
| 1 动画键并入、2 最低 reader | 4.1、10.1–10.2 |
| 3 几何中心、4 零偏移相机/传播 | 4.2–4.3、5.2–5.3、10.2 |
| 5 近恒等收敛、6 改前 main 真值 | 5.1、9 P1 |
| 7 中心一次景深/按需组曝光 | 4.6、5.3–5.4、12.1；动态换序 worldScene 的逐样本局部景深已并入，普通卡片仍每帧一次 |
| 8 three 时钟、9 单一后端与模块身份 | 6.2–6.3 |
| 10 A 曝光接口、11 17/18 顺序 | 3.2、4.6、7.2 |
| 12 显式空间依赖、13 core/依赖门禁 | 4.4、6.1、7.1 |
| 14 ExternalTexture/不做 Z、15 串行预热 | 6.4 |
| 16 P2 8/16 样本、17 双空间端转场 | 9 P2、5.2 |
| 18 斜视/抗锯齿/推近重栅格 | 5.2 |
| 19 持久取景/视差比、20 旋转/背面/lookAt | 4.2–4.3、8.1–8.3 |
| 21 模板边界、22 旧指纹字节不变 | 10.2、7.1 |
| 23 小 CoC 旁路与连续、24 内部 pose 模糊 | 5.3、5.4 |

第 2 轮逐项落点（以下均为执行契约）：

| 第 2 轮编号 | 正文落实 |
| --- | --- |
| 1 第 12.1 节已定例外 | 4.6 次序，5.3，9.1/9.2 的 P2 次数，11.2，12.1 |
| 2 transform worldScene | 4.6 的 accumulateLayerSample/finishLayer/applyCenterDefocus 签名与逐层次序，5.3 |
| 3 space:true 非 three 中心冻结 | 4.6、5.4、6.1、7.1 |
| 4 B 独占内容键 | 4.6 SpatialSampleRequest 无 contentKey；7.1 |
| 5 透视量推拉变焦 | 4.2/4.3 的机位与焦距联动，8.3 的 perspective 曲线 |
| 6 作者入口枚举与 API 9 owner | 3.1：八处入口相关文件归 B，codeMaterialVersions 归 A |
| 7 前置票与 19 后置子项 | 3.2、7.2 执行表；19-U12 二维效果与空间复合转场关系 |
| 8 嵌入格式传播 | 10.1/10.2：candidate、title-templates、video-preset-package、style-kits 逐项判定 |
| 9 运动算法保留空间键 | 3.1、10.3、11.2，由 C 负责各入口 |
| 10 具体帧/lease/materialPlan/容量 | 4.6 完整 TS，PreparedSpatialFrame 对 A 不透明，容量经 CodeSources/Host |
| 11 景深阈值及尺度归属 | 3.1、5.3、7.2，ticket 12 后 A 串行修改共享效果计划 |
| 12 相机旋转恒等 | 4.2 显式列 rotationX/Y/Z；5.1 与 11.2 数值验证 |
| 13 three 数学例外 | 4.3/4.4、6.2：懒加载，只传数值，不跨实例 instanceof |
| 14 叠加分支 | 3.2、7.2：B/C 基于 A 接口提交开工，A 合入后各自 rebase |
| 15 主仓库链接 | 全文仓内链接以本票目录的 ../../ 指向 D:/VibeCode/Henji-AI，票间链接仍在同一 tickets 内 |

## 12. 已定联合语义与实施门槛

### 12.1 动态 worldScene、换序、景深的最终执行规则

review.md 已批准本例外，直接实施。普通卡片（包括 space:true 的非 three 作者）冻结中心材料面，每帧景深一次。稳定层序的 worldScene 由 B 逐样本渲染，A 用 accumulateLayerSample 累积成一个场景层材料面，再 applyCenterDefocus 一次。动态 worldScene 在快门内与别层换序且开启景深时，B 每子时刻执行 simulation.at(sourceTime)/update/render，A 对返回场景图按中心 CoC 做局部降采样景深，再与该时刻其他层 compositeGroup，最后 accumulate；不能先累积场景层或整组再统一虚化。

CoC 只求中心值，子样本只更新支持域/裁剪与工作区域；场景已投影，CoC 直接以输出像素换到其局部工作纹理，不二次透视。每个未旁路场景在 N=8/16 时对应 8/16 次场景渲染和 8/16 次景深执行；每个普通卡片仍只有 1 次景深。不开景深或阈值旁路则执行次数为 0。单次计划内部多 pass/降采样另计，不把一次计划说成一次 GPU pass。具体调用和 lease 生命周期冻结在 4.6，P2 分项记录在 9.2。

该例外只放宽动态换序场景的景深次数，不冻结模拟、不关闭模糊、不对每个样本盲开全画幅 blur；空间层序仍是首期中心深度近似。

### 12.2 已定方向与实测门槛

API 9、中心深度近似、80mm/36mm/1m 标定、polygon-clipping、最终 owner、叠加分支、模板只带空间片段与 Claude 看样片均已定。没有剩余设计裁定项。最终格式数字由 A 在前置票合入后按登记表分配。

G/W 默认路径、ExternalTexture 公开目标组合、抗锯齿/CoC 阈值和 P2/P5 性能属于实施中的实测验收：按第 6、9 节由 Claude 根据证据验收，不预先声称 W 可用、零拷贝或性能达标。Claude 自查本文后按 7.2 开工，无下一轮设计送审。

## 13. 官方资料与采用边界

- [three WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)：同一渲染器可选择 WebGPU 或 forceWebGL 后端；本票据此统一 G/W 契约，而非两种 renderer 的近似互换。
- [three ExternalTexture](https://threejs.org/docs/pages/ExternalTexture.html)、[本地 r186 实现](../../node_modules/henji-author-three-0.186.1/src/textures/ExternalTexture.js)：公开包装同上下文 GPUTexture/WebGLTexture；公开组合可否完整用作宿主输出目标仍需 P2。不可把接口存在当生产可用证明。
- [r186 Renderer](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Renderer.js)、[Animation](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Animation.js)、[NodeFrame](https://github.com/mrdoob/three.js/blob/r186/src/nodes/core/NodeFrame.js)：本地锁定 0.186.1 同名源码已只读核对，init 启动 RAF、空用户回调不会停时钟、NodeFrame.update 读 performance.now；受管封装与回归集中在 B 的时钟适配器。
- [three PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)、[r186 WebGPUBackend](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js)：相机光学语义、外部 device 与资源生命周期参考；不使用 XR 私有目标接口。具体归属/错误回调必须以锁定源码和探针验证。
- [r186 DepthOfFieldNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/DepthOfFieldNode.js)：不把其艺术化参数直接当本票毫米薄透镜与透明层契约；首期复用宿主现有镜头 blur 内核。
- [WebGPU 坐标与裁剪](https://www.w3.org/TR/webgpu/#coordinate-systems)、[纹理拷贝](https://www.w3.org/TR/webgpu/#texel-copies)：不同深度区间、format/usage/拷贝约束；数学投影一致不等于采样/混合逐像素一致。
- [VGPU 官方 context](https://raw.githubusercontent.com/vercel-labs/vgpu/main/docs/topics/concepts-context.docs.md)、[性能模型](https://raw.githubusercontent.com/vercel-labs/vgpu/main/docs/topics/performance-model.docs.md)：复用 context/资源、绑定身份与目标配置。本会话没有 vgpu MCP，vgpu.sh/docs 无法读取后核对官方仓库资料；本票仍复用项目现有封装，不按新文档替换整套 VGPU API。
- [polygon-clipping 官方仓库](https://github.com/mfogel/polygon-clipping)、[Martinez 官方仓库](https://github.com/w8r/martinez)：多边形布尔运算的成熟实现；前者已获 Claude 批准，由主工作区串行安装。本次未触碰联接点 node_modules。近共线/重边/多遮挡夹具验证实际算法边界，不拿上游宣传作本机性能证据。

沿用 three（MIT）、已批准的 polygon-clipping 与宿主合成/效果内核；不新增 Babylon、R3F、Theatre、camera-controls、BVH、glTF Transform 或新排版/物理依赖。17 的模拟库与 18 的网页采样由其唯一入口提供。本票不变更镜头参考与其 three 版本。

## 14. Claude 裁定（11-01）
1. 批准首期边界：单一序列摄像机、合成屏障内稳定深度排序、场景层与卡片不做像素级穿插、倾斜卡片与厚场景用同一中心深度景深并在读回里写明近似。
2. 批准 createThree 受管入口；作者 API 与 ticket 17/18 共用 API 9（谁先合并谁登记，API 9 未发布前其余直接扩充）。A/B/C 文件所有权与热点文件集成顺序按第 3、7 节；polygon-clipping 由 Claude 在主工作区安装（MIT，纯 JS），各线合并 main 后使用。
3. 批准 80mm、36mm 横向画幅、1 世界单位 = 1m 的原型标定与第 9 节验收目标；正式后端按样片数据选，零拷贝未过门槛不进默认路径。
4. 用户不看样片：原型样片由 Claude 按用户画面口味目视验收后直接往下做。
首轮与第 2 轮设计裁定均已落入正文；Claude 自查后按 7.2 的前置集合与叠加分支顺序开工，不再送设计复审。
