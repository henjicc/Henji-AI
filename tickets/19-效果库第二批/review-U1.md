# U1 模糊补旋转与范围：合并前审查

审查对象：`D:/VibeCode/Henji-AI-t19u1`，分支 `task/19-U1-模糊补全`，提交 `c119dc8e7`（`git log main..HEAD` 只有这一条），diff 为 `git diff main...HEAD -- . ':!tickets'`，共 9 个文件。

## 重要

无。

## 小问题

1. **范围·均匀的外扩按整幅高斯算，但金字塔的核尾巴更长（待确认）**
   - 位置：`src/core/videoEdit/blur.ts:121-122`（`blurBleed` 的 default 分支，注释写“外扩照整幅算”）。
   - 什么情况下出错：图层空间，`range` 为渐进或移轴，预览用 interactive 质量（`gaussianSupport` 只给约 3σ）。最糊处的结果是第 N−1 层和第 N 层按 t 混合，σ_N 可以到约 2σ，所以尾巴比同 σ 的高斯重。按 `blurRangeLevelSigma` 算：3σ 外的单侧尾巴占 0.7%–1.2%（σ = 2.5、5、10、20 px 时 t 分别约 0.44、0.34、0.31、0.30），同 σ 的高斯只有 0.135%；到 4σ 时是 0.06%–0.24%。
   - 后果：纹理边缘会切掉约 1% 的 alpha，大块不透明图层外面可能出现一圈很淡的硬边，大约 2–3/255。作者运行时会把外扩向上取整到 16 或 64 的倍数（`videoEditAuthorRuntime.ts:509`），大多数情况被盖住了；只有所需外扩正好在 64 的倍数以下时才露出来，比如 interactive 下 σ ≈ 20 px，外扩 64 ≈ 3.2σ。导出用 final（4σ），影响更小。
   - 这条是数值估算，没有在 GPU 上实测。建议外扩改按金字塔实际用到的最粗层（σ_N）算，或者至少按 4σ 算。

2. **GPU 用例没有覆盖镜头·范围的跨层混合**
   - 位置：`src/features/videoEdit/engine/videoEditBuiltinEffects.gpu.test.ts:978-982`。
   - 镜头·范围只测了 m = 1，也就是 `range_y: -100, range_falloff: 0`，这时与整幅逐像素相同。新写的逻辑里最容易出错的是 `blur_lens_band` 在相邻两层之间按帽形权重累加（0 < m < 1）以及层号钳制，这一段目前只靠实现者目视（`lens-tilt-night.png`）。旋转只测了模糊度 100 和 200，默认的 40 没有 GPU 用例。
   - 建议：加一条 0 < m < 1 的断言，比如过渡带上逐行半径或反差单调、层与层之间没有跳变。护的是“层间无接缝”这个观感目标。

## 原有问题（不是本单引入，不并入本次）

- `src/features/videoEdit/engine/blur.ts:165`：`farthest` 按纹理四角（含外扩）定道数，设计写的是内容四角。只会多算道数，不影响画面。放射本来就是这样，旋转照搬了。result-U1 已列明。
- `src/core/videoEdit/blur.ts:142-148`：不分组的主参数有 8 个（模糊度、方式、模糊方向、角度、中心 ×2、亮点加亮、重复边缘像素），规范是 2–4 个。只是同一时刻按方式显隐后可见的少一些。这是 ticket 11 留下的布局。
- 着色器 `shaders.AngularBlur`（`shaderGraph/zh.json` 里叫“旋转模糊”）、`TiltShift`、`ProgressiveBlur` 还在目录里（`effectCatalog.ts:19`），和新别名并存，搜“旋转模糊”会搜到两条。按第 15 节文件所有权，这归 U16，不算本单缺陷。

## 逐项核查结论（没发现问题的部分）

1. **正确性**
   - 旋转：圆弧取样按像素算（`v.position` 与中心都是目标像素，最后除以 `u.size`）。各道转角合计 ≤ ±θ/2，旋转复合是精确的。外扩取内容四角的圆弧端点，加上经过 0/90/180/270° 的点，`quarter` 从 −4 到 4，在 half ≤ 101.25° 时覆盖够。我自己算的最坏情况（1080p 整幅、中心在角、模糊度 450）外扩约 2096 px，小于一个对角线，不会撑到设备上限。中心在图层上走 `contentPoint`，锚在内容框里。放射改成复用 `contentPoint` 后，与 main 逐项等价。
   - 范围·均匀：逐项核对过降采样基址 `(floor(pos) − 本层边距)·2 − 2 + 源边距`、6 抽头权重、7/4 方差、B 样条放大的 `p = position·0.5 − 0.5`、cell 与边距偏移、`c.w = 2^level / H` 下纹素中心到全分辨率的换算、各道 a/b/c/layer 的布局（16 + 8 = 24 个 float，执行器写 24 个 float 的 uniform）。`blurRangeLevelSigma` 的解析式我重新推导过，(7/12 + 4/9)(4^k − 1) = (37/36)(4^k − 1)，成立。顶层停在 1 像素时 t 钳在 1。1×1 返回复制。清楚处 finish 原样返回 base。线性光换算用有符号的 `cgLin`/`cgEnc`。零 alpha 的取舍与现有 `gaussian_linear` 一致。中间纹理是 `linearScratch`，rgba16float，没有 `resolvedGaussian`，所以不会落进高斯的 backing 视口路径，`textureDimensions` 就是登记尺寸（`take` 按精确尺寸复用）。
   - 范围·镜头：各层帽形权重在 [0, top] 上合计为 1。m = 1 时层号等于 `wanted`，与 `planLensBlur` 选层相同。纹理缩到 1 像素时按 top 钳制。第 0 层、清楚处返回原像素，粗层原样传下去。
   - 精度：非 copy 规划都声明浮点，`videoEditEffectNeedsFloat` 对新方式照常生效。
2. **缓存与确定性**：新增的工序都不读帧号。镜头的旋转噪声只按像素位置算（原有逻辑，不含帧种子），所以不需要 `frameSeeded`。U9 还没进 main，本单也没有需要接入的项。范围路径不读 quality，预览与导出走同一份规划。图层上金字塔网格的相位跟随纹理原点，作者运行时外扩取整到 16 或 64 的倍数，64 px 以内的层相位稳定，不会因模糊度动画逐帧跳动。
3. **骨架约束**：两个索引和 `effectCatalog.ts` 都没改，模糊早已登记。`BLUR_PLANNER` 用了 `definePlanner`，`shared` 引用 `COLOR_MATH_BLOCK`、`EFFECT_MATH_BLOCK`，WGSL 里没有内嵌共用数学，`ramp`、`bsplineWeights`、`cgLin` 都从共用块取。改动没有碰到别的单元的源文件。`Planner` 替换了文件里自带的记录器，`planLensBlur`、`planUniformBlur` 的工序与 uniform 和 main 等价，`planAuthorDefocus` 不受影响。13 点降采样没有复用 `glowBoxes`，result-U1 的“取舍”写明了理由（RGBA、边缘规则、2 的幂网格），这条已批准。
4. **参数**：分组、软范围与硬范围、默认值、显隐都与设计 2.1 一致。过渡在 range ≠ full 时显示，模糊方向只在整幅时显示，这两处偏离已批准。位置的硬范围 −100–200、软范围 0–100。空间量按 H 换算，位置按内容框换算。说明一份，没有算法词。`visibleWhen.all` 的写法正确；面板取值先经过 `resolveVideoEditBuiltinParams` 补默认值，旧存档没有 `range` 时按整幅显示与渲染。三份作者类型与生成结果一致。范围组有 6 个参数，超过规范的 2–4 个，这是设计表定的。
5. **测试**：规划单测覆盖旋转的道数与间距、范围层数、图层锚点、模糊度 0 只复制，我本地精确跑过，12 项通过。两个登记测试把手抄的默认参数清单改成了 `videoEditBuiltinDefaults`，减少了抄清单。断言里没有抄清单或版本号。GPU 用例按要求没有跑。
6. **同源**：没有改共享实现，`Planner`、执行器、共用 WGSL 块都没动。`lensLevels` 与 `blurLensDisc` 是从本文件现有的镜头实现里抽出来的，另一个调用方 `planAuthorDefocus` 走的工序不变。

安全：五条硬底线不涉及。

## 设计符合度

符合第 2.1 节（方式、参数表、显隐、旋转与范围工序、外扩定义）、第 12 节（没有持久格式变化，henji-effects 留给 U16 冻结）、第 13 节（模糊仍在“模糊与锐化”，目录没动）、第 14 节（result-U1 记录的 GPU 时间在目标以内，显存与设计估算的偏差已说明）。也符合 U0“审查修复 2”的接入说明和 Claude 裁定（11-01）。与设计不同的几处都是“取舍”里已批准的，只有小问题第 1 条（外扩）可能和“过渡”取舍以外的金字塔尾巴有关，待确认。

## 读过与没读到的范围

- 读过：完整 diff 里的两份 blur 源文件；三份生成类型（逐行比对 `author-effects.d.ts` 与 `effects-library.d.ts` 的头 40 行）；四份测试的 diff；design.md 第 0、1、2.1、12–16 节与裁定；result-U1.md 全文、result-U0.md“审查修复 2”、result-U9.md 的 frameSeeded 段；效果库.md“参数与说明规范”；执行器 `encodePlan` 与 `take`、`effectPlan.ts`、`parameterVisibility.ts`、`effectIncludes.ts`、`videoEditRenderPrecision.ts`、作者运行时外扩取整段、glow 的网格对齐、共用 WGSL（`adjustmentPasses`、`effectShaderMath`、`basicEffectShaders`）。
- 没读到或没跑：GPU 用例（按要求不跑）、`.tmp/U1-evidence` 目视图片、Electron 实机；AGENTS.md 以外的 architecture.md、testing.md 只按条目核对，没有通读；效果预览页脚本只确认了它从定义生成。

## Claude 裁定（11-01）
小问题 1：外扩按金字塔实际用到的最粗层计算（根因修，不靠提高质量档），补最坏情况测试。小问题 2：补镜头·范围跨层连续与旋转默认 40 的 GPU 用例。
原有问题：farthest 按纹理四角定道数只多算不影响画面，不改；模糊不分组主参数 8 个（ticket 11 布局，规范 2–4 个）记给 U16 目录收尾时整理；着色器旋转/移轴/渐进条目撤下归 U16。
