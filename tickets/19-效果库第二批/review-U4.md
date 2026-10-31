# 19-U4 故障 合并前审查（task/19-U4-故障，3 个提交 03309fe08 / e481def0c / 948677355）

## 结论先说：共享帧号改动对普通图层的影响

- **不含随帧效果的普通图层不会失去复用。** `authorEffectsFingerprint`（src/core/videoEdit/authorEffects.ts:128）只在效果定义声明了 `frameSeeded` 时才把帧号并入摘要；输出复用键（videoEditAuthorEffects.ts:34）、录制指纹（videoEditAuthorFingerprint.ts:110）、frameKey 指纹（:153）、调整层指纹（:18）都经过这一处。全仓只有 `film_grain` 与 `glitch` 声明了 frameSeeded，也只有这两个规划读 `frame.frame`（basicEffectPlanners.ts:68、engine/glitch.ts:141），所以别的效果改传真实帧号后像素和键都不变。
- 调整层的键里原来带 `adjustment.frame`，现在去掉了。但调整层的 contentKey 一直是 undefined，从不复用，所以没有影响。
- 预览、导出、预渲染指纹用的是同一个帧号：三处都取 `authorFrameNumber(info)`，info.time 都来自 `plan.context.time`（videoEditCodeSources.ts:464、videoEditCodeFingerprint.ts:104）。作者滤镜（:399）也一样。
- look 展开后 id 已经是 glitch，会带上帧号，正确。静止分组：带 effects 的层会补一个 pose，不进静止批组，这次没有改到。试画走正式渲染路径，一致。`prepare` 和精度判定里的 `frame: 0` 不影响画面，核实属实。
- 变化频率为 0 也逐帧重算：只发生在含故障的层上（原因见小问题 1），不是普通图层的性能回退。

## 重要

1. **`mode: 'static'` 且没有 frameKey 的代码素材里，故障（以及原来调整层里的颗粒）定在“最先渲染的那一帧”，结果取决于渲染历史。**（待确认：严重程度取决于作者实际用 static 的频率）
   - 位置：src/features/videoEdit/engine/videoEditCodeOutputKey.ts:78。`declared` 为 undefined（模块没写 frameKey）且 `program.mode === 'static'` 时，键固定为 `'static'`，不含时间。videoEditCodeSources.ts:491-493 命中后直接沿用上一张输出。
   - 出错的情况：作者写 `mode: 'static'` 的科技感标题，图层 effects 里放 `glitch({ rhythm: 60 })`。948677355 之后，普通图层按 `authorFrameNumber(info)` 规划，第一次渲染到哪一帧，就用那一帧的错法，之后所有帧都复用它。用户先拖到第 50 帧，再从头播放，看到的是第 50 帧的错法。导出和预渲染各自从自己的第一帧开始，所以和预览不一致。录制指纹（videoEditCodeFingerprint.ts:121）每帧都不同，又和实际像素不对应。
   - 为什么算重要：在这次之前，普通图层固定第 0 帧，结果是确定的，只是错。现在随宿主帧变化，却撞上 static 复用，确定性和“预览、导出一致”都不成立了。调整层里的颗粒在 U9 时就有同样的问题，属于原有，这次只是把它扩到了普通图层。
   - 建议（二选一）：① `mode: 'static'` 时随帧效果统一用固定帧号，例如 `authorFrameNumber` 对 static 返回 0，运行时与两条指纹同取；② 求值后的效果里只要有 frameSeeded，就不走 `'static'` 快捷键。我倾向 ①：改动最小，也符合 static 的语义。

## 小问题

1. **`frameSeeded` 只是布尔，强度为 0 或变化频率较低时也逐帧失去复用。**位置：src/core/videoEdit/authorEffects.ts:128，src/core/videoEdit/glitch.ts:42。
   - 变化频率 0：result-U4 已经列为已知取舍。
   - 更常见的是设计里推荐的用法“给强度打关键帧做出一下一下的爆发”。两次爆发之间 `amount = 0`，规划只有 copy（engine/glitch.ts:34），像素和静止一样，但摘要仍然逐帧不同。于是整个代码素材的输出复用全部失效（videoEditCodeSources 的 lastOutputs），故障层的效果链每帧都要重新编码。默认频率 60% 时，画面约 6 帧才变一次，也是每帧都算。
   - 只影响含故障的模块，结果仍然正确。用例 videoEditContentPrecision.gpu.test.ts:398 用 `[0,0,0]` 断言了 glitch-still 不复用，把这种多算固化进了测试。
   - 建议：把声明改成函数，例如 `frameSeed?(params, frame) => number | null`，返回本段编号；强度 0 或频率 0 时返回 null。规划与摘要都调用它，这样同一段内的帧可以复用。
2. **块很小、分辨率低时，外扩留得不够，错开的碎片在纹理边被截掉。**
   - 位置：src/features/videoEdit/engine/glitch.ts:39，`blockHeight = max(1, glitchBlockHeight × h)`；src/core/videoEdit/glitch.ts:34，外扩按没有夹到 1 像素的 `glitchBlockHeight` 算。
   - 出错的情况：`glitchBlockHeight × h < 1` 时，例如 1/4 预览下 h≈270、block_size ≤ 约 20，再加 `rgb_split = 0`。最大横移 12 像素，外扩只留约 6.5 + 1 像素。最终质量下 h 大，不会出现。
   - 建议：外扩里同样用 `max(1 / h, glitchBlockHeight(...))` 作块高。
3. **没有门禁保证“规划读帧号就必须声明 frameSeeded”。**
   - 948677355 之前，普通图层固定传 0，规划即使漏了声明也只是静止。现在传真实帧号，漏了声明会变成“像素随帧变，复用键不变”：拿到旧输出，预览与导出不一致。
   - U3（划痕，frame 空间）、U5（漏光）、U6（波动、置换准备接 `authorFrameNumber`）都会碰到这一点。
   - 建议加一条通用用例：图层空间的所有效果在两个帧号下规划，uniform 不同就必须声明 frameSeeded。位置：src/features/videoEdit/engine/videoEditAuthorEffects.ts:64-72。

## 原有问题（不是本次引入，故障扩大了它的可见范围）

1. **片段效果链里的随帧效果用的是序列的绝对帧号，但预渲染窗口的键只记相对位置。**
   - 位置：videoEditCompositeScene.ts:86 把序列帧 `frame` 传给 `runtime.builtin`。renderCache.ts:289-296 的窗口键只记 `clip.start - startFrame`，注释写明“同内容的副本可共用文件”。
   - 出错的情况：同一个片段带颗粒或故障，复制到序列的另一处，两个窗口键相同、共用同一个文件；而直接合成时两处的错法不同。导出遇到窗口已就绪就读文件，没就绪就现场合成，所以结果取决于缓存状态。
   - 同一函数第 84 行的注释说片段时钟让“移动片段保持观感”，帧号却没有照此处理。
   - 建议（待确认）：片段路径改传 `frame - clip.start`。这和作者图层按素材时间取帧号一致，result-U4 取舍 5 的代价也一并消掉了，但会改变已有颗粒的具体排布。
2. 第 1 条重要问题里，调整层颗粒在 static 模块中的同样表现，是 U9 时就有的。

## 已核对、无问题

- **WGSL**
  - 取样都在像素中心加整数偏移（偏移、分色、条带位移都取整），线性取样等于精确取样。
  - 越界返回透明，透明底不发黑；GPU 用例检查了“最亮通道 ≤ alpha 且 ≥ alpha−2”。
  - 压缩的缓坡外插可能让 alpha > 1，但最后经过 `premul`（adjustmentPasses.ts:39 会钳制 rgb），输出仍满足 RGB ≤ alpha。
  - 反色是预乘下的正确写法 `a − rgb`。
  - 种子限在 24 位，转成 f32 是精确的；格子坐标加 2^20 偏移，处理外扩区里的负坐标。
- **两种空间**
  - 片段与调整层没有 layer 上下文时，原点为 0、内容取整幅、h 取输出高度。
  - 图层按 `rasterOrigin` 与 `contentBounds × rasterScale` 锚定，块网格随图层移动。
  - 交互质量与最终质量的规划相同。
- **极端参数**：1×1 画面；内容为 0 时 `max(1, …)` 兜底；bars 2–200；帧号为负时夹到 0；强度 0 时只有 copy。
- **骨架**
  - 两个索引各加一行，有序目录表的风格化组排为 马赛克、故障、溶解显影，与第 13 节一致。
  - 用 `definePlanner`，`shared: [EFFECT_MATH_BLOCK]` 按块名引用，没有内嵌共享数学。
  - 格子尺复用 `dissolveCellSize`，距离尺复用 `dropShadowOffset`。
  - 作者工厂、`GlitchParams` 与生成产物一致。
  - 没有改到别的单元的效果文件。
- **参数**
  - 强度 0–100；空间量都按画面高度。
  - 软硬范围符合设计；`bars` 软 2–40、硬 2–200。
  - 按方式显隐用 `visibleWhen`；`seed` 不做动画。
  - 说明只有一份，写的是看得见的结果，没有算法词。
  - “色彩分离”提为主参数已经裁定。
  - “变化频率 60% 约每 6 帧”与公式 `1 + round(30 × 0.4²) = 6` 一致。
- **测试**
  - GPU 用例覆盖三种方式、相邻帧不同、同一帧可复现、频率 0 定住、强度 0 原样、透明边。
  - 复用用例覆盖普通图层与频率 0、复用与直出、交互与最终质量。
  - 指纹用例覆盖录制与 frameKey 两条路径。
  - 没有把清单或版本号抄进断言。
  - 我实跑了 videoEditAuthorFingerprint.test.ts 与 authorEffects.test.ts：27 项通过。GPU 用例没跑。
- **安全**：五条硬底线未涉及。

## 设计符合度

- 第 2.4 节：参数、默认值、显隐、工序（一道取样，没有额外显存）、外扩（压缩为 0）、“取样越界为透明”、“频率 0 完全静止”都符合。
- 和设计不一样的地方：块分三档且集中成横带、红青两份分色、压缩改为缓坡加均值、色彩分离为主参数，均已在 result-U4 获批。目视上看，这些取舍没有带来正确性问题。
- 第 12 节：没有持久格式变化，henji-effects 没有冻结，符合。
- 第 13 节：目录位置符合。
- 第 14 节：1080p ≤ 0.3 ms，result-U4 自测达标，我没有复测。
- 裁定 6：故障不在高精度触发表的要求里；没声明精度，输入是 16 位时保持 16 位，符合。

## 读过 / 没读到

- **读过**
  - 本单完整 diff：src 与 resources 部分。
  - glitch 两个文件全文。
  - videoEditAuthorEffects.ts、videoEditAuthorFingerprint.ts、videoEditAuthorRuntime.ts 的改动及相关上下文（调整层、普通层、静止分组）。
  - videoEditCodeSources.ts 输出键与复用段、videoEditCodeOutputKey.ts、videoEditAuthorPrograms.frameKey、videoEditCodeFingerprint.ts、videoEditCompositeScene.ts、videoEditCodeGpu.builtin、videoEditBuiltinEffectsGpu.prepare/render、videoEditRenderPrecision.ts、videoEditBuiltinEffectPasses.ts、basicEffectPlanners 的颗粒、renderCache.ts 窗口键、codeMaterialTiming 的时间来源。
  - design.md 第 2.4、4、12–14 节与裁定，result-U4、result-U9 的 frameSeeded 段落，U3/U5/U6 结果里的帧号段落。
- **没读到**
  - result-U0“审查修复 2”原文。骨架是否合规，按代码现状判断。
  - 效果库.md 规范全文：按 builtinEffects 注释与设计表核对。
  - GPU 用例没有运行，目视证据图没有查看。
  - Reality 与真实窗口：未运行。

## Claude 裁定（11-01）
重要：static 模式下随帧效果统一用固定帧号 0（普通图层与调整层颗粒都适用）。
小问题 1：frameSeeded 布尔改为函数 `frameSeed(params, frame) => number`，键与指纹并入返回值；故障返回段号、强度或频率为 0 时返回常量；颗粒返回帧号；同时改掉 main 上 U9 的用法，不留布尔与函数两套。
小问题 2：外扩按夹过的块高算。小问题 3：加通用门禁用例（两帧同参数规划不同 ⇒ 必须声明 frameSeed；frameSeed 相同 ⇒ 规划相同）。
原有问题：片段效果链里随帧效果改用片段自身帧号，复制的片段画面一致且与预渲染缓存一致。
