# T5 交接：GL 转场库（以后再做第 7 条）

结论：gl-transitions 2.0.0 自带 WGSL，不需要做 GLSL→WGSL 转换。用生成脚本收录了 74 个转场（`transition:gl.<名>`），没有新增运行时依赖。每个转场都核验过：两端逐像素等于前后两段，中间帧与 GLSL 参考渲染一致。

## 1. 调研结论

- **包与版本**：npm `gl-transitions@2.0.0`（2026-10-25 发布，作者 gre，仓库 github.com/gl-transitions/gl-transitions）。“2.0”确实存在，主要变化是转场统一改用 PascalCase 名字、保留透明度、删掉两个近似重复的转场。
- **是否带 WGSL**：带。包里有 `wgsl/<名>.wgsl`（125 个，每个都是完整的片元着色器）、`layouts.json`（uniform 字节布局）和 `compatibility.json`。README 写明 WGSL 由 naga 从 GLSL（经 SPIR-V）译出，在上游 CI 中经 naga 校验、用 Dawn 渲染，再与 GLSL 对比。另有 glsl3、msl、sksl 版本。
- **许可**：集合整体是 MIT（Copyright (c) 2017-present gl-transitions contributors）。各转场可以在源码头部另写许可：125 个中 123 个是 MIT；`InvertedPageCurl` 是 BSD 3-Clause（Hewlett-Packard），本次因重复未收；`StereoViewer` 是 BSD 2-Clause（Ted Schundler），已收录并单独登记许可全文。
- **转换方案比较**：
  - 上游 WGSL：已由 naga 生成，并在上游 CI 经 Dawn 渲染对比。直接用即可，工作量最小。
  - 自己用 naga 或 tint 转换：结果与上游相同，只是多一条构建链，没有收益。
  - 手工移植：工作量大，容易出错。
  - **选择上游 WGSL**，只做最小的文本改造（`scripts/lib/glTransitionWgsl.cjs`）：
    - 把入口 `main` 改成普通函数；
    - 对两段画面的取样先还原直通色（剪辑纹理是预乘的，gl-transitions 读写直通色），输出时再预乘；
    - 追加全屏三角形的顶点和片元入口。
  - 结构与预期不符时脚本直接报错。
- **接入方式**：与 `shaders` 转场一样，由生成脚本登记成字面量种类。渲染不走 shaders 的着色器图，而是在 `videoEditCodeGpu.transition` 里新增一个分支，交给新的执行器 `VideoEditGlTransitionsGpu`：
  - 绑定沿用上游契约：0 uniform、1 取样器、2 前一段、3 后一段；
  - 管线按（转场, 输出格式）懒编译；
  - 着色器表（约 376KB 文本）在首次用到时才动态加载。
- **包不作运行时依赖**：生成脚本默认用 `npm pack gl-transitions@2.0.0` 把包下载到系统临时目录，也可用 `--from <包目录>` 指定。没有改 package.json 和 lock 文件。

## 2. 收录清单

种类写作 `gl.<名>`。下表“许可”列除 StereoViewer 外都是 MIT。核验标准：
- 进度 0、1 与前后段在 160×90 与 64×36 下逐像素差 0；
- 0.25、0.5、0.75 三处与 GLSL 参考渲染比较，任一通道差超过 16/255 的像素不超过 1.2%（上游门槛是 1%；160×90 下一整行边界约占 1.1%）。

收录的 74 个全部通过；“最大超差”指中间帧超差像素的最大占比，0 表示与参考的最大差不超过 1/255。

| 分组 | 名称（中文名） | 作者 | 最大超差 |
|---|---|---|---|
| 形状擦除 | BowTie（领结擦除） | KMojek | 0 |
| 形状擦除 | BowTieHorizontal（横向领结） / BowTieVertical（纵向领结） | huynx | 0 |
| 形状擦除 | Box（方框收放） | lql | 0.56% |
| 形状擦除 | FlowerWipe（花瓣擦除） | Fernando Kuteken | 0 |
| 形状擦除 | HeartWipe（心形擦除） | gre | 0 |
| 形状擦除 | LeafWipe（叶形擦除） | @Flexi23 | 0.03% |
| 形状擦除 | StarWipe（星形擦除） | Ben Lucas | 0.01% |
| 形状擦除 | PolkaDotsCurtain（圆点幕） | bobylito | 0 |
| 形状擦除 | RectangleCover（方块遮盖） / RectangleIris（方形划像） | martiniti | 0.56% |
| 形状擦除 | SquaresWipe（方格扫入） | gre | 0 |
| 形状擦除 | TilesWave（方块波浪） | numb3r23 | 0 |
| 形状擦除 | UndulatingBurnOut（波边烧穿） | pthrasher | 0.26% |
| 形状擦除 | DirectionalWarp（扭曲擦除） | pschroen | 0 |
| 形状擦除 | Pinwheel（风车） | Mr Speaker | 0 |
| 滑动与翻转 | BookFlip（翻书） | hong | 0 |
| 滑动与翻转 | Bounce（弹跳落下） | Adrian Purser | 0 |
| 滑动与翻转 | DirectionalScaled（缩小推动） | Thibaut Foussard | 0.85% |
| 滑动与翻转 | Fold（折叠） | nwoeanhinnogaehr | 0 |
| 滑动与翻转 | LeftRight（左缩右进） / TopBottom（上缩下进） | zhmy | 0 / 1.11% |
| 滑动与翻转 | SlideAwayRight（右滑揭开） | lizhongjian | 0 |
| 滑动与翻转 | SplitSlideIn/Out/InOut × Horizontal/Vertical（水平/垂直 分入、分出、分换，共 6 个） | OllyOllyOlly | ≤0.56% |
| 滑动与翻转 | SimpleFlip（翻转） | nwoeanhinnogaehr | 0 |
| 滑动与翻转 | Rolls（翻滚） | Mark Craig | 0.13% |
| 滑动与翻转 | Squeeze（挤压） | gre | 1.11% |
| 缩放与旋转 | CrossWarp（交叉扭曲） | Eke Péter | 0 |
| 缩放与旋转 | DreamyZoom（梦幻旋转缩放） | Zeh Fernando | 0 |
| 缩放与旋转 | RotateFade（旋转溶解） | haiyoucuv | 0 |
| 缩放与旋转 | RotateScaleFade（旋转放大） | Fernando Kuteken | 0 |
| 缩放与旋转 | RotateScaleVanish（旋转消失） | Mark Craig | 0 |
| 缩放与旋转 | ScaleIn（缩放淡入） | haiyoucuv | 0 |
| 缩放与旋转 | SimpleZoom（推近淡出） | 0gust1 | 0 |
| 缩放与旋转 | SimpleZoomOut（拉远淡入） | Tianshuo | 0 |
| 缩放与旋转 | ZoomWipeLeft（推近左擦） / ZoomWipeRight（推近右擦） | Handk | 0 |
| 缩放与旋转 | ZoomInCircles（圆环缩放） | dycm8009 | 0 |
| 缩放与旋转 | Revolve（旋涡卷入） | bread | 0 |
| 缩放与旋转 | Swirl（漩涡溶解） | Sergey Kosarevsky | 0 |
| 三维 | Cube（立方体旋转） | gre | 0 |
| 三维 | Doorway（开门） | gre | 0.56% |
| 三维 | Swap（三维互换） | gre | 0 |
| 三维 | StereoViewer（卡片互换），**BSD 2-Clause** | Ted Schundler | 0.1% |
| 扭曲与波纹 | ButterflyWaveScrawler（蝶翼波纹） | mandubian | 0 |
| 扭曲与波纹 | ColorCoords（色彩推挤） | haiyoucuv | 0 |
| 扭曲与波纹 | Dreamy（梦幻波动） | mikolalysenko | 0 |
| 扭曲与波纹 | FlyEye（复眼） | gre | 0 |
| 扭曲与波纹 | Hexagonalize（六边形化） | Fernando Kuteken | 0 |
| 扭曲与波纹 | Kaleidoscope（万花筒溶解） | nwoeanhinnogaehr | 0 |
| 扭曲与波纹 | PowerKaleido（万花筒折叠） | Boundless | 0 |
| 扭曲与波纹 | LissajousTiles（曲线飞块） | Boundless | 0 |
| 扭曲与波纹 | Morph（形变） | paniq | 0 |
| 扭曲与波纹 | Ripple（涟漪溶解） | gre | 0 |
| 扭曲与波纹 | WaterDrop（水滴） | Paweł Płóciennik | 0 |
| 色彩与光 | ColorDistance（按颜色切换） | P-Seebauer | 0 |
| 色彩与光 | ColorPhase（分通道溶解） | gre | 0 |
| 色彩与光 | ColorWrap（色彩环绕） | Yoni Maltsman | 0 |
| 色彩与光 | EdgeGlow（轮廓发光） | Woohyun Kim | 0 |
| 色彩与光 | FadeGrayscale（黑白溶解） | gre | 0 |
| 色彩与光 | GlowDissolve（灼烧蔓延） | hjm1fb | 0 |
| 色彩与光 | HsvFade（色相轮转） | nwoeanhinnogaehr | 0.09% |
| 色彩与光 | MultiplyBlend（正片叠底溶解） | Fernando Kuteken | 0 |
| 色彩与光 | Overexposure（过曝） | Ben Zhang | 0 |
| 故障 | DoomMelt（熔化下落） | Zeh Fernando | 0 |
| 故障 | GlitchBands（故障条带） | Yoni Maltsman | 0 |
| 故障 | GlitchDisplace（故障错位） | Matt DesLauriers | 0 |
| 故障 | GlitchFlicker（故障闪烁） | bread | 0.26% |
| 故障 | GlitchMemories（故障记忆） | Gunnar Roth | 0 |

### 不收的 51 个

原因都登记在 `src/core/videoEdit/glTransitions/zh.json` 的 `excluded` 里，生成脚本强制要求每个转场必须有归属。

- **与已有转场重复（31 个）**：
  - 与自写转场重复：
    - 交叉溶解：Fade
    - 黑场过渡、白场过渡：FadeColor
    - 闪光：FlashFade
    - 擦除：DirectionalWipe、WipeLeft、WipeRight、WipeUp、WipeDown
    - 推动：Directional、DirectionalEased
    - 滑动：Slides
    - 缩放过渡：CrossZoom、ZoomInOut
    - 模糊过渡：LinearBlur、DefocusBlur
    - 圆形划像：CircleOpen、CircleIris
  - 与 shaders 转场重复：
    - RadialWipe：ClockWipe、RadialWipe
    - BarnDoors：Horizontal/Vertical × Open/Close（4 个）
    - VenetianBlinds：WindowBlinds、WindowSlices
    - CheckerWipe：Chessboard
    - PagePeel：InvertedPageCurl
    - BlockDissolve：BlockDissolve、RandomSquares
    - NoiseDissolve：NoiseDissolve、PerlinDissolve
  - 其中 CrossZoom、RadialWipe、InvertedPageCurl、BlockDissolve 等核验本身也没通过。
- **需要额外贴图（2 个）**：DisplacementMap、LumaWipe。
- **核验未过（18 个）**：
  - 哈希噪声或雪花噪声在 SwiftShader 与 GPU 上不一致，超差 17%–99%：BurnThrough、Crosshatch、FilmBurn、GridFlip、LuminanceMelt、Mosaic、Shatter、StaticFade、StaticWipe、StripDatamoshGlitch、TvStatic、Wind。
  - 分块边界的量化或噪点不一致：CrazyParametricFun 3.9%、MosaicFade 6.6%、Pixelize 5.9%、TvLostSignal 3.4%。
  - 两端不等于前后段：MosaicBlend 差 6/255，TangentMotionBlur 差 202/255。

## 3. 改动文件

**新增**

- `scripts/generate-gl-transitions.cjs`：生成脚本。支持三种用法：默认下载固定版本、`--from <包目录>`、`--check`。它会校验收录与排除登记完整、uniform 布局与参数表一致，再生成下面两个文件。
- `scripts/lib/glTransitionWgsl.cjs`：上游 WGSL 的最小改造（入口改名、还原直通色、输出预乘、全屏三角形），生成脚本和核验脚本共用。
- `scripts/verify-gl-transitions.mjs`：收录核验脚本。WGSL 在 Dawn（vgpu/node）上渲染，GLSL 在无头 Chromium 的 SwiftShader（纯 CPU）上渲染作参考，逐帧比较并检查两端。升级包版本时先跑它。
- `scripts/third-party-licenses/gl-transitions-MIT.txt`：集合的 MIT 许可原文（取自包内 LICENSE）。
- `scripts/third-party-licenses/gl-transitions-StereoViewer-BSD-2-Clause.txt`：StereoViewer 的 BSD 2-Clause 版权与许可全文。
- `src/core/videoEdit/glTransitions/zh.json`：收录登记，包括分组、中文名、悬停说明、参数中文名、范围、选项、位置与方向语义，以及排除原因。
- `src/core/videoEdit/glTransitions/catalog.generated.ts`：生成的目录（种类字面量表、作者、许可、参数、uniform 布局）。
- `src/core/videoEdit/glTransitions/transitions.ts`：参数换算、效果面板预设（带分组）、uniform 打包。换算规则：
  - 颜色写 `#rrggbb(aa)`；
  - 选项型整数做成选项；
  - 位置拆成左上角起算的百分比，垂直方向翻转；
  - 其余向量按分量拆开。
- `src/core/videoEdit/glTransitions/transitions.test.ts`：单测，覆盖登记完整、名称不重名、默认参数能通过文档校验、uniform 打包（颜色、选项、开关、位置翻转、整数取整）。
- `src/features/videoEdit/engine/glTransitions/glTransitionShaders.generated.ts`：生成的 WGSL 表，每段开头保留上游的来源、作者、许可注释；BSD 转场附带原版权全文。
- `src/features/videoEdit/engine/glTransitions/videoEditGlTransitionsGpu.ts`：GPU 执行器。
- `src/features/videoEdit/engine/glTransitions/videoEditGlTransitions.gpu.test.ts`：Dawn 真实设备测试，覆盖：
  - 74 个全部能编译；
  - 两端逐像素等于前后段；
  - 单侧过渡空着的一侧全透明；
  - 中途帧与两端都不同；
  - rgba16float 输出可用。

**修改**

- `src/core/videoEdit/transitionParams.ts`：内置过渡种类与参数表并入 GL 转场。
- `src/core/videoEdit/transitions.ts`：过渡预设并入 GL 转场，并更新说明注释。
- `src/core/videoEdit/effectsRegistry.ts`：带 `group` 的过渡预设把分组传给效果面板。面板本身已支持按 `group` 显示小标题，未改界面文件。
- `src/features/videoEdit/engine/videoEditCodeGpu.ts`：`transition()` 新增 GL 分支（单侧过渡用已有的 1×1 透明画面），`dispose` 时释放执行器。
- `src/features/videoEdit/engine/videoEditBuiltinEffectPasses.test.ts`、`videoEditBuiltinTransitions.gpu.test.ts`：“遍历内置着色器过渡”的循环排除 GL 种类（与已有排除 shaders 种类的做法相同）。
- `src/core/videoEdit/transitions.test.ts`：参数悬停说明可以为空的豁免从 `shaders.*` 扩展到 `gl.*`。
- `scripts/lib/testSuites.cjs`：GPU 测试清单加入新的 GPU 测试文件。
- `scripts/generate-third-party-licenses.cjs`：新增 `vendored:gl-transitions` 条目（MIT 与 BSD-2-Clause 两份全文），写法与已有的 `vendored:shaders` 一致。

## 4. 验证（实际执行）

- `node scripts/generate-gl-transitions.cjs --from <包>` 生成 74 个；`--check` 走 `--from` 和自动下载两条路径都通过。
- `node scripts/verify-gl-transitions.mjs --from <包>`：98 个通过、25 个未过（与排除清单一致），收录的 74 个全部在通过名单内。渲染器是 ANGLE Vulkan SwiftShader；Dawn 上只有 CrossZoom 在 FXC 编译失败（已排除）。
- `npx vitest run src/core/videoEdit/transitions.test.ts src/core/videoEdit/glTransitions src/features/videoEdit/engine/videoEditBuiltinEffectPasses.test.ts src/features/videoEdit/application/videoEditEffectPresets.test.ts src/features/videoEdit/application/videoEditBuiltinEffects.test.ts src/core/videoEdit/builtinEffects.test.ts src/features/videoEdit/engine/videoEditCompositeScene.test.ts`：7 个文件、59 个用例全部通过。
- `npx vitest run --mode gpu src/features/videoEdit/engine/glTransitions/videoEditGlTransitions.gpu.test.ts`：3 个用例通过，约 4 秒。
- `npx vitest run --mode gpu src/features/videoEdit/engine/videoEditBuiltinTransitions.gpu.test.ts`：4 个用例通过。
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.electron.json --noEmit`：退出码 0。
- 对改动的 src 文件跑 `npx eslint`：通过。scripts 目录不在 lint 范围内。
- `npm run check:colors`：通过。
- `npm run check:assistant-capabilities`（结构、覆盖、不变量）：31 个文件、243 个用例通过。
- 调用 `generate-third-party-licenses.cjs` 导出的 `generate()`：`vendored:gl-transitions` 条目与两份许可全文都生成了。唯一的 missing 是工作树里没有 FFmpeg 包，与本次无关。产物没有写盘。
- **未覆盖**：
  - 渲染层 `tsc -p tsconfig.json` 由主控统一跑；
  - 全量测试与全量 GPU 测试没跑；
  - 没在真实 Electron 里看画面；
  - 核验用的是默认参数，没逐个验证非默认参数下的画面。

## 5. 需要用户在真实开发版里确认的步骤

1. 打开任一剪辑工程，打开效果面板 → 视频过渡：原有 23 个之后应出现 7 个分组小标题（形状擦除、滑动与翻转、缩放与旋转、三维、扭曲与波纹、色彩与光、故障），共 74 项。
2. 抽几个拖到编辑点上播放：立方体旋转、开门、翻书、星形擦除、故障闪烁、卡片互换。看过渡是否顺、两端是否和前后段完全接上、有没有画面上下颠倒。
3. 在效果控件里调参数：星形中心的位置百分比（上下方向是否正确）、方框收放的方框位置选项、翻滚的“绕哪个角”、描边或阴影颜色（带透明度）。再给一个数值参数打关键帧。
4. 单侧过渡：在片段入点或出点只挂一个 GL 转场，应从透明淡入或淡出到透明。
5. 10-bit 素材上用一个 GL 转场，确认颜色正常。
6. 导出含 GL 转场的片段，与预览对比。

## 6. 需要主控处理的共享事项

- **持久格式**：`npm run check:persistence-compat` 报出
  ```
  改了持久格式 document.video_edit：请升版本并写迁移与黄金样本。
  改了持久格式 document.screen_recording：请升版本并写迁移与黄金样本。
  ```
  两项都由过渡 `kind` 枚举新增 74 个值引起；录屏格式内嵌了剪辑文档 schema（`src/core/screenRecording/script.ts` 的 `recordingBaselineSchema`）。

  建议：两个格式各升一个 `version`，迁移步骤是恒等变换，并补黄金样本。

  `minReaderVersion` 要不要一起提高需要主控判断：旧程序打开含 `gl.*` 过渡的文件时会因为枚举不认识而校验失败，严格按 persistence.md 的说法属于“旧程序会误解”，建议提高到新版本。只用旧转场的文件不受影响。

  我没有改基线、版本号和样本。
- **对外工具契约指纹**：`electron/main/services/application-runtime/toolCatalog.test.ts` 当前失败，实际指纹是 `cd936ef8be7f7115d531f46c7812782cb919b95f1f9f1d957addbd7c4ca2213d`，登记的是 `dbc2d8d4…`。我判断**不是本次引起的**：过渡种类不出现在任何工具定义里，在 application-control 和 application-runtime 中搜不到 `cross_dissolve`、`transition:` 或过渡登记的引用。工作区里其他子代理改了 `videoEditColorGradeCapability.ts`、`videoEditApplicationCapabilities.ts` 等能力定义，请主控统一定位后再升版本。助手是通过只读的效果目录（`video_edit.builtin_effect`）自动看到新转场的，不需要登记新工具。
- **许可清单**：已在 `generate-third-party-licenses.cjs` 中登记。该脚本的输入指纹会遍历 `scripts/third-party-licenses/` 目录，新增文件会自动让产物重新生成。分发前需要列出的许可义务：
  - MIT：保留版权与许可声明；
  - StereoViewer 的 BSD 2-Clause：源码中保留版权声明（生成的 WGSL 开头已附带），二进制分发时在文档里重现声明（已进 THIRD-PARTY-NOTICES）。
  - 没有专利条款方面的风险。
- **package.json**：没有改。如需 `gen:gl-transitions` 或 `check:gl-transitions` 这类 npm 脚本或 CI 门禁，由主控决定。`--check` 需要联网下载包，或者用 `--from` 指定包目录。

## 7. 风险与遗留

- **首次使用的编译卡顿**：GL 转场的管线在第一次渲染时异步编译（单个片元着色器，通常几毫秒到几十毫秒），播放中第一次遇到时可能掉一帧。shaders 转场已有预热（`videoEditRenderer.warmShaderGraphs`），GL 转场还没有。如需补，在打开工程时调用 `VideoEditGlTransitionsGpu.prepare`（已提供）。本次为了少动引擎核心文件没有加。
- **着色器编译器差异**：CrossZoom 在 Dawn 的 FXC 上编译失败，说明上游 WGSL 在某些后端上可能被拒。收录的 74 个在本机 Dawn（Node）上全部能编译，但 Electron 内的 Chromium 后端（FXC 或 DXC）、macOS Metal 都没有实测。
- **核验口径**：GLSL 参考用的是 SwiftShader，与上游 CI 不是同一实现。“核验未过”的噪声类转场换一块 GPU 结果也会不同，这正是它们不收的原因。Pixelize、MosaicFade 只是分块边界量化不一致，人眼看画面类似；如果用户想要，可以放宽门槛或改为人工比对后再收。
- **参数语义**：大部分参数直接沿用上游量纲（unit `value`），只做了中文名和合理范围，没有像自写转场那样逐个设计成意图量纲（0–100 强度）。助手说明里写了上游参数名和英文含义。如需更 AI 原生，可以后续挑常用的几个做意图换算。
- **包体积**：着色器表约 376KB 文本，作为单独的代码块按需加载。
- 没有更新助手技能参考（`resources/assistant-skills/video-edit-code-creation/references/*`），因为目录已能查到。如需在 approach.md 写一句 `transition:gl.名`，由主控决定。

## 8. 建议的提交标题

`feat(video-edit): 收录 74 个 gl-transitions 转场，WGSL 直接进转场管线并逐个对照 GLSL 核验`
