# 调研：自己写 Rust 画面采集进程（2026-11-13，只读）

查证方式：用 `gh api` 拉各项目默认分支源码逐段读，WebRTC 从 `webrtc.googlesource.com` 取 `main`，系统接口查微软 Learn 与苹果开发者文档的原始数据（Apple 文档取 `tutorials/data/*.json`），crate 元数据取 crates.io API。日期都是 2026-11-13 当天的状态。只读运行过一次打包的 `ffmpeg.exe -h filter=gfxcapture`，没有构建、测试或启动应用。

读过的源码（路径相对各仓库根目录）：

- **glide**：`Cargo.toml`、`PERFORMANCE.md`、`src/capture/{screen,writer,record,tcc}.rs`
- **screencapturekit-rs**：`Cargo.toml`、`build.rs`、`docs/BENCHMARKS.md`，以及 issue 列表
- **CapSoftware/scap**：`Cargo.toml`、`src/capturer/engine/{win,mac}/mod.rs`，以及 issue 列表
- **RustFrame**：`Cargo.toml`、`src/capture/{windows,macos_sck}.rs`、`docs/technical/*`
- **Cap**：`LICENSE`、`crates/scap-direct3d/{Cargo.toml,src/lib.rs,src/windows_version.rs}`、`crates/scap-screencapturekit/{Cargo.toml,src/config.rs}`、`crates/d3d-adapter/src/lib.rs`、`crates/timestamp/src/win.rs`、`crates/recording/{FINDINGS.md,src/sources/screen_capture/{windows,macos,cadence}.rs,src/output_pipeline/{win,frame_pacing,core}.rs,src/studio_recording.rs}`、`crates/enc-mediafoundation/src/video/{h264,video_processor}.rs`、`crates/enc-ffmpeg/src/video/{h264,videotoolbox_hw,hardware_crash}.rs`、`crates/cap-muxer-protocol/src/lib.rs`
- **windows-capture**：`Cargo.toml`、`src/{graphics_capture_api,capture,frame,d3d11,encoder}.rs`，以及 #189、#190、#191、#192、#199、#210 号 issue
- **OBS**：`libobs-winrt/winrt-capture.cpp`、`plugins/win-capture/duplicator-monitor-capture.c`、`libobs-d3d11/d3d11-duplicator.cpp`、`plugins/mac-capture/{mac-sck-common,mac-sck-video-capture}.m`，以及 `obs-nvenc`、`obs-qsv11`、`texture-amf` 的文件列表
- **WebRTC**：`modules/desktop_capture/win/{wgc_capture_session.{cc,h},wgc_capturer_win.cc,wgc_capture_source.cc,window_capture_utils.cc,dxgi_output_duplicator.cc,dxgi_duplicator_controller.cc}`、`mac/screen_capturer_sck.mm`、`desktop_capture_options.h`、`rtc_base/win/windows_version.cc`
- **FFmpeg**：`master` 的 `libavfilter/{vsrc_gfxcapture.c,vsrc_gfxcapture_winrt.cpp,vsrc_ddagrab.c}`、`libavcodec/{nvenc,amfenc,qsvenc,qsvenc_h264,qsvenc_hevc}.c`；`release/9.0` 的 `fftools/{ffmpeg,ffmpeg_filter,ffmpeg_sched}.c` 与 `libavfilter/setpts.c`；`vsrc_gfxcapture_winrt.cpp` 在两个分支上的提交记录
- **其他**：Aperture `Sources/Aperture/Aperture.swift`；xcap `src/{windows,macos}/*video_recorder.rs`；rustdesk `libs/scrap/src/dxgi/mod.rs`；Kooha `src/recording.rs`；screenpipe `LICENSE.md`；libuv `src/unix/darwin.c` 及其提交记录；Electron `docs/api/browser-window.md`

我们这边读了：

- `electron/main/services/screen-recording/capture/{gfxcapture,process,service,source}.ts`
- `electron/main/services/video/{hwaccel,ffmpeg-loader}.ts`
- `electron/main/services/audio-capture/{client,protocol,native-track}.ts`
- `native/audio-capture/{Cargo.toml,src/main.rs,src/segments.rs,src/portaudio_bridge.c}`
- `native/video-decoder/Cargo.toml`、`scripts/video-decoder-ffmpeg.cjs`、`electron-builder.yml`、`.github/workflows/build.yml`
- `src/features/screenRecording/tracks/devices.ts`、`application/recordingDomPrivacy.ts`
- `验收-长录.md`，以及两份前序调研

---

## 结论（一页）

**值得做，而且能做好。建议的顺序和上一份调研不同：先在 Windows 上做出共享核心，macOS 紧随其后。Windows 不在进程里调 FFmpeg 的 gfxcapture。**

1. **Windows 采集用 Windows.Graphics.Capture（WGC）。我们自己写一层薄的 WinRT 封装，用 `windows` crate，借鉴 windows-capture 与 Cap scap-direct3d 的做法，两者都是 MIT。** 不用 libavfilter 的 gfxcapture，原因有四：
   - 它只给相对第一帧的时间戳（`frame->pts -= ctx->first_pts`），进程内也拿不到绝对 QPC。
   - 它是 2025-09 才进 FFmpeg 的新代码。2026-10 还在修设备上下文加锁和回调状态（`lock the device context around ExecuteCommandList`、`use fresh callback state for each WGC thread call`）。这些修复我们打包的 9.0.2 都没有，release/9.0 分支最后一次相关提交是 2026-07-06。
   - 设备丢失、来源关闭时，它只会以 EOF 或错误结束，没有恢复手段。
   - 它把 `MinUpdateInterval` 设成正好 1/fps。windows-capture #190 的实测是：60 Hz 屏上这样设只能拿到约 45 fps。

   DXGI Desktop Duplication（DDA）只当后备方案：它不能采窗口，采集设备必须建在接显示器的那块显卡上。
2. **编码继续用我们已经随包的 FFmpeg 9.0 共享库（libavcodec、libavformat），但输入一律先在 GPU 上转成 BT.709 有限范围的 NV12 纹理，再送 `*_nvenc`、`*_amf` 或 QSV。** 这样三家显卡的色彩矩阵由我们自己决定，QSV 也能用上硬件。读 FFmpeg 源码发现：`h264_qsv` 只接受 NV12 和 QSV 帧，不接受 D3D11 BGRA。所以**现在命令行路径在 Intel 显卡上大概率协商失败，退回了软件编码**（未实测，见实验 E5）。
3. **macOS 用 ScreenCaptureKit 输出 420v（BT.709）的 IOSurface，直接交给 `AVAssetWriter`（硬件 HEVC 或 H.264，设置 `movieFragmentInterval`），不引入 FFmpeg。** glide 正是这样做的：5K60 HEVC 下整个录制进程只占一个核的 10%，内存 56 MB（M4 Pro 实测）。macOS 有两个硬性事实要先接受：
   - 不签名（ad-hoc）时，苹果 TN3127 写明 DR（指定要求，代码身份）“tied to that specific version of the code”，**每次更新后屏幕录制权限都要重新授权**；
   - `setContentProtection` 挡不住 ScreenCaptureKit（Electron 文档），排除自己的窗口必须在 `SCContentFilter` 里做。
4. **画面按恒定帧率网格输出，网格上每一格取“该格时刻之前最新的一帧”。另写一份逐帧时刻表，记录每格用了哪一帧、这一帧的系统时刻，以及是新帧还是重复帧。** 这一条直接服务核心卖点：事件对齐可以精确到帧内，剪辑侧仍然拿到恒定帧率的文件。glide、OBS 都按网格出帧（OBS 的源码依据见第 2 节）。WGC 的 `SystemRelativeTime` 是“合成器渲染该帧时的 QPC”（微软文档原文），和我们原生进程的 `hc_clock`、主进程的 `hrtime` 是同一个计数器。macOS 上 ScreenCaptureKit 的 PTS 用 `mach_absolute_time`，而 **libuv 自 2020 年起改用 `mach_continuous_time`，机器休眠后两者会差开**（libuv 提交 4685be236b）。所以 macOS 上必须经原生进程现有的时钟校准换算，上一份调研“可直接对齐”的说法不对。
5. **进程模型照搬录音进程，画面单独一个进程，不和声音合并。** 协议照搬：stdin 一行一条 JSON 命令，stdout 是 u32 长度加 JSON 再加二进制，握手带协议号，事件分“不丢”与“可丢”两类，stdin EOF 时自行封口退出。不合并有两条依据：
   - Cap 的源码注释写明，设备被移除后 WGC 会在无法捕获的线程上直接 fail fast。显卡出事时整个进程会死，声音必须不跟着死；
   - 录音进程还服务音频编辑，生命周期不同。

   共享的只是一个小 crate：协议帧、时钟、日志条目格式。
6. **封装用单文件分片 MP4，每个关键帧（1 秒）一个分片，封装在采集进程内的独立写盘线程里做，不另起封装子进程。** 分片 MP4 只追加不回改，进程被杀最多丢最后一片，另起封装进程的收益很小。OBS 另起封装进程，是为了保住普通 MP4 的尾部；Cap 另起，是为了在录制进程死后写完手上的分片。正常停止时是否转成普通 MP4（`hybrid_fragmented`），由实验决定。**暂停时停止送帧，继续时从时间戳里扣掉暂停时长，并强制出一个 IDR 帧**（立即解码刷新帧，也是这里的关键帧），单文件、无空档。Cap Instant、Aperture、glide、OBS 都是这个思路，Cap Studio 例外（暂停时另起一段）。
7. **对上一份调研的核对**（第 3 节逐条）：
   - “Windows 上进程内调 gfxcapture 最稳”只对“行为和今天一模一样”成立，对“做好”不成立；
   - “先做 macOS”的收益论证成立，但验证条件不成立：本机和主链路都是 Windows，Mac 只能由你真机自测；
   - “Cap 的 scap-direct3d 依赖 cap-timestamp”已经过时，现在依赖的是 `cap-d3d-adapter`（同样不在 MIT 范围内）；
   - “libuv 在 macOS 上用 mach_absolute_time”有误；
   - stdin `c` 命令改 `setpts` 的代码路径，我在 release/9.0 源码上复核过，成立，但仍未实测。
8. **工作量粗估 25–35 人天，分五个阶段**（第 7 节）。动手前先做 10 个小实验（第 8 节），其中三个必须先做：Win10 19045 上 WGC 4K60 的出帧与时刻抖动、libav D3D11 NV12 送三家编码器、设备移除时进程的表现。

---

## 1. 现状要点（与本题有关的新发现）

上一份调研已写过的不再重复，这里只记本次新确认的几处。

| 项 | 依据 | 影响 |
|---|---|---|
| `gfxcapture` 的 `capture_border` 是“采窗口时带上窗口边框”，不是黄色提示框；黄框由 `display_border` 控制（默认关） | `vsrc_gfxcapture.c` 选项表；打包的 `ffmpeg.exe -h filter=gfxcapture` | 我们传 `capture_border=1`，不是 bug。但 Win10 上 `IsBorderRequired` 不存在（见第 5.1 节），无论传什么黄框都会画在屏幕上 |
| 打包的 FFmpeg 9.0.2 没有 `dup_frames` 选项（master 2026-10-17 才加），也没有 2026-10-23 的两处线程修复 | `ffmpeg.exe -h filter=gfxcapture` 的输出里没有 `dup_frames`；`release/9.0` 分支的提交记录 | 现在的静止补帧靠命令行 `-fps_mode cfr`；那两处竞态修复都不在我们的构建里 |
| `h264_qsv` 只接受 `NV12`、`QSV` 两种格式，硬件配置只有 `QSV` 帧和 `NV12`/`P010` 设备；`hevc_qsv` 多接受系统内存 BGRA，但同样不接受 D3D11 帧 | `qsvenc_h264.c` 的 `CODEC_PIXFMTS(AV_PIX_FMT_NV12, AV_PIX_FMT_QSV)`；`qsvenc.c` 的 `ff_qsv_enc_hw_configs` | 我们的命令行把 gfxcapture 的 D3D11 BGRA 帧直接接 `h264_qsv`，没有 `hwmap`。按源码推断会协商失败，然后走 `launchWithFallback` 退回软件编码。**Intel 核显用户很可能一直在用软件编码**（未实测，见 E5） |
| `h264_nvenc` 接受 `AV_PIX_FMT_D3D11`，并支持 RGB32、BGR32 等 RGB 输入；`h264_amf` 接受 D3D11 和 BGRA | `nvenc.c` 的 `ff_nvenc_pix_fmts`；`amfenc.c` | 现在的 NVENC、AMF 路径成立。但 RGB 到 YUV 的转换在编码器内部做，转换矩阵由厂商决定，我们没有显式控制（未核实，见 E4） |
| 服务端只要 Windows build ≥ 18362 就选 WGC，但 `IsCursorCaptureEnabled` 是 19041 才有的 | `service.ts` 第 217 行；微软文档该属性的版本区间从 `winrt-19041` 开始；FFmpeg 在没有 session2 时只打警告 `Cursor capture unavailable` | 原有问题（小）：Win10 1903、1909 上关不掉光标，光标会烧进画面，清单却记“未烧入”，剪辑时会出现双光标。这两个版本早已停止支持，影响面很小 |
| 摄像头在渲染进程里用 `getUserMedia` 加 WebCodecs | `tracks/devices.ts` | 与画面采集进程无关，见第 5.7 节 |
| 隐私打码是事后检测（`detect_screen_recording_sensitive_text`），加上录制时记下 DOM 密码框位置 | `recordingDomPrivacy.ts` | 不在采集进程里做，见第 5.7 节 |
| 我们自己的 4K60 基线：30 分钟长录 `h264_nvenc`，丢帧 0，重复帧 21 | `验收-长录.md` 第 35 行 | 新进程的验收至少要达到这个水平 |

---

## 2. 项目逐个记录

“直接用”指可以作为依赖引入；“借鉴”指只读代码学做法，借用时按原许可注明出处；“不碰”指既不依赖也不照抄。

### 2.1 用户点名的四个

| 项目 | 许可 / 维护 | 平台与接口 | 架构要点 | 结论 |
|---|---|---|---|---|
| **glide**（michaelshimeles） | MIT OR Apache-2.0；最后提交 2026-10-22，291 星，8 个开放 issue | 只有 macOS：ScreenCaptureKit，加 AVFoundation 摄像头与 AVAssetWriter | 绑定只用 `objc2-*` 0.3 系列，不用 screencapturekit crate。分三步：<br>• SCK 回调把 `CVPixelBuffer` 放进最多 4 个的队列；<br>• 节拍线程按 `1/fps` 网格取“不晚于该格时刻加半帧的最新一帧”，没有新帧就重复上一帧；<br>• 通过 `AVAssetWriterInputPixelBufferAdaptor` 零拷贝写入。<br>`setMinimumFrameInterval(9/(fps×10))`，即 0.9 倍帧间隔，注释说“as OBS does”。`queueDepth 8`。`420v` 时设 `colorMatrix` 为 ITU_R_709_2。编码设 BT.709 原色、传递函数与矩阵，每 2 秒一个关键帧，`movieFragmentInterval` 2 秒。暂停用网格格号区间（`Pauses`）表示，暂停的格子不写，输出时间轴连续。`frame_complete` 只认 `SCFrameStatus::Complete` | **借鉴（价值最高的 macOS 参照）**：网格节拍、暂停用格号、BT.709 配置、`tcc.rs` 的权限归属处理。它的实测数据是本次唯一可信的 macOS 4K 以上录制开销 |
| **screencapturekit-rs**（doom-fish） | MIT OR Apache-2.0；11.1.2（2026-11-02），crates.io 下载约 346 万 | 只有 macOS：SCK 全套，含 SCRecordingOutput、SCContentSharingPicker | 通过 Swift 桥接实现，`build.rs` 调 `swift build`，部署目标 12.3，构建机必须有 Xcode 工具链。2026-03 的 1.5.4 到 2026-10 的 11.x，八个月里发了好几个大版本。#135 修过“多个音频流时样本串流”（2026-03） | **可以直接用，但不推荐**：大版本变化太快，还要多一套 Swift 构建。glide 证明 `objc2-screen-capture-kit` 就够用。它 `docs/BENCHMARKS.md` 里“4K 15–30 FPS”的表是写死的“预期范围”，不是测出来的数，不要引用 |
| **scap**（CapSoftware，原 helmerapp） | MIT；最后提交 2025-08-05，48 个开放 issue，其中有多个编译失败的报告（#180、#182、#185） | Windows（windows-capture 1.5）、macOS（cidre 0.10）、Linux | Windows 上每帧 `buffer_crop` 再 `to_vec()` 拷到 CPU；时间戳用 `SystemTime` 推算 | **不碰**：每帧都拷到 CPU，而且已经停更。Cap 自己也改用了仓库内的 `scap-*` crate |
| **RustFrame**（salihcantekin） | MIT；最后提交 2026-07-01，38 星 | Windows（直接调 WGC）、macOS（SCK，用的是旧的 `objc 0.2`） | 用途是把屏幕区域共享给视频会议，不录制、不编码。Windows 上轮询 `TryGetNextFrame`，每帧新建 staging 纹理读回 CPU。尺寸变化时没有 `Recreate` | **借鉴价值低**。可以看它的“运行中切换光标”（`SetIsCursorCaptureEnabled` 在会话中调用）。它文档说“Windows 没有排除窗口的接口”，对“排除自己的窗口”这一项不成立：Win10 2004 起有 `WDA_EXCLUDEFROMCAPTURE`（见第 5.7 节） |

### 2.2 其他 Rust 项目

| 项目 | 许可 / 维护 | 要点 | 结论 |
|---|---|---|---|
| **Cap 主仓库**（`crates/*`） | `scap-*`、`cap-camera*` 为 MIT，其余 AGPLv3；24955 星，2026-11-13 当天仍有提交，437 个开放 issue | Windows 采集见下面的“Cap 的 Windows 采集”段；暂停与封装见下面的“Cap 的暂停、封装与回退”段 | **借鉴（Windows 边角情况的最佳参照）**。`scap-direct3d` 是 MIT，但依赖 AGPL 的 `cap-d3d-adapter` 和 workspace-hack，不能整包引入。许可上可以照抄 AGPL 部分（你接受 AGPL），但它和 kameo actor、Cap 的工程格式绑得很紧，**只借做法** |
| **windows-capture**（NiiightmareXD） | MIT；2.0.1（2026-08-08），下载约 275 万，22 个开放 issue；依赖 `windows =0.62.2`，与我们锁定的版本相同 | WGC 与 DDA 两种实现，详细读法见下面的“windows-capture 的实现”段 | **可以直接用，也可以借鉴。推荐自写薄层**，理由见第 6 节 |
| **crabgrab** | Apache-2.0；0.4.0（2024-06），仓库最后提交 2024-08 | — | **不碰**（停更） |
| **xcap**（nashaofu） | Apache-2.0；0.9.10（2026-11-09），活跃 | 以截图为主，视频录制标为 WIP。macOS 录制用的是 `AVCaptureScreenInput`，苹果在 macOS 15 发布说明里列为会触发系统警告的旧接口，并且逐帧拷到 CPU | **不碰** |
| **scrap**，以及 rustdesk 里的 `libs/scrap` | scrap 无许可声明，最后发布 2018；rustdesk 为 AGPL-3.0 | rustdesk 在 Windows 上用 DDA，`AcquireNextFrame` 失败时退到 GDI。它能采安全桌面，是因为服务以 SYSTEM 身份运行，这条路我们走不了 | **不碰**，只说明 DDA 退 GDI 是远程桌面类软件的常规做法 |
| **nokhwa** | Apache-2.0；0.10.11（2026-05），67 个开放 issue | 摄像头 | 暂不需要，见第 5.7 节 |
| **screenpipe** | **已改为 Screenpipe Commercial License**（`LICENSE.md`） | — | **不碰**，许可不允许 |
| **Kooha**（GNOME，仅作对比） | GPL-3.0 | 通过 xdg 门户（Linux 桌面的系统授权接口）、PipeWire 和 GStreamer 采集。`pause()` 把管线置为 `PAUSED`，`resume()` 置回 `PLAYING`，由 GStreamer 的运行时间机制保证单文件连续 | 只说明“暂停只是时间轴偏移”是各家通行的做法 |

**Cap 的 Windows 采集**（`scap-direct3d/src/lib.rs`、`screen_capture/windows.rs`）：

- **线程与设备**：用 free-threaded 帧池，大小按 `fps/30×2` 取整，限制在 2–4。设备开 `ID3D11Multithread::SetMultithreadProtected(true)`。
- **选显卡**（`d3d-adapter`）：跳过软件适配器和名字里带 Parsec、DisplayLink、Splashtop 等的虚拟适配器，取显存最大的物理卡。注释说线上遇到过虚拟显示驱动拆掉 D3D11 设备导致的静默崩溃。实在没有硬件才用 WARP（软件光栅化器）。
- **时间戳**：用 `SystemRelativeTime`，转换成 QPC。
- **限帧**：`FrameCadenceGate` 先估计来源的实际出帧速度，明显快于目标时才抽帧。注释写明 `MinUpdateInterval` 只在新版 Windows 上生效。
- **尺寸变化**：只有窗口采集才跟随尺寸 `Recreate`。`Recreate` 前先查 `GetDeviceRemovedReason`，注释原文是 WGC “fails fast, on a thread nothing here can catch, once its device is removed”。
- **裁剪越界**：复制时按表面尺寸限界，因为在 WARP 上源框越界会让设备被移除。
- **关闭分类**：分成设备被移除、目标消失、偶发三类，最多自动重启 3 次。
- **显示器分辨率变化**：保持原输出尺寸，后面缩放。

**Cap 的暂停、封装与回退**：

- **暂停**：Studio 模式每次暂停停管线、另起一段（`studio_recording.rs` 第 714–740 行，`next_index: index + 1`）。Instant 模式用 `SharedPauseState::adjust` 扣掉暂停时长，单文件（`core.rs` 第 2017 行起）。
- **补帧**：`frame_pacing.rs` 只在来源静默满 3 个帧间隔后才重复上一帧。注释说太早补会让“只是迟到”的真帧撞上补出来的帧的时间戳。
- **封装**：独立的封装进程 `cap-muxer` 写 2 秒一片的 DASH 分片，自带一套二进制协议：magic、版本、CRC、`InitVideo`/`Packet`/`Finish`/`Abort` 帧。
- **编码**：Windows 首选 Media Foundation 硬件 H.264 MFT。GPU 是 AMD 时直接跳过 MF 走 FFmpeg。`hardware_crash.rs` 记下哪个硬件编码器让进程崩过，下次启动跳过它。
- **macOS**：2026-08 改成零拷贝把 IOSurface 交给 `h264_videotoolbox`，4K30 下每帧 CPU 降 50%。但它凭写死的估值（`VIDEOTOOLBOX_4K_MAX_FPS = 55.0`）判定 4K60 超出硬件能力，退回 libx264，每帧 45 ms，见 `FINDINGS.md`。这个估值不是实测。

**windows-capture 的实现**：

- **WGC 线程**：在消息循环线程上运行，帧池只有 **1** 个缓冲，`FrameArrived` 里同步调用用户回调。
- **尺寸变化**：`ContentSize` 变了就 `Recreate`，并丢掉这一帧。
- **时间戳**：`Frame::timestamp()` 直接返回 `SystemRelativeTime`。
- **读回**：`Frame::buffer()` 每次新建 staging 纹理，也就是每帧分配一次。
- **编码器**：走 WinRT `MediaTranscoder` 输出普通 MP4。`send_frame` 把采集池的表面异步排队；作者在 #199 里自己承认这可能有表面生命周期问题。
- **设备移除**：没有处理。
- **相关 issue**：#190 的实测：60 Hz 屏上 `MinUpdateInterval = 1/60` 只拿到约 45 fps，设 1/90 才稳定 60 fps，作者回应是更新文档。#192：Intel QSV H.264 MFT 录出来偏粉红。#210 的约 55 fps 天花板最后查明是 Python 的 GIL，不是 WGC 的限制。

### 2.3 非 Rust 的成熟实现

| 项目 | 许可 / 维护 | 我们关心的做法 |
|---|---|---|
| **OBS**，Windows 的 WGC 与 DDA | GPL-2.0；2026-11-11 仍有提交 | 见下面的“OBS 的 Windows 采集”段 |
| **OBS**，macOS 的 SCK（`mac-sck-*.m`） | 同上 | `queueDepth 8`，`minimumFrameInterval = 帧间隔 × 0.9`。macOS 15 加 Apple Silicon 上取 `64RGBAHalf`，否则 `32BGRA`，色彩空间为 DisplayP3。保持 IOSurface 引用（`IOSurfaceIncrementUseCount`），只保留当前一帧和前一帧。`didStopWithError` 区分用户停止和采集源消失，只标记失败，交给界面处理。音频用 `presentationTimeStamp` 转纳秒 |
| **WebRTC / Chromium**，WGC | BSD-3；main 分支 | 见下面的“WebRTC 的 WGC 实现”段 |
| **WebRTC**，DDA | 同上 | HDR 显示器上返回 `R16G16B16A16_FLOAT`；处理旋转；显示配置变化时重新初始化（`display_configuration_monitor_`） |
| **WebRTC**，SCK（`screen_capturer_sck.mm`） | 同上 | 见下面的“WebRTC 的 SCK 实现”段 |
| **FFmpeg gfxcapture**（master） | LGPL 2.1+，在我们的 GPL 构建里整体按 GPL | free-threaded，2 个缓冲；尺寸变化时 `Recreate`。`MinUpdateInterval` 设成正好 1/fps，没有 session5 时只打警告 `framerate may be limited`。时间戳在输出时减掉 `first_pts`。`dup_frames`（新增）按 QPC 计时补帧。来源关闭时以 EOF 结束 |
| **FFmpeg ddagrab** | 同上 | 按自己的计时器（`av_gettime_relative`）节拍取帧，时间戳是节拍时刻，不是 `LastPresentTime`。光标用着色器自己画。支持 10 位和 HDR 输出格式 |
| **Aperture**（wulkano，Swift） | MIT；最后提交 2024-11-22 | SCK 加 AVAssetWriter，`queueDepth 6`，`showMouseClicks`（macOS 15）。暂停置标志，继续后用 `timeOffset` 扣掉暂停时长，单文件。**没有设 `movieFragmentInterval`，崩溃后文件不可读** |

**OBS 的 Windows 采集**（`winrt-capture.cpp`、`duplicator-monitor-capture.c`、`d3d11-duplicator.cpp`）：

- **WGC 线程与拷贝**：WGC 在 OBS 的图形线程上运行，帧池 2 个缓冲。每帧 `CopyResource` 到自己的纹理，然后立即释放采集表面。
- **尺寸**：`ContentSize` 变了就 `Recreate`。注释说 “ContentSize is not reliable”，所以实际尺寸以 `GetDesc` 为准。
- **HDR**：显示器开了 HDR 时请求 `R16G16B16A16_FLOAT`。
- **去黄框**：先调 `GraphicsCaptureAccess::RequestAccessAsync(Borderless)`，再设 `IsBorderRequired(false)`。
- **设备丢失**：`device_loss_release` 和 `device_loss_rebuild` 两个回调负责重建。
- **出帧节奏**：OBS 按自己固定帧率的渲染节拍出帧，不使用 `SystemRelativeTime`。
- **自动选接口**：默认 DDA。显示器不在 OBS 所用的显卡上时（`dxgi_index == -1`），或者是带电池且有两块以上显卡的笔记本时，改用 WGC。
- **失败重试**：采集失败后每 3 秒（`RESET_INTERVAL_SEC`）重试一次，并重新取 HMONITOR。
- **DDA 的错误处理**：`AcquireNextFrame` 返回 `ACCESS_LOST` 就重建；请求格式用 `DuplicateOutput1`，带上 FP16。
- **编码**：用厂商 SDK 直接吃纹理（`obs-nvenc/nvenc-d3d11.c`、`obs-qsv11/common_directx11.cpp`、`obs-ffmpeg/texture-amf.cpp`），AMF 还单独起一个探测子进程（`obs-amf-test`）。

**WebRTC 的 WGC 实现**（`wgc_capture_session.cc`、`wgc_capturer_win.cc`、`window_capture_utils.cc`）：

- **free-threaded 的原因**：源码注释写明，首帧可能很慢，用 `CreateFreeThreaded` 是为了不依赖 DispatcherQueue，也避免等首帧超时。等首帧最多 5 秒。
- **缓冲数**：CPU 模式 2 个，纹理模式 5 个。纹理模式只在 Win11 24H2 及以后开启，因为 24H2 起 WGC 只在内容变化时出帧；24H2 之前它自己做逐像素比较，判断画面有没有变。
- **去黄框**：`IsBorderRequired` 要求 10.0.20348，注释原文 “practically means Windows 11”。
- **`IsWgcSupported` 处理的系统缺陷**：
  - 没有活动显示器时 `CreateForMonitor` 会崩，这是 Win11 才修的系统缺陷；
  - 20H1 之前不能采整个虚拟屏幕。
- **窗口能否采**：最小化或不可见的窗口判为不可采（`IsWindowVisible && !IsIconic`）。
- **尺寸变化**：先重建映射纹理，再 `Recreate`。`Recreate` 失败时把映射纹理清掉，保证两者尺寸一致。
- **设备**：可以按 LUID 指定显卡；创建失败（`DXGI_ERROR_UNSUPPORTED`）就退 WARP。
- **出错分级**：分成 `ERROR_TEMPORARY` 和 `ERROR_PERMANENT`。

**WebRTC 的 SCK 实现**：

- **只在 macOS 14 及以上启用**。注释说 12.3 虽有 SCK，但 macOS 13 之前全屏采集有问题，`contentRect` 和 `pointPixelScale` 也是 14 才有的。
- **配置**：`32BGRA`、sRGB，`captureResolution` 为 Nominal。
- **帧状态**：`Complete` 和 `Started` 两种都当作有效帧。
- **帧信息**：读 `ScaleFactor`、`ContentRect`、`BoundingRect`、`DirtyRects`。
- **配置变化**：来源尺寸变了用 `updateConfiguration` 更新，不重建流。
- **停止**：处理 `didStopWithError` 和 14.4 新增的 `userDidStopStream`。
- **选择来源**：用 `SCContentSharingPicker`，系统提供的来源选择器。

---

## 3. 对上一份调研的逐条核对

| 上一份的说法 | 核对结果 | 依据 |
|---|---|---|
| 现在不换工具，先在命令行上做两处小改（路线 A） | **合理，本文不推翻**。新进程至少要 25 人天，命令行小改能先解决“继续后 1.6 秒没画面”的问题 | — |
| stdin 发 `c` 命令改 `setpts`，可以实现不换文件的暂停 | **代码路径正确，未实测** | 在 `release/9.0` 源码上复核：`check_keyboard_interaction` 每 100 ms 查一次按键；读到 `c` 后按 `%63[^ ] %lf %255[^ ] %255[^\n]` 解析，再调 `fg_send_command`；Windows 管道下用 `PeekNamedPipe`；`setpts.c` 的 `process_command` 把 `T_CHANGE` 置为 NaN，选项带运行时标志 `R` |
| Windows 上最稳的做法是进程内调 FFmpeg 的 gfxcapture | **部分正确**。“行为与今天完全一致”这一点成立。但“最稳”对长期目标不成立 | 见第 6.1 节的对比表 |
| 先做 macOS | **收益判断正确，顺序建议不采纳** | macOS 现在只有 Chromium 兼容路径，光标总烧进画面，这个差距确实最大。但：①主链路和本机都是 Windows，Mac 只能由你真机自测（记忆“2.0 正式版范围”）；②共享核心（协议、节拍、时刻表、日志、恢复）在 Windows 上能本机反复验收，做扎实后 macOS 只需替换采集与编码两层；③Windows 上的收益（逐帧 QPC、暂停无空档、设备丢失后恢复、Intel 核显用上硬件编码）每天都落在主链路上 |
| 可借的库是 windows-capture 与 screencapturekit | **部分正确**。两者都能借；windows-capture 的限制见第 2.2 节的“windows-capture 的实现”段。macOS 推荐用 `objc2-screen-capture-kit`，glide 已证明够用，而且和 AVFoundation、CoreMedia 是同一套绑定 | 第 2 节 |
| Cap 的录制管线是 AGPL，暂停时另起一段 | **部分正确**。Studio 模式是另起一段；Instant 模式是单文件扣暂停时长 | `studio_recording.rs` 第 714–740 行；`core.rs` 的 `SharedPauseState` |
| `scap-direct3d` 没发到 crates.io，依赖 `cap-timestamp`（AGPL）和 workspace-hack | **已过时**。现在的依赖是 `thiserror`、`tracing`、`workspace-hack`，Windows 上加 `cap-d3d-adapter`，这个 crate 同样不在 MIT 范围内；`cap-timestamp` 用在 `recording` crate 里 | `crates/scap-direct3d/Cargo.toml` |
| Cap 在 Windows 上走 MF 硬件 H.264 加 FFmpeg 封装，失败回退 libx264 | **部分正确**。回退目标是 Cap 自己的 FFmpeg H.264 构建器，它按主显卡厂商选 `h264_nvenc`/`h264_amf`/`h264_qsv`，超出写死的能力估值才用 libx264；主显卡是 AMD 时直接跳过 MF | `win.rs` 第 205–262 行；`enc-ffmpeg/src/video/h264.rs` 第 1439–1465 行 |
| windows-capture 2.0.1，MIT，下载约 275 万，`windows 0.62.2`；它自带的编码器走 `MediaTranscoder` | **正确** | `Cargo.toml`、`encoder.rs` |
| macOS 上 CMSampleBuffer 的 PTS 用 `mach_absolute_time`，libuv 的 hrtime 也是，可以直接对齐 | **前半句正确，后半句有误**。libuv 自 2020 年起在 macOS 上用 `mach_continuous_time`（包含休眠时间），2024 年起只保留这一种 | libuv `darwin.c`；提交 4685be236b、c0a61c3bb3 |
| macOS 上我们没有 FFmpeg 共享库，应直接用 AVAssetWriter | **正确** | `ffmpeg-loader.ts` 第 40 行；`electron-builder.yml` 的 mac 段 |
| QSV 在命令行路径下怎样协商成 NV12，未核实 | **本次读源码推断：协商不成，会退回软件编码**。需实验 E5 确认 | 第 1 节 |
| xcap 视频录制是实验功能；crabgrab、scap 停更 | **正确** | crates.io 元数据 |
| screenpipe 的许可标为 NOASSERTION，未细查 | **已查清：是商业许可，不能用** | `LICENSE.md` |
| Windows 进程内调 gfxcapture 时，取帧读 QPC 估首帧误差约 1–3 ms | **推测，仍未核实**。而且自写 WGC 层后，这个问题就不存在了 | — |

---

## 4. 采集接口的事实表

### 4.1 WGC 各属性的系统版本（微软 Learn，版本区间与 “introduced in”）

| 能力 | 引入版本 | 用户机器 Win10 19045 |
|---|---|---|
| `GraphicsCaptureSession`、`Direct3D11CaptureFrame.SystemRelativeTime` | 10.0.17134（1803） | 有 |
| `IGraphicsCaptureItemInterop`（`CreateForMonitor`/`CreateForWindow`） | 1903（18362），我们 `service.ts` 也按 18362 判断 | 有 |
| `IsCursorCaptureEnabled` | 10.0.19041（2004） | **有** |
| `IsBorderRequired`、`GraphicsCaptureAccess`（去黄框） | 10.0.20348 | **没有**，黄框一定会画 |
| `MinUpdateInterval` | 26100（24H2） | **没有**：只能拿到合成器给的全部帧，要自己抽帧 |
| `DirtyRegionMode` | 26100 | **没有** |
| `IncludeSecondaryWindows`（采窗口时带上 WS_POPUP、WS_EX_TOOLWINDOW 类窗口，比如提示条和下拉菜单） | 26100 | **没有**：Win10 上采单个窗口时，下拉菜单和提示条不在画面里 |
| 24H2 起 WGC 只在内容变化时出帧 | WebRTC 的 `DoesWgcSkipStaticFrames()` | Win10 上不保证 |

`SystemRelativeTime` 的定义是 “The QPC (Query Performance Counter) time at which the compositor rendered the frame”。也就是说，它是合成时刻，不是到达我们进程的时刻。

### 4.2 DDA（微软 Learn `DuplicateOutput`，以及 WebRTC、OBS、FFmpeg 的代码）

- 设备 “must be created from the adapter to which the output is connected”，这就是混合显卡笔记本上的跨卡问题。
- 安全桌面：`E_ACCESSDENIED`，原文 “only an application that runs at LOCAL_SYSTEM can access the secure desktop”。
- 模式切换或桌面切换时返回 `DXGI_ERROR_UNSUPPORTED`，要等 `EVENT_SYSTEM_DESKTOPSWITCH` 或 `WM_DISPLAYCHANGE` 之后重试。远程会话断开时返回 `DXGI_ERROR_SESSION_DISCONNECTED`。默认最多 4 个进程同时复制。
- 光标不在图像里，形状和位置要另外取。这一点对“不要光标”反而有利。
- 只能采整块显示器，不能采窗口。
- HDR 显示器上返回 FP16 格式，需要 `DuplicateOutput1`。

**取舍**：WGC 能采窗口、能跨显卡、能关光标，是 OBS 在笔记本上、Cap 全平台、WebRTC 的首选。DDA 只在 WGC 不可用时作后备。现阶段我们不实现 DDA：Win10 2004 以上都有 WGC 和光标开关，现有的 Chromium 兼容路径已经是后备。

### 4.3 ScreenCaptureKit（苹果文档 JSON，以及 WebRTC、OBS、glide 的代码）

| 能力 | 版本 | 说明 |
|---|---|---|
| `SCStream`、`showsCursor`、`minimumFrameInterval`、`queueDepth`（默认 3，Cap 注释说最大 8）、`SCStreamFrameInfo.displayTime`、`dirtyRects` | 12.3 | `displayTime` 的说明是 “the time the window server displays the frame” |
| `capturesAudio`（系统声）、`excludesCurrentProcessAudio` | 13.0 | Cap 实测 SCK 系统声比画面晚 100–250 ms（`FINDINGS.md`） |
| `contentRect`、`pointPixelScale`、`SCContentSharingPicker` | 14.0 | WebRTC 因此只在 14 及以上启用 SCK |
| `userDidStopStream` | 14.4 | 用户从菜单栏停止共享时触发 |
| `showMouseClicks`、`captureMicrophone`、`captureDynamicRange`、`SCRecordingOutput` | 15.0 | 点击高亮可以交给系统画，但我们需要“不烧进画面、事后自己画”，所以不用 |
| Core Audio 进程音频截取（`AudioHardwareCreateProcessTap`） | 14.2 | 系统声的另一条路，可以留在录音进程里做（见第 5.6 节） |

**权限**：

- macOS 15 发布说明只写了用旧接口（`CGDisplayStream`、`CGWindowListCreateImage`）会触发警告，应迁移到 SCK 和 `SCContentSharingPicker`。15.1 新增了 MDM 键 `forceBypassScreenCaptureAlert`。
- “SCK 不走系统选择器时也会每月重新确认一次”这一条只见于媒体与论坛报道（9to5Mac、TidBITS、MacRumors），**苹果开发者文档里没有找到原文**。
- **不签名的影响**：苹果 TN3127 原文是 “Ad hoc signed code … has a DR but it’s tied to that specific version of the code … Without a DR, macOS can’t track this authorization across versions of your app.” 也就是说，**每次更新后都要重新授权屏幕录制**。麦克风现在已经是这样。自签证书会不会让 DR 跨版本稳定、TCC 认不认，我没有实测；这属于分发方式的决定，由你定。
- **权限归属**：原生子进程的权限算在它的“负责进程”头上。由 Electron 应用拉起时，记在应用名下。glide 的 `tcc.rs` 处理的是从终端拉起时的情况，我们不涉及。

---

## 5. 设计问题逐条回答

格式：成熟项目怎么做 → 推荐我们怎么做 → 依据。

### 5.1 采集接口选择

**Windows**

- **成熟做法**：Cap、WebRTC 用 WGC；OBS 默认用 DDA，笔记本和跨卡时用 WGC。都按版本探测属性，不支持就退化或报错（`ApiInformation::IsPropertyPresent`，或 `QueryInterface` session2、3、5、6）。
- **推荐**：
  - 采显示器、窗口都用 WGC。设备建在编码用的那块显卡上，跳过虚拟适配器（照 Cap 的 `d3d-adapter`，并按 LUID 和我们的编码器选择保持一致），让 WGC 自己做跨卡复制。
  - free-threaded 帧池放 3 个缓冲，每帧到达后立即在 GPU 上转换并复制进我们自己的纹理环，然后释放 WGC 表面。
  - `IsCursorCaptureEnabled(false)`（19041 及以上；不支持就报错，不静默烧入光标）。
  - Win11 上先 `RequestAccessAsync(Borderless)` 再 `IsBorderRequired(false)`。
  - 26100 及以上设 `MinUpdateInterval = 0.9 / fps`，照 OBS 和 glide，不用正好 1/fps；低于 26100 不设，自己抽帧。
  - 不实现 DDA。
- **依据**：第 4.1、4.2 节，以及 windows-capture #190。

**macOS**

- **成熟做法**：
  - glide：`420v` 加 BT.709 矩阵、sRGB，`minimumFrameInterval` 为 0.9 倍帧间隔，`queueDepth 8`，排除本进程的窗口；
  - OBS：BGRA 或 64RGBAHalf，DisplayP3，0.9 倍，深度 8；
  - WebRTC：BGRA、sRGB，只在 14 及以上启用；
  - Cap：420v、sRGB，深度在 3 到 8 之间按帧率取。
- **推荐**：
  - 最低系统定 **macOS 14**，依据 WebRTC 的判断；Apple Silicon 也都能升到 14。
  - `420v`，`colorMatrix = ITU_R_709_2`，`colorSpaceName = sRGB`，`captureResolution = Best`（取 Retina 实际像素），`showsCursor = false`。
  - `minimumFrameInterval = 0.9 / fps`，`queueDepth 8`。
  - 用 `SCContentFilter(display:excludingWindows:)` 排除本应用的录制控制条和边框窗口（按 pid 收集 `SCWindow`，照 glide）。
  - 只把 `SCFrameStatus.complete` 当新帧。
- **依据**：第 4.3 节；Electron 文档说明 `setContentProtection` 挡不住 SCK。

### 5.2 每帧时刻

- **成熟做法**：
  - Cap 两边都用采集时间戳：Windows 用 `SystemRelativeTime` 转 QPC，macOS 用 PTS 转主机时间；
  - glide 把 SCK 的 PTS 放进按主机时钟排的网格；
  - OBS 的视频时刻是渲染节拍，不是采集时刻；
  - FFmpeg gfxcapture 只给相对第一帧的值；
  - 补静止帧：glide 按网格重复，Cap 静默 3 个帧间隔后才补，FFmpeg 用 `dup_frames` 或 `-fps_mode cfr`。
- **推荐**：
  1. 原生进程用和录音进程同一个 `hc_clock`：Windows 是 QPC，macOS 是 `mach_absolute_time`。WGC 的 `SystemRelativeTime` 和 SCK 的 PTS 不需要换算，就是这个时钟。主进程沿用 `correlateNativeClock` 每 5 秒校准一次（`client.ts` 第 96 行）。macOS 唤醒后偏移会跳，校准自然会跟上；唤醒后第一次校准完成之前的事件，按“唤醒前偏移”加上“系统报告的休眠时长”处理，或者在时间轴上标为不确定（见 E10）。
  2. 节拍器（照 glide）：恒定帧率网格的起点是第一帧的采集时刻。每一格取“采集时刻不晚于这一格加半帧”的最新一帧；没有新帧就重复上一帧。来源比目标帧率快时，自然只取每格最新的一帧，不需要单独的抽帧逻辑。
  3. **逐帧时刻表**：每一格记 `{格号, 源帧采集时刻 µs, 是否新帧}`，按二进制定长记录，60 fps 两小时约 43 万条，每条 12 字节，约 5 MB，放在和视频同目录的旁挂文件里，随分片一起落盘。事件对齐时查时刻表，找到“第一张采集时刻不早于事件时刻的新帧”，精度到帧内。剪辑侧仍然按恒定帧率使用文件。
  4. **丢帧与重复帧的统计口径**：
     - “重复”是没有新帧可用的格子，屏幕静止时这是正常现象，不报警；
     - “丢弃”是编码队列满了被迫跳过的格子，要上报；
     - “来源抽掉”是来源帧多于格子的部分，正常；
     - “来源停顿”是超过 N 个帧间隔没有任何帧，可能是锁屏或窗口最小化，单独计数，并把区间写进日志。
- **依据**：第 2 节各项目；`SystemRelativeTime` 的定义；libuv 的时钟差异。

### 5.3 编码与封装

**Windows**

- **成熟做法**：
  - OBS 自己渲染出 NV12 纹理，再用三家 SDK 直接吃纹理；
  - Cap 用 D3D11 VideoProcessor 转 NV12，送 MF H.264 MFT，AMD 例外，失败走 FFmpeg；
  - FFmpeg 命令行让 nvenc 和 amf 直接吃 BGRA D3D11 帧。
- **推荐**：
  - 一律先在 GPU 上把 BGRA 转成 **NV12，BT.709 有限范围**：缩放与转换在同一个 pass 里做（区域裁剪、4K 转 1080P）。
  - 首选 `ID3D11VideoContext1::VideoProcessorSetStreamColorSpace1` 和 `OutputColorSpace1`，输入 `DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709`，输出 `DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709`，显式写明，不用旧的位域结构体。旧结构体容易写错：按我的解读，Cap `video_processor.rs` 第 98–105 行把枚举值直接或进了位域，矩阵位实际是 0，即 BT.601（未实测）。
  - 也可以复用解码服务里已有的 HLSL 转换代码（`platform/windows/convert.hlsl`）写一个计算着色器。
  - 转换结果包成 libav 的 `AV_PIX_FMT_D3D11` 硬件帧（`sw_format = NV12`，帧池由我们分配），送 `h264_nvenc`/`hevc_nvenc`、`h264_amf`/`hevc_amf`。QSV 通过 `av_hwdevice_ctx_create_derived` 和 `av_hwframe_ctx_create_derived` 把 D3D11 帧映射成 QSV 帧，再送 `h264_qsv`/`hevc_qsv`。
  - 软件回退 `libx264`/`libx265` 时 `av_hwframe_transfer_data` 下载 NV12。
  - 在 `AVCodecContext` 里写 `color_primaries`、`color_trc`、`colorspace` 为 BT709，`color_range` 为 MPEG，保证写进码流的 VUI（视频可用性信息）。
- **HDR**：只录 SDR。显示器开 HDR 时，WGC 用 8 位 BGRA 采到的画面是否偏灰或过饱和，没有核实（E4 一并测）。需要的话再加 FP16 采集和色调映射，OBS 和 FFmpeg 的 `output_fmt=16bit` 都支持 FP16。
- **码率与关键帧**：沿用 `hwaccel.ts` 现有的质量档。GOP 从 30 帧改为 1 秒（60 帧），每个关键帧一个分片；暂停后继续时强制 IDR（nvenc 用 `forced-idr`）。`-bf 0` 保持不变，B 帧会让分片边界和实时性复杂。
- **4K60 数据**：
  - 我们自己：命令行 `h264_nvenc` 30 分钟，丢帧 0；
  - glide（macOS）：5K60 HEVC 录制进程占 10% 单核、56 MB；4K 导出时媒体引擎约 80–100 fps；
  - Cap：60 fps 设置下实测 58 fps，丢帧 1–2%，分辨率未注明。它的“VT 4K H.264 最多 55 fps”“NVENC 4K 120 fps”都是写死的估值。
  - 没有找到可信的 Windows 4K60 分厂商实测，用实验 E3 测。

**macOS**

- **成熟做法**：glide、Aperture、Cap Studio 用 AVAssetWriter；Cap Instant 用 FFmpeg `h264_videotoolbox`，零拷贝输入 IOSurface。
- **推荐**：AVAssetWriter，用 `AVAssetWriterInputPixelBufferAdaptor` 直接 append SCK 给的 `CVPixelBuffer`，零拷贝。
  - **编码参数**：HEVC 优先，体积更小，glide 的 5K60 实测可行。H.264 宽度上限 4096（Cap `FINDINGS.md`）。`AVVideoColorPropertiesKey` 设为 709，`MaxKeyFrameInterval` 为 1 秒，`expectsMediaDataInRealTime = true`。
  - **分片参数**：`movieFragmentInterval` 1 秒，`initialMovieFragmentInterval` 也是 1 秒。苹果文档提醒，首个分片写出之前崩溃，文件不可读。
  - **背压**：`isReadyForMoreMediaData` 为假时跳过这一格，计入丢弃（照 glide）。
- **依据**：苹果 `movieFragmentInterval` 与 `initialMovieFragmentInterval` 文档。

**容器与封装位置**

- **成熟做法**：
  - OBS 默认 Hybrid MP4（自研 muxer），ffmpeg-mux 另起进程；
  - Cap 另起进程写 2 秒 DASH 分片；
  - glide 用 2 秒分片的 MOV 或 MP4；
  - Aperture 用普通 MP4，崩溃即丢。
- **推荐**：
  - **单文件分片 MP4**。Windows 用 libavformat 的 `mp4`，`movflags = frag_keyframe+empty_moov+default_base_moof`；正常停止时是否加 `hybrid_fragmented`，由 E6 决定。macOS 用 AVAssetWriter 的分片 MP4。
  - **封装在采集进程内的写盘线程里做**，用有界队列，满了就丢帧并计数，不阻塞采集。理由：分片 MP4 只追加，进程被杀最多丢最后一片，另起封装进程的收益接近零；声音不在这个文件里，各自独立。
  - 不用 MKV：剪辑侧和解码服务都按 MP4 优化，分片 MP4 已经能在崩溃后读回。

### 5.4 暂停与继续

- **成熟做法**：
  - OBS：编码器不停，按时间戳丢帧，累计偏移（`pause.ts_offset`）；
  - Cap Instant：`SharedPauseState::adjust`；
  - Aperture：`timeOffset`；
  - glide：网格格号区间；
  - Kooha：GStreamer 管线 PAUSED/PLAYING；
  - Cap Studio：另起一段；
  - 编码器都不重建。
- **推荐**：
  - 暂停：节拍器记下暂停起点（网格格号），之后的格子不送编码器，WGC 和 SCK 继续采，以便继续时立刻有帧。
  - 继续：从第一格起，输出 PTS 等于网格时刻减去累计暂停的格数，并强制 IDR。
  - 逐帧时刻表照常记录，暂停区间写进日志，单位是会话时钟 µs，用来和事件、声音的暂停区间核对。
  - 声音在另一个进程，暂停按会话时钟对齐，沿用现有的 `alignRecordingPauses` 思路，容差可以收紧到 1 帧。
  - 长时间暂停（比如超过 10 分钟）可以选择停掉 WGC 省电，继续时重开。WGC 等首帧可能要几秒（WebRTC 的 5 秒超时），所以默认不停。
- **依据**：第 2 节各项目的代码。

### 5.5 稳定性的边角情况

| 情况 | 成熟项目怎么做 | 推荐 |
|---|---|---|
| 显示器分辨率或缩放变化 | WGC 的 `ContentSize` 变了就 `Recreate`（全部项目）。Cap 采显示器时保持原输出尺寸并缩放；FFmpeg 有 `resize_mode=scale_aspect`；OBS 以 `GetDesc` 为准。SCK：WebRTC 和 OBS 用 `updateConfiguration` 更新尺寸 | 输出尺寸在开始时定死，来源尺寸变了就在转换 pass 里等比缩放。每次 `Recreate` 前先查 `GetDeviceRemovedReason`（Cap）。尺寸变化写一条日志事件，事件坐标的换算要用到它 |
| 显示器拔掉或插上 | WGC 的 `Closed` 事件；Cap 区分“目标消失”和“设备被移除”；OBS 每 3 秒重新取 HMONITOR 再试；WebRTC 用 `IsMonitorValid`。SCK：`didStopWithError`，错误为采集源不存在（OBS） | 来源消失时：封口当前分片，上报 `sourceLost`。主进程按显示器的设备路径（不用 HMONITOR，它会变）重新定位，找到了就在**同一文件**里接着录：时间轴记一段来源缺失区间，节拍器在区间内补上一帧。找不到就保持“来源缺失”状态，等用户处理 |
| 窗口关闭或大小变化 | `Closed` 事件；窗口采集时跟随尺寸 `Recreate`（Cap 只对窗口这样做）；最小化时没有帧（WebRTC 的 `IsIconic`） | 关闭：结束这一段并上报。大小变化：等比缩放到固定画布。最小化：节拍器补上一帧，记为来源停顿。Win10 上窗口采集缺下拉菜单，见第 5.7 节 |
| 锁屏、UAC 安全桌面 | DDA：只有 LOCAL_SYSTEM 能访问（微软文档），OBS 遇到 `ACCESS_LOST` 就重建；rustdesk 靠 SYSTEM 服务 | WGC 在安全桌面期间的行为**没查到文档**（E8）。按“来源停顿”处理，补帧并记区间，不崩溃，不结束录制 |
| 显卡驱动重置或设备丢失 | Cap：WGC 会 fail fast，所以不把已移除的设备再交给它，最多重启 3 次；OBS：`device_loss_rebuild`；Cap：`hardware_crash` 记下肇事的编码器 | 整个进程可能直接死掉，这正是画面独立成一个进程的理由。主进程保留现在 `gfxcapture.ts` 的“意外退出就续录，一分钟内最多 5 次”。新进程在**新文件**里续录（旧文件按最后一个完整分片收尾），日志记下肇事的编码器，下次启动先退一档 |
| 休眠与唤醒 | 没找到成熟项目的专门处理 | E8 一并测。macOS 上时钟偏移会跳（第 5.2 节） |
| 独占全屏游戏 | OBS 用注入式游戏采集；DDA 在模式切换时会断 | 不在范围内，按来源停顿处理 |
| 远程桌面会话 | DDA：会话断开时返回 `DXGI_ERROR_SESSION_DISCONNECTED`；Electron 文档：`WDA_EXCLUDEFROMCAPTURE` 在远程会话中同样生效 | WGC 在远程会话里的表现**未查到**，不保证 |
| 采集显卡与编码显卡不同（混合显卡笔记本） | DDA 要求设备建在显示器所在的卡上（微软文档），所以 OBS 在笔记本上改用 WGC；Cap 固定用显存最大的物理卡；WebRTC 可以按 LUID 指定 | 设备建在编码卡上，由 WGC 跨卡复制。E1 在混合显卡机器上测帧率（没有这类机器就标未测） |
| 长时间录制的内存与句柄泄漏 | screencapturekit-rs 有专门的泄漏检查示例；Cap 有内存泄漏检测示例，并用 `leaks --atExit` 做过约 2000 次循环；windows-capture 每帧新建 staging 纹理 | 纹理环、hw 帧池、packet 缓冲在启动时一次分配好，循环里不分配。健康报告带 GPU 显存、私有字节、句柄数（解码服务已开 `Win32_System_ProcessStatus` 特性）。两小时长录作为每个阶段的验收项 |

### 5.6 进程模型与协议

- **成熟做法**：
  - OBS：ffmpeg-mux 子进程，管道 EOF 时写完尾部；
  - Cap：封装进程，二进制帧协议带 CRC，最多重启 3 次，磁盘满用专门的退出码 60，并有“录制进程死后封装进程写完分片”的测试；
  - 我们的录音进程：stdin 一行一条 JSON 命令；stdout 是 `u32 LE 长度 + JSON + binaryBytes 二进制`；`hello` 握手带协议号，不配套就失败；`clock` 用于校准；不丢事件和可丢的健康报告分两个通道（`segments.rs` 的 `Reliable`/`Lossy`）；stdin EOF 后写完封口再退出，最多等 100 秒；主进程失联后再给 120 秒宽限。
- **推荐**：新进程 `henji-screen-capture` 完全照录音进程的协议约定。
  - **命令**：`hello`、`clock`、`sources`（枚举显示器和窗口，带设备路径与 DPI）、`start{sessionId, directory, source, region, fps, size, codec, encoder, rateControl}`、`pause`、`resume`、`stop`、`status`、`recover{path}`。
  - **不丢事件**：
    - `started`：带实际编码器、尺寸、首帧时刻；
    - `fragment`：带文件、偏移、字节数、起止格号、关键帧时刻，由写盘线程在分片落盘后发出；
    - `sourceChanged`：尺寸变化、来源消失、来源恢复；
    - `paused`/`resumed`：带格号与会话时刻；
    - `stopped`：带总格数与时刻表长度；
    - `interrupted`：带错误码，比如 `DEVICE_REMOVED`、`DISK_FULL`、`ENCODER_FAILED`。
  - **可丢健康报告**（每秒一次）：采集帧数、新帧数、重复格、丢弃格、来源停顿、编码队列长度与最大值、写盘最大耗时、已写字节、GPU 显存与句柄数。
  - **预览缩略图**（可选，可丢，二进制）：低频 JPEG，供录制控制条显示。
  - **日志**：主进程写 `video.journal`，按 `fragment` 事件追加。恢复时扫描文件里最后一个完整的 `moof + mdat` 并截断，以文件为准，日志只用来交叉核对。这和录音“以物理长度为准”是同一个原则。
  - **主进程或界面崩溃**：stdin EOF，进程写完已排队的分片，正常停止时写尾部，然后退出。界面重载不影响，界面只是观察者，和现在一样。
- **共享 crate `native/capture-core`**（同一个 Cargo workspace，或用 path 依赖）：协议帧读写、`hc_clock`、可靠与可丢两个输出通道、日志条目类型。录音进程改用它属于可选的后续工作，不夹带进本工程。
- **画面和声音要不要合进一个进程**：
  - 合并的好处：少一次时钟校准；系统声和画面可以封进同一个文件。
  - 合并的坏处：
    - 显卡驱动出事时，WGC 会让整个进程直接死掉（Cap 的注释）；
    - 录音进程还服务音频编辑和“一路麦克风分给多个消费者”的模型，生命周期与画面不同；
    - 现在长录验收中“编码器被强杀，系统声 1805 秒没断”的隔离就没有了；
    - PortAudio、ASIO 驱动和 GPU 驱动跑在同一个进程里，出事时互相牵连。
  - **结论：不合并。** macOS 上的系统声也建议放在录音进程里，用 Core Audio 进程音频截取（14.2+）实现；不要因为 SCK 顺带能采声音，就把声音放进画面进程（Cap 实测 SCK 系统声晚 100–250 ms）。这个分工要你拍板，见第 9 节。

### 5.7 其余采集源

- **窗口**：
  - Windows 用 WGC 的 `CreateForWindow`。Win10 上没有 `IncludeSecondaryWindows`，下拉菜单和提示条采不到，这对教程录制是硬伤。所以“录一个窗口”在 Win10 上建议实现为“采窗口所在的显示器，再按窗口矩形实时裁剪”：跟随移动和缩放，矩形用 `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` 取得。缺点是其他窗口挡在前面时也会被录进去。Win11 24H2 以上再用真正的窗口采集加 `IncludeSecondaryWindows(true)`。Cap 在 macOS 上做了类似的“显示器裁剪加排除”（`capturable_window` 的注释）。这个取舍需要你确认，见第 9 节。
  - macOS 用 `initWithDesktopIndependentWindow`，或者显示器加 `sourceRect`。
- **区域**：显示器采集加 GPU 裁剪（`CopySubresourceRegion` 或转换 pass 的源矩形），坐标按物理像素换算，录制中不改区域。
- **自己的窗口**：Windows 继续用 `setContentProtection(true)`，即 `WDA_EXCLUDEFROMCAPTURE`，Win10 2004 起支持，我们已经在用。注意 Electron 文档说的“下一次合成才生效”。macOS 必须在 `SCContentFilter` 里按 pid 排除。
- **摄像头**：现在在渲染进程里用 `getUserMedia` 加 WebCodecs，单独一路文件。建议**不动**。等需要“录制中实时画中画，而且要与屏幕逐帧同步”时，再把摄像头放进画面进程：Windows 可以借鉴 Cap 的 `cap-camera-windows`（MIT），macOS 用 AVFoundation，glide 也是这样。nokhwa 不需要。
- **隐私打码**：**不在采集进程里做**。理由：①AI 原生的做法是先出结果、人确认、可撤销，采集时打码不可逆；②事后检测（OCR、DOM 密码框位置）已经有了；③采集进程要尽量简单稳定。只有“完全不想录进去的窗口”才用系统级排除。

### 5.8 构建与分发

- **Windows**：
  - 新 crate 用 `windows =0.62.2`，增加 `Graphics_Capture`、`Graphics_DirectX_Direct3D11`、`Win32_System_WinRT_Direct3D11`、`Win32_System_WinRT_Graphics_Capture`、`Foundation_Metadata`、`Win32_Graphics_Dxgi` 等 feature；
  - 加上 `ffmpeg-sys-next =9.0.0`，feature 为 `avcodec`、`avformat`（`avutil` 随附）；
  - 链接现在随包的 BtbN `win64-gpl-shared-9.0`，构建、定位、CRT 处理沿用 `scripts/video-decoder-ffmpeg.cjs` 和 `lib/nativeCrt.cjs`；
  - 产物放进 `resources/video-decoder/`，和解码服务共用同一份 DLL（electron-builder 的 `win.extraResources` 已经整目录拷贝）；
  - 新可执行文件按 **GPL-3.0-or-later** 分发，与解码服务相同。
- **厂商 SDK**：运行时都在显卡驱动里，我们不再分发任何东西。FFmpeg 编译用到的头文件：nv-codec-headers 是 MIT（`nvEncodeAPI.h` 的文件头），AMF 是 MIT（`LICENSE.txt`，附带“AMD 不授予编解码标准相关专利”的声明），oneVPL（libvpl）是 MIT。这些都已经含在 BtbN 构建里，不需要另行处理。
- **macOS**：
  - 依赖 `objc2 0.6` 与 `objc2-screen-capture-kit`、`objc2-av-foundation`、`objc2-core-media`、`objc2-core-video`、`objc2-foundation` 0.3（Zlib OR Apache-2.0 OR MIT），不需要 Swift 工具链；
  - 产物放进 `resources/`，和 `henji-audio-capture` 并列；
  - 新可执行文件不链接 FFmpeg，许可可以与录音进程一致（GPL-3.0-only）。
- **共同点和各自独有的部分**：
  - 共同：协议、时钟接口、节拍器、逐帧时刻表、日志、健康计数、恢复里的“扫描到最后完整分片”（两边都是 ISO BMFF，Rust 里扫 box 的约 100 行可以共用）；
  - Windows 独有：WGC 封装、D3D11 转换、libav 编码与封装；
  - macOS 独有：SCK 封装、AVAssetWriter。
- **CI**：
  - `build.yml` 已经有 `windows-latest` 和 `macos-latest` 矩阵（录音进程用）；
  - 新进程在两边都跑 `cargo test`，测节拍器、暂停换算、时刻表、协议、日志、box 扫描这些纯逻辑，再做 release 构建；
  - 实际采集和编码在 CI 上跑不了：runner 没有显卡，也没有屏幕录制权限。用本机实验和 Reality 验收覆盖。

---

## 6. 推荐的目标架构

### 6.1 Windows：自写 WGC 层，还是进程内调 gfxcapture，还是 windows-capture

| 维度 | 进程内调 libavfilter 的 gfxcapture | 依赖 `windows-capture` | **自写 WGC 薄层（推荐）** |
|---|---|---|---|
| 每帧绝对时刻 | 拿不到（减了 `first_pts`） | `SystemRelativeTime` | `SystemRelativeTime` |
| 和今天行为一致 | 完全一致 | 基本一致 | 基本一致 |
| 设备丢失、来源关闭 | 只会以 EOF 或错误结束 | `Closed` 有回调，设备移除没处理 | 按 Cap 和 WebRTC 的分类处理 |
| 帧池与线程 | 2 个缓冲，free-threaded，自带线程 | 默认 1 个缓冲，消息循环线程同步回调；v2 有 free-threaded 版本 | 3 个缓冲，free-threaded，到帧立即转换复制 |
| 限帧 | `MinUpdateInterval = 1/fps`（会少帧） | 由调用方设置 | 0.9/fps，低于 26100 自己抽 |
| 修复节奏 | 跟 FFmpeg 发版，9.0 分支没有 2026-10 的修复 | 跟作者发版，1.x 到 2.x 有 API 变化 | 我们自己掌控 |
| 代码量 | 最少 | 少 | WGC 部分约 600–900 行 |
| 许可 | 随 FFmpeg（GPL） | MIT | 我们的代码，借鉴部分注明 MIT 出处 |

windows-capture 也可以作为依赖起步，后面再替换。但它在帧池大小、回调线程、表面生命周期、设备移除这几处都要绕开，这几处恰好是“做好”的关键。所以推荐一开始就自写，并参照它和 scap-direct3d。

### 6.2 模块划分

```
native/capture-core/            （共享，纯 Rust）
  protocol   命令解析、u32+JSON+二进制输出、可靠/可丢两个通道、握手协议号
  clock      hc_clock（QPC / mach_absolute_time）
  pacer      恒定帧率网格、暂停格号区间、新帧/重复/丢弃/停顿计数
  timing     逐帧时刻表的定长记录写入
  journal    fragment 事件结构；ISO BMFF 扫描与截断到最后完整分片
  health     计数汇总与每秒上报

native/screen-capture/          （henji-screen-capture 可执行文件）
  main       命令循环；stdin EOF 时收尾
  session    一次录制：源 → 转换 → 节拍 → 编码 → 写盘 的线程编排与有界队列
  windows/
    adapter    选显卡（跳过虚拟/软件适配器，按 LUID 与编码器一致）
    wgc        创建 item（monitor/hwnd）、free-threaded 帧池、属性探测、Closed/Recreate/设备移除
    convert    BGRA→NV12 BT.709 有限范围（VideoProcessor 或计算着色器），裁剪与等比缩放，纹理环
    encode     libav hw 帧池；nvenc/amf/qsv(派生)/x264 回退；强制 IDR；色彩元数据
    mux        libavformat mp4 分片、写盘线程、hybrid 收尾（视 E6）
  macos/
    sck        SCShareableContent、过滤器（排除本进程窗口）、SCStream 配置、帧状态、didStop/userDidStop
    writer     AVAssetWriter + PixelBufferAdaptor、分片间隔、背压、暂停偏移

electron/main/services/screen-recording/capture/
  native.ts  新后端 NativeCaptureBackend（实现 ScreenCaptureBackend），沿用 GfxCaptureBackend 的续录与限次逻辑
  （service.ts 按平台选：Win 原生 / mac 原生 / chromium 兼容）
```

数据流：

- **Windows**：`WGC 帧（GPU）→ 转换 pass 写入我们的 NV12 纹理环（GPU）→ 节拍器选格 → libav 编码（GPU 编码器读纹理）→ packet 队列 → 写盘线程（fMP4 + 时刻表）`。全程不经 CPU 内存；软件编码回退时才下载。
- **macOS**：`SCK 的 IOSurface（420v）→ 节拍器选格 → AVAssetWriter（VideoToolbox 读 IOSurface）`。

### 6.3 依赖清单与许可

| 依赖 | 用途 | 许可 | 状态 |
|---|---|---|---|
| `windows =0.62.2` | WinRT、D3D11、DXGI | MIT OR Apache-2.0 | 已用 |
| `ffmpeg-sys-next =9.0.0` | libavcodec、libavformat 绑定 | WTFPL（绑定本身） | 已用 |
| FFmpeg 9.0.2 BtbN gpl-shared | 编码与封装 | GPL-3.0（构建整体） | 已随包，已履行源码义务 |
| `serde`、`serde_json`、`crossbeam-queue` | 协议、队列 | MIT OR Apache-2.0 | 已用 |
| `objc2` 0.6、`objc2-*` 0.3 | macOS 的 SCK、AVFoundation、CoreMedia、CoreVideo | Zlib OR Apache-2.0 OR MIT | 新增（仅 macOS） |
| 借鉴：windows-capture、Cap `scap-*`、glide、Aperture | 做法与少量代码 | MIT（glide 为 MIT OR Apache） | 借用的代码段在注释里注明出处 |
| 只读参考：Cap 的 AGPL 部分、OBS（GPL-2.0+）、WebRTC（BSD-3）、FFmpeg（LGPL/GPL） | 边角情况的处理方式 | — | 不拷贝代码 |

### 6.4 明确不建议

- 进程内调 libavfilter 的 gfxcapture，原因见第 6.1 节。
- 把 `MinUpdateInterval` 设成正好 1/fps（windows-capture #190 的实测）。
- 把 WGC 表面一直拿着，等异步编码用完再还：帧池会被占满，windows-capture #199 也有这类迹象。正确做法是到帧立即复制，然后释放。
- 每帧新建 staging 纹理或分配 CPU 缓冲（windows-capture、RustFrame、scap 都这样做）。
- 让 NVENC、AMF 内部去做 RGB 到 YUV 转换，以致色彩矩阵随厂商变化。
- 以 Media Foundation 编码 MFT 为主路径：Cap 在 AMD 上整体跳过 MF；windows-capture #192 报过 Intel MFT 偏色。
- 以 DDA 为主路径（不能采窗口，混合显卡有跨卡问题，安全桌面也采不了）。
- 画面和声音合进一个进程，或者另起封装子进程。
- 引入 libobs、scap、xcap、crabgrab、scrap，或者使用 screenpipe 的任何代码。
- macOS 上为了统一而引入 FFmpeg 动态库，或依赖 screencapturekit-rs 的 Swift 桥接。
- 采集时打码。
- 照抄 Cap 的写死能力估值（比如“VT 4K H.264 最多 55 fps”）。

---

## 7. 分阶段落地路线

前置条件：上一份调研的“分片加文件内起点”模型改造（A3），它同时是路线 A 和本工程的前置。路线 A 的命令行小改可以先做，用来先消掉暂停空档；本工程开工后，`gfxcapture.ts` 整体删除，按项目规则不留两套。Chromium 兼容路径保留。

| 阶段 | 产出 | 验收办法 | 粗估人天 | 风险 |
|---|---|---|---|---|
| **P0 小实验** | 第 8 节的 E1–E5、E7（Windows 部分），每个一个独立的小程序或命令，结果记进本目录 | 每个实验按判定标准给出“通过/不通过”与数据 | 3–4 | E3 的 QSV 派生路径可能走不通，那就退到“QSV 用系统内存 NV12”或“Intel 用 AMF 之外的软件编码”，需要你决定 |
| **P1 共享核心加 Windows 最小闭环** | `capture-core`（协议、时钟、节拍器、时刻表、日志），Windows 上打通 WGC → NV12 → `h264_nvenc` → fMP4；新后端接进 `service.ts`，用设置开关切换 | `cargo test` 覆盖节拍器、暂停换算、box 扫描；本机 4K60 录 10 分钟：丢弃格为 0，时刻表与文件帧数一致，事件对齐误差 ≤ 1 帧（E2 的方法） | 7–9 | WGC 线程模型；libav hw 帧池的生命周期 |
| **P2 Windows 做完** | 暂停与继续（单文件、强制 IDR）；AMF、QSV、软件回退与“肇事编码器”记录；来源尺寸变化、来源消失、窗口最小化与关闭、设备移除后续录；健康上报接入界面与日志；恢复入口；Win10 窗口录制按“显示器加跟随裁剪”实现（需你确认） | 跑完现有录屏 Reality 与长录验收：两小时、强杀进程一次、界面重载一次、暂停十次；再加 E7、E8 的场景 | 8–10 | 驱动重置和锁屏的行为没有文档；Intel 与 AMD 机器不在手边，需要借机器，或者标为未实测 |
| **P3 macOS** | SCK 加 AVAssetWriter；排除本应用窗口；权限检查与引导；时钟唤醒处理；系统声按第 5.6 节的分工放在录音进程（Core Audio 进程音频截取），或者暂不做 | 你在 Mac 真机上按清单自测：4K60 十分钟、暂停、拔外接屏、强退后读回、休眠唤醒后对齐；CI 构建与单元测试 | 8–12 | Agent 无法本机验证；TCC 在 ad-hoc 签名下每次更新都会重新授权；最低档 Apple Silicon 上 4K60 H.264 的能力（E9） |
| **P4 收尾** | 删掉 `gfxcapture.ts`、`process.ts` 中只给 FFmpeg 采集用的部分，以及相关测试；文档；许可清单（`gen:licenses`） | 静态检查与相关测试；`check:main-imports` | 2–3 | — |
| **合计** | | | **28–38** | |

---

## 8. 动手前的小实验

| 编号 | 要回答的问题 | 方法 | 判定标准 |
|---|---|---|---|
| **E1** | Win10 19045 上 WGC 采 4K、150% 缩放的显示器，60 Hz 时实际出帧多少？`SystemRelativeTime` 的间隔抖动多大？静止画面时还出帧吗？ | 一个小 Rust 程序：free-threaded 帧池，只记 `SystemRelativeTime` 和到达时的 QPC；分别在播放 60 fps 测试视频、拖动窗口、静止三种情况下各录 60 秒 | 动态内容时 ≥ 59.5 fps；帧间隔 p99 与 16.67 ms 相差 < 2 ms；“到达 − 合成时刻” p99 < 10 ms。静止时的表现如实记录，用来校正节拍器的停顿阈值 |
| **E2** | 事件时刻和画面时刻之间的固定延迟是多少？能否对齐到 1 帧以内？ | 程序自己在屏幕上随机闪烁色块，记下 QPC，用 E1 的程序找到第一帧出现该色块的 `SystemRelativeTime` | 延迟分布的标准差 < 1 帧；中位数作为常数补偿写进设计 |
| **E3** | libav 能否把我们自己分配的 D3D11 NV12 纹理送进 `h264_nvenc`、`hevc_nvenc`、`h264_amf`、经派生的 `h264_qsv`？4K60 下的 CPU 与延迟各是多少？ | 用纯色加时间码的合成纹理喂编码器 120 秒，量进程 CPU、编码延迟、输出码率 | 能初始化的编码器全部初始化成功；NVENC 上 4K60 进程 CPU < 一个核的 10%，编码延迟 p99 < 2 帧。手边没有的显卡标为未测 |
| **E4** | 色彩：BGRA 转 NV12（BT.709 有限范围）后的结果是否正确？FFmpeg 命令行让 NVENC 直接吃 BGRA 时，它内部用哪个矩阵？HDR 显示器上 8 位采集是什么样子？ | 采一张已知色值的测试图，两条路径分别编码，再用解码服务解码后比较 | 新路径的 ΔE2000 平均值 < 1。旧路径的偏差如实记录；HDR 机器不在手边时标为未测 |
| **E5** | 现在的命令行在 Intel 核显上，`gfxcapture` 接 `h264_qsv` 是否失败并退回软件编码？ | 在 Intel 核显机器上（或者用 `-init_hw_device qsv` 加上同样的滤镜链）跑现有命令，看日志里有没有 `recording.capture.encoder.fallback` | 有，就作为原有问题单独记录并修（`hwmap=derive_device=qsv`），不并入本工程 |
| **E6** | 分片 MP4，以及加上 `hybrid_fragmented` 时：正常停止、写尾部途中被杀、写分片途中被杀，三种情况下我们的解码服务和 ffprobe 能否读回？ | 用 libav 写 4K60 文件，在三个时刻 `TerminateProcess` | 分片 MP4 最多丢 1 片（1 秒）；`hybrid_fragmented` 被杀在写尾部途中时，仍能按分片读回，否则正常停止时不用它 |
| **E7** | 设备被移除时进程怎么样？是直接 fail fast，还是能收到回调？续录要多久？ | 用 Windows 图形工具 `dxcap -forcetdr`，或在设备管理器里禁用再启用显卡 | 不能让主进程受影响；新进程 5 秒内恢复出帧；旧文件读得回来 |
| **E8** | 锁屏、UAC 安全桌面、休眠唤醒、拔插显示器、远程桌面连入时，WGC 怎么表现？ | 用 E1 的程序逐一触发，记录有没有帧、`Closed` 事件、错误码 | 进程不崩，记录每种情况的表现，据此定节拍器和主进程的处理方式 |
| **E9** | macOS 最低档 Apple Silicon 上，SCK 4K60 420v 接 AVAssetWriter 的 H.264 和 HEVC 能否稳住 60 fps？强退后文件能否读回？用 ad-hoc 签名重建后 TCC 怎么提示？ | 你在 Mac 真机上运行我们提供的小程序 | 两种编码都 ≥ 59 fps，或者明确只有 HEVC 能达到；强退后最多丢 1 片；TCC 的表现如实记录 |
| **E10** | macOS 休眠唤醒后，SCK 的 PTS、`mach_absolute_time`、Node 的 `hrtime` 三者偏移怎样变化？ | 小程序每秒打一次三个值，中间让机器睡 5 分钟 | 确认唤醒后的偏移跳变量等于休眠时长，校准后误差 < 1 ms |

---

## 9. 需要你拍板的取舍

1. 实施顺序：Windows 打底，macOS 紧随（本文建议），还是按上一份调研先做 macOS。
2. Win10 上“录一个窗口”改成“显示器加跟随裁剪”（能录到下拉菜单，但挡在前面的窗口也会进画面），还是保留真正的窗口采集（下拉菜单录不到）。
3. macOS 系统声放在录音进程（Core Audio 进程音频截取，14.2+，与 Windows 分工一致），还是由画面进程的 SCK 顺带采集（实现更快，但声音和画面会耦合，而且实测有延迟）。
4. macOS 最低系统版本定为 14。
5. ad-hoc 签名下，每次更新都要重新授权屏幕录制，这是 TN3127 写明的系统行为。要不要改变分发方式，由你决定。

---

## 10. 未查到或未核实

- **WGC 在锁屏、UAC 安全桌面、休眠唤醒、远程桌面会话中的行为**：查了微软 Learn 的 WGC 命名空间与类文档、WebRTC 和 OBS 源码，并做了网络搜索，都没有找到说明。只有 DDA 的行为有文档。待 E8。
- **WGC 设备被移除时进程是否真的 fail fast**：只有 Cap 源码注释的说法，没有微软文档。待 E7。
- **黄色提示框会不会进入采集画面**：我的印象是只画在屏幕上、不进画面，没有找到文档原文。
- **NVENC、AMF 直接吃 BGRA 时内部用的 RGB 到 YUV 矩阵**：查了 FFmpeg `nvenc.c`、`amfenc.c`，没有显式设置。厂商文档没查。待 E4。
- **Cap `video_processor.rs` 的色彩空间位域写法是否真的导致 BT.601**：只是读代码得出的推断，没有运行。
- **QSV 的 D3D11 到 QSV 派生映射在 libav API 下能否零拷贝工作**：只读了 `qsvenc.c` 的硬件配置。待 E3。
- **现在 Intel 核显用户是否在用软件编码**：源码推断，待 E5。
- **`hybrid_fragmented` 被杀时的可读性**：待 E6，同时也是对照 OBS 第 4 项的遗留。
- **Win10 上 WGC 采静止画面时出帧的规律**：只有 WebRTC 的“24H2 起只在变化时出帧”这一条，24H2 之前的具体规律不明。待 E1。
- **混合显卡笔记本上 WGC 跨卡复制的 4K60 帧率**：没有找到实测（windows-capture #210 最后查明是 GIL 问题）。
- **macOS 15 的“每月重新确认”对 SCK 是否适用**：只有媒体与论坛报道，苹果的 15.0、15.1 开发者发布说明里没有对应原文。
- **SCK 的最大分辨率与帧率上限**：苹果文档没有给出数值；`minimumFrameInterval` 文档只说默认是系统支持的最大帧率。
- **Apple Silicon 各档芯片上 VideoToolbox 4K60 H.264 的实际吞吐**：只有 glide（M4 Pro）的数据和 Cap 写死的估值。待 E9。
- **windows-capture 2.0.1 的 free-threaded 路径如今是否仍有表面生命周期问题**：#199 的提问者没有回复复测结果，issue 已关闭。
- **Chromium 当前对 `cursor: 'never'` 的支持**：本次没有再查，沿用上一份调研的结论（未核实）。

参考链接：

- [微软 GraphicsCaptureSession](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession)
- [微软 MinUpdateInterval](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.minupdateinterval)
- [微软 SystemRelativeTime](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframe.systemrelativetime)
- [微软 DuplicateOutput](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput)
- [微软 SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)
- [苹果 TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
- [苹果 SCStreamFrameInfo.displayTime](https://developer.apple.com/documentation/screencapturekit/scstreamframeinfo/displaytime)
- [苹果 movieFragmentInterval](https://developer.apple.com/documentation/avfoundation/avassetwriter/moviefragmentinterval)
- [macOS 15 发布说明](https://developer.apple.com/documentation/macos-release-notes/macos-15-release-notes)
- [macOS 15.1 发布说明](https://developer.apple.com/documentation/macos-release-notes/macos-15_1-release-notes)
- 关于“每月确认”的报道：[9to5Mac](https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/)、[MacRumors](https://macrumors.com/2024/10/07/apple-screen-recording-popup-update)、[TidBITS](https://tidbits.com/2024/08/19/apple-reduces-excessive-sequoia-permission-requests-shifts-to-monthly)
- [Electron setContentProtection](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)
- [windows-capture #190](https://github.com/NiiightmareXD/windows-capture/issues/190)
- [libuv 提交 4685be236b](https://github.com/libuv/libuv/commit/4685be236b)
