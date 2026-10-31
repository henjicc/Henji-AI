摘要：图层 effects 按作者时间求值，复用宿主内置 GPU 工序，在局部栅格之后、位姿变换与合成之前执行；henji-effects 只生成描述。
摘要：登记表是参数、类型、校验与外扩规则的唯一来源；沿用作者库冻结发行、两种帧指纹、正式取帧观察和公共能力入口。
摘要：本文为待 Claude 审查的设计，不授权实现；风格包预设来源、发光跨片段合成边界及链中第二输出的后续处理须先裁定。

# 05 图层效果链与 henji-effects

## 0. 设计边界

- 基线：`D:/VibeCode/Henji-AI-t05`，分支 `task/05-图层效果链`，提交 `2f49fd3c8`。完整代码路径相对此工作树；为缩短表格，`engine/`、`application/` 分别指 `src/features/videoEdit/engine/`、`src/features/videoEdit/application/`，`core/` 指 `src/core/`，技能 `references/` 指 `resources/assistant-skills/video-edit-code-creation/references/`。只写文件名时沿用本节已给出的完整路径；标注“新增”的文件、函数、字段是拟议落点，不是现有能力。
- 范围和验收以同目录 `plan.md` 的 1–7 为准；效果语义以 `D:/VibeCode/Henji-AI/docs/task/代码效果与渲染改进/效果库.md` 的“已定的决定”“效果样板：发光”“代码设计”1、3、4、5、8 为准。发光和色差复用 `eefb5173b` 的实现。
- 本次交付只写本文；不修改代码、计划或规则，不提交、不推送、不构建、不运行 Reality，不访问 `D:/视频制作`，不连接或操作 9334 开发版，不删除或重装联接的 `node_modules`。
- 实现须在 Claude 审过本设计、明确第 10 节裁定后开始，并满足计划中的 ticket 03 合并前置条件。与 ticket 06 相邻的分辨率参数采用本文明确的逻辑尺寸/实际栅格尺寸契约，不各自推导。
- 不做逐点融合、跨效果金字塔共享、距离场、工序级局部缓存优化、新投影/描边/扫光/溶解效果、调整层、风格件旋钮、元素效果面板和性能基线测量。
- 选型：使用项目既有 `VideoEditBuiltinEffectsGpu`、`planGaussian`、`planGlow`、`chromaticAberrationPass` 和作者 lens shader；使用已有 TypeScript AST 做静态检查。不另引入效果框架、GPUDevice、Worker 或通用脚本执行入口。

## 1. 唯一声明、作者接口与版本

### 1.1 效果登记

在 `src/core/videoEdit/builtinEffects.ts::VideoEditBuiltinEffectDefinition` 增加作用空间和外扩声明。`src/core/videoEdit/effectsRegistry.ts::videoEditEffectsRegistry` 只投影，不建立第二张业务参数表。

| 声明 | 决定 |
| --- | --- |
| `space: 'layer' \| 'frame' \| 'clip'` | `layer` 可用于图层和原有片段链；`frame` 只在整幅画面上下文执行；`clip` 依赖片段媒体/宿主上下文。缺少声明的旧条目按原片段能力运行，不能因此自动开放到图层。声音条目不进入图层目录。 |
| `bleed(params, reference)` | 返回非负有限的四边对称保守外扩，单位是参考高度的比例；`reference` 明确逻辑画幅、未外扩 bounds、实际栅格比例、质量及取样网格。外扩与 GPU 规划使用相同纯数值推导，不从渲染层反向导入到 core。 |
| 作者工厂名/方式映射 | 在同一效果声明登记，用于生成 `glow`、`blur` 等导出名及模糊方式分派；不得在作者库另抄参数表。 |
| 参数 | 继续使用 `ImagingParam` 和 `effectParam`；默认值、硬范围、软范围（存在时）、单位、分组、说明、`visibleWhen`、`animatable` 全部从原声明投影。 |

首批范围：

| 作者入口 | 权威定义与执行函数 |
| --- | --- |
| `glow(params?)` | `src/core/videoEdit/glow.ts::GLOW_EFFECT_DEFINITION` → `src/features/videoEdit/engine/glow.ts::planGlow`；包含色差继续用 `effectIncludes.ts::includedEffectParams/includedEffectValues`。 |
| `chromaticAberration(params?)` | `src/core/videoEdit/chromaticAberration.ts::CHROMATIC_ABERRATION_DEFINITION` → `engine/chromaticAberration.ts::chromaticAberrationPass`。放射中心是图层局部内容中心，不能随 padding 移动。 |
| `blur({ mode, ...params })` | 一个作者工厂，方式为 `gaussian/directional/radial/lens`；均匀转 `gaussian_blur` 的 `sigma_fraction_height/axis/edge_mode`，方向转 `directional_blur`，放射转 `zoom_blur`；镜头把 `videoEditAuthorGpu.ts` 中既有 96 点 shader 纳入共享工序。 |
| `sharpen(params?)` | `builtinEffects.ts` 的 `sharpen` → `videoEditBuiltinEffectPasses.ts::planVideoEditBuiltinEffect` 的反锐化路径。 |
| `colorGrade(params?)` | `src/core/videoEdit/colorGrade.ts::VIDEO_EDIT_COLOR_GRADE` → `src/core/imaging/adjustments/plan.ts::planColorGrade`；LUT 仍是项目已导入的引用。 |
| `blackWhite()`、`mosaic(params?)` | `builtinEffects.ts` 的 `black_white/mosaic` → `planVideoEditBuiltinEffect` 对应分支。黑白现无独立参数，不虚构数量旋钮。 |

模糊方式元数据复用已有参数定义；`blur()` 返回对应内置 ID 的描述，`mode` 是工厂选择方式，不把它塞进旧效果的 params。lens 的参考高度半径在登记层声明，算法仍只有既有一份。此票不顺带删除/合并其他面板条目或改图片编辑的高斯语义。

### 1.2 作者层契约

落点：`src/features/videoEdit/engine/videoEditAuthorModule.ts::AuthorLayer`、`resources/video-edit-author/author-api.d.ts::AuthorStaticLayer/AuthorPosedLayer`。

```ts
// 设计契约：实际判别联合由登记表生成。
type EffectDescriptor = BuiltinLayerEffectDescriptor | LookDescriptor
interface LookDescriptor { readonly id: 'look'; readonly params: { readonly name: string } }
// AuthorLayer 增量
effects?: (time: number) => readonly EffectDescriptor[]
```

- 工厂只返回 `{ id, params }`，不获取设备、不做 I/O、不执行 shader，不返回纹理。params 可以省略项；宿主执行前补齐默认值。
- `effects(t)` 与 `draw/pose` 使用同一作者素材秒数，接受内部剪切、变速和源起点换算后的 `info.time`，不使用序列绝对秒数或真实时钟。
- 本票与现有 draw/pose.blur 一样，在中心时刻计算像素内容和效果；运动曝光仍用 `authorLayerSamples` 在快门区间取位姿。不会为每个快门样本重做整条效果链。中心 pose 不可见而快门内可见时，沿现有中心/可见样本回退规则确定本次兼容 blur。
- 每次求值都验证；`undefined`、`null`、异步 Promise、非数组、非法描述报具体层和字段。未声明或返回 `[]` 表示没有作者效果。允许动态换序、增删和重复效果。
- 同一帧效果只求值并归一化一次，渲染、外扩、缓存、观察使用这份结果。工厂返回值可复用，宿主不原地补默认值或改写它。
- `src/features/videoEdit/engine/videoEditAuthorDeterminism.ts::deterministicLayer` 增加 `effects:<layerId>` 包装，保留 `this`，同时间同种子；全局共享模块不得持有当前工程/预设环境。
- 有 effects 的层，即使没有 pose，也独立栅格；bounds 可省略并默认作者画幅，有 pose 的层继续要求 bounds。缺省 bounds 的成本在技能中说明，不新增强制容量限制。

### 1.3 类型生成与冻结发行

类型基线必须按真实实现处理：`resources/video-edit-author/author-api.d.ts` 是**手写宿主声明**，现无生成脚本。`videoEditAuthorTypeEnvironment.ts::AUTHOR_TYPE_ENVIRONMENT` 以 `?raw` 将它打包进检查 Worker；`videoEditAuthorApiContract.test.ts` 对它与 `videoEditAuthorModule.ts` 做字段及兼容关系核对。它不是 `resources/author-libs` 的发行文件。

新增 `scripts/generate-author-effects.ts::generateAuthorEffects`，只从 layer 效果声明生成：

1. `src/core/videoEdit/authorEffects.generated.ts`：宿主使用的精确描述联合与参数类型；不生成 GPU 实现。
2. `resources/video-edit-author/author-effects.d.ts`：作者公共描述类型，由 `author-api.d.ts` 引用；`videoEditAuthorTypeEnvironment.ts` 和 `videoEditAuthorTypeCheck.ts` 将该文本装入同一虚拟类型环境，保证无库导入时手写描述也有类型。
3. `src/features/videoEdit/authorLibraries/effects.generated.ts`：工厂导出与方式映射的薄生成代码；不复制算法。手写的 `effects.ts` 仅保留 `look` 和必要胶水。

生成器提供 `--check`，比较按稳定顺序生成的字节与已提交产物。生成文件禁手改；JSDoc 写每项中文名称、硬/软范围、单位、组、默认值、说明及显隐条件。不把连续数值范围编码成巨大的 TS 字面量联合。

冻结落点：新增 `scripts/freeze-effects-library.ts::freezeEffectsLibrary`，复用 `scripts/lib/frozenAuthorLibraries.ts::assertNewFrozenAuthorRelease/readFrozenAuthorRelease` 的不可覆写和散列核对。首发 `henji-effects@1.0.0`，保存到 `resources/video-edit-author/frozen/henji-effects/1.0.0/`，含 `index.mjs`、`types.json`（内含 `index.d.ts/package.json`）、`release.json`、LICENSE。冻结声明也从上述登记生成结果导出，不从当前宿主宽类型冒充某一历史版本的类型。

现有解析/发行路径保持唯一：

- `src/core/videoEdit/codeMaterial/authorLibraries.ts::AUTHOR_LIBRARIES` 登记 `henji-effects` 根导入到 `index.mjs`，最低 API 版本为本票新版本；`resolveAuthorLibraryModule`、`authorLibraryImportTable` 同时处理静态和动态导入。
- `src/features/videoEdit/engine/videoEditAuthorBundle.ts::bundleAuthorFiles` 复用现有库解析，产出 `henji-media://author-lib/henji-effects/1.0.0/index.mjs`；运行时仍由 `videoEditAuthorModules.ts::prepareAuthorModuleUrls` 准备作者模块。
- `scripts/build-author-libraries.ts::buildRelease` 只核验并复制冻结文件，发行位置为 `resources/author-libs/henji-effects/1.0.0/`；不在日常构建重新冻结，不发布 npm 包，不重装依赖。
- `videoEditAuthorTypeEnvironment.ts::readLibraryTypes` 和 `videoEditAuthorTypeCheck.ts::createAuthorTypeChecker` 按锁定版本加载 `types.json`。冻结类型缺失必须沿现有路径报错，不能退成无类型库。
- 新版本创建继续由 `latestAuthorLibraryVersions` 选兼容发行；已有版本由 `CodeMaterialVersion.libraries` 钉住，读取不升级。算法改进不改工厂版本；参数含义变化另发冻结版本，并由宿主按库契约解析，不覆盖旧产物。

### 1.4 静态与运行时参数校验

- TS 检查负责未知工厂、错误字段与值类型、枚举；`videoEditAuthorTypeCheck.ts::createAuthorTypeChecker().check` 增加登记驱动的常量诊断，检查 henji-effects 导入别名、namespace 调用、可求值常量和直接 descriptor 字面量的数字硬范围。JSDoc 本身不能产生越界错误，不能把这项宣称为 TypeScript 原生能力。
- 常量诊断只读取 AST/类型信息，不执行作者代码；无法静态确定的表达式明确交给运行时。JS 的既有 `@ts-check/@ts-nocheck` 规则保留，不能声称未检查的 JS 已有类型证明。
- 新增 `src/core/videoEdit/authorEffects.ts::resolveAuthorEffects`，依次展开 look、核验 `space`、调用 `builtinEffects.ts::normalizeVideoEditBuiltinParams`，禁止仅用会漏检的 `resolveVideoEditBuiltinParams` 处理作者输入。错误给出层 ID/序号、效果序号、参数键、合法硬范围/选项及源码定位。
- 软范围之外、硬范围之内必须接受；`NaN/Infinity/null`、未知键、越过硬范围必须报错，不截断、不丢弃。预设引入的 params 走同一校验。

### 1.5 持久接口

- `src/core/videoEdit/codeMaterialPersistence.ts::CODE_AUTHOR_API_VERSION/codeAuthorApiVersionSchema` 从基线 6 升下一版（本基线为 7），effects 与新库要求该版本；旧版本源码与 libraries 不重写。
- `src/core/persistence/formats.ts` 的 `code-author-api`、`formatMigrations.ts`、兼容基线与黄金样本同步。凡嵌入 apiVersion schema 的代码版本、代码资产、剪辑和录制容器，按实际 schema 指纹补相应格式版本及逐版本迁移；不能只改常量跳过外围格式门禁。最低可读版本按“新接口不能被旧宿主正确执行”判定，不套用普通可选展示字段的规则。
- effects 函数和描述保存在正常作者源码；运行时解析、外扩、纹理、指纹都不另存工程字段。`pose.blur` 的 GPU 替换遵循用户明确的“人眼无差别”决定，保留旧输入语义；不能借旧发光无迁移例外删除旧作者接口。

## 2. 宿主执行与资源归属

### 2.1 执行点

`src/features/videoEdit/engine/videoEditAuthorRuntime.ts::VideoEditAuthorRuntime.renderFrame` 的图层循环负责：

`layers → 中心 effects/pose 求值 → 规范化描述 → 外扩与栅格尺寸 → draw 录制/复用 → 局部纹理上传 → 效果链编码 → 最终纹理 mip → 位姿/曝光取样 → 下方贡献与主图层合成`。

具体插入位置是现有 `let picture = surface.texture` 起的 gaussian/lens 分支，至生成 `poses` 和 `this.layers.draw(...)` 之前。该分支收敛为一次图层效果执行，不增加第二个作者绘制入口。

- `stillRun/stillGroup` 的区间边界增加“声明了 effects”；效果回调本帧返回空数组也不把此层重新并回静态批组，避免空/非空切换改语义和抖动。
- `observeElements` 与 history slot 的独立层判定同步修改，不能渲染按独立层、观察仍按 still slot 找数据。
- 普通无 effects 的静态层维持批量绘制。效果层的 draw 采用与已有 pose 层一致的隔离画布语义；不再让它读取另一层画布内容。普通无效果层原有跨层 Canvas 合成不改变。
- `surface/content` 分离两份身份：原始栅格内容键不含动态效果参数；效果输出键含原始纹理内容版本、归一化有序描述、LUT 内容身份、格式、尺寸、质量和效果实现版本。仅参数变化不重画 draw，仅 pose 平移/旋转变化不重做效果；跨栅格档位才重栅格。

### 2.2 复用 builtin，而非逐效果调用 builtin()

`src/features/videoEdit/engine/videoEditCodeGpu.ts::builtin` 是片段级分配、计数和提交外壳。实际共用的是 `videoEditBuiltinEffectPasses.ts::planVideoEditBuiltinEffect` 与 `videoEditBuiltinEffectsGpu.ts::VideoEditBuiltinEffectsGpu.execute`。

将后者拆成“准备资源”和“向调用方 encoder 编码”（新增 `preparePlan/encodePlan`）；原 `render/renderTransition` 保留外壳并调用它们。新增 `engine/videoEditAuthorEffects.ts::planAuthorEffectChain/encodeAuthorEffectChain` 只负责按描述顺序连接已有工序、分配主/副输出与处理缓存，不重写效果算法。

- `VideoEditAuthorGpu.begin/finish/abandon` 持有帧 encoder；图层效果和该层 mip、合成都向这一 encoder 编码，最终 finish 一次提交。不能在它尚未提交的 mip 之后调用会先提交的 `VideoEditCodeGpu.builtin()`。
- 片段入口也改用共用 encode 内核，但不顺带实现整条片段链合并。图层一条链一次提交的验收不等于所有素材上传/整帧其他任务只允许一次 queue 操作。
- 同一提交内 uniform buffer 槽按整条编码批次递增；不能每个效果从 index 0 重用 `uniforms[index]`，否则后续 writeBuffer 会覆盖先前未执行的 pass 参数。
- scratch 的占用集合覆盖整条编码批次，输出/待采样资源到最后一次读取前不归池；只在不再读取后进行 ping-pong 复用。不能每个效果各建 taken 集合导致读写同纹理。原输入与当前输出始终不同纹理。
- 纹理由宿主预算分配器归属，缓存和中间资源按格式计字节，线性光中间至少 rgba16float；高斯 final 继续允许它原有 rgba32float。设备真实尺寸/格式约束报具体失败，不加固定图层数或效果数上限。
- `VideoEditAuthorPrograms.instance/dispose` 与 `VideoEditAuthorRuntime.dispose` 释放新增效果资源；`abandon` 不发布内容键、不留下可命中的半帧结果。管线/LUT 预备失败、设备丢失、切工程和取消走原渲染错误与生命周期通道。
- `VideoEditCodeGpu.authors/builtins` 向作者运行时注入共用执行服务，主进程不参与像素处理。底层资源池不允许同时供并发编码批次无租约使用。

## 3. 空间、外扩与分辨率

### 3.1 唯一换算

定义 H 为作者逻辑画幅高度、B 为未外扩局部 bounds，q 为 `authorRasterScale(need, limit, live)` 的栅格档位；s 为实际输出相对作者画幅的缩小比例。可安全缩小的层 `r=q*s`；直接绘制/无法换算 filter 的层沿现有规则 `r=q`，只在合成时缩小。

- 效果的空间比例 p 对应局部作者长度 `p*H`，纹理长度 `p*H*r`。这里的 H 不是图层高度，也不是加了 pad 的纹理高度。图层尺寸、padding、预览分辨率都不改变作者参数含义。
- 局部纹理宽高 `ceil(B.width*r)+2*pad`、`ceil(B.height*r)+2*pad`；内容原点为 `(pad,pad)`。效果发生在局部坐标，随后才应用 pose、元素 override 和输出缩放；内容和所有副输出使用同一矩阵、opacity、clip、曝光权重。
- `videoEditAuthorLayers.ts::authorRasterScale` 继续选档。`videoEditAuthorRuntime.ts::renderFrame` 对设备纹理限制的计算须连同实际档位 padding 一起验证，不能只减一次 unitPad 再假定放大后仍装得下。
- 合成矩阵继续使用 `1/r` 与 `B.x-pad/r、B.y-pad/r` 的原点修正，不能让外扩挪动标题。`clip` 保持作者画幅坐标中的合成裁切，自动外扩不突破作者显式 clip。

`planVideoEditBuiltinEffect` 新增明确的局部上下文（可选、原片段调用默认原语义）：逻辑 referenceSize、未外扩 contentBounds、rasterScale、rasterOrigin、quality；输出纹理尺寸单列。不能仅传已有 referenceSize 就宣称完成：基线中 glow、方向模糊、锐化、马赛克等仍直接用输入纹理 height，高斯还会按 output/reference 比例二次换算。

具体落点：

- `engine/glow.ts::glowLevels/glowLevelWeights/planGlow` 分开“物理纹理大小”和“参考高度在纹理中的长度”；光核、含入色差、抖动定位使用同一坐标上下文。
- `engine/chromaticAberration.ts::chromaticAberrationPass` 把局部中心映射到 padding 后纹理，方向偏移仍是 `p*H*r`；放射 UV 使用未外扩 bounds 的归一化坐标。
- `engine/videoEditBuiltinEffectPasses.ts::planVideoEditBuiltinEffect` 的高斯/方向/放射/锐化/马赛克使用上述上下文；高斯在适配器直接算 sigma，再调用既有 `planGaussian`，不改 `core/imaging/effects/gaussian.ts::resolveGaussianPlan` 的图片文档语义。
- 片段调用继续接收 `renderVideoEditCompositeScene` 传入的 logical referenceSize，验证默认上下文逐像素保持已有行为。导出实际尺寸由 ticket 06 提供，本票不从 `info.renderScale` 再猜一次。

### 3.2 bleed 和档位

新增 `src/core/videoEdit/authorEffects.ts::authorEffectBleed` 和 `videoEditAuthorLayers.ts::authorEffectPadding`。先按顺序累计采样支撑，再量化分配边距；效果参数和可见半径本身不量化。

- 单效果声明必须覆盖真实采样支撑：高斯取规划 halo（包含降/升采样）；方向取两道线核的总支撑；镜头取圆盘与 mip 支撑；色差取最大通道偏移；发光取各实际金字塔分支的累计支撑、长宽比旋转投影和包含的色差，不能仅取 UI radius；锐化包括低通支撑；纯逐点效果为零。全能调色包含去噪/模糊/锐化，复用 `src/core/imaging/adjustments/plan.ts::colorGradeSpatialSupport`，不能把整个 color_grade 当零外扩；马赛克边界按实际像素块取样支撑。
- 主链连续两个邻域效果的边距相加，不能取 max；副输出按产生它的前缀累计，最后取所有输出所需边距的最大值。放射模糊支撑与 bounds 相关，先在未外扩内容坐标计算，不能随 pad 自增形成循环。
- 量化沿 `authorLayerBlur`：保留 2 栅格像素保护边；非零支撑从 16 起向上取 2 的幂。声明 effects 的层空链时也保留最小档，减少 0→非零重分配。边距足够后，还按降采样网格的 alignment 向外对齐，采样中心锚定内容坐标。
- 同档参数动画只更新 uniform；跨档改变尺寸时重新栅格，但内容原点/抖动相位/金字塔取样网格不能改变视觉位置。仅按尺寸取整不构成“不会闪”的证明，须做跨档连续帧验收。
- `blurShape` 声明的旧层仍保留原最小 padding 语义。没有效果和 blur 的层不额外付出效果资源。

## 4. 发光第二输出与合成

### 4.1 输出契约

在 `engine/videoEditAuthorEffects.ts` 新增只在渲染 Worker 内流转的 `AuthorEffectOutput`：主图层纹理 `image`，以及可选的有序 `underlays`。每个 underlay 包含纹理/尺寸/格式、色彩域、局部原点及 `blend: 'add' | 'normal'`。本票只生产 add；normal 为投影预留，不提供投影工厂或实现。

- 普通效果只有 image，不分配第二张纹理。glow 的 `view:'source'` 也是单输出；强度 0 时不分配光晕输出。
- `engine/glow.ts::planGlow` 增加“片段单输出/图层拆输出”的内部输出目标选择，共享提取、金字塔、色差及着色。不得把现有 `glow_composite` 的成品图当 underlay，否则原图会被加两次。
- 光晕纹理保存独立线性光能量，不把 alpha 当光强上限；核心发白、dither、blend、source_opacity 的职责须显式拆开。主图层按 source_opacity 处理，光晕按自己的强度处理；层 opacity 同时作用两者。
- 图层输出的 add 与效果参数 `blend:'screen'` 不是同一个开关。默认 add 已定；screen 在拆输出时如何保留其背景相关语义，归第 10 节裁定，禁止静默忽略该参数。

### 4.2 作者层内合成

`engine/videoEditAuthorGpu.ts::draw` 扩展输出混合语义；新增光能合成管线，顺序为“已在下方的作者层 → 本层 underlays → 本层 image”。所有输出使用相同 poses、clip 与输出 scale，不能只给主图层应用变换/透明度。

- add 的颜色是 source + destination，不使用 `one-minus-src-alpha` 衰减下方颜色；光能累加不把承载纹理的任意 alpha 加成遮挡。正常图层仍走预乘 source-over。WebGPU 的颜色和 alpha 混合分量须分别指定，依据 [W3C WebGPU Blend State](https://www.w3.org/TR/webgpu/#blend-state)。
- 基线作者 target 为 rgba8unorm、合成在编码值上；不能仅把固定 blend 改为 one/one 就声称在线性光相加。带光链路采用线性浮点临时累计，显式解码输入，在输出边界编码；普通无效果链路保持原样。
- 不透明原图遮住其下方光晕是“在下方”的明确含义；需保留的核心提亮属于 image 输出，不靠把第二张纹理搬到上方实现。
- 链中多次 glow 保留多个有序贡献，不能后一次覆盖前一次。下方已发光的层被上方普通层遮挡时，光能也按上方 coverage 衰减。

### 4.3 跨片段不能丢第二输出

透明标题作为独立代码片段叠在视频上，是本票应覆盖的场景。只改 `VideoEditAuthorGpu.draw` 不足以满足它：作者内部 target 本身可能全透明，随后 `VideoEditCodeGpu.renderAuthorGenerator` 只返回一张 `VideoEditCodePicture`，最终普通 source-over 仍会把光晕变成有遮挡的薄雾。

采用第 10 节 C1 推荐裁定时：

- `engine/videoEditCodePicture.ts::VideoEditCodePicture` 增加可选的发光贡献附件；`videoEditCodeGpu.ts::renderAuthorGenerator` 把作者层栈中的“覆盖画面”与“剩余光能”一起返回，普通 picture 仍单纹理。
- 作者层栈累计两类信号：覆盖颜色/alpha 与光能。上方正常层出现时，两类已有信号都乘其 `1-alpha`；新 underlay 先叠到下方再被本层 image 覆盖。不能在堆完所有主层后把所有光统一放到最底下。
- `engine/videoEditGpuCompositor.ts::draw` 消费 picture 附件，在实际下方画面上解码、加光、再合成覆盖画面；片段的位移、裁剪、trackingQuad、motionSamples、opacity/fade 对两者保持同一几何与权重。复用几何计算，新增的是混合输出语义，不复制整套片段渲染器。
- `engine/videoEditCompositeScene.ts::renderVideoEditCompositeScene` 的 `normalize/apply/resolveClip`、转场与嵌套序列是必须核对的消费者；所有把 picture 变成单张纹理的路径都必须明确是保留附件还是合法的隔离边界。
- 透明导出若目标格式只能存普通 RGBA，不能声称可无损携带背景相关 add；观察/带背景成片先在真实背景上合成。相关限制及整片非线性滤镜的处理由 C1 明确后实现，不能悄悄丢附件。

### 4.4 后续效果的输入语义

主链执行顺序和副输出生命周期必须分开声明。推荐本票采用“主图像串行，副输出在产生位置记录、最终与该层合成”的契约：后续普通效果处理前一个 image，已经产出的 underlay 不再自动过后续效果；需要模糊/调色后再发光时写 `[blur(...), colorGrade(...), glow(...)]`。该规则不限制效果排序，但 `[glow(...), blur(...)]` 的含义是模糊主体、保留先前光晕。

这项是 C2 待裁定语义，不默认视为已定。若要求后续任意效果同时处理全部历史输出，则必须设计多输出效果图及色彩/alpha适配；不能用“对主纹理和光能纹理各调用一次普通调色”替代，因为普通颜色算子可能改变 alpha、需要直通色或非线性耦合。

## 5. pose.blur 的 GPU 路径与兼容验收

入口仍是 `AuthorPose.blur` 和 `AuthorLayer.blurShape`。`videoEditAuthorLayers.ts::authorLayerBlur` 保留既有数值解释：`radius=(pose.blur/max(abs(scaleX),abs(scaleY)))*r`，subpixel 阈值和镜头/高斯默认选择保持。它不是新的按 H 比例参数；不能直接把旧数字填成 `sigma_fraction_height`。

- `resolveAuthorEffects` 在显式 effects 之后追加内部兼容模糊节点；无显式 effects 的旧层仍只有该节点。观察中注明来自 pose.blur，并列出求值后的半径与 blurShape。
- Gaussian 复用 `planGaussian` 的核、降采样和边缘模式，镜头复用既有 96 点圆盘与亮部加权；两者纳入共用 encode 内核。删除 `renderFrame` 中 Canvas2D blur 的第二张 canvas 路径，删除迁入后不再使用的 `VideoEditAuthorGpu.lens` 独立执行分支。
- 旧 Canvas blur 在编码预乘颜色上工作，现有公开 `gaussian_blur` 在线性光工作，直接互换会使彩色/黑白边界的亮度不同。兼容节点在同一执行器显式选 encoded-premultiplied 语义，复用既有 encoded `blur` 工序；公开新高斯效果继续使用原线性语义。这里是两种被声明的色彩语义共用算法，不保留 Canvas/GPU 两套运行实现。
- 兼容 blur 必须覆盖本层 image 与 underlay 的对应通道；它是最终镜头虚化，不能让主体变虚、光晕保持锐利。光能纹理用线性语义模糊，不进行普通 alpha 解预乘。
- 高斯 interactive/final 策略本来不同。旧 pose.blur 使用固定兼容规划，不能因预览/导出 quality 不同改变画面；图层效果的一致性验收使用相同最终质量，交互降质量单列近似误差。

人眼无差别验收由 Claude 在独立测试时间线完成：

1. 基线程序与新程序分别输出同一输入、时间、尺寸、色彩条件的帧，基线可使用审定提交的离线结果；不在新运行时保留旧实现开关。
2. 输入含透明白字/彩字、半透明线条与圆点、黑白边界、真实图像；半径 0、阈值附近、小/中/大半径，gaussian/lens 两方式。
3. 含 scale 0.5/1/2、非等比缩放、旋转、clip、参数动画、预览 1/2 和 1/4、跨栅格与 padding 档位；对齐到相同显示尺寸比较。
4. 原尺寸并排、快速 A/B、连续播放判断边缘宽度、亮度、颜色、剪裁、闪烁。差分图/误差统计用于定位，不设一个宽松像素阈值代替人眼结论；清晰帧和零 blur 应保持相同。
5. 有可见差异先修核、颜色或尺度映射，不改作者参数来掩盖。Claude 明确通过后才能宣称旧 pose.blur 兼容。

## 6. 帧指纹与缓存

### 6.1 统一效果签名

新增 `src/core/videoEdit/authorEffects.ts::authorEffectsFingerprint`：对归一化、展开后的有序结果稳定序列化。包括效果 ID、全部实际 params、预设效果 amount/enabled/实际关键帧值、LUT 内容身份和内部兼容 blur 参数；键名稳定排序，数组保留顺序。重复效果按顺序区分，不使用随机实例 ID。

- 相同值但新建对象、对象键顺序变化、默认值显式/省略、未用预设的修改，不应改变图像签名。
- 效果 ID、顺序、实际参数、解析到的 look 内容、实际依赖 LUT 改变，必须改变签名。
- 函数对象、回调源码字符串、墙上时间、整个库 revision、调试计数不进入图像签名。效果输出纹理的缓存再加实际尺寸/格式/质量；稳定帧图像签名不混入资源分配次数。
- 效果算法更新需要改变渲染环境身份，防止复用跨应用构建的旧预渲染。库冻结版本属于代码契约身份；两者不能混用。

### 6.2 录制路径

`engine/videoEditAuthorFingerprint.ts::fingerprintAuthorFrame` 从 layer 的未知属性散列中显式排除 effects 函数，用同一 `resolveAuthorEffects` 在本帧求值并加入签名。否则函数会触发 `unstable-value`，让所有带效果的层退回粗版本失效。

图层 bounds、clip、中心 pose、曝光 poses、实际绘制指令和使用到的媒体身份继续保留。效果求值依赖真实像素/不可获取环境时返回有原因的 fallback，不假装“没有效果”。隐藏层是否跳过效果的规则必须与 renderFrame 一致。

### 6.3 frameKey 路径

`fingerprintAuthorFrameKey` 当前只运行 frameKey，不调用 layers；不能假定它自动覆盖宿主新增 effects。决定新 API 的 layers 作者在声明路径也提取层效果描述（不调用 draw、不栅格化），将实际 effects 和兼容 blur 签名加入 frameKey 摘要。

- 提取复用 `fingerprintAuthorFrame` 的无像素资源替身和统一效果求值 helper；layers 在描述阶段读取真实位图或执行不支持操作时，保守 fallback。不能给它伪造空 assets 后继续报告命中。
- 保留 v4–6 的 frameKey 契约；API 7 的文档说明宿主可以调用 layers 提取效果，frameKey 仍负责自身画面声明。新调用不进入 draw 或 GPU。
- `engine/videoEditCodeFingerprint.ts::VideoEditCodeFingerprint.plan` 同时向两条路径提供同一预设环境和项目 LUT 内容身份。
- `application/videoEditRenderFingerprints.ts::videoEditRenderFingerprints` 的环境/片段缓存键加入所依赖预设快照的内容身份；预设变化触发重新计算，最终图像摘要按实际展开结果决定哪些帧失效。不能只改叶子 hash，外层缓存仍返回旧 frames 表。
- `cacheKey` 继续只保证 draw 内容；即使 draw 沿用，effects 每帧求值。`frameKey`、draw 缓存键、GPU 输出缓存键三者职责不互相替代。

本票缓存止于“原始栅格”和“整条效果链结果”。只改 glow strength 时可重做整条效果链；不承诺仅重做合成 pass，避免提前实现计划排除的工序级优化。

## 7. look、读回与复核

### 7.1 名字解析和环境来源

作者接口固定为 `look(name: string, knobs?: Readonly<Record<string, never>>)`，只接受省略或空对象；非空旋钮类型和运行时都明确报“不支持旋钮”，不静默忽略。返回 `{ id:'look', params:{name} }`，由宿主展开为零个或多个具体效果。

已存在的源和缺口：

| 源 | 正式路径与决定 |
| --- | --- |
| 全局效果预设 | `application/videoEditEffectPresets.ts::useVideoEditEffectLibraryStore` 的 presets，schema 为 `core/videoEdit/effectPresets.ts::videoEditEffectPresetSchema`；`resolveVideoEditLibraryEffects` 目前按 `preset:<id>` 查，不是名字查询。新增 `resolveVideoEditLookByName` 复用这份数据/schema。 |
| 工程选择的风格 | `core/videoEdit/document.ts::videoEditSequenceSchema.styleId` 指向 document.styles 的工程副本；`application/videoEditStyleLibrary.ts::VideoEditStyleLibrary.findStyle/requireStyle` 是全局风格库，不能用全局最新版替代工程副本。 |
| 风格内效果预设 | `core/videoEdit/styles/styleSchemas.ts::videoEditStyleSchema` 目前只有 guide/sample 等，没有效果预设集合；`VideoEditEffectPreset` 也没有 styleId/归属。不能从 guide、样片源码、同名模板或目录名猜出效果。C3 未裁定前，此优先级没有可实现的数据源。 |

确定的解析规则：工程已绑定风格中的同名预设优先，全局其次；名字按现有 nameSchema trim 后精确匹配，不做模糊搜索。同一优先级重名报歧义及候选，不能随机选第一项；风格里找到却不适用的预设直接报错，不能悄悄退到全局同名项。

解析只使用正式领域层准备的不可变快照：由 `videoEditEffectPresets.ts` 组装，在 `videoEditRenderTransport.ts` 的 init/update 与指纹请求中传入 Worker，同一 frame/export/trial 期间不变；Worker 不读 localStorage，也不访问 Zustand。`look` 模块保持无状态，相同模块被两个工程复用时不会串预设。

全局预设在开始一次渲染任务时冻结为快照；库变更使后续预览环境失效，已开始导出不变。本票不新建工程持久快照格式，因此换机器缺全局预设时应明确失败，不承诺自动携带。若需要作品永久锁定所用全局 look，应另作持久绑定裁定，不能以临时渲染快照冒充可移植性。

现有预设保存的是完整 `VideoEditEffect`，展开时必须处理：

- `enabled/amount`：关闭/零值跳过，其余沿现有 mix 语义；amount 不是简单乘某个 params.strength。主输出在输入/效果结果间混合，新增光贡献按 amount 缩放，不能把输入原图再加一遍。
- 参数曲线：复用 `src/core/videoEdit/keyframes.ts::evaluateVideoEditEffect` 和片段本地帧时间基准，之后才生成实际描述；不要把曲线直接丢掉。作者 t 和预设曲线时间基准分别记录。
- media 不是 video、含非 layer 效果、代码滤镜或依赖片段的 mask：报该预设不可直接挂图层，给出原有片段链入口。不能剥掉 mask 后改变预设口味。
- LUT 必须在当前项目解析成功；缺失报原 LUT 错误。展开结果带预设来源和条目序号用于观察，但名称等非画面信息不污染指纹。

### 7.2 每帧读回

- `src/core/videoEdit/codeAuthorProgram.ts::AuthorElementObservation` 新增只读 `effects`：顺序、效果 ID/名称、实际完整参数、amount、来源（直接描述/look/pose.blur）、中心求值时间；必要的像素半径/参考高度单列在诊断信息，不进入普通界面。
- `VideoEditAuthorRuntime.renderFrame` 将成功提交帧的求值快照存入 lastFrame；`observeElements` 读取这份快照，不能为了观察再次执行 effects，也不能把尚未成功的参数报告为生效。
- 继续经 `VideoEditAuthorPrograms.observe` → `VideoEditCodeGpu.observeAuthor` → 现有 `CodeAuthorFrameObservation` 回传；`application/videoEditCodeElements.ts::installVideoEditCodeElements/videoEditCodeElementFrames` 保存同帧状态。
- `application/videoEditFrameObservation.ts::observeVideoEditFrame` 在现有 trial 回调中收集这份观察并加入返回值；基线只安装节目元素、返回图片，不能只改 Worker 结构就认为取帧工具已报效果。source/code 观察也返回对应元数据，非代码素材为空。联系表逐帧关联，不把最后一帧效果冒充所有格。
- 沿 `src/core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts` 中 `observe_video_edit_frame` 的原声明扩展输出 schema。全层列表由取帧输出承担；现有选中元素读面为 `application/videoEditFields.ts` 的 `video_edit.document.selected_code_element`，扩展 `core/videoEdit/codeElementSelection.ts::videoEditSelectedCodeElementContextSchema` 和 `videoEditCodeElements.ts::videoEditSelectedCodeElementContext`，附只读 effects，理由为“由作者源码在当前帧求值，修改走源码/已有作者参数”。不虚构已有独立 code_element 实体，不在本票提供元素效果覆盖写入。

### 7.3 静态复核

复用 TypeScript AST，新增 `src/core/videoEdit/codeEffectReview.ts::reviewCodeEffectUsage`。它只分析源码，不 import/执行模块，不访问 GPU，不把字符串命中作为算法证明。

- 高置信规则：Canvas `shadowBlur` 的非零赋值；Canvas filter 的字面量/静态模板中的 `blur(...)`；可证实的“重复偏移 drawImage + lighter/add 混合”光晕样式。支持成员访问、别名，避开注释、纯文本和 henji-effects 工厂本身。
- 只有当前登记中存在可替代效果才提示；本票没有投影工厂，所以 `shadowBlur` 只能提示核对“虚化/发光可复用”，不能宣称现有 blur 就等于投影。无法证明的手写 WGSL/卷积只标候选交人审，不宣称能识别所有发光算法。
- 每条带文件、行列、证据片段、对应工厂及置信说明，属于建议，不阻止合法作者代码执行；参数非法属于第 1.4 节诊断，不混在建议里。
- `engine/videoEditAuthorTypeCheck.ts::createAuthorTypeChecker().check` 复用已有解析出的 SourceFile 产出独立的 suggestions；`core/videoEdit/codeMaterial/typeDiagnostics.ts` 增加建议投影，不能把建议塞进现有只收 Error 的 diagnostics 并使 total 失真。
- `application/videoEditCodeTypeCheck.ts::startVideoEditCodeTypeCheck/settleVideoEditCodeTypeChecks` 随源码检查返回建议；`application/videoEditReview.ts::queryVideoEditReview` 的代码复核复用同一分析结果，`core/videoEdit/review.ts` 与 `core/application-control/domains/videoEdit/videoEditReviewCapability.ts` 扩展对应记录契约。扫描按代码版本去重，不按每一帧重复做 AST。
- 继续区分静态建议、结构读回、像素观察。没有运行/看到画面不得写“已验证发光正确”。

## 8. 技能及助手覆盖

### 8.1 文档改动清单（实现阶段）

| 文件 | 应写入的决定 |
| --- | --- |
| `resources/assistant-skills/video-edit-code-creation/references/author-api.md` | effects 时间、参数单位、默认值、独立层/bounds、先效果后变换、bleed、pose.blur 兼容；henji-effects 导入、冻结版本、look 限制；顺序和第二输出经 Claude 裁定的语义。 |
| `resources/assistant-skills/video-edit-code-creation/SKILL.md` | 三档选择：已有风格件/预设 → 内置效果 → 自写；图层用库，片段媒体/抠像/智能区域/过渡/音频继续走片段能力。 |
| `references/approach.md`、`references/color-texture.md` | 删除“代码只能手写、效果只能整段挂”的冲突指导；已有样板使用现有工厂与正式参数，不教重写高斯/光晕。 |
| `references/review.md` | 静态建议的证据边界、效果参数读回、深浅背景发光、blur A/B 与跨档连续帧检查。 |
| `references/performance.md`、`references/parameters-curves.md` | draw/cacheKey 与 effects/整链输出缓存的区别；frameKey 新接口的 effects 求值；中心效果时间与曝光位姿分工。 |
| `references/recipes-text.md`、`references/recipes-glass-lines.md` 及实际命中的样例 | 只更新与新增库直接冲突的手写 blur/glow 配方；投影等尚无对应实现的样例不虚构替代能力。 |

这批文件是应用随包助手技能，不是 `.codex/skills`/`.claude/skills` 的项目开发技能；本票不为它们创建第二份副本。生成的 d.ts 不是上述 Markdown 文档的替代品。范围/默认值说明从登记表核对，示例必须经过作者检查器。

### 8.2 覆盖分级：能力增量，复用既有工具

按 `.codex/skills/henji-application-capability/SKILL.md` 的七问：新增可读层效果与复核建议（是）；新增作者源码可表达的业务语义（是，操作仍复用）；新增长任务/付费/取消语义（否）；新稳定跨域引用（否）；新增副作用通道（否，仍是现有作者代码执行与版本保存）；新 Surface（否）；仅呈现变化（否）。结论为“能力增量”，不是“仅覆盖核对”。

- 创建/更新仍走 `video_edit.project_file`、代码版本发布与已有参数实体；不为 glow/blur/添加一项效果新写 MCP 工具。
- 读回扩展既有元素/取帧契约，复核扩展既有 query 的输出；正式声明同源投影到 Pi/MCP，不在主进程 toolCatalog 手写字段。
- 新只读属性注明来源和写入替代路径；校验、观察与建议挂在正式领域服务，不只写提示词。
- 外来代码首次执行的信任检查沿 `videoEditAuthorTrust.ts::assertAuthorTrust`；look 的普通预设查找不执行风格样片。没有新增付费或删除动作，不新增审批。
- 日志复用现有 `video_edit.code.type_check.*`、帧观察、渲染失败与指纹事件；失败附层/效果/字段定位，耗时统计进入既有诊断。热循环不逐帧刷 info，不创建新日志通道。

## 9. 风险、验证与完成门槛

### 9.1 验证分级

本文交付为 L0：只核查引用、范围与设计一致性，不运行代码测试或应用。未来实现为 L2：作者公共接口、共享效果执行器、跨直接消费者与运行状态发生变化；按 `docs/rules/testing.md` 执行精确测试、所属工程类型检查及风险专项。core 同时进两套工程，需两套 tsc。涉及持久接口时执行持久兼容门禁与干净上下文审查；不因“渲染目录重要”直接升级全量 L3。

### 9.2 精确自动验证

| 风险 | 文件/测试落点与通过条件 |
| --- | --- |
| 类型与冻结发行漂移 | 扩展 `videoEditAuthorApiContract.test.ts`、`videoEditAuthorTypeCheck.test.ts`、`codeMaterial/authorLibraries.test.ts`、`videoEditAuthorBundle.test.ts`；验证真实作者程序的导入、别名、返回描述、非法字段/枚举/常量范围、动态范围错误、旧库锁定和冻结散列。新增生成器 `--check`；不抄一份效果 ID 清单做断言。 |
| 空间换算与外扩 | `videoEditAuthorLayers.test.ts`、`videoEditAuthorRuntimeResolution.test.ts`、`videoEditBuiltinEffectPasses.test.ts`；小 bounds、大参考画幅、预览分辨率、推近、非等比、多个邻域叠加、放射中心、含色差发光、跨 pad 档位；检查有实际可见支撑且内容原点不变。 |
| 提交/资源生命周期 | `videoEditAuthorRuntime.test.ts`、`videoEditCodeGpu.test.ts`、`videoEditAuthorGpuLifecycle.test.ts`；链上不同 uniform 不互相覆盖、无输入输出别名、整链一次提交、失败/取消不发布 cache、删层与 dispose 释放附件、设备重建不复用旧纹理。 |
| 原有片段回归 | `videoEditBuiltinEffectPasses.test.ts`、`videoEditCompositeScene.test.ts`；默认上下文、高斯/发光/色差、amount、LUT、遮罩与 transition 仍调用同一正式执行器，原单输出契约保持。 |
| 指纹漏失效/过度失效 | `videoEditAuthorFingerprint.test.ts`、`videoEditRenderFingerprints.test.ts`；分别覆盖 recording/frameKey、静态与 t 动态效果、相同值新对象、默认省略、顺序/ID/参数变化、look 覆盖与未使用预设变化、LUT 内容、中心 blur、cacheKey 恒定。断言实际相同/不同帧及渲染次数，不仅断言某 helper 被调用。 |
| look 语义与工程隔离 | `videoEditEffectPresets.test.ts` 及新增 resolver 测试；风格优先、全局回退、同级歧义、缺失、非空旋钮、非法空间、mask/音频拒绝、amount/曲线、导出快照、双工程并发互不污染。C3 未通过前不得伪造风格来源并宣称全覆盖。 |
| 观察/复核公开路径 | 扩展 `videoEditFrameObservation.test.ts`、`videoEditReview.test.ts`、`videoEditCodeTypeCheck.test.ts`；从公共领域调用读到同帧实际参数、look 展开项、兼容 blur；失败帧不冒充成功，静态建议不变执行失败。运行 `npm run check:assistant-capabilities`。 |
| 持久接口 | `npm run check:persistence-compat`、受影响格式的精确迁移/读写测试与新增黄金样本；保留全部承诺旧样本，不把 API 4–6 工程自动写成 7。 |

实现阶段命令选择：先用 `npm run verify:changed -- --level L2 --dry-run <本次精确文件...>` 检查范围，再显式选择直接消费者测试；两套类型检查为 `npx tsc -p tsconfig.json --noEmit` 与 `npx tsc -p tsconfig.electron.json --noEmit`，生成器检查为拟新增 `node scripts/generate-author-effects.ts --check`。不把整个脏工作区当范围。超过约一分钟的命令后台执行，先说明它覆盖哪一条 L2 风险。

### 9.3 真实设备着色器用例：“图层发光相加”

在 `src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts` 的现有 `vgpu/node` Dawn 设备夹具增加该用例，调用正式图层效果编码和实际合成入口，不只测试 plan 数组。运行命令为 `npm run test:gpu -- src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts`（实现后按实际新增测试文件精确扩展）。本次设计阶段不执行。

- 透明白字/红蓝线/半透明圆点，分别叠黑、深灰、浅灰、彩色背景；对“字形外但有光”像素断言不压暗背景，0 强度保持背景，外扩范围之外不变。
- 对线性光合成建立小幅值、未饱和的数值参照；对强光使用审定的 shoulder/screen 公式参照，不以简单通道 clamp 冒充样板效果。
- 分别测作者内部背景层与下方独立视频/图片片段；后者是防止第二输出在 `VideoEditCodePicture` 处丢失的必要测试。
- source_opacity=0 保留纯光，layer opacity=0 两种输出均消失；上下遮挡、剪裁、旋转/缩放/曝光权重一致，主图层不得重复相加。
- 同帧重复渲染像素稳定；连续参数跨外扩档位时只发生预期光晕变化，没有跳位或噪点相位跳变；多个效果的不同参数确实生效，以捕获 uniform 覆写。
- shader 失败、设备不可用不能 skip 后报告通过。现有 `vgpu/node::init` 夹具不改 API；若实现需要改变 VGPU 资源/context/target 生命周期且不确定，先查官方 MCP，无连接时查 [VGPU 官方文档](https://vgpu.sh/docs)。

### 9.4 Claude 观感验收与风险处置

- 在审定、隔离的测试时间线验收透明标题的深浅背景、参数动画与停帧，及第 5 节 blur A/B；不使用《元宝搜索》或用户真实作品。该未来验收不构成本次操作 9334 的授权。
- 同一时刻、同一尺寸/质量比较正式预渲染与导出；预览降分辨率另核对视觉尺度/亮度和连续性，不要求缩小图与全分辨率逐像素相同。
- 风险最高的顺序：跨片段/嵌套时丢副输出；效果后缀对副输出语义不清；padding 反过来改变半径/取样网格；encoded/linear 混用；多效果共用未提交 buffer；look 全局可变状态与 frameKey 漏失效。
- 不测性能基线、不宣称提速百分比；验证局部纹理范围、停帧沿用、无每效果提交等结构事实。大尺寸/多层只检查正确失败、回收和不阻塞主进程，不新增业务容量上限。
- 实现完成后按项目规则做独立上下文审查；本设计尚未由 Claude 审过，单测或类型通过不能替代观感结论。最终报告分别列已通过、未发现问题和未验证范围。

## 10. 待 Claude 裁定（实现前门槛）

| 编号 | 问题与建议 | 对范围/验收的影响 |
| --- | --- | --- |
| C1 | **发光跨片段边界**：建议采用第 4.3 节双信号 picture，把 add 保留到真实下方背景；为现有片段滤镜、转场、嵌套和透明导出逐一确定隔离边界。默认不接受“作者内部加过光就足够”。 | 若只允许改作者内部合成，须明确缩小验收为“背景在同一个作者模块里”；独立透明标题叠视频不能据此判通过。若要求任意非线性片段后处理都无损保持背景相关 add，需批准进一步的组合输出协议设计，不能隐含进本票实现。 |
| C2 | **第二输出与后续效果、screen 的语义**：建议主图像串行、副输出保留产生时状态，兼容 pose.blur 最后处理全部输出；默认 glow add 按已定行为。screen 建议在实际背景可得的合成步骤执行样板公式，与 add 同样携带其必要参数。 | 请确认 `[glow, blur]` 与 `[blur, glow]` 的明确含义；若要求任意后缀变换全部副输出，先扩展效果图契约。不得静默丢 screen 或把普通 RGBA shader 直接用于光能。 |
| C3 | **风格包优先的数据来源**：建议仅新增 `VideoEditStyle.effectPresets?: VideoEditEffectPreset[]`，复用现有预设格式，不引入说明/旋钮/映射；查找只读工程风格副本。需要同步 style 内容 hash、库/交换包/剪辑/录制的嵌套格式迁移与公开属性。 | 这仍是风格容器的格式增量，超出“完全不动格式”的解释，须明确允许；否则本票只能做全局 look 并保留风格优先的未完成项，不能声称计划范围 5 全部完成。全局 look 的跨机器可移植绑定是否纳入，也在此确认。 |

以上三项之外按本文决定实施；不因接口/算法待确认而先写一套临时运行实现。Claude 审查结果和裁定写回本文后再进入实现。

## 11. Claude 审查与裁定（10-31，实现以本节为准）

审查结论：设计通过，按以下裁定修改后实现。第 1–9 节其余决定照做。

**C1 跨片段发光：不做双信号 picture，用预乘 alpha 的“零 alpha 光”。**
- 片段合成器已是预乘 source-over（`videoEditGpuCompositor.ts:210`，color/alpha 均为 one, one-minus-src-alpha）。光晕像素写成“颜色 = 光的贡献、alpha = 0”时，out = src + dst·(1−0) = dst + src，天然就是叠到任意下方画面的相加；有遮挡的部分 alpha 正常。这是成熟做法（预乘 alpha 下 over 与 add 统一，粒子系统常用），不需要 `VideoEditCodePicture` 附件、不改合成器、转场与嵌套的预乘叠加天然保留。
- 作者层栈内部按同一规则累计：underlay 先以“零 alpha 光”叠到已有下方作者层，再由本层 image 普通覆盖；上方正常层出现时已有光按其 1−alpha 衰减（source-over 自动成立）。作者层栈与片段边界用同一个编码域（现有编码值上的预乘叠加），保证“背景在同一模块”和“背景在另一片段”观感一致；不在本票引入线性浮点临时累计。光的贡献就是发光现有的“叠到黑底上该有的编码颜色”。
- 限制（写进技能与 result）：片段级效果链里会先反预乘的效果（线性光调色等）作用在发光代码片段上时，零 alpha 光会丢失；需要对光调色时在作者 effects 里调。透明导出格式按普通预乘 RGBA 保存，背景相关的相加只在有背景时成立。
- 测试照 9.3：作者内部背景、下方独立视频/图片片段两种都要测；新增断言“下方片段在光晕处只被提亮、不被压暗”。

**C2 第二输出与后续效果：照第 4.4 节推荐。**
- 主图像串行；underlay 记录产生时的状态，后续效果不处理它；`[blur, glow]` = 先模糊再对模糊结果发光；`[glow, blur]` = 主体被模糊、先前的光晕保持。兼容 `pose.blur` 作为最终镜头虚化，同时处理 image 与 underlay。
- 发光参数 `blend` 在图层模式下只决定光与本层自身像素（image 的核心提亮）的结合方式；光对下方画面一律相加（零 alpha 光）。参数说明补一句图层模式下的含义，不静默忽略。

**C3 风格包优先：本票只做全局 look。**
- 不扩风格 schema、不动持久格式；`look(name)` 只按名字精确查全局效果预设，重名报歧义，缺失明确报错（换机器缺预设同样报错）。
- 风格包优先与旋钮留给后续“风格件”ticket（效果库第一批的风格件一行），result 里记为未完成项，不宣称计划范围 5 全部完成。

**其他审查意见**
- 1.5 作者 API 升到 7：按 persistence.md 执行，凡 schema 指纹变化的容器都要升版本、逐版本迁移、黄金样本；最低可读版本按“旧宿主不能正确执行新接口”判定。
- 1.2 有 effects 无 bounds 的层按作者画幅整幅栅格：允许，但技能里要明确“挂效果的层尽量给 bounds”，并在复核建议里提示整幅效果层。
- 6.3 frameKey 路径调用 layers 提取效果：只对 API 7 模块启用；API 4–6 模块（含《元宝搜索》现有四个模块）行为不变，指纹耗时不增加。
- 9.4 观感验收由 Claude 在独立测试时间线做，不动《元宝搜索》。
