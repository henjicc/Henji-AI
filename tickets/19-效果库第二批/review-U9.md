# 19-U9 代码调整层 合并前审查

审查对象：D:\VibeCode\Henji-AI-t19u9，`git diff 3fba9c4d9..HEAD -- . ':!tickets'`（提交 1a016e121、2935ca760）

## 重要

1. **声明了 frameKey 的模块里，调整层的颗粒会被 ticket 15 输出复用冻住（预览和导出都会）**
   - 位置：`src/features/videoEdit/engine/videoEditAuthorPrograms.ts:101`（`fingerprintAuthorFrameKey(..., includeLayerEffects=false)`）→ `src/features/videoEdit/engine/videoEditCodeSources.ts:549-551`（`declared?.digest` 存在时，键里不放时间）。
   - 触发条件：作者模块声明了不含时间的 `frameKey`（例如动画停稳后返回 `'settled'`），同时有 `{ id, adjust: () => [grain()] }`。
   - 原因：ticket 15 的输出键按约定只执行 frameKey、不调用 layers，所以 U9 在 `adjustmentFingerprint` 里补的颗粒帧种子（`videoEditAuthorFingerprint.ts:15`）只进了预渲染指纹，没进输出复用键。键不变就直接返回上一帧画面，颗粒在所有“输入精确”的会话里（预览、导出、预渲染、试渲染）都会冻成一帧。颗粒逐帧变化是宿主自己加的，作者看不出来。现有技能只写了“draw 用随机数时 frameKey 要含时间”（author-api.md:5），新加的调整层一节（author-api.md:216-220）也没提这件事。
   - 建议：至少在调整层一节写明“用颗粒（以后还有其他逐帧种子效果）时，frameKey 必须含帧号”。更稳的做法是让宿主把逐帧种子并进声明键。只改文档还是改宿主，请调度决定。

## 小问题

2. **逐帧种子只对 `film_grain` 写死**：`videoEditAuthorFingerprint.ts:15` 只在有 `film_grain` 时把帧号算进调整层指纹。设计第 4 节说要进调整层的 frame 效果还有划痕、镜头光晕、漏光（U3、U5），glitch（U4）也可能逐帧取种子。调整层又会给所有效果传真实帧号（`videoEditAuthorEffects.ts:72`），普通图层传的是 0。这几个效果合并后，如果按帧号取种子，预渲染指纹会漏掉帧号，复用到旧画面。建议在效果定义上加声明（例如“按帧取种子”），指纹按声明判断，不按 id 判断。（待确认：U3/U4/U5 的实现还没看到。）

3. **版本号 9 写成了字面量**：`videoEditAuthorModule.ts:77`（`apiVersion < 9`、“需要作者接口 v9”），以及测试和类型里的 9。进度记录里 ticket 16/17/18 也在用 API 9，规则又要求后合并的单顺延版本号。合并时版本号一变，这里很容易漏改。建议仿照 `CODE_AUTHOR_LIBRARIES_MIN_API_VERSION` 定义一个具名常量。

4. **旧接口的报错把作者引到用不了的写法**：`src/core/videoEdit/authorEffects.ts:62`。API 8 及以下的模块把暗角或颗粒放进 effects，会报“请放进调整层 adjust”，可这一档接口用不了 adjust（照做会再报“adjust 需要作者接口 v9”）。旧接口应该报“请使用片段效果链”，或者提示升级接口。

5. **旧接口里带 `adjust` 字段的图层现在直接报错**：`videoEditAuthorRuntime.ts:453` 和 `videoEditAuthorFingerprint.ts:86`。v7/v8 代码里，图层对象如果碰巧有一个名叫 `adjust` 的自定义字段，以前会被忽略，现在会抛“adjust 需要作者接口 v9”。persistence.md 要求“宿主按版本保持旧版本代码的原行为”。实际碰到的概率很低，修起来也简单：apiVersion < 9 时不看 adjust。（待确认是否值得改。）

6. **读回里没有 clip**：`videoEditAuthorRuntime.ts:168-170` 给调整层的观察里有效果、参数和不透明度，但没有作用范围 clip。助手没法从读回确认调整层管的是哪块区域，和“可读回”的原则有出入。建议加一个可选的 `clip` 字段。

7. **技能措辞**：author-api.md:220 说零 alpha 光会被“反预乘的调色效果”去掉。实际上暗角、颗粒的着色器也是先反预乘（`basicEffectShaders.ts:62,69` 的 `straight(c)`），透明底上的光照样会被它们抹掉。建议改成“调整层里的效果都按透明像素处理零 alpha 光”，不只说调色。

8. **界面上按 id 选中调整层后看不到任何反应（归 U15b，界面跟进）**：`CodeSourceEditor.tsx:62`、`VideoEditCodeElementsPanel.tsx:30`、`CodeParameterPanel.tsx:26` 用的都是只认有画面范围元素的 `selectedVideoEditCodeElement`。所以从元素列表按 id 选中调整层后：源码编辑器不定位到它的源码，参数面板不出“已选元素”，元素属性里也没有不透明度和显示开关。宿主逻辑（`readSelectedVideoEditCodeElement`）本身是对的。

9. **调整层写入位移、缩放、旋转覆盖时被悄悄忽略（待确认）**：运行时对调整层只用覆盖里的 opacity 和 hidden。助手或用户写进 dx、dy、scale、rotation 覆盖不报错，也不起作用。建议写入时拒绝，或在能力说明里讲清楚（可以和 U15a 一起处理）。

## 原有问题（不是本次引入）

10. **文档和 ticket 15 输出键的实现对不上**：parameters-curves.md:56 写“API 7 的 frameKey 路径还会调用 layers/effects……只声明不变 frameKey 不能隐藏效果变化”。这句话只对预渲染指纹成立。ticket 15 的输出复用键（`videoEditAuthorPrograms.ts:101`，`includeLayerEffects=false`）不调用 layers，所以 frameKey 不变时，随时间变化的图层效果参数同样会被复用到旧画面。第 1 条就是这个问题在调整层上的表现。

11. **作者 API 版本调度（待确认）**：U0 基点已经把作者 API 升到 8（参数显隐条件 `visibleWhen.all`），U9 又升到 9。设计第 12 节只说 U7、U9、U15a 共用一版。本批还没发布的作者 API 版本可能有两个，和进度记录里的 10 = 8、16/17/18 = 9 也会撞号。这是合并顺序和收拢的问题，交调度处理。

## 已核对、未发现问题

- 渲染（`videoEditAuthorRuntime.ts:502-524`、`videoEditAuthorEffects.ts:64-109`、`videoEditAuthorGpu.ts:109-125`）：
  - 输入是栈目标，效果链与回写在同一个帧编码器里（创建 layerEffects 时就 begin 了当前编码器）。
  - 输出纹理和栈目标不会是同一张（effects 非空，每道效果都另取目标纹理）。
  - opacity 先在整幅上和原栈 `effect_mix`，再按 clip 用 scissor 加 `load` 写回。clip 坐标换算和 draw 的片元中心规则一致。
  - 精度：`promoteStack` 是从原逻辑原样抽出来的，首个触发层升 16f，并拷贝此前内容；栈为空时清空。
  - 调整层在第一层、最后一层、多层叠加、模块里只有调整层：栈在透明底上走预乘着色器，结果为 0；多个调整层的槽位互不冲突。
  - 拆成光和影的效果在调整层里改按完整画面规划，不会绕过后面的调色。
- 互斥校验：渲染、录制指纹和 frameKey 指纹三处都调用了；frame 效果放进普通图层报设计里那句原文，look 展开同样受限。H 取 `height` = 作者画幅换算到输出像素（不传 layer 时 `referenceSize`、`renderScale` 的语义和片段链一致）。
- 静止分组：`videoEditAuthorRuntime.ts:532` 在 adjust 处切开；表面编号和观察时的 `flat:` 历史查找不受影响。
- 预渲染指纹（录制路径和 frameKey 路径）：包含效果、opacity、clip、隐藏覆盖和颗粒帧号；下方图层的变化由各自的录制项反映。
- 读回：`kind: 'adjust'`，带解析后的效果和参数、参数键、源码范围；不进画面命中，不画选框，运动复核排除它，画布复核在没有 bounds 时不报错，元素区域返回 undefined。
- 确定性包装、打包时源码范围登记、作者类型声明（互斥用 `never` 表达）、类型诊断纳入 frame 工厂。
- 持久格式：code-author-api 8→9、code-version 9→10、code-asset 14→15、剪辑内容 49→50、录制会话 52→53，每种只升一次；迁移逐版本、保留原样；最低可读版本提高，符合第 12 节；发布承诺只追加。
- 安全：五条硬底线没有被碰到。
- 同源：普通图层、静止层、带效果层和 native 入口的路径只受 `draw!` 断言和 `adjustment=undefined` 两处影响，行为不变。

精确测试：`videoEditAuthorRuntime.test.ts -t 调整层` 2 项通过。GPU 用例没有跑。

## 设计符合度结论与阅读范围

**设计符合度**：第 4 节的接口形态、互斥、整幅换算、同一编码器、opacity/clip、16f 升级、读回 kind、静止分组都已实现。第 12、15 节的版本和文件归属也相符。主要缺口是第 1 条：调整层的颗粒和 ticket 15 输出复用的 frameKey 路径之间有一个会冻结画面的漏洞，合并前应至少补上技能说明。第 2 条是后续 frame 效果单的潜在风险。

**读过**：
- U9 全部引擎差异：Runtime、Effects、Gpu、Module、Fingerprint、Determinism、Bundle、Diagnostics。
- core 下的 authorEffects、观察、选择、复核、版本文件和迁移；application 下的 CodeElements。
- 技能与 d.ts 差异；新增的运行时、指纹、GPU 测试。
- ticket 15 的 OutputKey 与 CodeSources.outputKey、AuthorPrograms.frameKey；精度判定 `videoEditRenderPrecision.ts`；基础效果规划器与暗角、颗粒着色器；blur 规划器；三个使用选中元素的面板。

**没读到**：
- 5 份新黄金样本的内容（只看了发布承诺和基线的差异）。
- `VideoEditCodeGpu` 里 promote 的分配细节、片段链传给颗粒的帧号来源。
- U3、U4、U5 分支上 frame 效果的实现（第 2 条因此标待确认）。
- 第二个提交只核对了技能文字。

## Claude 裁定（11-01）
1 + 2 + 原有 10（同一根因：ticket 15 的输出复用键信任作者声明的 frameKey，不看宿主挂在图层上的效果）→ 在宿主修，不只改文档：
- 输出复用键与预渲染指纹用同一个函数，并入求值后的图层/调整层效果描述摘要（includeLayerEffects 统一为 true）；
- 效果定义新增“按帧取种子”的声明字段（名称由你定，例如 `frameSeeded: true`），颗粒声明它；指纹与复用键按声明并入帧号，不再按 `film_grain` 硬编码；U3/U4/U5 的划痕、故障、镜头光晕、漏光合并时按此声明（我会通知）。
- 测试：frameKey 恒为 'settled' + adjust 里 grain → 相邻帧输出不同；frameKey 不变但图层效果参数随时间变化 → 不复用旧画面；无随时间变化效果的风格库组件仍命中复用（ticket 21 的静止复用不退化，记修复前后章节 CPU 中位数）。
3 + 原有 11：作者接口各功能的起始版本用具名常量集中定义（例如调整层起始版本），合并时只改常量与样本；本单合并前按 main 当时的下一号定值。
4：低于调整层版本的作者接口把 frame 效果放进 effects 时，报错改成指向片段效果链（并说明升级作者接口后可用 adjust），不指向用不了的写法。
5：低于调整层版本的作者接口，图层上的 `adjust` 字段按旧行为忽略，不报错。
6：取帧观察的调整层元素带上 clip。
7：技能改为“调整层里的效果按反预乘计算：透明底的零 alpha 光会被去掉（调色、暗角、颗粒都一样）；要处理光，在产生光的图层 effects 里调。有不透明背景时光已叠入背景，不受影响。”
8：三个面板按 id 选中调整层无反应 → 归 U15b 界面，记进设计第 11.4 节待办，本单不改 .tsx。
9：给调整层写位移、缩放、旋转覆盖时明确报错（调整层没有画面范围，只能改效果参数与 opacity）。
