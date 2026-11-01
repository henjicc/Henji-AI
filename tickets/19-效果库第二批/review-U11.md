# 19-U11 审查报告（task/19-U11-智能与抠像，7be2160fb）

结论：没有发现「重要」问题；小问题 4 条，原有问题 3 条。

## 重要

无。

## 小问题

1. **GPU 用例没覆盖收缩 / 扩展、边缘柔化，也没覆盖它们和“去掉主体”叠加时的情况**：`src/features/videoEdit/engine/videoEditStyleEffects.gpu.test.ts:1332-1397`。
   全单符号最容易出错的一行是 `src/features/videoEdit/engine/subjectKey.ts:971` 的 `grow = (choke > 0) !== invert`，现在只靠耗时测量间接跑过，没有断言。新用例只测了默认参数、去掉主体（choke 为 0）、换色、两种轮廓来源一致、描边随淡出。建议补一条：choke 为 ±40、invert 开或关时，边缘往哪边移；feather 大于 0 时透明度单调过渡。
   主体发光的 `layerOpacity`（`glow.ts:763`）同样没有淡出用例，只有描边测了。

2. **主体描边、主体发光在缩小的片段上（画中画）会沿片段边框画一条边**：`videoEditCompositeScene.ts:1234-1239` 用片段几何把人物蒙版画到整幅画面，片段矩形外的蒙版是 0。
   人物在片段边缘被裁断时（例如胸像下沿），`strokeOver` / `glow_subject_composite` 会把这条裁切线当成人物轮廓，在片段矩形外的透明处画出一道横线或光带。片段铺满画面时纹理外没有像素，不会出现。“内容透明度”方式下，画中画本来就沿片段矩形描边，属于预期；“主体”方式的语义是只沿人物描，这道边不符合预期。待确认是否要按片段矩形或片段 alpha 截住描边带和光。

3. **“去掉主体”单独成了一组「选项」**：`src/core/videoEdit/subjectKey.ts:308`。
   《效果库.md》参数规范写着“只有一个参数的不单独成组”，但 design.md 2.7 的参数表明确写了组为“选项”，所以实现与设计一致，矛盾在规范与设计之间。待确认是否放进主参数。

4. **界面看不到人物分析的进度，失败了也没有重试**：`VideoEditSmartRegionControls.tsx` 只处理作用区域（实现记录“未做到 1”已交回）。
   结果是加上主体抠像、主体描边、主体发光后，分析期间画面不变；分析失败后效果一直不出现，也没有任何提示。状态读取（`videoEditEffectRegionStatuses`）与重试入口在应用层已经接好，只差界面。合并前确认由谁接，否则用户会以为效果坏了。

## 原有问题（不是本次引入）

1. **导出时蒙版文件读失败，效果会被悄悄跳过**：`videoEditCodeSources.ts:557-566` 的 `regionMask` 吞掉读取异常，只记 warn，返回 undefined，调用处 `continue`（`:394`、`:396`）。
   导出前 `waitVideoEditSmartRegions` 只保证分析状态为 ready。如果之后缓存文件被清理、或 Range 读取失败，导出的帧里这个效果直接消失，不报错。作用区域原来就是这样（人脸打码会导出成没打码）；本单的主体抠像沿用后，背景没去掉也照样导出。建议导出质量下改成报错。

2. **“内容透明度”描边在片段淡入淡出时会突然整条消失或出现**：片段不透明度在效果链之前已乘进输入，`stroke_seed` / `stroke_shade` 按 alpha ≥ 0.5 取轮廓（`stroke.ts:913`）。不透明素材在不透明度低于 50% 时描边整条消失，高于 50% 时突然出现。实现记录已报，代码核对属实。

3. **人物蒙版和作用区域只按片段几何放置**：链里排在前面的几何类效果（翻转、裁剪、变形）不会作用到蒙版上，先翻转再主体抠像会错位。智能区域原来就这样，本单沿用。

## 按重点逐项核查（没发现问题的部分）

**主体抠像的边缘颜色与预乘**
- 输出 `premul(mix(附近主体色, straight(c), keep²), c.a·keep)`，预乘在任何输入下都成立。完全保留处（keep = 1）原样输出。
- 附近主体色取的是按 α·keep¹⁶ 加权的直通色平均：拉推每级 `subjectLimit` 只做整体归一，push 时 rgb 与权重同比例稀释，颜色比例保持不变。透明底像素（c.a = 0）不参与取色。
- 已有透明度的片段：alpha 按 c.a × keep 相乘，颜色在完全保留处与原图一致。
- 新背景上没有压黑的机制，原背景只残留 (1 − keep²) 的比例。“去掉主体”时 keep = 1 − m，主体色改从背景取，收缩 / 扩展方向随之反转，逻辑正确（但见小问题 1）。
- 整幅没有保留像素时，`smoothstep` 退回直接相乘。1×1 的画面、奇数尺寸也都能处理。
- 中间纹理一律 rgba16float，keep¹⁶ 的小权重在半精度次正规数范围内仍可分辨，阈值 2e-5 合理。

**contour（轮廓来源）**
- 只用于片段：参数声明 `spaces: ['clip']`、`animatable: false`；作者图层与调整层在 `normalize`（space = layer）和 `validateVideoEditLook` 两处拒绝。作者库的生成类型不受影响。
- 默认“内容透明度”路径逐位一致，这个说法成立：
  - 发光的 `glowLight` 抽成 `glowCore(original, v)` 后，取样表达式、取样顺序与系数和原来完全相同。视频剪辑的着色器从不用 float32Sampling（只有图片编辑器的调色用到），所以 `textureSampleLevel(image, s, …)` 等同于原来的 `tapOriginal`。
  - 描边的 uniform c.z 为 0、c.w 为 1，这两个值在非主体分支里都不读。
  - 两条规划在非主体时的工序、输入和参数都没变。
- 跟随片段不透明度：渲染器里 `evaluateVideoEditClip` 求出的不透明度乘上了淡化手柄（`videoEditRenderer.ts:1935-1936`），`normalize` 按这个不透明度把片段画进效果链的输入，`identity` 再把最终图层的不透明度置为 1。所以 `layerOpacity = clip.opacity` 正好等于已乘进输入的那个值；描边带按 `k · c.w` 叠加，与“先叠好再整体乘”等价。发光的光在 shoulder 之前就乘了不透明度，淡化不是严格线性，但“亮部”与“内容透明度”方式的发光取自已乘不透明度的输入，同样如此，三种方式一致。

**人物识别结果的复用、未就绪与缓存**
- 人物蒙版的请求用 `requestFor(media, 'person', …)`，和作用区域的人物、背景是同一个键，不会重复分析（`effectRequests` 去重）。
- 未就绪或失败时：预览跳过这个效果（与作用区域相同）。导出、预渲染、录屏成品都经 `waitVideoEditSmartRegions`，现在也会收集人物蒙版的请求：失败时报“区域分析失败”，就绪后才开始渲染。三条路径与预览走同一个 `VideoEditCodeSources` 和合成场景，结果一致。
- 是否需要人物蒙版，按求值后的这一帧判断（片段在交给准备之前已经整体求值），关键帧把方式切到“轮廓”时也不会漏取。
- 缓存键：预渲染窗口指纹包含全局 `videoEditSmartRegionSegments()`，Worker 侧蒙版缓存按 段落 url、帧、参数 记键，分析结果的身份都已计入。
- 共用的蒙版画面：先画人物蒙版、效果提交，再画区域蒙版，在同一队列上按提交顺序执行。`uploadMask` 按数据引用跳过重复上传，两种蒙版交替上传时比较的是不同引用，不会用到旧内容。

**“顺带修”的 `videoEditBuiltinStoredParamsForSpace`**
- 根因成立：片段效果按片段空间补齐，存下了 `contour: 'alpha'`；没有这个修复，含描边或发光的片段风格件在代码图层的 `look()` 里会被整份拒绝。
- 修法只去掉“片段专用且仍为默认值”的键，在 `validateVideoEditLook`（`authorEffects.ts:59`）和 `resolveAuthorEffects`（`:108`）两处共用。
- 改成“主体”、曲线目标、旋钮映射到该参数，这三种情况都单独计入键集合，照样报错。图层上“内容透明度”与没有这个参数等价，所以没有放过应当拒绝的情况。
- 作者静态诊断、调整层 `adjust` 走同一入口；元素覆盖（U15a）尚未合并。我跑了 `authorEffects.test.ts`，10 项通过。

**其他**
- 骨架约束：索引、规划索引、目录各加一行；定义模块只 type 导入 `builtinEffects`；新规划用 `definePlanner`；发光的合成复用共享块里的 `glowOnto`；柔化走 `Planner.gaussian`。仓内没有另一份 GPU 最小 / 最大值滤波，也没有另一份拉推回填，不算重复实现。
- 只用于片段的入口都已覆盖：添加、智能预设、风格件、拖放、复制效果、效果控件、助手实体的创建与写入。手势路径同样经过 `updateVideoEditBuiltinEffect`。
- 渲染内置效果只有合成场景一个调用方（另有预览页脚本），不存在漏传人物蒙版的路径。

## 设计符合度

- 2.7 节：参数、范围、默认值、说明要点、工序（最小 / 最大值滤波、`planGaussian`、复用人物分析）都符合；另加了净化边缘颜色，属于已批准的取舍。
- 第 6 节：轮廓来源、只用于片段、外侧描边与轮廓光叠在原画之上、两个新预设的参数，都符合。
- 第 12 节：没有格式升版本，新参数缺省按默认值读入，符合。
- 第 13 节：智能文件夹 9 项顺序一致，抠像组为“色度抠像、主体抠像”，符合。
- 第 14 节：实测 ≤ 0.5 ms（取自实现记录，我没有复测）。
- Claude 裁定：本单不涉及。

## 读过与没读到的范围

**读过**
- `git diff main...HEAD`：除 tickets 外全部 33 个文件（预览页脚本只扫读）；result-U11.md。
- design.md：2.7、6、12、13、14 节与文末裁定；result-U0“审查修复 2”；《效果库.md》参数与说明规范。
- 相关上下文：`videoEditCodeSources` 的效果准备与 `regionMask`、`videoEditCompositeScene`、`VideoEditBuiltinEffectsGpu.encodePlan`、`adjustmentPasses` 的取样辅助、`videoEditSmartRegionMasks`、`videoEditRenderCache` 的指纹与等待、`keyframes` 的片段求值、渲染器求值与淡化手柄、`authorEffects`。

**跑过**
- `authorEffects.test.ts`、`videoEditSmartRegions.test.tsx`、`smartRegions.test.ts`，3 个文件 27 项全部通过。
- 没跑 GPU 用例（按要求）。

**没读到**
- result-U4“审查修复 1”：本单不按帧取种子，不涉及。
- architecture.md、testing.md：没有逐条对照。
- `VideoEditSmartRegionControls.tsx`：只看了 grep 结果。
- 发光金字塔与描边距离场的既有着色器（`glow_prefilter`、`stroke_seed` / `stroke_jfa` 的内部实现）没有通读，只核对了改动处与它们的接口。

## Claude 裁定（11-01）
1. 补收缩/扩展、边缘柔化与“去掉主体”组合、主体发光随淡出的 GPU 用例。2. 画中画：片段边界处蒙版按边界值延续，不沿裁切线画轮廓。3. “去掉主体”改为主参数（规范优先）。
原有问题：导出时区域/主体蒙版读失败改为报错（人脸打码同改），预览照旧跳过；描边 50% 突变归“片段不透明度改到效果后”那张单；蒙版不跟链里前面的几何效果，记入以后再做。
界面的分析进度与重试由 Claude 在 U15b 一并做。
