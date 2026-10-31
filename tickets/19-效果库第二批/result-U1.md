摘要：模糊加了“旋转”方式，均匀与镜头加了“范围”组（整幅 / 渐进 / 移轴）；参数、显隐、目录与作者类型都从同一份定义生成，没有新增效果条目，两个索引不用追加。
摘要：1080p GPU 时间（RTX 4090，timestamp-query）旋转默认 0.128 ms、范围·移轴默认 0.122 ms，都在第 14 节目标以内；镜头·移轴默认 0.534 ms（无目标，与镜头整幅 0.509 ms 相当）。
摘要：提交 c119dc8e7（已接入 main c9ec3f324；原提交 7663b3a15，分支 task/19-U1-模糊补全，未合并、未推送）；L2 局部验证、两套 tsc、真实 GPU 用例与三项门禁通过；独立审查 2 轮无重要问题，小问题已修；未改持久版本，henji-effects 未冻结。

# U1 模糊补全：旋转方式与范围

## 提交

- 分支 `task/19-U1-模糊补全`（worktree `D:/VibeCode/Henji-AI-t19u1`），提交原为 `7663b3a15`（基于 U0 的 `3fba9c4d9`），接入 main 后为 `c119dc8e7`，见文末“接入 main”。只在本分支提交，未合并 main、未推送；工作区干净。
- 改动文件：`src/core/videoEdit/blur.ts`（定义、外扩）、`src/features/videoEdit/engine/blur.ts`（规划与 WGSL）、作者生成产物三份（`authorEffects.generated.ts`、`resources/video-edit-author/author-effects.d.ts`、`effects-library.d.ts`）、测试四份（`videoEditBuiltinEffectPasses.test.ts`、`videoEditBuiltinEffects.gpu.test.ts`、`builtinEffects.test.ts`、`application/videoEditBuiltinEffects.test.ts`）。
- 两个索引文件没有改：模糊早已登记，U1 只改它自己的定义与规划。

## 做了什么

### 旋转 `mode: 'spin'`
- 绕“中心”沿圆弧取样，转过的总角度 θ = 0.45° × 模糊度（40 → 18°，100 → 45°，硬上限 450 → 202.5°）。
- 照放射方式迭代：第一道 16 点取满 θ（以当前角度为中间），之后每道角距除以 16，直到中心到纹理最远一角的弧步不到 1 像素；默认 1080p 正中为 3 道。转角按像素计算，不随画幅长宽比变形；中心在图层上锚在内容框里。
- 外扩：内容四角绕中心转 ±θ/2 扫出的圆弧的包围盒超出内容框多少（端点加经过的水平、竖直方向），再加 2 像素。审查者用 20 万组随机输入与蛮力扫描对比，误差 1e-12 量级；GPU 用例核对外扩之外 alpha 为 0、外扩带里有画面。
- 取样在预乘编码值里平均，与放射方式一致（沿用 ticket 11 放射的取舍）。

### 范围（均匀、镜头）
- 渐进 `m = ramp(0, 过渡, 沿角度的距离)`；移轴 `m = ramp(宽/2, 宽/2 + 过渡, |到带中线的距离|)`；距离按画面高度 H 归一，位置在图层上锚在内容框里（与放射中心同一个换算 `contentPoint`）。`ramp` 用共用数学里的 smoothstep，清楚带边缘没有硬线；过渡 0 时是阶跃（用户要的硬线）。
- 均匀·范围：13 点降采样金字塔（与发光同一组权重），写成 6×6 纹素上的两项可分离权重逐纹素取值，第一层先把预乘编码值换成线性光（有符号，保留超出 0–1 的值）；各层网格按 2 的幂对齐。由最粗一层往回，每层 `R_k = mix(P_k, B样条放大(R_{k+1}), t_k)`，t_k 由本处模糊量 σ·m 落在第 k、k+1 层之间的位置决定（细层是原画时按 σ 线性，其余按 log2）。最后一道清楚处原样输出（逐像素不变），其余换回预乘编码值。
  - 每层等效标准差有解析式 `σ_k = √((37/36)(4^k − 1))`（降采样每次加 7/4 纹素²，B 样条放大每次加 1/3 纹素²），层数加到 σ_k 盖住最糊处；GPU 点扩散实测 8.039 px 对理论 8.047 px（0.1%），与整幅高斯 8.039 px 一致，能量差 0.1%。
  - 各层四周多存 2 个纹素（`RANGE_MARGIN`）：模糊会把内容推到画外，下一层要读到这部分；只存画面以内时“不重复边缘”的四边比整幅多淡一倍（边缘 alpha 63 对 134），加边距后 134/146/158… 与整幅 134/146/159… 一致（一维模拟与 GPU 实测都核对过）。
- 镜头·范围：沿用 96 点圆盘（抽成 `blurLensDisc` 与整幅共用），半径逐处乘 m。每层一道：按本处半径该用的层号（最大半径的层号 + log2 m），相邻两层按距离分权重累加，避免小半径从过度降采样的层取样变糊、大半径在细层欠采样出条纹；纹理先缩到 1 像素时按最大半径该用的层号映射、按实际最粗层钳制。清楚处直接取原像素。m = 1 处与整幅镜头逐像素相同（GPU 用例两档模糊度核对）。

### 参数（显隐要两个条件时用 U0 的 `{ all: [...] }`）

| 键 | 名称 | 组 | 单位 | 软范围 | 硬范围 | 默认 | 显隐 |
|---|---|---|---|---|---|---|---|
| `mode` | 方式 | — | 选项：均匀 / 方向 / 放射 / 旋转 / 镜头 | | | 均匀 | — |
| `amount` | 模糊度 | — | 强度 | 0–100 | 0–450 | 40 | —（说明补“旋转按转过的角度算，40 约 18°，100 约 45°”） |
| `axis` | 模糊方向 | — | 选项 | | | 水平和垂直 | mode = uniform **且 range = full**（新增条件） |
| `center_x`、`center_y` | 中心（水平 / 垂直） | — | % | 0–100 | 0–100 | 50 / 50 | mode ∈ radial, spin |
| `range` | 范围 | 范围 | 选项：整幅 / 渐进 / 移轴 | | | 整幅 | mode ∈ uniform, lens |
| `range_x`、`range_y` | 位置（水平 / 垂直） | 范围 | % | 0–100 | −100–200 | 50 / 50 | 同上且 range ≠ full |
| `range_angle` | 角度 | 范围 | ° | −180–180 | −180–180 | 90 | 同上且 range ≠ full |
| `range_width` | 清晰范围 | 范围 | % | 0–100 | 0–100 | 30 | 同上且 range = tilt |
| `range_falloff` | 过渡 | 范围 | % | 0–100 | 0–100 | 40 | 同上且 range ≠ full |

其余参数（角度、亮点加亮、重复边缘像素）不变。效果说明补了旋转与范围各一句，别名加了旋转模糊、移轴、微缩模型、渐进模糊、spin blur、tilt shift、progressive blur。

## 1080p 耗时（GPU 时间）

RTX 4090，Dawn D3D12，`timestamp-query`，输入输出 rgba16float（与应用里高精度帧一致），质量 final；前后各一个空计算道打点，预热 300 次后跑 3 轮各 30 次，取第 3 轮中位数（第 1 轮受显卡升频影响偏高，不采用）。

| 效果 | 道数 | 中间纹理 | 中位数 | 第 14 节目标 |
|---|---|---|---|---|
| 旋转·默认（18°） | 3 | 2 张整幅 | 0.128 ms | ≤ 0.8 ms |
| 旋转·模糊度 100 | 3 | 2 张整幅 | 0.142 ms | — |
| 范围·移轴·默认 | 8 | 4 层 + 3 层混合结果 | 0.122 ms | ≤ 1.0 ms |
| 范围·渐进·默认 | 8 | 同上 | 0.114 ms | ≤ 1.0 ms |
| 范围·移轴·模糊度 100 | 12 | 6 层 + 5 层 | 0.141 ms | — |
| 镜头·移轴·默认 | 3 | 半分辨率 1 层 + 整幅 1 张 | 0.534 ms | 无（参考：镜头整幅 0.509 ms） |
| 参考：均匀整幅·默认 | 4 | 3 张整幅 | 1.834 ms | 原有实现，未改 |

显存与设计估算的差别：
- 范围·均匀约 16N/3 字节（1080p 约 11 MB），设计估 8N/3：每层既要存降采样结果 P_k、又要存混合结果 R_k，执行器只按同尺寸复用，R_k 计算时 P_k 仍在读，不能共用。
- 旋转 3 道时 2 张整幅中间纹理（16N），设计估 8N：与方向、放射现有的逐道分配方式相同，没有为此改执行器（U10 范围）。

## 验证

- 两套 tsc：渲染层、Electron 均通过（`node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p …`）。
- 精确 vitest：`videoEditBuiltinEffectPasses.test.ts`（新增旋转道数/间距、范围层数、图层锚点、模糊度 0 只复制、范围各道 uniform 16/24 个）、`builtinEffects.test.ts`、`application/videoEditBuiltinEffects.test.ts`、`effectRegistration.test.ts`、`authorEffects.test.ts` 通过。
- 真实 GPU（`--mode gpu`）：`videoEditBuiltinEffects.gpu.test.ts` 新增 3 个用例——旋转中心清楚外圈糊开、移轴清楚带逐像素不变且逐行反差单调连续上下对称；范围最糊处点扩散与整幅高斯同宽、能量守恒、不重复边缘时四边与整幅一致、镜头范围与整幅逐像素相同；旋转外扩之外无画面。连同 `videoEditStyleEffects.gpu.test.ts`、`gaussianHosts.gpu.test.ts` 共 65 项通过（1 项是原有的测量开关跳过）。
- `check:author-effects` 通过（已重新生成作者类型）；`check:assistant-capabilities` 通过（31 文件 237 项）；`check:persistence-compat` 通过（66 种格式，未升版本）。
- `verify:changed --level L2`（9 个显式文件 + 13 个直接消费者测试，脚本 `D:/VibeCode/Henji-AI-t19u1/.tmp/U1-evidence/u1-verify.sh`，日志 `u1-verify.log`）：通过。精确 Vitest 13 文件 146 项通过、1 项原有测量开关跳过（含 3 个真实 GPU 文件）；改动文件 ESLint、渲染层与 Electron 增量类型检查、依赖图、主进程传递导入通过。之后按第二轮审查改了一处 WGSL，重跑 `videoEditBuiltinEffects.gpu.test.ts` 33 项、规划用例 12 项与该文件 ESLint 通过。

## 目视

图片在 `D:/VibeCode/Henji-AI-t19u1/.tmp/U1-evidence/`（不提交），用 sharp 生成素材（透明底中文标题与 1–3 px 细线、俯拍城市、夜景城市灯光、真实照片 astronaut.png、暗底渐变棋盘），正式执行器渲染 1080p 后存 PNG 逐张看过：
- `tilt-default-city.png`、`zoom-tilt-top.png`、`zoom-tilt-transition.png`：移轴像微缩模型，清楚带边缘没有硬线，放大看最糊处没有方块；`tilt-narrow-city.png`（清晰范围 10%）微缩感更强；`tilt-falloff0-city.png` 过渡 0 是硬线（符合说明）。
- `tilt-default-title.png`：透明底文字，带内大字、40 px 与 22 px 小字、2 px 细线清楚不变，带外 1 px 细线与圆圈按距离变糊。
- `progressive-default-photo.png`、`progressive-0deg-city.png`、`progressive-dark.png`、`zoom-progressive-dark.png`：渐进平滑加重，没有台阶；亮块随模糊加重向外晕开（线性光模糊的正常表现）。
- `spin-default-city.png`、`zoom-spin-corner.png`、`spin-default.png`、`spin-100-title.png`：中心清楚、外圈拖成连续圆弧，放大看没有分道重影；透明底文字向透明处转开。
- `lens-tilt-night.png`、`zoom-lens-tilt-bottom.png`：夜景灯光的光斑随离带距离逐渐变大，层与层之间没有接缝。
- 汇总：`sheet-final.png`、`sheet-range.png`；原素材 `source-*.png`；耗时 `timing.json`。

## 取舍

- 旋转默认 18° 偏强（像转盘、车轮），按设计的 0.45°/模糊度不改；模糊度 10 约 4.5° 是轻微的转动感。
- 过渡的显隐：设计表写“同上”，但渐进的公式也用过渡，所以定为 range ≠ full 时显示（渐进、移轴都显示）。
- 范围不是整幅时两个方向一起糊，“模糊方向”不起作用，改为只在整幅时显示（只在某种方式下有用的参数要隐藏）。
- 层间插值按设计用 log2：一维边缘 10–90% 宽度比同标准差高斯宽约 6%（第 1、2 层之间约 8%，审查者复算）；按方差插值会偏清楚到 −12%，所以不改。σ 不落在层上时“最糊处”与整幅高斯不是逐像素相同，注释写的是“模糊度相同”。
- B 样条放大没用设计写的“4 次双线性”：硬件取样只能夹到边缘，做不出“不重复边缘”的透明外侧；改为逐纹素 4×4（复用共用的 `bsplineWeights`），实测范围·移轴整体仍 0.12 ms。
- 13 点降采样没复用发光的 `glowBoxes`：那份只有 RGB、带发光阈值与压高光的权重，且按纹理尺寸归一化网格；这里需要 RGBA、边缘规则与 2 的幂网格。权重相同，U10 拆 `op_` 函数时可再合。
- 规划改用共用的 `Planner`（`effectPlan.ts`），删掉文件里自带的同功能小记录器；`planLensBlur`、`planUniformBlur` 对 `planAuthorDefocus` 的工序与 uniform 逐项不变。

## 未做 / 交给后续单元

- 设计 2.1 的“着色器 ChannelBlur、DiffuseBlur 从目录撤下；AngularBlur、ProgressiveBlur、TiltShift 进 `SAME_AS_BUILTIN`”在 `shaderGraph/effects.ts`，按第 15 节文件所有权归 U16，没动。
- 技能文档 `resources/assistant-skills/video-edit-code-creation/references/approach.md:14`（“均匀／方向／放射／镜头”）与 `author-api.md:187/191`（blur 四种方式）还没写旋转与范围；作者库 henji-effects 1.3.0 冻结类型里也没有 `spin`、`range_*`。两者按第 12 节在 U16 冻结新版本时一起改。
- 原有问题（未改）：放射、旋转按纹理四角（含外扩）定道数，设计写内容四角，只会多算道数，不影响画面。
- 没有进真实 Electron 窗口验收；耗时是专用 GPU 用例的 GPU 时间，不是应用内帧时间。

## 审查

独立干净上下文审查 2 轮（只交 diff、一句话目标与规则文件），两轮都没有重要问题。
- 第一轮 7 条小问题，处理如下：
  1. “不重复边缘”时范围的粗层放大用硬件夹边，与降采样的透明外侧不一致：改为逐纹素 4×4 B 样条并沿用同一边缘规则；实测后发现只存画面以内会多淡一倍，又给各层加 2 格边距，GPU 用例断言四边 alpha 与整幅相差 < 10。修了。
  2. 镜头范围在纹理缩到 1 像素截停时层号偏细：改为按“最大半径该用的层号”映射、按实际最粗层钳制。修了。
  3. 范围路径截断超出 0–1 的高精度值：改用有符号的 `cgLin`/`cgEnc`，输出不再截到 1，与整幅高斯一致。修了。
  4. 镜头范围清楚处仍算 96 点圆盘：清楚处直接取原像素。修了（第二轮指出的极端层号问题一并修好）。
  5. 锚点换算写了两份：合成 `contentPoint`，放射、旋转、范围共用。修了。
  6. “最糊处与整幅相同”说得过满：插值方式按设计保留（理由见取舍），注释改为“模糊度相同”并写明偏差。部分采纳。
  7. 规划单测读内部 uniform 下标：保留。理由：同文件已有用例都这样核对工序参数，这里只多了道数、层数、图层锚点与 uniform 个数四类断言，护的是设计写明的迭代终止与锚点规则。
  - 另：1×1 画面一层都不建会崩，加了直接复制。
- 第二轮（只审增量）2 条小问题：最大半径层号 ≥ 20 时（图层栅格倍率很大、模糊度近上限）清楚处的提前返回会在粗层读错位置，改为先判清楚处、只在第 0 层返回原像素，粗层原样传下去；注释里的“5% 以内”改为“约 6%，第 1、2 层约 8%”。都修了，没有再开第三轮。
- 原有问题（未改）：放射、旋转按纹理四角定道数，见上一节“未做”。

## 接入 main

- 接入 main（11-01）：`git rebase --onto main 3fba9c4d9 task/19-U1-模糊补全` 只重放 U1 的提交，没有冲突；之后 main 又前进一个纯文档提交，再 rebase 一次。现提交 **`c119dc8e7`**，基于 main `c9ec3f324`，`git log main..HEAD` 只有这一条；未推送、未合并。
- 按 U0“审查修复 2”接入：`BLUR_PLANNER` 已是 `definePlanner`（rebase 自动合并），补声明 `shared: [COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK]`（范围用到 ramp、bsplineWeights、cgLin/cgEnc），修改并进同一提交；`effectCatalog.ts` 里已有 blur，没改；两个索引没改；没有持久格式变化，不升版本。
- 验证（rebase 后的代码）：两套 tsc 通过；真实 GPU 三个文件单独跑 66 项通过（1 项是原有的测量开关跳过）；`check:author-effects`、`check:assistant-capabilities`（31 文件）、`check:persistence-compat`（66 种格式）通过；`verify:changed --level L2`（8 个文件 + 12 个直接消费者测试，含 GPU 文件）通过，Vitest 12 文件全过，ESLint、两套增量 tsc、依赖图、主进程导入通过。
- main 上原有失败（不是 U1 引入，没改）：`src/features/videoEdit/application/videoEditBuiltinEffects.test.ts` 的“shaders 组件效果与转场通过正式通用实体可读…”按 `SHADER_GRAPH_TRANSITION_PRESETS` 逐个读 `transition:shaders.BarnDoors` 等实体，U12 把着色器过渡收进 `transitionCatalog.ts` 后这些实体 id 已不存在，报 `ENTITY_NOT_FOUND`；切到纯 main 复现同样失败。所以 L2 清单没放这个文件，单独跑时 U1 改的那条（效果面板拖放、默认参数）和其余 5 条通过，只有这条失败，应由 U12 归属方修测试。
- 合并审查小修（11-01）：提交 `983c285bf`（之前的功能提交随 rebase 到 main `6b02672b4` 变成 `0a548d763`；先吸收了 main 上 U9 的作者生成产物，只有一处测试导入冲突，已解决）。范围（均匀）的外扩改按金字塔实际用到的最粗一层计算，层标准差解析式移到 core 与规划共用；按整幅高斯算时切边处实测剩 0.47/255，现在 < 0.1/255。补 3 个 GPU 用例：外扩最坏情况（读浮点原值，旧外扩变红）、镜头范围跨层逐行散开宽度跟本处半径一致（全程差约 0.1 px）、旋转默认 40。验证：真实 GPU 三个文件单独跑 68 项通过；`check:author-effects` 通过；`verify:changed --level L2`（4 个文件 + 12 个直接消费者测试）通过，其中 Vitest 12 文件 178 项、ESLint、两套增量 tsc、依赖图、主进程导入均通过。
