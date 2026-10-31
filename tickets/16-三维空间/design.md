摘要：只扩展剪辑中的片段三维属性、序列摄像机和标准 three.js 作者场景；不改镜头参考，不新增人工三维编辑界面。
摘要：实现分 A 合成与格式、B 作者场景与渲染桥、C 算法能力与读回三线；先冻结共享契约，再并行，公共文件由唯一负责人串行集成。
摘要：平面状态直接走原二维管线保证逐像素一致；先交“平面开场一镜到底展开成三维”样片，再依据 WebGL 拷贝与共享 device 原型数据决定正式渲染路径；本文待 Claude 与审查员批准。

# 16 三维空间技术设计

## 1. 范围、依据与基线

- 范围以 [plan.md](plan.md) 和 [以后再做第 4 项](../../../Henji-AI-t16/docs/task/代码效果与渲染改进/以后再做.md)中“2026-10-29 再收窄”的用户决定为准。[三维空间调研](../../../Henji-AI-t16/docs/task/代码效果与渲染改进/三维空间调研.md)是技术依据，其 P2–P5、SpaceScene 编辑器、镜头参考迁移、改名、摄像机轨道、模型/HDR 导入优化不自动成为本票工作。
- 本票只面向 AI 操作。现有图片、视频、文字、图形、代码和嵌套序列片段可以成为空间卡片；几何体由标准 TS/JS 与原生 three API 创作。无新的场景 DSL、第二套时间线、第二份业务状态或撤销栈。
- 本轮唯一写入是本文件。源码、依赖、Git 分支与提交、9334 开发实例、D:/视频制作均不修改；不运行安装、构建或 GPU 程序。
- 代码核对基线：D:/VibeCode/Henji-AI-t16，分支 task/16-三维空间，HEAD 90103a8f3。读取期间本机 main 已到 1a915b959；与本分支差异为任务/进度文档，无源码差异。本轮不做同步，正式实现前由 Claude 串行确认最新代码与已批准接口。
- 规则依据：[架构](../../../Henji-AI-t16/docs/rules/architecture.md)、[持久格式](../../../Henji-AI-t16/docs/rules/persistence.md)、[助手目标](../../../Henji-AI-t16/docs/rules/assistant-goal.md)、[助手现状](../../../Henji-AI-t16/docs/rules/assistant-status.md)、[应用能力](../../../Henji-AI-t16/docs/rules/assistant-capability.md)、[能力技能](../../../Henji-AI-t16/.codex/skills/henji-application-capability/SKILL.md)、[日志](../../../Henji-AI-t16/docs/rules/logging.md)、[媒体边界](../../../Henji-AI-t16/docs/rules/media-url.md)、[验证](../../../Henji-AI-t16/docs/rules/testing.md)。本次仅设计，验证等级 L0；下文实施验证尚未执行。

## 2. 现有代码事实与复用决定

| 位置 | 事实与决定 |
| --- | --- |
| [document.ts](../../../Henji-AI-t16/src/core/videoEdit/document.ts)，videoEditClipStateSchema、videoEditSequenceSchema；[keyframes.ts](../../../Henji-AI-t16/src/core/videoEdit/keyframes.ts) | 片段已有位置、缩放、Z 轴旋转、锚点和曲线；新增深度与 X/Y 旋转，不复制二维属性。序列摄像机采用一个可动画对象，不新增 camera 片段类型。 |
| [clipGeometry.ts](../../../Henji-AI-t16/src/core/videoEdit/clipGeometry.ts)，videoEditClipToFrame | x/y 是相对画面中心的宽/高比例，正 y 向下；不是左上角绝对比例。fit、anchor、scaleAspect、源方向必须保留。 |
| [videoEditGpuShaders.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditGpuShaders.ts)，VIDEO_EDIT_LAYER_VERTEX | 现有 warp 把单应矩阵变成齐次 x/y/w，但 z 固定为 0，且 warp2.z 被用作启用判定。不能把任意摄像机投影直接塞入并声称近/远裁剪正确。三维使用独立顶点布局和完整 clip xyzw，二维 shader 保持原行为。 |
| [videoEditGpuCompositor.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditGpuCompositor.ts)，draw；[videoEditCompositeScene.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditCompositeScene.ts)，normalize、resolveClip | 画面与片段按数组下标配对；附加效果会先画到全画幅，再把片段几何改成 identity。三维排序必须排序完整绘制项，附加效果路径必须保留空间元数据，不能只排序 clips 或让 identity 丢掉投影。 |
| [compositing.ts](../../../Henji-AI-t16/src/core/videoEdit/compositing.ts)，buildVideoEditCompositePlan | 调整层已有轨道范围树，转场已有原子合成节点。保留此树的语义，不能对全序列简单按 z 排序。 |
| [motionBlur.ts](../../../Henji-AI-t16/src/core/videoEdit/motionBlur.ts)；[videoEditRenderer.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditRenderer.ts)，render 帧准备 | 片段路径为 180° 快门，最多 16 样本，播放最多 8；位移估计间距 1.5px，不是调研文档里的统一“每 4px”。当前逐层平均不能保证曝光期间换序的遮挡。三维沿用采样器与质量档，按子时刻先合成空间组，再平均曝光。 |
| [videoEditBuiltinEffectPasses.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditBuiltinEffectPasses.ts)，planAuthorDefocus；[videoEditAuthorEffects.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditAuthorEffects.ts) | 镜头虚化已收口到共享效果计划及执行器；复用它的 padding、预乘 alpha、高精度和光贡献处理。不新增另一套 blur shader，不再按旧调研调用不存在的 AuthorGpu.lens。 |
| [videoEditAuthorModule.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditAuthorModule.ts)，AuthorFrameInfo、AuthorModule；[videoEditAuthorRuntime.ts](../../../Henji-AI-t16/src/features/videoEdit/engine/videoEditAuthorRuntime.ts)，renderFrame | 作者已有 createWebGL/createWebGPU；WebGL 画布每帧 copyExternalImageToTexture，WebGPU 借同一 device 画目标。layers 与 GPU 入口互斥。现有 info.time 是作者源时间，不能改成序列时间。 |
| [authorLibraries.ts](../../../Henji-AI-t16/src/core/videoEdit/codeMaterial/authorLibraries.ts)、[package.json](../../../Henji-AI-t16/package.json) | 已冻结 three 0.186.1、three/webgpu、three/tsl；应用镜头参考仍使用 three 0.169。本票复用作者版，禁止宿主适配器误导入应用的另一版 three。 |
| [videoEditFields.ts](../../../Henji-AI-t16/src/features/videoEdit/application/videoEditFields.ts)、[videoEditExecutors.ts](../../../Henji-AI-t16/src/features/videoEdit/application/videoEditExecutors.ts)、[videoEditService.ts](../../../Henji-AI-t16/src/features/videoEdit/application/videoEditService.ts) | 通用字段、实体事务、文档实例、editVideoProject 和保存回读已存在。只增加声明和领域算法；Pi/MCP 自动投影，不手写工具白名单。 |
| [recipes-3d.md](../../../Henji-AI-t16/resources/assistant-skills/video-edit-code-creation/references/recipes-3d.md) | 当前还教作者手写伪透视和摄像机。实施后新增能力的配方调用宿主操作；旧 API 说明保留版本边界，不能继续把宿主已实现的投影/虚化作为作者作业。 |

## 3. 三条实现线、唯一所有权与集成顺序

本节文件均是批准后的预期改动；“新增”文件当前不存在。A 负责契约与格式集成，B 负责作者生命周期，C 负责能力和配方。同一文件不交两线同时修改。

| 线 | 独占文件范围 | 输出与独立验收 |
| --- | --- | --- |
| A：合成、几何、摄像机、格式 | 新增 src/core/videoEdit/spatial.ts（schema、求值、矩阵、曝光计划、纯读回几何）；新增 engine/videoEditSpatialComposite.ts 与 videoEditSpatialShaders.ts；修改 core/videoEdit/{document,keyframes,clipGeometry,compositing,motionBlur,renderCache,renderFingerprint,sequenceCopy,nestedSequences}.ts、engine/{videoEditGpuCompositor,videoEditGpuShaders,videoEditCompositeScene,videoEditRenderer,videoEditRenderPrecision,videoEditGpuBudget}.ts。GPU 层均位于 src/features/videoEdit/engine。格式文件见第 10 节，由 A 唯一写入。 | 给 B/C 冻结 SpatialFrame、SpatialDrawItem、SpatialPatch；旧片像素不变；投影/裁剪/组排序/景深/运动曝光和嵌套输出一致；旧格式可读。 |
| B：作者 three 场景及桥接 | 新增 engine/videoEditAuthorThree.ts（宿主管理场景入口与 WebGL 桥）、videoEditAuthorThreeWebGpu.ts（共享 device 适配）；修改 engine/{videoEditAuthorModule,videoEditAuthorRuntime,videoEditAuthorPrograms,videoEditAuthorParameters,videoEditAuthorTypeEnvironment,videoEditCodeGpu,videoEditCodeSources,videoEditAuthorFingerprint,videoEditCodeFingerprint}.ts、resources/video-edit-author/author-api.d.ts。 | 作者只搭 three.Scene 并按宿主时间更新；镜头投影一致、资源正确释放、独立后端对比、乱序取帧确定。向 A 提交 API/格式需求，B 不改格式登记。 |
| C：通用属性、算法、结构化读回、配方 | 新增 core/videoEdit/spatialLayout.ts、core/application-control/domains/videoEdit/videoEditSpatialCapabilities.ts、features/videoEdit/application/videoEditSpatial.ts；修改 application/{videoEditFields,videoEditReflection,videoEditExecutors,videoEditDocumentAlgorithm,applicationDomain,videoEditFrameObservation}.ts、core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts、resources/assistant-skills/video-edit-code-creation/{SKILL.md,references/recipes-3d.md,references/camera.md,references/author-api.md}。 | 正式 describe/change/read；两项算法一步提交、一步撤销、保存回读；空间验证与取帧同一求值器；配方实跑。 |

- A 先交纯契约与数值夹具，再推进 GPU；B 可先用固定 SpatialFrame 验证已有 WebGL 和共享 device 桥；C 可基于纯契约实现布局与事务。B/C 不依赖 A 的 shader 才开始工作。
- A 的 render 调度文件只增加调用 B 导出入口和 C 只读结果所需的数据；B/C 交接口与增量说明，不自行改 A 的文件。
- 相邻单测归对应实现线。全局 persistence 基线、发布承诺、能力契约版本、生成文件、package.json/锁文件由 Claude 串行集成；不让各线分别生成后覆盖。只在对应声明真实变化时更新契约版本，不因写设计提前升号。
- 数据传播的配套文件归 A：core/videoEdit/{timelineEdits,keyframeLanes,styles/templateSchemas}.ts、features/videoEdit/application/{videoEditClipSpeed,videoEditTemplates}.ts；C 的通用执行器调用 A 提供的空间字段/曲线转换。A 修改既有运动 Worker 的消息和计算分派以承载 C 的纯布局计算，B/C 不分别扩消息协议。原生模板的嵌套保留处理也由 A 接现有领域服务。
- 并行阶段完成后，A 集成单帧/子帧调用，C 验证公共能力闭环，Claude 组织同一份正式运行产物的样片与审查。构建和 GPU 测试一次一个，不共享修改运行产物。

## 4. 领域数据与接口契约

### 4.1 作品真相

- 片段新增可选 spatial 对象：enabled、depth、rotationX、rotationY、anchorDepth，以及上述数值属性的 curves。depth/anchorDepth 单位为序列显示高度，正值朝默认镜头；旋转单位度。x/y/scale/scaleAspect/rotation/anchorX/Y 继续是原字段；不存在 position3D 和旧二维位置两份真相。开关关闭时保留三维数据但不参与求值。
- 片段空间曲线沿用 videoEditKeyframesSchema 与插值求值，时间为片段内帧，可用小数帧取快门样本。不能将 spatial.curves 混入旧的封闭二维 curves 枚举而漏掉修剪、分割、复制、变速及改帧率操作。
- 序列新增可选 spatialCamera：position（以画面中心为原点、显示高度为单位）、aim（目标片段引用或世界点）、focalLengthMm、sensorWidthMm、focus（目标片段引用或距离）、fStop、depthOfField、curves。只存可求值的属性与曲线；near/far、矩阵、CoC、焦点解析结果和缓存键都是派生值。
- 序列只有一台有效摄像机，曲线时间为序列帧；镜头切换用 hold 关键帧，重叠机位/摄像机轨道不在本票。瞄准和对焦分别控制，推近不自动换焦点。用户化语义见第 8 节。
- 无空间数据的作品仍是纯二维。默认摄像机正对 z=0，默认景深关闭；缺少 spatial.enabled 不等于自动把所有片段三维化。字幕与二维覆盖层保持原轨道行为。
- 同序列引用用现有 document/sequence/clip 稳定身份，在落盘时存领域内部 clipId，公共接口用完整 ApplicationRef。删除目标、复制序列、复制部分片段时必须修正依赖：目标随复制则重映射；不随复制则把该相机的目标绑定烘焙为等价点/距离曲线。删除绑定目标在同一事务执行这一转换并可撤销，不悄悄改对焦对象。对被删目标的真实保存走原回收/历史语义。
- 目标片段暂时在时间范围外或被停用时仍按其几何曲线计算目标点，返回 targetActive=false；不依赖上一帧位置。目标引用损坏时返回带具体引用的失败，不用“最后一次有效焦点”污染随机取帧。

### 4.2 坐标与时钟

- 逻辑显示宽 Wd=sequence.width×pixelAspectRatio，高 H=sequence.height，a=Wd/H。世界 X 向右、Y 向上、Z 朝默认摄像机，右手系。原二维锚点 x/y 映射为 (x×a, −y, depth)，局部长度除以 H，旧 rotation 正方向在映射处处理，禁止把顺时针直接当 three 的正 Z 旋转。
- 像素长宽比只在逻辑坐标映射中处理一次；预览 divisor、导出缩放仅改变目标纹理尺寸，不改变世界尺寸、景深含义或镜头取景。three 的 aspect 使用显示宽高比，不直接使用编码栅格宽高比。
- 采用 sensorWidthMm=36、focalLengthMm=80 作为原型起点；F=focalLengthMm×a/sensorWidthMm，默认相机距离 D=F，垂直 FOV=2 atan(0.5/F)。这使 z=0 的可见世界高度恰为 1。three 的 filmGauge 是较长轴尺寸，宿主不直接把固定横向传感器宽写给 filmGauge 后忽略竖屏；由 FOV 明确构建投影。
- 空间矩阵使用 three 0.186.1 的 Matrix4/Vector3/Quaternion 数学实现，不自写通用矩阵库。core 只依赖作者版纯数学入口，不导入任何 renderer；若仓库依赖边界需要稳定导入映射，由 Claude 在主工作区处理。世界到 WebGL/WebGPU 的深度约定由适配器分别生成，不能把 WebGPU 的 z∈[0,w] 矩阵原样交给 WebGL。
- 相机与卡片在同一精确 sequenceFrame/subframe 求值；作者 time/info.time 保留源时间，info.clip.time 保留片段内时间；新增 info.space.sequenceTime、sampleTime 与 sourceTime。倒放、变速、时间重映射、静帧通过现有 clipSpeed/timeRemap 入口换算。嵌套序列拥有自己的相机与时间，子序列合成后作为父序列的一张卡；本票不折叠嵌套内部空间。

### 4.3 A/B/C 冻结接口

以下是新接口契约，不是已存在 API。字段结构由 A 在 spatial.ts 一处定义，B/C 消费同一类型。

| 接口 | 必含信息及约束 |
| --- | --- |
| evaluateSpatialFrame(composition, sequenceFrame, output, quality) → SpatialFrame | 作品/序列身份；逻辑画幅与目标像素；相机世界/视图矩阵及 WebGPU 投影矩阵；焦距、传感器、光圈、focusDistance；flatIdentity；有序 exposureSamples（序列时刻、权重）；已解析目标和诊断。纯函数，无 GPU/全局时钟。WebGL 矩阵由同一相机参数派生。 |
| SpatialCardGeometry | clipId；uvToWorld/clipFromUv；局部边界含效果 padding；锚点 viewDepth；裁剪后的画面多边形；CoC 半径；原二维 ordinal；compoundGroup。不得用排序后的下标替代 clipId。 |
| SpatialDrawItem | sourceKey、clipId、picture/lease、geometry、opacity、precision、carriesLight、group；picture 与几何不可拆开排序。worldScene 类型已由宿主相机投影，不再应用卡片的透视矩阵；普通代码类型仍是卡片。 |
| renderAuthorThree(request) → SpatialScenePicture | 接收 SpatialFrame 的单个曝光样本、正确源时间、渲染目标与取消身份；返回与现有 VideoEditCodePicture 相同的 owner/texture/尺寸/精度/光贡献/完成约定，以及场景根锚点、包围盒。目标属于宿主；作者只拥有场景对象。 |
| planSpatialLayout(snapshot, intent) → SpatialPatch | 纯算法返回受影响片段与相机的普通字段/关键帧变更、前后投影指标、近裁剪/遮挡事实；C 经原领域事务一次提交。不让 GPU 回调改文档。 |
| inspectSpatialFrame(snapshot, frame) → SpatialInspection | 使用同一几何求值结果；给出位置、裁剪、层序、遮挡证据级别、焦点与 CoC；只读，不执行任意作者源码。真实场景像素仍经正式取帧。 |

## 5. 合成顺序、裁剪、景深与曝光

### 5.1 平面逐像素保证

保证对象是同一设备、同一素材帧、同一输出规格/质量/颜色设置下，空间开关关闭的二维结果与空间开关开启但有效空间变换为恒等的结果。不是跨显卡、跨 three 后端、跨解码器的位级承诺。

flatIdentity 成立须覆盖本次曝光的全部采样时刻：参与的卡片 depth=rotationX=rotationY=anchorDepth=0；相机与默认参考平面的投影相同；景深半径为 0；无其他空间后期贡献。可存在原有 x/y/scale/Z旋转/二维运动模糊。各属性用规范化数据判定，不用“接近 0”的 epsilon 把微小有效运动吞掉。

成立时直接执行原 buildVideoEditCompositePlan、原 clips/pictures 顺序、原 shader、原采样器/颜色/精度选择和原二维运动模糊；不经过三维 shader、全幅中间纹理、MSAA、色调映射或额外量化。打开三维开关本身不得触发 rgba16float。即使几何投影在数学上相等，换采样/混合顺序也可能变像素，所以不以“矩阵接近单位阵”代替此分流。

原生 three 网格不是二维真值来源。样片平面开场的网格层权重为 0；如果平面场景叠加一个可见网格，既有二维卡片仍保持原渲染，比较整体画面时必须包含同一张网格输入纹理。不能声称网格改用另一后端后整帧仍逐字节相同。

验收以编码前 RGBA/half 原始数据比较，差异像素数与最大通道差均为 0。覆盖纯图片、字幕/文字、透明代码、效果链、角点贴合、非中心锚点、非方形像素、嵌套、半分辨率、8/16 位既有分支及二维运动模糊。历史有损预渲染缓存不作为真值。

### 5.2 三维绘制与层序

1. 沿正式可见性和内容求值链取得素材、代码、跟随、防抖、淡化与效果。三维卡片先保留局部画面及 UV→参考平面的映射，之后做空间投影；已带空间坐标的三维场景直接输出投影画面。
2. 三维分支将效果输入做成带 logical origin/bounds 的材料面，保留源方向、非中心锚点、效果扩边和蒙版映射；不能把在参考画面外、运镜后会进入视野的内容提前裁掉。既有 normalize 的全画幅中间结果不得冒充仍带原尺寸的局部卡片。二维分支的效果顺序和像素范围不变。
3. 角点贴合先作用在卡片参考平面，再经相机矩阵投影，保持一次透视正确的 UV 插值。使用完整齐次坐标在近/远平面裁剪；跨近裁剪平面的卡片裁成可见多边形，不用 clamp(w) 把它撑满屏幕。near/far 由场景边界确定，微小正 near、所有可见正深度内容纳入 far；数值不可投影时返回明确诊断，不写 NaN uniform。
4. 以已有合成树的每个 siblings 列表为边界，把连续空间绘制项组成空间组。组内按锚点 viewDepth 从远到近稳定排序，同深度按原 ordinal；二维节点、已压平调整层/转场是合成屏障。调整层只处理原来声明的轨道范围，不因 z 改变吸入无关片段；内部空间组先排序。字幕继续在其既有位置合成。
5. 转场两端先各按当时相机求值，再用原转场生成一个原子屏幕节点；它不与别的卡片按三维深度相互穿插。嵌套序列输出同样是一个原子卡片。
6. 卡片与 three 场景层之间按图层锚点排序，不做像素级深度融合；场景内部由 three 做网格深度测试。相交/循环遮挡、一个网格穿过多张卡片不是首期正确性承诺；结构化读回标明 ambiguousDepth。可用多个独立代码片段分成前后景，不新增 SpaceScene 节点格式。

### 5.3 景深的首期明确边界

- 摄像机只有一份焦点和镜头参数。卡片和场景片段按锚点相机深度计算 CoC；对正对镜头的单深度卡片是常量模型，倾斜卡片和厚网格层是中心深度近似。读回返回 depthRange、cocRange 与 approximation='layer-center'，不能把近似写成逐像素物理景深。
- 使用薄透镜的同一单位公式：令 f、s（当前层距离）、sf（焦点距离）、传感器宽度均先换成毫米，N=fStop，CoC 直径 c=abs(f²(s−sf)/(N·s·(sf−f)))；半径像素 r=0.5·c/sensorWidthMm·实际输出显示宽。世界到毫米比例为固定光学标定常数，不是新增用户设置；计划以 1 世界单位=1000mm 起步。s≤near 或 sf≤f 属于无效光学状态，返回事实/自动布局避开，不用分母夹取伪造正常结果。
- r=0 严格旁路。r>0 使用 planAuthorDefocus 的镜头模式和现有共享 GPU 执行器，按最终屏幕尺度做虚化、扩边并保留预乘 alpha/carriesLight。不要再次对已虚化的 three 输出加同样景深；宿主统一执行一次。复杂网格用多个片段分层仍是同一相机。
- three r186 的 DepthOfFieldNode.focalLength 是艺术化离焦范围，不是毫米；其 CoC 使用 smoothstep，部分中间 alpha 是 CoC。它不能直接满足透明场景层与本票统一薄透镜语义，因此首期不接 TSL dof。逐像素网格/倾斜卡片景深是需要单独扩大范围的能力，不能以默认开启不正确的 dof 隐藏缺口。该首期边界列入 Claude 审批点。

### 5.4 运动模糊

- 相机、三维片段变换和场景 update 在同一快门子时刻求值。采样数以屏幕投影的角点/包围盒运动量估计，包含相机运动；沿用现有 180°、播放 8/最终 16 的质量上限，不扩大成配置面板。空间中间转折也参与运动量估计，不能只比较首尾而漏掉往返运动。
- 一个空间组中，每个子时刻都完成场景渲染、几何/深度求值、景深与正确层序混合，再按权重累计到曝光纹理。禁止逐层先平均后 over；禁止把中心时刻排序套在所有样本。已有源内容模糊不重复开启，进入空间曝光时关闭该层原二维/作者位姿曝光，由空间调度唯一负责。
- 普通视频/图片卡片的纹理取中心素材帧，曝光采样其空间变换，延续当前变换模糊语义；原生 three 场景的内部动画按源子时刻 update。需要原素材内容的时间积分不属于本票。scene 使用到的媒体按同一已声明语义准备，不因 N 个快门样本触发 N 次网页重演。
- motionBlur=false 的片段在所有样本使用中心时刻的自身变换、相机和场景状态；序列 motionBlur=false 则单样本。切点与 hold 镜头边界不采到另一镜头；在当前连续片段区间重归一权重，避免切前切后鬼影。静止组直接单样本。
- 曝光、颜色和精度元数据进入内容依赖。GPU 保留的中间工作集按组流式复用，不同时持有 N 份全序列纹理；半浮点累积由现有预算计账。

## 6. 作者 three 场景与 WebGL / WebGPU 原型

### 6.1 作者入口

新增可选 createThree(host) → { scene, update, dispose? }，与 draw/layers/createWebGL/createWebGPU 互斥。返回原生 THREE.Scene，update(params, assets, info) 只按时间设置对象、材质、灯光。host 提供与冻结作者 three 同一模块身份的 camera、逻辑尺寸和受管渲染环境；作者不自建渲染器、不调用 render/setAnimationLoop、不接管投影或时间。标准 ESM、TS 类型、原生 three API 不变，不限制作者表达成封闭 DSL。

- 宿主在 update 前同步只读约定的 camera，渲染前复核/重设投影；camera 是可读取的 three.Camera，持久真相仍是序列属性。作者修改相机不会悄悄改文档。场景根由宿主应用片段空间变换一次，再由序列摄像机投影；合成器不得对这个全屏场景纹理再次投影。
- 新增 info.space 给新 API 的作者入口，包含当前样本的相机、时间和只读 project(point) 数值工具。单独 createWebGL/createWebGPU 保持原用途，作者可读镜头做标签/自定义内容；只有 createThree 声明为 worldScene，不能靠是否访问 info.space 猜输出类型。
- 旧作者 API 4–7 和 ticket 10 的 API 8 按各自行为运行，不能在旧作品打开时自动启用新场景入口。API 9 为本票候选编号，最终由 Claude 在合并 API 8 后确认；新增 API 的版本门槛、声明读取、类型检查、编译器和运行时一致。
- 宿主 update 的 sourceTime 由正式时间映射得出；动画用 mixer.setTime，不累加 delta，不读 Date.now/performance.now，不用 TAA/跨帧累积。缓存未命中时相同请求不依赖之前渲染过哪帧。
- three 对象、材质、几何和渲染器在实例生命期复用；warmAuthor 阶段等待异步初始化并 compileAsync，未来将出现的对象也预热。首次 draw 不执行安装、下载或动态建大场景。媒体只通过现有作者资产参数/宿主解析进入 Worker，本票无 model/environment 新导入类型。

### 6.2 三路对比与采用门槛

| 路线 | 实现与报告名称 |
| --- | --- |
| G：现有 WebGL 拷贝 | 原型先使用现有 createWebGL + three.WebGLRenderer，宿主 OffscreenCanvas 每样本 copyExternalImageToTexture。正式 createThree 将该生命周期收进 B，先作为可工作的基线。不得把 GPU 画布拷贝称作 CPU readback。 |
| W：共享 device，中间 RT | three.WebGPURenderer({device}) 渲染到自有 RT，经同设备输出转换/必要拷贝写宿主层目标。记录实际 copyTextureToTexture 次数；这是零 CPU 读回，不称零拷贝。 |
| Z：共享 device，外部目标 | r186 backend.setXRRenderTargetTextures 在小型版本锁定适配器中绑定宿主目标；scene pass 或最终颜色转换 pass 直接写目标。零拷贝指无跨上下文导入/无额外纹理复制，不代表没有 MSAA resolve、后期 pass 或内部 RT。属于内部后端 API 原型，不能仅凭方法存在认定可生产使用。 |

- G 是第一条样片路径。W/Z 与 G 使用相同场景、镜头、分辨率、颜色契约、质量和时间序列；G 满足成片与实时门槛时不因“零拷贝更先进”立即替换。G 不满足预算时，采用已验证最快且满足像素/生命周期要求的路径；Z 失败时保留 W，不能退回 CPU 逐帧读图。切换由宿主能力决定并写诊断，不新增用户设置。
- 三维网格输出的色调映射由宿主控制；原型用 Neutral，中性图文卡片不经过 tone mapping。输出明确为合成器的预乘 SDR Rec.709 gamma 2.4；linear/sRGB/Rec.709 分别处理，不只改标签。浮点和发光信息沿现有 highPrecision/carriesLight；WebGL 8 位输出无法保留超白的事实单列，不能与浮点路径假称等价。
- 先单独验证无色调映射的灰阶、饱和色、半透明边缘和零 alpha 发光，再做带材质画面；跨后端的网格画面以项目可接受的数值/视觉差异判定，平面精确门槛不放宽。
- 宿主拥有 GPUDevice、目标纹理和队列生命周期；three 只销毁自身 RT/材质/几何。外部纹理不得被 dispose 销毁，不把 GPUTexture 跨 Worker 消息发送。目标格式、usage、尺寸、sampleCount、depth attachment、viewport 和 resolve 关系必须匹配；8→16 位/尺寸变化时重绑 target，不能只复用旧 framebuffer 缓存。
- r186 外部 device 不由 backend.dispose 销毁，但 init 会赋值 device.onuncapturederror。适配器在初始化时协调原错误处理，串行初始化并恢复/转发到宿主日志；多实例不能互相覆盖卸载。设备丢失由根渲染 owner 统一废弃全部旧图片/任务，重建使用同一新 device。渲染成功仅在验证/提交成功后发布，取消的旧帧不得覆盖当前帧。
- GPU 内提交使用队列顺序和已有 completion/lease；不每帧 await 全队列。MSAA、深度与后期 RT 都计入 videoEditGpuBudget。4K RGBA8 一张约 31.6MiB，RGBA16F 约 63.3MiB；三张后者约 190MiB，不能把 three 的内部缓冲漏出预算。预算不足按组复用/串行释放，不设卡片数硬上限。

## 7. 缓存与并行票的接缝

| 并行任务 | 接口与冲突处理 |
| --- | --- |
| [10 文字排版](../10-文字排版/design.md) | ticket 10 负责 henji-layout 2.0、字体和 API 8；本票不修改冻结库或 FontFace/HarfBuzz 生命周期。投影后的最大屏幕密度（含倾斜局部 Jacobian、近裁剪后可见区）交给既有 authorRasterScale/文字栅格入口，按已有档位缓存；不能只取中心 scale 而让近端文字糊。AuthorFrameInfo、author-api.d.ts、AuthorRuntime、指纹、API/格式文件是共同热点，先合 10，再由 B 增量接入 info.space/createThree；必要补丁由文件 owner 合入。 |
| [11 效果合并](../11-效果合并/plan.md)、[12 新效果](../12-新效果/plan.md) | 它们拥有效果定义、注册、参数映射、共享 blur/色调/发光实现。本票消费合并后的 blur 镜头模式和公共计划函数，不写死 lens_blur 旧 ID。videoEditCompositeScene、AuthorRuntime、AuthorEffects、精度与 carriesLight 是冲突点；A/B 只接空间参数，效果内核改动交效果票 owner。 |
| [13 风格件](../13-风格件与技能三档/plan.md) | 本票配方遵循“风格件→内置效果→自己写”；不另造模糊/泛光实现，也不改用户风格件。共同 SKILL.md、author-api、配方索引和格式基线由 Claude 合并；C 只交空间用法。 |
| [14 网页页面时间缓存](../14-网页页面时间缓存/design.md) | A 只输出投影需要的取景/实际栅格倍率；网页时间身份、原生解码、内容校验、取消由 14 的唯一入口处理。摄像机改变不会改变页面时间内容，但可能需要更高像素密度的缓存；不足时按 14 的规则实时取帧，不把低倍率缓存冒充清晰输出。精确观察、无损平面对比及导出沿其 useWebCache 语义。共同 CodeSources/WebInputs/Renderer/预算文件按 ownership 串行集成，不改网页服务或端口。 |
| [15 代码片段输出缓存裁定](../15-代码片段输出缓存/review.md) | 最新批准的是每个工作目标保存最后完整内容键，只在节目预览启用；无历史 LRU、RAM 层或跨 Worker 额度，网页/序列输入暂不启用。A/B 对接此裁定，不恢复早期设计。CodeSources、CodeGpu、Renderer/Compositor、作者指纹是热点，15 owner 先落地，B 提供空间依赖摘要接入同一键。 |

内容依赖分两层：

1. 普通二维作者输出不读取新空间上下文，外部卡片位置/镜头变化只重投影，不强制重跑作者；有效三维栅格密度改变时才重栅格。旧 API 明确没有空间依赖。
2. 新 API 的 createThree 以及能读取 info.space 的原生 GPU/Canvas 入口，保守包含宿主空间依赖：当前相机/投影、焦点/光圈、场景根变换、精确序列和源子时刻、逻辑/物理尺寸、质量与曝光样本。作者的常量 frameKey 不能排除宿主镜头变化。未知依赖跳过复用，不猜测“未使用摄像机”。以后有证据才增加细粒度声明，首期不加配置项。

序列最终帧/预渲染指纹必须包含相机、片段空间数据与嵌套依赖；target 格式和设备归属由资源生命周期管理。向 15 提供实际目标内容已被覆写/clear/resize/dispose 的通知，子帧写过目标后不得把旧中心帧键留着；一次曝光结束后才有完整输出身份。观察请求按 15 的裁定正式渲染，不返回缓存的旧空间观察信息。

## 8. AI 属性、两项算法与结构化读回

### 8.1 通用属性

本票是能力增量。片段的 spatial.enabled/depth/rotation_x/rotation_y/anchor_depth 与关键帧通过 ApplicationFieldDefinition 一次登记；摄像机属性挂在 video_edit.sequence，不新增设置相机、设置深度等同义工具。

公开名称用“靠近/远离画面平面的深度”“向左/右转”“向上/下倾斜”“对焦片段”“主体占画面高度比例”“镜头透视程度”“背景虚化程度”。镜头 intent 作为同一属性的输入适配：例如写 camera.framing={targetRef, heightFraction, perspective} 时确定性解出物理相机字段；只持久化解出的 position/focalLength/focus/曲线，读回同时派生取景指标。毫米和内部矩阵不作为助手完成日常操作的必填输入。原始光学字段可以精确读写，但与 intent 必须委托同一字段转换服务，不分别存两套相机。

相机分布/曲线与片段变更通过同一次通用事务写入。不存在新的审批、路径许可或只读档。自己创作的代码直接运行；外部分享代码读声明、预热和试渲染都沿现有首次信任确认，不因 createThree 新入口绕过。

### 8.2 arrange_video_edit_depth：拉开景深层次

- 输入：documentRef、sequenceRef、clipRefs（有序，从远到近）、referenceFrame、depthSpan（画面高度比例）、focusRef，可选过渡的 sequenceFrame 区间。缺顺序则用现有稳定层序；不猜语义主体，不额外调用模型。
- 在参考帧求出每张卡片的投影位置和尺寸，按顺序分配目标视深；固定焦点卡片的参考平面，调相机/目标深度保证 near 前方。正对镜头时采用解析逆投影补偿：原倍率 k0=F0/(D0−z0)，新倍率 k1=F1/(D1−z1)，局部缩放和相对光轴位置乘 k0/k1，因此参考帧构图不跳。
- 有倾斜/角点贴合时以投影质心和可见包围框为保持指标，用 three 矩阵反投影和小规模确定性求解；不能声称保留全部透视角点。输出实际投影误差与遮挡变化。屏幕角点需完全不变的任务由精确配准能力另行处理，本算法不暗中修改像素。
- 只覆盖指定区间的三维与必要二维补偿曲线，保留区间外原值和边界切线；原有动作按同一求值器烘焙/拟合为普通关键帧。拟合误差按最终输出像素检查，角点最大误差目标≤0.25px；失败返回事实而不是低精度提交。算法无 N 张卡片硬上限，重计算在既有运动 Worker 模式下可取消。
- 返回 changedRefs、焦点、每层 depth/屏幕边界变化、近裁剪/遮挡事实、保存状态和 undoRef。空间位置与尺寸保持是数值保证；透明像素可见性不是凭矩形推出来的保证。

### 8.3 transition_video_edit_space：展开 / 压平空间

- 输入：documentRef、sequenceRef、clipRefs、range（序列帧）、mode=expand|flatten、focusRef、strength。range 必须非空；展开从当前构图出发，压平从当前空间出发；覆盖范围和被改字段在结果中明确。
- 展开：在起点所有卡片保持原二维放置，depth/rotationX/Y 为 0，镜头为参考平面恒等映射；复用上一算法生成目标深度。沿已有 ease/bezier 规则连续展开，摄像机推拉并同步变焦。对选定焦点平面保持 kRef=F/(D−zRef) 不变，始终保持主体取景，其他层产生真实视差；不是把全画面统一缩放。
- 压平：深度和 X/Y 倾斜回到 0，摄像机回到参考平面恒等映射，景深渐变至 0；尾帧明确写规范化零值以命中原二维分支。保留尾帧主体中心与尺寸，其他卡片按参考构图连续归位。压平任意立体/相交内容不保证所有轮廓和遮挡在运动中不变，不能将“主体构图保持”误写成每层全程像素不变。
- 推拉变焦的关系逐时刻成立。算法将解析轨迹用已有普通曲线表示，并在最终输出帧及曝光子时刻核验；不新增保存着旧/新相机两份事实的运行时动画 DSL。相机 hold/目标变化处分段，显式零值和边界不被拟合删除。
- 三维物体的几何和灯光动画属于作者源码；算法操作卡片与序列相机，不遍历或改写任意 JS 场景对象。样片作者以同一时间 progress 让场景根、灯光和材质从平面状态渐入，避免开场替换画面。
- 两项算法都先纯计算、校验完整 patch，再经 editVideoProject/正式原子文档算法守卫一次提交，复用既有持久化 participant 和保存回读；失败保留真实执行/保存状态，重试只重试未完成保存。撤销恢复相机、片段补偿与曲线整批变化。revision 冲突在提交前复核，不把半套空间状态落进去。

### 8.4 verify_video_edit_space：只读几何验证

此查询是投影、裁剪、遮挡分析算法，不是读取某个已有字段的专用工具。输入 documentRef、sequenceRef、frames、可选 clipRefs；结果绑定精确序列时刻和内容身份，分页沿现有结果机制，无人为数量上限。

返回每帧：

- camera：resolvedAim、resolvedFocus、focusTarget、targetActive、focusDistance、near/far、flatIdentity。
- cards：稳定引用、原四角与齐次裁剪后多边形、归一化屏幕 bounds、在画面内比例、viewDepthRange、drawOrder、compoundGroup、cocRadius/range、behindCamera/clipped、景深近似标记。
- occlusion：按同一真实绘制顺序求投影多边形交叠；保留候选遮挡者和覆盖区域。仅已知完整不透明的表面可标为几何完全遮挡；视频 alpha、文字空白、遮罩、半透明效果和作者场景的可见比例为 unknown/estimated，不能以 AABB 重叠宣称肉眼不可见。当前 core/videoEdit 未找到多边形布尔交集/差集入口；候选 polygon-clipping 与 martinez-polygon-clipping 均提供成熟布尔运算，建议前者处理多遮挡面的 union/difference，使用其规范 MultiPolygon 返回值而非手写几何引擎。Claude 串行锁定版本并安装前，C 可用固定几何夹具开发其余读回；依赖未接入不能报告遮挡已实现。
- focus：目标是否存在/活动、目标视深、CoC 和“当前焦点是否落在所选片段”数值结论。
- three：宿主管理场景根的包围盒和层深，可选择在正式渲染后附上事实；不把作者自报 bounds 当像素可见证据，不执行源码来完成纯结构查询。

图像证据复用 observe_video_edit_frame → read_application_media(mode=image)，并核对同一作品版本/帧。纯结构结果只标结构验证；未读取图片不标视觉通过。节目预览、离屏取帧、导出和嵌套必须使用相同空间求值器，不能各自算焦点。

## 9. 原型样片与实测顺序

### 9.1 样片：平面开场，一镜到底展开成三维

- 建议 8 秒、1920×1080、30fps；自有夹具 6 张文字/图片卡片，前中后景明确；一个 three 几何物体，最后再扩展到 20/30 张卡片与 4K。使用新隔离作品根，不读写 D:/视频制作，不接 9334。
- 0–1.5 秒：纯二维排版、卡片 depth=0、相机恒等、景深 0；three 物体从第一帧就预建/预热但透明权重为 0。保留这段的二维真值输出。
- 1.5–4.5 秒：同一张卡片连续拉开深度，主体参考平面占屏比例不变；镜头做推拉变焦并有小幅横移，出现前后遮挡和视差。网格从正面平光姿态渐显，随后侧转露体积，灯光从平光连续变到方向光。无剪切、黑帧、整块突然替换。
- 4.5–6.5 秒：围绕同一主体小幅运镜，再从主体拉焦到前景卡片，前后 CoC 随焦点交换。原型将每个厚网格视为单层中心景深，并在样片说明中如实标明。
- 6.5–8 秒：可用回收运动展示压平，尾帧 depth/rotationX/Y/景深严格归零、相机回到恒等，接原二维输出；用尾帧像素比较验证分支切回没有颜色跳变。样片仍是一段连续镜头。
- 第一个视觉草样可以只用现有 createWebGL 编写同一 three 场景的动画，寻找编译/拷贝瓶颈；它不证明“原生二维卡片逐像素一致”或“宿主共享相机已完成”。A/B/C 集成样片必须用真实时间线卡片、正式算法写入、createThree 和正式取帧再验一次。草样源码不成为第二套生产摄像机/布局实现。

### 9.2 实验与可判定门槛

按顺序一次一个短实验，单次目标≤180秒；耗时超过一分钟放后台。正式实现的 GPU/窗口验证需要隔离产物和资料目录，先确认不会覆盖任何现用 out；不因为要测试而停止或操作 9334。正式性能结论采用生产产物，开发产物只作正确性调试。

| 实验 | 数据与门槛 |
| --- | --- |
| P0 数学核对（本轮已做） | 通过 node stdin 调已有 three 0.186.1，1000 组点、16:9、80mm 验证 z=0 投影和深度补偿。最大归一化误差分别为 1.1102230246251565e−16、1.8041124150158794e−16；前者折合 4K 约 4.2633e−13px。只证明 CPU 代数，未启动 GPU，不是像素/性能证据。 |
| P1 平面真值 | 同设备同请求，空间关闭/恒等开启的编码前帧零差异。源帧固定，字体与上游缓存固定；一旦不为零，先修分流，不用 PSNR 放宽。 |
| P2 渲染桥 | G/W/Z 各做 1080p/4K、预热后 120 帧，分别报告 CPU 提交、GPU 时间（支持 timestamp-query 时）、请求到完成 p50/p95/max，冷编译与稳态分开；取帧读回不进入计时区。没有 GPU 时间戳时不把 queue 等待当作该 pass GPU 耗时。 |
| P3 确定性与恢复 | 固定前序帧序列，执行 0→37→12→37、重复 t、尺寸切换、设备重建、取消迟到；同一路径相同请求逐字节一致。不同后端分列颜色/alpha差异；未验证的设备/驱动不外推。 |
| P4 空间正确性 | 20 张卡片、30 张压力样本；正/背面、跨近裁剪、同深度、换序、透明文字、调整层/转场屏障、嵌套、目标删除/复制；最终样片空间写入→结构读回→真实取帧→撤销→重开均一致。 |
| P5 速度门槛 | 基本交付门槛为 1080p60 连续预览不出现可归因于本票的持续跳帧，单帧渲染 p95≤16.7ms；4K 目标沿调研为桥接场景 p95≤8ms、20 张卡片空间阶段≤10ms，整帧仍应≤16.7ms。分项通过不能冒称整片实时。带 8/16 次曝光单列；不达标报告，不能关闭景深/模糊后声称达到同质量。 |

首次物体出现的额外编译耗时经预热应小于一个目标帧预算；未达到先解决预热与材质准备。Z 的采用条件是正确性/生命周期全部通过且对 G/W 有可重复收益；W 优于 Z 时选 W。每条数据注明 commit、实际 Electron/Chromium、three pin、GPU/驱动、尺寸、质量、采样数、冷/热、缓存状态与其他 GPU 活动。

## 10. 格式、版本与传播清单

- 当前基线：video-edit 内容 46、最低可读 45，code-author-api 7，code-version 8。版本号只是现状；ticket 10/13/14 可能先升级，正式号由 A/Claude 基于最终 main 递增，禁止各线抢写固定 47/9。
- spatial 与 spatialCamera 仅新增可选数据，省略时严格保持旧二维行为；此增量自身按 persistence.md 升内容版本、保留最低可读版本。createThree/info.space 新作者 API 会使旧运行时不能正确执行，因此包含新 API 的登记格式需要跟随正式 API 支持升级最低可读版本；不得仅凭新增字段可选就忽略 apiVersion 最大值变化。
- 核对并按实际 schema 传播升级：[schemaVersions.ts](../../../Henji-AI-t16/src/core/persistence/schemaVersions.ts)、[documents/kinds/videoEdit.ts](../../../Henji-AI-t16/src/core/documents/kinds/videoEdit.ts)、[codeMaterialPersistence.ts](../../../Henji-AI-t16/src/core/videoEdit/codeMaterialPersistence.ts)、[codeAsset.ts](../../../Henji-AI-t16/src/core/videoEdit/codeAsset.ts)、[documents/kinds/screenRecording.ts](../../../Henji-AI-t16/src/core/documents/kinds/screenRecording.ts)、[formats.ts](../../../Henji-AI-t16/src/core/persistence/formats.ts)、[formatMigrations.ts](../../../Henji-AI-t16/src/core/persistence/formatMigrations.ts)。录制内嵌剪辑、可编辑代码资产、代码版本、模板/风格/样片的作者 API 固定字段以及包内嵌作品是直接消费者，不能只升级 .hjvid 外壳。
- 原生模板 pick/strip（document.ts 的 videoEditNativeTemplateClipSchema）目前会丢掉新增空间字段；复制空间卡片进入模板须明确保留属性及需要的序列相机，或者保留为空间不相关的平面模板并显式拒绝有损保存。首期采用保留：模板 content 增加可选相机快照，导入时在独立嵌套序列中保留空间关系，避免覆盖目标序列现有相机；模板/风格包相关格式由 A 与 13 串行整合。
- 各 N→N+1 迁移为纯函数：旧作品不插入相机、不补写三维开关、不改旧源码/库 pin、不改已有曲线。打开只内存升级，沿已有备份入口备份原件，明确保存才写回；不新增数据搬迁/目录格式。
- 当前 UI 不改，但所有持久内容出口需核对：普通保存/重开、撤销/重做、剪切/复制/粘贴、分割/修剪/改帧率、序列复制/嵌套、代码资产与风格模板、整项目/单文档包、录制内嵌剪辑。相机引用和曲线时钟必须随这些操作传播，不能靠 JSON spread 假定完整。
- tests/fixtures/persistence 中保留全部已发布样本；新样本通过正式构造器生成，包含平面旧片、空间卡片、相机曲线/目标、空间作者 API、内嵌作品与模板往返。完成精确迁移/读写测试后再由 A 串行更新 schemaBaseline.json、releasedCompatibility.json；不改已有样本摘要。
- 不改变 .hjstg、cameraStage 状态关键帧、R3F 或旧镜头参考渲染器；不引入独立 SpaceScene 文件格式，也不把已有“片子数据 scene”误当三维场景格式。

## 11. 实施验证、资源与失败语义

- 本轮 L0：核对计划优先级、真实代码入口、相邻票最终裁定、外部资料链接、CPU 数学实验和输出路径；不跑 lint/tsc/Vitest/构建。不存在实现通过或 Claude/审查员已批准的声明。
- 实现 A 的格式/共享合成、B 的共享 GPU/作者契约、C 的事务/保存均至少 L2。精确测试围绕投影与排序、格式/引用传播、时间映射、取消迟到/纹理所有权、缓存失效、公共写入/读回/撤销，不抄字段表数量。src/core 改动执行双工程 tsc，按实际改动跑 dependency-graph、persistence-compat、assistant-capabilities；verify:changed 显式列本票文件并先 dry-run。
- 作者 API 核心公共契约正式集成满足 testing.md L3 条件，由 Claude 在三线合并后的完整边界执行一次；不让三线各跑全仓。新行为仍在原型时先用可视/数值实验，用户确认路线后再保留稳定回归测试。构建只为更新运行产物时 electron:bundle，性能正式产物安排与其他票串行。
- 新数值逻辑覆盖透视/逆投影、参考平面、相机运动、近裁剪、同深度排序、子帧换序、焦点丢失、非方形像素；新状态测试覆盖目标 resize/precision promotion/dispose、共享 device 丢失、旧样本取消、缓存同键与实际覆写、保存失败只重试落盘。
- 正式空间能力测试从 describe/change/read 与领域状态源验证；真实模型经现有 assistant:cli 和独立测试工程完成至少一次自然语言“展开、对焦、压平、撤销”的闭环；外部 MCP 用同源正式调用验证工具契约。模型调用按现有付费策略，不扩大额度；不能以 schema 测试替代模型实际使用。
- 日志复用 createLogger、现有帧阶段计时/GPU诊断和 logs:query。空间规划/提交/保存、作者初始化/预热/渲染失败记 start/completed/failed；逐帧投影、实际后端、拷贝次数、样本数和纹理字节只在 debug/trace。正式节目界面不显示内部矩阵、revision、纹理或缓存计数。
- 输出只有成功完成且身份匹配才发布；取消/切序列/关闭实例后旧 GPU 完成不能提交新画面。借用图片等已有 completion 结束后释放；不能以 catch 后继续用旧纹理伪造精确观察/导出成功。普通预览允许的旧帧策略沿宿主原行为，真实取帧必须报告来源是否就绪。
- 实现提交前按 AGENTS.md 做干净上下文审查，交文件/diff、任务目标和相关规则，最多三轮；本轮设计不代替 Claude 与指定审查员审批。本文没有创建 review/result/总结文档。

## 12. Claude 与审查员需要裁定的点

1. 批准首期边界：单一序列摄像机、合成屏障内稳定深度排序、场景层与卡片不做像素级交叉穿插、倾斜卡片/厚场景采用同一中心深度景深并明确读回近似。若要求完整逐像素透明景深或跨层深度融合，须先扩大渲染方案，不能边实现边隐瞒精度差别。
2. 批准 createThree 受管入口与候选 API 9，确认接在 ticket 10 的 API 8 之后；确认 A/B/C 文件 owner、11/12/13/14/15 的热点文件集成顺序和格式传播。确认多边形读回依赖候选 polygon-clipping；该依赖及 three 数学稳定导入若需 package 映射，仅由 Claude 主工作区串行安装。
3. 批准 80mm、36mm 横向画幅、1 世界单位=1m 的原型标定与第 9 节验收目标；这些是设计起点，不是实机结果。正式后端按样片数据选 G/W/Z，零拷贝内部接口未通过门槛不进入默认路径。

## 13. 官方资料与采用边界

- [three PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)：FOV、filmGauge、near/far、焦点参数的语义。宿主显式处理横向传感器和画幅，不依赖默认值。
- [three WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)、[Renderer](https://threejs.org/docs/pages/Renderer.html)：后端、MSAA、输出格式、coordinateSystem、离屏输出色调语义。离屏 RT 不应被误当已完成显示转换。
- [r186 WebGPUBackend](https://github.com/mrdoob/three.js/blob/r186/src/renderers/webgpu/WebGPUBackend.js)，init、setXRRenderTargetTextures、dispose：外部 device、XR 外部目标绑定、错误回调和释放行为。本机 node_modules/henji-author-three-0.186.1 源码同样只读核对；外部目标仍需真实 Worker 原型证明。
- [r186 DepthOfFieldNode](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/tsl/display/DepthOfFieldNode.js)，构造参数与 setup：艺术 CoC 与 alpha 中间语义。作为成熟方案调研依据，不在首期把它直接贴到透明层。
- [WebGPU 坐标与裁剪](https://www.w3.org/TR/webgpu/#coordinate-systems)、[纹理拷贝](https://www.w3.org/TR/webgpu/#texel-copies)：齐次裁剪、纹理格式与 usage 等约束。投影正确不等于采样和混合逐像素相同。
- [VGPU 官方 context](https://raw.githubusercontent.com/vercel-labs/vgpu/main/docs/topics/concepts-context.docs.md)、[性能模型](https://raw.githubusercontent.com/vercel-labs/vgpu/main/docs/topics/performance-model.docs.md)：长期复用 context/资源、资源身份与绑定缓存、target 的格式/深度/MSAA。本会话没有 vgpu MCP，vgpu.sh/docs 读取失败后已查官方仓库；本票复用现有封装，不据新版文档擅自替换项目 VGPU API。
- [polygon-clipping 官方仓库](https://github.com/mfogel/polygon-clipping)、[Martinez 官方仓库](https://github.com/w8r/martinez)：两者均为 MIT，支持交/并/差等运算；前者作为本票新增依赖候选，不把上游性能宣传当本机数据，安装前用本票近共线/重边/多遮挡区域夹具核对。没有在联接点 node_modules 做任何写入。
- 本票采用现有 three（MIT）与宿主合成/效果内核；不新增 Babylon、R3F、Theatre、camera-controls、BVH、glTF Transform 或新的排版/物理依赖。前三类会复制已有渲染/动画职责，后几类属于本票未包含的人工导航、拾取与模型导入。依赖安装由 Claude 在主工作区串行处理。

## 14. Claude 裁定（11-01）
1. 批准首期边界：单一序列摄像机、合成屏障内稳定深度排序、场景层与卡片不做像素级穿插、倾斜卡片与厚场景用同一中心深度景深并在读回里写明近似。
2. 批准 createThree 受管入口；作者 API 与 ticket 17/18 共用 API 9（谁先合并谁登记，API 9 未发布前其余直接扩充）。A/B/C 文件所有权与热点文件集成顺序按第 3、7 节；polygon-clipping 由 Claude 在主工作区安装（MIT，纯 JS），各线合并 main 后使用。
3. 批准 80mm、36mm 横向画幅、1 世界单位 = 1m 的原型标定与第 9 节验收目标；正式后端按样片数据选，零拷贝未过门槛不进默认路径。
4. 用户不看样片：原型样片由 Claude 按用户画面口味目视验收后直接往下做。
设计先交 Opus xhigh 审一轮（架构级），审完三条线同时开工。
