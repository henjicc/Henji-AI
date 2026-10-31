# 19-U3 质感 审查报告

审查对象：`D:/VibeCode/Henji-AI-t19u3`，分支 `task/19-U3-质感`，单提交 `6bd989bb1`，`git diff main...HEAD -- . ':!tickets'`（24 个文件）。
只读审查；只跑了一个精确用例 `effectRegistration.test.ts`（6 项通过，含 U4 的 frameSeed 通用门禁）。没有跑 GPU，也没有启动开发版。

## 重要

### 1. 显像管用的通用 `opacity` 不在会话键里：同一会话内框架会重建合成，画面取决于渲染历史；它还会残留到 `shaders.CRTScreen`

- 位置
  - `src/core/videoEdit/retroScreen.ts:56`：`opacity: strength`
  - `src/features/videoEdit/engine/shaderEngines/shaderGraphCache.ts:31-46`：`compositionKey` 只收编译期属性、`compileTimeWhen` 落在哪一侧、时钟快慢和 `blendMode`
  - `src/features/videoEdit/engine/shaderEngines/shaderGraphSession.ts:244`：省略 opacity 时下发 `undefined`
- 根因（依据 `node_modules/shaders/dist/core/index.js`）
  - 第 2220 行：框架的结构哈希包含 `aopac:${id}:${(opacity ?? 1) < 1}`。opacity 小于 1 和等于 1 是两份不同的合成。
  - 第 2524 行：`metadata.opacity !== void 0` 才更新。下发 `undefined` 时保留旧值。
  - 显像管是第一个用通用 opacity 的片段效果，所以会话缓存“按结构、编译期属性、混合模式、时钟快慢分会话”的规则在这里漏了一类。
- 出错的输入或状态
  1. **预热后的第一帧（默认参数就会触发）**：预热用的图没有属性，合成按 opacity=1 建好。默认强度 60 时 opacity 是 0.6，会话键与预热时相同，于是命中预热会话，并在会话内重建合成。宿主画面纹理在 `hostDefinition` 里随重建换成新的，而本帧的上传已经写进了旧纹理。结果是这一帧画错（透明或旧画面）。
  2. **两段显像管片段一段强度 100、一段强度低于 100，交替渲染；或强度关键帧跨过 100**：两种合成在同一会话里交替。框架按哈希缓存旧合成，`hostTextures` 却只指向最后建的那份，旧合成取到的是旧画面。顺序导出与预览跳帧的历史不同，结果对不上。这正是 U2 用分会话修掉的那类问题。
  3. **先渲染“老式画面·显像管”（0.6），再渲染同结构的 `shaders.CRTScreen`**：后者的属性不含 opacity，会话下发 `undefined`，框架保留 0.6，`shaders.CRTScreen` 被按 60% 混回原画。
- result-U3“接入 main”一节说“U2 的 updatedMetadata 已在 main，这个问题不再成立”，与 main 上的代码不符：main 上没有这个函数，`metadata()` 仍返回 `undefined`。
- 建议修法
  - `compositionKey` 按框架的规则并入 `(opacity ?? 1) < 1`，和 `blendMode` 写在同一处。
  - `metadata()` 在省略 opacity 时下发 1，省略 visible 时下发 true，保证能复位。
  - 补一个 GPU 用例：同一缓存里显像管强度 100 与 60 交替渲染，外加预热后第一帧，逐位与新会话直出比较，`hostBuilds` 不增加。
- 拿不准的部分：没有在 GPU 上复现，“透明帧还是旧画面”待 GPU 用例确认。会话内会重建合成、opacity 会残留，这两点从代码可以确定。

## 小问题

### 2. 显像管把透明处变成不透明，说明里没提

- 位置：`node_modules/shaders/dist/core/CRTScreen-hEH-JNRd.js:121`，滤镜最后一步是 `opaque()`，把 alpha 置成 1。
- 出错的输入：透明底的片段（PNG、透明标题、代码素材）加“老式画面·显像管”。默认强度 60 时，原本透明的地方变成约 60% 不透明的黑底，盖住下层轨道。
- 这是组件原有的行为，`shaders.CRTScreen` 也一样；录像带保留 alpha，没有这个问题。
- 建议二选一：按原画 alpha 裁回；或在效果说明里补一句注意事项，例如“显像管会把透明处填成黑色”。
- 同处一并考虑：胶片模拟的说明写了“在 8 位里计算，暗部可能有色带”，老式画面的说明没写，只在代码注释里提到。

### 3. result-U3 的两处说法与代码不符（文档准确性）

1. “速度以组件属性 speed 传给框架，会话缓存按 shaderClockRateProps 自动并入键”不成立。组件库里 VHS 的 `speedProp` 是 undefined，`shaderClockRateProps(VHS)` 返回空。实际上 VHS 的 `speed` 是普通 uniform，`tapeWarp` 在着色器里直接用 `time` 和 `speed` 计算，不在会话里累加，所以结果仍然确定、不依赖渲染历史，不需要分会话。结论碰巧没错，依据写错了。
2. “显像管 opacity 残留不再成立”不成立，见第 1 条。

### 4. 组件范围换算有两份实现

- `src/core/videoEdit/retroScreen.ts:14-22` 的 `range` / `linear` / `logarithmic`：缺范围时报错。
- `src/core/videoEdit/filmLook.ts:43` 的 `scale`：缺范围时静默按 0–1 换算。
- 两份做同一件事，缺范围时的行为却不同。result-U3 自己也建议合并时收成一份放进 `shaderGraph/effects.ts`，这次没有做。

### 5. 又多一份十六进制颜色解析

- `src/features/videoEdit/engine/halftone.ts:26` 的 `encodedColor`。
- 同类实现已有 `basicEffectPlanners.ts:12`、`dissolveReveal.ts:46`、`dropShadow.ts:26`、`glow.ts:40`、`lightSweep.ts:24`、`stroke.ts:42`、`videoEditBuiltinEffectPasses.ts:16`。重复是原有的，本单只是又加了一份（带 alpha 的版本）。
- 建议把 `encodedColor` 作为唯一入口，放进共享模块，后续由 U10 或 U16 收拢；本单可以不改。

### 6. 纸张自带一份值噪声（待确认）

- `src/features/videoEdit/engine/paper.ts:47` 的 `paperNoise`，与共享块 `EFFECT_MATH_BLOCK` 里的 `noise` 用同一种取格与平滑插值。区别有两点：多返回解析梯度；值域是 0..1 而不是 −1..1。
- 共享的数学函数没有带梯度的版本，所以放在本效果里有理由。如果以后还有效果要带梯度的噪声，应该提进共享块。是否算“同功能第二份实现”，由总调度判断。

### 7. 分支没有接在最新 main 上

- 合并基准是 `024928d46`，main 现在在 `d3f0cda99`，多了 U14 的 `0d4401210`。
- 两边改的文件没有交集，rebase 应该能机械完成。但 result 说“已 rebase 到最新 main”不准确，合并前需要再 rebase 一次，并重跑精确用例。

### 8. 抖动点阵“像素大小 0 一个屏幕像素”只在约 1080p 下成立

- 位置：`src/core/videoEdit/ditherPattern.ts:20`。
- 换算是 0.1% H 再取整：1080p 下为 1 像素，2160p 下为 2 像素。建议改成“0 约为画面高度的 0.1%，最细的点”。

### 9. 测试覆盖与断言

- GPU 用例覆盖了半调的原色、双色、彩色印刷，抖动点阵的方格与蓝噪声，纸张的强度 0、默认与外扩，划痕的同帧相同、停留 100、数量 0，老式画面的两种方式与强度 0。
- 没有覆盖：半调的线条形状、抖动点阵的原色方式、显像管强度跨过 100 以及预热后第一帧（第 1 条）。
- `videoEditStyleEffects.gpu.test.ts:514` 把“像素大小 60 约 9 像素”写死成 `x - x % 9`，换算一改用例就会失败，属于钉住合法变化。建议改成用 `ditherPixelSize` 计算点的边长。
- 没有把登记表、版本号抄进断言。

## 原有问题

- 预热（`shaderGraphCache.ts:102`、`effects.ts:135`）只按基础参数选组件，用组件默认属性建会话，不跟关键帧。编译期属性不是默认值的效果，正式渲染时会落到另一个会话，预热白做，但结果正确。result 已经列出“方式”做 hold 关键帧的情况。第 1 条修好后，这里不会再出错，只会少一次预热。
- `shaders.Halftone`、`Dither`、`Paper`、`Scratches`、`VHS`、`CRTScreen` 仍留在效果目录（`effectCatalog.ts` 的 shader_stylize / shader_texture 组）。与 U2、U4 的做法一致，按第 13 节由 U16 进 `SAME_AS_BUILTIN`，不算本单的缺陷。

## 逐项核对（没有发现问题的部分）

- **规划与 WGSL**
  - 半调：格心落在 2×2 纹素公共角，原点不大于 0，小图盖满输入；面积曲线在网点与平均色调两条路径上一致；格子不到 2 像素时只走一道且不取样小图；彩色印刷的分色、网角与套色偏移方向正确；`acos` 已夹紧。
  - 抖动点阵：点格按内容左上角取整锚定，`before` 与 `origin` 推导正确；Bayer 位交错是标准公式；负索引正确取模；边长为 1 时直接读输入。
  - 纸张：解析梯度的链式法则正确（纤维对 warp 的导数被忽略，属于可接受的近似）；挪动封顶在外扩以内，外扩为挪动距离加 1 像素；强度 0 时只含 copy。
  - 划痕：盒式覆盖、左中右三条竖条足够；停留 100 与帧号无关；种子为 0 时规划只含 copy。
- **图层与片段两种空间**：都按 `contentBox` / `rasterOrigin` 锚定，H 取 `referenceSize.height × rasterScale`，片段取输入高度，与 dissolveReveal、glitch 相同。
- **1×1 与极端参数**：没有除零或越界。
- **随帧效果**：只有划痕声明 `frameSeed`，规划只读它的返回值，帧号用的是片段内帧号，通用门禁通过。其余三个原生效果是静态的。老式画面走着色器时钟：VHS 在着色器里无状态地计算 `time × speed`，结果确定。
- **骨架约束**
  - 两个索引和有序目录表各加一行，质感组顺序与第 13 节一致。
  - 四个原生规划都用 `definePlanner`；共享函数按块名引用（`CELL_AVERAGE_BLOCK` 是具名块）。
  - WGSL 函数名全仓唯一；蓝噪声表、种子哈希、格子尺、距离尺都复用现有实现。
  - 越界改动只有三处，都是接线必需：`dissolveReveal.ts` 导出两个函数、`shaderGraph/effects.ts`、`videoEditCodeGpu.ts`。
- **着色器图会话的分会话规则**
  - 封装接口 `wrappedComponent` 按方式选组件：录像带与显像管是不同的结构键，各走各的会话。
  - 两个组件都没有编译期属性，也没有 `compileTimeWhen`；`blendMode` 固定为 normal；VHS 的速度是无状态 uniform，不必按时钟分会话。
  - 唯一的漏洞是通用 opacity（第 1 条）。
  - 预热改用 `shaderGraphStructureKey` 去重，与转场同一规则。`shaderGraphEffectSpec` 只有两处调用，都已传入参数。
- **参数**
  - 分组、软硬范围、默认值与显隐都符合 design 2.3 和已批准的取舍。
  - 空间量按画面高度换算。划痕竖条按宽度 4%、显像管条纹按宽度，这两处是 design 明确的写法。
  - 强度类为 0–100；没有单参数成组；按方式显隐都用 `visibleWhen`。
  - 抖动点阵“颜色”组有 5 项，超出规范建议的 2–4 项，但这是 design 定的。
- **安全五条底线**：没有涉及。

## 设计符合度

- 第 2.3 节：五个效果的参数、路线、空间、工序与观感目标基本符合。取舍都在 result-U3“取舍”一节里，已批准；其中半调半径的修正、退成平均色调、纸张边缘按纹理格子换算，正确性复核没有发现问题。
- 第 12 节：作者库生成了 `halftone`、`ditherPattern`、`paper`、`scratches` 四个工厂，没有冻结 henji-effects；不改持久格式。符合。
- 第 13 节：目录位置与顺序符合；来源组件的撤下留给 U16。
- 第 14 节：实测耗时都远低于目标（4090 上测得），老式画面只记录、不设目标。符合。
- 裁定 2（封装效果只上片段）：符合。不符合的地方只有第 1 条：显像管的强度借用了框架的通用 opacity，使会话规则失效。

## 读过与没读到的范围

- **读过**
  - 本单 diff 全部，包括两份生成文件中本单新增的部分。
  - `shaderGraphCache.ts`、`shaderGraphSession.ts`（与本单相关的部分）、`shaderGraph/spec.ts` 的会话与时钟部分、`shaderGraph/effects.ts`、`filmLook.ts`、`builtinEffects.ts` 的定义接口、`effectPlanner.ts`、`effectShaderMath.ts`、`authorEffects.ts` 的外扩部分、`videoEditAuthorRuntime.ts` 的调整层部分。
  - shaders 框架中 VHS、CRTScreen 的组件源码，`tapeWarp`、`phosphorMask`、`opaque`，以及 `updateNodeMetadata` 与结构哈希。
  - design 第 0、1、2.3、12–16 节与裁定、result-U0“审查修复 2”、result-U4“审查修复 1”、result-U3 全文、效果库.md“参数与说明规范”。
- **没读到**
  - 执行器 `videoEditBuiltinEffectsGpu.ts` 的纹理分配细节：小图 `tap` 的 uv 换算假定分配的是精确尺寸。
  - effect-preview 脚本、U14 改动的内容。
  - `.tmp/U3-evidence` 目视图（不在审查范围，也没有打开）。
  - 没有在 GPU 上复现第 1 条。

## Claude 裁定（11-01）
1. 会话键按框架规则加“不透明度是否小于 1”，省略时下发 1 / 可见 true；补强度 100 与 60 交替、覆盖预热后首帧的 GPU 用例。
2. 显像管按原画透明度裁回；老式画面说明补一句 8 位可能有色带。
3. 改正 result-U3 两处错误依据。4. 组件范围换算合成一份共用函数（缺范围报错）。
5. 半调颜色解析复用已有实现；现存 7 份重复列进清理清单。6. 共享 noise 补带梯度的变体，纸张改用它。
7. 抖动点阵“0 一个屏幕像素”改为各分辨率都对的说法。8. 补半调线条、抖动原色、显像管强度跨 100 的用例；测试点边长改用 ditherPixelSize 计算。
原有问题：预热不跟关键帧（结果正确，不改）；被合并的着色器条目由 U16 撤下。
