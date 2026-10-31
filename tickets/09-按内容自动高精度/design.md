摘要：在现有帧准备与绘制录制中归并精度需求；命中内容的合成帧及其高精度依赖链使用 rgba16float，最终沿用固定抖动呈现，未命中帧保留原路径。
边界：只增加运行时计划、资源格式与缓存指纹，不改工程或作者 API 的已登记持久格式；保留发光曲线、编码域与 carriesLight，禁止用 8 位位图中转浮点结果。
状态：技术设计待 Claude 与审查员批准；不透明作者代码的精度声明、Canvas 浮点支持及验收中的像素一致范围须按第 8 节裁定后实施。

# 09 按内容自动高精度合成

## 1. 基线与统一语义

- 核查基线为 `D:/VibeCode/Henji-AI-t09` 的 `task/09-按内容自动高精度`，提交 `05c5d683a`。本轮只写本文，不改源码、不运行 GPU/Reality、不启动应用、不操作 9334、不访问用户视频工程、不改依赖、不提交或推送。
- 依据为同目录 `plan.md`、`docs/task/代码效果与渲染改进/以后再做.md` 第 14 项；ticket 05 以其 design.md 第 11 节 Claude 裁定及当前实现为准，不采用前文已经被否决的双信号 picture。
- 复用 `VideoEditGpuCompositor`、`VideoEditAuthorRuntime`、`VideoEditBuiltinEffectsGpu` 与现有 pass 规划器，不新增渲染器、效果算法或全局精度开关。所有 GPU 工作留在原 Worker、原 GPUDevice。
- `rgba16float` 表示存储精度，不代表把合成空间切到线性光。宿主交接继续使用当前预乘、编码域 RGB；发光/调色内部既有线性转换保持。把所有层改在线性光下混合会改变画面，不属于本票。
- 区分三件事：内容是否要求高精度、某张纹理的实际格式、像素是否携带零 alpha 光。三者不能用一个 `highPrecision` 或 `carriesLight` 互相替代。
- “整帧浮点”指本帧合成目标和需要高精度的计算依赖链；原始 8 位视频、图片、文字覆盖率不重新制造精度。独立的普通 8 位源可以直接采样到浮点合成目标。
- 现有 10 位以上素材路线保留：`videoEditGpuFrame.ts::videoEditGpuFrameFormat` 的 8 位平面、`rgb10a2unorm`、`rgba16float` 选择不变。不得把已走浮点的旧帧降级。

## 2. 判定与每帧计划

### 2.1 具体触发条件

在 `engine/videoEditGpuFrame.ts` 扩展宿主内部精度类型；新建 `engine/videoEditRenderPrecision.ts`，集中放纯函数 `videoEditEffectNeedsFloat`、`videoEditBlendNeedsFloat`、`mergeVideoEditPrecision`。Canvas 的状态识别仍在原 recorder 中，函数不导入 Store、UI 或主进程。新增类型只在运行时存在。

| 输入/内容 | 本票判定 | 当前权威位置 |
| --- | --- | --- |
| 10 位以上素材、浮点 picture | 保留现有 true；父节点只可提升，不可降低 | `videoEditGpuFrame.ts:43–55`、`videoEditCodePicture.ts:17` |
| 图层或片段 glow | 有效链中产生光的 `glow`：`strength > 0` 且 `view !== 'source'`；amount 必须大于 0。source 视图本身若执行颜色转换也按颜色效果提升；只有规划器实际返回 copy/纯 opacity 的旁路可维持 8 位 | `glow.ts::planGlow`、`videoEditAuthorEffects.ts::encode` |
| 暗角、全能调色 | 有效 `vignette` 且内部 amount 非零；`color_grade` 有实际调色 pass，包括暗角、曲线、LUT。look 先展开再判断实际效果 | `videoEditBuiltinEffectPasses.ts::planVideoEditBuiltinEffect`、`core/videoEdit/authorEffects.ts` |
| 其他内置效果 | 有实际计算的 `gaussian_blur`、`directional_blur`、`zoom_blur`、`lens_blur`、`sharpen`、`brightness_contrast`、`exposure`、`white_balance`、`hue_saturation`、`black_white`、`chromatic_aberration` 提升；纯 copy/恒等参数旁路不提升。它们会生成连续色阶、超白或连续加权结果 | `core/videoEdit/builtinEffects.ts`、`videoEditBuiltinEffectPasses.ts`、`chromaticAberration.ts` |
| 其他内置效果的默认策略 | crop、flip、invert、mosaic、film_grain、chroma_key 及录制 cursor/zoom 不单独触发；收到浮点输入时保留浮点。录制 frame 的背景/阴影若实际生成渐变或柔和阴影，则由其计划标记提升 | 同一内置规划器、`videoEditRecordingZoomPlan.ts`、录制 frame 计划分支 |
| shaders 图效果 | `shaders.*` 有效效果统一保守提升，覆盖现有 `Glow`、`Vignette`、`ConicGradient`、`DiamondGradient`、`FlowingGradient`、`GradientMap`、`LinearGradient`、`MeshGradient`、`MultiPointGradient`、`RadialGradient`；不凭名字正则推断，使用正式组件身份 | `core/videoEdit/shaderGraph/effects.ts`、`components.generated.json` |
| 混合模式 | Canvas 的 `lighter`、`screen`、`color-dodge`；shader 图的 `linearDodge`、`screen`、`colorDodge` 明确提升。为覆盖累计误差，shader 图其他非 normal 模式也提升；Canvas 其他非 `source-over` 的颜色混合模式同样提升，纯 Porter-Duff 裁剪/覆盖不单独触发 | `videoEditAuthorCanvasRecorder.ts::STATE`；`core/videoEdit/shaderGraph/spec.ts::SHADER_BLEND_MODES` |
| Canvas 渐变/柔和阴影 | 真正参与绘制的 fillStyle/strokeStyle 是线性、径向或锥形渐变即提升；不设“大面积”阈值，避免缩放、裁剪和档位切换时闪变。非透明 shadow 且 shadowBlur > 0、非 none 的 Canvas filter 保守提升 | recorder 的 `GradientRecord`、状态栈和实际绘制命令 |
| 作者图层属性 | `effects(t)` 经 look/曲线展开后的效果；中心 pose.blur > 0；motionBlur 实际产生多份非零曝光样本。bounds、clip、位移、旋转、scale、普通 opacity 本身不提升 | `videoEditAuthorRuntime.ts`、`videoEditAuthorLayers.ts`、`videoEditAuthorGpu.ts` |
| 转场/调整层 | 转场内容中白闪、渐变式着色器图提升；其他转场至少继承左右输入与自身效果要求。调整层继承下方合成结果，并合并自己的效果要求 | `videoEditCompositeScene.ts`、`videoEditBuiltinEffectPasses.ts::planVideoEditBuiltinTransition` |
| 隐藏/停用内容 | 沿用可见性与实际依赖判断：隐藏层、effectsEnabled=false、enabled=false、amount=0 不因挂载记录触发；曝光范围内任一实际样本可见仍算。蒙版全黑若没有现成摘要，不额外扫描像素证明零贡献 | `activeVideoEditEffects`、现有中心/曝光/覆盖求值 |

触发列表决定何时选择浮点；不会为数学上有意义的效果删掉其固有裁切、色域映射或发光 shoulder。未列入自动触发的效果仍必须能透传已经提升的纹理格式。

### 2.2 不增加取像、绘制或扫描

当前没有一个已经覆盖全部作者像素的“帧计划”：`VideoEditCodeSources.prepare` 准备片段参数，`VideoEditAuthorRuntime.renderFrame` 内部才调用 layers、录制 draw 和求 effects，指纹另在 `videoEditCodeFingerprint.ts` 计算。只在 compositor.draw 前加一个判断，已来不及挽救前面的 8 位写入。

决定把原作者渲染拆成同实例、同取消代次的“准备一次、编码一次”：

1. `VideoEditCodeSources.prepare` 的现有遍历为片段合并输入位深、已求值效果与转场要求；不重新求参数曲线。
2. `VideoEditAuthorRuntime` 在现有 layers/record/effects/pose 遍历中形成瞬态 `PreparedAuthorFrame`，保存本次 list、已解析效果、录制对象、样本和需求。必须先完成计划，再分配作者层栈和录制重放画布；不先画 8 位再重跑作者代码。
3. recorder 在记录实际绘制操作的同时 OR 精度位；沿用 save/restore 的有效状态，不将“创建但没使用的渐变”视为绘制。缓存的录制对象携带同一摘要，`cacheKey` 命中直接复用摘要，不重复遍历 ops。
4. 单层先定源栅格需求，再定效果输出需求；作者栈合并全部可见层。片段 normalize 在效果执行前合并整链需求，避免“第 3 个效果才发光，前两步已量化”。嵌套与合成节点自底向上 OR；同一帧一旦要求高精度，不因某个效果失败后临时移除而降档。
5. 原 frameKey 返回值与原录制指纹继续作为内容键；精度摘要作为宿主自己的输入并入 hash。指纹和渲染共用纯判定规则及准备代码，独立会话不共享作者实例或可变录制对象。
6. 取消、设备代次变化、params/assets/质量变化使旧计划失效；只有 GPU 成功提交后的结果才能发布静态缓存和 lastFrame。预热也必须调用这条准备路径。

“零额外开销”的可执行定义为：不增加 GPU pass、像素回读、作者 draw/layers/effects 调用、AST 扫描或独立全树遍历，只在必经遍历增加布尔合并和缓存键字段。新增 CPU 指令不可能严格为零；是否没有可测性能回退按第 7 节基准判定。frameKey 快速路径没有 draw 记录时，不为判精度偷偷执行 draw。

### 2.3 作者模块内部的发光/相加如何上报

- 使用现有 API 7 的 `layers[].effects(t)` 返回 `henji-effects` 的 glow/blur/look，宿主已经收到正式描述，由同次求值报告精度，无需新字段。
- 可录制 Canvas 的 `globalCompositeOperation`、渐变、阴影、filter，由上述 recorder 报告；缓存对象保存报告。作者无需手动填精度。
- 任意 `createWebGPU/createWebGL` 内部的 WGSL/GLSL、作者自己生成的 ImageBitmap、无法录制的 draw，以及 frameKey 跳过绘制的模块，目前没有“声明本帧高精度内容”的接口。`frameKey` 是任意 JSON，不得把碰巧名为 precision 的数据解释成宿主指令；`carriesLight` 也不是作者可写声明。
- 在“不改已登记作者 API”约束下，未知内容保守标记为需要高精度合成，但原生作者输出保持现有 ABI 的源格式：WebGL 默认帧缓冲和既有硬编码 rgba8unorm 的 WebGPU 程序仍是 8 位源岛。宿主不能恢复其内部已截断的光能，也不能把 rgba16float target 强塞给绑定 rgba8unorm pipeline 的程序。
- 因而“任意作者内部计算也端到端浮点”在当前约束下尚不能承诺。第 8 节列出边界裁定；不通过扫描源码字符串或伪造无效果 glow 来绕过接口。API 4–6 的作者入口、调用频率和内部算法保持原契约；未知内容的外层合成提升须与这一兼容边界一起批准。

## 3. 浮点交接清单

下表“高精度后”只适用于命中需求的依赖节点；判定为否时不切换资源格式和管线。

| 交接点 | 当前格式/行为 | 高精度后 | 实现位置 |
| --- | --- | --- | --- |
| 作者 Canvas 真正栅格面 | 默认 unorm8 的 OffscreenCanvas | 宿主拥有的高精度 Canvas 使用 `colorType:'float16'`、仍为 srgb；上下文创建后不能改 colorType，池键须含类型 | `videoEditAuthorRuntime.ts::surface/scratch`、paint |
| 作者 Canvas → GPU 图层，含 mip | texture 默认 rgba8unorm；上传使用预乘 | rgba16float，mip 每级同格式；直接 copyExternalImageToTexture，禁止 ImageData/Uint8 或 ImageBitmap 中转 | 同文件 texture/upload；`videoEditAuthorGpu.ts::mipmaps` |
| 源头本来就是普通图片/文字/视频 | 图片/字形 8 位；视频外部纹理、YUV8 或深色 owned format | 源格式不变；命中链的第一个计算目标提升；8 位字形 coverage 不重栅格成虚假的高位深信息 | `videoEditGpuCompositor.ts::upload/snapshot`、文本图集 |
| 图层效果每个主输出、underlay、amount mix、over、最终 pose.blur 输出 | AuthorEffects.take 和 encodePlan 固定 rgba8unorm | rgba16float，格式进入 cache key 与 spare 匹配；同链不写回 8 位 | `videoEditAuthorEffects.ts:44/52` |
| 效果内部 scratch | 普通跟输入；glow 线性 scratch 已 rgba16float；Gaussian 按 resolvedGaussian 可能 rgba32float | 普通至少 rgba16float；已有 32f 精确高斯保持 32f，不能统一降到 16f；LUT 已 16f 不变 | `videoEditBuiltinEffectsGpu.ts::encodePlan` |
| 作者层栈/运动采样合成 | AuthorGpu 的 motion/mip pipeline 固定 rgba8unorm | 作者层栈 rgba16float；pipeline 按 entry+format 缓存，输入可混用 8 位与 16f；曝光权重和顺序不变 | `videoEditAuthorGpu.ts:57`、`videoEditCodeGpu.ts::renderAuthorGenerator` |
| 作者试渲染、native element override、预热 | 试渲染 authorTarget、nativeOverrideTarget、warm target 默认 8 位 | 宿主可控链按同一计划选择 16f；试渲染在最外层用正式固定抖动呈现，不另用无抖动 blit | `videoEditGpuCompositor.ts::renderAuthorFrame`、`videoEditAuthorRuntime.ts:198`、`videoEditCodeGpu.ts::warmAuthor` |
| 原生 WebGPU/WebGL 作者输出 | target 默认 8 位；WebGL 上传默认 framebuffer | 未批准新作者契约前保留 8 位源岛，随后进入浮点宿主链；直接滤镜已有输入格式契约不得破坏 | `videoEditAuthorRuntime.ts::renderFrame`、`videoEditCodeGpu.ts::authorFilter` |
| 片段 normalize、效果、遮罩混合、调整层 | normalize 只看 picture.highPrecision；builtin/authorFilter 多沿输入格式；mix 取双方最大精度 | normalize 提前合并内容需求，后续 outputs/mix/maskedMix 保持 16f；蒙版本身仍 8 位 coverage | `videoEditCompositeScene.ts:65–97`、`videoEditCodeGpu.ts::builtin/mix/maskedMix` |
| 嵌套序列与代码视频/下层输入 | 普通 nested target 默认已 rgba16float；filter 邻帧可显式指定输入格式；部分代码输入可要求 8 位 | 现有 nested 16f 不降级；覆盖显式 8 位调用点为“请求格式与子计划精度的最大值”；借用 texture 一路传递格式，不能从默认值重建 | `videoEditRenderer.ts:1445/2214`、`prepareCodeInputs` |
| 转场：mix、内置、gl-transitions | 两侧任一 highPrecision 才选 16f；gl-transitions 已可按 format 编译 | 合并左右计划及转场自身需求后选 16f；纯 8 位非触发转场保持旧路径；零 alpha 光隔离语义见第 6 节 | `videoEditCodeGpu.ts::mix/transition`、`glTransitions/videoEditGlTransitionsGpu.ts` |
| shaders 图输入桥 | 输入纹理 16f，但 upload 显式 clamp 再反预乘 | 普通浮点颜色移除仅为 LDR 交接的 clamp，保留既有编码转换；零 alpha 仍是隔离边界 | `shaderEngines/shaderGraphSession.ts:37/172` |
| shaders 图内部最终目标 → 宿主输出 | 框架 configure 决定 targetFormat，代码注释注明常为 bgra8unorm；最后才拷到宿主格式 | 必须从框架真正最终渲染 attachment/pipeline 一起选择 16f，不能只改外层 request.outputFormat 或伪造 context 的 format；若依赖没有公开能力，先裁定适配范围，不能宣称已端到端浮点 | 同文件 initialize/getCurrentTexture/present；`shaderGraphCache.ts` |
| 多生成器驻留溢出 | generatorTargetCapacity 按 4 B/px；spillGeneratorTarget 只接受 8 位并转 ImageBitmap | 容量按实际字节；浮点结果不得走 bitmap spill。优先淘汰可重算缓存、缩减前视与流水并发；当前帧仍需的浮点目标保持驻留 | `videoEditCodeSources.ts:460–479`、`videoEditCodeGpu.ts:625–639` |
| 顶层合成 → 显示/编码输入 | 纯 8 位直写画布；深色帧 16f → PRESENT_SHADER | 内容需求也可触发原 precise target；只在最外层作一次固定抖动/量化。嵌套/片段交接不呈现、不抖动 | `videoEditGpuCompositor.ts:549–553/719`、`videoEditGpuShaders.ts::VIDEO_EDIT_PRESENT_SHADER` |
| 预渲染文件、导出视频、缩略图/取帧图片 | 8 位输出或既有编码格式 | 保持；它们是交付或显示边界，不用来存储需继续计算的浮点中间结果 | render cache、export、bitmap bridge |

Canvas float16 必须在独立 Electron Worker 验证 `getContextAttributes().colorType` 和“窄于 1/255 的渐变 → GPU 16f 回读”的实际精度。规范列出此选项不等于当前 Electron 二进制完整支持；不能仅因 getContext 没抛错就判支持，也不能仅把上传纹理换成 16f 就判通过。

来源：[HTML Canvas 设置规范](https://html.spec.whatwg.org/multipage/canvas.html#canvascontext2dsettings) 定义 unorm8/float16；[WebGPU 纹理规范](https://www.w3.org/TR/webgpu/#texture-format-caps) 定义格式能力。VGPU MCP 本会话未加载、官网 docs 无法访问，已改读已安装包自带官方 `/guides/texture-formats.docs.md` 与 `/vgpu/target.docs.md`（`node node_modules/vgpu/bin/vgpu.js docs cat ...`）：16f 可作为可过滤 HDR target，8 B/texel，读回只用于测试和诊断。官方资料入口见 [VGPU 官方仓库](https://github.com/vercel-labs/vgpu)。本票不改 VGPU API、不新增 MSAA。

## 4. 8 位帧不变与浮点数值契约

### 4.1 判定为否

- 不创建 precise target、不执行 presentPipeline、不启用 float Canvas、不编译/选择浮点 shader 变体。
- 保留原 shader 文本与默认参数、原 rgba8unorm targets、clear 值、混合因子、pass 顺序、采样器、颜色转换、上传方式、曝光权重和提交次数。新增参数默认值必须等于原行为。
- `videoEditLayerShader` 的普通变体保持当前 `clamp(rgb,0,alpha)`，carriesLight 的旧变体保持 `clamp(rgb,0,1)`。不能全局删 clamp，否则 8 位前处理/插值也可能变化。
- 已有浮点嵌套导致整帧提升的情况不改判定；所谓“8 位帧”指旧规则和新内容规则都判否，不能只看原媒体位深。
- 格式切换在分配前完成；资源键包含格式，不复用旧档的 texture、pipeline、mip、作者栅格/输出缓存。连续测试 false→true→false，防止上一帧 carriesLight 或 float target 残留。

### 4.2 判定为真

- 新增浮点专用合成 shader 变体：保留 alpha/opacity/几何规则，RGB 不在入口按 alpha 或 1 截断；允许超白预乘值、零 alpha 光。有限负值的数学中间结果允许传递，最终呈现仍按现有规则夹到显示域。
- 效果 shader 的存储格式和 LDR 裁切必须一起审计。`adjustmentPassesWgsl` 已有 extendedRange，但其中 `premul` 仍固定 clamp；只开 extendedRange 不足。为高精度变体提供不在交接处裁切 RGB 的 premul/相关输出，默认变体不改；不修改 LUT 域查找、抠像阈值等算法本身的 clamp。
- `glow.ts::glowColor` 现有 shoulder、screen、core_white、效果参数 dither 属于已定义外观，本票保留。它们的单层输出本来是有界颜色；本票保证多个光贡献、主图 over、曝光衰减以及效果交接不再提前 8 位量化，不宣称把该效果重新定义成无肩部的 HDR 辐射亮度。
- 效果自带 dither 与最终量化抖动不是同一语义。本票不删除已保存的 glow.dither 参数；测试超白累积时将它设为 0 以隔离数值参照，正式渲染照参数执行。
- 纯 8 位素材出现在高精度帧中允许获得更精确的混合结果，不要求与原整帧 8 位结果相等；只对判否帧要求严格逐字节相等。

## 5. 显存、耗时、预算与回退

### 5.1 可复算的显存估算

单位使用 MiB。完整纹理：1080p 的 8 位为 7.91、16f 为 15.82；4K 为 31.64、63.28；完整 mip 链约乘 4/3。以下为规划包络，非真机测量。

参考场景：N=1 或 3 个全画幅作者层，每层一个 glow，amount=1，resolution=50%，无色差、无额外 blur/转场，串行处理层；N 个源与 N 个最终效果输出各带 mip，保留一个作者栈、一个顶层 precise target、一个可复用 Canvas scratch；主图/光/over 临时面按最多 3 个全尺寸面计。glow 的三组金字塔按不复用的保守总量 `3×Σ(r²/4^k)F ≤ 4r²F` 计，r=0.5、F=8WH。最终 8 位画布按 0.5F 计。多层共享同规格 scratch，不按 N 重复计算金字塔。

- 高精度包络：`(8N/3 + 6.5 + 4r²)F`。
- 当前 8 位交接的可比包络：`(4N/3 + 3 + 4r²)F`；glow 内部本来已 16f。

| 画幅/发光层 | 当前交接估算 | 浮点交接估算 | 增量 |
| --- | ---: | ---: | ---: |
| 1920×1080 / 1 | 84.4 MiB | 160.8 MiB | 76.5 MiB |
| 1920×1080 / 3 | 126.6 MiB | 245.2 MiB | 118.7 MiB |
| 3840×2160 / 1 | 337.5 MiB | 643.4 MiB | 305.9 MiB |
| 3840×2160 / 3 | 506.3 MiB | 980.9 MiB | 474.6 MiB |

这是上述资源模型的包络，不是全进程 VRAM 上界：驱动对齐、交换链多缓冲、解码、文字图集、框架内部缓存及其他会话另计。glow resolution=100% 时本模型再增加 3F（1080p 47.5 MiB、4K 189.8 MiB）；bounds 外扩按实际 W/H 计算，不能用序列像素数代替。amount≠1 会增加 mix 面；Gaussian final 的 32f、多个 glow、双侧转场/嵌套和两帧在途都按各自 pass 生命周期再计，不套这四个数字。

运行时估算沿 `plan.scratch`、最后使用位置、mip 级数、实际格式累加；已共享 texture 按身份去重，取消但尚未完成的在途资源仍计入峰值。作者 runtime 自有 surfaces 与 Canvas scratch 也必须统计，不能只读 CodeGpu.bytes。

### 5.2 耗时估算与预算

浮点交接增加带宽，不增加 glow 核的采样次数；新命中帧增加现有最后呈现 pass。以每层约五次全尺寸读写的交接估算，相对 8 位每像素增量约 40N 字节，加顶层呈现与浮点附件额外约 16 字节，即 `WH×(40N+16)`。这是带宽量级模型，不包括 Canvas 实现、缓存命中、shader ALU 和首次编译。

| 画幅/层数 | 额外流量/帧 | 有效带宽 50–200 GB/s 下的纯带宽时间 |
| --- | ---: | ---: |
| 1080p / 1 | 116 MB | 0.58–2.32 ms |
| 1080p / 3 | 282 MB | 1.41–5.64 ms |
| 4K / 1 | 464 MB | 2.32–9.29 ms |
| 4K / 3 | 1128 MB | 5.64–22.57 ms |

这些值不构成帧时承诺；缓存命中会减少流量，Canvas float 上传、框架多 pass 或设备争用会增加耗时。60 fps 的 16.67 ms、30 fps 的 33.33 ms 是总帧预算，不能把全部预算分配给精度增量。预览沿用既有降低分辨率/调度策略；导出等待完整质量，不以赶帧时间改回 8 位。

### 5.3 资源策略

- `videoEditCodeGpu.ts` 当前 8 位/高精度各 512 MiB 且分配时硬拒绝，`videoEditGpuBudget.ts` 另有输入预算；4K 多层浮点已可能撞到现有限制。按项目容量规则，将本次触及的 texture 驻留阈值用于淘汰闲置缓存与限制前视，不作为拒绝当前合法工作集的硬上限；尺寸只服从 device.limits.maxTextureDimension2D，不延续固定 8192 人为门槛。
- 回收顺序：过期/闲置 surfaces、旧精度档 scratch、可重建作者输出、前视与历史；再把在途渲染降到一帧。只回收当前计划不再读取且 GPU 生命周期允许的纹理，不覆盖仍被引用的输出。
- 不走浮点→ImageBitmap→浮点 spill；不逐帧 CPU 回读。实际显存不足时预览可沿既有机制降尺寸重新生成同精度帧；精确观察、预渲染和导出必须按请求尺寸成功或明确失败，不发布近似结果为精确缓存。
- 初始化验证 16f attachment/filter/blend；设备丢失走既有恢复与失效路径。硬件或 Canvas float 不支持时不把 8 位帧标成高精度成功：交互预览若显示兼容降级结果，应标记既有 approximate 并禁止进入精确缓存/导出复用；精确任务报可恢复错误。具体 Canvas 降级产品行为须经第 8 节批准。
- 日志复用现有 render-cache/export/渲染诊断：记录需求、实际格式、峰值字节、回收/降尺寸原因与失败；逐帧明细仅诊断模式，正式界面不展示格式、缓存版本或内部 ID。

## 6. 缓存与零 alpha 光

### 6.1 精度进入现有指纹

- `videoEditCodeFingerprint.ts` / `videoEditAuthorFingerprint.ts` 生成 digest 时加入宿主准备得到的精度需求、实际源边界策略及精度算法标识；frameKey 内容键仍不能覆盖宿主精度。记录法的精度随录制一起 hash；无法证明内容精度的 fallback 使用确定的保守策略，不能拿上一帧结果代替。
- 片段效果、媒体位深、转场与嵌套的需求在 `core/videoEdit/renderCache.ts` 的现有窗口 hash 中归并。没有代码片段的窗口也必须覆盖。代码帧摘要未就绪继续走 fingerprintPending，不提前命中旧文件。
- 不只 hash 最终布尔值：A、B 两帧都为 float，但触发层、源 8 位岛、Canvas 实际能力和处理链不同仍须失效。现有内容依赖负责结构/参数，新增精度签名负责格式策略；两者共同组成窗口键。
- `VIDEO_EDIT_RENDER_ENGINE_VERSION` 已在窗口依赖中；实现后的渲染源码变更自动使旧算法缓存失效，仍显式加入精度策略标识，防止同内容不同格式或能力降级误复用。它是可重建缓存算法版本，不是作者 apiVersion。
- GPU 内存缓存键分别补齐实际 format、色彩编码/alpha 语义、设备代次：AuthorRuntime surfaces/history 的栅格结果、AuthorEffects 输出/spare、CodeSources 静态 picture、AuthorGpu pipelines、shaderGraph 会话。CPU 录制可跨精度复用，旧 GPU 栅格不可以。
- `videoEditExportPreviews.ts::videoEditExportPreviews` 的 usePreviews、快照一致、字幕、尺寸、fps 条件不变；它调用的 prepareVideoEditRenderWindows 获得新窗口键即可，不加导出专属高精度开关。预览与导出相同内容、尺寸、质量、时间、素材/预设快照使用同一判定。
- 不修改持久 schema、apiVersion、工程、代码资产、缓存清单结构或容器版本；精度只进入已有 key/digest 字符串。不新增“设置精度”的助手工具。
- 缓存保存的是最终呈现后的 8 位视频，整帧回放沿既有缓存片段路径，不能再次按原内容施加浮点抖动。缓存不作为未完成合成的浮点中间层使用。

### 6.2 carriesLight 保留，浮点分支只简化钳制

- 事实：`videoEditGpuShaders.ts:39` 即使目标是 float，仍按 carriesLight 选择 RGB 上限 alpha 或 1；只换 texture format 会继续丢超白。`gaussian_linear/encoded`、普通 straight/premul 和 gl-transitions 包装会在 alpha=0 时丢 RGB，浮点不能自动修复。
- 浮点合成变体可去掉“为了储存光而放宽到 1”的条件钳制：RGB 直接参与预乘 over，alpha 保持覆盖率。仍保留 `VideoEditCodePicture.carriesLight`，用于标明这种像素不满足普通反预乘假设、诊断和跨边界语义；8 位路径继续使用原保护。
- 继承 ticket 05：图层主图顺序处理，glow underlay 保留产生时状态；最后 pose.blur 同时处理主图和光。合成顺序为 underlay 在下、image 在上；最终一起应用 pose.opacity、clip 和曝光权重。不是把整层不透明度只乘主图。
- 纯 copy、over、opacity、原生预乘 mix 和嵌套在浮点路径可以保留零 alpha 光，并明确传播标志。逐帧覆盖 carriesLight，禁止 surface 复用遗留 true。
- **本票不把所有片段滤镜/转场宣称为光兼容。** 非线性调色、shader 图直通色输入、gl-transitions 的反预乘以及作者 filter 保留 ticket 05 的普通图像隔离边界；进入这类边界时按现有语义处理并清除 carriesLight，不把无光输出继续标成带光。
- 若要消除所有转场首尾跳变，需要逐类定义“背景相关发光经过非线性后处理”的语义，不能用一张 RGB+alpha 唯一分解主体与光；恢复双信号图也与 ticket 05 裁定相冲突。本票仅修精度截断，扩大光语义须另行批准。
- 不删除 glow shoulder、不全局改线性 over、不将 carriesLight 等同于高精度。这三项都会超出本票并改变已有作品。

## 7. 验证计划与实施顺序

本轮为 L0，只核对路径、现状和设计一致性，未执行代码测试。未来实现为 L2：共享 GPU 资源/缓存状态和多个直接消费者同时改变；不是仅改单个着色器，也不因此升级全量 L3。

### 7.1 真实 GPU 断言

复用现有 `vgpu/node` Dawn 夹具；初始化失败、验证错误、设备丢失必须使专项失败，禁止 skip 后报通过。测试使用正式规划、编码和合成函数；单独运行 shader 只能作为补充。

| 风险 | 断言/边界 | 首选测试落点 |
| --- | --- | --- |
| 8 位回归 | 与基线同设备逐字节相等，maxDiff=0、不同像素数=0；覆盖无效果视频/文字、普通透明叠加、裁剪/变换、原 8 位转场，含 true→false 往返 | `videoEditGpuPrecision.gpu.test.ts`、`videoEditGpuCompositor.test.ts`；基线读回在实现前保存于隔离测试产物 |
| 超白被交接截断 | 正式浮点链注入两份 RGB=0.75、alpha=0 的光，over 后回读应约 1.5（half 容差 0.002），再 opacity=0.25 后约 0.375；不能只检查最终已经饱和的白像素 | 同 GPU 专项及 `videoEditBuiltinEffects.gpu.test.ts` |
| 实际 glow | 用正式 glow 的两份输出建立浮点 CPU over 参照；黑/深灰/浅灰背景、内部背景和独立下层片段结果一致；source_opacity=0 保光、pose.opacity=0 全隐；[glow,blur] 与 [blur,glow] 符合已定语义 | `videoEditBuiltinEffects.gpu.test.ts`、作者 runtime 对应测试 |
| 渐变源先量化 | 独立 Electron Worker 的 Canvas float16 渐变直传 GPU，显示量化前 1024 点梯度显著超过 256 级；固定半档平场最终抖动均值误差≤0.1/255，重复帧完全相等 | Canvas 真实容器专项 + `videoEditGpuPrecision.gpu.test.ts` |
| 漏交接 | 作者层栈→片段效果→amount/mask→嵌套→转场→顶层；检查每个实际 attachment format 和回读数值。对普通反预乘隔离边界测试其声明限制，不伪造“所有零 alpha 光通过” | `videoEditCompositeScene.test.ts`、内置/GL 转场 GPU 专项 |
| 缓存错误 | glow 参数/开关、look 变化、关键帧跨零、隐藏/显示、缓存常量 draw、frameKey、相同代码不同精度能力；旧键不能命中、新键只重渲受影响窗口；没有代码的暗角窗口也失效 | `videoEditAuthorFingerprint.test.ts`、`videoEditCodeFingerprint.test.ts`、`videoEditRenderFingerprints.test.ts`、render cache 精确测试 |
| 生命周期 | 8↔16 切换、分辨率变化、取消、旧计划迟到、设备重建、3 层驻留超过旧预算；不能 bitmap spill 浮点、不能别名读写、dispose 后资源账归零 | `videoEditAuthorGpuLifecycle.test.ts`、`videoEditCodeGpu.test.ts`、`videoEditAuthorEffects.test.ts` |

“预览、预渲染、导出像素一致”按同尺寸、同 quality、同素材/预设快照，比较三条调用链送入编码器之前的 RGBA 字节，必须完全相同。interactive/final 的 Gaussian 精度可能不同；跨 quality 不承诺逐字节一致。H.264/H.265 和预渲染编码是有损环节，解码后的文件不能要求与未编码画布逐像素相同；导出复用预览应与同一预览文件解码帧一致，编码损失单列，不能归因于浮点判定。

### 7.2 基准

- 实现前与实现后在同一设备、同电源状态、同输出质量分别运行：1080p/4K、0/1/3 个全幅 glow、静止缓存命中和动态重画。除四个预算场景，补一个小 bounds 标题场景，确认局部栅格仍有效。
- 每场预热 60 帧、测量 300 帧，三轮交错前后基线；记录准备 CPU、提交至完成墙钟、可用时 GPU timestamp 的 p50/p95、实际纹理峰值、分配/回收与缓存命中。编译冷启动单列，不能混进热帧均值；计时区间不做读回。
- 8 位帧结构性要求为 pass/submit/upload/作者回调次数不增加、无浮点分配；耗时无可重复回退。暂定筛查阈值为 p50/p95 增量不超过 max(0.1ms,3%)，超过即分析，不把测量噪声阈值解释成允许主动变慢。
- 高精度帧记录实际增量与第 5 节模型差异；按 30/60 fps 总预算报告能达到的尺寸和层数，不在设计阶段伪造绝对帧时。实际结果在获准实现后的 result.md 记录；本轮不创建该文件。

### 7.3 分步落地

1. Claude 与审查员先批准本文，完成第 8 节裁定。冻结判定、兼容边界和像素验收定义，不带着互相矛盾的要求开工。
2. 在隔离测试环境建立基线与 Canvas float/shaders 图真正浮点出口的最小验证。复用已安装依赖；不动 9334 或用户工程。框架若无匹配能力先回报事实，不在 node_modules 打临时补丁。
3. 实现单次准备计划、需求归并与精度指纹；确保判否路径未改。暂不全局启用内容提升，以既有深色夹具验证资源格式传播。
4. 作者 Canvas、AuthorGpu、AuthorEffects、预热/试渲染按格式实例化；加入浮点合成与效果交接变体。跑超白/渐变/8 位不变定向 GPU 测试。
5. 接通片段 normalize、嵌套/代码输入、转场、shader 图与缓存；补齐驻留估算、禁用浮点 bitmap spill、取消和格式切换回收。只启用已经通过端到端验证的路径，未解决边界不得隐性降级报成功。
6. 执行实际改动文件的 `npm run verify:changed -- --level L2 <本次文件...>`，先以 `--dry-run` 确认范围；若 related 扩散超过规则阈值，指定上述直接消费者。`src/core/**` 若改动则按规则跑双工程类型检查；只改 engine 则跑所属渲染工程。GPU 命令按实际影响精确列出，例如 `npm run test:gpu -- src/features/videoEdit/engine/videoEditGpuPrecision.gpu.test.ts src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts`。
7. 运行上述基准和隔离容器三链像素验证；需新运行产物时仅 electron:bundle，不因产物旧运行完整 build，不跑 Reality。超过一分钟的命令后台运行。本票不改 ticket 07 复核逻辑、ticket 08 编码/窗口/预设。
8. 实现完成后按 plan 做独立审查与交叉审查；审查只交 diff、任务目标和对应规则。修复后再验证受影响范围，批准前不实现、本轮不提交。

## 8. Claude 与审查员须明确的裁定

| 裁定 | 事实与建议 | 未裁定时的边界 |
| --- | --- | --- |
| C1 作者声明与持久格式 | 现有 API 没有精度声明；新增模块字段/回调即改变已登记 code-author-api。建议本票保持不改格式，完整覆盖正式 effects 与可录制 Canvas；未知作者程序保守提升外层合成、保留原 8 位源岛。若要求任意 WebGPU/WebGL 内部发光也可主动上报并无损交接，须另行批准作者 API 版本及兼容工作，不能用本文授权绕过。 | 不承诺任意作者内部端到端浮点；不擅加 precision 字段、不改旧 GPU target ABI。 |
| C2 渐变/框架出口与回退 | 建议采用浏览器原生 float16 Canvas 和现有 shaders 框架公开格式能力；成本是 float Canvas 能力验证及整条框架输出管线适配。若当前 Electron 或依赖无法保留浮点，精确任务明确失败、交互可降尺寸但不以 8 位冒充完成；若要另写渐变栅格器或升级依赖，先独立裁定。 | 规范支持不等于设备实测通过；不接受“8 位源上传到 16f”作为渐变验收。 |
| C3 零 alpha 光与外观 | 建议保留 carriesLight、glow shoulder/dither 和 ticket 05 已声明的普通片段后处理隔离边界；浮点分支只移除交接时的饱和/alpha 钳制。 | 不承诺所有转场和非线性滤镜透传零 alpha 光，也不承诺单个 glow 输出成为无界线性辐射值。 |
| C4 像素一致 | 建议确认第 7 节定义：同质量的编码前 RGBA 完全一致；有损编码后的文件比较单列。交互与 final 已有质量差异不由本票抹平。 | 不把有损 H.264/H.265 文件逐像素等于实时画布作为可完成指标。 |

本文完成技术设计与代码事实核查；尚未取得 Claude/审查员批准，尚无 GPU、Canvas 能力、性能或成片验收结论。

## 9. Claude 裁定（10-31）

- **C1 作者声明**：不改作者 API 与持久格式。正式 effects、可录制 Canvas、宿主图层属性按第 2 节上报；**原生 WebGPU/WebGL 作者程序与无法录制的内容不触发提升**（按现在的 8 位处理）。理由：它们的输出本来就是 8 位源，外层提升只换来更多带宽，画面得不到好处；《元宝搜索》这类以原生模块为主的片子大部分帧应保持 8 位原路径。作者程序请求浮点目标留作以后的作者 API 项，登记到以后再做，不在本票。
- **C2 能力不足时的回退**：精度是画质增益，不是正确性前提。Canvas float16 或 shaders 框架拿不到浮点出口时，对应内容按现在的 8 位路径处理、照常成功（日志记一次能力结论），**不让精确任务、预渲染或导出因此失败**，也不标近似。不另写渐变栅格器、不升级依赖。
- **触发范围收窄**（第 2.1 节表格按此改）：
  - 触发：发光（glow）；会超白或累积的混合（Canvas `lighter`/`screen`/`color-dodge`，shader 图 `linearDodge`/`screen`/`colorDodge`）；渐变（实际绘制的 Canvas 渐变、shader 图渐变类组件、录制 frame 的渐变背景与柔和阴影）；Canvas `shadowBlur > 0` 的可见阴影；暗角（独立或全能调色里的暗角）；模糊类（gaussian/directional/zoom/lens、pose.blur、产生多份曝光样本的运动模糊）；全能调色里有曲线或 LUT 的。
  - 不单独触发（收到浮点输入时保持浮点）：逐像素颜色调整（亮度对比度、曝光、白平衡、色相饱和度、黑白、锐化、色差）、shader 图与 Canvas 的其他混合模式、crop/flip/invert/mosaic/film_grain/chroma_key、录制光标与缩放。
- **C3 零 alpha 光**：同意第 6.2 节：保留 carriesLight、glow 肩部与 dither、ticket 05 的普通片段后处理隔离边界；浮点分支只去掉交接处的饱和/alpha 钳制。
- **C4 像素一致**：同意第 7.1 节定义：同质量的编码前 RGBA 逐字节一致；有损编码后的文件对比单列。
- **性能门槛**：8 位帧按第 7.2 节无可重复回退；高精度帧若 1080p 单发光层每帧增量超过 3 毫秒，或 Canvas float16 栅格比 8 位慢 30% 以上，先停下回报数据由 Claude 定，不自行加阈值或开关。

## 10. 设计审查后的裁定（10-31，优先于前文与第 9 节冲突处）

- **分两步，本票只做第一步**：GPU 效果链触发（glow、模糊类与 pose.blur、暗角、全能调色里的曲线/LUT、作者 `effects(t)` 返回的这些效果）+ 作者层栈 + 片段/嵌套/转场的浮点交接。**Canvas 渐变、阴影、混合模式的触发与 Canvas float16 全部移到第二步**（登记到以后再做第 14 项，等第 16 项做法 2 的 GPU 渐变/暗角/阴影标准件之后再评估是否还需要）。shaders 图：本步确认框架能否给浮点出口；不能就不触发（不另写适配）。
- **运动模糊不触发**（累积本已在高精度里一次写出）。
- **去钳制只给预乘的代码画面输入**；视频/图片素材输入保留 `clamp(rgb,0,1)`。8 位管线的 shader 模块文本逐字节不变，浮点变体另建模块；不复用 extendedRange，不改修图共用的生成器与 CPU 参照。补嵌套序列与 10 位素材帧的回归测试，证明现有浮点帧不变。
- **精度不进指纹**：精度是已散列内容 + 判定算法的纯函数，判定算法变化由 `VIDEO_EDIT_RENDER_ENGINE_VERSION` 覆盖；rgba16float 的渲染、混合、过滤是 WebGPU 核心能力，不加能力令牌。指纹与 `core/videoEdit/renderCache.ts` 不加精度字段，core 不依赖 engine 判定。
- **判定与会话历史无关**：作者实例的格式按“本帧任一可见层触发”决定；不按静止分组、粘性槽或上一帧状态决定。层栈默认 8 位，遇到首个触发层时向 CodeGpu 申请 16f 目标、拷贝已画部分后继续（不做两阶段准备帧，作者回调顺序不变）；片段链需求由文档里的效果列表直接求得。
- **作者滤镜按现行契约**：输入为 16f 时目标给 16f（author-shaders.md 已写明 target.format 可能是 rgba16float，10 位素材早已如此）；格式不匹配导致的失败要在错误里说明是格式问题，不静默。检查技能示例与内置滤镜有没有硬编码 rgba8unorm，有就改成按 target.format。
- **硬拒绝点全部列出并处理**：CodeGpu.texture 512MiB/8192、compositor.prepareImages 代码画面预算、renderer.checkInputBudget、generatorTargetCapacity（按实际字节）、spill 遇高精度抛错——内容触发后原来能渲染的帧不能因此报错；按容量规则改为按字节计、淘汰闲置与前视，浮点目标不走 bitmap spill。显存统计按字节（含每层持久画布）。
- **bitmapOf/BitmapBridge 交给 Canvas 作者的图片参数**：列为已知 8 位边界，本步不改。
- **8↔16 往返**：两档闲置纹理保留到帧边界，浮点管线可在首次用到时编译但要缓存；基准加“发光强度在 0 附近往返”的场景，记录卡顿与边界帧差异。
- 第 2.3 节第 4–5 条、第 5.3 节第 4 条、第 6.1 节第 1 条、第 8 节 C1/C2、2.1 表格中与本节冲突的内容按本节改写或删除。
