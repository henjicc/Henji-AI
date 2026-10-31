# 19-U2 颜色 合并前审查（第 1 轮）

审查对象：`D:/VibeCode/Henji-AI-t19u2`，分支 `task/19-U2-颜色`，`main...HEAD` 两个提交：`6752163bf`（会话修复）、`2e021d959`（颜色效果）。

结论：**没有重要问题，可以合并。** 小问题 4 条、原有问题 3 条，都不挡合并。

## 共享着色器图会话修复：调用方影响核查

拿 `shaders@4.0.2` 的框架源码逐条对照了会话的重建判断：

- 框架真正决定换合成的是结构哈希（`collectStructuralHashInputs` 与 `extraHashInputs`），并且只在标脏后才重算。标脏的来源有三处：`updateUniformValue` 里的 `compileTime`、`compileTimeWhen`，以及 `updateNodeMetadata` 的 `needsRecompose`。会话 `applyProps` 的判断与这三处一一对应。
  - `compileTimeWhen` 的基准值：框架初始为 `rawValue ?? default`，只在谓词为真时更新。会话 `compiledProps` 的取值与更新时机相同（`shaderGraphSession.ts:238`、`:299`）。
  - 透明度：框架按 `>=1` 跨界标脏。会话按 `< 1` 比较，结果一致。
  - 换合成的时序：结构变化那一帧，`renderValue` 仍是旧的 activeHash，`markReady` 之后才切换（`pipelineCache` 与 `runFrameSequence`）。会话先补填画面，再以零时差重画，覆盖了这个时序；新合成管线没建好时，`draw` 会一直等到它真正出图。
  - 缓存淘汰：被淘汰合成的宿主纹理经 `onCleanup` 移出集合；上传命令在淘汰前已经提交，不存在用了已销毁纹理的问题。
- 实际调用方只有三处：片段效果 `videoEditCodeGpu.ts:588`、着色器转场 `videoEditCodeGpu.ts:634`、预热 `videoEditRenderer.ts:856` 到 `ShaderGraphCache.warm`。前两处每帧都下发完整属性表，元数据只可能出现生成器的 `blendMode`。预热下发的是空属性表，会重置为默认值。三条路径在修复后行为都正确，没有回退。
- 新的“没写的透明度、变换、包围盒回到默认”：`updateNodeMetadata` 收到 `opacity: 1`、单位变换、`boundingBox: null` 时，对没有设过这些值的节点不会标脏，哈希也不变。对现有调用方没有副作用。

## 重要

无。

## 小问题

1. **“代码素材 shader 图层”这个调用方并不存在。元数据重建判断里大半分支对任何调用方都不可达。**
   - 位置：`shaderGraphSession.ts:259-275`、`:302-305`；提交 `6752163bf` 的说明；`result-U2.md` 的“同类排查”。
   - 依据：全仓只有上面三处调用 `ShaderGraphCache`。`shaderGraphSpecSchema` 和 `shaderGraphLayerSchema` 没有被任何地方用来解析作者内容，作者 GPU 代码走的是 `createWebGPU`（见技能 `author-shaders.md`）。
   - 后果：`metadataStructure` 里的可见、遮罩、透明度、变换、包围盒五项，以及 `updatedMetadata` 的三项默认值，目前没有输入能走到；能走到的只有 `blendMode`。这部分复刻了框架内部规则，升级 `shaders` 时要跟着复核，与“只做要求的、不可能发生的情况不写处理”的规则相悖。“代码 shader 图层一并修复”的说法也无从验证。
   - 建议：二选一。要么收窄到混合模式，要么保留但改正提交与 result 里的调用方说法，并注明当前只有 `blendMode` 可达。
2. **同结构会话被几段素材交替使用时，“只有结构变化的那一帧多画一次”变成每帧都多画（性能）。**
   - 触发输入：时间线上有两段片段用同一个组件，但混合模式不同、胶片不同、或一段光晕为 0 另一段大于 0；或者两个同种着色器转场的编译期选项不同。
   - 后果：这两段每渲染一次都判定为重建，绘制从 1 次变 2 次（含计算工序的组件是 3 次）。每帧还要向缓存里所有合成（最多 4 份）的宿主纹理上传一遍。两段尺寸不同时，每次渲染还会给所有宿主纹理重建尺寸（`shaderGraphSession.ts:357`、`:372-387`）。正确性没问题。
   - 建议（待确认）：`ShaderGraphCache` 的键里加上编译期属性值和混合模式，一种合成对应一个会话，就不再来回切换，还能顺带消掉原有问题 1。代价是会话（渲染器实例）变多。
3. **文件所有权。** 设计第 15 节把 `src/core/videoEdit/shaderGraph/effects.ts` 划给 U7 和 U16，本单在其中新增了 `WRAPPED` 封装表和 `ShaderGraphWrappedEffect` 接口（第 81-87、109-110、121 行）。result 里还让 U3、U7 往这里追加。胶片模拟必须有这个接入点，取舍本身合理，但需要协调者确认，并提前告知 U7（它在同一文件改生成器分组），避免合并冲突或另起一套。`shaderGraphSession.ts` 没有归属单元，按根因修复单独提交，没有问题。
4. **渐变映射的“映射”组有 5 个参数**（`src/core/videoEdit/colorMaps.ts:221-225`），规范写的是一组 2–4 个。这个分组照搬自设计第 2.2 节的表，标为待确认，由协调者决定是否拆成“中间调”和“色阶”两组。

## 原有问题（不是本单引入，不并入本次）

1. **几段素材共用会话时，按合成各自累加的时钟取决于渲染历史。**
   - 重建那一帧，时间差记在旧合成上，新合成拿到的是零时差。交替使用时，每份合成只在自己被画的帧上累加。
   - 本单给胶片模拟把片门晃动固定为 0，避开了这个问题。但 `shaders.FilmStock` 在 U16 撤下前仍开放 `weave`，而且与 `film_look` 的图结构相同（`[@input, FilmStock#fx]`），两者共用一个会话。
   - 其他用到 `deltaTime` 的组件也属于这一类（CursorTrail、Particles、ParticleFlow、Shatter、StudioBackground、Form3D、Surface3D）。它们是否作为效果开放、受影响多大，待确认。
2. **请求接口的注释与实际语义矛盾。** `shaderGraphSession.ts:115` 写的是“只写有变化的项”，`shaderGraphCache.ts:38` 写的是“后续帧只改变化的项”；而 `applyProps`（`:277-278`）按完整属性表处理。本单进一步明确了完整表语义（透明度、变换回默认），这两处注释更显得不对。
3. **过时注释仍指向不存在的代码素材 shader 图层：** `spec.ts:2`、`shaderGraphCache.ts:12`、`videoEditCodeGpu.ts:604`、`shaderGraph/effects.ts:6,62,126`。

（另：result 里记录的 main 上 `videoEditBuiltinEffects.test.ts` 过渡实体失败属于 U12，本轮未审。）

## 逐项核查

- **正确性**
  - 渐变映射
    - 位置用编码值上的 BT.709 亮度。黑场、白场线性重映射，白场 ≤ 黑场时退化为阶跃。中间点为 0 或 1 时，`select` 两侧都会求值，但没选中的除零不影响结果。
    - 感知插值：先把色标换成“同 OkLab 明度的灰的编码值”，再在着色器里用 `cbrt(lin(·))` 还原明度。这对灰色恒等，所以黑→白等于“黑白”效果。
    - `cgEnc`、`cgCbrt` 按符号对称处理，不会出 NaN；超色域的值由 `premul` 截到 0–1。
  - 色调分离：平滑为 0 时，`ramp` 退化为阶跃，不会出 NaN；平滑 100 时相邻台阶的过渡正好相接；色阶按 `round` 取整，色阶 2–64 都能用。
  - 反相：`premul(1 - straight(c), a)`，透明处仍透明。
  - 三个原生效果都是逐点工序，不涉及取样坐标、rasterOrigin 和外扩（`bleed` 缺省为 0，与“黑白”一致）。图层与片段走同一份规划，作者工厂与生成的类型三份一致。
  - 胶片模拟：没写 `space`，等于只上片段，符合裁定第 2 条；`stage` 缺省为空间工序（有光晕）。数值换算对照了 FilmStock 的属性范围：光晕 `crosses(0)` 由 `defineStd` 转成 `compileTimeWhen`，会话能读到。
- **缓存与确定性**
  - 四个效果都不取宿主帧号：渐变映射、色调分离、反相是纯函数；胶片模拟晃动固定为 0，FilmStock 也没有颗粒，所以不需要 `frameSeeded`。U9 还没进 main，不涉及待接入项。
  - 预览与导出都用 `shaderTimeSeconds`，对所有内置效果同样下发。
- **骨架约束**
  - 两个索引各加一行；目录表颜色组为“全能调色、黑白、反相、渐变映射、色调分离、胶片模拟”；`invert` 只登记一次。
  - 规划用 `definePlanner`，共享块按名引用 `COLOR_MATH_BLOCK` / `EFFECT_MATH_BLOCK`（ABI 由前导块固定装配）。OkLab 复用 `colorScience` 和 `colorMath`，取色复用 `lightSweep.linearHex`（已有共用方）。
  - 定义模块对 `builtinEffects` 只有 type 导入。`effectRegistration.test.ts` 本机实跑 5 项全部通过。
- **参数**
  - 强度 0–100；百分比参数硬范围 0–100；色阶软范围 2–16、硬范围 2–64。
  - 三色专属参数用 `visibleWhen`；单参数不成组（平滑并入主参数，已批准）。
  - 说明都写看得见的结果、标了默认值，没有算法词。
  - 颜色参数校验只认 `#rrggbb`，所以 `linearHex` 回退成白色的分支走不到。
- **测试**
  - GPU 用例覆盖了：默认（与“黑白”比）、两种插值、三色时透明边缘不发暗、色调分离按通道 / 平滑 / 按亮度、作者链、胶片换结构与共用会话的混合模式交替。
  - 断言没有抄登记清单或版本号；`[0,51,…,255]` 是算法结果，不算抄清单。

## 设计符合度

- 第 2.2 节：除 result“取舍”里已批准的偏离（明暗尺子、线性黑白场、感知插值做法、平滑并入主参数、不开放片门晃动、文件名用 colorMaps，以及目录撤下归 U16），其余一致。这些偏离没有带来正确性问题。
- 第 12 节：不改落盘格式；新增工厂 `gradientMap`、`posterize`、`invert` 在第 12 节的清单内；henji-effects 没有冻结。
- 第 13 节：颜色组顺序一致。
- 第 14 节：实测 0.007–0.016 ms，目标是 ≤ 0.15 ms。
- 裁定第 2 条（胶片模拟只上片段）：符合。

## 读过与没读到的范围

**读过：**
- 两个提交的全部 diff（不含 tickets 目录）。
- `shaderGraphSession.ts` 全文、`shaderGraphCache.ts`、`shaderGraph/effects.ts`、`spec.ts` 的相关段。
- `videoEditCodeGpu.ts` 的调用段、`videoEditRenderPrecision.ts`、`effectPlanner.ts`、`effectPlanners.ts`、`effectShaderPrelude.ts`、`effectIncludes.ts`、`builtinEffects.ts` 的定义接口与颜色校验、`layerEffectGeometry.ts`、`basicEffectShaders.ts` 的反相与黑白、`colorMath` 的 OkLab 函数。
- `shaders@4.0.2` 的 `core/index.js`：`updateUniformValue`、`updateNodeMetadata`、`registerNode`、`bindComposition`、渲染循环、`pipelineCache`、`extraHashInputs`；`std` 的 `collectStructuralHashInputs`、`createGpuUniformsMap`、`recompile` 转换、`screenedBloom`；FilmStock 组件。
- design.md 第 0、2.2、12–16 节与裁定；result-U2；result-U0“审查修复 2”；result-U9 中的 `frameSeeded`；《效果库.md》“参数与说明规范”。

**没读到或没做：**
- 没跑任何 GPU 用例（按要求），只跑了非 GPU 的 `effectRegistration.test.ts`。
- 没逐行读 `shaderGraph/transitions.ts` 和转场属性的编译期分布。
- 没逐行读作者图层链 `videoEditAuthorEffects.ts` 的内部实现。
- 胶片光晕半径与分辨率无关这一说法，没有在框架里追到计算分辨率的出处，沿用 result 的结论。
- 没有目视截图。

## Claude 裁定（11-01）
1. 不存在的第三调用方：会话重建判断收窄到可达的混合模式，删掉不可达分支，改正说明与注释（含原有问题 2、3 的注释）。
2. 同组件不同设置交替时反复重建：编译期属性与混合模式并进会话缓存键，一种合成一个会话（根因修，不靠加速重建）。
3. 封装表 WRAPPED 作为封装着色器效果的唯一入口，批准；U3 已在用，U7 开工时告知。
4. 渐变映射“映射”组 5 个参数按规范拆成两组。
原有问题 1（会话时钟随渲染历史累加）：先核实框架能否由宿主逐帧设定时间；能就改为按片段帧号确定的时间，补跳帧与顺序播放逐位一致的测试；不能就列出受影响组件交 Claude 定（倾向在 U16 撤下或改原生）。

## 时钟裁定（11-01，审查修复 1 之后）
框架不支持宿主逐帧设定时间。着色器 FilmStock 在 U16 撤下（片门晃动用我们的 film_look，固定 0）。影棚背景、立体包裹：时间乘数并进会话缓存键（不同乘数各自一个会话），这些累加时钟的封装组件的速度参数改为不可关键帧（旧关键帧容错按首帧值读）；补乘数不同交替、跳帧与顺序逐位一致的测试。
