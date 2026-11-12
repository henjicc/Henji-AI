摘要：A1 完成。区间音量与末尾的呼吸处理在试听、导出读底声时才乘上，不为它们渲染整条声音，结果与原来逐样本相同。修复等局部处理按“两版声音差在哪些帧”只重算这些帧；编辑后声音文件的样本、波形金字塔、频谱金字塔与细层块都从上一版派生，与整段重算一致（声音文件样本逐值相同，金字塔与频谱逐字节相同）。A2 不做，原因见第 7 节。
验证：cargo test --release（独立 target）35 项全过；electron tsc 通过；渲染层 tsc 只剩别人的 videoEdit 错误；16 个相关 vitest 文件 84 项过 1 项按环境变量跳过；改动文件 eslint 0 问题；check:main-imports 通过；check:dead-code 本任务文件无新增。
注意：主会话验收前要先 `npm run build:audio-worker`（新增 spectral_derive 命令，整段计算会多写第 9 层未量化列），再 `npm run electron:bundle`。主进程启动频谱进程后先 ping 拿能力表，旧可执行文件不报派生能力，主进程直接整段计算、不发派生命令（不会出错，也没有增量）。没有改 .tsx。

## 设计

### 0. 现状与根因
- 编辑后声音 = 原素材 f32 → 修复（逐个）→ 效果链里要整段处理的那一段（逐项）→ 区间音量。每一级都是一份整段文件，键是累计配方哈希。
- 波形金字塔按文件身份寻址、频谱目录按“输入文件名”寻址，所以任何一级换了文件，下游派生物都从零整段重建。
- 修复、口水音本身已是“复制整条 + 只处理局部”（原生 heal/declick），计算量与选区同阶；真正贵的是：区间音量/呼吸整段乘一遍再写一遍、波形整段 FFmpeg 解码、频谱整段 STFT。

### 1. 声音差异（新文件 `audio-edit/sound-diff.ts`，纯函数）
把一版编辑后声音描述成“操作序列”：每处修复、效果链里整段处理那段的每一项、末尾的区间音量层。每个操作声明：
- `local`（频谱修复、强度 1 的去爆音）：只改写区间 W，W 内的结果只取决于 W 两侧固定上下文 R（频谱修复 n+hop=2560 帧，去爆音 8192 帧）；W 外原样复制。
- `clicks`（口水音）：多段 LPC 插值，每段结果取决于两侧 8192 帧内的声音与相邻段位置；超过一批（4096 段）按 `global`。
- `gain`（呼吸、区间音量）：逐样本乘，结果只取决于该帧被哪些区域、按什么顺序覆盖。
- `global`（实时效果整段跑、基本声音离线、人声分离、插件、强度 <1 的去爆音走 FFmpeg amix）：任何上游差异或参数变化都整段。
新旧两版的操作按匹配键对齐（LCS；修复按配方、效果项按 id、区间音量层固定键），顺序走一遍维护“脏帧区间”D：
匹配的 local 若 R∩D≠∅ 则 D∪=W；只在一边的 local/clicks/gain 加上其覆盖区；gain 层按“每段被覆盖的区域序列是否相同”逐段比较；clicks 按变动段与 D 波及的窗口展开；global 遇到 D≠∅ 或参数变化返回“整段”。素材身份、采样率、声道、帧数不同也返回“整段”。
拿不准（超出上限、未知操作、对齐过大）一律返回“整段”并带原因，调用方写日志后整段重算。

### 2. 区间音量与末尾的呼吸改为读取时乘上
- 渲染拆成“底声 + 增益层”：`prepareAudioEditRenderPlan` 只把修复与效果链（去掉末尾连续的呼吸项）落成文件；末尾连续的呼吸项与区间音量作为有序增益层，不写文件。
- 试听（`preview.ts`）：读底声的一秒块后按层原地乘增益（与原来整段乘的同一个函数、同一顺序），立刻能听到。
- 导出（`renderAudioEditProject`）：拼接那一遍读底声时同步乘增益层，结果与原先“先整段乘出文件再拼接”逐样本一致（每帧同样的区域、同样的乘法顺序与单精度舍入）。
- 需要真文件的地方（波形显示用的“编辑后声音”、XML 导出、整段处理任务、口水音检测）调用 `prepareAudioEditRenderSource`：
  - 读作品上一份“编辑后声音”记录（路径、文件戳、操作序列；内存 + 作品缓存目录 `edited-latest.json`），没有时以原素材 f32 为上一版（操作序列为空）；
  - 与当前操作序列求 D；D 不是整段且上一份文件还在、文件戳一致时：复制上一份文件，再由效果工作线程只把 D 内的帧按“底声 × 增益层”重算写回（`gains-patch`）；否则整段乘（原 `gains`）。
  - 结果文件记一条“来历”（见 3），并更新最新记录。
- 区间音量本身的文件格式、作品字段、素材身份都不动。

### 3. 派生物的“来历”（新文件 `audio/lineage.ts`）
- 一条来历 = “浮点 WAV X 与同目录的浮点 WAV Y 除 D 外样本逐值相同”（文件头可以不同，原素材副本由 FFmpeg 写出），连同两者的文件戳（大小、纳秒修改时间、inode），存内存并落在 `X.lineage.json`。任何一方被重建（文件戳变了）来历即失效。
- 首份整段生成的编辑后声音记一条“根”来历，表示它的派生物值得留增量用的中间数据。
- 没有增益层时编辑后声音就是底声文件，同样给它记来历（相对上一份编辑后声音）。
- 查询时沿来历链向上最多 8 跳，合并各跳的 D，直到找到已有派生物的祖先（连续快速编辑时中间几版的派生物可能没生成过）。

### 4. 波形金字塔按块更新（`waveform-worker.ts`、`ops.ts`、`waveformPyramid.ts`）
- 生成算法改为与分块无关：平方和按 64 位逐帧累加，跨解码块保持（原来每块结束时舍入成 32 位，结果随管道分块变化）。格式版本 2→3，旧缓存自动失效重建。
- 有来历的文件整段生成时，另存第 1 级（每桶 1024 帧）的未量化中间值（最小、最大 32 位，平方和 64 位，“HWPF”），与金字塔同一磁盘缓存、同一内存表。
- 请求编辑后声音的金字塔未命中时，先沿来历找祖先的金字塔与中间值：只按 1024 帧对齐读 D 内的采样（直接读浮点 WAV，不起 FFmpeg），重算这些桶的第 0、1 级；第 1 级以上由中间值整体重聚合（每小时几十万次加法）。结果与整段生成逐字节一致，中间值也一致，可继续往下派生。
- 退回整段生成的情况（写 `audio.waveform.pyramid.derive_skipped` 带原因）：量化比例（全段峰值超过满幅且变了）不同；超过 2 声道、不从 0 秒开始、不是浮点 WAV；与上一版规格不同；改动超过一半。

### 5. 频谱按列更新（原生 `pyramid/`、`spectral_server.rs`、`spectral-pyramid.ts`）
- 整段生成时另写第 9 层（每列 512 个基础列，48 kHz 约 5.5 秒）的未量化列（峰值 f32、能量和 f64）`sums-level-9.bin`；续算按同一对齐点截断，旧目录没有它就不当派生来源（只读仍可用）。
- 新命令 `spectral_derive`：复制祖先目录 → 按 D 求受影响的基础列（8192 点长窗的上下文 ±4096 帧）→ 所在第 9 层组整组重算第 3–9 层（与整段同一个 `fft::columns` 与两两合并顺序）→ 第 10–15 层只重算受影响的列，由第 9 层未量化列按原合并树重合并 → 最后原子发布完成清单。全部文件（含中间文件）与整段计算逐字节一致。
- `spectral-pyramid.ts`：编辑后模式找不到完成指针、也没有可续算的目录时，沿来历找已完成的祖先目录（编辑后键或原素材键）派生；改动散布到一半以上的第 9 层组时直接整段（派生要先复制目录，不划算）；派生失败写日志后在同一目录整段计算。
- 细层块（第 -5 到 2 层，按需即时算）：块用到的声音（列中心 ± 半个最长分析窗）与祖先完全相同，就直接读祖先已算好的块。

### 6. 日志（都带“本次重算多少帧 / 素材总帧数 / 耗时”）
- 新增 `audio_edit.render.edited.completed`（info）：编辑后声音落盘，带 mode（incremental/full）、recomputedFrames、changedFrames、durationFrames、sampleRate、gainLayers、elapsedMs，退回整段时带 fallbackReason。
- `audio.waveform.pyramid.completed`：增加 derived、recomputedFrames、hops；有来历的文件改为 info（其余仍 debug）。新增 `audio.waveform.pyramid.derive_skipped`。
- `audio_edit.spectral.start` 增加 derived；`audio_edit.spectral.completed` 增加 derived、recomputedFrames、hops。新增 `audio_edit.spectral.derive_fallback`（warn）。
- `audio_edit.render.completed`（导出）、`audio_edit.preview.source.completed`、`audio_edit.preview.chunk.*` 增加 gainLayers。

### 7. A2（人声分离 / 去混响）不做
- 输入先经 FFmpeg 整段重采样到 44.1 kHz，输出再整段流式重采样回原采样率；两次重采样的滤波状态贯穿全段，只重算局部窗口拿不到与整段相同的输入/输出相位。
- 推理默认走 DirectML，GPU 归约顺序不固定，两次整段推理本身就不逐样本相同（实测与 CPU 相对误差约 3e-6），中途还可能逐块退回 CPU。“与整段逐样本一致”没有可比的基准，按规则不做；上游有改动时分离整段重跑（缓存预算 W1-D 已放开）。

### 8. 不变的东西
作品文件格式、素材身份字段、`splice.ts`、擦洗算法路径都不动；试听取到的样本值与原来逐样本相同。新增的 `edited-latest.json`、`*.lineage.json`、`HWPF`、`sums-level-9.bin` 都是可重建缓存，丢了只失去一次增量。

## 哪些操作已增量、哪些仍整段

| 操作 | 编辑后声音文件 | 试听 / 导出 | 波形 | 频谱 |
|---|---|---|---|---|
| 区间音量（加、删、改、淡入淡出） | 复制上一版 + 只重算改动的区域 | 读底声时乘，不等渲染 | 按块派生 | 按组派生 |
| 末尾的呼吸处理（检测结果、减弱量、开关） | 同上 | 同上 | 同上 | 同上 |
| 频谱修复、强度 1 的去爆音 | 修复阶段照旧（原生本来就是“复制 + 局部”）；编辑后声音只重算选区 | 底声换成新修复阶段的文件 | 按块派生 | 按组派生 |
| 口水音（逐处开关、重新检测） | 阶段照旧；下游按变动段 ± 8192 帧波及的段重算 | 同上 | 按块派生 | 按组派生 |
| 呼吸项后面还有整段处理的效果 | 呼吸那一级仍整段乘（它是中间阶段，必须落文件） | — | 若下游全是局部操作仍按块派生 | 同左 |

仍整段（diff 返回“整段”并写原因）：
- 实时效果在“整段处理的那段链”里被整段跑（均衡、压缩等有状态滤波，状态一路传到结尾）、基本声音的离线阶段、人声分离 / 去混响、第三方插件：自身参数变化或上游任何改动都整段。
- 部分强度（<1）的去爆音：走 FFmpeg amix 整段混合，单精度混合在选区外也可能改动最低位，且局部重跑 amix 不能保证与整段相同。
- 口水音超过 4096 段：原生进程分批接力，后一批读前一批输出。
- 改动超过一半：整段更快。
- 波形：全段峰值超过满幅且变了（定点比例变了）；超过 2 声道的素材。
- 导出拼接这一遍本身总是整段（它就是成品）。

## 实现

| 文件 | 改动 |
|---|---|
| `audio-edit/sound-diff.ts`（新） | 操作序列、LCS 对齐、脏帧计算、增益层排序；修复上下文常量与原生一致 |
| `audio-edit/gain-layers.ts`（新） | 增益层逐层乘（试听、导出、按块重算共用） |
| `audio-edit/render.ts` | 拆成“底声 + 增益层”的计划；`prepareAudioEditRenderPlan`（试听、导出用）与 `prepareAudioEditRenderSource`（要文件的地方用，按上一版增量落盘）；导出拼接时乘增益层；最新记录与来历 |
| `audio-edit/pcm-jobs.ts`、`pcm-wav.ts` | `gains` 改为多层；新增 `gains-patch`（原位改写指定帧）；拼接读取经过增益层；`openF32WavForPatch` |
| `audio-edit/preview.ts` | 取块读底声后乘增益层 |
| `audio-edit/dsp-adapter.ts` | 口水音范围合并抽成 `audioEditMouthDeclickRanges`，渲染与 diff 共用 |
| `audio-edit/spectral-pyramid.ts` | 派生调度、组数阈值、细层块沿用祖先、日志 |
| `audio/lineage.ts`（新） | 来历记录与沿链查找 |
| `audio/waveform-worker.ts`、`types.ts`、`worker-client.ts` | 生成与分块无关（64 位平方和）；第 1 级摘要；`deriveWaveformPyramid` |
| `audio/ops.ts` | 摘要缓存、按来历派生、日志；W1-D 留下的一条注释换了说法（被命名检查当成“任务 2”编号） |
| `src/core/media/waveformPyramid.ts` | 格式版本 3；HWPF 摘要编解码 |
| `native/audio-worker/src/pyramid/mod.rs`、`spectral_server.rs` | 第 9 层未量化列（随整段计算写出、续算对齐）；`derive` 与 `spectral_derive` 命令；清单写出抽成函数 |
| 测试 | `sound-diff.test.ts`、`render.incremental.test.ts`（新）；`render.test.ts`、`renderIdentity.test.ts`、`preview.test.ts`、`effects-worker-client.test.ts`、`spectral-pyramid.test.ts`、`waveform-worker.test.ts`、`ops.pyramid.test.ts`；原生 `pyramid/tests.rs`、`dsp/tests.rs` |

## 证据（完成标准逐条）
- (a) 重算规模与改动同阶：
  - 两分钟素材加 2 秒区间音量，工作线程只改写 96000 帧；再加 0.1 秒只改写 4800 帧（全长 576 万帧）。加修复时只改写选区的 9600 帧（`render.incremental.test.ts`）。
  - 波形派生读的帧段不到全长 1%（`waveform-worker.test.ts`）；派生时不起 FFmpeg（`ops.pyramid.test.ts`）。
  - 频谱：约 64 秒、5997 个基础列的素材，两处改动只重算 877 列（一个整组 + 末尾不满的一组）（`derived_pyramid_matches_full_build_byte_for_byte`）。
- (b) 与整段重算一致：
  - 编辑后声音文件与整段乘一遍样本逐值相同（首次、追加、修复后；以 FFmpeg 样式文件头的原素材副本为底、改动落在第 0 帧与末帧）。原素材副本与整段输出文件头相同时整个文件逐字节相同。
  - 波形金字塔与 HWPF 摘要与整段生成逐字节相同，含尾部缺帧；服务层派生结果与整段解码逐值相同。
  - 频谱目录全部文件（各层、未量化列、清单）与整段计算逐字节相同。
  - 原生测试证明修复只读声明的上下文：改动紧贴频谱修复 ±2560、去爆音 ±8192 之外时选区结果不变，落进范围就变。
- (c) 导出与改动前一致：含末尾呼吸 + 三段区间音量 + 两处剪切的成品，与原流程“呼吸整段乘 → 区间音量整段乘 → 拼接”逐字节相同；试听取块与整段乘好的文件逐样本相同（`preview.test.ts`）。

## 验证
- `cargo test --release --target-dir <scratchpad>`：33 + 2 项通过，1 项基准按设计忽略。
- `npx tsc -p tsconfig.electron.json --noEmit`：只有别人的 `services/video/*` 错误。
- `node --max-old-space-size=12288 node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`：只有别人的 `videoEdit` 错误。
- vitest（经 heavy.sh）：audio-edit 的 sound-diff、render、render.incremental、renderIdentity、preview、effects-worker-client、pcm-wav、dsp-adapter、spectral-pyramid、export、render.performance（环境变量跳过）；audio 的 waveform-worker、ops.pyramid、ops；渲染层 waveformDataService、useAudioEditSpectral。共 84 过 1 跳过。
- 23 个改动的 TS 文件 eslint 0 问题；`check:main-imports` 通过；`check:dead-code` 本任务文件没有新增未使用导出或命名残留。
- 没有改 `.tsx`，未跑 check:surface。

## 偏离
- `AudioWaveWorkspace.tsx`、`useAudioEditSpectral.ts` 没改：渲染层照旧取“编辑后声音”文件路径和频谱块，增量全在主进程与原生里，界面数据来源不用动。
- 编辑后声音（给波形用）仍是一份完整文件，靠“复制上一版 + 改写改动帧”生成：`audioEdit:editedSource` 的契约是返回文件路径，不在本任务所有权内。一小时立体声每次编辑仍复制约 1.38 GB（不计算，只搬运）；频谱派生也要先复制上一版目录（约 0.4 GB/小时）。要彻底去掉复制需要“分层文件”式的存储，改动读写双方，留给后续。
- 波形格式版本升到 3，所有已缓存的波形会重建一次；W3-A 之前算好的频谱目录没有第 9 层未量化列，第一次编辑时从它派生会失败并退回整段，之后的编辑才增量。

## 遗留
- 原有问题（不是本次引入）：`electron/main/services/video*` 与 `src/features/videoEdit/*` 的 tsc 错误属于别的执行者。
- 打开一份从没编辑过的作品后第一次改动：波形没有可派生的上一版（原素材波形读的是原文件，不是浮点副本），这一次整段生成；频谱可从原素材频谱派生。

## 需主会话用真实一小时素材验证
1. `npm run build:audio-worker`，再 `npm run electron:bundle`（或开发版热更新后重启主进程）。
2. 打开一小时口播，先做任意一处声音改动并等波形、频谱出来（建立上一版；若是第一次改动，日志里 `audio_edit.render.edited.completed` 可能是 incremental（从原素材副本复制）而波形是整段）。
3. 选 2 秒加一个 -6 dB 区间音量：
   - `npm run logs:query -- --event audio_edit.render.edited.completed`：mode=incremental，recomputedFrames≈96000，elapsedMs 主要是复制时间（NVMe 约 1 秒级）。
   - `--event audio.waveform.pyramid.completed`：derived=true，recomputedFrames 约 2 秒（对齐到 1024 帧），elapsedMs 应在百毫秒级。
   - `--event audio_edit.spectral.completed`：derived=true，recomputedFrames 约 5.5–11 秒，elapsedMs 应远小于改动前整段计算（可对比改动前同素材的 `audio_edit.spectral.completed`）。
   - 松手后立刻播放：`audio_edit.preview.source.completed` 的 gainLayers=1、elapsedMs 小，不等渲染。
4. 用修复画笔修一处、对一处去爆音：同上三条事件，recomputedFrames 与选区同阶。
5. 关掉软件重开，再改一处区间音量：仍应 incremental（读的是缓存目录里的 `edited-latest.json`）。
6. 查有没有意外退回：`--event audio.waveform.pyramid.derive_skipped`、`--event audio_edit.spectral.derive_fallback`，以及 edited.completed 的 fallbackReason。
7. 拖动播放头试听：听感与改前一致（取到的样本值逐样本相同）。导出 WAV 与改动前版本导出的同一作品比对应逐字节相同（成品由同一个写出函数生成，文件头一致）。

## 审查返工（第 1 轮，7 条小问题）
1. 旧原生程序的退回：
   - 频谱进程的 ping 回报能力表 `capabilities.spectralDerive.groupLevel`（即 SIDECAR_LEVEL）。
   - `SpectralWorkerClient.capabilities()` 每个进程问一次；不报派生能力时 `spectral-pyramid.ts` 直接整段计算，不发派生命令。
   - 原生两种入口（频谱常驻进程、单次命令）遇到认不出的命令，都带原请求 ID 回错误，不再只能等无进展超时。
   - 测试：协议集成测试核对能力表和未知命令按原 ID 回执；客户端测试核对每个进程只问一次、旧程序按不支持处理；频谱服务测试核对不支持时不发派生命令。
2. 上一版记录兜底：
   - `diffAudioEditSound` 的两处分派都加了默认分支，认不出的操作一律整段。
   - `edited-latest.json` 先过 `audioEditSoundDescriptionSchema` 的结构校验，无法解析或结构不合法时整段，并写 fallbackReason。
   - 匹配到的局部操作取两版里较宽的上下文；改写区间不同也按两边都变处理。
   - 补了 diff 测试与渲染测试（坏记录整段并写原因）。
3. 常量单一来源：
   - 修复相关常量收进 `dsp-adapter.ts` 的 `AUDIO_WORKER_CONTRACT`，渲染、diff、批大小、掩码尺寸、fft_size 都引用它。
   - 原生 `heal.rs` 新增同名的 HEAL_HOP_DIVISOR、DECLICK_* 常量并在代码里使用，两边注释互相指向；`dsp-adapter.test.ts` 读 heal.rs 源码断言取值一致；原生测试由这些常量算出上下文边界。
   - 频谱派生的组大小从 ping 报的层级算（spectralHop），半窗用 spectralResolution(0)；原生 derive 的 4096 改为 resolution(0).low_window / 2。
4. 波形派生出错兜底：读缓存或读 WAV 抛错时记 `audio.waveform.pyramid.derive_skipped`（reason=error），整段解码；取消照常抛出。
5. 来历先于发布：
   - 增益层文件在临时文件校验后、改名前写来历（`recordAudioLineage(..., { stampFrom: temporary })`；改名不改文件戳）。
   - 没有增益层时，在把底声文件交给调用方之前写好来历。
6. 说法改为“样本逐值一致”（来历注释与本文）。新增测试：原素材副本用 FFmpeg 样式文件头（JUNK、18 字节 fmt、fact、LIST），改动落在第 0 帧与末帧，只改写 9600 帧，样本与整段乘一遍逐值相同。
7. 措辞与重复实现：
   - 注释里相对旧版本的说法都改掉了。
   - 文件戳与原子写记录合并到 `lineage.ts` 的 `audioFileStamp`、`writeAudioCacheRecord`，`render.ts` 不再自带一套。
   - 来历记录的文件戳改为字符串形式（可重建缓存，旧记录读不懂就当没有）。
- 测试缺口：第 0 帧与末帧的改动已覆盖到编辑后声音、波形派生、原生频谱派生（重算列数断言改为三组）；跨两代的来历派生在频谱服务测试里覆盖（中间一版没算过频谱，hops=2、两代改动合并）。

返工验证：
- `cargo test --release`（独立 target 目录）33 + 2 项通过，无编译警告。
- 两套 tsc：只剩别人的 video / videoEdit 错误。
- 17 个相关 vitest 文件：95 过、1 跳过（性能用例按环境变量跳过）。
- 26 个改动的 TS 文件 eslint 0 问题；`check:dead-code` 本任务文件没有新增问题。
