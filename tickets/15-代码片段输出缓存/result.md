摘要：ticket 15 简化第一版已实现；每个代码片段只记住工作目标的上次完整内容键，仅节目预览启用。
验收：337 项相关测试、真实 GPU 专项 12 项及 L2 全部门禁通过；隔离 Electron 五场景像素一致、命中符合预期。
审查：独立干净上下文 1 轮，发现 1 个重要问题（近似输入包装后身份丢失），已修复并由近似→精确补帧集成用例验证。

## 实现与裁定对应

- CodeSources 使用每片段 `code:output:<clipId>` 工作目标与一个 `lastOutputs` 记忆。代码静态路径并入同一机制；没有历史 LRU、RAM 层、缓存纹理复制或跨 Worker 配额。
- 完整展开源码包含 dataFiles、组件和库身份；frameKey 只在相同完整源码版本内跨时间复用。参数、场景、精确媒体输入及修订、尺寸/比例、质量、字体、曝光/元素覆盖、音频与作者效果环境进入键。
- 实际画面直接复用，保留纹理实际格式、预乘语义与 carriesLight。没有把全序列合成格式当作作者输出的格式，也没有为预测格式重复运行 draw。
- 只有节目预览及池化节目会话显式开启；默认会话、预渲染/导出、独立取帧仍走直接生成。Preview.tsx 仅透传会话标志，没有界面变化。
- 网页、序列、缺失/近似输入不能登记复用；输入准备仍走既有路径，未声称命中跳过解码/上传。
- 命中不保存观察快照，观察请求正式重画。releaseUnused、spill、字体失效、replaceContent、dispose 清除对应记忆；覆写前撤销旧键，成功且未取消才发布新键。
- 作者 API 文档补充随机数/时间的 frameKey 契约，并明确 dataFiles 的预渲染身份排除不适用于节目输出记忆。
- design.md 正文已按第 14 节与 review.md 最终裁定整理，旧历史两层缓存不作为本次交付范围。

## 独立审查与同源排查

审查代理 `/root/review_ticket15` 使用全新上下文，只拿任务目标、本次 diff/文件和对应规则。重要问题：原始近似画面进入 prepareImages 后变成新包装对象；若拿包装对象查询原画面的 WeakSet，会误判为精确，随后同帧精确补画可能命中近似输出。

修复：在渲染器输入上传边界按输入 key 传递近似标记，键计算只接受精确包装对象。已扩展现有快速拖动集成测试：近似第 30 帧→精确第 30 帧必须重画→再次精确第 30 帧命中。该测试使用真实包装身份变化的合成器边界替身。

实际检查范围包括 Sources 的全部工作目标登记/释放/spill、作者加载与 frameKey 桥梁、Renderer 三处 Sources 装配、节目池/Worker/Transport、观察请求与字体失效、默认会话的静态/动态绕过，以及 CodeSources 全部直接消费者。旧 `code:static`/`code:dynamic` 目标和 `staticPictures` 无残留。未改并行 ticket 的作者运行时、合成器和效果执行器；未做全项目审计。

## 真机专项

执行：`node scripts/bench-code-output-cache.cjs`。当前源码经生产 Vite bundle，进入独立 Electron 的真实 Worker，调用正式 Renderer、作者编译/运行时和合成器；有真实 OffscreenCanvas/WebGPU，未替换像素边界。实例用本工作区 `.bench/code-output/profile`，不连接 9334、不读用户工程、不读取主工作区运行产物。结束后正常退出。

环境：Windows，Electron 44.9.3，Chromium 152.0.7977.167；设备枚举包含 NVIDIA GeForce RTX 4090。basic GPU 信息采于初始化前，不把其 active 字段当实际适配器绑定证据。

规模：1920×1080，30fps，三个重叠代码片段。每组先冷启动、8 次热身，再记录 24 次；共 72 次作者生成机会。每场景分别在新 Renderer 上运行直接路径和缓存路径。源码修改交替两个固定版本，参数/外部变换/效果走正式参数更新入口，播放帧为 1–32。冷帧均正式生成。

| 场景 | 命中/机会 | 直接 p50/p95 ms | 缓存 p50/p95 ms | 作者 CPU p50 直接→缓存 ms |
|---|---:|---:|---:|---:|
| 暂停改另一片段源码 | 48/72 | 12.80 / 16.70 | 14.00 / 18.20 | 6.70 → 4.60 |
| 参数手势 | 48/72 | 9.30 / 13.90 | 5.30 / 7.70 | 3.10 → 2.10 |
| 外部变换 | 72/72 | 6.30 / 7.90 | 4.40 / 6.90 | 2.30 → 0.00 |
| 外部效果 | 72/72 | 7.00 / 9.40 | 5.30 / 7.40 | 1.50 → 0.00 |
| frameKey 不变连续播放 | 72/72 | 7.50 / 9.50 | 4.10 / 5.60 | 2.60 → 0.00 |

时间为 Worker 内请求到 GPU completion 的耗时；不是物理显示扫描上屏，也不是完整应用鼠标手势延迟。四组降低，暂停改源码这一组 p95 上升 1.5ms（约 9%），但 B/C 命中和作者 CPU 减少成立。本轮不把命中率当作所有场景都加速的证据，也不扩大历史缓存范围。

计时完成后，在相同前序帧历史上通过正式呈现回读最终完整 RGBA；五组直接/缓存 SHA-256 全相同。观察请求与字体失效后的首帧均为 0 命中。像素读回与 PNG 保存不计入上表；已目视外部效果截图为完整圆点合成画面。

证据：[完整 JSON](../../../Henji-AI-t15/.bench/code-output/evidence.json)、[外部效果直接](../../../Henji-AI-t15/.bench/code-output/external-effect-direct.png)、[外部效果缓存](../../../Henji-AI-t15/.bench/code-output/external-effect-cached.png)。其他四组 PNG 在同目录，文件名以场景名和 direct/cached 区分。证据不进入源码提交；脚本与夹具入库，可显式重跑。

## 验证

级别 L2：改变共享生成入口、跨消费者会话装配和异步取消后的目标有效性，执行精确消费者测试、渲染层类型检查及匹配静态门禁。

- `npm run test:gpu -- src/features/videoEdit/engine/videoEditContentPrecision.gpu.test.ts`：12 项通过。新增 native/layers 在固定请求 `[0,30,31,60]` 下比较全目标原始字节；layers 验证 8→16→16→8、carriesLight 一致，结束驻留字节为 0。该层 layers 的 Canvas 栅格用既有固定像素边界，GPU、作者运行时与 Sources 是真实实现；完整 Canvas 画面另由上面的 Electron 实测覆盖。
- GPU 文件中故意提交错误格式管线的既有负向用例会打印 validation 日志，它随后验证日志上报和修正后的恢复；不属于新增缓存用例的设备错误。
- 最终 `npm run verify:changed -- --level L2 <本次文件...>`：退出码 0，10 个精确测试文件共 337 项通过；ESLint、渲染层类型检查、表面/颜色/图标/残留/间距动效、依赖图、主进程传递导入共 10 步通过。表面检查保留仓库既有 356 项启发式告警，无规则错误。完整命令和输出保存在 `.bench/code-output/verify.log`，显式列出本次 19 个文件及直接消费者，不扫描整个工作区。
- `node --check scripts/bench-code-output-cache.cjs`、`git diff --check`：通过。
- 过程中直接 tsc 曾撞默认 4GB 堆上限，最终验证以 `NODE_OPTIONS=--max-old-space-size=12288` 执行；未修改项目配置或依赖。旧静态测试启用缓存时误改预览宽度已纠正，原像素时间断言保留，定向复验通过。

未验证范围：完整应用 UI 拖动延迟、物理屏幕呈现、多 GPU 适配器矩阵及后续历史缓存方案。没有声称这些已通过。

## 提交与约束

提交：`6ee9ceaca`（feat(video-edit): 复用节目代码片段上次完整输出）。提交后本任务工作区干净。仅在 `task/15-代码片段输出缓存` 提交，不 push、不切分支、不合并 main。未操作 9334 开发版、主工作区运行产物或 D:\视频制作；未安装/卸载依赖，未删除 node_modules 联接点。tickets/15 下只更新已授权的设计与 result.md。

## 审查修复 1

状态：合并审查 10 条已逐项处理。第 7 条完成两组交替复测，未复现稳定的 p50 回退，但 p95 未稳定改善，不能声称所有场景都加速。**本节替代前文“仅节目预览启用”的旧结论：所有输入精确的会话默认启用上次输出复用。**

提交：先在任务分支执行 `git merge main`，产生 `41ede47f0`，无冲突；追加修复提交 `a10f90e79`（fix(video-edit): 修复代码输出复用与失效边界）。仅在 `task/15-代码片段输出缓存` 工作，不切分支、不合并到 main、不 push。

### 十条裁定对应

1. 已合入 main。sourceTime 在计划阶段确定；每片段只组装一份 overrides/info/authorEffectEnvironmentForClip，frameKey 与 authorGenerator 共用对象。环境包含模板风格，静态与动态同用完整键，原静态漏 styles 的同源问题一并消除。
2. Renderer/Sources 默认启用，移除节目专属开关；导出、预渲染、试渲染、预设预览等经共同入口生效。相同静态内容共享目标；共享分裂、独占参数覆写、重新合并均有定向验证。内容键只决定共享关系，物理目标保持稳定，不因每次参数变化重分配纹理。
3. outputIdentity 随 program 在组装时保存到 plan；输入等待期间 program 被前瞻逐出后仍可完成，测试覆盖该竞态。
4. LoadedFontFaces 在实际字体资源增删时递增当前线程代次，Worker 不再恒为 0。代次进入输出键；作者实例也核对代次，使内部文字层纹理一起失效，避免只重跑外层却沿用旧字体栅格。
5. exactInput 缺省拒绝登记有媒体依赖的输出；无依赖作者仍可复用。覆盖缺省、近似、精确补帧与再次命中。lastOutputs 只保存 VideoEditCodePicture。
6. 音频、媒体与效果环境按不可变对象身份 WeakMap 记住摘要，新包装组合子树摘要。有 frameKey 时输出键不额外执行 layers；预渲染指纹的既有默认行为保持。新增多层声明调用次数验证。
7. 基准交替先后顺序并记录 GPU 时间戳，数据见下。实测还定位到共享诊断代码提交前 mapAsync 的根因，已修为提交之后显式启动读回；无需关闭诊断或吞掉 validation 错误。最终源码修改组 p50 持平，p95 仍波动；没有为小幅不稳定尾延迟加入猜测性缓存路径。
8. Renderer、Transport/Session 改为选项对象，全部直接构造调用同步迁移，调用方不抄默认值。界面实现仅改 Preview、ExportPreview、MulticamView 三处构造调用，没有其他界面改动。
9. 原独立脚本迁入 `scripts/lib/benchVideoEditCodeOutput.cjs`，由 `npm run bench:video-edit -- --scenario code-output` 调用；沿用正式构建新鲜度检查、electronLaunch 和隔离资料目录，没有另建 Electron 主入口或连接 9334。
10. 补充效果库、LUT、模板风格、片子数据/scene、音频快照、字体增删、源码身份逐出等失效用例；真实 GPU layers 用例改为两层，在固定请求 `[0,30,31,60]` 下比较原始纹理字节，覆盖 8→16→16→8 与 carriesLight。

### 第 7 条：交替顺序与 GPU 分段复测

最终命令：`npm run bench:video-edit -- --scenario code-output --rounds 4 --diagnostics --out .bench/code-output/review-1-complete`，退出码 0，evidence.completed=true，共 48 次运行。

环境：Windows、Electron 44.9.3、Chromium 152.0.7977.167；设备枚举含 NVIDIA GeForce RTX 4090。basic 信息采于初始化前，不把 active 字段当实际适配器绑定证据。正式 Renderer/作者运行时/合成器在真实 Worker/WebGPU 中执行，独立 Electron 隔离资料目录，隐藏窗口并关闭后台节流。

规模：1920×1080、30fps、三个重叠代码片段。每次 8 帧热身后记录 24 帧；四轮交替“直接→复用 / 复用→直接”，每种路径每场景 96 帧、288 次作者生成机会。下表为合并样本的 p50/p95；耗时是 Worker 请求到 GPU completion，不是物理显示扫描上屏。诊断打开，两路径条件一致。

| 场景 | 命中/机会 | 直接 p50/p95 ms | 复用 p50/p95 ms | 作者 CPU p50 直接→复用 ms |
|---|---:|---:|---:|---:|
| 暂停改另一片段源码 | 192/288 | 12.90 / 16.40 | 12.90 / 17.00 | 5.10 → 4.60 |
| 参数手势 | 192/288 | 7.50 / 9.90 | 6.90 / 10.80 | 1.90 → 1.30 |
| 外部变换 | 288/288 | 5.40 / 8.30 | 4.40 / 6.40 | 1.20 → 0.00 |
| 外部效果 | 288/288 | 6.00 / 9.20 | 4.50 / 7.60 | 1.20 → 0.00 |
| frameKey 不变连续播放 | 288/288 | 5.40 / 7.60 | 4.00 / 6.00 | 1.20 → 0.00 |
| 静态参数连续修改 | 192/288 | 6.90 / 9.40 | 6.50 / 9.90 | 1.90 → 1.20 |

源码修改组的 GPU 时间戳分段如下；`gpu.frame` 是首尾打点跨度，不能等同于 GPU 纯计算占用，也不能将各段分位数直接相加。

| 分段 | 直接 p50/p95 ms | 复用 p50/p95 ms |
|---|---:|---:|
| gpu.author | 8.133 / 11.540 | 7.801 / 10.596 |
| gpu.composite | 0.162 / 0.216 | 0.225 / 2.510 |
| gpu.frame | 8.835 / 12.380 | 8.563 / 12.593 |

该组四轮 p50（直接→复用）为 11.7→12.9、13.4→13.0、12.9→12.4、13.0→12.5 ms；合并后 12.9→12.9 ms。此前另一组四轮为 11.1→11.2 ms，p95 15.5→14.9 ms，GPU frame p50 7.413→7.241 ms，作者 CPU p50 4.3→3.9 ms。两组均完整保留：旧报告的 +1.2 ms 没有稳定复现，但尾延迟有升有降。最终组 GPU 作者段下降，合成段尾部上升；不能把变化归因为键计算持续变慢，也不据此宣称源码修改组全面更快。

实际修复的性能根因是静态共享目标绑定内容哈希后，参数每变一次就释放并重建物理纹理。现用稳定物理目标，最终静态参数四轮热帧的累计 textureAllocations 均保持恒定：直接路径 6、复用路径 3；没有随 24 次热帧增长。另一个源码修改场景两路径都会随实际源码替换产生作者资源分配，这不是参数热帧重复分配。

所有六场景、四轮直接/复用的呈现回读 SHA-256 一致。这里的呈现回读沿用默认 1280×720 采样输出，不能写成 1920×1080 全分辨率逐字节验收；原始纹理逐字节一致性另由 12 项真实 GPU 专项中的 native/layers 固定帧用例覆盖。已目视效果场景回读为完整圆点合成画面。

观察请求均 0 命中。字体失效后，动态场景和直接路径为 0 命中；静态复用场景为 1 命中：A、B 重新生成，C 与同内容 B 共享本帧新画面。最终夹具按这一静态共享契约断言，不把同帧共享误判为沿用失效前的输出。

证据：[最终 JSON](../../../Henji-AI-t15/.bench/code-output/review-1-complete/evidence.json)、[最终运行日志](../../../Henji-AI-t15/.bench/code-output/bench-review-complete.log)、[各轮与 GPU 汇总](../../../Henji-AI-t15/.bench/code-output/performance-final.log)、[前组复测 JSON](../../../Henji-AI-t15/.bench/code-output/review-1/evidence.json)。前组整体因新增静态字体断言不符合共享语义而退出失败，仅其中已完成的源码修改四轮用于比较；不能把该次整体运行报通过。最初诊断 pending-map 失败另保留在 `.bench/code-output/bench-review.log`。

### 验证、独立审查与同源排查

- 按 testing.md 的共享入口、跨消费者与异步状态风险执行 L2。第一组 `npm run verify:changed -- --level L2 <显式 39 文件> --test <直接消费者>`：26 文件 497 项 Vitest、5 项 Node 测试及 12 步门禁通过，退出码 0。包含类型、ESLint、表面/颜色/图标/残留/间距动效、依赖图、主进程导入与 IPC 对账。表面门禁错误 0，保留原有 356 项启发式告警。完整显式命令见 [L2 日志](../../../Henji-AI-t15/.bench/code-output/verify-review-final.log)。
- 之后新增诊断修复三文件，运行 `npm run verify:changed -- --level L2 src/features/videoEdit/engine/videoEditPreparationTiming.ts src/features/videoEdit/engine/videoEditPreparationTiming.test.ts src/features/videoEdit/engine/videoEditGpuCompositor.ts --test src/features/videoEdit/engine/videoEditContentPrecision.gpu.test.ts`：3 文件 54 项、ESLint、渲染层类型检查通过，退出码 0，见 [增量 L2](../../../Henji-AI-t15/.bench/code-output/verify-diagnostics.log)。两组共 28 个测试文件、539 项去重用例，12 项 GPU 用例重跑。最后仅调整基准字体共享断言，已由最终 48 次真实运行验证。
- 显式 `npm run test:gpu -- src/features/videoEdit/engine/videoEditContentPrecision.gpu.test.ts` 12 项通过；同一真实 GPU 文件又在上述最终诊断 L2 中通过。日志里的故意非法格式 pipeline 来自既有负向恢复测试，不属于未解决错误。
- `npm run electron:bundle` 更新最终源码产物成功；没有升级到 electron:build，没有安装或卸载依赖。`node --check`、`git diff --check` 通过。类型检查只使用本进程 NODE_OPTIONS 增加堆内存，没有修改项目配置。
- 响度导出测试曾有 3 项原有夹具失败，在合并基线复现；本轮只补现行导出替身接口，并将直接 PCM 导出夹具明确设为直出，保留取消前不写文件的原断言，没有修改响度/编码业务逻辑。构造迁移同时更新 SourceFrames、ExportPreview、ExportQueue 等直接消费者的测试边界。
- 输出缓存独立干净上下文审查 3 轮：1 项有效重要问题（静态参数导致物理目标反复重建）已修并通过真机分配计数验证；frameKey 额外执行 layers 的疑点依据最新第 6 条裁定与整幅输出声明契约撤回。新发现的独立 GPU 诊断缺陷另审 1 轮，无未解决重要或小问题。映射与提交次序依据 [WebGPU 官方规范](https://www.w3.org/TR/webgpu/) 核对。
- 同源实际排查覆盖 Sources 全部复用/释放/spill/观察/字体切换路径、三处 Renderer 装配、全部 Renderer/Transport/Session 构造调用、program 前瞻逐出、静态目标分裂与合并、作者内部字体纹理，以及诊断 finishFrame 的唯一生产调用方和 Worker 读回。相关缺陷已修；上述其余已查调用未发现同源问题。没有做全项目审计。

未验证：完整应用 UI 手势端到端延迟、物理屏幕呈现、多 GPU 适配器矩阵、1920×1080 整幅回读逐字节对比。没有声称所有场景 p95 改善。

约束核对：本任务分支代码提交后干净；没有 push、切分支或合入 main，没有操作 9334 开发版、D:\视频制作或主工作区运行产物。node_modules 联接点未删除，未运行 npm install/ci/uninstall；重任务串行。主工作区仅向用户指定的 tickets/15/result.md 追加本节。

## 第二步：按帧历史（11-04）

结论：**不做。** 显存预算内能保留的帧数只够逐帧前后挪这一种操作，拖动往返命中四分之一，改别的片段后回放与循环播放命中为 0；轻量代码片段本来就在 8 ms 以内，命中省下的不到 4 ms。现行“只记上一帧”保持不变。

### 怎么测的

`npm run bench:video-edit -- --scenario code-output-history --rounds 2`：隔离 Electron、真实 Worker/WebGPU（RTX 4090）、正式 Renderer 与作者运行时。1920×1080、30fps，三个重叠的代码片段，画面随时间变化、没有 frameKey（每帧内容键不同）；轻（360 个圆）、重（3600 个圆）两档。每个场景直接路径与现行复用路径交替各跑 2 遍。

历史命中不另写一套缓存去测：现行路径每帧登记的内容键就是历史要用的键，脚本把这串键按“每片段保留最近 N 个、最近使用淘汰”回放得到命中数；N=1 的回放与现行实测命中逐场景核对一致（全为 0）。预计耗时 = 直接路径逐帧均值 − 命中率 ×（直接均值 − 全命中帧耗时）。全命中帧取同一帧重复请求的复用路径 p50（约 3.5 ms）。直接路径的同帧重复请求只要约 4.5/11 ms，因为作者运行时内部还有复用，所以不拿它当未命中的耗时。

显存：输出目标为 rgba8unorm，每帧 7.9 MiB。生成器目标的容量是代码驻留预算的一半，即 256 MiB，在 1080p 下共 32 个目标。三个片段时每片段约 10 帧（237 MiB），4K 时每片段只剩 2 帧。

### 数据（第二次运行；两次的命中数完全一致）

| 场景 | 请求序列 | 直接均值 轻/重 ms | N=4 命中 | N=10 命中 → 预计 轻/重 ms | N=30（712 MiB）命中 → 预计 重 ms | 需要多少才有明显收益 |
|---|---|---:|---:|---:|---:|---|
| 拖动来回同一段 | 1 秒范围每次跨 2 帧，往返 3 次 | 7.5 / 33.0 | 8% | 25% → 6.5 / 25.6 | 81% → 9.3 | 保留整段拖动范围（30 帧以上） |
| 暂停后前后逐帧 | 100→105→95→105→100… 共 30 次 | 8.2 / 32.8 | 40% | 63% → 5.2 / 14.3 | 63% → 14.3 | N=10 已到顶 |
| 改另一片段参数后回放 | 播 2 秒，改片段 1，再播 2 秒 | 7.8 / 33.6 | 0% | 0% → 不变 | 0% → 不变 | N≥60（1.4 GiB），也只命中 33% |
| 循环播放 1 秒 | 30 帧循环 4 遍 | 7.8 / 32.7 | 0% | 0% → 不变 | 75% → 10.9 | 保留整个循环（≥30 帧） |

现行“只记上一帧”在这四种操作下命中都是 0，耗时与直接路径持平（轻 7.5–8.3 ms，重 31–40 ms，差值在两次运行的波动之内）。全命中帧耗时：轻 3.4 ms，重 3.6 ms；未命中时作者 CPU 每帧约 1 ms（轻）、7 ms（重）。

### 为什么不做

1. 预算内（N≈10）只有逐帧前后挪收益明显。重片段从 33 ms 降到约 14 ms，但单次按键 33 ms 本来就感觉不到。拖动往返重片段仍要约 26 ms，过不了 16.7 ms；轻片段 7.5→6.5 ms 本来就够快。
2. 以后再做第 3 节的真实痛点是“改一个片段，整个窗口都要重渲”，正对应“改另一片段后回放”。这需要每片段保留整段回放长度：2 秒就是 60 帧、1.4 GiB，超出显存预算 5 倍以上，而且也只命中没改的片段。循环播放同理要保留整个循环。LRU 遇到比容量长的顺序回放命中恒为 0，与设计审查的预判一致。
3. 静止下来的拖动、循环与回放，空闲 3 秒后的序列预渲染会接手，已渲染段拖动也先上缓存画面。历史缓存只在“刚改完、预渲染还没跟上”这段时间有用，恰好又是它命中最低的情况。
4. 代价不小：多保留的 237 MiB 显存会与效果、图层的另一半预算和 spill 争用；releaseUnused、spill、字体失效、共享静态目标都要跟着改成多槽。为了只对逐帧这一种操作有效的收益，不值得。

如果以后要解决“改一个片段后回放”，方向应该是每片段的内存层或磁盘层，读回后再上传（1080p 每帧 7.9 MiB）。这一层要先证明“上传 + 合成”比重算便宜，重片段约 30 ms、轻片段约 8 ms 时才有空间。不在本步范围，需要另行裁定。

### 本步改动

- `scripts/lib/benchVideoEditCodeOutput.cjs`：新增 `runCodeOutputHistoryBench`，启动链与现有专项共用 `openBenchPage`。修复 bench 构建时渲染引擎版本插件把夹具目录当仓库根，导致 `src/...` 入口被当成外部包、整个 `code-output` 专项无法构建的问题（`videoEditRenderEngineVersion({ root: ROOT })`）。
- `scripts/bench-video-edit.cjs`：新增 `--scenario code-output-history`。
- 夹具 `tests/fixtures/bench/video-edit/code-output/`：新增随时间变化的作者源码与四种请求序列；逐帧读出各片段工作目标登记的内容键，用于回放。
- 没有改 `src/**` 的运行代码，`lastOutputs` 机制保持现状。

### 验证

L1（只改基准脚本与夹具，不进入运行产物）：`node --check` 两个脚本；`node --test scripts/bench-video-edit.test.cjs` 5 项通过；夹具两个 TS 文件 ESLint 通过（`scripts/` 不在仓库 lint 范围）。真机专项完整跑了两次，`evidence.completed=true`，N=1 回放与实测命中一致的断言通过。证据在本工作区 `.bench/code-output-history/history-evidence.json`，不入库。

未验证：完整应用拖动手势的端到端延迟（专项按精确帧请求，不经过跳转先出画面）、4K 与多于三个片段的组合、显存较小的机器。
