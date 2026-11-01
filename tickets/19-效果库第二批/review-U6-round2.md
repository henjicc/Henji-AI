# U6 变形 第二轮审查（增量 2992f2e9d、569fc99c0；基底 main ea972d1ec）

## 重要

1. **含变形效果的风格件不能再用在代码图层上（本轮 spaces 限定引入的回归）**
   - 位置：`src/core/videoEdit/warps.ts:52-55`（`WHOLE_PICTURE` 给边缘参数加 `spaces: ['clip','frame']`）；校验在 `src/core/videoEdit/authorEffects.ts:60-62`（`validateVideoEditLook` 逐键查空间）和 `:86`、`:108`（`normalizeVideoEditBuiltinParams(..., 'layer')`）。
   - 触发输入：片段上加镜像、膨胀、旋转扭曲、波动、置换或边角定位中的任意一个，再存成风格件，然后在代码图层里写 `look({ name })`。
   - 原因：片段效果默认存完整参数表（`videoEditCompositing.ts:102-104` 走非 sparse 分支；“恢复默认”`:97` 用 `videoEditBuiltinDefaults`），所以 `edges: 'clamp'` 总在 params 里。风格件按原样复制（`videoEditEffectPresets.ts:48-50`）。图层空间校验看到 `edges` 就报“参数只能用于片段、整帧效果”，整段 look 解析失败，代码图层渲染报错。第一轮代码里边缘没有 spaces，这条路是通的。
   - 任务第 4 点“旧工程里图层上存的非透明边缘值按容错读取”不成立：图层上能存边缘值的地方只有风格件和作者代码，两处都是直接抛错，没有容错。分支期间写过 `wave({ edges: … })` 的代码素材也一样报错（main 上没有这类数据，影响小）。
   - 建议（由 Claude 定）：规划已经在 `warp.ts:42`（`frame.layer ? 0 : …`）对图层强制透明，所以图层上的边缘值本来就不起作用。可以有两种改法：
     - 读风格件时，丢掉图层空间里不起作用的键，或把这类键当作容错读入；
     - 边缘不用 `spaces` 做强校验，只在图层面板、d.ts 里隐藏。

     改法会碰 U0 的空间契约（`effectRegistration.test.ts:61-66` 钉着“风格件带片段专用键就报错”），所以要先定契约。

2. **[投影/发光, 边角定位] 的透视外推会超出图层纹理，影子或光晕被切出一条直边**
   - 位置：`src/core/videoEdit/warps.ts:265-268`（`cornerPinBleed`），累加方式在 `src/core/videoEdit/authorEffects.ts:114-119`。
   - 触发输入：代码图层 `[shadow(), cornerPin({ tl_x: 30, tr_x: 70 })]` 这类近大远小的地面透视（底边不动，上面两角往里收），投影用默认值。
   - 原因：
     - 外扩的算法是把前面效果的外扩加到内容框上，再把变形参数原样套在这个放大的框上（角点按放大框的百分比取）。这对仿射变形近似成立。
     - 对透视不成立：着色器用真实内容框的单应矩阵，框外一圈的影子按射影外推，越靠近近边放大得越多。
     - 以前拆出的影子不经过变形，所以没出过问题。本轮让影子跟着变形后，常见用法就踩到了。
   - 数值复刻：内容 600×340，1080p 参考，默认投影外扩约 45 px，边角定位声明外扩为 0。
     - 30/70 地面：影子实际伸出约 140 px。纹理边上被切处的影子 alpha 约 30/255，看得出一条直边。
     - 15/85：约 68 px，切口 alpha 约 3.6/255，几乎看不见。
     - 测试里的 `tr_x: 160, br_y: 180, bl_x: -40`：伸出约 538 px，纹理只有约 459 px。
     - 透视很强时，外推还会越过地平线（`w ≤ 0`）。
     - 脚本：`C:\Users\15212\AppData\Local\Temp\claude\D--VibeCode-Henji-AI\e19f1fe6-5883-4354-87cd-7f5b13385c59\scratchpad\u6r2\pin2.mjs`、`C:\Users\15212\AppData\Local\Temp\claude\D--VibeCode-Henji-AI\e19f1fe6-5883-4354-87cd-7f5b13385c59\scratchpad\u6r2\pin3.mjs`。
   - 现有用例测不到：`videoEditStyleEffects.gpu.test.ts` 新增的 [投影, 边角定位] 用的是固定 pad 128，而且四角是往里收的。
   - 同一根因的原有部分：第一轮就有的 [模糊/色差, 边角定位] 主图同样会被切。这次让拆出的光与影也受影响，碰到的情况多了。
   - 修法方向：`cornerPinBleed` 拿到前面效果的外扩量，把 `[-pad, W+pad]²` 的边界经同一个单应矩阵映射后求外扩；越过地平线时封顶。这需要 `authorEffectBleed` 把前面的外扩量交给 bleed，而不只是给一个放大的框。其他变形（镜像、旋转扭曲中心不在 50% 时）也有放大框与真实中心的偏差：镜像大多偏保守，旋转扭曲待确认，量级远小于边角定位。

## 小问题

3. **调整层可以用边缘参数，作者类型里却没有（待确认）**
   - 位置：`scripts/generate-author-effects.ts:21` 按定义的 `space` 过滤参数，变形定义是 `layer`，所以 `MirrorParams` 等类型删掉了 `edges`。
   - 触发输入：调整层 `adjust: () => [mirror({ edges: 'mirror' })]`。运行时接受（`'frame'` 在 spaces 里），但作者类型检查报“没有这个属性”。
   - 如果类型检查拦住提交，“调整层开放”就只对风格件和助手写入成立。可以改成生成器为调整层另出参数类型，或说明里不提调整层。

4. **流动、置换·噪声在每张拆出的下层上都重算一次位移场**
   - 位置：`videoEditAuthorEffects.ts:87-91`。
   - 位移场与输入无关，同一份规划对主图和每个下层各跑一次 `warp_field`。只在“有拆出的光影 + 噪声变形”时多付，开销不大，可以以后复用同一张场。目前不影响正确性。

5. **[投影, 重复阵列] 的影子都压在所有副本下面（语义提示，待确认）**
   - 副本的影子和内容分开合成：拆出的影子最后统一垫在下面，所以间距小时，副本 A 的影子不会落到相邻副本 B 上。AE 里先投影再平铺时，影子会盖住邻格。多数画面看不出来，只在说明里需要时补一句。

## 重点核查结论

**1. 光与影经过后续变形（videoEditAuthorEffects.ts:85-92）**
- 三个组合 [投影, 边角定位]、[发光, 波动]、[投影, 重复阵列] 的取样方式正确：图层上 `warpTap` 不夹取，`warpTexel` 按零边框取整张纹理，框外的影子和光照样被重排。
- 光与影的合成语义不变：光是零 alpha 的预乘值，重排、`effect_mix`（纯线性插值）、重复阵列的淡出都只缩放预乘值，不反预乘。合成仍走原来的 `effect_over` 链，光叠加、影普通遮挡。
- 边角定位四角拧成交叉时走 `effect_opacity`（a=0），影子也跟着清零，与“内容消失”一致。
- 按自身亮度置换不标 `remap`，正确。`copy` 不标，等价。
- 非变形效果的路径没有变化：全仓只有变形规划设置 `remap`，其他效果不进新分支。
- 调整层不受影响：调整层会重新规划成不拆分（`:70-72`），`underlays` 永远是空的。片段效果链（`videoEditBuiltinEffectsGpu.ts:107`）不读 `remap`。
- 纹理尺寸：所有中间纹理与主图同尺寸、同格式，规划复用同一份几何。外扩问题见第 2 条。
- 性能：只有“`remap` 且已有下层”时，每个下层多一次规划编码（强度不满时再多一次混合）；没有拆出光影或没有变形时为零。

**2. effectHash**
- 与 WGSL `hash(vec2u, seed)` 的乘数与移位逐项一致。`seed = 0` 时多出的一项为 0，所以 `effectHash(a, b)` 与原来故障的 `mix32(a, b)` 完全相同，故障的结果不变。
- `seedOffset(0)`：新旧两种算法都得 0，所以溶解显影、纸张、划痕（后两者在 main 上，U3）在种子 0 时不变。三者默认种子都是 0；溶解类过渡不开放种子，固定为 0，也不变。
- 种子非 0 的已有工程会换一种排法。这只改动静态种子到偏移的换算，`frameSeed`（故障段号、划痕帧种子、胶片颗粒等）没有改动。指纹与缓存键只看参数和 `frameSeed`，不看散列结果，所以契约与缓存键的语义都不变。没有找到按参数落盘的剪辑渲染缓存，不需要升缓存版本。
- 旋转扭曲同心环种子 0 的结果、流动和置换的偏移都变了，但它们是本单新增的效果，没有旧数据。

**3. 速度时钟**
- 波动、置换在 `warp.ts:354、356` 用 `effectClockSeconds(frame.frameDuration, warpFrameSeed(params, frame.frame))`。全仓已没有 `shaderTimeSeconds` 和 `clockedEffects`，也没有残留的自建时钟。
- `warpFrameSeed` 在速度 0、数量 ≤ 0 或按亮度置换时返回 0，此时规划与时间无关；其余情况返回帧位置，规划只随“位置 × 帧时长”变。帧时长已进 `encode` 的缓存键。精度判定的规划传 `frame: 0`，不会触发缺帧时长的报错。
- 漂移取余经核对正确：
  - A、B 是 (289, 0) 与 (0, 289) 去斜后的格子周期，|A| = |B| = |A+B| ≈ 235.97。流动两层方向 (A+B)/|A+B| 与 B/|B|，和着色器常数一致。
  - 置换方向 A+4B ≈ (−16.4, 850.6)/850.8，与 `(-0.0192, 0.9998)` 一致；细节层用 3 倍，是整数倍，所以连续。
- 慢放用例可信：0.5 倍时 30、31、32 三帧都要求不同、复用不命中，预览与导出逐像素相同。速度 400、幅度 400 的方波，每半帧相位走约 0.067 周，取整就会让相邻帧相同。实现说明写了反证。

**4. 边缘与 spaces**
- 图层强制透明有两层保证：参数层用 spaces，规划层 `gridOf` 里 `frame.layer ? 0 : …` 兜底。
- 着色器去掉了“框内才夹”的分支。片段和调整层的内容框就是整张纹理，夹取的结果与改动前一致。
- 片段面板、助手说明（`describeVideoEditParams` 带 `spaces`）的展示正确。
- 问题见第 1 条（风格件与旧作者代码没有容错）和第 3 条（调整层的作者类型）。

**其余**：同心环外扩按 `R·(1 + 柔和度/(2·环数))` 修正，与着色器的过渡带一致；镜像说明已改。

## 读过 / 没读到

- 读过：两个提交的完整 diff；`videoEditAuthorEffects.ts` 全文；`warp.ts` 的规划与 WGSL 映射；`warps.ts` 各个外扩函数；`authorEffects.ts` 的 bleed、指纹、look 校验；`builtinEffects.ts` 的空间校验；`effectRegistration.test.ts` 的空间契约；`videoEditEffectPresets.ts` 与 `videoEditCompositing.ts` 的参数存法；`dissolveReveal`、`paper`、`scratches`、`glitch` 的种子用法；`basicEffectShaders` 的 mix、over；`videoEditRenderPrecision`；生成器的过滤；result-U6 末两节；review-U6 的裁定。
- 没做：没跑 GPU，也没跑 vitest。第 1 条按代码路径确定；第 2 条按 JS 复刻单应矩阵估算，没上 GPU 实测。
