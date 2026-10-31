# U5 光（镜头光晕、漏光，含效果时钟根因修复）合并前审查

审查对象：D:/VibeCode/Henji-AI-t19u5，`task/19-U5-光`，`main...HEAD` 两个提交（dad696ef7、4fcac40fc），26 个文件。
取证：`npx vitest run effectRegistration.test.ts lightEffects.test.ts` 2 个文件 8 项通过。GPU 用例没有跑（按要求）。

## 重要

无。

## 小问题

### 1. 帧时长可选，漏传时静默按第 0 秒：应当报错（建议合并前改）

位置：
- `src/features/videoEdit/engine/effectPlanner.ts:15`（`frameDuration?: number`）
- `src/features/videoEdit/engine/lightLeak.ts:114`（`frame.frameDuration ?? 0`）
- `src/features/videoEdit/engine/videoEditCodeGpu.ts:578,587`（`builtin(..., frameDuration?)`，着色器图 `frame * (frameDuration ?? 0)`）
- `src/features/videoEdit/engine/videoEditBuiltinEffectsGpu.ts:106`（`render(..., frameDuration?)`）
- `src/features/videoEdit/engine/videoEditAuthorEffects.ts:30`（`encode(..., frameDuration?, needsFloat = …)`）

现在的生产调用方都传了：合成场景 `videoEditCompositeScene.ts:85` 传 `1 / document.fps`，作者运行时 `videoEditAuthorRuntime.ts:524/613` 传 `info.frameDuration`（运行时 `:218` 已校验它大于 0）。预热（`videoEditBuiltinEffectsGpu.ts:102`）与精度判定（`videoEditRenderPrecision.ts:17`）有意不传，但它们用第 0 帧，种子本来就是 0，结果不受影响。**今天没有能复现的错误输入。**

为什么还要改：这正是本单要修的那类缺陷——片段链有时钟、调整层没有，漏光在调整层停在第 0 秒，而且不报错。可选参数加 `?? 0` 把同一个坑留着：下一个新调用方漏传，漏光和着色器图效果就悄悄定格，没有类型错误也没有测试会红（合成场景用例只测 `builtin()` 收到的参数；通用门禁自己传了 1/30）。design.md 第 9 节的 U10 会把片段效果链改成直接调用 `preparePlan / encodePlan`，绕开 `render()`，正好会碰上它。

建议（二选一，都很小）：
- 生产入口 `VideoEditCodeGpu.builtin`、`VideoEditBuiltinEffectsGpu.render`、`VideoEditAuthorEffects.encode` 改为必填；`EffectPlannerFrame` 可以把 `frame` 与 `frameDuration` 合成一个必填的 `clock`。约 30 处只测种子的 GPU 用例传一个常量即可，测试方便不该成为生产接口放宽的理由。
- 最小改法：漏光规划里，种子不为 0 而没给帧时长时抛错（着色器图那条在 `frame !== 0` 时同样处理）。预热和精度判定都在第 0 帧、种子为 0，不会误报。

### 2. 两条路径的时钟基准不同；代码图层上慢放时漏光一顿一顿（待确认）

位置：`videoEditAuthorModule.ts:80-81`（`authorFrameNumber = round(info.time / frameDuration)`）、`videoEditCodeSources.ts:399,464`（`info.time = context.time`，即源时间）、`codeMaterialTiming.ts:63,83`；对照 `videoEditCompositeScene.ts:85`（`frame - clip.start`）。

- 片段效果链的时钟是片段内的时间线帧：不跟变速、倒放、时间重映射走，剃刀剪开后从 0 重新算。代码图层与调整层的时钟是代码素材的源时间：跟变速、倒放、重映射走，剪点两侧连续，还带源入点。提交里说的“两条路径同源”只成立在“帧号和帧时长取自同一份信息”，两条路径的时间基准并不相同。同样的漏光，放在 2 倍速代码片段的效果链上和放在它内部的 adjust() 里，流动快慢不一样。按“素材里的东西随素材时间走”的语义可以接受，但应当在 `effectPlanner.ts:10-14` 的注释里写明，免得以后有人当成同一时钟去对齐。
- 慢放的情况：0.5 倍速（或重映射放慢）的动态代码片段里，源时间每个时间线帧只前进半帧，`round` 之后帧号是 0,1,1,2,2,…，漏光时间 = 帧号 × 帧时长，每两帧才变一次；0.25 倍速每四帧变一次。素材自己的绘制拿到的是连续的 `info.time`，所以同一个模块里内容在平滑移动，光的闪烁却是一档一档的（1.3/3.7 Hz 的闪烁比流动更容易看出来）。颗粒、故障本来就是逐帧随机，没有这个问题，漏光是第一个随时间连续变化、又能用在代码图层上的效果。片段链不受影响。这一条不算回归（改之前调整层的漏光干脆不动），是否值得为它改种子语义（比如允许非整数种子）请 Claude 定。

### 3. 种子契约与图层效果缓存键没有算上帧时长（潜在问题，现在走不到）

- `src/core/videoEdit/builtinEffects.ts:33-36` 写的是“返回值相同的帧必须得到相同的规划”。漏光的规划现在是 种子 × 帧时长，契约实际应为“同一帧时长下，返回值相同的帧规划相同”。说明里补上这半句，通用门禁（固定 1/30）也就和契约对上了。
- `src/features/videoEdit/engine/videoEditAuthorEffects.ts:34` 的按槽缓存键 = 格式、contentKey、尺寸、上下文、`authorEffectsFingerprint(effects, environment, frame)`、…，里面没有帧时长。现在走不到：漏光是 `frame` 空间，只能经调整层进来，调整层传的 contentKey 是 `undefined`，从不进缓存；同一文档里帧时长也不变。输出复用键（`videoEditCodeOutputKey.ts:79` 含 `info.frameDuration`）和预渲染指纹（`videoEditRenderFingerprints.ts:101` 含 `composition.frameRate`）都已经覆盖了帧时长。以后如果有图层空间、随时间连续变化的效果，这里会拿到旧帧率的缓存。可以把帧时长并进这把键，也可以在 `authorEffectsFingerprint` 里对声明了 frameSeed 的效果并入帧时长。

### 4. 光的合成公式有第二份（可选）

`src/features/videoEdit/engine/lensFlare.ts:99-109` 的 `lightOnto` / `lightWithin` 与 `engine/glow.ts:273-279` 的 `glow_composite`、`glow.ts:290-294` 的 `glow_layer_image` 主体是同一套公式（`shown = base.a`，原画不透明度为 1 时一模一样）。具名块本身是对的，但光的合成规则现在存在两处，以后改了发光的合成规则，两个光效果可能对不上。可以让发光的两个入口调用这个块（改 glow.ts 超出 U5 范围，可以留给 U16 或之后的单子）。

## 原有问题（不是本单引入，未并入）

- 片段链时钟从 `clip.start` 起算，剃刀剪开后后半段的漏光、着色器效果从 0 重来（result-U5 已记录）。
- `engine/glow.ts` 的 `linearColor` 与 `engine/lightSweep.ts` 的 `linearHex` 是同一个函数的两份（result-U5 已记录）。
- 待确认：`shaderGraphSession.ts:336-347` 用 `timeSeconds - elapsed` 的差值推进框架时钟。框架只做累加的话结果仍确定；有带状态模拟的组件时，结果会取决于渲染顺序。这个时钟语义本单没有改（改前改后都是片段内秒数）。

## 时钟逐项核对

| 调用方 | 帧号 | 帧时长 | 结论 |
|---|---|---|---|
| 片段效果链（原生） | `frame - clip.start` | `1 / document.fps` | 正确；24/60 fps 同一秒时间相同（用例断言） |
| 片段效果链（着色器图效果） | 同上 | 同上，`frame × 帧时长` | 和改前 `(frame - clip.start) / fps` 同义，没有回归 |
| 着色器转场 | — | `timeSeconds: 0` | 由进度驱动，本来就不在效果时钟上，没改 |
| 调整层 | `authorFrameNumber` | `info.frameDuration` | 正确；见小问题 2（源时间、慢放取整） |
| 普通代码图层 | 同上 | 同上 | 漏光是 frame 空间，图层上用不了；时钟接线与调整层一致 |
| static 模块 | 0 | 有值 | 时间恒为 0，和输出键不含时间一致 |
| 预渲染指纹 | 种子经 `authorEffectsFingerprint` 并入 | 帧率在合成键里 | 正确 |
| 输出复用键 | 并入种子 | `info.frameDuration` 在键里 | 正确 |
| 变速 / 倒放 / 时间重映射 | 片段链与之无关；代码图层跟源时间 | — | 两条路径语义不同，见小问题 2 |
| 帧率换算（含 NTSC） | 片段链为整数帧；代码图层 `round` 吸收浮点误差 | `1 / fps` | 正确 |
| 嵌套序列 | 子渲染器用子文档 `document.fps`、子文档帧 | 子文档 | 正确；父级变速时随嵌套画面的映射走 |
| 预热、精度判定 | 0 | 不给 | 种子为 0，结果不受影响 |
| 效果预览页 | 每次重画 +1 | 1/60 | 正确 |

“漏传按第 0 秒不报错”：现在没有掩盖任何接线遗漏，但会掩盖以后的遗漏，应当报错（小问题 1）。

## 效果本身（正确性）

核对过、没发现问题的：
- 取样坐标：`flarePixel` 按本道纹理换算到全分辨率像素。
- 半分辨率光源纹理的光核下限 0.75 纹素，峰值按能量不变压低。
- 星芒最小宽度、`atan2(0,0)` 的处理。
- 拉丝：粗细不小于 0.6，衰减距离大于 0。
- 画外光源：`haloEmitter` 层数至少 1、权重大于 0；高度 36 时 `finer` 大于 0，不会 0/0。
- 1×1 尺寸：`ceil` 和 `max(1, …)` 保底。
- 亮度 400、强度 200 时由肩部压缩与推白兜住。
- glowColor 的抖动强度槽（`u.c.z`）在两个效果里都是 0，`u.c.y` 正确传了核心发白。
- 预乘：`lightOnto` 用 `min(lit, alpha)`，`lightWithin` 乘 `base.a`，下层是零 alpha。
- 拆输出：调整层上拆出的光会重新按不拆规划，进入后续调色。
- 精度：出光即要求高精度；黑色光、亮度或强度为 0 时只剩复制。精度经定义的 `precision` 进 ticket 09 的触发判定。
- `frame` 空间不需要外扩，没有 rasterOrigin 的问题。
- 作者工厂 `lensFlare` / `lightLeak` 与生成的类型、`BuiltinLayerEffectDescriptor` 一致，和颗粒等 frame 空间效果同一处理。
- 漏光的 frameSeed：取补齐默认值后的参数；不出光或既不流动也不闪烁时返回 0（lightEffects 用例覆盖）；流动或闪烁时返回帧号。规划只读种子。

## 骨架、参数、测试

- 骨架：两个索引各追加两行，目录表插在发光、扫光之后，用 `definePlanner`；`LIGHT_COMPOSITE_BLOCK` 与 `EFFECT_MATH_BLOCK` 按名引用。定义模块对 builtinEffects 只做 type 导入。复用了发光金字塔（`appendGlow` 等）、`linearHex`、单形噪声、B 样条，没有另写金字塔或噪声。共享路径的改动都属于时钟根因修复，必要；没有改到其他单元的效果文件。
- 参数：主参数 4 个，组内 2–4 个；软硬范围符合规范；空间量按画面高度（光晕大小换算 2% / 8% 与 `glowLevels` 一致，漏光“范围 50% 约三分之一”与实现大致吻合）；不做动画的参数标对了；说明写的是看得见的结果，没有算法词；没有按方式显隐的需要。
- 用户口味：默认没有圆形光斑，鬼影默认 0，说明里点明“一串圆形光斑，默认关闭”；光雾靠金字塔散开，不是贴一个圆。
- 测试：GPU 用例覆盖两个效果的默认值（全部效果用例）、画外连续变暗、鬼影加拆输出、漏光方向、流动、拆输出；没有把清单或版本号抄进断言。没有单独测着色器图效果的 帧号 × 帧时长（风险低，result 已说明）。

## 设计符合度

符合 2.5 节的目标与第 13 节的顺序。第 14 节耗时达标；显存比设计估计的多一张全尺寸 rgba16float，result 已说明理由。第 12 节作者工厂随 U16 冻结。七处偏差 Claude 已批准，没有发现由偏差带来的正确性问题。

## 读过与没读到

读过：
- 两个提交的全部非 tickets diff。
- `engine/lensFlare.ts`、`engine/lightLeak.ts`、`core/videoEdit/lensFlare.ts`、`core/videoEdit/lightLeak.ts` 全文。
- `glow.ts` 的合成与 glowColor、`glowLevels`、`glowLevelWeights`。
- `effectPlan.ts` 的 Planner、`videoEditBuiltinEffectsGpu` 的绑定。
- `authorEffects.ts` 的 resolve 与 fingerprint、`builtinEffects.ts` 的 normalize 与 frameSeed 契约。
- `videoEditAuthorModule` 的 `authorFrameNumber`、`videoEditAuthorFingerprint`、`videoEditAuthorEffects.encode` 的缓存键。
- `videoEditCodeSources` 的 info 构造、`codeMaterialTiming` 的时间语义、`videoEditCompositeScene.apply`、渲染器嵌套入口、着色器图会话的时钟、着色器转场。
- 设计 2.5、9、12–14 节与裁定，result-U5，result-U0“审查修复 2”，result-U4“审查修复 1”，效果库参数规范。

没读到或没跑：
- GPU 用例与快照。
- 效果预览页实际画面、`.tmp/U5-evidence` 图片。
- `videoEditRenderer` 的嵌套帧映射细节（只确认了子渲染器用子文档）。
- `appendGlow` 光源纹理来源分支的内部实现（依赖 ticket 12 已审过）。

## Claude 裁定（11-01）
1. 种子不为 0 却没给帧时长时抛错（预热与精度判定用种子 0 不误报）。
2. 时钟语义保持（片段链 = 片段内时间线帧；代码图层与调整层 = 源时间），在 effectPlanner 注释写明；慢放卡顿（U5、U6 审查都提到）：代码图层与调整层的时钟改带连续源时间（允许小数帧位置），frameSeed、输出复用键、预渲染指纹、static 固定 0 都用这个连续值；补 0.5 倍时间重映射用例。
3. 种子契约改为“同帧时长下同种子同规划”，videoEditAuthorEffects 缓存键加帧时长。
4. 镜头光晕复用 glow.ts 导出的光合成函数，删掉第二份。
原有问题：linearColor 与 linearHex 重复记入清理清单；剪开片段后片段链效果时钟从 0 重来（剪点处本就换镜头，不改）。
