摘要：B1 B4 完成（含审查返工，见文末；与正文不一致处以返工一节为准）。外部素材身份为“大小 + 修改时间 + 采样指纹”，缓存键总连同大小与修改时间；应用写出的拼接结果带写出时顺带算的整文件 SHA（document.audio_edit 7→8，带整文件 SHA 的旧作品原样可读、派生缓存键不变）；打开、拼接、转写、导出不再整文件哈希。补录拼接一遍写出、不再探测，波形、频谱、编辑后声音沿来历只重算拼接点之后（末尾追加与等长替换只算录音段）。导入只读文件头；转浮点副本放后台任务并显示进度，PCM/FLAC 期间从原素材按块解码（与副本逐样本相同），压缩音频等副本。
验证：cargo test --release（独立 target）34+2 过 1 忽略、无警告；两套 tsc 0 错；22 个 vitest 文件 129 项全过（含真实 FFmpeg）；改动文件 eslint 0；check:persistence-compat、check:main-imports、check:dependency-graph 通过，check:dead-code 本任务文件无问题。
注意：验收前要 `npm run build:audio-worker`（频谱派生新增“长度可变”，能力表报 lengthChange；旧可执行文件不报，主进程对长度变了的上一版直接整段，不出错）与 `npm run electron:bundle`。没有改 .tsx。

## 设计

### 0. 现状（已核实）
- 身份 `source.identity = { size, mtimeMs, digest }`，digest 是整文件 SHA-256。`verifyAudioEditSource` 默认 deep，每次整文件哈希：打开编辑器（`audioEdit:source:verify`）、拼接、转写开头与收尾、导出（两次）、停顿分析（多次）都走。`identity` 缺失时渲染、频谱、f32 缓存各自现算整文件 SHA（频谱每取一块算一次）。
- 拼接：deep 校验 → FFmpeg 三段解码写盘 → concat 再整段复制 → `probeAudioEditSource`（`-show_frames` 整段解码 + 整文件 SHA）；之后 f32、波形、频谱、编辑后声音全部从零。录音响度匹配还从头解码整条结果去量录音那一段。
- 导入：头 → `-show_frames` 整段解码计帧 → 视频逐包整段扫描 → 整文件 SHA，四遍串行；文档建好后第一次试听还要等整条转 f32。
- W3-A 的来历只表达“同目录、同长度，除 dirty 外样本相同”；频谱缓存键按作品身份算，换了素材找不到上一版目录。

### 1. 素材指纹（选型）
参考：Premiere / DaVinci Resolve 的媒体缓存与重新链接只看路径、大小、修改时间与媒体元数据，不哈希内容；OpenSubtitles 哈希（Kodi、Plex、VLC 用）与 imohash 用“大小 + 头尾（与中间）定长采样”，读量与文件大小无关；rsync、Git 的快速判断是大小 + 修改时间。内容哈希的耗时在 I/O 不在算法（Node 的 SHA-256 有 SHA 指令，单线程约 2 GB/s，换 BLAKE3/xxh3 省不下读盘），要快只能少读。

`henji-audio-fingerprint-v1`：SHA-256（版本标签、大小 u64、各块偏移与字节）。16 MiB 以内整文件；更大的读头 256 KiB、尾 256 KiB 与 33 个以 (i+0.5)/33 处为中心的 64 KiB 块（含正中间），约 2.6 MiB、35 次并发读，SSD 毫秒级，机械盘约 0.3 秒。
- 截断、追加：大小变了必然不同；换成另一段录音：容器头尾（mp4 的 moov）与分散的采样块几乎必然不同。
- 局限：同大小、只改了未采样位置（例如在 Audition 对几秒降噪后原样保存）指纹不变。修改时间会变，所以：派生缓存键在大小或修改时间与记录不同时换键（`audioEditSourceContentKey`），改过的文件一定重建 f32、频谱等派生物；作品照常打开（与 Premiere 一致）。只有大小、修改时间都被刻意还原且改在未采样处才认不出。

校验分两档（`verifyAudioEditSource(project, signal, depth)`）：
- quick（取块、渲染、频谱、f32）：大小与修改时间一致即通过，不一致才比内容。
- deep（打开、拼接、转写、导出、停顿分析）：带指纹的素材总比指纹；只有整文件摘要的素材整文件比对太贵，大小与修改时间一致就不读，不一致才整文件比对。
- 与原来的差别：带整文件摘要的旧作品，“同大小、修改时间被还原的替换”不再被打开时的校验认出（原来每次打开整文件哈希才认得出）。这是去掉打开时整文件哈希的代价；修改时间没还原的替换照样认出。

### 2. 持久格式（document.audio_edit 7 → 8）
- `source` 新增可选 `fingerprint: { size, mtimeMs, digest }`；`identity` 保留原义与读法。新导入、拼接结果、重新定位只写 `fingerprint`；带 `identity` 的作品重新定位时（已为比对算过整文件 SHA）两者都写，并保留原帧数，已有缓存继续命中。
- 最低可读版本提到 8：工具按严格结构（`audioEditProjectSchema`）解析 `source`，v7 程序遇到 `source.fingerprint` 会解析失败而不是忽略，不满足“旧程序忽略它也不会误解其余内容”。提高后 v7 程序报“由更新版本创建，请升级”，不会报内容无效。放在顶层（v7 会当未知字段原样带回）要在两处存同一份素材事实、还得处理旧程序换素材后的过期指纹，不取。
- 迁移 7→8 原样复制。带 `identity` 的作品所有派生缓存键按原公式（f32 `audio-f32-<digest>`、渲染 `audio-render-v1`、编辑后声音来源键、频谱键里的 identity 对象、声音证据、转写回执 sourceDigest）。既无 identity 也无 fingerprint 的极早期作品，内容键从现算整文件 SHA 改为现算指纹（按文件与修改时间记住），这类作品的派生缓存会重建一次。
- 黄金样本 v8：用正式迁移把 v7 升到 8，再加正式 `fingerprintAudioEditSource` 算出的指纹，`buildDocumentEnvelope` 生成（`scripts/generate-persistence-fixtures.ts` 的写出函数已在 1921fa0da 被删，用一次性测试脚本按同一流程生成后删掉脚本）。已跑 `persistence:baseline` 与 `persistence:release-snapshot`，两份 JSON 只改了 audio_edit 一项。

### 3. 导入与打开（B4）
- 探测只读文件头；帧数在容器给出精确值时直接用：PCM 各容器、FLAC，以及时间基等于采样率的 mov/mp4/m4a（真实 FFmpeg 测试核对与逐帧解码计数相同）；mp3、ogg 等可能按码率估算的仍解码计数。视频时间戳抽查开头、正中、结尾各 10 秒（60 秒以内整段），指纹、帧数、视频三路并行。WAV、MP4 导入不再整文件扫描。
- XML 导出联动画面前再整段逐包核对一次（按素材内容键记住结果），保持原来的精确判断。
- 浮点副本转码登记为作品的 `prepare` 只读任务：界面已有的“正在处理 x%”与取消直接显示（数据来源是任务表，没改界面）。转码按 `asetpts=N/SR/TB,atrim,apad` 对齐到文档帧数，副本记来历的根（它的波形会留增量摘要）。
- 副本转好之前，原声模式与“还没有声音处理”的编辑后模式从原素材按块解码：往前预卷 1 秒、`-copyts -noaccurate_seek`、按样本时间戳 `atrim=start_pts/end_pts` 裁剪。只对 PCM 各容器与 FLAC 开（见文末返工第 4 条）；`atrim` 的 start_sample 是从收到的第一个样本起数（排查中发现），必须用 start_pts。副本一好，下一块起直接读副本。

### 4. 补录拼接（B1）
- 校验原素材走 deep（指纹几 MB 或大小+修改时间）。
- 写出：原素材的浮点 PCM（自管素材本身，外部素材用 f32 副本）按字节原样复制 [0, start) 与 [end, N)，中间是 FFmpeg 解码的录音（`aresample,asetpts=N/SR/TB,atrim,apad` 裁到 inserted 帧，修正起点非 0 的录音按时间戳裁剪的偏差），在效果工作线程里一遍写出（新 `concat` 任务）。帧数是已知量，读回文件头核对；指纹只读采样块。唯一的子进程是解码录音。
- 录音响度匹配量解码好的录音本身（与结果这一段逐样本相同），不再从头解码整条结果；复用已发布结果（崩溃恢复）时才量结果里的那一段。
- 来历：拼接结果记“与原 f32 在 [0, start) 相同”（长度变了 dirty = [start, 新长度)；等长替换 dirty = [start, start+inserted)，后段原位相同）。录音目录里的文件不往旁边写记录，记到缓存根下 `audio-lineage-v1/`（按规范化路径哈希命名，父文件存绝对路径）。另在作品缓存目录记“声音来源拼接”（旧声音身份 → 新声音身份、start/end/inserted，`source-splices.json`）。

### 5. 派生物
- 来历（`audio/lineage.ts`）：父子长度可以不同，记录校验“从较短长度起的尾部整段在 dirty 里”；多代合并仍是并集，裁到子文件长度；`accept` 多给祖先长度。f32 副本与自管素材记根，波形会留第 1 级摘要。
- 波形：`WaveformPyramidDerivation` 逐块交进重算段（每次读 2^20 帧，内存与重算总长无关），父金字塔长度可不同：对齐到 1024 帧，较短长度所在的桶之前原样复制，之后重算，上级由摘要整体重合并。
- 频谱（原生 `pyramid::derive`）：上一版长度不同时，从“较短长度往前半个长窗”所在的第 9 层组起到新结尾整段重算，各层文件只复制这一组之前的列，第 10 层以上由第 9 层未量化列按原合并树重合并。能力表报 `lengthChange`。主进程算完或读到已完成目录时记“输入文件 → 频谱键”索引，按来历找祖先不再依赖作品身份；原素材模式与编辑后模式都能派生，细层块也能跨拼接沿用（窗口碰到 dirty 或伸过较短长度的不沿用）。
- 编辑后声音（`render.ts`、`sound-diff.ts`）：上一版记录的声音身份与当前不同时，沿拼接记录把上一版操作序列映射到新坐标（拼接点之前原样；被替换段之后增益区、口水音段平移，修复在平移量为 0 时保留；跨过拼接点的两截与插入段作为来源处的不同帧），再与当前比较。长度不变：复制上一版、只改写不同的帧。长度变了：整段乘增益层（读写量与复制上一版相同），来历记“拼接点之前除比较出的不同外与上一版相同”。整段处理的效果上游一变照旧整段。

### 6. 为什么拼接点之后不平移复用
波形桶（128/1024 帧）和频谱列（基础列中心在 512 的整数倍，持久层至少 4096 帧一列，增量中间值存在第 9 层每列 26 万帧）都在固定网格上；插入长度不是网格整数倍时，平移后每个桶/列覆盖的样本都与旧的不同，只能重算。要平移复用只有两条路：把录音裁成网格整数倍（改了用户的录音），或让缓存不再等于“整段从头重算的结果”（以后的派生累积误差）。两条都不取。所以末尾追加（录音最常见的接法）与等长替换的重算量与录音段同阶；中间插入且长度变了，拼接点之前复用，之后重算（波形直接读浮点 WAV，频谱只算后半段；后半段超过一半时整段更快，直接整段）。样本级的东西（拼接写出、编辑后声音）不受网格限制。

### 7. 日志
- `audio_edit.source.probe.completed`：bytes、durationFrames、durationSeconds、framesFrom（container/decode）、headerMs、framesMs、videoMs、fingerprintMs、elapsedMs。
- `audio_edit.source.fingerprint.completed`（debug）：bytes、readBytes、mode（whole/sampled）、elapsedMs。
- `audio_edit.prepare.start/completed/failed/cancelled`（任务通用）+ `audio_edit.source.transcode.completed`：durationFrames、durationSeconds、bytes、elapsedMs。
- `audio_edit.source.splice.completed`：mode（new/splice）、startFrame、endFrame、insertedFrames、sourceFrames、durationFrames、durationSeconds、bytes、verifyMs、takeMs、writeMs、fingerprintMs、elapsedMs。
- `audio_edit.source.video_timing.completed`：stable、durationSeconds、elapsedMs（XML 导出前的整段核对）。
- `audio_edit.preview.chunk.*` 增加 fallback（转码完成前从原素材解码）。

## 实现

| 文件 | 改动 |
|---|---|
| `src/core/audioEdit/types.ts`、`schema.ts` | `AudioEditSourceFingerprint`；`source.fingerprint` 可选 |
| `src/core/documents/kinds/audioEdit.ts` | 版本 8、最低可读 8、迁移 7→8 |
| `src/core/persistence/schemaBaseline.json`、`releasedCompatibility.json`、`tests/fixtures/persistence/document.audio_edit/v8.json` | 登记与黄金样本 |
| `audio-edit/source-identity.ts`（新） | 采样指纹、整文件摘要、内容键、回执摘要 |
| `audio-edit/media.ts` | 两档校验；探测并行、容器帧数、视频抽查；后台 `prepare` 转码与对齐；重新定位；XML 前整段视频核对 |
| `audio-edit/splice.ts` | 一遍写出、读头核对、指纹、来历、拼接记录、量录音本身 |
| `audio-edit/source-splices.ts`（新） | 声音来源拼接记录 |
| `audio-edit/pcm-jobs.ts` | `concat` 任务 |
| `audio-edit/preview.ts` | 转码前从原素材按块解码 |
| `audio-edit/render.ts`、`sound-diff.ts` | 内容键；跨拼接映射与比较；来历带父长度 |
| `audio-edit/spectral-pyramid.ts`、`spectral-worker-client.ts` | 内容键；文件→频谱键索引；两种模式派生；lengthChange 能力 |
| `audio-edit/asr.ts`、`export.ts`、`silence.ts`、`speech-energy-service.ts` | 校验签名、回执摘要、任务键带指纹；XML 前整段视频核对 |
| `audio/lineage.ts` | 长度可变、集中存放、根记录 |
| `audio/waveform-worker.ts`、`ops.ts` | 逐块派生类、长度可变、分块读 |
| 原生 `pyramid/mod.rs`、`spectral_server.rs` | 长度可变的派生；能力表 |
| 测试 | 新 `source-identity.test.ts`、`media.ffmpeg.test.ts`；改 `media`、`splice`、`preview`、`sound-diff`、`render`、`render.incremental`、`spectral-pyramid`、`export`、`waveform-worker`、`documentContent` 测试；原生 `pyramid/tests.rs`、`tests/protocol.rs` |

## 证据（完成标准逐条）
- (a) `documentContent.test.ts`：v1–v7 样本升到 8 与升到 7 的内容逐字段相同、原件不被改；按工具结构打开后作品（素材、文字稿、剪辑、区域、效果）与升到 7 时完全相同，不多出指纹；v8 读回指纹；只认识 7 的程序读 v8 报 newer-version。旧缓存键：`renderIdentity.test.ts` 照旧按 `identity.digest` 算渲染键并通过；`source-identity.test.ts` 核对带 identity 的作品内容键就是原摘要。
- (b) `source-identity.test.ts`：24 MiB 文件两次指纹相同，复制并改修改时间后摘要相同；截断 1 字节、尾部追加、正中间改 1 字节、换成同长度另一段内容都不同；16 MiB 以内任一字节改动都不同。校验：只改修改时间照常通过但内容键换掉；同大小、修改时间改回去的替换，quick 不读内容、deep 比指纹认出；带整文件摘要的作品修改时间变了整文件比对认出。
- (c) 重算规模与一致：
  - 拼接写出（`splice.test.ts`）：等长替换、中间插入、末尾追加三种，结果样本与“前段 + 录音 + 后段”逐字节相同；唯一的子进程是解码录音；来历 dirty 分别为录音段 / 拼接点到结尾。
  - 频谱（原生 `derived_pyramid_across_splice_matches_full_build_byte_for_byte`，约 64 秒立体声）：末尾追加、中间插入、替换成更短一段三种，派生目录全部文件与整段计算逐字节相同；末尾追加 20 万帧只重算 756 个基础列（全长 6388），其中录音约 391 列、拼接点所在组其余部分。
  - 频谱调度（`spectral-pyramid.test.ts`）：原素材模式换了素材身份后经索引找到上一版目录发派生命令，dirty 为 [拼接点, 新结尾)；可执行文件不报 lengthChange 时整段。
  - 波形（`waveform-worker.test.ts`）：末尾追加、中间插入、中间替换成不同长度，分块交进重算段，金字塔与摘要都与整段生成逐字节相同；末尾追加重算帧数小于录音长度 + 1024；长度变了而没盖住尾部时拒绝派生。
  - 编辑后声音（`render.incremental.test.ts`）：中间插入 3 秒 + 录音增益区，整段乘一遍、结果与整段乘逐字节相同，来历记 {父=上一版, 父长度, dirty=[拼接点, 结尾)}；随后等长替换 2 秒，只派出 `gains-patch` 96000 帧，结果逐字节相同，来历 dirty 只有这 2 秒。`sound-diff.test.ts` 核对映射：跨拼接点的音量区两截、平移了位置的修复算不同，等长替换只有被替换段不同，整段效果遇上游改动整段。
- (d) 可开始播放：`media.test.ts` WAV 导入只起一次 ffprobe（读头），帧数取自容器、不整段解码、无整文件哈希；长 mp4 不起 `-show_frames`，视频包只读三个 10 秒窗口；窗口里缺一帧判为不稳定；mp3 仍解码计数且探测可取消。`preview.test.ts` 副本还在转时块由原素材解码（参数含预卷、`-copyts`、`atrim=start_pts`），副本好了直接读。`media.ffmpeg.test.ts`（真实 FFmpeg，噪声信号、mp4 每秒一个关键帧保证定位落在中间）：mp4/AAC、WAV、FLAC、mp3 的探测帧数与逐帧解码计数相同；副本转好之前解出的三块（开头、2 秒多、结尾前）与副本逐字节相同。

## 验证
- `cargo test --release --target-dir <scratchpad>`：34 + 2 项通过，1 项基准按设计忽略，无编译警告。
- `npx tsc -p tsconfig.electron.json --noEmit`：0 错。
- `node --max-old-space-size=12288 node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`：0 错。
- vitest（经 heavy.sh）22 个文件 129 项全过：audio-edit 的 source-identity、media、media.ffmpeg、splice、preview、sound-diff、render、render.incremental、renderIdentity、spectral-pyramid、export、asr、silence、effects-worker-client、pcm-wav、spectral-worker-client、speech-energy-service；audio 的 waveform-worker、ops、ops.pyramid；core 的 documentContent、splice；另跑 persistence.test、forwardCompat.test、mergedEffectsMigration、effects、regions（491 + 20 项过）。
- `npm run check:persistence-compat` 通过（66 种格式）；`check:main-imports`、`check:dependency-graph` 通过；`check:dead-code` 本任务文件无问题（一处“legacy”命名已改为 `digestWholeAudioEditSource`）。
- 改动的 32 个 TS 文件 eslint 0 问题。没有改 .tsx，未跑 check:surface。

## 偏离
- 越过所有权改了 `src/core/documents/kinds/audioEdit.ts`（格式版本与迁移登记就在这里）与 `src/core/audioEdit/documentContent.test.ts`（格式测试）。
- 最低可读版本提到 8（理由见设计 2），不是“只新增可选字段、最低可读版本不变”。
- 带整文件摘要的旧作品，打开时的 deep 校验在大小与修改时间一致时不再读内容（设计 1 末尾）。
- 中间插入且长度变了，拼接点之后的波形、频谱重算（设计 6）；“与拼接段同阶”只对末尾追加与等长替换成立。
- 视频时间戳导入时改为抽查，精确判断挪到 XML 导出前。
- 转码前从原素材按块解码只对 WAV / W64 / AIFF / CAF 里的 PCM 与 FLAC 文件开（按每份素材 ffprobe 查到的编码与容器判断，能证明逐样本相同）；mp4/mov、mp3 等压缩音频等转码完成再播。
- 进度显示复用任务表：取消“正在处理”的准备任务后，下一次取块会重新开始转码。

## 仍整文件处理及原因
- 拼接写出本身：素材是单个文件，拼接点之后的字节必须平移重写（APFS/ReFS 克隆可让前段零拷贝，没做，见遗留）。
- 外部素材整条转浮点副本：所有 DSP、频谱、试听直接读的前提；已放后台、不挡播放。
- mp3、ogg 等容器帧数不精确的格式，导入时仍解码计数（与指纹、视频抽查并行）。
- XML 导出联动视频前整段读一遍视频包时间戳（每份素材每次运行一次）。
- 声音证据（speech-energy）：阈值是全段电平分布的百分位，分析经 16 kHz 重采样，局部重算拿不到与整段相同的结果。
- 编辑后声音在长度变了时整段乘增益层（读写量与“复制上一版”相同，只差乘法）；有修复时修复阶段文件照旧整条复制 + 局部处理（W3-A 的做法），素材换了后各阶段重建。
- 带整文件摘要的作品在大小或修改时间对不上时整文件比对；重新定位它们时整文件比对两份。

## 遗留
- `scripts/generate-persistence-fixtures.ts` 的写出函数已被 1921fa0da 删掉，正式生成器现在只剩数据；以后升格式要么恢复它，要么沿用本次“正式迁移 + 正式构造器的一次性脚本”。不在我的所有权内，没动。
- 拼接写出可以先 `copyFile(..., COPYFILE_FICLONE_FORCE)`：APFS（Mac）上前段零拷贝，NTFS 上会失败退回现在的写法。末尾追加时收益最大，需要按原文件头改写数据长度，没做。
- 频谱/波形的“长度变了”派生要求上一版的派生物已生成；外部素材第一次拼接时，原素材波形是按 mp4 解码的（不是 f32 副本），所以第一次拼接的波形整段生成一次，之后按块派生。

## 需主会话用真实一小时素材验证
1. `npm run build:audio-worker`，再 `npm run electron:bundle`，重启开发版。
2. 导入一小时 WAV 与一小时 mp4（带视频）口播：
   - `npm run logs:query -- --event audio_edit.source.probe.completed`：framesFrom=container，framesMs、videoMs、fingerprintMs 都在百毫秒内，elapsedMs 不随时长增长。
   - 编辑器打开后立刻播放、拖动试听：工具栏应出现“正在处理 x%”（prepare 任务）；`--event audio_edit.preview.chunk.completed`（或 `.slow`）里 fallback=true；听感与转好后相同。
   - 转完：`--event audio_edit.source.transcode.completed` 的 elapsedMs、bytes；之后的块 fallback=false、direct=true。
3. 在这份作品末尾录一段补录（念坏重念）：
   - `--event audio_edit.source.splice.completed`：mode=splice，verifyMs 毫秒级，writeMs 约等于一次整条复制，fingerprintMs 毫秒级，没有第二遍探测。
   - `--event audio.waveform.pyramid.completed`：derived=true，recomputedFrames ≈ 录音长度 + 不足 1024 帧（第一次拼接外部素材时可能整段一次，见遗留）。
   - `--event audio_edit.spectral.completed`：derived=true，recomputedFrames ≈ 录音长度 + 不足 5.5 秒。
   - 有录音响度增益区时 `--event audio_edit.render.edited.completed`：mode=full、fallbackReason=素材补录拼接后长度变了；随后编辑后声音的波形、频谱 derived=true。
4. 选中中间一句等长重录（覆盖）：splice 的 dirty 只有这一句；编辑后声音 mode=incremental、recomputedFrames=这一句；波形、频谱 recomputedFrames 与这一句同阶。
5. 在中间插入一句（长度变了）：波形、频谱从拼接点算到结尾（后半段超过一半时整段），日志 derived 字段与 recomputedFrames 可对照。
6. 查意外退回：`--event audio.waveform.pyramid.derive_skipped`、`--event audio_edit.spectral.derive_fallback`。
7. 打开一份旧作品（带 identity）：能打开、内容与改前一致，不出现整段转码或整段频谱（缓存键未变）；保存后再用旧版本程序打开应提示升级。
8. 导出联动视频的 XML：`--event audio_edit.source.video_timing.completed` 出现一次，stable 与素材实际一致。

## 审查返工（第 1 轮）

1. **等长覆盖后内容键与覆盖前相同（必须改）**：根因是“带指纹的素材大小、修改时间对得上就只用采样摘要当键”，而采样指纹本来认不出未采样位置的改动。
   - `audioEditSourceContentKey`：只有采样指纹的素材，键一律连同文件当前的大小与修改时间；只有整文件摘要的直接用摘要；两者都有（重新定位过的旧作品，校验只比指纹）时，大小与修改时间对上才用摘要，否则连同两者。
   - 应用自己写出的拼接结果不写指纹，改写整文件 SHA-256 的 `identity`：`createF32WavWriter` 接收摘要对象，按文件字节顺序喂头与数据，`concat` 任务写完带回摘要（工作线程 `done` 消息带结果），不额外读一遍。等长覆盖一句话内容不同，键就不同；渲染各阶段、增益层比较、频谱都随之换键。崩溃恢复复用已发布结果时整文件读一遍算身份。
   - 转写回执摘要：只有指纹的素材改用连同大小与修改时间的记录键（带整文件摘要、没有身份记录的与已存回执一致）。
   - 测试：`source-identity.test.ts` 新增“正中块与下一块之间的空档改一个字节”：采样指纹相同（如实反映局限），外部素材修改时间不同即换键，整文件摘要的素材修改时间相同也能区分；原“正中间改 1 字节”保留并注明它落在采样块里。`splice.test.ts` 三种拼接（含等长替换）都核对身份等于事后整文件哈希、内容键与拼接前不同、不带指纹。
2. **最低可读版本**：`audioEditProjectSchema.source` 改为宽松结构，不认识的字段打开时保留、保存时写回（`documentContent.test.ts` 新增往返用例），以后给 source 加可选字段只升版本、不提最低可读版本。这一改动并进版本 8（未提交过）：撤掉我上一轮未提交的基线与发布快照条目后重新登记（版本 8 指纹 085c368d…，v8 样本未变）。登记处（`kinds/audioEdit.ts` 注释）写明原因（旧程序按严格结构解析 source）与后果（被版本 8 打开并保存过的 .hjaud 旧版打不开，提示请升级、不当损坏；发生在 2.0 正式版之前）。
3. **后台转码与调用方取消解耦**：`prepareAudioEditAudio` 不再把调用方的信号交给缓存层，共享转码只受它自己的“准备”任务取消；调用方取消只让自己停止等待（`waitUnless`），转好的副本照常发布，在等的试听拿到同一份、不重转。测试：转写方中途取消，试听方照常拿到副本，只转一次。
4. **转码前按块解码只开给能证明逐样本一致的素材**：去掉按扩展名的名单，改为每份素材用 ffprobe 查一次编码与容器（按素材记录键记住）。只有 WAV / W64 / AIFF / CAF 里的 PCM 与 FLAC 文件（样本时间戳就是样本序号）先按块解码；mp4/mov（编辑列表、时间戳空档、别的编码器写的 AAC）、mp3（VBR、编码延迟）等一律等转码完成再播（界面有“正在处理”进度）。测试：PCM WAV 走按块解码、副本好后改直接读；mp4 里的 AAC 只起一次 ffprobe、块等副本转完才给；真实 FFmpeg 下 WAV、FLAC 按块解码与副本逐字节相同，mp4、mp3 等副本。
5. **抽查起点与“未知”**：抽查点按视频流起始时间戳偏移（部分 TS/MTS 起点很大）；抽查结果分稳定 / 不稳定 / 未知，有窗口一个包都没读到时为未知，不标“帧率不稳定”，XML 导出前的整段检查照常执行；只有窗口里实际看到缺帧、间隔不对或帧率与平均帧率不符才标不稳定。探测日志多一个 videoTiming 字段。测试：起点 5000 秒的 TS 抽查 5000/6795/8590 秒三个窗口并判稳定；结尾窗口读不到包时不标不稳定。
6. **其余整文件 SHA 键**：新增 `src/core/audioEdit/sourceRevision.ts::audioEditSourceRevisionKey`（路径、整文件摘要、指纹连同其大小与修改时间，主进程与渲染层共用）；`audioEditBreaths.ts` 缓存键、`AudioWaveWorkspace.tsx` 频谱素材键（只换数据键）、`ipc/audio.ts` 声音处理任务键、`export.ts` / `silence.ts` 任务键都改用它。测试：带整文件摘要的旧作品重新定位后同时带 identity（摘要不变）与 fingerprint、保留原帧数，作品结构校验通过（`media.test.ts`）。

越过所有权的改动：`electron/main/ipc/audio.ts`（审查点名）、`src/features/audioEdit/spectral/AudioWaveWorkspace.tsx`（只换数据键）、`audio-edit/effects-render.ts`（工作线程入口返回值类型）。

返工验证：
- Electron tsc 0 错；渲染层 tsc（12288）只剩别人的 `src/features/videoEdit/engine/videoEditNativeFrameSource*.ts`、`videoEditRenderer.ts` 错误。
- vitest：本任务 22 个文件加 `src/core/persistence/persistence.test.ts`，共 619 项全过。
- 改动的 24 个文件 eslint 0 问题；`check:surface` 界面错误 0 处；`check:persistence-compat` 通过（66 种格式）。
- 原生代码本轮没改，未重跑 cargo（上一轮 34+2 过、无警告）。

## 复审小修（第 2 轮）
- 转写回执：只有采样指纹的素材改记 [摘要, 大小, 修改时间]，不带路径。素材移动后重新定位仍复用已付费的识别结果，修改时间变了照旧拒绝（`asr.test.ts` 新增用例）。
- 频谱键：只有整文件摘要的作品沿用身份对象；同时带指纹的（重新定位过的旧作品）走内容键，原文件改写后修改时间变了即换键。
- 第 2 节、偏离一节里“mp4 系、mp3 转码前按块解码”的旧说法已改成现状。
- 验证：asr、spectral-pyramid、source-identity、splice 测试通过；Electron tsc 0 错；改动文件 eslint 0 问题。
