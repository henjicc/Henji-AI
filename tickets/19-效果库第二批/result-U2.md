摘要：U2 颜色单元完成：渐变映射、色调分离（原生逐点一道，图层与片段、作者工厂）、反相补图层与作者工厂（原地改 U0 的 basicEffects，全登记只有一个 invert）、胶片模拟（封装 FilmStock，只上片段）。
摘要：顺带修了着色器图会话的原有缺陷：编译期属性变化后出透明帧、换回缓存合成时出旧画面、两段共用会话混合模式不同时互相串；片段效果、着色器转场、代码 shader 图层都受益。
摘要：1080p 逐道 GPU 时间 0.007–0.016 ms（目标 ≤ 0.15 ms）；独立审查 3 轮，重要问题全部处理；未进真实 Electron 窗口验收。

## 做了什么

工作目录 `D:/VibeCode/Henji-AI-t19u2`，分支 `task/19-U2-颜色`，只在本分支提交，未合并、未推送，工作区干净。

提交（已接入最新 main，见文末“接入 main”）：
- `7f47d735b` fix(video-edit): 着色器图换结构后不再出透明帧、旧画面或串混合模式（会话修复与混合模式回归用例，可单独验证）
- `594bc21d1` feat(video-edit): 颜色效果：渐变映射、色调分离、胶片模拟、反相（19-U2）

取证脚本留在 `D:/VibeCode/Henji-AI-t19u2/.tmp/u2Evidence.tmp.test.ts`（忽略目录，不提交）。

- `src/core/videoEdit/colorMaps.ts`（新）：渐变映射、色调分离定义；`COLOR_MAP_EFFECT_DEFINITIONS` 一个数组同时决定三个新效果在颜色小组里的先后（渐变映射、色调分离、胶片模拟）。
- `src/core/videoEdit/filmLook.ts`（新）：胶片模拟定义与封装（组件 FilmStock，数值按组件属性 min/max 线性换算）。
- `src/features/videoEdit/engine/colorMaps.ts`（新）：两个规划与 WGSL（入口 `gradient_map`、`gradient_map_srgb`、`posterize`、`posterize_luminance`）。
- 两个索引各追加一行：`effectIndex.ts` → `COLOR_MAP_EFFECT_DEFINITIONS`，`effectPlannerIndex.ts` → `COLOR_MAP_PLANNERS`。
- `basicEffects.ts` 反相一行：补 `space: 'layer'`、作者工厂 `invert`、别名，说明改成一份（去掉 tooltip）。规划与 WGSL 原本就是“反预乘→反转→乘回”，未改。
- `shaderGraph/effects.ts`：新增封装接口 `ShaderGraphWrappedEffect` 与 `WRAPPED` 表，`isShaderGraphEffect`、`shaderGraphEffectSpec`、`shaderGraphEffectProps`、预热都认封装效果。**U3 老式画面、U7 封装生成器请往 `WRAPPED` 里追加一项，不要另建第二套。**
- `shaderEngines/shaderGraphSession.ts`：会话缺陷修复（见下）。
- `colorTokens.ts`：`MID_GRAY_HEX`（中间调默认色）与 `VIDEO_EDIT_GRADIENT_MAP_TEST_COLORS`（测试用深蓝/灰/暖白）。
- 作者生成产物重生成（`authorEffects.generated.ts`、`resources/video-edit-author/*.d.ts`、`authorLibraries/effects.generated.ts`），新增工厂 `gradientMap`、`posterize`、`invert`；henji-effects 未冻结。`blueNoise64.generated.ts` 内容未变，没提交。
- 测试：`videoEditBuiltinEffects.gpu.test.ts` 追加“颜色效果”3 项；`shaderGraph.gpu.test.ts` 追加 2 项（胶片模拟换胶片/光晕跨 0/换回缓存合成逐位等于新会话；两段共用会话混合模式交替逐位等于新会话）。两项会话用例都确认过：退回旧会话实现时失败，修复后通过。

### 反相的处理（按协调者更正）

反相只在 U0 的 `basicEffects.ts` / `basicEffectPlanners.ts` 原地修改，没有在自己文件里再登记。核对：`VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS` 184 项、去重后 184 项、`invert` 只有 1 项。协调者给的命令里 `BUILTIN_EFFECTS` 不是实际导出名，且本机没有 `tsx`（不能在线安装），改用仓库自带的 `scripts/check-persistence-compat.cjs` 的 `loadTypeScript` 读同一登记执行同样的计数。

## 参数表

渐变映射 `gradient_map`（图层/片段，作者 `gradientMap`）：

| 组 | 名称 | 键 | 软范围 | 硬范围 | 默认 | 显隐 |
|---|---|---|---|---|---|---|
| — | 方式 | mode | 双色 / 三色 | | 双色 | |
| — | 暗部颜色 | dark_color | | | 黑 | |
| — | 亮部颜色 | light_color | | | 白 | |
| 渐变 | 中间调颜色 | mid_color | | | 中灰 | 三色 |
| 渐变 | 中间调位置 | mid_point | 0–100% | 0–100% | 50 | 三色 |
| 渐变 | 插值 | interpolation | 感知 / 标准 | | 感知 | |
| 色阶 | 黑场 | black_point | 0–100% | 0–100% | 0 | |
| 色阶 | 白场 | white_point | 0–100% | 0–100% | 100 | |

色调分离 `posterize`（图层/片段，作者 `posterize`）：

| 组 | 名称 | 键 | 软范围 | 硬范围 | 默认 |
|---|---|---|---|---|---|
| — | 色阶 | levels | 2–16 | 2–64（步长 1，关键帧中间值取整） | 6 |
| — | 分离方式 | by | 按通道 / 按亮度 | | 按通道 |
| — | 平滑 | smooth | 0–100% | 0–100% | 0 |

反相 `invert`：无参数；图层/片段，作者 `invert`。

胶片模拟 `film_look`（只上片段）：

| 组 | 名称 | 键 | 软范围 | 硬范围 | 默认 |
|---|---|---|---|---|---|
| — | 胶片 | stock | 人像 400、鲜艳 100、复古反转 64、反转片 100、浓郁 50、日常 400、淡彩 400、暖调 200、拍立得、黑白 400 | | 人像 400 |
| — | 强度 | strength | 0–100 | 0–100 | 100 |
| 光晕 | 光晕 | halation | 0–100 | 0–100 | 30 |
| 光晕 | 光晕半径 | halation_radius | 0–100 | 0–100 | 40（约画面长边 4%） |

精度：四个效果都不声明高精度（逐点映射，输出精度跟随输入；胶片模拟是着色器图 8 位出口，说明里写了暗部可能有色带）。

## 取舍

1. **渐变映射的位置用“黑白”同一把明暗**（编码值上的 BT.709 亮度），没有按设计用 OkLab L。原因：设计的观感目标是“黑→白与黑白人眼无差别”，用 OkLab L 时饱和的蓝、红会明显偏离黑白效果；改后在宇航员照片（橙色宇航服、红蓝国旗）上感知插值最大差 1 级、标准插值逐位相同。黑场、白场、中间调位置都在这把尺子上，与 AE/PS 色阶的习惯一致。
2. **黑场/白场用线性重映射**，没用 `ramp`（smoothstep）：smoothstep 会给整张图加一条 S 曲线，黑→白就不再等于黑白。退化（白场 ≤ 黑场）时按阶跃处理，同 `ramp` 的约定。
3. **感知插值是“色度在 OkLab 里线性插、明度按同 OkLab 明度的灰的编码值线性插”**，没直接用共用的 `interpolateColor`。纯 OkLab 插值配合“像素明度→位置”需要立方根，暗端斜率无穷大：深色色标（如深蓝）时最暗几级会被拉开成可见台阶、放大暗部噪点。实测改后暗底 0–48 级渐变映射成深蓝→灰蓝，相邻像素最大只差 1 级；黑→白仍逐位等于黑白，两种彩色之间仍不发灰（目视见 `sheet-gradient2.png`）。U7 的渐变生成器按空间位置插值没有这个问题，可以继续用 `interpolateColor`；同色标下两者中段明度分布会略有不同。
4. **色调分离**：n 个等宽区间映射到均匀的 n 级（PS/AE 同法）；平滑用 `ramp` 只在最近的台阶两侧过渡，100% 时相邻过渡正好相接，成连续的柔和台阶；按亮度只分 OkLab 明度，压暗时色度同比收小，避免暗部超色域怪色。
5. **单参数组并入主参数**：设计把“平滑”放进“色阶”组、“片门晃动”单独一组；《效果库.md》规范规定一个参数不单独成组，所以“平滑”作为第三个主参数。
6. **胶片模拟不开放“片门晃动”**（固定 0）：FilmStock 的晃动按每份合成各自累加的时钟走，换胶片、光晕跨过 0、几段片段共用会话或晃动关键帧经过 0 时，相位取决于渲染历史，预览、跳帧与导出会对不上（审查第一轮发现）。要开放需要宿主能驱动这个时钟，或改成原生工序。
7. **胶片名称**按十卷胶片在照片上的实际观感译成中文（组件原名是不带品牌的通用名，没有套用柯达/富士商标名）。光晕半径是框架按长边 1024 的计算分辨率取的像素，所以与渲染分辨率无关、按画面长边计；默认 40 约长边 4%。
8. **目录撤下留给 U16**：着色器 Posterize、Duotone、Tritone、GradientMap、FilmStock（进 `SAME_AS_BUILTIN`）与 Solarize（删除）本单元没动，避免与 U1、U3 在同一行冲突，也与 U0“最终撤下归 U16”一致。在此之前，“胶片模拟”在“着色器调色”小组里还有一个同名的 `shaders.FilmStock`。
9. **目录顺序**：接入 main 后由 U0 的目录表 `effectCatalog.ts` 决定，颜色组为“全能调色、黑白、反相、渐变映射、色调分离、胶片模拟”，与第 13 节一致。
10. 目视用 GPU 用例同样的执行器输出 PNG，没有启动 `npm run effect-preview`（胶片模拟是着色器图效果，不进预览页）。技能文档未改（设计未要求）。

### 着色器图会话的修复（原有缺陷，根因同一处）

> 下面是最初的做法（会话内检测重建后补画），审查修复 1 已改为按合成结构分会话，见文末。

- 现象：① 换选项（如胶片、所有 compileTime 的选择项）或带 `recompile` 的属性跨界（光晕跨过 0）后的那一帧完全透明；暂停时改参数会一直停在透明。② 换回之前用过、还在框架缓存里的结构时，那一帧是那份合成上一次留下的画面。③ 同结构两段片段共用会话、混合模式不同时，每帧都画成对方的混合模式。
- 根因：框架在结构变化的那次绘制里仍画旧的生效合成，画完才切换；新建的合成在那次绘制里才建出自己的宿主纹理，而会话已经把画面填进了旧纹理；缓存里的旧合成换回来时用的也是它自己的那张纹理。
- 修复：会话记录每份合成的宿主纹理并每帧都填；按组件定义的 `compileTime` / `compileTimeWhen` 与框架同一基准判断重建，元数据按框架 `updateNodeMetadata` 的重建条件（混合、可见、遮罩、透明度是否 <1、变换启停与边缘、包围盒是否生效）比较前后签名；判定重建或出现新纹理时补填并以零时差再画一次。另外，没写的透明度、变换、包围盒更新时显式回到默认（框架会跳过 undefined，否则共用会话沿用上一张图的值）。
- 代价：只有结构变化的那一帧多画一次；透明度在 0–1 之间、变换数值做动画都不触发。换过结构后缓存里每多一份合成，每帧多一道全分辨率拷贝（本机 1080p rgba16f 约 0.011 ms，最多 4 份）。
- 同类排查：调用方只有片段效果（`videoEditCodeGpu.builtin`）、着色器转场与预热，都经 `ShaderGraphCache`，元数据里实际能变的只有生成器的混合模式（“代码素材 shader 图层”这一调用方并不存在，原记录有误）；着色器图 GPU 用例 12 项、着色器转场 4 项通过。判断规则复刻了框架内部条件（框架没有公开“将重建”信号），升级 `shaders` 包时需要复核。

## 1080p 耗时（GPU 时间，timestamp-query）

方法：每道 render pass 的 `timestampWrites` 首尾相减求和，40 次取中位数（P90 与中位数相差不到 0.001 ms）。设备 RTX 4090（D3D12，vgpu/node Dawn），1920×1080 照片输入。显卡未专门空置，结果只作量级参考。

| 效果 | rgba8 | rgba16f |
|---|---|---|
| copy（参照） | 0.007 | 0.011 |
| 黑白（参照） | 0.007 | 0.011 |
| 反相 | 0.007 | 0.011 |
| 渐变映射 双色感知 | 0.011 | 0.012 |
| 渐变映射 三色感知 | 0.011 | 0.012 |
| 渐变映射 标准 | 0.007 | 0.011 |
| 色调分离 按通道 | 0.008 | 0.011 |
| 色调分离 按亮度 | 0.016 | 0.016 |
| 色调分离 平滑 50 | 0.008 | 0.011 |

均远低于第 14 节 ≤ 0.15 ms。胶片模拟（封装，只记录不设目标）：框架内部多道计算无法逐道打点，前后各一个时间戳括住整次渲染（含宿主上传、出图拷贝与提交间隙），中位 2.29 ms、P90 2.60 ms。原始数据 `D:/VibeCode/Henji-AI-t19u2/.tmp/U2-evidence/timing-pass.json`、`timing.json`。

## 目视

图片在 `D:/VibeCode/Henji-AI-t19u2/.tmp/U2-evidence/`（不提交），已逐张打开看过：

- `sheet-gradient.png`：原图、黑白、渐变映射默认（与黑白一致）、三色深蓝/灰/暖白（感知、标准）、深蓝→金双色（感知更饱满，标准中段偏灰）、黑场 20%、反相。
- `sheet-gradient2.png`、`ramp-gradient-map-duotone.png`：暗底渐变映射无放大台阶。
- `sheet-posterize.png`：6 级按通道（明显色块，灰背景按通道分出粉黄色斑，与 AE/PS 色调分离一致）、按亮度（保留色相的扁平插画感）、平滑 50、3 级。
- `sheet-text-night.png`：透明底白字三色映射为暖白，灰底与黑底上都没有暗边；细线不变形；夜景灯光；反相透明处保持透明。
- `sheet-layer.png`：作者工厂在代码图层上（`gradientMap`、`posterize`+`invert`）。
- `sheet-film.png`、`sheet-film-night.png`：十种胶片、默认光晕、光晕 70/半径 10、光晕 100/半径 100。

## 验证

- `npm run verify:changed -- --level L2 <15 个本次文件> --test <10 个直接消费者测试>`：通过（精确 Vitest 12 文件 123 项、改动文件 ESLint、渲染层与 Electron 类型检查、表面/颜色/图标/界面残留/间距动效、依赖图 0 个值环、主进程传递导入）。渲染层类型检查需 `NODE_OPTIONS=--max-old-space-size=8192`，默认 4 GiB 堆会 OOM（U0 记录过同样情况）。
- 两套 tsc（8 GiB 堆）：通过。
- 真实 GPU（`--mode gpu`）：内置效果 33 项、着色器图 12 项（1 项按环境变量跳过的组件全量扫描）、着色器转场 4 项通过。
- `check:author-effects`、`check:persistence-compat`（66 种格式）、`check:assistant-capabilities`（结构、覆盖 15 项、不变量 31 文件 237 项）：通过。
- 说明：把 3 个 GPU 文件与单测合在一次 `verify:changed` 线程池里跑时，U0 的 `effectRegistration.test.ts` 两次超过 5 秒默认超时（单独跑 1.5 秒，动态导入在并发转译下变慢）；最终 L2 只合并单测与本次改动的两个 GPU 文件时通过，3 个 GPU 文件另按 `--mode gpu` 单独跑。

## 审查

独立干净上下文审查 3 轮：第一轮重要 2 项（元数据变化同样会让合成重建、片门晃动不确定）已修，小问题 1 项（每帧填所有存活宿主纹理）按代价可忽略接受；第二轮小问题 1 项（包围盒应比“是否生效”）与原有问题 1 项（undefined 元数据残留）已修；第三轮无新问题。

## 未做到 / 拿不准

- 未在真实 Electron 窗口验收效果控件的分组、显隐、软硬范围与悬停说明。
- 片门晃动没有开放（见取舍 6）。
- 胶片的中文名是按观感拟的，请用户确认。
- 着色器目录撤下留给 U16（见取舍 8）。
- 会话的重建判断复刻了框架内部规则，`shaders` 升级时要复核。

## 接入 main

协调者认可四处偏离设计与十种胶片中文名，保持不变。按要求执行 `git rebase --onto main 3fba9c4d9 task/19-U2-颜色`，只重放本单元两个提交到 U0 压缩合并后的 main（`cfe7a2729`）；验证期间 main 又进了一个纯文档提交，再次只重放这两个提交到最新 main `c9ec3f324`，代码树与已验证的版本相同，复用验证结果；`git log main..HEAD` 只有 `7f47d735b`、`594bc21d1`。会话修复提交无冲突。功能提交的冲突与接入：

- 作者生成产物四份冲突：按新登记重新运行 `node scripts/generate-author-effects.ts` 生成。GPU 用例导入冲突：保留 main 新增的着色器入口导入，加上本单元的令牌与作者工厂导入。
- 目录表 `effectCatalog.ts` 颜色组追加 `gradient_map`、`posterize`、`film_look`，全能调色在首位。全登记 175 项，去重后 175 项，`invert` 1 项，颜色组顺序为全能调色、黑白、反相、渐变映射、色调分离、胶片模拟。
- 规划改用 `definePlanner`（内联入口推导字面量），`shared` 声明引用 `COLOR_MATH_BLOCK`、`EFFECT_MATH_BLOCK`，自有 WGSL 不内嵌共享文本；两个规划函数保留正式返回类型。定义模块对 `builtinEffects` 只有 type 导入。
- 核心 `colorMaps.ts` 注释改为“显示顺序由 effectCatalog 决定”。反相仍只在 `basicEffects.ts` 原地一行，main 的 `basicEffectPlanners.ts` 反相规划未动。不涉及持久格式，没有升版本。

接入后的验证：
- 两套 tsc（8 GiB 堆）：通过。
- `verify:changed -- --level L2 <16 个本次文件> --test <9 个直接消费者>`：通过，精确 Vitest 12 文件 123 项（含本次改动的两个 GPU 用例文件），ESLint、两套增量类型检查、界面各门禁、依赖图、主进程传递导入全部通过。
- 真实 GPU（`--mode gpu` 单独跑）：内置效果、着色器图、着色器转场 3 文件 52 项通过（1 项全量组件扫描按环境变量跳过）。
- `check:author-effects`、`check:persistence-compat`（66 种）、`check:assistant-capabilities`（结构、覆盖 15 项、不变量 31 文件 237 项）通过。
- **main 上原有失败，非本单元引入**：`src/features/videoEdit/application/videoEditBuiltinEffects.test.ts` 的“shaders 组件效果与转场通过正式通用实体可读”在过渡循环读 `transition:shaders.BarnDoors` 时报 ENTITY_NOT_FOUND。前半段把全部 shaders 效果按实体读出已通过；失败来自 U12 把着色器过渡收进 `barn_doors` 等目录后，测试仍按 `SHADER_GRAPH_TRANSITION_PRESETS` 的旧种类拼实体 id。本单元未改过渡，故未修，已从 L2 显式清单中排除，归 U12/main 处理。

## 审查修复 1

对应协调者合并审查第 1 轮（`review-t19u2-report.md`）五条。

1. **会话只留可达的分支**：调用方只有片段效果、着色器转场与预热。按第 2 条分会话后，同一会话里编译期属性、阈值一侧与混合模式都不会再变，最初会话内的重建检测、补画、多份宿主纹理与元数据补默认值全部不可达，会话回到 main 的实现，只多一个只读计数 `hostBuilds`（宿主画面图层建过几次，测试用它确认建好后不再重建）。会话类注释写明“一种合成一个会话，结构属性由调用方分会话”。第一个提交的说明已改正调用方说法；本文件“同类排查”同步改正。不存在的“代码素材 shader 图层”注释已改：`spec.ts`、`shaderGraphCache.ts`、`videoEditCodeGpu.ts`、`shaderGraph/effects.ts` 三处；“只写有变化的项”改为“完整属性表”（会话请求类型、缓存）。`effects.ts` 第 42 行生成参数说明里的“代码图层属性名”会进助手读到的效果说明，不在本次范围，未改。
2. **按合成结构分会话（根因的性能修复）**：`ShaderGraphCache` 的键在图结构之外加上每个图层的编译期属性值、带重建条件属性落在默认值哪一侧（剪辑可用组件的条件只有 `crosses(0)` 与 `prev > 0 !== next > 0` 两类阈值；非阈值条件的 GridDistortion、Surface3D 等因跟随鼠标未进剪辑），以及混合模式；新会话直接按本帧属性建合成，第一帧就是要的结构。组件属性定义按需加载并缓存（`SHADER_COMPONENT_LOADERS`）。会话清理沿用原来的闲置 30 秒释放；预热改为按同一把键判断是否已有会话。新用例：胶片“鲜艳 100”、胶片“黑白 400 + 光晕 0”、极光正常混合、极光滤色四段交替 3 帧，每帧换输入，结果都与按同样属性新建的会话逐位一致；共建 4 个会话，每个 `hostBuilds` 为 1。退回旧缓存时该用例失败（第一帧出透明画面）。
3. **封装表**：协调者确认 `WRAPPED` 为封装效果唯一入口，未改。
4. **渐变映射分组**：原“映射”组（5 个）拆成“渐变”（中间调颜色、中间调位置、插值）和“色阶”（黑场、白场）。双色方式下“渐变”组只剩插值一项可见；作者生成产物重新生成。
5. **按合成各自累加的时钟**：框架不支持由宿主逐帧设定时间。渲染器只有 `renderSyntheticFrame(秒差)`；全局时间和动画时间都按秒差累加（frameLocked 时 `globalElapsedTime += deltaTime`），组件自己的时钟是合成里 `onBeforeRender` 闭包按 `deltaTime` 累加的局部变量，没有设置入口。按第 2 条分会话后实测（96×54，t=2）：
   - 乘数不变时与历史无关：顺序播放 0→2 秒、直接跳到 2 秒、先到 5 秒再退回 2 秒，三者逐位相同（下面三个组件都是 0 差）。累加的秒差首尾相消，结果总是“乘数 × 片段时间”。
   - 与历史有关的情况：同结构、乘数不同的两段片段共用一个会话交替渲染，或乘数做了关键帧，又或乘数在一段时间里为 0。实测交替时最大差值为环境光漂移 35 级、自转 255 级；片门晃动只要一直大于 0 就不受影响（它只按“是否大于 0”累加），跨过 0 时会暂停。
   - 剪辑里可选、会受影响的组件：
     - `shaders.StudioBackground`（影棚背景，按 ambientSpeed 累加环境光漂移，ambientSpeed 可做关键帧）
     - `shaders.Form3D`（立体包裹，按 speed × spinX/Y/Z 累加自转）
     - `shaders.FilmStock`（着色器胶片模拟，weave 跨过 0 时暂停；本单元的 `film_look` 固定为 0，不受影响）
   - 同类但没进剪辑的组件：Particles、ParticleFlow、CursorTrail、Shatter、Surface3D、ChromaFlow、PixelThrow 跟随鼠标，已被排除；FilmGrain 已列入 `SAME_AS_BUILTIN`；DataMosh、Irradiance、KeyFrames、TimeTrail 已按“依赖上一帧”排除。
   - 按要求没有绕过框架。上述三个组件请协调者决定（例如在 U16 撤下或改成原生），会话请求的 `timeSeconds` 注释已写明这一限制。

验证（审查修复 1 后的代码）：
- 两套 tsc（8 GiB 堆）：通过。
- 真实 GPU（`--mode gpu` 单独跑）：内置效果、着色器图、着色器转场 3 文件 51 项通过（原两项会话用例合并成上面的一项，1 项全量组件扫描按环境变量跳过）。
- `npm run verify:changed -- --level L2 <11 个本次文件> --test <9 个直接消费者>`：通过，精确 Vitest 12 文件 379 项，ESLint、两套增量类型检查、依赖图、主进程传递导入、登记格式与黄金样本基线通过。
- `check:author-effects` 通过；`check:assistant-capabilities` 通过（不变量 238 项）。

提交：
- 改正第一个提交的说明（只改说明、不改内容，重写了本分支未推送的历史）：`7f47d735b`；其后 `594bc21d1` 内容不变。
- `7d6d93dac` fix(video-edit): 着色器图按合成结构分会话，交替的片段不再每帧重建
- `d9a990c8e` refactor(video-edit): 渐变映射参数分成“渐变”“色阶”两组

分支仍以 `c9ec3f324` 为底，没有再并入 main。main 之后合入了 U1（`7aa50c26d`）与 U9（`47d4166ba`）；作者生成产物和 `videoEditBuiltinEffects.gpu.test.ts` 的导入会冲突，合并时重新生成产物、合并导入即可。U12 遗留的过渡实体用例已由 main 的 `87fc65e3c` 修复。

## 审查修复 2 / 接入 main

按协调者对审查修复 1 第 5 条的裁定处理，并移到最新 main。

- **着色器胶片模拟（shaders.FilmStock）**：按裁定不动，U16 撤下；片门晃动以后用我们的 `film_look`。
- **时钟快慢分会话**：`spec.ts` 新增 `shaderClockRateProps(component)`，列出决定组件时钟快慢的属性：所有组件的 speedProp，加影棚背景的 ambientSpeed（立体包裹的速度就是它的 speedProp）。`ShaderGraphCache` 的会话键加上这些属性的取值。实测同一根因不只出在这两个组件上：框架的动画时间也在会话里按“秒差 × speedProp”累加，极光两段速度 1、3 交替时，最大差 245 级。所以按根因把全部 speedProp 组件（剪辑可用的有 55 个）一并纳入，不只修裁定点名的两个。
- **速度类参数不做动画**：`shaderComponentParams` 生成参数时，这些属性的 `animatable` 为 false。speedProp 本来就不做动画；ambientSpeed 以前可以做关键帧，所以另标 `storedKeyframes: 'first'`（`parameterDefinition.ts` 新增的可选字段）：
  - 存档里留下的关键帧照样读入（`assertVideoEditBuiltinCurves`），求值时固定取第一个关键帧的值（`evaluateVideoEditBuiltinParameters`）；
  - 写入时把旧关键帧原样带回可以（改别的参数时整表写回），新写或改动仍会被拒绝（`validateVideoEditBuiltinCurves` 新增 `stored` 参数，片段效果更新和实体整体写入两处传入写入前的关键帧）；
  - 在效果控件里编辑该参数时，会去掉旧关键帧、直接用新值（`updateVideoEditBuiltinEffect`）；
  - 其他不做动画的参数在存档校验里照旧拒绝关键帧，例如音频调制的“方式”，U13 的用例仍然通过。
- **归属说明**：两个组件现在都由 `shaderGraph/effects.ts` 里通用的 `shaderComponentParams` 生成，我只改了这个通用规则的一行，没有单独登记某个组件。**请转告 U7**：U7 把影棚背景封装成生成器时，环境光速度参数要沿用 `shaderClockRateProps` 的结果，设为不做动画并标 `storedKeyframes: 'first'`；封装的 props 换算也要把它原样下发，缓存才能按它分会话。
- **新用例**：两段影棚背景（环境光速度 2、5）和两段极光（速度 1、3）交替顺序播放 1 秒，片段内时间也错开。每段直接跳到同一时刻的画面，都与顺序播放的结果逐位相同；去掉会话键里的速度项时失败。另加一条关键帧容错读入的单测，在 `keyframes.test.ts`。

接入 main：
- 先执行 `git rebase --onto main c9ec3f324 task/19-U2-颜色`，接到 U1、U9 合入后的 main。冲突两处：
  - `effects.generated.ts`：重新生成作者产物，`check:author-effects` 通过；
  - `videoEditBuiltinEffects.gpu.test.ts`：文件末尾保留 U1 的模糊用例与本单元的颜色用例，导入合并。
- 本轮修复提交后，main 又进了 3 个纯文档提交，再次只重放本单元的提交，代码树与已验证的相同。
- `git log main..HEAD` 只有本单元 5 个提交：
  - `7f47d735b` 会话修复（原始做法）
  - `594bc21d1` 颜色效果
  - `7d6d93dac` 按合成结构分会话
  - `d9a990c8e` 渐变映射分组
  - `cf7708965` 按时钟快慢分会话
- 175 个效果 id 去重后仍为 175，`invert` 只有 1 个，颜色组顺序不变。不涉及持久格式。

验证（最终代码）：
- 两套 tsc（8 GiB 堆）：通过。
- 真实 GPU（`--mode gpu` 单独跑）：内置效果（含 U1 新增）、着色器图、着色器转场，3 个文件 57 项通过，1 项全量组件扫描按环境变量跳过。
- `npm run verify:changed -- --level L2 <9 个本次文件> --test <14 个直接消费者>`：通过。精确 Vitest 17 个文件 424 项，另有 ESLint、两套增量类型检查、依赖图、主进程传递导入、登记格式与黄金样本基线。
- `check:author-effects`：通过。`check:assistant-capabilities`：通过，不变量 238 项。

