摘要：A3 A4 A5 C1 全部改完：频谱整段计算改无进展超时并可从对齐点续算；波形与重型媒体排队不再拒绝、槽数按核数；修复/去爆音/插件按进度续期、超 4 GiB 读写 RF64、长选区分块修复；各音频缓存预算按内存与全局媒体缓存上限取值。
验证：cargo test --release（独立 target 目录）33 项全过；electron tsc 通过；渲染层 tsc 只剩 W1-A 文件的错误；21 个相关 vitest 文件 97 过 9 跳过（原生专项无 worker 环境）；改动文件 eslint 0 问题。
必须注意：TS 侧依赖新版音频 worker（心跳、续算目录复用），主会话验收前要先 `npm run build:audio-worker`（会覆盖开发实例正在用的 target/release 可执行文件）。

## 逐条改法

### A3 频谱整段计算
- `spectral-worker-client.ts`：超时改为无进展超时（默认 60 秒），收到该请求的 `progress` 或新的 `alive` 心跳就续期。
- `spectral_server.rs`：排队等闸、给即时块让路期间每 5 秒发 `alive`；删掉“64 个请求队列已满”的拒绝（只保留请求 ID 重复检查）。
- `pyramid/mod.rs`：`Store::open` 在目录已存在、清单与输入一致时，从第 3 层 4096 列的对齐点续写（此处所有层都没有未合并列）。计算是确定的，原位重写的字节与原有相同，读者按旧清单读到的数据一直有效。文件比对齐点短或清单不符时从头算。结果带 `resumedFromFrame`。
- `spectral-pyramid.ts`：失败不再删除目录，日志记下 `coveredFrames`。下次启动时找同键未完成的目录续算（只留覆盖最多的一份）。`spectral.start` 和 `completed` 日志带 `resumed`，`completed` 另带 `durationFrames`。
- 证据：`interrupted_build_resumes_from_aligned_point_with_identical_output`（1700 万帧，中断状态加垃圾尾巴，续算后所有文件与整遍逐字节一致）；vitest 用例“进度与心跳持续时远超时限不超时”；“失败保留已算部分、后续在同一目录续算”。

### A4 排队与并发
- `queue.ts`：删掉“音频波形排队已满”的拒绝；并发数改为可配置。
- `ops.ts`：默认并发取半数逻辑核（至少 2）。精细范围回读不再占重型媒体槽。`probeAudio` 按内容身份加声音流缓存，最多 1024 条，按最近使用淘汰。整段金字塔和范围回读的固定 120 秒超时都改成解码无进展 60 秒才中止。
- `media-import/concurrency.ts`：重型槽改为逻辑核数的 1/4（至少 2，24 线程是 6）；删掉“媒体处理排队已满”。
- 证据：queue 测试中 100 个排队请求全部完成，并发 5 时 active 为 5；concurrency 测试中 300 个排队全部完成，峰值等于槽数；ops 测试中三次回读只起一次 ffprobe。

### A5 长素材硬上限
- `media.ts`：f32 转码加 `-rf64 auto`。`dsp-adapter.ts` 的去爆音 amix 输出也加了。
- `dsp/audio.rs`：自写 WAV 读取，支持 RIFF/RF64/BW64 和 ds64，按块解码 PCM16/24/32 与 float32。新增 `F32Writer`，布局与 FFmpeg `-rf64 auto` 相同，超过 4 GiB 时把 JUNK 改写成 ds64。修复、去爆音、插件处理、频谱读取共用这一套。`pyramid/reader.rs` 改为直接用它。
- `dsp/heal.rs`：删掉“RIFF 4 GiB”“上下文 1600 万样本”“掩码合计 64 MiB”三处拒绝。频谱修复按 2^20 帧分块输出，每块只算覆盖本块的分析中心，按同一顺序累加，结果与整段一次处理逐样本一致。
- 进度：新增 `progress.rs`，单次命令处理超过 1 秒后每秒报一次进度。`audio-worker-client.ts` 收到进度就续期超时。修复和去爆音改为 60 秒无进展超时；插件仍用原来的 30 分钟，但也变成无进展计时。
- `speech-energy.ts`、`speech-energy-service.ts`：删掉 6 小时上限和读取时 32 MiB 判无效。`src/core/audioEdit/speechEnergy.ts` 的结果 schema 原来也钉死了 6 小时，一并去掉。
- 证据：
  - `float_writer_upgrades_to_rf64_and_reader_round_trips_both_layouts`
  - `chunked_spectral_heal_matches_whole_selection_sample_for_sample`（块大小 333、777、4096 与整段一致）
  - 读取器按 hound 独立参照逐样本核对
  - vitest：进度心跳续期；7 小时素材照常分析

### C1 缓存预算
- 新增 `audio/cache-budget.ts`。内存份额取物理内存的 1/N；磁盘份额取全局媒体缓存上限（用户固定值，或按磁盘自动取值）的 1/N。预算只当淘汰目标。
- 各缓存的取值：

| 缓存 | 原来 | 现在（64 GB 机器约值） |
|---|---|---|
| 主进程金字塔内存 | 128 MiB | 1/64，约 1 GiB |
| 范围结果 | 64 MiB | 1/256，约 256 MiB |
| 频谱细层盘缓存 | 1 GiB | 全局上限的 1/3，至少 1 GiB（约 16 GiB） |
| 声音证据 | 32 MiB | 全局上限的 1/64，至少 512 MiB |
| 人声分离 | 4 GiB | 等于全局上限 |

- 渲染层新增 `src/services/waveform/audioDisplayCacheBudget.ts`：首次取波形时读一次物理内存。波形与频谱块各占 1/64（约 1 GiB），保底仍是 128 MiB 和 256 MiB。`SpectralTileStore` 不传上限时使用这里设定的值。

### 日志
- `audio.waveform.pyramid.cache_hit` 补了 `bytes`、`readMs`、`decodeMs`、`lookupMs`、`copyMs` 和 `levels`。
- `audio_edit.source.probe.completed/failed` 补了 `elapsedMs`，完成事件另带 `durationFrames`、`sampleRate`、`channels`。
- `tiles_trimmed` 带 `budgetBytes`。

## 偏离
- 所有权里的 `electron/main/services/audio/**` 按“含 `audio-edit/`”理解，因为排除的 preview、render 等文件都在 `audio-edit/`。
- 越界改了 `src/core/audioEdit/speechEnergy.ts`：只删了 6 小时相关的 `.max()`，不改字段含义。这是 speech-energy 的结果 schema，不改就去不掉 6 小时上限。
- 没做：
  - A4 ④ 精细回读直接随机读 f32，依赖 B2 和 pcm-wav，归下一批。
  - C1 擦洗块（`src/services/audioScrub/audioScrubWorklet.js`）不在我的所有权内，没改。

## 遗留：需主会话验证
1. 先 `npm run build:audio-worker`。旧可执行文件不发心跳，遇到已有目录还会建目录失败，续算会反复报错。
2. 用合成的 4 小时立体声（或 1 小时 8 声道）走一遍：导入打开（f32 缓存应是 RF64）→ 频谱 → 修复一处超过 3 分钟的选区 → 去爆音 → 导出。`audio_edit.spectral.completed` 和导出都应成功。
3. 整段频谱计算到一半时关掉应用，重开同一作品，日志里应出现 `audio_edit.spectral.start` 且 `resumed: true`。
4. 打开含 40 段以上音频的序列：不应报错，看 `audio.waveform.completed` 的耗时分布，以及 cache_hit 的分段耗时。
5. 一小时素材来回缩放、平移后，确认不再频繁出现 `tiles_trimmed`。

## 返工（审查意见 1–5）
1. 总并行度（`media-import/concurrency.ts`）：
   - 后台媒体线程预算取逻辑核数的 75%（至少 2），重型槽和波形队列各分一半。
   - 占槽的 FFmpeg 都加了线程上限：`video/ops.ts` 缩略图和 `probe.ts` 封面用 `-filter_threads 1 -threads 2 … -threads 1`，按每任务 3 线程计；`audio/ops.ts` 的波形解码用 `-threads 1 -filter_threads 1`，加上聚合 Worker 按每任务 2 线程计。
   - 槽数据此算出：重型槽 = ⌊预算/2/3⌋（至少 1），波形并发 = ⌊预算/2/2⌋（至少 1）。
   - **24 线程机器上的最坏情况**：预算 18，重型槽 3 × 3 = 9 线程，波形并发 4 × 2 = 8 线程，合计 17（约 71%）。整段金字塔同时占重型槽和波形队列，按两边都算，实际只会更低。ffprobe 是单线程。
   - **未解决：sharp。** 导入图片预览（`media-import/index.ts` 的 prepareImage）里的 sharp 线程数是进程全局设置，默认等于核数，每条管线最多用满全部核，同时最多 4 条（libuv 线程池）。槽数管不住它。在 prepareImage 里临时改全局设置，会和图片编辑导出等其他 sharp 使用方互相干扰；正确做法是在 `image/sharp-loader.ts` 统一设一次（建议逻辑核的 3/4），但这个文件不在授权范围内，交主会话决定。
2. `spectral-pyramid.ts`：查完成指针、清理残留目录、启动计算放进同一素材唯一的启动流程（`claims`），后到的读取者等它的结果。补了并发测试：4 个读取同时到达，只启动一次计算；续算覆盖最多的那份，删掉无清单的残留目录，计算目录不被误删。
3. `pyramid/mod.rs` 的 publish：续算对齐点前进或计算完成时，先对全部数据文件 `sync_data`，再原子替换清单。对齐点之间不刷盘，一小时素材约 10 次。
4. `dsp/audio.rs` 的 publish：`sync_all` 期间由一个线程每秒续期，结束后再报一次。`progress.rs` 新增不带计数的 `alive()`。
5. 注释：`cache-budget.ts` 和 `audioDisplayCacheBudget.ts` 改成说明保底值为什么取这个数；`invokeAudioWorker` 注释改为只有修复、去爆音、插件三类命令报进度。

返工验证：
- `cargo test --release`（单独 target 目录）33 项通过。
- 8 个受影响的单测文件 47 项通过；probe.test 与 video/ops.test 16 项通过。
- 主进程 tsc 通过。
- 改动文件 eslint 0 问题。
