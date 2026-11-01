# 19-U7 生成器：非界面交付

## 状态与范围

非界面实现已完成，原基线最终 L2 已通过，已吸收 main 的 ticket 17 并顺延版本，正在完成受影响复验。当前基于 main `5d863360d`（已包含 ticket 17）；只在 `task/19-U7-生成器` 工作，最终变基到交付时的 main，保持本单一提交，不推送、不合并 main。

- 原生 `gradient`：线性、径向、角向、菱形、多点；OkLab/标准 sRGB 插值、预乘透明插值、中点、重复/往返、混合模式、按内容 bounds 定位。非纯色声明高精度，末道统一抖动，效果内部不另加抖动。
- 多点漂移按正式 `frame × frameDuration` 时钟求值，幅度为内容高度 3%；声明 `frameSeed`，静止或纯色不随帧使缓存失效。
- 作者 `fill`：版本边界内把原生生成器变成 bounds 画面来源，接现有图层效果、位姿、裁剪、观察与高精度链；保留旧接口同名作者字段。生成器解析绘制按实际所需倍率栅格，不强制静态 2 倍。
- 噪声 10 合 1、图案 12 合 1、光效背景 7 合 1，通过 main 的 WRAPPED 表选择组件；保留胶片模拟与老式画面的封装及源 alpha 行为。共有参数前置，独有参数按方式显隐，颜色可透明；数值换算复用组件声明。
- 波形、波纹、螺旋、旋涡、正弦波、下落线条、影棚背景保留各自 ID，改中文名、分组、说明与中性默认色；影棚 ambient_speed 不可动画且进入组件会话键，已有速度关键帧沿正式 first 语义读入。
- 11 个生成器进入 generator 类别与显式有序目录，不再列在视频效果分组；大理石保持更多分类；移除图形 16 个、纯色、流体团，八种渐变来源组件列入 SAME_AS_BUILTIN。画面效果的合并/删除按设计决定 6：不迁移旧 ID，容错读入、跳过渲染，可删除旧项。
- 应用层创建整幅黑底 solid 图形片段，生成器是效果链第一项，创建素材、放置、加效果为一步撤销；纯规划函数与正式提交入口共用现有素材落点内核。返回的 placedClips 已包含最终效果。
- 助手复用已有通用集合：建 graphic/solid 素材项 → 引用素材项创建片段 → 添加 effect:<生成器ID> → 通用改参数与回读。没有新增专用 CRUD 工具。

## Claude 界面接入接口

本提交没有任何 `.tsx` 改动，也没有提交原代理的拖放/UI 接线。原始完整补丁保存在任务工作目录 `.tmp/U7-inherited.patch`，仅界面相关补丁在 `.tmp/U7-interface.patch`，供比较思路；请按最新 main 骨架接线，不直接整份套补丁。

1. 目录：`src/core/videoEdit/effectsRegistry.ts::videoEditEffectsRegistry()`。生成器条目 `category === 'generator'`、`kind === 'effect'`、`builtinId` 为执行 ID、`id` 为 `effect:<builtinId>`；`params`、`description`、`aliases` 来自定义。生成类别不再提供额外小组标题。顺序唯一来源是 `src/core/videoEdit/effectCatalog.ts::VIDEO_EDIT_EFFECT_CATALOG`。
2. 轨道空白处预演：`src/features/videoEdit/application/videoEditGenerators.ts::placeVideoEditGenerator(source, sequenceId, builtinId, placement, options)`。`placement` 沿用 `VideoEditDropPlacement = { frame, track?, newTrack?: 'video'|'audio', mode? }`；`options = { targetTrackIds: readonly string[], codeMetadata? }`。返回 `{ document, clipId, placedClips, resultSequence }`；源文档不变。虚影/落点请消费该结果，不再手写第二套位置算法。
3. 松手提交：同文件 `await dropVideoEditGenerator(projectId, sequenceId, builtinId, placement)`，返回 `clipId`；一步撤销，当前序列自动选中新片段；带 start/completed/failed 结构化日志。不能把噪声/图案等封装生成器传给作者 fill。
4. 落在已有片段或选中图形上：继续复用现有 `applyVideoEditBuiltinEffect` / `applyVideoEditLibraryEffect` 正式入口，沿既有多选/锁定/媒体类型落点逻辑处理；不要调用新建片段入口。生成器按内容 alpha 裁剪，圆角卡片得到圆角生成结果。
5. 纯应用层模板实例化：`videoEditCompositing.ts::instantiateVideoEditEffects(templates, clipDuration)`，添加效果与创建生成片段共用；每项新身份、模板曲线截到片段时长。UI 不应复制这些逻辑。
6. 原生作者用法：作者接口 `CODE_AUTHOR_FILL_MIN_API_VERSION` 起，`{ id:'bg', bounds:[0,0,w,h], fill: t => ({id:'gradient', params:{mode:'radial'}}), effects?, pose?, clip? }`。生成的 gradient 工厂已直测；henji-effects 仍按全局 U16 冻结发布安排，不擅自冻结新库。
7. 需要 Claude 做：生成文件夹面板显示；拖到轨道空白处的预演/提交接线；落在既有片段时复用效果添加；正式 Electron 窗口中的拖放目视与交互验收。

## 持久格式

图形已有 solid 工厂能够表达整幅矩形，没有改图形 schema。
作者 fill 增加宿主接口，所有可容纳作者版本的正式容器各升一次，并提高最低可读版本；每步只保留历史源码/接口/库，不升级历史作者代码。新黄金样本由正式生成器生成，保留全部旧样本与既有发布承诺。

| 格式 | 版本 |
|---|---|
| 作者接口 | 13 → 14 |
| 剪辑内容 | 57 → 58 |
| 录制会话 | 60 → 61 |
| 代码版本记录 | 14 → 15 |
| 代码资产 | 19 → 20 |
| 本机效果库 | 10 → 11 |
| 预设包 | 17 → 18 |
| 风格库 | 13 → 14 |
| 模板库 | 10 → 11 |
| 风格包 | 16 → 17 |

ticket 17 已占用作者接口 13，最终按上表顺延；main 的既有样本逐字节保留，重新生成的样本包含 fill。

## 验证与实测

- 精确初验：5 文件 37 项通过；应用组合与作者公共契约：2 文件 8 项通过。
- 最终 L2 测试阶段：17 文件 580 项通过；1 项既有全着色器组件扫描由 `HENJI_SHADER_SWEEP=1` 显式启用，本次未启用。包括正式 GPU 三文件的 91 项，和核心/应用/作者/持久旧样本测试。GPU 主动拒绝格式不兼容的既有测试会打印 validation，测试通过；未放宽断言或更新像素快照。
- `check:assistant-capabilities` 通过：结构/覆盖 1 文件 15 项、不变量 31 文件 238 项；正式通用组合的透明颜色写入、参数修改、回读与失败无残留均纳入应用测试。
- `check:author-effects` 通过；`check:persistence-compat` 通过，66 种格式。baseline、release-snapshot 已由正式脚本生成。
- 原基线最终 L2 静态阶段：通过，详见 `.tmp/u7-final-static.log`。变基后的精确范围另含模拟状态机，记录在 `.tmp/u7-post17-checks.log`，仅复用未变的颜色/表面等静态门禁证据。正式验证计划来自 `scripts/lib/changedVerificationPlan.cjs` 和 `resolveChangedTests.cjs`，显式本次清单 `.tmp/u7-final-files.json`；仅将两套 tsc 调用增加用户指定的 `node --max-old-space-size=8192`，其他步骤不降级。复现入口：经 heavy.sh 运行 `node .tmp/u7-verify.cjs`。
- 目视：本次重生成 48 张画面，覆盖全部生成器与关键方式/波形样式；已打开 `.tmp/U7-evidence/contact-current.png` 核对。图案和噪声均中性，棱镜组件固有分光为彩虹，不改组件算法。
- 变基后新增正式 GPU 用例：作者接口 14 同时声明 createSimulation 与 fill，模拟状态驱动渐变位置；0→1→0 秒乱序读取恢复相同像素，通过（`.tmp/u7-post17-fill-gpu.log`）。
- 4K 暗底径向：正式 16f 生成 → 正式末道 present shader → 8 位，`bandingReview` 返回 `[]`；`dark-4k.png`、`dark-4k-contrast6.png`。另有直接 8 位的反例在正式 GPU 回归中确实检出色带。
- FFmpeg 软件 H.264 CRF 20、slow、yuv420p、1 秒：`dark-4k-crf20.mp4` 及解码帧。检测仍为 `[]`，但已目视在 6 倍亮度图中看到轻微环带，归压缩侧现象，不在效果里加大抖动；不把该实验称作完整应用导出验收。

1080p 渐变，预热 5 次、测量 30 次，真实 render pass 的 timestamp-query，不含 CPU 提交、空计时 pass 或读回：

| 方式 | P50 ms | P95 ms | 目标 |
|---|---:|---:|---:|
| 线性 | 0.043008 | 0.044032 | ≤0.1 |
| 径向 | 0.044032 | 0.047104 | ≤0.1 |
| 角向 | 0.048128 | 0.048128 | ≤0.1 |
| 菱形 | 0.046080 | 0.047104 | ≤0.1 |
| 多点 | 0.063488 | 0.063488 | ≤0.1 |

线性一项最大值有 0.185344 ms 单次离群，未掩盖；其 P95 仍达标。完整分布摘要在 `metrics.json`。封装生成器沿用组件的 8 位出口，不承诺防色带。

封装生成器默认方式，1080p，预热 5 次、测量 30 次；拦截实际 render/compute pass 的 timestamp-query 后求和，包含宿主上传与呈现（4 道），不计 CPU 等待，不设目标：

| 生成器 | P50 ms | P95 ms |
|---|---:|---:|
| noise | 0.050176 | 0.052224 |
| pattern | 0.041984 | 0.043008 |
| light_background | 0.060416 | 0.061440 |
| shaders.Waveform | 0.055296 | 0.056320 |
| shaders.Ripples | 0.036864 | 0.037888 |
| shaders.Spiral | 0.039936 | 0.040960 |
| shaders.Swirl | 0.045056 | 0.046080 |
| shaders.SineWave | 0.036864 | 0.037888 |
| shaders.FallingLines | 0.044032 | 0.045056 |
| shaders.StudioBackground | 0.052224 | 0.053248 |

设备：VGPU Node/Dawn，D3D12 driver 32.0.16.1047（type=gpu）；实测明细 `wrapped-metrics.json`。


## 选型、取舍与排查范围

- 保留项目既有 OkLab/颜色数学、效果规划与 present 抖动，原生渐变只增加必要的一道 WGSL；没有新增依赖，没有手写第二套渲染执行器。
- 封装效果继续使用已安装的 shaders 组件；为了内容 alpha 内混合，图结构使用隐藏的内容遮罩源与生成组，保留直通色后只乘一次 alpha。宿主纹理按图层实例登记，避免同一种输入作为底图/遮罩时只更新其中一份。
- 同源排查覆盖 WRAPPED 中的胶片/老式画面与全部生成器；预热、组件结构选择、编译期属性、混合模式与快慢时钟会话键；重复输入图层；正常/透明/半透明画面；作者图层与调整层；目录投影；应用落点与撤销；全部支持的持久黄金样本。
- 本次从 main 恢复现有正式时钟与字体会话的实现，不把半成品的 shaderTimeSeconds 路线带回来。
- 独立干净上下文审查 3 轮：首轮指出合并颜色漏开 alpha，已统一修复并验证正式通用写入；旧 ID 不迁移疑问经设计决定 6 核对后撤回。第二轮无新增有证据问题；第三轮仅审 ticket 17 变基增量与版本顺延，未发现新问题。
- 未访问登录浏览器、网页账号、外部聊天、9334 开发实例或 `D:\视频制作`；无安装/卸载依赖，无删除联接点，无完整 Electron 构建，无正式 UI 验收。临时 GPU 探针已移出源码目录，不提交图片、日志、视频和探针。

## 参数表

下表从本次正式生成器定义直接导出，按真实目录/参数顺序列出组、名称、默认、软硬范围和方式条件；不是另一份实现来源。

### 渐变（gradient）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 方式 / mode | linear | 线性=linear、径向=radial、角向=conic、菱形=diamond、多点=points | 全部 |
| — | 起点颜色 / start_color | #000000 | 颜色（可透明） | {"param":"mode","in":["linear","radial","conic","diamond"]} |
| — | 终点颜色 / end_color | #ffffff | 颜色（可透明） | {"param":"mode","in":["linear","radial","conic","diamond"]} |
| 位置 | 起点（水平） / start_x | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["linear","radial","conic","diamond"]} |
| 位置 | 起点（垂直） / start_y | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["linear","radial","conic","diamond"]} |
| 位置 | 终点（水平） / end_x | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["linear","radial","diamond"]} |
| 位置 | 终点（垂直） / end_y | 100 | 0–100 / -100–200 percent | {"param":"mode","in":["linear","radial","diamond"]} |
| 位置 | 起始角度 / angle | 0 | -180–180 / -180–180 degrees | {"param":"mode","in":["conic"]} |
| 点 1 | 颜色 / p1_color | #000000 | 颜色（可透明） | {"param":"mode","in":["points"]} |
| 点 1 | 水平位置 / p1_x | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 点 1 | 垂直位置 / p1_y | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 点 2 | 颜色 / p2_color | #404040 | 颜色（可透明） | {"param":"mode","in":["points"]} |
| 点 2 | 水平位置 / p2_x | 100 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 点 2 | 垂直位置 / p2_y | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 点 3 | 颜色 / p3_color | #c0c0c0 | 颜色（可透明） | {"param":"mode","in":["points"]} |
| 点 3 | 水平位置 / p3_x | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 点 3 | 垂直位置 / p3_y | 100 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 点 4 | 颜色 / p4_color | #ffffff | 颜色（可透明） | {"param":"mode","in":["points"]} |
| 点 4 | 水平位置 / p4_x | 100 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 点 4 | 垂直位置 / p4_y | 100 | 0–100 / -100–200 percent | {"param":"mode","in":["points"]} |
| 颜色 | 中点 / midpoint | 50 | 1–99 / 1–99 percent | {"param":"mode","in":["linear","radial","conic","diamond"]} |
| 颜色 | 插值 / interpolation | perceptual | 感知=perceptual、标准=srgb | 全部 |
| 颜色 | 重复 / repeat | none | 不重复=none、重复=repeat、往返=mirror | {"param":"mode","in":["linear","radial","conic","diamond"]} |
| 颜色 | 漂移 / drift | 0 | 0–100 / 0–100 percent | {"param":"mode","in":["points"]}；不可动画 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=soft_light | 全部 |

### 噪声（noise）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 方式 / mode | perlin | 柏林=perlin、分形=fractal、单形=simplex、方块=block、细胞=worley、旋流=curl、指纹=gabor、小波=wavelet、侵蚀=erosion、蓝噪声=blue | 全部 |
| 颜色 | 颜色 A / color_a | #ffffff | 颜色（可透明） | 全部 |
| 颜色 | 颜色 B / color_b | #000000 | 颜色（可透明） | 全部 |
| — | 缩放 / scale | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["block","curl","erosion","gabor","perlin","simplex","wavelet","worley"]} |
| — | 对比度 / contrast | 50 | 0–100 / 0–100 strength | 全部 |
| 颜色 | 平衡 / balance | 0 | -100–100 / -100–100 strength | {"param":"mode","in":["perlin","simplex","block","worley","curl","gabor","wavelet","erosion","blue"]} |
| 变化 | 随机种子 / seed | 0 | 0–100 / 0–100 strength | 全部；不可动画 |
| 变化 | 速度 / speed | 1 | 0–4 / 0–4 multiplier | {"param":"mode","in":["block","curl","fractal","gabor","perlin","simplex","wavelet","worley"]}；不可动画 |
| — | 细节 / detail | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["fractal","gabor","wavelet"]} |
| 分形 | 层数 / octaves | 4 | 1–8 / 1–8 value | {"param":"mode","in":["fractal"]}；不可动画 |
| 分形 | 角度 / angle | 0 | -180–180 / -180–180 degrees | {"param":"mode","in":["fractal"]} |
| 细胞 | 形态 / cell_shape | f1 | 斑点=f1、大斑=f2、裂纹=f2MinusF1、鳞片=f1PlusF2、卵石=f1TimesF2 | {"param":"mode","in":["worley"]} |
| 细胞 | 轮廓 / cell_edge | euclidean | 圆=euclidean、菱形=manhattan、方=chebyshev | {"param":"mode","in":["worley"]} |
| 细胞 | 随机程度 / jitter | 100 | 0–100 / 0–100 strength | {"param":"mode","in":["worley"]} |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 图案（pattern）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 方式 / mode | grid | 线框网格=grid、条纹=stripes、人字纹=chevron、棋盘格=checker、蜂窝=hex、三角网格=triangles、等距立方=cubes、点阵=dots、砖墙=brick、编织=weave、特鲁谢=truchet、泰森多边形=voronoi | 全部 |
| 颜色 | 颜色 A / color_a | #ffffff | 颜色（可透明） | 全部 |
| 颜色 | 颜色 B / color_b | #000000 | 颜色（可透明） | {"param":"mode","in":["grid","stripes","chevron","checker","hex","triangles","cubes","brick","weave","truchet","voronoi"]} |
| — | 缩放 / scale | 50 | 0–100 / 0–100 strength | 全部 |
| 颜色 | 平衡 / balance | 0 | -100–100 / -100–100 strength | {"param":"mode","in":["stripes","chevron"]} |
| 变化 | 随机种子 / seed | 0 | 0–100 / 0–100 strength | {"param":"mode","in":["brick","truchet","voronoi"]}；不可动画 |
| 变化 | 移动 / speed | 0 | -100–100 / -100–100 strength | {"param":"mode","in":["stripes","chevron","triangles","dots","brick","voronoi"]}；不可动画 |
| — | 旋转 / rotation | 0 | -180–180 / -180–180 degrees | {"param":"mode","in":["grid","stripes","chevron","hex","triangles","cubes","brick","weave","truchet"]} |
| — | 线宽 / line_width | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["grid","hex","triangles","cubes","brick","truchet","voronoi"]} |
| 颜色 | 边线颜色 / line_color | #404040 | 颜色（可透明） | {"param":"mode","in":["cubes","voronoi"]} |
| 边缘 | 柔和 / softness | 0 | 0–100 / 0–100 strength | {"param":"mode","in":["grid","stripes","chevron","checker","hex","triangles","cubes","brick","truchet"]} |
| 边缘 | 明暗变化 / variation | 0 | 0–100 / 0–100 strength | {"param":"mode","in":["grid","hex","triangles","cubes","brick"]} |
| 边缘 | 缝隙 / gap | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["weave"]} |
| 点 | 点大小 / dot_size | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["dots"]} |
| 点 | 闪烁 / twinkle | 0 | 0–100 / 0–100 strength | {"param":"mode","in":["dots"]} |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 光效背景（light_background）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 方式 / mode | godrays | 体积光=godrays、极光=aurora、光束=beam、放射光芒=sunburst、棱镜=prism、光丝=strands、等离子=plasma | 全部 |
| 颜色 | 光的颜色 / color_a | #ffffff | 颜色（可透明） | 全部 |
| 颜色 | 第二颜色 / color_b | #000000 | 颜色（可透明） | {"param":"mode","in":["godrays","aurora","beam","sunburst","strands","plasma"]} |
| 变化 | 随机种子 / seed | 0 | 0–100 / 0–100 strength | {"param":"mode","in":["aurora"]}；不可动画 |
| 变化 | 速度 / speed | 1 | 0–4 / 0–4 multiplier | {"param":"mode","in":["godrays","aurora","sunburst","prism","strands","plasma"]}；不可动画 |
| — | 强度 / intensity | 100 | 0–100 / 0–200 strength | {"param":"mode","in":["godrays","aurora","prism","plasma"]} |
| 位置 | 光源（水平） / rays_x | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["godrays"]} |
| 位置 | 光源（垂直） / rays_y | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["godrays"]} |
| 位置 | 位置（水平） / aurora_x | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["aurora"]} |
| 位置 | 位置（垂直） / aurora_y | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["aurora"]} |
| 位置 | 中心（水平） / burst_x | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["sunburst"]} |
| 位置 | 中心（垂直） / burst_y | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["sunburst"]} |
| 位置 | 起点（水平） / beam_start_x | 20 | 0–100 / -100–200 percent | {"param":"mode","in":["beam"]} |
| 位置 | 起点（垂直） / beam_start_y | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["beam"]} |
| 位置 | 终点（水平） / beam_end_x | 80 | 0–100 / -100–200 percent | {"param":"mode","in":["beam"]} |
| 位置 | 终点（垂直） / beam_end_y | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["beam"]} |
| 位置 | 光源（水平） / prism_x | 18 | 0–100 / -100–200 percent | {"param":"mode","in":["prism"]} |
| 位置 | 光源（垂直） / prism_y | 18 | 0–100 / -100–200 percent | {"param":"mode","in":["prism"]} |
| 位置 | 分光点（水平） / prism_split_x | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["prism"]} |
| 位置 | 分光点（垂直） / prism_split_y | 42 | 0–100 / -100–200 percent | {"param":"mode","in":["prism"]} |
| 位置 | 起点（水平） / strands_start_x | 0 | 0–100 / -100–200 percent | {"param":"mode","in":["strands"]} |
| 位置 | 起点（垂直） / strands_start_y | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["strands"]} |
| 位置 | 终点（水平） / strands_end_x | 100 | 0–100 / -100–200 percent | {"param":"mode","in":["strands"]} |
| 位置 | 终点（垂直） / strands_end_y | 50 | 0–100 / -100–200 percent | {"param":"mode","in":["strands"]} |
| 形状 | 数量 / count | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["godrays","sunburst","strands","plasma"]} |
| 形状 | 粗细 / width | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["beam","prism","strands"]} |
| 形状 | 柔和 / softness | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["beam","sunburst","prism"]} |
| 形状 | 波动 / wave | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["aurora","strands","plasma"]} |
| 形状 | 展开 / spread | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["aurora","sunburst","prism","strands"]} |
| 形状 | 细节 / detail | 50 | 0–100 / 0–100 strength | {"param":"mode","in":["godrays","aurora"]} |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 波形（shaders.Waveform）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 样式 / style | bars | 条带=bars、波浪=wave、线条=line、点阵=dots | 全部 |
| — | 音量 / amplitude | 1 | 0–2 / 0–2 value | 全部 |
| 波形 | 起伏密度 / frequency | 1 | 0.2–3 / 0.2–3 value | 全部 |
| 波形 | 最大高度 / height | 0.6 | 0.05–1 / 0.05–1 value | 全部 |
| 波形 | 朝向 / align | mirrored | 镜像=mirrored、上=top、下=bottom | 全部 |
| 波形 | 柔和 / softness | 0 | 0–1 / 0–1 value | 全部 |
| 柱与点 | 柱数 / count | 32 | 4–128 / 4–128 value | {"param":"style","in":["bars","dots"]} |
| 柱与点 | 柱宽 / bar_width | 0.6 | 0.1–1 / 0.1–1 value | {"param":"style","in":["bars"]} |
| 柱与点 | 圆头 / rounding | 1 | 0–1 / 0–1 value | {"param":"style","in":["bars"]} |
| 柱与点 | 点大小 / dot_size | 0.7 | 0.2–1 / 0.2–1 value | {"param":"style","in":["dots"]} |
| 柱与点 | 线宽 / line_width | 0.006 | 0.001–0.05 / 0.001–0.05 value | {"param":"style","in":["line"]} |
| 颜色 | 起点颜色 / color_a | #ffffff | 颜色（可透明） | 全部 |
| 颜色 | 终点颜色 / color_b | #c0c0c0 | 颜色（可透明） | 全部 |
| 位置 | 起点（水平） / from_x | 0 | -100–200 / -100–200 percent | 全部 |
| 位置 | 起点（垂直） / from_y | 50 | -100–200 / -100–200 percent | 全部 |
| 位置 | 终点（水平） / to_x | 100 | -100–200 / -100–200 percent | 全部 |
| 位置 | 终点（垂直） / to_y | 50 | -100–200 / -100–200 percent | 全部 |
| 变化 | 速度 / speed | 1 | 0–3 / 0–3 value | 全部；不可动画 |
| 变化 | 随机种子 / seed | 1 | 0–100 / 0–100 value | 全部 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 波纹（shaders.Ripples）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 圈数 / frequency | 20 | 1–80 / 1–80 value | 全部 |
| — | 粗细 / thickness | 0.5 | 0–1 / 0–1 value | 全部 |
| 颜色 | 波纹颜色 / color_a | #ffffff | 颜色（可透明） | 全部 |
| 颜色 | 底色 / color_b | #000000 | 颜色（可透明） | 全部 |
| 位置 | 中心（水平） / center_x | 50 | -100–200 / -100–200 percent | 全部 |
| 位置 | 中心（垂直） / center_y | 50 | -100–200 / -100–200 percent | 全部 |
| 波纹 | 柔和 / softness | 0 | 0–3 / 0–3 value | 全部 |
| 波纹 | 偏移 / phase | 0 | 0–6.28 / 0–6.28 value | 全部 |
| 波纹 | 速度 / speed | 1 | -5–5 / -5–5 value | 全部；不可动画 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 螺旋（shaders.Spiral）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 密度 / scale | 1 | 0.1–5 / 0.1–5 value | 全部 |
| — | 线宽 / stroke_width | 0.5 | 0–2 / 0–2 value | 全部 |
| 颜色 | 底色 / color_a | #000000 | 颜色（可透明） | 全部 |
| 颜色 | 线条颜色 / color_b | #ffffff | 颜色（可透明） | 全部 |
| 位置 | 中心（水平） / center_x | 50 | -100–200 / -100–200 percent | 全部 |
| 位置 | 中心（垂直） / center_y | 50 | -100–200 / -100–200 percent | 全部 |
| 线条 | 向外变细 / stroke_falloff | 0 | 0–1 / 0–1 value | 全部 |
| 线条 | 柔和 / softness | 0 | 0–1 / 0–1 value | 全部 |
| 线条 | 速度 / speed | 1 | -3–3 / -3–3 value | 全部；不可动画 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 旋涡（shaders.Swirl）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 细节 / detail | 1 | 0–5 / 0–5 value | 全部 |
| — | 平衡 / blend | 50 | 0–100 / 0–100 value | 全部 |
| — | 速度 / speed | 1 | 0–5 / 0–5 value | 全部；不可动画 |
| 颜色 | 颜色 A / color_a | #404040 | 颜色（可透明） | 全部 |
| 颜色 | 颜色 B / color_b | #c0c0c0 | 颜色（可透明） | 全部 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 正弦波（shaders.SineWave）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 起伏高度 / amplitude | 0.15 | 0–1 / 0–1 value | 全部 |
| — | 波数 / frequency | 1 | 0.1–20 / 0.1–20 value | 全部 |
| — | 粗细 / thickness | 0.2 | 0–2 / 0–2 value | 全部 |
| 线条 | 颜色 / color | #ffffff | 颜色（可透明） | 全部 |
| 线条 | 柔和 / softness | 0.4 | 0–1 / 0–1 value | 全部 |
| 线条 | 速度 / speed | 1 | -5–5 / -5–5 value | 全部；不可动画 |
| 位置 | 位置（水平） / position_x | 50 | -100–200 / -100–200 percent | 全部 |
| 位置 | 位置（垂直） / position_y | 50 | -100–200 / -100–200 percent | 全部 |
| 位置 | 角度 / angle | 0 | 0–360 / 0–360 value | 全部 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 下落线条（shaders.FallingLines）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 密度 / density | 15 | 1–60 / 1–60 value | 全部 |
| — | 拖尾长度 / trail_length | 0.35 | 0.01–1 / 0.01–1 value | 全部 |
| — | 速度 / speed | 0.5 | 0–3 / 0–3 value | 全部；不可动画 |
| 颜色 | 头部颜色 / color_a | #ffffff | 颜色（可透明） | 全部 |
| 颜色 | 尾部颜色 / color_b | #ffffff00 | 颜色（可透明） | 全部 |
| 颜色 | 渐变中点 / balance | 0.5 | 0–1 / 0–1 value | 全部 |
| 线条 | 粗细 / stroke_width | 0.15 | 0.02–1 / 0.02–1 value | 全部 |
| 线条 | 圆头 / rounding | 1 | 0–1 / 0–1 value | 全部 |
| 运动 | 方向 / angle | 90 | 0–360 / 0–360 value | 全部 |
| 运动 | 快慢差异 / speed_variance | 0.3 | 0–1 / 0–1 value | 全部 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

### 影棚背景（shaders.StudioBackground）

| 组 | 名称 / 键 | 默认 | 软 / 硬范围 | 显隐 / 动画 |
|---|---|---|---|---|
| — | 台面颜色 / color | #808080 | 颜色（可透明） | 全部 |
| — | 环境亮度 / brightness | 20 | 0–100 / 0–100 value | 全部 |
| — | 暗角 / vignette | 0 | 0–100 / 0–100 value | 全部 |
| 主光 | 颜色 / key_color | #ffffff | 颜色（可透明） | 全部 |
| 主光 | 亮度 / key_intensity | 40 | 0–100 / 0–100 value | 全部 |
| 主光 | 柔和 / key_softness | 50 | 0–100 / 0–100 value | 全部 |
| 辅光 | 颜色 / fill_color | #ffffff | 颜色（可透明） | 全部 |
| 辅光 | 亮度 / fill_intensity | 10 | 0–100 / 0–100 value | 全部 |
| 辅光 | 柔和 / fill_softness | 70 | 0–100 / 0–100 value | 全部 |
| 辅光 | 张开 / fill_angle | 70 | 0–100 / 0–100 value | 全部 |
| 背光 | 颜色 / back_color | #ffffff | 颜色（可透明） | 全部 |
| 背光 | 亮度 / back_intensity | 20 | 0–100 / 0–100 value | 全部 |
| 背光 | 柔和 / back_softness | 80 | 0–100 / 0–100 value | 全部 |
| 布景 | 台面中心（水平） / center_x | 50 | -100–200 / -100–200 percent | 全部 |
| 布景 | 台面中心（垂直） / center_y | 80 | -100–200 / -100–200 percent | 全部 |
| 布景 | 光的落点 / light_target | 100 | 0–100 / 0–100 value | 全部 |
| 布景 | 墙角弧度 / wall_curvature | 10 | 0–100 / 0–100 value | 全部 |
| 环境光 | 漂移光 / ambient_intensity | 50 | 0–100 / 0–100 value | 全部 |
| 环境光 | 速度 / ambient_speed | 2 | -5–5 / -5–5 value | 全部；不可动画 |
| 环境光 | 随机种子 / seed | 0 | 0–100 / 0–100 value | 全部 |
| 输出 | 混合模式 / blend_mode | normal | 正常=normal、正片叠底=multiply、滤色=screen、叠加=overlay、柔光=softLight、强光=hardLight、线性减淡（添加）=linearDodge、线性加深=linearBurn、颜色减淡=colorDodge、颜色加深=colorBurn、变暗=darken、变亮=lighten、差值=difference、排除=exclusion、色相=hue、饱和度=saturation、颜色=color、明度=luminosity | 全部 |

## Claude 接手收尾（11-01 14:50）

Codex 额度用尽停在变基复验途中（变基已解完冲突、尚未继续）。接手后：完成那次变基，提交为一单，再变基到当前 main（含 U15b/U15c、作者库登记修复），无冲突。
复验：tsc；check:persistence-compat（66 种）、check:author-effects、check:assistant-capabilities（31 文件）；精确 14 个测试文件；GPU 三文件（shaderGraph、内置效果、内容精度）通过。
界面部分（“生成”文件夹、拖到轨道空白处新建）由 Claude 在 main 上另做。
