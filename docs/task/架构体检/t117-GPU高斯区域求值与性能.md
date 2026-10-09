# t117 GPU 高斯区域求值与性能

日期：2026-10-09；main 共享工作区。区域实现、本机基准、类型和专项门禁已完成，扩展GPU回归的两个旧操作夹具失败交总管理者处理。由总管理者审查与提交，本任务不执行 Git 写操作，不修改 SDK、剪辑、旧编辑器及文档 codec。

## 设计与验证范围

- 完整文档/输出网格决定 sigma 和 mip 计划，输出视口或导出 core 反向传播共享 `gaussianExecutionWindows`，分支需求取并集。处理纹理按各工序窗口分配，合成纹理保留公共区域坐标；高斯有效结果嵌回合成窗口，窗口外不参与最终有效输出。
- 多个高斯串联按图从后往前传播 halo；蒙版、混合与点式调整继续经过正式执行器。具有其他空间/全局处理的图保留既有全局分析范围，不把散射改成局部高斯。
- 处理窗口与公共合成纹理分开：中间纹理按 mip 分组交替复用两个槽，32 像素尾部对齐的真实分配进入预算。interactive 金字塔采用 fp32，完整尺寸仍沿原 fp16 输入/输出。所有阶段保留原共享采样函数和计划，不改变 sigma、核或边界。格式选择属于图片设备存储适配，剪辑文件及共享数值计划未改。
- 同一视口拖参数保留已满足的输入窗口，小幅参数变化不重建完整尺寸纹理；窗口显著缩小或保留窗口超预算就释放余量。移动/缩放与 final 不复用这个交互包围盒。合成输出复用已有纹理，避免每帧新旧目标同时驻留。
- 新增对照揭示了非二进制缩放的源/蒙版相机相位问题：局部坐标先除缩放再加 documentOrigin 的 f32 舍入与整幅不同。canonical 区域模式改为先相加整数全局像素再除缩放，源与蒙版一起修正；其他场景保留原相机语义，采样模式进入缓存身份。
- 导出保留显式完整输出尺寸（不拿 tile 尺寸或 ceil 推测替代请求网格）。Gaussian compositor 自己反传 halo，SceneExportRuntime 向它传 core，避免导出外层 halo 再扩一遍；旧全局/多尺度流程保持原路。
- 同源预算审查修正蒙版：assembler 实际为 rgba16float，预算原来按1字节/像素且只按maskId去重，现在按每个nodeId/maskId的8字节合成目标计费。蒙版目标也复用、resize并正确丢弃失败缓存，避免新旧目标同时分配。atlas源另行计费。
- 导出仍走既有串行分块、资源需求、确认及取消通路，显存受 256 MiB 会话预算约束；不增加图层、尺寸或输出 tile 数量上限。
- L2：执行、区域及预算是多个直接消费者的共享契约；按用户要求运行两条 tsc、改动文件 ESLint、依赖图/死代码门禁、精确单测与真实本机 WebGPU。性能显式 `HENJI_GPU_MEASURE=1` 启用，CI 跳过基准；不运行 Reality、全量、Electron 开发或付费调用。

## 开源选型

复用 R13 的中立 Gaussian 计划/CPU/WGSL 及 VGPU 宿主，无新数学核或依赖。本次比较现有 VGPU 区域 ABI 与成熟 libvips CPU tile 方案：瓶颈是宿主全图求值与完整网格坐标丢失，替换 CPU 库不能让拖参数留在 GPU，也不能直接保留共享两宿主数值契约。因此选择已有共享核的区域接线，而非另写模糊算法。VGPU 官方网站读取失败后，使用随包官方 CLI `npx vgpu docs cat /vgpu/target.docs.md` 与 `/guides/performance-playbook.docs.md` 核对 target.resize、readFloats、Frame 及 prewarm/set 的资源契约。

## 性能口径

本机 NVIDIA GeForce RTX 4090 / Lovelace，Dawn D3D12，driver 32.0.16.1047；正式 compositor/atlas/render graph。1080p=1920×1080、4K=3840×2160、8K=7680×4320。interactive 为 100% 放大、1440×810 中央窗口，真实变更 sigma（0%/1%/2%），3 帧预热后 20 帧；p50/p95 采用排序索引 9/18。计时从renderExportTarget开始，包含失效图编码、GPU完成等待，排除syncScene/updateViewport、夹具生成、上传与首次编译；不是Electron UI输入到显示延迟，也不是场景编译/完整参数变更事务耗时。final 使用正式 512 core export tile 计划，计时含逐块夹具/上传/渲染/回读，不含 PNG/JPEG 编码和文件写入。场景没有并行驻留的预览 compositor。

改前记录的是宿主预留+atlas 常驻估计；改后同时拦截本机 native createTexture/createBuffer/destroy，逐分配计算实际资源字节峰值（含读回缓冲）。这不是驱动全进程显存：未覆盖驱动内部对象、提交后的延迟释放及其他应用。两种口径分别列出，不把改前预留值说成实测物理峰值。

### interactive 单帧（毫秒；显存 MiB）

| 输入 | sigma 比例 | 改前 p50/p95 | 改后 p50/p95 | 改前常驻估计/拒绝时预留 | 改后常驻估计 | 改后 texture+buffer 分配峰值 |
|---|---:|---:|---:|---:|---:|---:|
| 1080p | .003 | 2.121 / 2.929 | 0.910 / 1.099 | 92.26 | 75.79 | 71.15 |
| 1080p | .03 | 2.715 / 5.166 | 2.361 / 3.530 | 85.77 | 92.53 | 85.60 |
| 4K | .003 | atlas 预算拒绝 | 1.742 / 10.590 | 258.07 | 75.81 | 70.95 |
| 4K | .03 | atlas 预算拒绝 | 5.306 / 7.036 | 255.61 | 130.80 | 121.20 |
| 8K | .003 | atlas 预算拒绝 | 1.643 / 7.860 | 985.80 | 79.20 | 73.86 |
| 8K | .03 | atlas 预算拒绝 | 8.582 / 13.820 | 979.32 | 210.10 | 192.89 |

4K 两种尺度 p95 均 ≤16ms；8K 两种尺度也保持 GPU，没有 CPU 执行器参与。4K .003 的 p95 明显高于 p50，20 次采样存在尾延迟，不宣称全设备或长期连续输入永远满足16ms。

### final 分块像素导出（秒；显存 MiB）

| 输入 | sigma 比例 | core 数 | 改前总耗时 | 改后总耗时 | 改前常驻估计 | 改后常驻估计 | 改后 texture+buffer 分配峰值 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1080p | .003 | 12 | 2.610 | 2.458 | 28.27 | 32.10 | 33.00 |
| 1080p | .03 | 12 | 2.821 | 2.605 | 54.52 | 60.63 | 60.40 |
| 4K | .003 | 40 | 11.855 | 11.874 | 29.47 | 33.12 | 33.91 |
| 4K | .03 | 40 | 14.545 | 14.583 | 107.84 | 106.79 | 103.96 |
| 8K | .003 | 135 | 50.869 | 58.202 | 32.05 | 35.26 | 35.81 |
| 8K | .03 | 135 | 149.260 | 123.343 | 255.85 | 245.22 | 235.54 |

所有改后分配峰值均低于256MiB，最重8K/.03为246,978,993字节。final 的大量逐块 Uint8Array 高频夹具生成和 GPU→CPU 回读包含在总时间中，不能把表中时间当成纯 shader 用时或真实 PNG 文件导出用时。

另一个同源问题：改前 export 关闭视口扩展后，GPU executor 用局部纹理尺寸重新解析计划；实际 sigma 缩小为局部窗口高度的比例。改后执行完整输出网格 sigma，并用共享 halo 反传局部需求。**两侧 final 时间列保留真实观察值，但改前质量契约错误，因此不能作为同质量加速比**；尤其8K/.003总耗时增加不能简单归因于新核慢了。

### 诊断运行与成本

- 改前基线一次，12 组合，测量用例235.90s；预算拒绝保留原始失败事实，不计算伪 p50/p95。
- 首轮改后一次，12 组合，211.77s：恢复精度后4K/.03 p95=22.095ms，8K/.03 p95=36.516ms。假设：参数改变 halo 导致多个纹理 resize；同一视口包围盒复用+中间目标分组复用后，最终本轮12组合220.15s得到上表。没有为等测量启动/重启应用。
- 原始 JSON/精度 JSONL 暂留仓内忽略目录 `node_modules/.cache/t117-before.json`、`t117-after.json`、`t117-after-final.json`、`t117-precision.jsonl`，不是交付文件或新增日志通道；可通过指定测量输出路径重新获得。

本机复现（PowerShell，性能在 CI 中跳过）：

```powershell
$env:HENJI_GPU_MEASURE = '1'
$env:HENJI_GAUSSIAN_MEASUREMENTS = "$PWD/node_modules/.cache/t117-measurements.json"
npx vitest run --mode gpu src/features/imageEdit/v3/gpu/imageEditorBackendRegistrationV3.gpu.test.ts --silent -t t117
```

## 误差分析

R04 的129×131高频、非恒定半透明完整链 RMSE≈0.0006706，相对于同一个 interactive CPU 计划；比较双方都用同一降采样和全局相位，所以该超差不能解释成 interactive 对 final 的近似误差。原窗口在完整网格上求值，scale=1，也不涉及新查出的0.75倍相机相位差。升高低分辨率金字塔存储精度后，只保留输入/输出/合成的 fp16，完整链恢复 RMSE<0.0005，说明主要是中间写入量化累积。

| 质量 / sigma比例 | 改后整链 max | 改后整链 RMSE | alpha RMSE | alpha 平均偏差 |
|---|---:|---:|---:|---:|
| interactive / .08 | .00074232 | .00026193 | .00046792 | -.00044041 |
| interactive / .25 | .00070941 | .00020536 | .00036302 | -.00033021 |
| interactive / .0019 单轴 | .00048798 | .00018256 | .00028333 | -.00024610 |
| interactive / 0 | .00048798 | .00018256 | .00028333 | -.00024610 |
| final / .08 | .00074315 | .00026178 | .00046692 | -.00044057 |
| final / .25 | .00070935 | .00020123 | .00035532 | -.00032383 |

alpha 存在负向偏差，零模糊本身也有约.00018 RMSE，说明源解码/预乘/写回依然贡献误差；不能把所有误差归给高斯数学。现在不再给 interactive Gaussian 额外0.001整链预算，回归明确使用0.0005。上述是线性 RGBA **整链聚合 RMSE**，不是每个通道分别保证0.0005，也不是 HDR 全幅误差承诺。共享 interactive/final 冲激近似策略未改。

整幅/区域回归覆盖：两质量、两串联高斯、三轴、透明/延伸边缘、0.81/0.73 opacity、screen混合、两个高斯共享蒙版且其中一个反转、曝光点操作、仿射缩放/斜切/小数平移、scale=1和.75、中央与两侧边角core、preview/export两入口、远离整图的空窗口。对应位置最大差<1e-5；GPU/CPU完整链 max<.002、RMSE<.0005；既有两宿主GPU/CPU/tile对照通过。不是全应用/全部HDR输入审计。

## 检查结果

按testing.md L2及任务指定范围，所有Vitest均加`--silent`；超过一分钟的GPU测量与门禁通过后台终端会话执行。

- `npx tsc -p tsconfig.json --noEmit`：最终通过。中途发现并行R05的旧类型/ViewerMark错误，及本任务取消测试夹具漏填quality/错误type，后者已修复并精确复验；没有修改范围外文件去压错误。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。本任务没有修改core或main，被主进程导入契约未改变。
- 17个本任务TS/测试文件ESLint（`--report-unused-disable-directives --max-warnings 0`）：通过，后续改动逐文件补验。首次发现unused size和两个多余分号，已修正。
- 精确单测有效证据：GaussianRegions 2、MemoryBudget 6、SceneExportRuntime 6、SceneRuntime 8、SceneRuntimeFallback 3，共25项通过；包括显式完整导出尺寸、8K串联halo、真实源页预算、同一蒙版多挂载计费、等待资源时取消及迟到事件。
- `npx vitest run --mode gpu ...imageEditorBackendRegistrationV3.gpu.test.ts --silent`：正式登记2、新增区域/导出/蒙版/仿射2，4项通过；性能用例平时显式skip，开启测量时已实际执行。最后远离整图窗口及双高斯共享/反转蒙版变更精确复验2项区域用例通过，渲染层tsc及该测试ESLint也通过。新增.75倍区域对照首轮因相机运算顺序失败，修复源和蒙版后通过；没有放宽区域门槛。
- `npx vitest run --mode gpu ...gaussianHosts.gpu.test.ts --silent`：两宿主符合性2项通过，原性能用例未开启；本任务未修改剪辑文件。
- 扩展GPU回归：RenderGraph 31/32通过，ExportMultiscale 4/5通过。**两项失败**均在`compiled.supported`断言：用例仍创建已移除的`image.blur`，属于并行旧操作删除后的测试夹具残留。未删、未跳过这两项用例；交总管理者处理。其余Gaussian/相位和CPU真值没有失败。
- 蒙版目标复用最后变更后，精确`RenderGraph -t '蒙版|嵌套'`5项通过；未重跑不受影响的原31项。区域GPU2项也再次验证远离整图窗口，不会把纯空视口扩到原点。
- `npm run check:dead-code`：最终通过，1个存量未使用文件，2048导出/类型仅报告；脚本另输出存量unlisted/binaries/unresolved诊断。首次因并行任务的`imageMark/editor/useMarkEditorContext.ts`新增未使用文件失败，外部删除后复验通过；本任务未改基线。
- `npm run check:ui-residue`：最终通过，无违规、无未登记、无过期条目。首次因外部旧`ImageToolRail.tsx w-[52px]`的过期登记失败，外部修复后复验通过；本任务不改allowlist。
- `npm run check:dependency-graph`：最终通过，2个静态值SCC、0冻结跨层边、408跨feature非index导入、首屏970模块/0重模块、11动态值回边。此前失败为外部canvas→imageEdit非index导入27>23，随后并行index变更途中出现Madge/TypeScript解析不一致；确认入口已去掉editor值导入后重新采集稳定快照通过。未修改外部文件或扩大基线。
- `git diff --check -- <本任务已跟踪文件>`：通过，仅Windows LF/CRLF提示。没有执行git add/commit/push/stash/reset/checkout。

不将门禁的范围外失败、选择性GPU回归、硬件可选基准或未测项目说成全仓验收通过。无新增应用能力/schema，未跑assistant-capabilities、main-imports或无关UI门禁；没有全量测试、Reality、electron:dev或付费调用。

## 改动文件清单

以下GPU路径均相对`src/features/imageEdit/v3/gpu/`：

| 文件 | 修改目的 |
|---|---|
| imageEditorGpuGaussianRegionsV3.ts | 新增从输出沿图反传共享halo的完整网格区域计划。 |
| imageEditorGpuGaussianRegionsV3.test.ts | 验证8K串联、质量、局部/完整计划与显式输出尺寸。 |
| imageEditorGpuGaussianStorageV3.ts | 统一图片设备存储精度、32像素分配对齐、同网格双槽及预算。 |
| imageEditorGpuGaussianBlurRendererV3.ts | 按halo窗口执行、按mip复用中间纹理并嵌回合成区域。 |
| imageEditorGpuEffectViewportV3.ts | 用真实halo区域替代纯高斯的全图扩展，并支持交互保留窗口。 |
| imageEditorGpuEffectExecutorV3.ts | 传递区域计划、复用效果输出及清理失败复用缓存。 |
| imageEditorGpuRenderGraphExecutorV3.ts | 传递全局网格/纹理窗口、使用全局像素相机并复用合成目标。 |
| imageEditorGpuRasterPipelineV3.ts | 统一预览/导出区域扩展、实际预算与拖参数保留窗口。 |
| imageEditorGpuViewportPlansV3.ts | 源及蒙版tile请求复用实际工作窗口。 |
| imageEditorGpuRasterSupportV3.ts | 相机uniform携带区域模式及整数全局像素原点。 |
| imageEditorGpuMaskAssemblerV3.ts | 蒙版使用同一相位、缓存身份、目标复用及失败丢弃。 |
| shaders/imageEditorGpuRasterLayerV3.wgsl | 源图区域采样采用与整幅相同的全局坐标运算顺序。 |
| shaders/imageEditorGpuGraphMaskTileV3.wgsl | 蒙版与源图同步修正全局坐标运算顺序。 |
| imageEditorGpuMemoryBudgetV3.ts | 计入区域真实分配与每次挂载的rgba16蒙版目标。 |
| imageEditorGpuMemoryBudgetV3.test.ts | 增加8K局部预算及多挂载蒙版计费回归。 |
| imageEditorGpuSceneExportRuntimeV3.ts | 纯区域高斯交给compositor反传halo，避免外层重复扩展。 |
| imageEditorGpuSceneExportRuntimeV3.test.ts | 验证core布局及等待资源时可取消。 |
| imageEditorBackendRegistrationV3.gpu.test.ts | 收紧整链RMSE并增加真实区域/mip/仿射/蒙版/导出与测量入口。 |
| imageEditorGpuGaussianMeasurementsV3.testSupport.ts | 显式本机12组合计时、实际native分配峰值及诊断输出。 |
| docs/task/架构体检/t117-GPU高斯区域求值与性能.md（仓根相对） | 本任务设计、数据、误差、检查、限制与设计自查。 |

## 风险与未验证

- 非Gaussian邻域核与canonical Gaussian混用时仍采用原完整分析域；裁剪/朝向组合仍由已有编译器明确交给CPU。这些既有路径没有扩大成本次全项目迁移。
- 高倍率预览驻留与导出共用256MiB：正式SceneExportRuntime仍先扣除预览常驻量并保留可恢复预算失败/CPU事务重试。上表基准没有并行预览，不能保证任意重预览场景下 final 一定留在GPU；本任务未重写预览暂停/自适应导出core调度。
- 未测驱动物理显存、真实Electron输入到呈现延迟、文件编码/写盘总耗时、其他GPU/驱动或复杂HDR长链；没有付费调用、Reality、完整构建或electron:dev启动。
- 没有主进程代码改动，不要求重启主进程。扩展GPU回归中的两个旧操作夹具需由总管理者处理，不能将本任务标成全仓GPU绿灯。

## 设计自查

1. 助手只凭名称和说明能否用对？能；沿用 canonical `gaussian_blur` 的画面高度比例、方向和边缘处理，不新增像素/halo 参数或工具，既有实体读写与人共用同一渲染计划。
2. 能否 AI 先做、人只确认？能沿用既有助手参数修改、预览与撤销；本任务优化同一高斯的反馈，不声称新增自动主体识别或自动参数推荐。
3. 产物能否直接流进其他工作区？能沿用正式图片导出与受管素材引用进入画布/剪辑；区域执行不增加私有数据格式或搬文件流程。

未提供独立任务总览路径，故只新增用户指定的本任务记录，不改其他任务行或体检报告。
