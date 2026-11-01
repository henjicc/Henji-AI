实现：API 9 的 createSimulation／simulation.at、固定步推进、共享软预算快照及冻结 Rapier 已完成并提交。
审查：已完成一轮独立干净上下文审查；3 个重要问题和 1 个清理问题均已修复。
验证：最终 L2、真实 GPU／作者链路、性能与全部指定专项通过；提交 17b19b230，仅任务分支，未推送。

## 实现范围

- 基于 `90103a8f3`，工作区 `D:\VibeCode\Henji-AI-t17`，分支 `task/17-模拟运行时`。未切分支、合并或推送，未安装依赖，未操作 9334 开发版或 `D:\视频制作`。
- 共享模拟核心：源时间 0、默认 120 Hz／K=120、seed=0；序列化准备、完整步取消、S0 固定保留、Worker 共享 64 MiB 检查点 LRU 软预算。活动世界和当前帧视图不计入检查点预算；初始快照超预算会记录原因。
- 工厂可异步初始化；step／snapshot／restore／read／interpolate 同步。帧视图独立复制，at 不推进世界；使用正式参数历史和逻辑画幅，曝光区间预先准备，旧 API 同名属性不激活模拟。
- 生成片段、附加滤镜和试画共用作者运行时。纯模拟指纹不调用作者绘制／frameKey，纳入完整源码、库 pin、参数与场景历史；早期数据修改使后续窗口失效。动态作者库实际输出字节纳入引擎身份，主渲染与生产 Worker 使用同一身份。
- Rapier 上游 `@dimforge/rapier3d-deterministic-compat@0.21.0`，冻结发行 `0.21.0-henji.1`，npm pack 后提取精确 ESM、声明及 Apache-2.0 许可。Wasm 随 ESM 内嵌；命名与 default.init 共用 Promise。`package.json`、锁文件、node_modules 依赖未修改。
- API 号唯一运行时常量位于 `codeMaterial/authorLibraries.ts`，与 ticket 18 共用 API 9。追加 API／代码资产／项目／样片／模板／风格包迁移及黄金样本；旧黄金样本未改，模拟世界与检查点不落盘。
- 样片／模板 pin 路径复用 ticket 10 已提交的集中增量（`authorVersion.ts` 及相应消费者），没有另建默认解析器。未记录版本的历史样片固定按 API 7；明确 pin 保留；旧素材通过正式新增版本入口可采用当前 API。

## 独立审查与修复

审查范围：模拟核心、生成器／滤镜接入、缓存指纹、模板版本传播、持久迁移、Rapier 冻结与加载。只进行一轮独立审查。

| 级别 | 问题 | 修复与验证 |
|---|---|---|
| 重要 | 异步初始化期间取消，世界已发布但 S0 未建立 | 在检查取消之前完成 S0；新增取消后下一帧继续运行测试 |
| 重要 | 公共新增版本入口继承旧 API，无法使用模拟 | 新版本默认使用当前 API，导入／明确 pin 保留实际版本；公共事务回读验证 |
| 重要 | 大数组视图展开为函数参数导致调用栈溢出 | 逐项入栈；20 万元素数组回归 |
| 小问题 | simulation.dispose 抛错中断 GPU／模块释放 | 纳入既有释放错误聚合；验证 GPU 与模块均释放 |

主代理沿调用方检查另修复：生成器计划漏传模拟历史输入；生产 Worker 缺少引擎虚拟模块解析器；模拟指纹日志分类。对应正式源计划测试和小型 Vite 生产 Worker 构建测试已覆盖。

## 验证记录

- 最终 `npm run verify:changed -- --level L2 <本次明确的70个文件>` 全部通过：22 个 Vitest 文件、557 项测试；57 项 Node 测试；局部 ESLint；渲染层与 Electron 两套 tsc；依赖图、主进程导入和持久格式基线。准确参数清单归档于 evidence/t17-files.json，执行脚本为 evidence/t17-verify.cjs。
- `npm run check:assistant-capabilities` 全部通过：结构检查、15 项覆盖测试、31 个文件的 237 项不变量测试。
- `npm run check:persistence-compat` 通过：65 种格式；旧黄金样本和本票新增样本均在验证范围内。
- 真实 GPU：原生 WebGPU 像素读回；两实例乱序与不同逻辑／输出尺寸；冻结 Rapier 离线 init 去重、世界恢复与独立实例字节比较。
- `node scripts/freeze-rapier-library.ts --check` 通过，复用正式冻结清单／历史校验原语，已支持 scoped 路径。
- `npm run check:skill-sync` 通过。工作树缺少 FFmpeg 时，从现有固定版本只读复制到本任务目录，正式 ensure 校验通过；没有修改主工作区。
- `electron:bundle` 完成（363.61 秒）。真实 Electron 作者 Worker 离线加载 Rapier 的两个模块均为 200；初始化去重；6 个乱序时间样本中相同时间的 PNG 字节完全一致。
- 生成片段与附加滤镜正式链路各通过一次：640×360、100 刚体、60 fps、12 帧导出；正式预览／观察图／独立试画的 RGB 像素 100% 相同。生成器实时导出 PSNR 35.09 dB；滤镜预渲染 PSNR 37.09 dB、使用预览导出 PSNR 33.88 dB。有损视频采用 PSNR≥30 dB 判据，不声称压缩后逐像素相同。滤镜预渲染图已经目视核对。
- 真实测试使用隔离数据及随机调试端口。测试设施补齐作者信任结果转发（只读已有信任，不代用户批准）、显式 Electron appPath 和预渲染读回。正式读取观察图使用 saveToAssets=true；原有 observation.image 未登记为实体导致通用媒体读取失败，未改无关生产能力。
- 构建新鲜度检查对所有源码统一比较 main/index.cjs 时间，误判构建期间修改且已进入 renderer 产物的日志分类文件。已核对 main 01:39:05、源码 01:39:16、renderer 01:43:52 及产物中的 simulation 分类后，仅本次 Reality 设置 HENJI_SKIP_BUILD_FRESHNESS=1。随后 Vite 插件只补 Vitest 所用 Vite 5 工厂接口，生产 Vite 4 分支行为未变，生产 Worker 的小型构建测试再次覆盖。

## 性能实测

环境：Windows、Ryzen 9 5900X、RTX 4090。固定 120 Hz／K=120、逻辑 1920×1080，60 秒；下面模拟阶段不含 GPU 绘制。暖态从 58 秒开始以 60 fps 连续取样，恢复单独计时。

| 场景 | 冷跳30秒 ms | 无检查点冷跳60秒 ms | 热跳30秒 ms | 倒跳29秒 ms | 暖态 P50/P95 ms | 检查点 MiB | 进程峰值 RSS MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| Rapier 100 刚体 | 506.02 | 633.89 | 16.56 | 1.39 | 0.184 / 0.816 | 7.36 | 252.7 |
| Rapier 1000 刚体 | 2091.92 | 3298.45 | 8.24 | 5.33 | 0.526 / 1.222 | 63.59 | 199.1 |
| JS 10000 粒子 | 339.67 | 561.30 | 0.75 | 0.62 | 0.108 / 0.247 | 9.32 | 154.8 |
| Rapier 100 刚体×3 | 472.04 | 590.32* | 3.33 | 1.54 | 0.090 / 0.160 | 22.07 | 158.8 |

*三实例的 cold30/hot30/reverse29 是并发准备总墙钟，暖态为各实例采样分布；cold60 是相同工厂的单实例无缓存基准。RSS 是整个基准进程在准备边界采样的最大值，包含 Wasm、运行时和 GC，不是世界自身内存，也不是连续采样峰值。所有场景相同时间的读回 SHA-256 均一致；无检查点冷跳 60 秒补 7200 步，淘汰后回到 30 秒从 S0 补 3600 步。

| 场景 | step P50/P95 ms | snapshot P50/P95 ms | restore P50/P95 ms |
|---|---:|---:|---:|
| 100 刚体 | 0.024 / 0.062 | 0.198 / 0.408 | 0.795 / 15.872 |
| 1000 刚体 | 0.197 / 1.483 | 1.132 / 1.833 | 3.302 / 6.129 |
| 10000 粒子 | 0.026 / 0.042 | 0.049 / 0.108 | 0.052 / 0.069 |
| 100 刚体×3 | 0.022 / 0.049 | 0.135 / 0.225 | 0.325 / 1.852 |

100 刚体暖态 P95≤4ms 达标；首次恢复 15.87ms 单列，未混进暖态。恢复样本量较少（各单实例 6 次、三实例 16 次），百分位只描述这批测试。完整样本、步数、摘要、预览／观察／预渲染／导出和复现脚本位于 [evidence](evidence/)。基准脚本在任务仓库的 `.tmp` 中执行；复现时将归档脚本放回该目录。未验证其他操作系统或其他 CPU 的跨机器字节一致性；安装包与共享 L3 集成仍由 Claude 按设计负责。

## 并行合入接缝

- ticket 10：样片／模板 pin 集中增量需合并时去重；冻结检查共用 `scripts/lib/frozenAuthorLibraries.ts`。其已提交 `check-text-layout-vendor.cjs` 为文字专用；本票提供 Rapier `freeze-rapier-library.ts --check`，通用命令的最终编排由 Claude 串行合入。
- ticket 15：集中增量位于 sources／CodeGpu／runtime／指纹；本票不实现片段 GPU 输出缓存算法。
- ticket 16／18：作者模块与类型声明按小节合入；API 9 常量由 Claude 保留一处。持久格式序号按本分支基线递增，合入时须与并行票统一登记，不能覆盖其他票迁移。

参考：[Rapier 确定性](https://rapier.rs/docs/user_guides/javascript/determinism/)、[Rapier 序列化](https://rapier.rs/docs/user_guides/javascript/serialization/)、[Vite 4 Worker 插件契约](https://v4.vite.dev/config/worker-options)。

## 提交与实际排查边界

- 提交：`17b19b2300d17b117b0b471f03b4450ac649d640`，`feat(video-edit): 新增确定性模拟运行时与冻结 Rapier`。分支 `task/17-模拟运行时`，70 个文件；提交后 `git status --short` 为空。按用户要求未 push、未合并、未切分支。
- 已修复并验证：模拟核心、生成器／滤镜／试画共享入口、历史参数／场景依赖指纹、样片／模板 pin、持久迁移；一轮独立审查的 3 个重要问题和 1 个小问题全部处理。
- 检查后未发现同源缺陷：旧 API 固定版本读取、显式库 pin、共享检查点预算下多实例与取消后恢复；范围由上述精确测试和真实入口限定。
- 原有无关问题：`applicationToolDispatcher.readMedia` 先将 `observation.image` 当实体读取，返回 ENTITY_TYPE_NOT_FOUND；本票使用正式 saveToAssets 路径完成观察图对比，未改该生产路径。共享 L3／安装包、跨操作系统确定性和并行票最终版本统一仍待 Claude 集成验证。


## 审查修复 1

实现：修复第 1、2、6–13、15 条；第 3/4/5 条按要求等待依赖合并，第 14 条待冻结修订号裁定。
审查：三轮独立上下文审查，无重要问题；发现 1 个 GPU 等待结束后的取消检查缺失，已修复并补回归。
验证：L2、真实 GPU/作者链路、助手能力、技能同步、vendor 和严格许可证生成均通过。
提交：`49bf790a2b75b189ae2dacf56ab10f82aa15d312`（`fix(video-edit): 修复模拟取样缓存与作者生命周期`），在 `task/17-模拟运行时` 追加；未 push、未合入 main、未切分支。提交后工作区干净。

### 逐条处理

| 条目 | 处理与证据 |
|---|---|
| 1 | 完整步视图在 prepare 中校验、复制和冻结一次，at 直接返回；插值按时刻缓存。测试核对同对象返回与 read/interpolate 次数；技能要求同一时刻取一次，数值缓冲按只读契约使用。 |
| 2 | 恢复前检查 [a,current] 已有视图，顺播从当前世界续推。25/50 fps 插值顺播计数证明只推进差值步数，不反复 restore。 |
| 3/4/5 | 本轮未收到 ticket 10、15 已合入 main 的通知，未 merge main；outputKey 历史身份、统一 API 常量与格式版本顺延/去重留到通知后完成。 |
| 6 | renderCache 按实际 simulation 声明纳入完整 scene；声明读取复用正式已检查程序对象及原有加载/失败重试机制，不以 API 号推断。 |
| 7 | dispose 等所有在途 render 结束，再读取并释放模拟实例；覆盖初始化期间关闭。 |
| 8 | 插值失败标记在下一次 prepare 重建后正确复位；取消保持 AbortError，并使用取消日志语义。 |
| 9 | Worker 试画传 simulationInput/signal，同 URL 新请求、释放与重建取消旧请求；GPU 等待收尾后再次检查取消。正式 trial 路径检查确认已共用完整 sources 输入。 |
| 10 | 附加滤镜以片段首帧的源入点为零点，按源播放方向推进；参数按对应绝对源时间采样。精确测试覆盖一小时源入点、2 倍速、正倒放；真实 GPU 验证偏移后的正倒放像素与零起点相同。 |
| 11 | 复用既有第三方许可证生成器，新增 Rapier/Wasm 76 条登记及去重全文。依据官方 npm 对应源码提交、wasm 中可观察版本与官方 crate 许可证；npm 未提供 Cargo.lock/SBOM，无法证实的嵌入版本明确标为未公开，保守许可闭包的源码版本不冒充实际二进制版本。生成清单中这 76 条均关联全文。 |
| 12 | 简短说明 await 后仍只使用 info.random、同一时刻视图复用，以及滤镜模拟时间与对应源时间的关系。 |
| 13 | 引擎散列排除生成的 author-libs 目录与注册表数据，只保留注册文件运行辅助逻辑；具体库 pin 继续由片段指纹负责。测试覆盖构建目录存在与否、新增未使用冻结版本不改变全局身份、运行逻辑变化使身份变化。 |
| 14 | 暂未修改。henji.1 已提交且受 `scripts/lib/frozenAuthorLibraries.ts` 不可变门禁保护：覆盖 upstream/wrapper 会破坏旧 pin 或降低门槛。已请求裁定：保留 henji.1、新增 henji.2（上游仍为 0.21.0，只去 sourcemap 引用并让 init 失败可重试）。未获答复前不改依赖 pin、不覆盖冻结文件；当前 vendor --check 通过不代表此缺陷已修。 |
| 15 | NaN/Infinity/undefined 分别报准确错误；S0 只快照一次，保存仅遍历校验一次；导出 Declaration/Sampler 类型，step 参数随 AuthorParamValues<P> 推导。 |

### 本轮验证与证据

- `npm run verify:changed -- --level L2 <26 个显式文件> --test <精确消费者…>` 通过：12 个 Vitest 文件共 231 项（含真实 GPU 2 项）、Node 6 项、局部 ESLint、renderer/Electron 双 tsc、依赖图、主进程传递导入。完整清单和可复现调用见 `evidence/review-fix-1/t17-review-files.json`、`t17-review-verify.cjs`、`t17-review-verify.log`。GPU 用例直接调用原生 WebGPU、实际读回纹理，不是 mock 或跳过。
- 验证先修正了两个类型接缝：simulation 声明应从完整程序读取，reverse 属性遵循 true/省略契约；另修正上轮 GPU 生命周期测试落后的参数位置。4 个测试失败先精确修复再合并复验，未降低断言或跳过。渲染层 tsc 初次 4 GiB 堆耗尽，改为 8 GiB 后完整通过，未降低类型检查门槛。
- `npm run check:assistant-capabilities` 通过：结构检查、15 项覆盖测试、31 文件 237 项不变量测试。`npm run check:skill-sync` 通过：5 个技能、25 个共享文件。`node scripts/freeze-rapier-library.ts --check` 通过。
- `npm run gen:licenses -- --strict --force` 通过：1313 个组件、632 份许可文本，新增 Rapier/Wasm 76 条均有全文。生成器仍报告既有 jsonify@0.0.1 缺少全文 1 条；未改严格生成器的既有判据，未将此项称为本轮已修复。
- `npm run electron:bundle` 通过，282.27 秒。随后逐个运行 `npm run test:reality -- --suite ui --only video-edit-direct-author --size 960x720 --out <本轮证据目录>`；`HENJI_DIRECT_AUTHOR_PROBE` 分别指向本轮 author、formal-generator、formal-filter 夹具。均使用隔离资料、随机调试端口，未设置跳过构建新鲜度，不占 9334。
- Electron 44.9.3 / Chrome 152.0.7977.167：离线冻结 Rapier 试画 6 帧乱序，同一时刻 PNG 字节一致。正式生成器与滤镜均 640×360、100 刚体、60 fps、12 帧导出；预览/观察/试画 RGB 对照最大差值 0、像素一致率 100%。生成器导出 PSNR 35.09 dB；滤镜预渲染 37.09 dB，使用预览导出 33.88 dB，均达到既定 30 dB 门槛。滤镜预渲染图已目视核对。以上不代表长时间热播放性能或跨机器确定性已验证。
- 本轮证据归档于 [evidence/review-fix-1](evidence/review-fix-1/)；复现脚本使用本任务仓库 `.tmp` 相对路径，复跑时将对应夹具放回该目录。未安装/删除依赖，未操作 node_modules 联接点，未触碰其他工作区或 D:\视频制作。

### 排查边界与待续

已修复范围包括共享模拟准备器、生成器/附加滤镜源计划、runtime 生命周期、Worker 试画、声明读取与预渲染依赖、作者类型与引擎散列。正式试画和既有生成器零点路径检查后未发现同源漏传；长源入点的正倒放/变速由精确测试及真实 GPU 覆盖。时间重映射的所有非单调组合、跨系统确定性、安装包和共享 L3 未纳入本轮结论。第 3/4/5 条等待 Claude 合并通知，第 14 条等待是否新增冻结修订号的裁定。

## 审查修复 2

实现：第 14 条已修复。按 11-01 裁定直接原地重冻 `0.21.0-henji.1`，未新增 henji.2；上游仍是 `0.21.0`。正式冻结脚本与产物均去掉 `upstream.mjs` 末尾的 sourceMappingURL；init 拒绝后清空 ready 并原样传播错误，命名导出与 default.init 继续共享在途及成功的 Promise。NOTICE 与 release.json 输入／输出摘要同步更新。
审查：一轮独立干净上下文审查，未发现需修复的问题。审查初报的任务分支 push 基准问题，在复核本轮“不 push”和“提交前 main／提交后 HEAD”的明确裁定后撤回；未改动或放松冻结门禁。
验证：指定 L1 验证、渲染层类型检查、严格许可证生成、提交前 main 与提交后默认 HEAD 的 vendor --check 全部通过；作者链路 5 个测试文件共 43 项通过。
提交：`2f61a30583dc813ba19a201c3ead398aab387af6`（`fix(video-edit): 修复冻结 Rapier 初始化失败后的重试`），直接追加在 `49bf790a2b75b189ae2dacf56ab10f82aa15d312` 后；分支 `task/17-模拟运行时`，7 个文件。提交后工作区干净；未 push、未合并 main、未切分支。

### 修复与验证证据

- 新增精确回归 `src/features/videoEdit/authorLibraries/rapier.test.ts`：独立 Node Worker 加载正式冻结模块，对实际 WebAssembly.instantiate 注入一次失败。原实现确实失败；修复后所有首轮调用都收到原错误，下一轮共享新 Promise 并真正初始化 Wasm、创建／推进 World、生成非空快照，成功后仍复用同一 Promise。没有用替代 wrapper 验证自己。
- 从原固定 npm 归档重新提取产物，校验 SHA-512 与原登记来源摘要；上游与原包的唯一差异是删去 sourcemap 指令，Wasm 字节保持不变。2 个发行输入、6 个产物摘要均一致；46 个类型文件与原包逐字一致。7 份持久样本中的 9 处 Rapier pin 都指向同一 henji.1，因此类型清单和引用样本无须改变字节或升版本。
- `npm run verify:changed -- --level L1 <本次 7 个显式文件> --test <作者模拟 GPU／类型检查／模拟调度消费者>` 通过：新重试回归 1 项、模块加载 10 项、模拟调度 14 项、真实 GPU／冻结 Rapier 2 项、作者类型检查 16 项，以及本次两个测试文件的 ESLint。完整命令保存在 `evidence/review-fix-2/verify-l1-final.log`。作者类型检查包含技能中的完整源码示例。
- 上述作者模块测试首次出现两条旧断言失败，原因是写死了“可用库列表以 three 开头”。去掉清单首项限制，继续验证未知模块、越界导入报错与版本 pin；精确重跑通过后执行最终合并验证。没有降低像素／性能阈值，没有跳过失败项。
- 按 `testing.md` 的重试／异步状态 L2 风险追加渲染层 `tsc --noEmit`，使用任务目录的增量缓存及 8 GiB 堆，通过；未改 core／Electron 代码，未运行无关的主进程类型检查、完整构建或 Electron GUI。
- 提交前 `HENJI_PERSISTENCE_RELEASE_REF=main node scripts/freeze-rapier-library.ts --check`：直接执行先发现 main 的 henji-effects 1.1／1.2／1.3 共 12 个已登记冻结文件不在当前旧任务分支；仅在校验时从 main 原样补齐这些文件，正式完整门禁通过后立即逐文件移除临时副本。正式门禁代码、main 引用与本分支登记都未改；未把其他票冻结版本加入本次提交。可复现脚本和日志见 `vendor-main.cjs`／`vendor-main.log`。提交后不设置环境变量的同一命令通过，见 `vendor-head.log`。
- `npm run gen:licenses -- --strict --force` 通过：1313 个组件、632 份许可文本；Rapier／Wasm 的 76 条许可组件均关联生成清单中的全文。生成器仍报告既有 `jsonify@0.0.1` 缺少全文 1 条，严格生成的既有判据未变，此项未称为已修复。
- 证据归档于 [evidence/review-fix-2](evidence/review-fix-2/)。本轮未安装／删除依赖，未操作 node_modules 联接点、9334 开发版、其他工作区或 `D:\视频制作`；未并行运行重任务。

### 排查边界与待续

已修复冻结脚本与实际 Rapier init 共享封装；检查了命名／默认导出、并发失败与重试、成功缓存、正式离线模拟及世界恢复、作者模块解析与真实声明消费者，未发现其他同源缺陷。真实 GPU 与冻结 Rapier 的相关精确链路已验证，本轮没有重复正式 Electron 全套预览／导出或跨系统确定性验收。第 3、4、5 条继续等待 ticket 10 合并通知，本轮未处理。
