# 调研：录屏与录音链路对照 OBS 等成熟开源（2026-11-13，只读）

查证方式：直接拉源码逐函数读，不靠二手文章。OBS Studio 取 `master` 分支（2026-11-13），Cap 取 `main`，PortAudio 取 v19.7.0 与 master，FFmpeg 取 master 的 `libavformat/movenc.c`、`libavfilter/vsrc_gfxcapture_winrt.cpp` 和官方文档。下文的“OBS 源码”都指 `github.com/obsproject/obs-studio/blob/master/<路径>`。

我们这边读了 `native/audio-capture/src/{main,microphone,segments,system_audio,wasapi,wav}.rs`、`portaudio_bridge.c`、`electron/main/services/audio-capture/native-track.ts`、`screen-recording/audio-join.ts`、`screen-recording/capture/gfxcapture.ts`，以及三份工单文档。另外只读核对了真实录制目录里的 `tracks.journal`（`E:\文档\HenjiAI\Uploads\screen-recordings\f7379a8e…`，30 分钟长录），用来量时间戳抖动。

---

## 结论（一页）

**总判断：架构不用换。** 我们的骨架和 OBS、Cap 是同一类做法：采集与写盘分线程，写盘放在独立进程或独立线程，崩溃后靠分片或带头文件读回，停止时按“按下那一刻”定终点。Cap 是 Electron 之外最接近我们的开源录屏软件（Rust，Windows 与 macOS），它的麦克风同样是“一路采集、非阻塞分发给多个订阅者，满了丢并上报 Stalled”。我们这轮在审查里被拦，问题出在外围编排上：渲染进程持有轨道、整份文档重存、停止语义、时间戳细节。采集与写盘的基本形态没有错。

**最值得做的改动**（按“对不丢数据、不中断的贡献 ÷ 工作量”排序）：

1. **修麦克风时间戳**（小，风险小）。我们内置的 PortAudio 19.7.0 在 WASAPI 下把 `inputBufferAdcTime` 的符号算反了（`currentTime + pending`），上游 2023-10-30 才修（commit 7e62dfc8，#850），至今没有发版。我们的桥接代码因此大多数回调判为无效，退回“回调时刻减延迟”；`pending==0` 的回调又判为有效、不减延迟。两种时刻之间相差整整一个延迟值，再叠加线程调度抖动。拼接时每 5 秒按段起点把前一段尾部 200 ms 拉伸或压缩，抖动就会变成短暂的变速。修法两步：打上游这个补丁；参照 OBS 的 `TS_SMOOTHING_THRESHOLD` 或 Cap 的 `placement_correction`，偏差在容差内时按采样数连续推进，不按每段的时间戳硬对齐。
2. **画面容器加 `hybrid_fragmented`**（小，风险小）。这和 OBS 默认格式 Hybrid MP4 是同一思路：录制中是分片 MP4，崩溃可读；正常停止时补完整索引，变成普通 MP4。我们打包的 FFmpeg 9.0 已带这个标志及 2025 年的几处修复。这样剪辑软件兼容、打开慢、恢复时整份 `+faststart` 复制（S-2）都能缓解。顺手把停止时 `q` 之后 5 秒就强杀的时限放宽：OBS 在这一步是无限等待。
3. **暂停时不结束 FFmpeg**（中，风险中）。OBS 的编码器在暂停期间照常运行，只丢帧、记时间偏移，继续是瞬时的。我们的暂停是 `q` 掉进程、继续时重开进程。按实测续录要 2.0 秒、空 1.64 秒，所以每次继续之后约 1.6 秒没有画面，而麦克风是即时恢复的。
4. **每秒 `sync_data` 降频或挪出写盘线程**（小，风险小）。OBS 的 ffmpeg-mux 和 Hybrid MP4 写盘全程不调 fsync，只靠 1 MiB 合批写加系统缓存。我们每秒一次 `set_len + 改头 + sync_data`，和 4K60 视频同盘时写盘峰值达到 0.6–1.1 秒（验收-长录 六-4）。进程崩溃的恢复本来就按文件物理长度修（`Wav::recover`），每秒落盘只对断电有用。
5. **停止的语义向 OBS 靠拢**（中，风险小）。OBS 停止时没有超时，界面显示“正在停止录制”，一直等到封装进程写完；再按一次停止才算强停。我们 80 秒后应答 `pending`，再把音频编辑那一路转成“可恢复的中断”（STOP_PENDING），这条分支复杂，审查也盯着它。可以改成：主进程在“收尾中”状态一直等写盘线程结束（界面显示收尾进度），去掉 STOP_PENDING 这条分支。

**已经做对、与 OBS 等价或更合适的**：

- 一路采集分发给多路写盘，每路有自己的有界队列和写盘线程，一路慢不拖别人：比 OBS 隔离得更好（OBS 的编码与封装回调是同步串在音频线程上的），与 Cap 一致。
- 队列满时丢帧、补等长静音并计数，绝不阻塞采集：OBS 选择阻塞上游，视频端靠丢帧兜底。对“口播不能断”的需求，我们的取舍更合适。
- 停止与暂停按帧位置定边界，排队中的数据照写：与 OBS 的 `stop_ts`、`pause.ts_start/ts_end` 是同一做法。我们还能各路独立暂停，OBS 在编码器共享时干脆禁止暂停（`UpdateIsRecordingPausable`）。
- 系统声用 WASAPI 自带的 QPC 包时间戳放上时间轴：就是 OBS 回环采集的默认做法（`use_device_timing` 对输出设备默认为 true）。实测 30 分钟 361 段，段间偏差 p99 只有 0.23 ms，净漂移 −5.3 ppm。
- 画面 PTS 同样来自 QPC（gfxcapture 用 WGC 的 `SystemRelativeTime`），与音频、钩子事件同一个时钟。两小时级不会有系统性音画漂移，只剩设备时钟漂移，拼接时已按锚点吸收。
- 主进程崩溃时 FFmpeg 收到管道 EOF 自行收尾、原生录音读到 stdin EOF 封口：与 OBS 的 ffmpeg-mux 子进程、Cap 的 cap-muxer（有专门的 orphaned 测试）同理。
- 设备失效后无限重试、默认输出设备切换后跟随、空档如实记录：与 OBS 的 `ReconnectThread` 每 3 秒重试等价，而且我们多了空档记录和补静音。

**自研部分建议改成 OBS（或成熟）做法的**：时间戳平滑（第 1 条）、Hybrid MP4（第 2 条）、暂停不停编码进程（第 3 条）、不每秒强制落盘（第 4 条）、停止无超时加二次强停（第 5 条）。其余自研部分保留。

**不建议**：换成 libobs，或把声音交给同一个 FFmpeg 进程（论证见第 8 项）。

---

## 1. 采集到写盘之间的缓冲与背压

**OBS 怎么做**
- **音频源到混音**：每个源有一个环形缓冲（`obs-source.c` 的 `source_output_audio_place`、`source_output_audio_push_back`），上限是 `MAX_BUF_SIZE = 1000 * AUDIO_OUTPUT_FRAMES * sizeof(float)`，超过就直接丢掉这次输入。混音线程 `audio_thread`（`libobs/media-io/audio-io.c`）按系统时钟每 1024 帧跑一次。某个源跟不上时，`add_audio_buffering`（`libobs/obs-audio.c`）给全局加缓冲，上限 `max_buffering_ticks`，默认 45 tick，约 960 ms（`obs.c` 1624 行）。到顶之后，`ignore_audio` 打出 “audio is lagging … at max audio buffering. Restarting source audio.”，清掉这个源重新对时。
- **编码到封装**：音频编码在音频线程回调里同步执行（`obs-encoder.c` 的 `receive_audio` → `send_audio_data`）。封装后经 `os_process_pipe_write`（阻塞的 `WriteFile`，管道用默认缓冲，见 `libobs/util/pipe-windows.c`）写给子进程 `obs-ffmpeg-mux`。
- **封装子进程**（`plugins/obs-ffmpeg/ffmpeg-mux/ffmpeg-mux.c`）：
  - `ffmpeg_mux_write_av_buffer` 先写进一个从 1 MiB 起、最大 256 MiB 的 deque；
  - 独立的 `ffmpeg_mux_io_thread` 每攒满 64 KiB 或 1 MiB（`CHUNK_SIZE`）才 `fwrite` 一次；
  - deque 满了就**阻塞等待**（`buffer_space_available_event`），不丢数据。源码注释写明，这样做是为了绕开 “too small buffers somewhere causing output stalls when recording”。
- **Hybrid MP4 输出**（进程内）走同样的 `buffered_file_serializer`：默认 256 MiB 缓冲、1 MiB 分块、独立 I/O 线程，满了阻塞（`libobs/util/buffered-file-serializer.c` 的 `file_output_write`）。
- **背压的最终出口**是视频：`video_output_lock_frame`（`media-io/video-io.c`）的缓存只有 `MAX_CACHE_SIZE = 16` 帧，满了就计 `skipped_frames`。状态栏 `OBSBasicStatusBar::UpdateStatusBar` 发现一次多跳过 10 帧且累计 ≥0.1% 时提示 `HighResourceUsage`（编码过载），窗口隐藏时发托盘通知。
- **不 fsync**：上面所有写盘路径都没有 `fsync` 或 `FlushFileBuffers`。

**我们怎么做**
- 麦克风：PortAudio 回调 → 512 块采集队列 → 分发线程（不碰磁盘）→ 每路 4096 块写盘队列（48 kHz 约 44–87 秒）→ 每路一个写盘线程。队列满时这一路丢帧、计数，写盘时补等长静音。
- 系统声：采集线程每 5 ms 轮询 → 4096 块队列 → 写盘线程，同样丢帧补静音。
- 预览与电平另走有界、可丢的通道，不挡写盘。
- 写盘每块一次 `seek + write_all`，每秒一次 `set_len + 改头 + sync_data`（`wav.rs` 的 `checkpoint`）。

**差别**
- OBS 是“大缓冲 + 阻塞背压，由视频丢帧兜底”；我们是“大缓冲 + 不阻塞，音频丢帧补静音并计数”。对音频，我们这样更不容易让采集端出问题。OBS 阻塞起来会一路堵到音频线程，最后触发 “Restarting source audio”。
- OBS 合批写、不落盘；我们每块写一次，每秒落盘一次。
- 对用户的提示：OBS 有过载提示（跳帧阈值）和托盘通知；我们有 `disk.slow` 日志和健康计数，界面上的提示较弱（排查-录制 P1-6）。

**建议**
- 队列结构和不阻塞策略：**已等价或更合适**，保留。
- `sync_data`：**借鉴 OBS**，改为不每秒落盘。三种做法任选：改头不 sync；每 10–30 秒 sync 一次；或把 sync 交给单独线程，写盘线程不等它。理由：进程崩溃按物理长度恢复，不依赖头部和落盘；断电保护是唯一收益，而 OBS 全程不 fsync。工作量小，风险小（断电时多丢几秒，属于明确的取舍，需要你拍板）。
- 写入合批（每次攒到 64 KiB 以上再写）：**可借鉴，优先级低**。当前每块约 2–8 KB 一次写调用，系统缓存足够承受，先看去掉每秒 sync 之后的写盘峰值再说。
- 过载提示：**借鉴一点**。丢帧或补静音在一段时间内超过阈值时，在控制条和系统通知里提示一次“磁盘太慢”，参照 OBS 的阈值形式（增量 > N 且占比 ≥ 0.1%）。工作量小。

## 2. 多个输出共用一路采集；控制命令与写盘解耦

**OBS 怎么做**
- 结构是源 → 混音（最多 6 路混音 `MAX_AUDIO_MIXES`）→ 编码器 → 输出。编码器通过 `audio_output_connect`（`audio-io.c`）挂到某一路混音上，多个输出可以共用同一个编码器（`obs_encoder_add_output`）。
- 分发是在音频线程里**同步**逐个调用回调（`do_audio_output` 遍历 `mix->inputs`），一个慢回调会拖住所有人。OBS 靠编码快、封装侧有 256 MiB 缓冲来规避。
- 暂停和停止是**时间戳**语义：
  - `obs_output_pause` → `obs_encoded_output_pause` 在编码器的 `pause` 上记 `ts_start/ts_end`（对齐到最近的视频帧 `get_closest_v_ts`），由编码器回调里的 `video_pause_check`、`audio_pause_check` 按时间戳丢弃；
  - 停止是 `ffmpeg_mux_stop` 记 `stop_ts`，数据照常流过，直到 `ffmpeg_mux_data` 见到 `sys_dts_usec >= stop_ts` 才 `deactivate`；
  - 控制线程不等写盘。
- 编码器被共享时不允许暂停（`frontend/widgets/OBSBasic_Recording.cpp` 的 `UpdateIsRecordingPausable`）。

**Cap 怎么做**（`crates/recording/src/feeds/microphone.rs` 的 `impl Message<MicrophoneSamples> for MicrophoneFeed`）：麦克风一路采集，对每个订阅者 `try_send`。满了不阻塞，记 `stalled_since`，每 5 秒发一次 `PipelineHealthEvent::Stalled`；接收端断开就移除。

**我们怎么做**：分发线程按每路的帧位置区间（`Gate`）把块转进各路自己的队列。控制命令只在短锁里改区间。停止由后台线程等写完、封口、`Barrier` 确认事件发出后再应答。

**差别**：我们是“分发不阻塞、每路独立队列”，隔离比 OBS 强，与 Cap 相同。边界语义与 OBS 相同，都是“按下那一刻定边界，排队数据照写”。我们支持各路独立暂停，OBS 共享编码器时不支持。

**建议**：**我们现在的做法已等价或更合适**。只有一个小差别可以借鉴：OBS 暂停时把音频按采样精确切开（`obs-encoder.c` 的 `pause_audio`、`unpause_audio` 截断 `data->frames`），我们的 `Gate::contains` 只看块的第一帧，边界误差最多一块（≤1024 帧，约 21 ms），这一点结果文档“遗留 4”已经记了。需要时把 `route()` 改成按区间截断块内帧数，工作量小，风险小。

## 3. 停止与收尾

**OBS 怎么做**
- **停止流程**：`OBSBasic::StopRecording` → `obs_output_stop` → `obs_output_actual_stop` → `ffmpeg_mux_stop` 记 `stop_ts`。之后数据继续流入，直到越过 `stop_ts`，再 `deactivate`：`os_process_pipe_destroy` 关闭管道，然后 `WaitForSingleObject(pp->process, INFINITE)` 等子进程。子进程读到 EOF 后 `ffmpeg_mux_free`：先 `av_write_trailer`，再等 I/O 线程把 deque 全部写完（`shutdown_requested`，`pthread_join`）。
- **没有停止超时**，全程无限等待。界面进入 `RecordStopping`，托盘显示 “Stopping Recording”。
- **强停**：再按一次停止时，`StopRecording(recordingStopping)` 带 force 调用 `obs_output_force_stop`。
- **Hybrid MP4**：停止时 `mp4_mux_finalise` 先把剩余包作为最后一个分片写出，再写完整 moov，回头改写文件头（`plugins/obs-outputs/mp4-mux.c`）。

**我们怎么做**
- **音频**：控制线程按下即定终点、立即返回。后台线程最多等 80 秒，超时应答 `pending: true`。音频编辑那一路转为 `STOP_PENDING` 可恢复中断，写盘线程照常写完，进程退出前最多再等 100 秒。
- **画面**：`end()` 先发 `q`，**5 秒后强杀**（`gfxcapture.ts` 184 行），并按 `-progress` 报的时长封口。

**差别**
- 音频这边我们多了一条“超时转中断、写完后再从恢复入口拼回”的分支。OBS 没有这层复杂度，靠无限等待加用户可见的“正在停止”。
- 画面这边 OBS 是无限等待，我们只等 5 秒就强杀。在慢盘加 NVENC 积压时，5 秒不一定够。分片 MP4 被强杀最多丢最后一个分片（约 0.5 秒）；若改用 `hybrid_fragmented`，被杀在写尾部期间会怎样，见第 4 项。

**建议**
- 音频：**借鉴 OBS**。停止进入“收尾中”状态，主进程一直等到写盘线程报完成，界面显示收尾进度（已写或剩余），用户再点一次才放弃等待。这样能删掉 STOP_PENDING 分支，以及“写完前拒绝恢复”的 `WRITING` 登记。前提是主进程对原生停止请求不设 90 秒超时，改成等完成事件。工作量中（原生与主进程各改一处，测试要重写），风险小，审查面会变小。
- 画面：**照搬 OBS 的无限等待加二次强停**，至少把 5 秒放宽到 30–60 秒，并在日志里记录实际用时。工作量小。

## 4. 抗崩溃

**OBS 怎么做**
- **默认格式是 Hybrid MP4**：`frontend/settings/OBSBasicSettings.cpp` 中 `#define DEFAULT_CONTAINER "hybrid_mp4"`。
  - 录制中每个关键帧切一个分片：`mp4_mux_submit_packet` 用关键帧的 PTS 设 `next_frag_pts`，`mp4_flush_fragment` 写 moof 与 mdat；开头是 ftyp、16 字节占位 free 和不完整的 moov。
  - 停止时 `mp4_mux_finalise` 写完整 moov，把占位改写成覆盖全部数据的 mdat 头，于是文件变成普通 MP4。
  - 崩溃时文件仍是合法的分片 MP4。官方博客说明 “everything up to the last fragment will still be readable”（[OBS 博客](https://obsproject.com/blog/obs-studio-hybrid-mp4)、[知识库](https://obsproject.com/kb/hybrid-mp4)）。
  - 博客也写明纯分片 MP4 的代价：编辑器和播放器支持不好，HDD 上打开慢，资源管理器不显示时长，有的播放器不能拖动进度。这正是 Hybrid 要在结束时补索引的原因。
- **fMP4 和 fMOV 选项**：`AdvancedOutput.cpp` 与 `SimpleOutput.cpp` 给 ffmpeg-mux 传 `movflags=frag_keyframe+empty_moov+delay_moov`。
- **独立封装子进程**（`obs-ffmpeg-mux.exe`）的作用：主程序崩溃时管道 EOF，子进程走 `ffmpeg_mux_free` → `av_write_trailer`，连普通 MP4 也能收尾。
- **MKV**：OBS 一直推荐它防崩溃，它也是“自动转封装”（`OBSBasic::AutoRemux`）的典型输入。Matroska 按 cluster 顺序追加，没有 cues 也能读。这一点的源码依据我没有逐行核对，属于格式常识。
- **Cap** 走得更远：封装器是独立进程（`crates/cap-muxer`），按 2 秒（`segment_duration: Duration::from_secs(2)`）写 DASH 分片（init + m4s）。子进程崩溃最多重开 3 次（`DEFAULT_MAX_RESPAWNS = 3`），磁盘满时用专门的退出码 `EXIT_DISK_FULL = 60`。`tests/orphaned.rs` 专门测“录制进程死掉后，封装器把手上的分片写完”。

**我们怎么做**
- **画面**：FFmpeg 子进程写 `+frag_keyframe+empty_moov+default_base_moof`，GOP 约 0.5 秒，带 `-flush_packets 1`。监督进程在父进程 EOF 时发 `q`。恢复时用 `+faststart` 整份复制一遍。
- **声音**：原生进程写 WAV，5 秒一段，每秒更新文件头并 `sync_data`，段的开与封各发一条不丢的事件。主进程写 `tracks.journal`，恢复时按文件物理长度补齐。
- **结束**：`audio-join` 把各段拼成每路一条连续的声音。

**差别**
- 画面的抗崩溃能力与 OBS 的 fMP4 相当。我们没有 Hybrid 的“结束时补成普通 MP4”这一步，所以正常停止后得到的仍是分片文件，下游兼容和打开速度吃亏，恢复时还要整份复制。
- 声音这边，WAV 分段加 journal 的抗崩溃能力**强于 OBS**。OBS 的声音编码后交错进视频容器，最后一个分片之后的部分全丢；我们最多丢 1 秒内没 sync 的数据，而且断电也有保护。代价是 5 秒段会产生大量文件，结束时要拼接（P1-1 已解决拼接问题）。

**建议**
- 画面：**照搬 OBS 的 Hybrid 思路，用 FFmpeg 自带的 `hybrid_fragmented`**。
  - FFmpeg `movenc.c` 的说明是 “For recoverability, write a fragmented file that is converted to non-fragmented at the end.” 它和 `faststart` 互斥，代码里同时设置会报错。
  - 2025 年有几处修复：保留分片形式的头部、移除最终文件中的 mvex、配合 `delay_moov` 输出 ftyp。我们打包的是 FFmpeg 9.0，都已包含。
  - 做法：把 `-movflags` 改成 `+frag_keyframe+empty_moov+default_base_moof+hybrid_fragmented`，`empty_moov` 和 `default_base_moof` 能否与它共存要先试；恢复路径对“已是普通 MP4”的分片直接用，不再复制。
  - 风险是“写尾部时被强杀”：OBS 的做法是先写完最后的分片，再写 moov 并回改头部，被打断时多数情况仍能按分片读。FFmpeg 的实现是否同样安全，需要强杀测试确认，这也是第 3 项要放宽 5 秒强杀时限的原因。
  - 工作量小（改参数加恢复分支加一次强杀测试），风险小到中。
- 声音：**保持现状**。sync 频率按第 1 项调整。

## 5. 设备拔插、默认设备切换、采样率或格式变化

**OBS 怎么做**（`plugins/win-wasapi/win-wasapi.cpp`）
- **采集方式**：事件驱动（`AUDCLNT_STREAMFLAGS_EVENTCALLBACK` 加 `SetEventHandle(receiveSignal)`），线程设为 `AvSetMmThreadCharacteristics(L"Audio")`，共享模式缓冲 `BUFFER_TIME_100NS = 5 秒`。回环在 Win7 上不会被唤醒，所以加 10 ms 超时。
- **失效与重连**：`CaptureThread` 中 `ProcessCaptureData` 失败（含 `AUDCLNT_E_DEVICE_INVALIDATED`）时设 `reconnectDuration = RECONNECT_INTERVAL (3000)`，交给 `ReconnectThread` 每 3 秒重试，一直重试。
- **默认设备切换**：用 `IMMNotificationClient` 回调 `SetDefaultDevice`，只有源设成“默认”时才处理。输入设备看 `eCapture/eCommunications`，输出看 `eRender/eConsole`。回调发出 `restartSignal`，`reconnectDuration = 0`，立即重开。
- **空档**：OBS 不在源里补静音，混音线程按系统时钟出数据，源缺数据那段就是静音。回环为了防止“没声音时流停住、时间戳错乱”，另开一个渲染流持续播放静音（`ClearBuffer`，“Silent loopback fix”）。
- **格式变化**：重开后按新的混音格式初始化，libobs 对每个源用 `audio_resampler` 转成输出采样率（`obs-source.c` 的 `reset_resampler` 及其调用）。

**我们怎么做**
- **系统声**：采集线程每 200 ms 轮询一次默认输出设备，变了就重开；读失败就重开（用了一阵才失效的立即重开，刚开就失败的每秒重试一次）；用 `AUTOCONVERTPCM` 固定采样率；按时间轴补静音，记录空档与设备切换。
- **麦克风轨**：设备没了就记 `device` 空档，按 0.5/1/2/3 秒（之后一直每 3 秒）重新枚举并重连；找不到原设备时按设置落到默认输入。拼接时遇到格式变化另起一条。
- **音频编辑整段录音**：设备没了就中断，可恢复，不自动重连。

**差别**
- 重连策略基本等价。我们多了补静音和空档记录，对剪辑更友好。
- 默认设备切换：OBS 用系统回调、立即响应；我们轮询，最多慢 200 ms，开销可忽略。麦克风正在用时，我们不会因 Windows 默认输入变化而切换设备；OBS 设成“默认”时会切。我们这样对长时间录口播更稳，不会中途换了麦克风。
- 格式变化：我们拼接时分条，OBS 实时重采样。

**建议**：**已等价或更合适**。可选借鉴两点：
- 用 `IMMNotificationClient` 替代 200 ms 轮询（工作量小，收益小，不急）。
- 音频编辑整段录音在设备拔出后也走“记空档、自动重连”（排查-录制 S-4 已提）。这是产品决定，中等工作量。

## 6. 音画同步与时钟

**OBS 怎么做**
- **时钟**：全部用 `os_gettime_ns`（Windows 上是 QPC）。混音线程 `audio_thread` 按 `start_time + audio_frames_to_ns(rate, samples)` 定节拍。
- **每个源的时间戳平滑**（`obs-source.c` 的 `source_output_audio_data`）：
  - 新包时间戳与按采样数推算的 `next_audio_ts_min` 相差不到 `TS_SMOOTHING_THRESHOLD = 70 ms` 时，**直接用推算值**，即按采样数连续，忽略抖动；
  - 超过 70 ms 但不到 `MAX_TS_VAR = 2 s` 时，用真实时间戳放置（`deque_place`），会产生一次跳变；
  - 超过 2 s 就 `handle_ts_jump` 重置。
- **麦克风**：默认 `use_device_timing = false`（`GetWASAPIDefaultsInput`），时间戳是 `os_gettime_ns()` 减去本包时长。**回环**默认用设备 QPC。
- **漂移**：OBS 没有连续重采样来吸收设备漂移。漂移积累到 70 ms 时跳一次；“源落后”时由 `ignore_audio` 丢样本或重启源。所以 OBS 长录时麦克风漂移的表现是每隔一段时间出现一次几十毫秒的小跳变。
- **Cap 的做法**（`crates/recording/src/sources/audio_mixer.rs` 的 `placement_correction`）：偏差 ≤2 ms 视为抖动，不处理；2–10 ms 之间每 256 个采样最多插或删 1 个（0.4% 速率变化），注释写明 “clock drift never causes an audible jump”；≥10 ms 才按时间戳重新对齐。
- **FFmpeg gfxcapture**（`vsrc_gfxcapture_winrt.cpp`）：帧 PTS 用 WGC 的 `SystemRelativeTime`（QPC，100 ns 单位）。

**我们怎么做**
- 所有轨道共用主进程 `hrtime` 原点。libuv 在 Windows 上也用 QPC，和原生的 `hc_clock` 是同一个计数器。
- 系统声用 WASAPI 包的 QPC。麦克风用 PortAudio 回调给的时间。
- 每 5 秒一段，每段带起点。结束时 `audio-join.ts` 的 `writeRun` 让每段落在自己的时间戳上，差值用前一段尾部 `SLIP_WINDOW_US = 200 ms` 的三次插值拉伸或压缩来吸收。

**实测**（只读解析 30 分钟长录的 `tracks.journal`）：系统声 361 段，段间偏差 p50 30 µs、p90 79 µs、p99 228 µs，最大 309 µs，净漂移 −9.5 ms/30 分钟（−5.3 ppm）。最大一次拉伸 15 帧摊在 9600 帧上，速率变化 0.15%，听不出来。系统声这条路没问题。

**麦克风的问题（有源码依据）**
- 我们内置 PortAudio v19.7.0，它的 `pa_win_wasapi.c` 第 4994 行写的是 `timeInfo.inputBufferAdcTime = timeInfo.currentTime + pending_time;`，符号是错的。上游 master 已改成 `- pending_time`（commit 7e62dfc8，“wasapi: Fix wrong sign in timeInfo.inputBufferAdcTime calculation. (#850)”，2023-10-30），但 19.7.0 之后没有发过版。
- 我们的 `portaudio_bridge.c` `callback` 把 `delay = currentTime - inputBufferAdcTime` 小于 0 的判为无效，于是：
  - WASAPI 下只要 `pending > 0`，就退回 `now - latency`；
  - `pending == 0` 的回调判为有效，得到的约等于 `now`，没有减延迟。
  - 两种情况之间差整整一个 `latency`（通常 10–30 ms），再加上回调调度抖动。`next_us` 只能防止时间倒退，挡不住向前跳。
- 每段起点取自段首那一块的时间戳。拼接时 `writeRun` 把这个抖动当真实漂移，在 200 ms 内吸收：抖 5 ms 是 2.5% 的变速，抖 10 ms 就超过 5%。
- 旧路径（界面写麦克风段）的 `tracks.json` 里，确实看到过 ±3–11 ms 成对出现的段起点抖动，比如 `+3952, −3440`。这是抖动，不是漂移。
- 新的原生麦克风轨还没有长录数据，影响大小**未实测**。

**两小时级漂移风险的判断**
- 画面与系统声同为 QPC，不会有系统性漂移。
- 麦克风设备时钟与 QPC 之间有几十 ppm 的真实漂移，两小时约几百毫秒，拼接时按锚点吸收。这个机制本身是对的，比 OBS 每 70 ms 跳一次更平滑。
- 现在的隐患是锚点有噪声，而不是长期漂移。

**建议**（第一优先，工作量小，风险小）
1. 给 PortAudio 打上游 #850 补丁（只改一行；构建脚本拉的是 19.7.0 源码包，打补丁即可）。
2. 原生分段的起点不要直接用块时间戳，按采样数连续推进：段起点 = 首段时间戳 + 已写帧数 / 采样率。只有实测时间戳与推算值的偏差超过阈值时才重新对齐：OBS 的阈值是 70 ms，Cap 是 10 ms；拼接时的“拉伸吸收”只处理超过 2 ms 的部分。或者对一条连续声音的（帧位置，时间戳）做一次线性回归，用拟合出的速率统一换算，不按每段的时间戳硬对齐。
3. 加一条 Rust 或 TS 测试：在时间戳上叠加 ±10 ms 随机抖动，要求拼接后任意 200 ms 窗口的速率变化 < 0.1%。
4. 下次长录后用同样的脚本量麦克风段间偏差，看补丁前后的分布。

## 7. 暂停与继续

**OBS 怎么做**：输出和编码器都不停。`obs_encoded_output_pause` 对所有编码器在同一把锁下记 `pause.ts_start`，并对齐到视频帧（`get_closest_v_ts`）。编码器回调里：
- `video_pause_check` 丢弃暂停区间内的帧；
- `audio_pause_check` 按采样精确截断（`pause_audio`、`unpause_audio`），并从所有时间戳里减去累计的 `ts_offset`。

结果是一个连续的文件，继续时没有启动延迟。

**我们怎么做**
- **声音**：原生按帧位置区间（`Gate` 的 pause/resume），继续即时生效。录屏轨在主进程里是结束原生会话、再开新会话。
- **画面**：`pause()` = `end(true)`，即 `q` 掉 FFmpeg；`resume()` = `start()`，重新开进程和新分片（`gfxcapture.ts` 189–190 行）。

**差别**：画面继续要经过“开进程 → WGC 初始化 → 编码器初始化 → 第一条 `out_time`”这个过程。按长录里结束编码进程后续录的实测，2.0 秒完成，分片之间空 1.64 秒。也就是说，每次继续之后大约 1.6 秒没有画面，而麦克风已经在录。用户按下继续就开口讲、就动鼠标，正好丢掉最需要的那一段。span 的 `monoUs` 是按实测估的，所以不会错位，只是这段画面缺失。

**建议**：**借鉴 OBS**，暂停期间不停 FFmpeg。两种实现：
- (a) 暂停时 FFmpeg 继续录，在 journal 里记暂停区间，导入时跳过。实现最简单，代价是暂停期间照样占磁盘与 GPU。
- (b) 暂停时立即预启动下一个进程，但先不出画面。FFmpeg 命令行做不到“启动后待命”，所以不可行。

推荐 (a)：暂停通常很短，“继续即有画面”比省磁盘重要。长时间暂停（例如超过 2 分钟）可以再切成现有的结束进程方式。这也顺带让暂停与 OBS 语义一致：一个连续分片，暂停只是时间区间。工作量中（`gfxcapture` 的暂停分支、记录暂停区间、导入时裁剪），风险中，需要重新验证导入与时间线。

## 8. 架构层面：有没有更省事的整体方案

### 方案 A：直接用 libobs（或无界面的 OBS）
- **许可**：GPL-2.0-or-later，项目可以接受。
- **成熟先例**：Streamlabs 的 `obs-studio-node`（GPL-2.0，[仓库](https://github.com/stream-labs/obs-studio-node)）就是给 Electron 用的 libobs 绑定，分为 `obs-studio-client`、`obs-studio-server` 并通过 `lib-streamlabs-ipc` 通信，也就是 libobs 跑在独立的服务进程里。它的 README 还说明他们用的是自己的 Electron 分支。
- **需要承担的**：
  - libobs 自带图形子系统（D3D11 场景合成，按固定 fps 渲染），要通过 `obs_reset_video` 和 `obs_reset_audio` 初始化，并加载 win-capture、win-wasapi、obs-ffmpeg、obs-outputs、obs-nvenc 等插件。这是一整套“场景 → 混音 → 编码 → 输出”管线，体积以百 MB 计。
  - 声音会被编码后交错进视频容器（也可以配置成多轨 PCM，但走的是 OBS 的混音与 1024 帧节拍）。我们现在“每路一条无损 WAV，加段级时钟锚点，加音频编辑与录屏共用一路麦克风、各自暂停”的模型要重做；OBS 在编码器共享时不支持暂停。
  - 鼠标键盘事件与画面对齐：libobs 用的也是 QPC（`os_gettime_ns`），能对上，但要在它的输出层取帧时间。
  - 界面重载不中断：libobs 放在独立服务进程（Streamlabs 的做法）可以满足。
  - 助手驱动：要在服务进程上包一层我们自己的能力接口，工作量与现在相当。
- **收益**：成熟的采集与重连、过载提示、Hybrid MP4，以及各种采集源。但我们这轮出的问题不在采集原语上：录屏本身经过 30 分钟、一次强杀编码器、一次界面重载，都录住了。出问题的地方是外围编排（渲染进程持有轨道、整份文档重存、停止语义、时间戳细节）。换 libobs 之后，这些编排一样要做。
- **代价**：数周的迁移，原生录音进程与 journal 模型基本作废，打包体积与 GPU 资源大增，macOS 另一套，风险大。
- **判断：不换。**

### 方案 B：声音也交给同一个 FFmpeg 进程（dshow 或 wasapi 输入）统一封装
- FFmpeg 官方设备文档（[ffmpeg-devices](https://ffmpeg.org/ffmpeg-devices.html)）在 Windows 上只有 dshow、openal、decklink，**没有 WASAPI 输入设备，也没有回环（系统声）采集**。ShareX 正是这样做的：系统声靠另装 DirectShow 虚拟设备 `virtual-audio-capturer`（`ShareX.ScreenCaptureLib/ScreenRecording/FFmpegCaptureDevice.cs`）。我们不可能要求用户装驱动。
- dshow 的 `audio_buffer_size` 默认是设备缓冲，“typically a multiple of 500 ms”，时间戳偏向墙钟。
- 所有轨道放进一个进程，FFmpeg 一崩全部丢；暂停与续录也必须整体重启。音频编辑录音和录屏还是不能共用一路麦克风。
- 这样也丢掉了我们“声音不依赖编码进程”的隔离：长录验收里强杀编码器那一次，系统声连续 1805 秒没断，正是因为声音不在 FFmpeg 里。
- **判断：不做。**

### 方案 C：保持现状，借鉴几处
- 采集原语已经与 OBS、Cap 同构：独立写盘、可丢的有界队列、按帧位置定边界、子进程 EOF 收尾、设备重连。
- 要补的是第 1–5 条（时间戳平滑、Hybrid MP4、暂停不停编码、不每秒落盘、停止无超时），以及排查-录制里已经列出的外围问题（P0-1 文档整份重存、P0-3 恢复入口、P1-6 通知）。
- 与“记录鼠标键盘事件、助手可驱动、界面重载不中断”这些需求完全兼容：声轨已在原生进程与主进程，画面在 FFmpeg 子进程，界面只是观察者。
- **判断：采用。**

**结论**：现在的架构没有根本性问题，保持，借鉴上面几处即可。

---

## 其他成熟项目要点（与我们痛点直接相关）

- **Cap**（AGPLv3，部分 crate 为 MIT；我们只借鉴做法，不拷代码）：
  - 麦克风一路采集多订阅、`try_send` 满了上报 `Stalled`（`feeds/microphone.rs`）：与我们相同；
  - 封装放独立进程（`cap-muxer`），2 秒 DASH 分片，最多重开 3 次，磁盘满专用退出码 60（`output_pipeline/oop_muxer.rs`、`oop_fragmented_m4s_win.rs`）；
  - 录制进程死掉后，封装器写完手上分片（`crates/cap-muxer/tests/orphaned.rs`）；
  - 漂移按 2 ms 和 10 ms 两档阈值，以 1/256 速率逐样本修正（`sources/audio_mixer.rs`）；
  - 设备时钟偏离超过 5 秒才重设锚点（`sources/capture_clock.rs` 的 `MAX_CAPTURE_CLOCK_SKEW`）。
- **ShareX**：单个 FFmpeg 进程，dshow 加虚拟采集设备，依赖第三方驱动，不适合我们。
- **Kap、screenpipe**：未查。Kap 只支持 macOS，与 Windows 优先的痛点关系不大。screenpipe 是 cpal 分块写盘，Cap 已覆盖同类做法。
- **FFmpeg 官方**：
  - `hybrid_fragmented`、`frag_keyframe`、`delay_moov`、`frag_duration` 的说明见 [ffmpeg-formats](https://ffmpeg.org/ffmpeg-formats.html)；`hybrid_fragmented` 与 `faststart` 互斥（`movenc.c` 8379 行）；
  - `flush_packets` 的说明是 “Flush the underlying I/O stream after each packet”，只刷到系统，不 fsync。

## 未查到或未核实

- MKV 抗崩溃的具体源码依据（matroskaenc 的 cluster 与 cues 写法）：未逐行核对，按格式常识写。
- FFmpeg `hybrid_fragmented` 在写尾部期间被强杀时文件是否仍可读：只读了代码路径，没有实测，需要做一次强杀测试。
- 新原生麦克风轨的段起点抖动实测：还没有它的长录数据。
- 我们默认用的是哪个 PortAudio 主机 API：取决于 `Pa_GetDefaultInputDevice`，通常是 MME；MME 下 ADC 时间是另一套近似，抖动情况未实测。WASAPI 下第 6 项的问题可以确定。

参考链接：[OBS Hybrid MP4 博客](https://obsproject.com/blog/obs-studio-hybrid-mp4)、[OBS 知识库 Hybrid MP4](https://obsproject.com/kb/hybrid-mp4)、[obs-studio-node](https://github.com/stream-labs/obs-studio-node)、[FFmpeg formats](https://ffmpeg.org/ffmpeg-formats.html)、[FFmpeg devices](https://ffmpeg.org/ffmpeg-devices.html)。
