# ticket 19-U0 登记骨架 合并前审查（HEAD 3fba9c4d9）

## 重要

1. **持久版本号与 main 上已合并的 U13 撞号，现在不能合并。**
   - 位置：`src/core/documents/kinds/videoEdit.ts:138-143`（`minReaderVersion: 49`、迁移键 `48`）、`src/core/documents/kinds/screenRecording.ts:10-14`（`version: 52`、迁移键 `51`）、`src/core/persistence/schemaVersions.ts:8`（`VIDEO_EDIT_CONTENT_VERSION = 49`）、`schemaBaseline.json`、`releasedCompatibility.json` 里 document.video_edit 的 `49` 和 document.screen_recording 的 `52`，以及 `tests/fixtures/persistence/document.video_edit/v49.json`、`document.screen_recording/v52.json`。
   - 出错状态：分支最后一次吸收 main 是在 `fde217903`。之后 main 合进了 `7b7fc9544`（19-U13），它已经占用剪辑内容 48→49（迁移内容是音频效果合并，`minReaderVersion 49`）和录制会话 51→52。这两个版本在 main 上已有不同的指纹，`releasedCompatibility.json` 也已登记，黄金样本 v49/v52 也已存在。U0 的同号条目会在迁移表、基线、发布承诺和样本文件上冲突。如果合并时取 U0 一侧，会改写已登记的发布承诺，或者丢掉 U13 的 48→49 音频迁移。`git diff main...HEAD` 按合并基点比较，看不出这个问题。
   - 处理：再执行一次 `git merge main`，剪辑内容顺延到 49→50，录制会话顺延到 52→53。用正式生成器重新生成 v50/v53 样本，重跑 baseline 和 release-snapshot，丢弃 U0 自己的 v49/v52 条目。U13 没有改 code-author-api 7→8、code-version 8→9、code-asset 13→14，这三项保持不变。

## 小问题

2. **登记表重复 id 会被静默覆盖，没有任何断言能发现。**
   - 位置：`builtinEffects.ts:52-54`、`effectPlanners.ts:5-6`。两处都是 `new Map(...)`，同一 id 以后出现的为准。展开顺序由模块命名空间决定，也就是按导出名的字母序（实测 tsx 下排在第一的是 `AUDIO_EFFECT_DEFINITIONS`），和追加的位置无关。
   - 出错场景：设计第 15 节说 U2 改的是“builtinEffects.ts 里反相一行”，但反相现在在 `basicEffects.ts:9` 和 `basicEffectPlanners.ts`（invert 那一项）里。如果 U2 新建原生 `invert` 时没有删掉旧条目，会出现两个同 id 的定义或规划，最后生效的是导出名排在后面的那个，而且不报错。`builtinEffects.test.ts:27` 改成了用 Set 比较，也查不出重复。
   - 建议：两个 Map 构建时断言 id 唯一，并把设计里 U2 的文件所有权改成实际所在的文件。

3. **效果顺序由导出名字母序隐式决定，同一小组内没法排序。**
   - 位置：`builtinEffects.ts:52`；`effectsRegistry.ts:53-59` 只按小组排序。
   - 影响：
     - 助手目录（`videoEditReflection.ts:63`）、NOT_FOUND 和“可用：…”提示里的列表顺序变了，现在音频效果排在最前。
     - 面板同一小组内的顺序是任意的。例如颜色组显示为黑白、反相、全能调色，和第 13 节“全能调色”排第一不一致。
     - U16 想排序时没有字段可用。
   - 另有一点待确认：命名空间的键顺序在 Rollup 生产包和 vitest/tsx 下是否一致。即使不一致也只影响显示顺序。

4. **待确认：效果面板现在就会出现空的“生成”“更多”文件夹。**
   - 位置：`effectsRegistry.ts:14,19` 新增了这两个类别；`VideoEditEffectsLibraryPanel.tsx:41-45` 只有在有搜索词时才隐藏空文件夹。
   - 影响：从 U0 合并到 U7、U16 落地之间，用户会看到两个点开后什么都没有的文件夹，这是本单引入的可见界面变化。

5. **着色器装配有隐式耦合，而且原来的 ABI 说明被删掉了。**
   - 所有规划的 WGSL 都要靠 `BASIC_EFFECT_WGSL`（挂在 color_grade 登记上，`basicEffectPlanners.ts:18`）提供 Vertex、`u`、`tap`、`vs`，以及 `EFFECT_SHADER_MATH_WGSL`、`COLOR_MATH_WGSL`。`gaussian_*` 是 blur 在用，却登记成 color_grade 的不可过滤入口。
   - 拼接时 `[...new Set(wgsl)]`（`videoEditBuiltinEffectShaders.ts:10`）只能去掉完全相同的整段文本。如果后续效果单为了自成一体，在自己的 WGSL 里再嵌一次 `${EFFECT_SHADER_MATH_WGSL}` 或 `${COLOR_MATH_WGSL}`，函数会重复定义，整个内置效果模块都会编译失败。
   - `effectPlanner.ts` 和 `effectShaderMath.ts` 都没写这条约束。旧 `videoEditBuiltinEffectShaders.ts` 顶部关于 binding 0/3、16 个 float 的布局、过渡 `c` 含义的 ABI 说明也被删了，`basicEffectShaders.ts` 里没有补回。

6. **待确认：定义模块不能直接引用 builtinEffects.ts 的值，这条约束没写出来。**
   - `effectIndex.ts` 导出的定义模块如果直接或间接引用 `builtinEffects.ts` 的值（例如 `compositing.ts`、`keyframes.ts`、`smartRegionPresets.ts` 都这样引用），就会和 builtinEffects 形成循环，加载时可能遇到暂时性死区错误。
   - `effectIndex.ts:1` 的注释没写这条约束。U11 的 `subjectKey` 如果要引用智能区域，正好会碰上。

7. **规划登记的入口类型很容易被放宽。**
   - 位置：`videoEditBuiltinEffectShaders.ts:4-6`。`VideoEditBuiltinEffectEntry` 是从索引类型推导出来的。
   - 风险：新登记如果没有像现有登记那样写 `EffectPlanner & { readonly entries: typeof X_ENTRIES }`（配合 `as const`），入口类型会被放宽成 `string`，`Planner.pass` 的入口校验对所有效果都失效，而且不会有任何报错。

8. **待确认：spaces 只做了片段专用参数这一个方向。**
   - 已覆盖：作者显式传片段专用参数时，运行时会报错（`authorEffects.ts:62-63`）。
   - 未覆盖：
     - 片段一侧 `normalizeVideoEditBuiltinParams` 不拒绝 layer/frame 专用参数。
     - 作者静态诊断 `videoEditAuthorEffectDiagnostics.ts` 不知道 spaces 的存在。
     - `look()` 风格件的成员如果带片段专用参数，会在运行时报错（这一条与 U14 相关）。
   - 现在还没有参数声明了 spaces，所以不影响现有素材。U11 加 `contour` 时需要补上。

9. **`basicEffectPlanners.ts` 是机械搬运的，留下不少冗余。**
   - 位置：`basicEffectPlanners.ts:19-147`。每一项都重复 `plan`/`finish` 样板，有多余的 `{ }` 块和没用到的 `_instance` 参数，还有 `entries: [] as const, wgsl: ''`。
   - 这和 AGENTS“写得简单”的要求不符，静态门禁拦不住。行为没有问题。

## 原有问题

无与本单相关、有证据的原有缺陷。

## 已核对、没有问题的项

- **规划等价**：20 个画面内置效果都有登记（基础 14 个 + 独立 6 个），没有漏登、重复或改 id。录制效果的 id 字面量和常量一致。逐项对照旧 switch，参数换算和分支一样。现在录制光标、自动缩放也会先补齐默认参数，没有副作用。
- **入口与着色器**：入口并集和旧列表相同，不可过滤入口集合也相同。WGSL 模块级声明与顺序无关，没有指令头。
- **精度**：触发集合和旧白名单一样，共 7 个效果，条件逐项相同。图层判定现在统一用 `rasterScale: 1`，而旧的投影、扫光、溶解用的是 `context.layer.rasterScale`。核对后结论不变：这三个效果是否只剩复制或调不透明度，只取决于不透明度、强度、进度，和像素高度无关；模糊在图层下的 H 与旧的无图层判定相同。
- **visibleWhen.all**：
  - 作者解析共用同一个纯函数，嵌套的 all、空数组、多余键、引用不存在的参数、比较值类型错都会拒绝，v8 以下的接口拒绝 all。
  - 说明文字和旧格式逐字相同。
  - 包含效果的键前缀映射、独立预览、ParamList 都用 `parameterVisible`。
- **持久格式（顺延问题除外）**：每种格式只升一次，迁移逐版本写，最低可读版本按 v6 的先例提高，黄金样本由正式生成器产出、包含 all 和 apiVersion 8。
- **WGSL 数学**：
  - OkLab、sRGB、hash、值噪声、ramp 与原着色器逐字相同。
  - 单形噪声与 Ashima 现行版（`+10` permute）逐项一致。
  - B 样条的权重和四次双线性取样偏移正确。
- **安全**：五条硬底线都没有涉及。

## 设计符合度与阅读范围

**结论**：U0 的设计项全部落地，包括 stage、precision、参数级 spaces、visibleWhen.all、按 id 的规划表、从定义派生入口/精度/预览、两个只追加索引、共用 WGSL 数学，以及“生成”“更多”类别和第 13 节的小组。逐项核对看，画面行为不变。追加一行接入在机制上可行，但要靠第 2、5、6、7 条里的隐式约束，建议至少补上 id 唯一断言并写明这些约束。第 1 条顺延改号之前不能合并。

**读过**：
- 两个索引和 effectPlanners；
- effectPlan、effectPlanner、basicEffectPlanners、basicEffectShaders、effectShaderMath、colorMath；
- 6 个原生效果的登记包装；
- videoEditBuiltinEffectPasses、videoEditBuiltinEffectShaders、videoEditRenderPrecision 的完整 diff；
- 各 core 定义的 diff；
- builtinEffects、effectsRegistry、effectIncludes、parameterVisibility、codeMaterial/parameterTypes、authorEffects、fieldSpec、ParamList 的 diff；
- 生成脚本、预览脚本；
- 持久格式的全部 diff 和样本关键字段；
- main 上 U13 的持久格式改动；
- planBlur、planDropShadow、planLightSweep、planDissolveReveal 的判定分支；
- 精度判定的 4 处调用方。

**跑过**：`effectRegistration.test.ts`，1 项通过；用 tsx 确认定义 id 没有重复（181 个）。

**没读到**：
- 生成的 .d.ts 只看了重排部分；
- GPU 测试没跑；
- 没有在生产包核对 Rollup 命名空间的键顺序；
- 没有逐行读 v49/v52/v14 样本全文。

## Claude 裁定（11-01）
U0 先于 ticket 10 合并（10 在修综合审查，届时按 main 顺延）。全部处理：
1. 撞号：`git merge main`（已含 U13），剪辑内容 49→50、录制 52→53，正式生成器重生成样本、baseline 与发布承诺；作者接口、代码版本、代码资产按 main 当时下一号（现在不冲突则不变）。
2. 定义与规划登记加 id 唯一断言（重复即抛错并指出两处来源）；设计第 15 节 U2 的文件所有权改为“反相在 basicEffects.ts / basicEffectPlanners.ts 原地替换”（已另行通知 U2）。
3. 顺序显式化：新增一张有序目录表（效果 id 的显示顺序与分组，按第 13 节），定义列表、助手目录、“可用：…”提示与面板组内顺序都从它来；现有效果恢复 U0 之前的顺序、组内按第 13 节；测试要求每个已登记 id 都在表里。后续效果单把自己的 id 插进表中第 13 节的位置（这是第三处允许改动的登记文件）。
4. 面板空文件夹：`VideoEditEffectsLibraryPanel.tsx` 只改显隐逻辑——没有条目的文件夹始终隐藏（与 ParamList 同样的有限例外，不改外观）。
5. 着色器装配：共用数学与基础着色器做成显式的共享前导块，按块名去重（同名只拼一次，不靠整段文本相同）；不再挂在全能调色登记上；补回绑定与 uniform 布局（ABI）说明。
6. 在 effectIndex.ts 写明“定义模块不得直接或间接引用 builtinEffects.ts 的值”，加一条测试单独导入每个定义模块。
7. 新增 `definePlanner` 一类辅助，入口用 const 泛型推出字面量类型，忘写 `as const` 也不放宽；现有登记改用它。
8. spaces 补齐：片段侧拒绝 layer/frame 专用参数、作者静态诊断认识 spaces、look() 风格件带片段专用参数在校验期报错（不留到运行时）。
9. basicEffectPlanners.ts 去掉机械搬运留下的重复样板与无用参数，行为不变。
