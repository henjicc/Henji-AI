摘要：U3 质感五个效果已接入 main 新骨架，最新 rebase 到 main 8743bfe28（含 U14；之后只多了一份审查文档），分支 `task/19-U3-质感` 有 2 个本单提交：960f50bce（效果）与 e39e3dc9d（审查修复 1），未合并、未推送。
摘要：划痕按新写法声明 `frameSeed`（数量或不透明度为 0、停留 100 时返回 0，其余返回帧号），规划只读种子；显像管透明度的会话问题在“审查修复 1”里修掉（会话键加透明度是否不足 1，省略时下发 1）。
摘要：接入后两套 tsc、精确用例、三份 GPU 文件单独运行、作者库与助手能力检查、L2 局部验证全部通过，详见文末“接入 main”。

# 19-U3 质感：结果

## 做了什么

- 工作目录 `D:/VibeCode/Henji-AI-t19u3`，分支 `task/19-U3-质感`，提交 `1e40ea7ac`。只在本分支提交，没有合并、推送或 rebase；没有改依赖，没有碰 node_modules / FFmpeg 联接点、9334 或 `D:\视频制作`。
- 新文件：`src/core/videoEdit/{halftone,ditherPattern,paper,scratches,retroScreen,textureEffects}.ts`，`src/features/videoEdit/engine/{halftone,ditherPattern,paper,scratches,textureEffects}.ts`。两个索引各追加一行（`TEXTURE_EFFECT_DEFINITIONS`、`TEXTURE_EFFECT_PLANNERS`）。
- 本单元以外的改动（都是接线必需的最小改动）：
  - `engine/dissolveReveal.ts`：把 `blueNoiseLookup`、`seedOffset` 改为导出，抖动点阵复用同一张蓝噪声表（键 `blue-noise-64`），纸张、划痕复用种子哈希。
  - `core/videoEdit/shaderGraph/effects.ts`：加封装效果登记 `ShaderGraphWrappedEffect`；`shaderGraphEffectSpec(id, params)` 按参数选组件；预热去重键改为 `id:组件`。
  - `engine/videoEditCodeGpu.ts`：渲染着色器效果时把参数传给 `shaderGraphEffectSpec`（1 行）。
  - 三份 GPU 用例补质感用例；`videoEditBuiltinEffects.gpu.test.ts` 的“不透明区域保持不透明”排除半调网点，因为原色网点之间本来就透明。
- 作者库：重新生成后多了 `halftone`、`ditherPattern`、`paper` 三个工厂，没有冻结 henji-effects。GPU 用例直接调用生成的工厂。划痕是 `space: 'frame'`，工厂名 `scratches` 已登记；按现有生成规则只生成图层效果，所以它要等 U9 才出现在作者库里。
- 助手能力：效果随登记自动进入效果目录、参数读写与说明，`check:assistant-capabilities` 通过。设计没有要求改技能文档，所以没有改。
- 持久格式：按设计不升版本，画面效果的增删按容错读入处理。`check:persistence-compat` 通过（66 种格式）。

## 参数表

### 半调网点 `halftone`（图层，作者工厂 `halftone`，外扩 0）

| 组 | 名称（键） | 软范围 | 硬范围 | 默认 | 显隐 |
|---|---|---|---|---|---|
| — | 网点大小 `size` | 0–100 | 0–100 | 40（格子尺，约 0.9% H） | — |
| — | 方式 `mode` | 单色 / 彩色印刷 | | 单色 | — |
| 网点 | 形状 `shape` | 圆点 / 线条 | | 圆点 | — |
| 网点 | 对比度 `contrast` | 0–100 | 0–100 | 50 | — |
| 颜色 | 颜色 `color_mode` | 原色 / 双色 | | 原色 | mode = mono |
| 颜色 | 墨色 `ink` | 颜色 | | #000000 | mono 且 duo |
| 颜色 | 纸色 `paper` | 颜色，可透明 | | #ffffff | mono 且 duo |
| 颜色 | 套色偏移 `misregister` | 0–100 | 0–100 | 0（距离尺） | mode = cmyk |

### 抖动点阵 `dither_pattern`（图层，作者工厂 `ditherPattern`）

| 组 | 名称（键） | 软范围 | 硬范围 | 默认 | 显隐 |
|---|---|---|---|---|---|
| — | 像素大小 `pixel_size` | 0–100 | 0–100 | 20（0.001·2^(v/20)·H） | — |
| — | 图案 `pattern` | 方格 / 蓝噪声 | | 方格 | — |
| 颜色 | 色阶 `levels` | 2–8 | 2–16，步长 1 | 2 | — |
| 颜色 | 颜色 `color_mode` | 双色 / 原色 | | 双色 | — |
| 颜色 | 暗色 `dark`、亮色 `light` | 颜色 | | #000000 / #ffffff | color_mode = duo |
| 颜色 | 阈值 `threshold` | 0–100% | 0–100% | 50 | — |

### 纸张 `paper`（图层，作者工厂 `paper`，外扩 = 边缘最远挪动 + 1 像素）

| 组 | 名称（键） | 软范围 | 硬范围 | 默认 |
|---|---|---|---|---|
| — | 强度 `amount` | 0–100 | 0–100 | 40 |
| — | 纹理大小 `scale` | 0–100 | 0–100 | 50（格子尺，约 1.3% H） |
| 纸纹 | 粗糙度 `roughness` | 0–100% | 0–100% | 50 |
| 纸纹 | 边缘毛糙 `edge` | 0–100 | 0–100 | 10 |
| 纸纹 | 随机种子 `seed` | 0–9999 | 0–9999，不做动画 | 0 |

### 划痕 `scratches`（画面空间 `space: 'frame'`，逐点，作者工厂名 `scratches`）

| 组 | 名称（键） | 软范围 | 硬范围 | 默认 |
|---|---|---|---|---|
| — | 数量 `amount` | 0–100 | 0–100 | 30 |
| — | 不透明度 `opacity` | 0–100% | 0–100% | 50 |
| 划痕 | 粗细 `width` | 0–100 | 0–100 | 20（0.0004·2^(v/25)·H，约 0.07%） |
| 划痕 | 停留 `hold` | 0–100% | 0–100% | 30（约 4 帧；80 约 50 帧；100 不动） |
| 划痕 | 颜色 `tone` | 亮 / 暗 | | 亮 |
| 划痕 | 随机种子 `seed` | 0–9999 | 0–9999，不做动画 | 0 |

### 老式画面 `retro_screen`（封装 VHS / CRTScreen，`space: 'clip'`，只上片段）

| 组 | 名称（键） | 软范围 | 硬范围 | 默认 | 显隐 |
|---|---|---|---|---|---|
| — | 方式 `mode` | 录像带 / 显像管 | | 录像带 | — |
| — | 强度 `amount` | 0–100 | 0–100 | 60 | — |
| 录像带 | 晃动 `wobble` | 0–100 | 0–100 | 20（组件 0–5） | vhs |
| 录像带 | 扫描噪声 `scanline_noise` | 0–100 | 0–100 | 60（组件 0–1） | vhs |
| 录像带 | 拖影 `smear` | −100–100 | −100–100 | 10（组件 −2–2） | vhs |
| 录像带 | 速度 `speed` | 0.1–3 倍 | 0.1–3 倍，不做动画 | 1 | vhs |
| 显像管 | 像素大小 `pixel_size` | 0–100 | 0–100 | 0（组件 128→8，对数） | crt |
| 显像管 | 扫描线强度 `scanline_intensity` | 0–100 | 0–100 | 30（组件 0–1） | crt |
| 显像管 | 扫描线密度 `scanline_density` | 0–100 | 0–100 | 33（组件 100→800 线，对数，约 200 线） | crt |
| 显像管 | 色偏 `color_shift` | 0–100 | 0–100 | 10（组件 0–10） | crt |

显像管的亮度、对比度固定为 1，暗角固定为 0，不开放。

## 随帧号变化的效果（供宿主接“每帧种子”声明）

- **划痕 `scratches`**：画面随帧号变化。规划从 `EffectPlannerFrame.frame` 读帧号，写进 `scratches` 这道工序的 uniform `c.x`（Float32Array 第 12 个 float）；停留帧数在 `c.y`（第 13 个），停留 100 时为 0，表示不随帧变化。
- **老式画面 `retro_screen`**：不读帧号。它走着色器图，随片段内秒数 `shaderTimeSeconds` 变化（录像带的晃动与噪声；显像管静止）。
- 半调网点、抖动点阵、纸张是静态的，只随参数与关键帧变化。

## 1080p GPU 耗时

测量方式：RTX 4090，vgpu/node（Dawn），`timestamp-query`，在同一个编码器里于工序前后各打一个点，测 40 帧，去掉前 5 帧。每帧 1920×1080，输入是真实图片。

| 效果 | P50 | P95 | 最大 | 第 14 节目标 |
|---|---|---|---|---|
| 半调网点·单色默认 | 0.037 ms | 0.041 | 0.041 | ≤ 0.4 |
| 半调网点·单色·大小 100 | 0.104 | 0.105 | 0.105 | — |
| 半调网点·彩色印刷 | 0.109 | 0.112 | 0.113 | ≤ 0.8 |
| 半调网点·彩色印刷·套色偏移 20 | 0.109 | 0.109 | 0.109 | ≤ 0.8 |
| 抖动点阵·默认 / 蓝噪声 / 像素 0 | 0.036 / 0.036 / 0.032 | 0.037 / 0.037 / 0.033 | — | ≤ 0.3 |
| 纸张·默认 | 0.056 | 0.057 | 0.058 | ≤ 0.3 |
| 划痕·默认 / 数量 100 | 0.024 / 0.058 | 0.029 / 0.060 | — | ≤ 0.15 |

这些都在 4090 上测得，换成中端卡数值会高几倍，但离目标仍有余量。老式画面沿用原组件的成本，按设计只记录、不设目标。复现脚本：`D:\VibeCode\Henji-AI-t19u3\.tmp\U3-evidence\render.ts`（`npx vite-node .tmp/U3-evidence/render.ts time`），结果在 `D:\VibeCode\Henji-AI-t19u3\.tmp\U3-evidence\timings.txt`。

半调网点在不同渲染尺寸下浓淡是否一致（叠黑底后的线性光平均，脚本 `.tmp/U3-evidence/consistency.ts`）：

| 方式 | 1080p | 540p | 360p | 270p |
|---|---|---|---|---|
| 双色 | 0.916 | 0.901 | 0.914 | 0.919 |
| 原色 | 0.882 | 0.882 | 0.881 | 0.881 |
| 彩色印刷 | 0.907 | 0.896 | 0.908 | 0.914 |

## 目视

图片在 `D:\VibeCode\Henji-AI-t19u3\.tmp\U3-evidence\`，未提交。每个场景两张：960×540 缩略图，以及 `-crop` 结尾的 100% 局部图。所有图我都打开看过。

素材：透明底文字（title）、夜景灯光（night）、两张真实画面（photo、photo2）、浅色卡片（card）、暗色渐变（ramp）。

- 半调网点：
  - 原色、双色、彩色印刷：`halftone-default-*`、`halftone-duo-*`、`halftone-cmyk-*`；
  - 彩色印刷带套色偏移：`halftone-cmyk-misregister`；
  - 线条：`halftone-line-photo`；
  - 大小 100 与大小 0：`halftone-size100-photo`、`halftone-size0-ramp`；
  - 透明纸色：`halftone-duo-clearpaper-photo2`。
- 抖动点阵：方格、蓝噪声、原色，以及仿老掌机的四级色阶 `dither-gameboy-ramp`。
- 纸张：默认、强、纤维、颗粒，边缘毛糙 60 在文字上 `paper-edge-title`。
- 划痕：默认、满屏、暗色。
- 老式画面：录像带、显像管，强度 0（与原画相同）。

观感结论：
- **半调网点**：圆点干净，边缘不发虚。暗底上的原色网点像点阵屏。彩色印刷近看有玫瑰斑。透明底文字边上没有墨圈。纯白、纯黑是实心的。
- **抖动点阵**：点阵均匀，没有拍频纹。
- **纸张**：默认值近看才看得出，强度 80 有手工纸的质感。边缘毛糙 60 像印在粗纸上的字边，内部的字不变形。
- **划痕**：竖直的细线，微弯，两端渐隐。
- **老式画面**：录像带有波纹和颜色拖影；显像管有荧光条纹和扫描线。

## 取舍（设计没写清、或有调整的地方）

1. **半调网点的半径与“退成平均色调”**
   - 半径改为 (g/√2)·√色调，只在色调 0.9–1 之间补 0.7 像素，让纯色连格角的抗锯齿边也盖满。
   - 设计写的是 0.71g·√v，那样纯黑会在四格交界处漏出纸点；全程加 0.7 像素又会让浓淡随格子像素数漂移（审查第一轮的重要问题）。
   - 格子小于 4 像素时渐渐退成同一条面积曲线下的平均色调，避免摩尔纹，也兑现了“0 细到接近原画”的说明。
2. **半调网点的透明度**：色调乘格子透明度，透明处不出网点也不上墨。双色和彩色印刷的纸与墨再按原画逐像素的透明度裁切，文字轮廓利落。原色方式的网点本身就是形状，不裁切。设计写的“覆盖再乘该格 alpha”改成了这种做法：边缘出小网点，而不是半透明的大网点，更像印刷。
3. **半调网格的锚点**：锚在内容中心，与马赛克一致，标题左右对称。彩色印刷印在白纸上，纸色只在双色方式开放，没有扩到彩色印刷。原因是显隐写法只有“全部满足”，没有“或”。
4. **抖动点阵**：点的边长取整到栅格像素，避免 1.08 像素这类非整数点阵出拍频纹。点阵锚在内容左上角，像素画习惯从左上角起。
5. **纸张**
   - 纤维用三向拉长 6:1 的值噪声，再被颗粒扭弯。试过的“直纤维”会出三角格纹，“山脊纤维”会出裂纹，都不像纸。
   - 边缘毛糙只挪透明度的取样位置，颜色仍取原位置，内部的字和照片不会被扭动。挪动距离封顶在声明的外扩以内，GPU 用例覆盖了这一点。
   - 设计里 `∇h × 0.0005 × 值 × H` 的写法换算到像素后与分辨率无关，所以改为“边缘 100 时最多挪半个纹理格子”。
6. **划痕**：停留按帧算，说明里写帧数而不写秒，因为规划拿不到帧率。各竖条的时间段起点错开，不会所有划痕同一帧一起换。
7. **老式画面**
   - 录像带的晃动、扫描噪声、拖影乘强度。
   - 显像管的荧光条纹没有强弱属性，整个滤镜按强度与原画混合（通用 opacity），强度 0 时与原画相同，有 GPU 用例。
   - 像素大小、扫描线密度跨度在 8 倍以上，按对数映射。数值范围从组件属性读，组件缺失或没有范围就报错。
8. **封装接口**：与 U2 胶片模拟的 `ShaderGraphWrappedEffect { id, component, props }` 同形，只把 `component` 放宽为“字符串或按参数返回组件名的函数”，合并时可以机械地合成一份。

## 审查

独立干净上下文审查两轮。

**第一轮**有两项重要问题：
1. **显像管的 opacity 残留**：显像管的 opacity 会残留在同结构的 `shaders.CRTScreen` 共用会话里。根因在 `shaderGraphSession.ts`：省略的通用元数据不会复位。U2 工作区（未提交）已经在这个文件里补了 `updatedMetadata`（透明度回到 1、变换回到单位变换、包围盒置空）以及重建后补画，所以本分支没有重复改它。
2. **半调网点面积模型**：浓淡随格子像素数漂移，已修，见取舍第 1 条。

第一轮的小问题处理：
- 已修：显像管强度从平方关系改成线性；停留说明改用帧数；封装接口与 U2 对齐；去掉注释里的任务编号；逐像素断言改成集中断言；补上 `space: 'clip'`。
- 没修：两项，见下面“未做到”。

**第二轮**没有重要问题。小问题 `acos` 参数可能略大于 1，已用 `min(1.0, …)` 修掉。

## 合并注意（给总调度）

1. **合并顺序**：U2 必须在 U3 之前或同批合进 main，U2 带 `shaderGraphSession.ts` 的元数据复位修复。如果 U3 单独先进 main，会有两个症状：
   - 同一设备先渲染“老式画面·显像管”、再渲染 `shaders.CRTScreen`，后者会残留不透明度；
   - 预热后的显像管第一帧，或强度关键帧跨过 100 时，框架会重建合成，这一帧可能画错。

   合并后建议实测三个场景：上面这两种，以及强度关键帧从 100 跨到 60。
2. **`shaderGraph/effects.ts` 的冲突**：保留 U3 的 `wrappedComponent(wrapped, params)` 和 `shaderGraphEffectSpec(id, params)`。不要用 U2 的 `WRAPPED.get(id)?.component ?? …`，那样遇到函数形式的 component 会出错。`WRAPPED` 的列表合成 `[FILM_LOOK_SHADER_GRAPH, RETRO_SCREEN_SHADER_GRAPH]`。
3. **范围换算重复**：U2 的 `filmLook.ts` 有自己的 `scale`（缺范围时静默按 0–1 换算），U3 的 `retroScreen.ts` 有 `range` / `linear` / `logarithmic`（缺范围就报错）。建议合并时收成一份，放到 `shaderGraph/effects.ts`。
4. **索引文件**：两个索引文件各追加了一行，冲突只会出在追加处。

## 验证

- **两套 tsc**（`--max-old-space-size=8192`）：渲染层、Electron 都通过。
- **`npm run verify:changed -- --level L2`**：显式传入 23 个本次文件和 6 个直接消费者测试，全部通过。包括：
  - 精确 Vitest 10 文件 135 项（另跳过 1 项），其中三份真实 GPU 用例：内置效果 30 项、风格效果 34 项、着色器图 11 项；
  - 文件级 ESLint、两套增量 tsc、依赖图、主进程传递导入。
  - 最后一处 `acos` 小改动之后，又跑了 ESLint 和质感 GPU 用例（3 项通过）。
- **新增的真实 GPU 用例**：
  - 半调网点：原色网点之间透明；双色的纸按逐像素透明度铺满内容；彩色印刷白处不上墨、黑处盖满。
  - 抖动点阵：两色时每个像素只是暗色或亮色、同一个点里同色；方格与蓝噪声结果确定。
  - 纸张：强度 0 与原画逐位相同，默认强度不改透明度。
  - 划痕：同一帧结果相同；停留 100 时换帧不变；数量 0 不改画面。
  - 纸张外扩覆盖实际取样范围。
  - 老式画面：两种方式都出画面且随时间变化，强度 0 与原画相同。
- **门禁**：`npm run check:author-effects`、`npm run check:assistant-capabilities`（31 文件 237 项）、`npm run check:persistence-compat`（66 种格式）都通过。
- **没做**：没有启动 Electron，也没有用预览页（`npm run effect-preview`）目视。目视用 GPU 渲染的 PNG 代替，渲染走的是同一个正式执行器。

## 未做到 / 拿不准

- **U2 合并前的残留**：显像管 opacity 在共用会话里的残留，要等 U2 的会话修复合并才消失（见“合并注意”第 1 条）。
- **预热不跟关键帧**：预热只按效果的基础参数选组件。如果给“方式”打了 hold 关键帧来回切换，另一个组件第一次播到时要编译约半秒；渲染结果本身是对的。
- **颜色解析又多一份**：`engine/halftone.ts` 导出的 `encodedColor` 支持 alpha。dropShadow、stroke、dissolveReveal、basicEffectPlanners 里早已各有一份私有的十六进制解析。这是原有的重复实现，本次没有收拢。
- **会话层同源问题**：`shaderGraphSession.ts` 在省略变换、包围盒时同样不复位，是原有问题，U2 的修复已一并覆盖。
- **划痕暂时进不了作者库**：作者工厂按现有生成规则只生成图层效果，划痕要等 U9 把画面空间效果接进代码调整层和作者库。

## 接入 main（11-01）

本节为当前交付状态；上文“随帧号变化的效果”“合并注意”“未做到”里涉及 frameSeeded、U2 合并顺序与划痕作者库的说法，以本节为准。

- **rebase**：先按要求 `git rebase --onto main 3fba9c4d9 task/19-U3-质感` 接到 `e4b8991bc`（U0、U9、U1、U2），随后 main 前进到 U4（`de0ef23c3`、`024928d46`），再 `git rebase main`。`git log main..HEAD` 只有 `6bd989bb1`，即本单提交（接入后改写了提交正文）。
- **冲突与新骨架接法**：
  - 两个索引：在 U2 的 `COLOR_MAP_*`、U4 的 `GLITCH_*` 之后各追加 `TEXTURE_EFFECT_*` 一行。
  - 目录表 `effectCatalog.ts`：质感组改为 `film_grain, halftone, dither_pattern, paper, scratches, retro_screen`（第 13 节顺序）。
  - 规划：四个原生规划改用 `definePlanner`。共享函数按块名引用：抖动点阵用 `COLOR_MATH_BLOCK`、`EFFECT_MATH_BLOCK`，纸张、划痕用 `EFFECT_MATH_BLOCK`；半调与抖动共用的盒式降采样定义成具名块 `CELL_AVERAGE_BLOCK`（`cell-average`），两个规划都在 `shared` 里引用，效果自己的 WGSL 不再内嵌公共文本。
  - `shaderGraph/effects.ts`：以 main 上 U2 的 `ShaderGraphWrappedEffect` 与 `WRAPPED` 为准，只把 `component` 放宽为“字符串或按参数返回组件名的函数”，加 `wrappedComponent`；`WRAPPED` 合成 `[FILM_LOOK_SHADER_GRAPH, RETRO_SCREEN_SHADER_GRAPH]`；`shaderGraphEffectSpec(id, params)` 按方式选组件；预热改用 main 的 `shaderGraphStructureKey` 去重，效果与转场同一规则。
  - 老式画面的速度参数：不做动画。组件库里 VHS 没有 `speedProp`，`speed` 只是普通 uniform，着色器里无状态地按 `time × speed` 计算，不在会话里累加，所以不进会话键也不依赖渲染历史（此处原先写“按 shaderClockRateProps 自动并入键”，与代码不符，已更正）。
  - 作者库重新生成：U9 已把画面空间效果接进作者库，`scratches` 工厂现在已生成（和 `grain`、`vignette` 同列），上文“要等 U9”已不成立。
- **随帧效果声明**：划痕定义 `frameSeed: scratchFrameSeed`。数量或不透明度为 0、停留 100 时返回 0（画面与帧号无关）；其余返回帧号，因为各竖条的时间段起点错开，几乎每帧都有竖条换段。规划只读 `scratchFrameSeed(params, frame.frame)` 的返回值，写进 uniform `c.x`。U4 的通用门禁（同种子同规划）通过。半调网点、抖动点阵、纸张是静态的，不声明。老式画面走着色器图，随片段内秒数变化，不经过帧号种子。
- **显像管 opacity 残留**：此处原先写“U2 的 updatedMetadata 已在 main，不再成立”，与 main 上的代码不符（main 上的 `metadata()` 仍下发 undefined）。已在下面“审查修复 1”第 1 条修掉。
- **验证**（重命令都经 heavy.sh 排队）：
  - 两套 tsc 通过。
  - 精确用例：登记、规划、作者效果、内置效果应用、合成场景、代码 GPU 共 7 个文件，第一次接入后 67 项通过；最终 L2 一并重跑。
  - GPU 三个文件单独运行：内置效果 40 项、风格效果 34 项、着色器图 12 项（另跳过 1 项），全部通过。
  - `check:author-effects` 通过；`check:assistant-capabilities` 31 文件 238 项通过。
  - `npm run verify:changed -- --level L2`（24 个本次文件，7 个直接消费者测试）：精确用例 10 文件 154 项通过（另跳过 1 项），ESLint 与两套增量类型检查通过；另单独跑了 `check:dependency-graph` 与 `check:main-imports`，都通过。

## 审查修复 1（11-01）

对应 `review-t19u3-report.md` 与总调度的 8 条要求。分支先 `git rebase main` 接到 `57244bb1a`（含 U14），再按下面修改。

| 条目 | 处理 |
|---|---|
| 1 重要：显像管透明度与会话 | `shaderGraphCache.ts` 的会话键按框架合成哈希的规则并入“透明度是否不足 1”与“是否可见”，与混合模式写在同一处。`shaderGraphSession.ts` 的 `metadata()` 在没写透明度、可见时下发 1 与 true，框架能复位，后来的 `shaders.CRTScreen` 不再沿用 0.6。新 GPU 用例：同一缓存先预热，再按 60、100、60、100 交替渲染老式画面·显像管，最后渲染 `shaders.CRTScreen`，每一帧都与新会话直出逐位相同，所有会话 `hostBuilds` 都是 1。临时撤掉这两处修复时，用例在“预热后第一帧（强度 60）”失败。 |
| 2 显像管把透明处变成不透明 | 封装接口加 `keepsSourceAlpha`，显像管为真。`videoEditCodeGpu.builtin` 渲染完着色器图后，用内置工序把结果按原画透明度裁回：先拷进中间纹理，再与原画 alpha 相乘（新增公共入口 `effect_source_alpha`）。新 GPU 用例：左半不透明、右半透明的片段，显像管与录像带的右半都保持全透明，左半不透明。老式画面说明补一句“在 8 位里计算，暗部大面积渐变上可能出现色带”。 |
| 3 result 两处说法 | 已在“接入 main”一节原位更正：VHS 的速度不按时钟快慢进会话键（它是无状态 uniform，结果本来就确定）；透明度残留由本节第 1 条修掉。 |
| 4 组件范围换算两份 | 在 `shaderGraph/spec.ts` 收成一份：`requireShaderComponent`（组件不存在报错）、`shaderPropRange`（属性没有范围报错）、`shaderPropValue`（线性、对数、反向对数）。胶片模拟与老式画面都改用它；胶片模拟原先缺范围时静默按 0–1 换算，现在报错（FilmStock 的三个属性都有范围，行为不变）。 |
| 5 又一份十六进制解析 | 删掉 `halftone.ts` 的 `encodedColor`。改用已导出的 `lightSweep.ts` 的 `linearHex`，并在同一处加 `linearHexAlpha`（复用 `linearHex`，只多读透明度两位）。半调的墨色、纸色与抖动点阵的暗色、亮色都按线性光传入着色器：半调去掉 `toLinear`，抖动点阵经 `cgEnc` 后照旧做感知插值。其余 7 份原有实现没有动，位置见下。 |
| 6 纸张自带值噪声 | 共享数学 `effectShaderMath.ts`（块名 `effect-math`）新增 `noiseGradient`：与 `noise` 同一张格子，另给解析梯度，值域 −1..1。纸张只剩一行把它换到 0..1 的换算。共享数学的 GPU 用例补了核对：值与 `noise` 相同，梯度与千分之一格的差分一致。 |
| 7 抖动点阵说明 | “0 一个屏幕像素”改为“0 约为画面高度的 0.1%，最细的点”。 |
| 8 测试 | 新增半调线条（网线水平、同一行横向一致，远看墨的面积等于暗度）、抖动点阵原色（每个通道只剩 0 或 255，透明处仍透明）、显像管强度跨过 100（第 1 条用例）。抖动点阵用例的点边长改为按 `ditherPixelSize` 计算，不再写死 9。 |

### 留给以后收拢的十六进制颜色解析（7 处，本次未改）

- `src/features/videoEdit/engine/basicEffectPlanners.ts` 的 `hexColor`
- `src/features/videoEdit/engine/videoEditBuiltinEffectPasses.ts` 的 `hexColor`
- `src/features/videoEdit/engine/dissolveReveal.ts` 的 `encodedHex`
- `src/features/videoEdit/engine/dropShadow.ts` 的 `encodedColor`
- `src/features/videoEdit/engine/stroke.ts` 的 `encodedColor`
- `src/features/videoEdit/engine/glow.ts` 的 `linearColor`
- `src/core/videoEdit/titleGraphics.ts` 的 `titleColor`

导出的 `linearHex`、`linearHexAlpha`（`lightSweep.ts`）可以作为以后收拢的唯一入口。

### 改到的共享文件

`shaderGraphCache.ts`、`shaderGraphSession.ts`、`shaderGraph/spec.ts`、`shaderGraph/effects.ts`、`filmLook.ts`、`basicEffectShaders.ts`、`effectShaderMath.ts`、`lightSweep.ts`、`videoEditCodeGpu.ts`。都是本节修复的接线，没有重构无关代码。

### 验证（重命令都经 heavy.sh 排队）

- 两套 tsc 通过。
- GPU 三个文件单独运行：着色器图 14 项（另跳过 1 项）、风格效果 34 项、内置效果 40 项，全部通过。
- 撤掉会话修复后，新用例在预热后第一帧失败；恢复修复后通过。
- `check:author-effects` 通过（抖动点阵说明改了，作者库已重新生成）。
- `check:assistant-capabilities` 31 文件 238 项通过。
- `npm run verify:changed -- --level L2`（31 个本次文件、7 个直接消费者测试）：精确用例 11 文件 443 项通过（另跳过 1 项）；ESLint、两套增量类型、依赖图、主进程导入、登记格式与黄金样本基线都通过。
- 提交：在同一分支追加审查修复提交；验证后 main 只多了一份审查文档（8743bfe28，不含代码），又 rebase 了一次。`git log main..HEAD` 为 `e39e3dc9d`、`960f50bce`，两个都是本单的提交。
