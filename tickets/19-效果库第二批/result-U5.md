摘要：U5 光：镜头光晕 `lens_flare`、漏光 `light_leak` 两个原生效果已实现（画面空间、判高精度、作者工厂名 `lensFlare`/`lightLeak`），镜头光晕的光晕复用发光金字塔（`appendGlow`，光源纹理来源）。
摘要：1080p GPU 时间（RTX 4090，timestamp-query，中位数）：发光默认 0.148 ms、镜头光晕默认 0.147 ms、漏光默认 0.034 ms，均在第 14 节目标内。
摘要：与设计不同的取舍 7 处（光晕大小默认 60、颜色提为主参数、星芒改细光线、拉丝改解析式、光源键改 light_x/light_y、星芒数量不做动画、画外光源的光晕发光点换算），逐条写在下面；独立审查 2 轮，重要问题 0。

# U5 光：镜头光晕、漏光

## 分支与提交

- 工作目录 `D:/VibeCode/Henji-AI-t19u5`，分支 `task/19-U5-光`，基点 `3fba9c4d9`。
- 提交：见文末“接入 main”（原 `5e66eace7` 已随 rebase 失效）。未推送、未合并 main、未切分支。

## 做了什么

| 文件 | 内容 |
|---|---|
| `src/core/videoEdit/lensFlare.ts`（新） | 镜头光晕定义：`space: 'frame'`、`group: 'light'`、`author.factory: 'lensFlare'`、精度以规划为准 |
| `src/core/videoEdit/lightLeak.ts`（新） | 漏光定义：同上，`author.factory: 'lightLeak'` |
| `src/features/videoEdit/engine/lensFlare.ts`（新） | 规划 + WGSL：`flare_source`（半分辨率光源）→ `appendGlow`（发光金字塔，光源纹理来源）→ `flare_image`；拆输出 `flare_layer_image` + `flare_light`（零 alpha 光）；合成函数 `lightOnto` / `lightWithin` 两个效果共用 |
| `src/features/videoEdit/engine/lightLeak.ts`（新） | 规划 + WGSL：`leak_light`（1/4 分辨率）→ `leak_composite`（B 样条放大 + 发光相加规则）；拆输出 `leak_layer_image` + `leak_layer_light` |
| `src/core/videoEdit/effectIndex.ts`、`engine/effectPlannerIndex.ts` | 各追加两行（每个效果一行；两个效果在不同模块，一行写不下） |
| `src/core/theme/colorTokens.ts` | 文末追加 `VIDEO_EDIT_LIGHT_LEAK_DEFAULT_HEX`（漏光两种默认色；全局规则禁止在别处写 #hex） |
| `src/features/videoEdit/engine/lightEffects.test.ts`（新） | 不出光时规划只剩 copy 且不要求浮点、出光要求浮点；漏光速度与闪烁为 0 时与时间无关、闪烁相邻帧不跳变 |
| `src/features/videoEdit/engine/videoEditStyleEffects.gpu.test.ts` | 文末追加 `describe('镜头光晕与漏光')` 两个真实设备用例（见“验证”）；着色器编译与默认参数出画面由现有“全部效果”用例自动覆盖 |

目录：两个效果进“视频效果 · 光”，排在发光、扫光之后（第 13 节顺序）。参数、说明、精度、预览页条目、助手目录都从登记链自动生成。

复用：发光金字塔 `createGlowPlanner` / `appendGlow` / `lightGlowParams` / `glowLevels` / `glowLevelWeights`、发光合成 `glowColor`（相加、肩部压缩、溢出推白）、共用数学 `simplexNoise` 与 `sampleBSpline`（引用，不复制整段文本）、扫光的 `linearHex`。没有另写金字塔或噪声。

## 参数表

### 镜头光晕 `lens_flare`

| 组 | 键 | 名称 | 单位 | 软范围 | 硬范围 | 默认 |
|---|---|---|---|---|---|---|
| — | `brightness` | 亮度 | 强度 | 0–100 | 0–400 | 60 |
| — | `light_x` | 光源位置（水平） | % | 0–100 | −100–200 | 25 |
| — | `light_y` | 光源位置（垂直） | % | 0–100 | −100–200 | 25 |
| — | `color` | 颜色 | 颜色 | | | #ffffff |
| 光芒 | `size` | 光晕大小 | 强度（发光半径尺） | 0–100 | 0–150 | 60 |
| 光芒 | `rays` | 星芒 | 强度 | 0–100 | 0–100 | 20 |
| 光芒 | `ray_count` | 星芒数量（不做动画） | 数值，步长 1 | 2–16 | 2–32 | 6 |
| 光芒 | `streak` | 横向拉丝 | 强度 | 0–100 | 0–100 | 30 |
| 鬼影 | `ghosts` | 鬼影 | 强度 | 0–100 | 0–100 | 0 |
| 鬼影 | `ghost_dispersion` | 色散 | 强度 | 0–100 | 0–100 | 30 |

### 漏光 `light_leak`

| 组 | 键 | 名称 | 单位 | 软范围 | 硬范围 | 默认 |
|---|---|---|---|---|---|---|
| — | `amount` | 强度 | 强度 | 0–100 | 0–200 | 50 |
| — | `side` | 方向 | 左上/上/右上/右/右下/下/左下/左 | | | 左上 |
| 光 | `spread` | 范围 | % | 0–100 | 0–100 | 50 |
| 光 | `streaks` | 条纹 | 强度 | 0–100 | 0–100 | 30 |
| 颜色 | `hot_color` | 中心颜色 | 颜色 | | | #ffe8c8 |
| 颜色 | `edge_color` | 边缘颜色 | 颜色 | | | #ff8a4a |
| 变化 | `flicker` | 闪烁 | % | 0–100 | 0–100 | 20 |
| 变化 | `speed` | 速度（不做动画） | % | 0–100 | 0–100 | 30 |
| 变化 | `seed` | 随机种子（不做动画） | 数值 | 0–9999 | 0–9999 | 0 |

## 取舍（与设计 2.5 节不同处，请 Claude 裁定是否回写设计）

1. **光晕大小默认 60（设计 40）**。40 换算成发光半径约 3% H，目视几乎只有光核、没有光雾（`.tmp/U5-evidence` 早期对比，40/55/70 三档）；60 约 8% H，与发光“半径”默认相同，暗底上有自然的长尾光雾，拉高 6 倍也平滑。说明文字按 60 写。
2. **颜色提为主参数**。设计把它单列为“颜色”组，但效果库规范“只有一个参数的不单独成组”；主参数正好 4 个（亮度、光源位置两项、颜色）。
3. **星芒改为细光线**。设计的 `|cos(nθ/2)|^24` 是越远越宽的扇形，再经金字塔散开后成了粗光柱（像卡通星星）。改为按到最近一道光线的垂直距离取高斯、宽度随距离缓慢变宽（衍射星芒的成熟画法），默认 20 时淡淡几道。
4. **横向拉丝改为解析式**。单个点光源的水平指数衰减卷积有闭式解：`exp(−|dx|/L) × (细线 + 淡晕两层高斯)`。比设计的 1/4 分辨率 32 点模糊少一道工序和 1/16 N 显存，任何分辨率都锐利，也没有 32 点取样在长距离上的台阶。
5. **光源位置键改为 `light_x` / `light_y`（设计 `x`/`y`）**。效果控件只把 `<名>_x`/`<名>_y` 配成画面上可拖的点（与模糊放射中心同一控件），裸 `x`/`y` 只会是两个数字框。键会写进工程，趁未发布改。
6. **星芒数量不做动画**。道数取整，打关键帧只会硬切，违背“状态变化平滑”。
7. **画外光源的光晕**：金字塔只看得到画面里的光。光源在画外时，送进金字塔的发光点贴到最近的画面边缘，按离开距离 a 摊开（σ = √(σ² + a²/4)），峰值按发光每层权重与层宽换算，使边上光雾与真实点光源在 a 处照到边缘的亮度一致。守能量摊开会被粗层整块接住、在边上堆出过亮的光球（实测过），按真实响应换算后从画内移到画外连续变暗（`lf-offscreen.png`）。

其他实现决定：

- **小尺寸渲染不闪**：0.3% H 的光核在半分辨率预览下不到一个纹素，光源挪动不到一像素光雾就忽有忽无（真实设备探测到）。光核至少 0.75 纹素、星芒至少 0.7 纹素、拉丝至少 0.6 像素，变宽时按能量不变压低峰值。
- **atan2(0,0)**：正好落在光源上的像素直接返回 0，避免未定义值进入金字塔扩散。
- **不在效果内部抖动**：光晕的发光参数 `dither: 0`，出光即判高精度（以规划为准，黑色光或亮度/强度为 0 时规划只剩 copy、不要求浮点）。
- **合成顺序**：片段上先把锐利的光（光核、星芒、拉丝、鬼影）用发光相加规则加到画面，再由金字塔合成叠光雾；图层拆输出时主图只在内容范围内加光，下层先是光雾再加锐利的光。两者都接近白时肩部压缩先后不同，透明处最多差 3/255（GPU 用例按此容差）。半透明内容两种输出按不同透明度语义叠光，与发光一致。
- **鬼影**：一层很淡的薄光加一圈柔和亮边；色散把亮边按颜色错开（红外蓝内）。默认 0。
- **漏光光形**：四个角从角点径向铺开，四条边从边中点沿边拉宽（收窄 0.5）；两层二维单形噪声（第一层扭曲坐标、第二层取值），频率约 0.7/H，形状随时间变形而非平移；条纹是沿横向起伏的两层噪声、伸得比光团更深；颜色 `mix(边缘, 中心, f²)`；闪烁由规划按片段时间算两档平滑值噪声（1.3 Hz、3.7 Hz），最低压到 25%。
- **漏光放大**：B 样条放大（二阶连续），暗底拉高 6 倍看不到放大网格（`ll-dark-x6-zoom.png`）。

## 按帧变化（已在“接入 main”中接上，本节为接入前记录）

基底 `3fba9c4d9` 没有 U9 的 `frameSeeded` 字段，本单未加：

- **漏光**：`speed > 0` 或 `flicker > 0` 时随时间变化。时间取 `instance.shaderTimeSeconds`（片段内秒数；片段路径由 `videoEditCompositeScene` 已传入，与着色器效果同一时钟）。U9 的调整层路径目前只传帧号、不传 `shaderTimeSeconds`，漏光在调整层里会停在 t = 0。集成时需要：① 定义加 `frameSeeded: true`（或按 U9 定的名字），让调整层指纹含帧号；② 调整层规划给效果实例带上时间（例如 `shaderTimeSeconds: info.clip.time`）。
- **镜头光晕**：不随帧变化，不需要声明。

## 耗时（第 14 节）

RTX 4090，D3D12（Dawn），1920×1080 rgba16float，timestamp-query 包住整条工序；先持续加载 60 轮让显卡升频，再按轮交替测各项 200 轮。显卡空闲时 210 MHz，P90 受功耗状态影响波动大，只看中位数。

| 效果 | 工序 | 中位数 | 目标 |
|---|---|---|---|
| 发光默认（参照） | 24 道 | 0.148 ms | — |
| 镜头光晕默认 | 26 道 | 0.147 ms | 与发光默认相当 + 0.2 ms：达标 |
| 镜头光晕·鬼影 60 | 26 道 | 0.164 ms | 达标 |
| 镜头光晕·光晕大小 100 | 38 道 | 0.173 ms | 达标 |
| 漏光默认 | 2 道 | 0.034 ms | ≤ 0.3 ms：达标 |

额外显存：镜头光晕比发光默认多一张半分辨率光源（N/4 像素）和一张全尺寸“加了锐利光的主图”（N 像素，rgba16float）——`appendGlow` 从一张底图合成，锐利的光要先进底图，这与扫光相同；比设计估计的 1/16 N 多。漏光一张 1/16 N 像素的 rgba16float（N/2 字节），与设计一致。

## 目视

图片在 `D:/VibeCode/Henji-AI-t19u5/.tmp/U5-evidence/`（不提交；960×540 渲染，效果按画面高度换算）。复现脚本 `lightEffectsEvidence.local.test.ts.txt`（放回 `src/features/videoEdit/engine/` 改名为 `.test.ts` 即可运行）。

- 镜头光晕：`lf-default-night.png`、`lf-default-photo.png`（真实照片：雾中森林）、`lf-default-title.png`（透明底文字叠深灰）、`lf-default-dark-x6.png` 与 `lf-dark-x6-zoom.png`（暗底拉高 6 倍）、`lf-modes.png`（星芒 4/8 道、亮度 200/30、画外、光晕大小 100、鬼影、暖色拉丝）、`lf-offscreen.png`（光源 94%→125% 逐步移出）、`lf-ghosts.png`、`lf-ghosts-photo.png`、`lf-split.png`（片段与拆输出对比）。
- 漏光：`ll-default-night.png`、`ll-default-photo.png`、`ll-default-title.png`、`ll-default-dark-x6.png` 与 `ll-dark-x6-zoom.png`、`ll-sides.png`（8 个方向）、`ll-modes.png`（强度 120、范围 100、条纹 90、范围 20、换种子、玫红边缘）、`ll-flow.png`（速度 100，0–5 秒）、`ll-split.png`。

自查观感：暗底拉高 6 倍光晕与漏光都没有环与台阶；光形里没有圆形、矩形；默认没有一串圆斑；漏光流动时形状在变不是平移；透明底文字清楚不抖（效果不重采样原画）。漏光暗底上的弱光段偏铜褐色（暗的橙色就是这个观感），需要更艳时调边缘色。真实 Electron 窗口与浏览器预览页没有看。

## 验证

- 两套 tsc：渲染层、Electron 均通过（8 GB 堆）。
- 精确 vitest：`lightEffects.test.ts`、`builtinEffects.test.ts`、`removedEffects.test.ts`、`effectRegistration.test.ts`、`videoEditBuiltinEffectPasses.test.ts`、`videoEditRenderPrecision.test.ts`、`videoEditStyleEffects.test.ts`、`application/videoEditBuiltinEffects.test.ts` 通过。
- 真实 GPU（`--mode gpu`）：`videoEditBuiltinEffects.gpu.test.ts` 30 项（含全部效果编译与默认出画面）、`videoEditStyleEffects.gpu.test.ts` 32 项（含新增两项：镜头光晕只加光、画外连续变暗且过边缘不跳变、拆输出与片段一致；漏光方向、随时间流动、拆输出与片段一致）通过。快照文件只有行尾被重写，规范化 blob 与 HEAD 相同，已还原。
- `check:author-effects` 通过（基底的生成脚本只收 `space: 'layer'`，两个工厂此时不生成）。作者工厂直测：在临时目录套用 U9 的生成过滤（收 `frame`），生成的 `lensFlare` / `lightLeak` 类型与工厂正确，产出经 `normalizeVideoEditBuiltinParams` 校验通过，越硬范围与错选项按预期报错；临时产物在 `.tmp/U5-author`，未写入仓库。
- `check:assistant-capabilities` 通过（覆盖检查通过，不变量 31 文件 237 项）。
- `check:persistence-compat` 通过（66 种格式；本单不升持久版本）。
- `verify:changed --level L2 <9 个本次文件> --test <10 个直接消费者>`：通过（10 文件 96 项，含两份 GPU 用例；ESLint、两套增量 tsc、表面/颜色/图标/残留/间距门禁、依赖图、主进程传递导入全部通过）。默认 4 GB 堆跑渲染层 tsc 会内存不足，需 `NODE_OPTIONS=--max-old-space-size=8192`（与 U0 相同）。文件与测试清单在 `.tmp/U5-evidence/verify-files.txt`，输出在 `verify-l2.log`。最后一处改动（漏光核心发白改读发光默认值）之后补跑了相关单测、新增 GPU 用例、两套 tsc 与该文件 ESLint。

## 审查

独立干净上下文审查：第 1 轮重要 0、小问题 6、原有问题 2。处理：黑色光不只剩 copy（已改：精度以规划为准，黑色光规划只剩 copy）；`x`/`y` 配不成拖点（已改名 `light_x`/`light_y`）；核心发白写死 0.5（镜头光晕改读发光参数）；默认 60 与设计不同（有意，见取舍 1）；星芒数量动画硬切（改不做动画，注释修正）；测试与门槛（删去 GPU 层与单测重复的“静止与时间无关”断言；拆输出像素比较保留，理由：零 alpha 光是 05 裁定 C1 的跨层契约，U9 调整层靠拆输出规划判断是否产光）。第 2 轮只审增量：重要 0；唯一小问题“漏光合成写死 0.5”已改为读发光默认的核心发白（`CORE_WHITE`）。

原有问题（不是本单引入，未改）：
- `engine/glow.ts` 的 `linearColor` 与 `engine/lightSweep.ts` 的 `linearHex` 是同一函数两份；本单用后者。
- 片段时钟从 `clip.start` 起算：剪开一段带漏光（速度或闪烁 > 0）的片段，后半段从 t = 0 重来，剪点处光形会跳一下；着色器类效果同一约定。

## 未做到 / 待集成

- `frameSeeded` 与调整层时间（见“按帧变化”）。
- 作者工厂要等 U9 的生成脚本改动合并后重新生成；henji-effects 冻结留给 U16。
- 着色器组件 `LensFlare`、`LightLeak` 仍在效果面板（中文名同为“镜头光晕”“漏光”），进 `SAME_AS_BUILTIN` 归 U16，期间面板会有同名两项。
- 技能文档未改（设计未要求本单改）。
- 没有真实 Electron 窗口验收。

## 接入 main（11-01）

`git rebase --onto main 3fba9c4d9 task/19-U5-光` 后 main 又合入 U14，再 `git rebase main` 一次。当前分支基于 main `57244bb1a`，`git log main..HEAD` 只有本单两个提交：

- `dad696ef7` feat(video-edit): 光效果：镜头光晕、漏光（19-U5）
- `4fcac40fc` fix(video-edit): 效果时钟统一为帧号加帧时长，漏光按帧取种子（19-U5）

工作区干净；未推送、未合并 main。

### 按新骨架接入（第一个提交内）

- 两个索引的冲突（与 U2 的 `COLOR_MAP_*`、U4 的 `GLITCH_*` 同处追加）两边都保留。
- `effectCatalog.ts` 光组改为 `['glow', 'light_sweep', 'lens_flare', 'light_leak']`（第 13 节顺序）。
- 两个规划改用 `definePlanner`。镜头光晕与漏光共用的合成函数改为具名块 `LIGHT_COMPOSITE_BLOCK`（`light-composite`），两个规划都通过 `shared` 引用；漏光另引用 `EFFECT_MATH_BLOCK`（单形噪声、B 样条取样），不内嵌任何共用 WGSL 文本。
- 作者工厂用 main 的生成脚本（`node scripts/generate-author-effects.ts`，package.json 只有 `check:author-effects`）重新生成，并入第一个提交：`lensFlare`、`lightLeak` 及 `LensFlareParams`、`LightLeakParams` 正确出现在 `author-effects.d.ts`、`effects-library.d.ts`、`authorEffects.generated.ts`、`authorLibraries/effects.generated.ts`。生成器重写的 `blueNoise64.generated.ts` 只是行尾变化（规范化 blob 与 HEAD 相同），未提交。

### 效果时钟（第二个提交，根因修复）

main 的帧号已经统一：普通图层与调整层都用 `authorFrameNumber`（static 模块为 0），片段链用片段内帧号。但它不够用：

- 规划拿不到帧率，无法把帧号换成秒数；
- 片段链另外塞了一份秒数 `shaderTimeSeconds`，同一事实存了两处；作者图层与调整层没有这份秒数，漏光进调整层就停在第 0 秒。

修法是让效果时钟只有一个来源：`EffectPlannerFrame` 带 `frame` 和同一时钟的 `frameDuration`（每帧秒数）。

- 片段链：片段内帧号 + `1 / document.fps`，经 `VideoEditCodeGpu.builtin` → `VideoEditBuiltinEffectsGpu.render`。着色器图效果的时间改为 帧号 × 帧时长；`shaderTimeSeconds` 与 `VideoEditShaderClock` 已删除，不留第二份。
- 普通图层与调整层：`VideoEditAuthorEffects.encode` 在帧号后接 `info.frameDuration`，两者都取自本帧信息（static 模块帧号 0，时间也是 0）。
- 预热与精度判定不给帧时长，按第 0 秒。效果预览页按 60 fps 给帧时长，漏光在预览页里也会动。
- 漏光声明 `frameSeed: lightLeakFrameSeed`：出光且流动或闪烁时返回帧号，否则返回 0（常量）。规划只按 种子 × 帧时长 求时间，输出复用键与两条指纹由宿主自动并入种子。
- 通用 frameSeed 门禁（`effectRegistration.test.ts`）原来不给帧时长，对随时间变化的效果是盲的；现在给 1/30。实测去掉漏光的声明，门禁报“light_leak 第 1 帧”。
- 测试调整：合成场景用例改为断言 帧号 × 帧时长 = 0.5 秒（24/60 fps）；调整层用例的 `encode` 位置参数多了帧时长，并断言它取自本帧；内容精度用例补位。

独立审查 1 轮（只审时钟改动）：重要问题 0。小问题采纳 2 条（门禁给帧时长、过时注释）。不改的：
- `frameDuration` 保持可选：`render` 有约 30 处只测种子的 GPU 调用；漏传时按第 0 秒。
- 着色器图 帧号 × 帧时长 那一步没有单独补测试：风险低。

### 验证（重命令都经 heavy.sh 排队）

- 两套 tsc 通过。
- 精确单测：14 文件 140 项（第二次 rebase 前）。最后在 `57244bb1a` 上跑 `verify:changed --level L2 <main...HEAD 的 26 个文件> --test <15 个直接消费者>`：17 文件 201 项通过，ESLint、两套增量 tsc、表面/颜色/图标/残留/间距门禁通过。清单在 `.tmp/U5-evidence/verify-files-3.txt`。
- 真实 GPU 单独逐个运行：风格件 32、内置效果 40、内容精度 20、全能调色 15、U14 风格件代码 1，全部通过。快照与蓝噪声文件只有行尾被重写，已还原。
- `check:author-effects`、`check:persistence-compat`（66 种格式，不升版本）通过。`check:assistant-capabilities` 在第二次 rebase 前通过（31 文件 237 项），在 `57244bb1a` 上复跑也通过（覆盖检查通过，不变量 31 文件）。


## 审查修复 1（11-01）

对应 `scratchpad/review-t19u5-report.md` 与 Claude 的四条要求。分支已 `git rebase main`（含 U3 与之后的文档提交），当前基于 main `e3d72d3f0`。`git log main..HEAD` 只有本单三个提交（上节的提交号随 rebase 失效，以这里为准）：

- `bd0ac8cb1` feat(video-edit): 光效果：镜头光晕、漏光（19-U5）
- `5b1824302` fix(video-edit): 效果时钟统一为帧号加帧时长，漏光按帧取种子（19-U5）
- `8ab97959b` fix(video-edit): 效果时钟改为连续帧位置、缺帧时长报错，光效果复用发光合成（19-U5）

rebase 冲突：两个索引与 U3 的 `TEXTURE_*` 同处追加，两边保留；作者生成产物用 main 脚本重新生成；风格件 GPU 用例文件末尾 U3 的“质感”与本单用例两段都保留；着色器图效果（U3 的封装效果按参数选组件、保留源 alpha）与时钟改动合并，没有遗留 `shaderTimeSeconds`。

| 条目 | 处理 |
|---|---|
| 1 缺帧时长静默按第 0 秒 | 新增 `effectClockSeconds(frameDuration, position)`（`engine/effectPlanner.ts`）：位置不为 0 却没有帧时长时报错。漏光规划和着色器图效果都经它求秒数。预热、精度判定在第 0 帧，种子为 0，不会误报。单测覆盖：第 5 帧缺帧时长报错，第 0 帧、静止的漏光不报错。 |
| 2 时钟语义与慢放取整 | `effectPlanner.ts` 注释直接写明两条路径的基准不同：片段效果链是片段内时间线帧号；代码图层与调整层是代码素材源时间。`authorFrameNumber`（取整）改为 `authorFramePosition`：源时间换成可带小数的帧位置，按 1/1024 帧取值去掉浮点误差（整帧仍是整数），static 模块恒为 0。渲染（普通图层、调整层）、输出复用键、预渲染指纹都取这一个值。颗粒 frameSeed 改为返回整帧，与它的规划一致；故障本来按段取整，规划不变。新增 GPU 用例：0.5 倍慢放代码图层上的调整层漏光，相邻输出帧都在变、复用不命中，预览（复用、交互质量）与导出（直出、最终质量）逐像素相同。改回取整时该用例报复用命中 `[0, 0, 1]`。 |
| 3 种子契约与缓存键 | `builtinEffects.ts` 的 frameSeed 说明改为“帧时长相同且返回值相同 ⇒ 规划相同”；`videoEditAuthorEffects.encode` 的按槽缓存键并入帧时长。 |
| 4 光的合成公式两份 | `glow.ts` 导出具名块 `GLOW_COMPOSITE_BLOCK`（`glowOnto` / `glowWithin`），发光自己的 `glow_composite`、`glow_layer_image` 改为调用它，行为不变（“发光拆分基线”快照逐位相同）；镜头光晕、漏光复用它，删去 `LIGHT_COMPOSITE_BLOCK`。 |

留待以后清理（未改）：`engine/glow.ts` 的 `linearColor` 与 `engine/lightSweep.ts` 的 `linearHex` 是同一函数两份。

### 效果时钟怎么用（给 U6 波动、置换等随时间变化的效果）

1. 定义上声明 `frameSeed(params, frame)`：画面随时间变化时返回 `frame` 本身（代码图层上可能带小数，不要取整），画面不变时（强度为 0、速度为 0 等）返回常量 0。漏光的写法见 `core/videoEdit/lightLeak.ts` 的 `lightLeakFrameSeed`。
2. 规划里只按这个返回值求秒数，不直接读 `frame.frame`：
   ```ts
   import { definePlanner, effectClockSeconds } from './effectPlanner'
   plan: (params, frame) => planWave(params, frame.width, frame.height, effectClockSeconds(frame.frameDuration, waveFrameSeed(params, frame.frame)))
   ```
   `effectClockSeconds` 在位置为 0 时返回 0；位置不为 0 却没有帧时长时报错。
3. 宿主侧不用改：片段效果链给片段内帧号与 `1 / document.fps`；普通图层与调整层给 `authorFramePosition(module, info)` 与 `info.frameDuration`；输出复用键、预渲染指纹、按槽缓存都会并入种子与帧时长。不要另建运行时时钟或另传秒数。
4. 两条路径语义不同：片段链上的效果不跟片段变速与时间重映射，剪开后从 0 起；代码图层与调整层跟源时间走（变速、倒放、重映射、static 为 0）。
5. 通用门禁 `effectRegistration.test.ts` 会用 1/30 的帧时长在 9 个帧号下规划，检查“同种子同规划”。

### 验证（重命令都经 heavy.sh 排队）

- 两套 tsc 通过。
- 精确单测：16 文件 200 项。
- 真实 GPU 单独逐个运行：风格件 36、内置效果 40、内容精度 21（含新慢放用例）、全能调色 15、风格件代码 1、着色器图 14 项，全部通过。快照文件只有行尾被重写，已还原。
- `verify:changed --level L2 <本轮 16 个文件> --test <14 个直接消费者>`：15 文件 215 项通过；ESLint、两套增量 tsc、依赖图、主进程传递导入通过。清单在 `.tmp/U5-evidence/verify-files-4.txt`。
- `check:author-effects`、`check:assistant-capabilities`（31 文件）、`check:persistence-compat`（66 种格式，不升版本）通过。
- 最后一次 rebase 只吸收了一个纯文档提交（`e3d72d3f0`），以上证据沿用。
