# t123-cpu 图片编辑 CPU 渲染执行器与冷源解码性能

状态（t138）：共享源块解码与 Worker 阶段计时已接入，稀疏蒙版行复制进一步提速；最终 4K/8K 渲染 3.42/12.38 秒，完整保存 3.70/12.89 秒。**仍未达到 ≤3/≤10 秒，不能关闭性能目标。** 像素与重开 SHA-256 未变；真实 Electron 保存手感未测。

## 范围、计划与设计自查

- 2026-10-10，在 main 共享工作区工作。只修改本任务文件；未 Git add/commit/push/stash/reset/checkout，未修改 SDK，未修改保存、打包、历史分页实现，未启动/重启 electron:dev，未运行 Reality 或付费调用。
- 按 AGENTS.md 读取 architecture、media-url、logging、electron-desktop、testing 与前置 `perf-大图保存性能.md`；使用 powershell-safe-invocation 技能执行本地命令。内部 CPU 后端优化属于原操作的实现替换，不新增实体、属性、公开长任务或助手能力，不新增 MCP 工具。
- 计划：同夹具测改前 → 定向计时定位 → 恒等采样/颜色点操作/冷解码优化 → Worker 隔离及有界并行 → 像素、取消、预算、GPU、静态门禁及改后基准。已执行；耗时目标仍欠账。
- 本次没有指定总览文件或 t123-cpu 已有行，因此没有修改共享总览；由总管理者登记本记录及未达目标状态。
- 真实规模：4096²/8192² RGBA8，两个共享源的栅格层、曝光调整、非空 Float32 稀疏蒙版、局部曝光滤镜；复用既有唯一真实文件保存夹具。32MiB 条带缓存与最多四个计算线程是内存/调度技术预算，超宽条带回退区域解码，并发按全局像素预算降低，不限制产品文档、图层或素材数量。
- 唯一状态源与异步落盘：文档、RenderPlan、资源描述与保存事务不变；Worker 仅持有一次区域求值，返回原像素流。保存确认、输出暂存、原子发布仍归原服务，本任务不复制保存实现。
- 取消与恢复：当前区域取消立即终止 Worker；迟到资源回执被丢弃。任一区域失败终止其余计算与读取；原入口记录失败，禁止静默回到 UI 线程。原 GPU 后端选择/设备恢复规则不变。

### 设计自查

1. **助手只凭名称和说明能否用对？** 能沿原图片编辑/保存/导出操作调用，无新增参数或并行开关；人和助手仍委托相同领域入口。线程数、条带键、颜色域与预算仅属内部执行信息。
2. **能否 AI 先做、人只确认？** 后端选择、源条带复用、颜色量化、区域划分和取消由执行链自动完成，人只校正图像结果。尚未达成 3/10 秒，不宣称保存手感已完成。
3. **产物能否直接流进其他工作区？** 返回相同全尺寸 RGBA 瓦片与相同 V3 文档，不引入私有格式或手动文件搬运；仍走原画布/剪辑投影。本轮验证像素/模型保存回环，未重跑跨工作区窗口。

## 选型与实现

1. 继续使用已有 **Sharp/libvips** 做文件解码、颜色归一化、EXIF 方向与缩放。对 mip0、零 halo、8/16-bit 的大源图，一次解码最多 16MiB 全宽条带，横向块复用；缓存与在途解码合计最多 32MiB。缓存键绑定不可变资源、条带行与位深；同键独立取消/去重复用原 AbortableSingleflight。HDR、mip 缩放、halo、超宽条带沿原区域解码，不造全图 Float32 表面或新增派生格式。
2. 精确恒等采样不读双线性邻域，避免 512 输出块意外读取四个源块；非恒等、资源边界、内容与蒙版各自采样网格仍由原契约决定。
3. sRGB8 源解码用 **Float64 离散查表**，乘 Alpha 后才写 Float32；8-bit sRGB straight 输出用精确半码阈值修正，临界值回到原公式。16/32-bit、HDR、预乘输出继续原编码。完整 16-bit 输入网格、所有量化临界点、源全部颜色/Alpha 码值与 padding/byteOffset 精确回归通过。
4. 中性 gamma 曝光合并点操作与蒙版混合，显式 `Math.fround` 保留原中间 Float32 舍入；透明零内容复用背景，完全不透明 normal 效果避免多余除法。未修改已有像素金样或容差。
5. 使用原生 **Web Worker** 消息与 transferable 输出；测试用真实 **Node worker_threads** 运行同一 CPU runtime，仅替换消息适配器。Worker 委托正式区域执行器，投影和编码移到中立 core，共享一份实现。读者借出的像素以 structured clone 发送，禁止 detach 缓存；输出独占缓冲 transfer 回宿主。
6. 一个全局调度瓦片内部最多四个小区域并行，逐块拼回原输出瓦片。原全局 scheduler 的 CPU 导出/交互规则不变；依据实际各区域需求计入工作集及跨线程副本，压力下减少到两个或一个。含全局分析的效果不并发共享自定义运行时。
7. 未采用 Sharp composite 替换所有 Float32 领域内核：现有 mask、混合、HDR 与区域几何语义已有统一 CPU/GPU 契约，未经证明不能改成整数或另一套颜色求值。未恢复另一套 GPU 后备，原 GPU 优先选择器已存在；此次针对 GPU 不可用的 CPU 后备。

官方依据：[Sharp 输入元数据](https://sharp.pixelplumbing.com/api-input/)、[Sharp 图像操作与方向](https://sharp.pixelplumbing.com/api-operation/)、[Node Worker 线程](https://nodejs.org/api/worker_threads.html)。复用已有成熟库与线程原语，不新增依赖；定向 Worker 测试使用项目已声明的 Vite 在内存构建单个 runtime，不写应用运行产物。

## 本次改前/改后数据（毫秒）

本机 Windows / Ryzen 9 5900X（12 核、24 逻辑线程）。临时目录真实文件、正式 CPU 执行和保存服务；不含真实 Electron、IPC、窗口、封面。改前来自 `t123-cpu-before`，改后来自 `t123-cpu-final-vite`，均每尺寸一次；共享工作区有其他任务，不能将波动全部归因于本改动。

| 阶段 | 4K 改前 | 4K 改后 | 8K 改前 | 8K 改后 |
|---|---:|---:|---:|---:|
| 渲染与瓦片写入 | 18240.08 | **4877.34** | 79393.25 | **18671.67** |
| 临时瓦片写入（包含在上一行） | 449.48 | 325.15 | 1737.89 | 1211.25 |
| 最终编码与同步 | 119.02 | 172.99 | 250.14 | 351.27 |
| hash 与资源写入 | 26.04 | 24.86 | 45.19 | 46.36 |
| 包写入与同步 | 96.46 | 102.80 | 155.62 | 143.95 |
| 完整保存总计 | **18481.60** | **5177.98** | **79844.19** | **19213.24** |
| 渲染阶段测试进程事件循环最大延迟 | 282.08 | **25.14** | 269.82 | **19.72** |
| 保存 I/O 阶段事件循环最大延迟 | 1.99 | 4.15 | 2.39 | 3.32 |

完整保存分别减少约 72%/76%。**4K ≤3 秒、8K ≤10 秒仍失败。** 本次基准的成功仅证明真实尺寸的像素/模型回环，不等于性能门槛通过。

冷源阶段诊断：在串行控制轮 `t123-cpu-identity-lut-stripes` 中，读取累计由 2781.64/20551.61ms 降到 991.47/3885.15ms。最终并行轮累计读取等待为 4722.11/18745.10ms，多个读取重叠，**不能与串行累计直接比较，也不等于墙钟解码耗时**。最终宿主 Float32 源解码累计约 2008.31ms、1280 次（两尺寸合计）；四个子区域仍会重复取同一 512 源块并转换。这是下一步明确的去重空间。

诊断轮 `t123-cpu-profile` 对编码、输出投影、效果混合与源解码计时，确认除冷源外还有大量点操作与逐像素复制；期间外部任务负载影响 8K，此轮不作稳定性能结论。随后单 Worker `t123-cpu-worker-final` 总保存 7125.69/27524.86ms，四区域并行 `t123-cpu-parallel-final` 为 5544.64/19782.43ms，融合后 `t123-cpu-fused-final` 为 5734.08/19138.13ms。后者收益接近环境波动，不能单独归因于融合优化。

## 验证（L2）

风险依据：共享像素执行、源文件 I/O、取消、跨线程资源生命周期与直接导出消费者变化；选择精确单测、两套 tsc、文件 ESLint 和相关依赖/主进程门禁，不升级全量或 Reality。

- 精确最终回归：13 文件 101 项通过（区域/整幅、采样网格、CPU 合成、原金样、导出颜色/局部滤镜/稀疏栅格/生命周期/源几何、Sharp 源与七种 EXIF 方向）。源查表追加完整码值后单独重验通过。
- 新增与直接边界：5 文件 15 项通过（源完整码值、输出量化、曝光保留舍入、条带去重/取消/预算/失败、原整数/浮点输出）；真实线程 Worker 7 项通过（整幅/分块、方向/镜像/裁剪、借出缓冲不 detach、读取失败后重用、取消与迟到回执）。
- `npx vitest run --mode gpu src/features/imageEdit/v3/gpu/imageEditorGpuColorPipelineV3.test.ts --silent`：9 项真实 WebGPU 色彩/曝光测试通过，沿已有容差；没有改 GPU 金样。
- 显式原 4K/8K 基准改前通过；新计时包装复用原唯一夹具，Worker 改后基准通过，全像素输出与重开逐瓦片 SHA-256 相同、文档结构相同；未降低分辨率或放宽阈值。
- `tsconfig.json`、`tsconfig.electron.json`：最终通过。首次 renderer tsc 有本任务协议联合类型/输出描述类型错误及共享 liveAnnotation fixture 错误；本任务错误已修，后续共享错误消失后两工程通过，未修改他人 fixture。
- 本次 TS 文件 ESLint、`check:dependency-graph`、`check:main-imports`、`check:ui-residue`：通过。
- `check:dead-code`：退出码 0，存量未列依赖/导出及 native worker 路径报告保留。首次测试辅助直接引用传递依赖 esbuild 的报告已通过改用已声明的 Vite 消除；未改依赖基线放行。
- 新曝光回归首次因无源文档编译掉无输入调整节点失败，修正测试夹具后 3 项逐值对照通过；失败没有通过放宽像素容差掩盖。
- 未运行全量、应用构建、Reality、真实 Electron 或开发实例；没有生成提交、安装包或额外总结文件。

复现改后：

```powershell
$env:HENJI_IMAGE_SAVE_BENCH = '1'
$env:HENJI_IMAGE_CPU_WORKER_BENCH = '1'
$env:HENJI_IMAGE_SAVE_BENCH_LABEL = 't123-cpu-local'
npx vitest run src/core/imageEdit/v3/execution/cpuRenderPerformance.benchmark.test.ts --pool forks --silent
Remove-Item Env:HENJI_IMAGE_SAVE_BENCH
Remove-Item Env:HENJI_IMAGE_CPU_WORKER_BENCH
Remove-Item Env:HENJI_IMAGE_SAVE_BENCH_LABEL
```

## 未完成与下一步

- 首先给 Worker 内部曝光/蒙版/混合/编码增加窄阶段计时，区分 CPU、消息复制和资源等待；现有读取累加不能替代墙钟阶段证据。
- 对同一调度瓦片的四个子区域共用一次原始 512 源块读取与 Float32 解码。需要明确预算、不可变共享及 transferable 所有权；不能用未计入预算的全图缓存换取目标。
- 冷源条带仍从 PNG/JPEG 头重复扫描，必要时比较一次原生顺序解码流式分块与条带方案；继续优先 libvips，不写自研解码器。
- 若 Worker 内核仍无法达标，应比较成熟原生/WASM SIMD 点操作，并逐个证明 Float32 舍入、蒙版、HDR 与 CPU/GPU 容差；不继续无证据微调。
- 自定义全局效果的分析与宿主回调仍沿旧执行链；此次曝光场景的 <50ms **不能推广为所有效果、HDR/宽色域源、所有硬件的冻结验收**。源 16/32-bit 的扩展性能、设备恢复后 GPU 后备、真实主进程/窗口均待专项取证。
- 总管理者需重点审查全局预算下的并行降级与 IPC/真实 Worker 装配；运行变更涉及主进程源读取，后续真实应用验证需要新运行产物与主进程重启。本代理按任务限制未构建或重启。

## 实际文件清单

| 文件 | 修改 |
|---|---|
| `electron/main/services/image-editor-v3/source-provider.ts` | 接入原生条带复用、保留方向/位深/区域后备及结构化事件。 |
| `electron/main/services/image-editor-v3/source-decode-stripes.ts` | 32MiB 有界条带缓存、同键去重与独立取消。 |
| `electron/main/services/image-editor-v3/source-decode-stripes.test.ts` | 并发、取消、在途预算、失败及重试回归。 |
| `src/core/imageEdit/v3/execution/cpuSamplingGrid.ts` | 精确恒等 ROI 不读取额外邻域。 |
| `src/core/imageEdit/v3/execution/sourceTileDecode.ts` | sRGB8 Double 精度离散源解码查表。 |
| `src/core/imageEdit/v3/execution/sourceTileDecode.test.ts` | 全部颜色/Alpha 码值、padding 与 byteOffset 对照。 |
| `src/core/imageEdit/v3/execution/pixelKernels.ts` | 中性 gamma 曝光与蒙版融合，保留 Float32 舍入。 |
| `src/core/imageEdit/v3/execution/pixelKernels.test.ts` | 曝光 HDR、Alpha、蒙版逐值对照旧参考核。 |
| `src/core/imageEdit/v3/execution/tileBlend.ts` | 无变化内容、透明零合成及不透明 normal 混合快速路径。 |
| `src/core/imageEdit/v3/execution/cpuOutputTile.ts` | 唯一中立 CPU 投影/编码与精确 sRGB8 输出量化。 |
| `src/core/imageEdit/v3/execution/cpuOutputTile.test.ts` | 完整输入网格与半码临界值量化对照。 |
| `src/core/imageEdit/v3/execution/cpuOutputParts.ts` | 独立区域划分及输出瓦片重组。 |
| `src/core/imageEdit/v3/execution/cpuRegionWorkerProtocol.ts` | CPU 区域/资源回调/输出的内部线程契约。 |
| `src/core/imageEdit/v3/execution/cpuRegionWorkerClient.ts` | 区域委托、借出缓冲保护、失败及取消生命周期。 |
| `src/core/imageEdit/v3/execution/cpuRegionWorkerRuntime.ts` | Worker 调用正式 CPU 区域求值器并编码输出。 |
| `src/core/imageEdit/v3/execution/cpuRenderRegion.worker.ts` | 浏览器 Worker 消息适配器。 |
| `src/core/imageEdit/v3/execution/cpuRegionWorker.testSupport.ts` | Vite 内存单入口编译及真实 Node 线程测试适配器。 |
| `src/core/imageEdit/v3/execution/cpuRegionWorker.test.ts` | 跨线程像素、分块几何、错误恢复与取消测试。 |
| `src/core/imageEdit/v3/execution/cpuRenderPerformance.benchmark.test.ts` | 原夹具计时包装及显式真实线程基准。 |
| `src/features/imageEdit/v3/export/outputTile.ts` | 原投影/编码入口委托唯一 core 实现。 |
| `src/features/imageEdit/v3/export/renderExportTilesV3.ts` | CPU 导出执行器接线、预算感知的区域并行及线程回收。 |
| 本记录 | 选型、设计自查、改前/改后、失败与未达目标交接。 |

两个 `src/features/.../export` 文件是 CPU 执行宿主必须的窄接线；未修改保存、打包、历史分页文件。对同源问题的实际排查范围是 CPU 整幅/区域执行、默认导出、源读取/代理/金字塔、EXIF/halo/mip、稀疏栅格与蒙版、原 GPU 色彩消费方。非恒等几何、HDR 值和 GPU 既有容差在精确测试中未发现同源回归；所有效果的真实窗口性能没有验证。


## t138 共享解码与蒙版行读取（2026-10-10）

- 四个并行子区域在同一调度瓦片内共享一次 512 源块读取/验证/Float32 解码，缓存键绑定资源、mip、坐标、位深、工作空间及参考白。最多 32MiB，计入全局 `in-flight` 预算；预算不足回到原暂存路径，任务 finally 释放，不跨任务常驻、不 detach 借出缓冲。
- Worker 内部补回调等待、实际节点内核、opacity/composite/effect-mix、投影和编码计时，汇总进入原结构化渲染日志，不新增日志文件或界面调试状态。累加包含四 Worker 的重叠时间，不能把它当串行墙钟相加。
- 阶段证据表明 `wait.mask` 累加约 27.55 秒。mip0 蒙版原来逐像素构造瓦片键、查 Map，空白区域也逐像素执行；改为默认/矢量基底填充后只按行复制相交稀疏块。整数采样位置、浮点值、边缘和更高 mip 的原路径不变，没有降低分辨率或放宽像素容差。
- 保留成熟 Sharp/libvips 解码与原生 Workers。官方操作文档 `https://sharp.pixelplumbing.com/api-operation/` 说明了原生逐像素操作，但整条渲染链仍要求精确 Float32 中间舍入、预乘 Alpha、局部蒙版及 HDR 契约；未经金样证明不能直接把它换成近似原生管线。`https://nodejs.org/api/worker_threads.html` 是线程适配的一手资料。本轮未引入新依赖或自研 SIMD/解码器。

### 同一夹具测量

4096²/8192²、两层共享源、非空稀疏蒙版、曝光调整与局部曝光滤镜；真实文件保存与重开全像素 SHA-256 保持一致。性能进程无 Electron 窗口；没有清空系统文件缓存。三轮皆用原唯一保存夹具，不复制另一条保存实现。

| 阶段 | 改前 t123 4K / 8K | 仅共享解码 4K / 8K | 共享解码 + 蒙版行复制 4K / 8K |
|---|---:|---:|---:|
| 渲染（含写输出块） | 4,877.34 / 18,671.67 ms | 4,882.37 / 17,826.55 ms | 3,417.35 / 12,380.64 ms |
| 完整保存 | 5,177.98 / 19,213.24 ms | 5,175.22 / 18,367.83 ms | 3,701.01 / 12,888.20 ms |
| 原源读取累加 | 旧记录见上 | 969.83 / 3,854.23 ms | 947.62 / 3,765.85 ms |
| 输出块写入 | 旧记录见上 | 旧报告 | 303.70 / 1,058.25 ms |
| 编码与同步 | 旧记录见上 | 旧报告 | 150.78 / 310.00 ms |
| 输出哈希 | 旧记录见上 | 旧报告 | 26.41 / 45.73 ms |
| 打包发布 | 旧记录见上 | 旧报告 | 106.46 / 151.84 ms |
| 事件循环最大延迟 | 25.14 / 19.72 ms | 诊断报告 | 14.23 / 19.08 ms |

两尺寸合计解码调用从 1,280 降到 320 次；共享解码累加 535.94ms。Worker 最终累加：wait.raster 31,328.29ms、wait.mask 4,184.25ms、曝光 4,147.36ms、opacity 1,401.03ms、composite 1,686.29ms、effect-mix 1,847.44ms、encode 2,941.13ms；等待包含消息调度和宿主资源返回，不是纯 Sharp CPU 时间。仅共享解码的收益有限，蒙版行复制才产生本轮主要收益；不能把全部改善归因于解码。

结果：完整保存比原轮降低约 28.5% / 32.9%，目标依然欠账。下一步应首先拆分宿主读取/structured clone/Worker 排队的 wait.raster 窄阶段，比较一次顺序 libvips 解码流式供给与当前原生条带；内核剩余曝光/混合/编码再与成熟 SIMD/WASM 方案比较，必须沿原 Float32 舍入和 SHA-256，不可调整容差。不能凭当前两个尺度宣称所有 HDR、全局效果或所有硬件达标。

复现仍用上面的显式基准命令，标签分别为 `t138-shared-decode` 与 `t138-mask-rows`。最终 CPU 代码之后未再修改；新增共享源与跨稀疏块默认值精确测试，真实线程原测试与像素金样沿完整目录回归。

### 设计自查与验收边界

1. 助手只凭名称和说明能否用对？能沿既有生成/编辑/保存/导出操作，无新公开参数或工具；阶段信息只进原日志。
2. 能否 AI 先做、人只确认？解码共享、蒙版区域读取与内存退让自动完成，人只校正图像；耗时未达目标，不能承诺已完成即时保存。
3. 产物能否直接流进其他工作区？同尺寸、同像素、同文档和资源，沿原流转；本轮没有重跑跨工作区窗口。

最终回归：用户指定九目录范围（官方九个原生文件单独跑），684 文件、3,977 用例通过，0 失败/跳过；原生 `npm run test:assistant-persistence` 9 文件 83 用例通过。两侧 tsc、本任务文件 ESLint、dependency-graph/dead-code/main-imports/persistence-compat/ui-residue/surface/colors/icons/ipc-contract 门禁通过；应用控制不变量限并发重跑 31 文件 206 用例通过。高并发 OOM、首次原生超时及首次目录回归发现的测试接线问题，过程和最终证据见 05 记录；性能目标未达成保留为明确风险。未执行 Git 写操作、SDK 改动、付费调用、Reality 或开发实例；运行时代码后续交付需要最新主进程产物。


### t138 实际文件清单

| 文件 | 本轮改动 |
|---|---|
| `src/core/imageEdit/v3/execution/cpuRegionWorkerClient.ts` | Worker 阶段接收。 |
| `src/core/imageEdit/v3/execution/cpuRegionWorkerProtocol.ts` | 内部计时协议。 |
| `src/core/imageEdit/v3/execution/cpuRegionWorkerRuntime.ts` | Worker 阶段测量。 |
| `src/core/imageEdit/v3/execution/cpuRenderPerformance.benchmark.test.ts` | 基准阶段汇总。 |
| `src/core/imageEdit/v3/execution/cpuRenderRegionExecutor.ts` | 节点内核计时。 |
| `src/features/imageEdit/v3/export/maskRegion.ts` | 蒙版行读取。 |
| `src/features/imageEdit/v3/export/renderExportTilesV3.ts` | 共享解码与计时接线。 |
| `src/features/imageEdit/v3/export/sourceRegion.test.ts` | 共享解码像素及预算测试。 |
| `src/features/imageEdit/v3/export/sourceRegion.ts` | 任务内解码缓存。 |
| `src/features/imageEdit/v3/export/maskRegion.test.ts` | 蒙版边界精确测试。 |

同时更新两份指定任务记录与 `docs/rules/assistant-status.md` 的历史通路条目。
