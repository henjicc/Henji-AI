# 结果：录屏系统声挪进 Rust 录音进程（2026-11-13）

用户 2026-11-13 决定“只要是我们自己写的，都改成 Rust”（FFmpeg 不动）。本次把 Windows 上录屏的系统声从界面进程（浏览器 getDisplayMedia 回环 + AudioWorklet）挪进独立的原生录音进程：与麦克风一样，独立于界面和主进程卡顿，边录边写成中途断掉也能读的文件，界面只是观察者。验证级别 L2（原生协议、主进程服务、IPC、preload）。未提交、未碰 git、未启动或重启开发版，未重建 `native/audio-capture/target/release` 里的正式程序。做过两轮独立审查（第七节）。

## 一、选型与依据

### 先确认现在采的是什么
- 界面这一路：`getDisplayMedia({ audio: true })` → 主进程 `setDisplayMediaRequestHandler` 回 `audio: 'loopback'`（`electron/main/services/media-permissions.ts:72`）。Electron 在 Windows 上把它交给 Chromium 的默认输出设备回环，采的是**整个系统混音**（默认输出设备、eConsole 角色），与选的窗口无关，也包含痕迹AI自己发出的声音。
- 所以原生实现保持“整个系统混音、跟随默认输出设备”，**不做按应用采集**（process loopback 不是现有功能，不擅自加）。
- 声音格式与原来一致：16 位双声道，采样率取开始时默认输出设备的混音采样率（通常 48 kHz）。

### 比较过的方案

| 方案 | 结论 |
|---|---|
| 本仓库的 PortAudio | 固定的是 19.7.0（2021-04，`scripts/build-audio-capture.cjs`），源码里 `pa_win_wasapi.c` 没有任何 loopback 代码（已 grep 确认）。较新的 PortAudio 主干有 WASAPI 回环设备，但要换成未发版的快照：音频编辑与录屏麦克风全部跟着换底层，风险落在已经稳定的麦克风上；GPL 对应源码仓库也要换包。它也不解决无声时不出数据、设备切换、按数据包时间戳对齐这些难点。不选。 |
| cpal 0.15（本机缓存里有） | 在输出设备上建输入流即回环。但不给每个数据包的 QPC 时间戳（跨轨对齐要靠它）、不跟随默认设备切换、不补静音，还自带另一版 `windows` 0.54。难点仍要自己写，等于多一层。不选。 |
| wasapi 库（HEnquist/wasapi-rs，MIT） | 很薄的一层封装，回环、按应用回环都支持，但同样要自己写时间轴、补静音和设备跟随；本机没有缓存。差别不大，不如直接用官方绑定。 |
| **微软官方 `windows` 0.62.2 直接调 WASAPI（选用）** | 与视频解码服务同一版本（仓库里已有、已在打包与许可清单里，MIT/Apache-2.0），离线可构建；能拿到每个数据包的 QPC 位置（与 `hc_clock` 同一个计数器），共享模式回环 + `AUTOCONVERTPCM` 让换设备后仍是同一格式。WASAPI 部分约 350 行，真正的难点（时间轴、补静音、切段、设备跟随）放在与平台无关的 `system_audio.rs`，以后 macOS 直接复用。 |

### 进程隔离
系统声用**另一个** `henji-audio-capture` 进程（同一个程序），与麦克风进程分开：麦克风的 ASIO 驱动崩溃不会带走系统声，反之亦然。为此 PortAudio 改成第一次用到麦克风时才初始化，只录系统声的进程从不加载 ASIO 等驱动，不会与另一进程里的麦克风抢驱动。

## 二、现状与改法

### 原生（`native/audio-capture`）
- `src/wasapi.rs`（新，仅 Windows）：默认输出设备的共享模式回环，请求 float32 双声道、开始时的采样率，`AUTOCONVERTPCM | SRC_DEFAULT_QUALITY` 让系统做格式转换；转换不可用且混音格式采样率相同时退回混音格式（多声道取前两个）。2 秒引擎缓冲，采集线程每 5 ms 读一次。
  - **设备切换**：每 200 ms 核对默认输出设备，换了就跟着换；设备被移除或格式变了（`AUDCLNT_E_DEVICE_INVALIDATED`）立刻重开；没有设备、被独占（`AUDCLNT_E_DEVICE_IN_USE`）、音频服务没运行时每秒重试。期间时间轴照常补静音。
  - 开始时打不开输出设备直接报错（与原来界面采集一致：没声音轨道就开不了录）。
- `src/system_audio.rs`（新，与平台无关）：
  - **时间轴**（`Timeline`）：连续的数据包按设备时钟写（漂移留给拼接处吸收），只有数据包时间戳与时间轴差出 3 ms 以上（没声音播放、换设备、驱动报不连续）才按 QPC 时间戳补静音或去掉重叠；超过 100 ms 没有数据包就补静音到“现在 − 50 ms”（给还在路上的包留位置），停止时补到此刻。文件里每一帧都对应一个真实时刻，**无声时时间轴连续**。
  - **写盘**（`Writer`）：与麦克风同一个 `Wav`（每秒更新文件头并 `sync_data`，超过 4 GiB 写 RF64，崩溃后按物理长度恢复）。按帧数**每 5 秒切一段**，段文件名是随机 UUID（与原来界面写的分段同一命名规则），段与段首尾相接。每开一段、封一段各发一条**不丢的事件**（`segment`，带段号、文件、首帧在整次采集里的帧号、单调时钟）。
  - **缓冲满补静音**：采集到写盘之间 4096 块（48 kHz 约 40 秒、约 32 MB）；仍满时丢的帧计入 `droppedFrames`，写盘恢复后补等长静音，停止前最后丢的也补上。
  - **推流**：段事件走不限长的可靠通道（每 5 秒两条），电平与健康计数走可丢的有界通道；写盘线程从不等管道。停止的应答排在最后一段的封口事件之后。
  - 只有写盘失败（磁盘满、文件出错）才结束这一路并发 `interrupted`；设备没了、换了都补静音继续。
- `src/main.rs`：协议号 2 → 3；新增 `startSystemAudio` 命令，`stop`/`status` 按会话号分到系统声会话；PortAudio 懒初始化；主循环每轮报系统声健康计数、收拢写盘失败的会话。

### 主进程
- `electron/main/services/audio-capture/system-audio.ts`（新）：`SystemAudioCaptureService` 持有自己的 `AudioCaptureClient`（另一个原生进程）。每次录制一个 `SystemAudioRecorder`，把段事件换算成录制轨道记录（open/seal/gap，时间相对录制的 `originUs`，锚点与原来界面写的一致）。
  - 暂停 = 结束这一段原生会话，恢复 = 再开一段；中间记 `pause` 空档。
  - **原生服务失联**（崩溃、不应答）：先重开一段原生会话接着录（0.5/1/2/3 秒退避），再在串行队列之外把失联前没封口的段用原生 `recover` 按文件补出封口记录（封口不超过失联时刻；不应答的旧进程最多等 5 秒，没退就留给录制收尾按文件补），中间记 `missing-data` 空档。暂停、停止不等补段（停止前最多等这 5 秒）。录屏控制条显示“录制设备已中断”，接上后撤掉。
  - 输出设备不可用或被独占：文件里照常是连续静音，控制条同样提示，恢复后撤掉。
  - 恢复时开不了（例如暂时没有输出设备）不让整次录屏失败，转为自动重试。
  - 使用方的记录回调出错只记日志，不会冒到原生客户端被当成协议错误。
- `client.ts`：协议 3 握手；解析 `segment`/`device`/`systemHealth`，段事件的原生时钟按已有的时钟校准换算到主进程 `hrtime`（与画面、事件、麦克风同一个时间轴）。
- `executable.ts`（新）：原生程序定位从 IPC 文件挪到服务层（录屏服务要用），IPC 文件原样再导出。
- `screen-recording/capture/service.ts`：Windows 上带系统声的录制，系统声由主进程在开始、暂停、恢复、停止、取消时跟着画面驱动，记录直接进录制文档的轨道记录（`tracks.journal`），与界面写的麦克风、摄像头同一份；`CapturePrepared.hostTracks = ['systemAudio']` 告诉界面不要再采。**界面重载或崩溃时系统声不断**（它不经过界面）；接回时 `attach` 交还的 `prepared` 同样带这个标记。开始途中被取消的会当场收尾。
- `screen-recording/control.ts`：主进程自己录的轨道的提示（`setHostTrackWarning`）与界面报的轨道状态合并显示，界面状态不覆盖它。
- `ipc/audio-capture.ts`：新增 `systemAudioStart`/`systemAudioStop`（只给界面自己的录制用，见下），参数 zod 严格校验、目录要求绝对路径并 `realpath`；归属按窗口校验；界面离开（导航、崩溃、关窗）就收尾它开的系统声，开始途中离开的当场停掉。不排在麦克风操作的队列后面。退出清理同时关系统声服务。

### 界面
- 录屏（`capture/session.ts`）：`hostTracks` 里有系统声时，界面的轨道会话不建系统声这一路，兼容采集（chromium 后端）的屏幕共享也不再请求声音。
- 网页录制的备份声音（`application/webAppBackupAudio.ts`，界面自己的录制）：Windows 上系统声这一路改为原生——`tracks/devices.ts` 的系统声设备经 IPC 让主进程开原生会话写进同一个目录，停止时取回这段的轨道记录并入 `tracks.json`（`tracks/session.ts` 的 `nativeRecords`，暂停空档照常按真实起点记）。主进程合成备份视频读的仍是 `tracks.json` 与同目录的段文件，格式没变。
- **Windows 上界面里原来的系统声采集路径不再被走到**：`captureStreamAudio` + `getDisplayMedia` 只在 macOS（以及调用方自己给了声音流时，例如 macOS 兼容采集克隆的屏幕共享、巡检夹具的测试音）使用。
- 电平：原来录屏界面只显示麦克风电平，没有系统声电平；系统声相关的界面显示只有“持续静音”与“设备中断”两条提示。持续静音提示只在 macOS 有风险时启用，Windows 本来就不判；设备中断提示现在由主进程按原生的设备与连接状态给出。原生写盘时照常算电平，但没有显示位置，所以不往管道里推（`Writer` 的电平发送端传空）；以后要显示系统声电平，把发送端传进去即可。

### 跨轨对齐
时钟来源只有一个：画面、鼠标键盘事件、麦克风、系统声都按主进程 `hrtime` 与同一个 `originUs`。系统声每段的起点来自数据包的 QPC 位置（与 `hc_clock` 同源）经客户端校准换算；段的终点按帧数推算，设备时钟与系统时钟的漂移在拼接处由已有的 `audio-join.ts` 吸收（每段准时开始）。

## 三、协议与持久格式

- **原生协议 2 → 3**（两端同步）：
  - `hello` 返回 `protocol: 3`、`systemAudio`（是否支持原生系统声）。
  - 新命令 `startSystemAudio { sessionId, directory }`；`stop`/`status` 按会话号路由，系统声不支持暂停（主进程用停止/重开实现）。
  - 新事件：`segment { phase: open|seal, segmentId, file, firstFrame, frames?, sampleRate, channels, nativeMonoUs }`（字段用 `segmentId`，不与请求应答的 `id` 冲突）、`device { state: capturing|unavailable, name, reason, atSeconds }`、`systemHealth { health }`；写盘失败沿用 `interrupted`。
  - 新旧程序不配套在握手就失败（有测试）。`scripts/audio-capture-smoke.cjs` 的协议断言原来还停在 1，一并改成 3。
- **持久格式没有变化**，不升版本：
  - 系统声段与原来界面写的段同一结构（`<uuid>.wav`、`sampleRate`、`channels`、`units`、锚点），轨道记录 `tracks.journal`（`screen-recording-track-journal` v1）、`tracks.json`（`screen-recording-tracks` v1）、录制文档（v80）的 schema 都没动。新录制的系统声 WAV 头是原生的 92 字节布局（JUNK/ds64 + fact），与麦克风原生副本相同，`wav-file.ts`、拼接、恢复、ffmpeg 都已在读。
  - 归并规则的一处语义调整（`src/core/screenRecording/trackJournal.ts`）：界面断开前后的两段之间要空出 20 ms 以上才记 `missing-data`（原来是大于 0）。主进程录的系统声跨断开首尾相接，两段只差设备时钟漂移的零点几毫秒，不应被记成空档、更不应因此拆成两条；界面写的轨道跨断开至少空出重载的一两秒，旧录制重放结果不变。20 ms 与拼接时“同一路连续声音”的容差一致。没有按“写入方”区分，是因为那要在记录里加字段（格式变更），而这条门槛已足够且对旧数据无影响。
  - `CapturePrepared.hostTracks` 只在进程间传递，不落盘。
- 旧录制照常可读：读取路径没有改动；`session-document.test.ts` 里“旧录制（无 tracks.journal）照常恢复”等用例照常通过。

## 四、可观察性（`main.audio_capture.system`）

| 事件 | 时机与内容 |
|---|---|
| `audio_capture.system_audio.start` / `.start.completed` / `.start.failed` | 开始；设备名、采样率；失败原因 |
| `audio_capture.system_audio.device.changed` / `.device.unavailable`（warn） / `.device.restored` | 默认输出设备切换（从哪台到哪台、第几秒）、设备不在或被独占（原因）、恢复 |
| `audio_capture.system_audio.glitch`（warn） | 写盘跟不上丢帧（已补静音）或驱动报数据不连续有新增 |
| `audio_capture.system_audio.disk.slow`（warn） | 写盘耗时出现新峰值（≥100 ms） |
| `audio_capture.system_audio.reconnect.start` / `.completed` / `.failed` | 原生服务失联、重连耗时 `gapSeconds` |
| `audio_capture.system_audio.repair.completed` / `.failed` | 失联前没封口的段按文件补回的帧数 |
| `audio_capture.system_audio.failed`（error） | 写盘失败，这一路停止 |
| `audio_capture.system_audio.summary` | **每次结束一条汇总**：结果、录到的时长、段数、重连次数、设备、实际经过秒数、补静音秒数（`silenceSeconds`：没声音播放）、设备不可用秒数（`unavailableSeconds`）、去掉的重叠帧、数据不连续次数、丢帧、设备切换次数、写盘峰值 |
| `audio_capture.system_audio.record.failed`、`.stop.failed`、`.resume.failed` | 记录登记出错、收尾出错（按文件补齐）、恢复时没开成（自动重试） |

录屏结束汇总 `recording.capture.summary` 里已有各轨段数与空档数，系统声照常计入。

## 五、改动文件

原生：
- `native/audio-capture/Cargo.toml`（Windows 依赖 `windows` 0.62.2）、`Cargo.lock`（只新增 windows 系列与 `syn` 2，原有锁定版本不动）
- `native/audio-capture/src/main.rs`（协议 3、懒初始化、系统声会话路由与收拢）
- `native/audio-capture/src/system_audio.rs`（新：时间轴、切段写盘、会话、5 个测试）
- `native/audio-capture/src/wasapi.rs`（新：Windows 回环与设备跟随）

主进程 / preload：
- `electron/main/services/audio-capture/system-audio.ts`（新）、`system-audio.test.ts`（新）、`executable.ts`（新）
- `electron/main/services/audio-capture/client.ts`、`client.test.ts`、`protocol.ts`、`service.ts`（只让麦克风服务忽略系统声事件）
- `electron/main/ipc/audio-capture.ts`
- `electron/main/services/screen-recording/capture/service.ts`、`capture/service.test.ts`、`control.ts`
- `electron/main/services/screen-recording/audio-join.ts`、`audio-join.test.ts`（审查发现的原有问题：一条的最后一段按文件全长写出，区间被截短时会把同一段声音叠进下一条；改为只写到记录的终点）
- `electron/preload/audio-capture-api.ts`

共用与渲染层：
- `src/core/audioCapture/contracts.ts`（系统声健康计数与原生事件类型、两个 IPC 动作，均不落盘）
- `src/platform/contracts/audioCapture.ts`（`nativeSystemAudioSupported` 规则与三个成员）、`src/platform/adapters/electron/audioCapture.ts`
- `src/core/screenRecording/capture.ts`（`hostTracks`）、`trackJournal.ts`、`trackJournal.test.ts`
- `src/features/screenRecording/capture/session.ts`、`tracks/devices.ts`、`tracks/devices.test.ts`、`tracks/session.ts`、`tracks/session.test.ts`
- `src/features/audioCapture/captureTestFixture.ts`（测试替身补三个成员）
- `scripts/audio-capture-smoke.cjs`（协议断言 1 → 3）

## 六、测试与验证

**Rust**（独立 target 目录、静态 CRT、`cargo test --offline --locked --release -j 8`）：12/12 通过，无编译警告，`cargo fmt` 已跑。新增 5 个：
- 无声：2 秒没有数据包，补出的静音首尾相接、总帧数 96000（±1），声音恢复后按时间戳接上；
- 播放中断后的包按时间戳补静音，补多了时去掉重叠；
- 切段：段与段首尾相接、首帧连续、跨段后的起点时钟正确、每段文件长度正确；
- 队列满：丢帧计数、写盘恢复后补等长静音，文件时长正确；
- 段号是 v4 UUID。

**Vitest**（只跑直接相关的文件，含音频编辑录音全部相关测试）：
- 首次实现后 22 个文件、103 个用例全过；
- 第一轮审查修改后 15 个文件、80 个用例全过；
- 第二轮审查修改后，受影响的 9 个文件、64 个用例全过（`system-audio.test.ts` 7 个用例）。

本次新增或改写：
- `system-audio.test.ts`：
  - 段事件换算成合法轨道记录；暂停结束原生会话、恢复重开、记暂停空档；停止后最后一段已封口；
  - **原生服务崩溃**：先重开接着录、再在队列之外按文件补出没封口的段、记缺数据空档；**重连后仍声明在录**（去掉这一行时用例失败，红→绿已验证）；
  - **重连中停止**：不再重连、补出没封口的段、空档记到按下停止、提醒撤掉；
  - **暂停收尾途中写盘失败**：这一路保持结束，之后恢复不再开、停止不重复记空档；
  - **恢复时开不了不让录制失败**，自动重试后接上；
  - 写盘失败交给录制按失败处理；
  - **跨轨对齐**：设备时钟慢 100 ppm、8 段，经段事件换算、**界面中途断开再接上**、拼成一条后，同一次点击在声音与事件里相差不到一个采样，且断开处没有空档、只拼成一条。
- `client.test.ts`：段事件的原生时钟换算到主进程时钟；**协议 2 的旧程序握手即失败**。
- `capture/service.test.ts`：Windows 上系统声由主进程录、界面不再采集；**界面断开期间照常录**，记录直接进录制文档；跟着暂停、恢复、停止。
- `tracks/session.test.ts`：网页录制备份声音的原生系统声，停止时交回的段并入轨道，暂停空档按真实起点记。
- `trackJournal.test.ts`：主进程录的系统声跨界面断开首尾相接，不记缺数据空档（界面写的轨道跨断开照常记，原用例）。
- `audio-join.test.ts`：两次采集首尾重叠时，前一条只写到被截短的终点，同一段声音不出现两遍（去掉修正时用例失败，红→绿已验证）。
- 跑过但没改用例的：`audio-capture/service.test.ts`、`protocol.test.ts`、`control.test.ts`、`audio-join.test.ts`、`session-document.test.ts`、`runtime.test.ts`、`ipc/audio-capture.test.ts`、`preload/audio-capture-api.test.ts`、`tracks/devices.test.ts`、`capture/session.test.ts`、`audioCapture/captureSession.test.ts`、`captureApplicationService.test.ts`、`importCapturedAudio.test.ts`、`AudioCaptureSettingsForm.test.tsx`、`creativeIntent/recording/microphone.test.ts`、`audioEdit/workspace/AudioEditRecordingControls.test.tsx`、`WindowControls.test.tsx`。

**静态检查**：改动的 TS 文件逐个 ESLint 通过；`check:main-imports` 通过；`check:dependency-graph` 只报已有的 `canvas → cameraStage`（与本次无关）。`check:persistence-compat` 报 `document.video_edit/v77`、`document.screen_recording/v80`、`title-templates/v16`、`video-preset-package/v28`、`subtitle-manifest/v35` 指纹被改写——来自工作区里别人未提交的 `src/core/videoEdit/*`（字幕样式、标题图形、序列预设等）改动；本次涉及的格式（`screen-recording-track-journal`、`screen-recording-tracks`）没有被报。

**类型检查**：两套都清零。`tsconfig.electron.json` 在第二轮修改之后重跑，0 错误；`tsconfig.json`（只含 `src`，第二轮没有改 `src`）在第一轮修改之后跑，0 错误（需要 8 GB 堆：`node --max-old-space-size=8192 node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`，默认堆会内存不足）。协调方提到的 `ipc/audio-capture.ts` 里 `audioCaptureExecutablePath` 找不到，是改到一半时的状态，现在它从 `services/audio-capture/executable.ts` 导入并再导出。

**本机真实采集**（用独立 target 目录构建的程序，没有动 `target/release`；声卡“扬声器 (Sound 2 Pro-6812)”，48 kHz）：
1. 直接驱动原生程序 12 秒、60 秒（无声）：握手协议 3、能打开回环；60 秒时**文件帧数 60.020 秒、时间轴 60.020 秒，一帧不差**；13 段首尾相接、首帧连续，段间时钟接缝最大 44 µs（设备时钟漂移约 9 ppm）；丢帧 0、不连续 0；这次有约 1.1 秒没有数据包，由补静音补上。
2. 真实主进程链路（真实 `AudioCaptureClient` + `SystemAudioCaptureService` + 轨道归并 + 拼接 + 原生程序，只替换日志与 electron）：录 7 秒 → 暂停 2 秒 → 恢复 6 秒 → 停止。暂停空档按真实时刻记下；拼成两条 7.011 秒与 6.014 秒；停止时刻与最后一帧差 3 ms。这一轮**整段没有任何数据包**（`silenceSeconds` 等于全长），即“没有声音播放时回环端点不出数据”的情形，时间轴照样连续。
3. 有声：播放了一段**0.4 秒、1 kHz、−40 dBFS 的测试音**（很轻很短，用系统自带的 SoundPlayer），文件里这段声音长 0.411 秒、峰值 328（正好是 32767 的 −40 dB），数据通路与系统格式转换正确。
4. 崩溃：录到第 4.3 秒按进程号结束这次自己开的原生进程（没有按程序名结束，不影响别的实例）。0.78 秒后重连成功，失联前没封口的那段按文件补回约 3.96 秒，`missing-data` 空档覆盖中断的那一下，之后暂停、恢复、停止都正常，拼成三条（失联前、失联后到暂停、恢复后）。第二轮修改后重跑，结果相同。

没有验证：设备切换（不替用户改系统默认设备）、独占模式应用、长时间（小时级）、磁盘满。设备切换与独占由代码路径与日志覆盖，需要真实录制验证（第十节）。

## 七、独立审查

第一轮（全新上下文，只给改动、目标与规则）：2 条重要、10 条小问题、1 条原有问题。

| # | 问题 | 处理 |
|---|---|---|
| 1（重要） | 原生服务重连后客户端的“正在录”标记没恢复，约 30 秒后被空闲计时关掉，系统声悄悄停 | 已修：每开一段原生会话都重新声明；测试不再替换它，红→绿已验证 |
| 2（重要） | 接口新增成员后测试替身没补，渲染层 tsc 报错 | 已修：`captureTestFixture.ts` |
| 3 | 刚开段就写盘失败会发 0 帧封口，主进程当协议错误收掉进程 | 已修：原生不封 0 帧段；客户端放宽到非负 |
| 4 | 轨道登记同步抛错会冒到原生客户端 | 已修：录制器统一 `emit`，出错只记日志 |
| 5 | 不应答时重连被旧进程最多 120 秒的收尾拖住 | 已修：先开新会话，再补旧段 |
| 6 | 重连中暂停后“设备中断”提示一直挂着；失联覆盖未消费的暂停空档 | 已修：按原因合并的可用状态；失联前先把暂停空档记完 |
| 7 | 首次开始途中崩溃留下孤儿录制器无限重连 | 已修：初始状态“开始中”，只在录制中重连 |
| 8 | 停止前补丢帧的标记块时刻为 0 | 已修：带时间轴终点 |
| 9 | 打开设备超时后仍 join 推流线程，堵住命令循环 | 已修：失败时不等它 |
| 10 | 巡检夹具传入的测试音在 Windows 上被忽略 | 已修：调用方自己给了声音流就用它 |
| 11 | 网页录制备份开始途中界面离开，系统声不停 | 已修：按窗口离开计数，开出来当场停掉 |
| 12 | 设备不可用无提示；恢复失败整次录屏失败；启动日志竞态；退回分支内存泄漏 | 已修：设备不可用时提示（不记空档，文件里是连续静音）；恢复失败转重试；日志只在首次开始记；所有路径释放 |
| 原有 | 网页录制备份合成时每 5 秒一段一个 ffmpeg 输入，长录制可能撑爆命令行 | 不在本次范围（`web-replay/backupVideo.ts` 不归我改），见第十一节 |
| 建议 | 20 ms 门槛是全局容差，更贴近根因是按写入方区分 | 保留门槛：按写入方区分需要在记录里加字段（格式变更），门槛对旧数据无影响，理由写在注释里 |

第二轮（只审增量；两位审查员各审一遍，结论一致：第一轮的修复基本到位，剩下的集中在补旧段）：

| # | 问题 | 处理 |
|---|---|---|
| 1（重要） | 补旧段仍在串行队列里等旧进程退出（不应答时最长 120 秒），期间暂停、停止、退出都排队，控制条一直忙 | 已修：补旧段挪到队列之外；等旧进程最多 5 秒，没退就留给录制收尾按文件补；停止前最多等这 5 秒 |
| 2 | 等原生应答期间写盘失败，之后又被写回“暂停/录制中”；写盘失败时提醒不撤 | 已修：应答之后发现已结束就退出；写盘失败分支撤掉提醒；补用例 |
| 3 | 暂停时没撤“设备不可用”提醒 | 已修 |
| 4 | 网页录制备份的离开计数在第一个等待之后才取 | 已修：挪到最前面 |
| 5 | 补出的旧段不截到失联时刻；不应答的旧进程还在写时会与新会话重叠，拼接时同一段声音出现两遍 | 已修：封口不超过失联时刻；同时修了拼接这一侧的原有问题（一条的最后一段只写到记录的终点），补用例 |
| 6 | 原生读失败的分支不去重、不退避，可能每 5 ms 开关一次并刷日志 | 已修：同一原因只报一次；刚打开就读失败的每秒才重试 |
| 7 | 电平事件没人用却一直推 | 已修：不推 |
| 8 | 测试缺口：重连中停止、写盘失败与暂停交错 | 已补两个用例 |

两轮之后没有剩余的重要问题。

## 八、macOS 的现状与后续方案

- **现状（本次不改，保持原样）**：macOS 上系统声仍由界面经 `getDisplayMedia` 采集，主进程回 `audio: 'loopback'`。`media-permissions.ts` 把 macOS 14.2 以上标为“未知”（界面在持续静音 5 秒时提示“未听到系统声音”），更早的版本标为“不支持”（开始时报“当前系统声音采集路径不可用”）。能否真的录到声音取决于 Electron/Chromium 在 macOS 上的回环实现，项目没有额外打开相关功能开关；本次没有在 mac 真机上验证。`nativeSystemAudioSupported` 只认 `win32`，mac 走不到原生路径，行为不退化。
- **后续方案**：同一个原生进程里加 `coreaudio_tap.rs`，复用与平台无关的 `system_audio.rs`（时间轴、切段写盘、段事件都不用改），主进程与界面一行不改，只把 `nativeSystemAudioSupported` 加上 `darwin`，再删掉界面那条路径。
  - macOS 14.2+：Core Audio 进程音频 tap（`AudioHardwareCreateProcessTap` + 全局 `CATapDescription`，可排除痕迹AI自己，再建聚合设备、`AudioDeviceCreateIOProcIDWithBlock` 取数据）；时间戳用回调里的 `mHostTime`（与 macOS 上 `hc_clock` 用的 `mach_absolute_time` 同源）。需要“录制系统音频”权限（`NSAudioCaptureUsageDescription`）。参考实现：AudioCap（insidegui，MIT，Swift）、`cidre`（Rust 绑定，含 Core Audio tap）。
  - macOS 13–14.1：ScreenCaptureKit 的音频流（`screencapturekit-rs`），需要屏幕录制权限（录屏本来就要）。
  - 无声时 tap 照样按设备时钟出零值数据，补静音逻辑只在设备切换时起作用。

## 九、鼠标键盘事件挪进 Rust 的评估（只给结论，没有实现）

**现状**：
- 按键、点击、滚轮、移动来自 `uiohook-napi`（libuiohook，C）。Windows 上它在自己的原生线程里装 `WH_MOUSE_LL`/`WH_KEYBOARD_LL` 低级钩子并跑消息循环，钩子回调把事件复制一份，以**不阻塞、不限长**的 N-API 线程安全队列交给主进程 JS（`node_modules/uiohook-napi/src/lib/addon.c:20`、`libuiohook/src/windows/input_hook.c:653`）。
  - 所以主进程卡顿时**按键与点击不会丢**，钩子回调也不会因为等 JS 而超时被系统摘掉。
- 时间戳是问题所在：`events.ts` 在 JS 收到事件时才取 `nowUs()`，没有用钩子给的 `time`（`MSLLHOOKSTRUCT.time`，毫秒）。主进程卡多久，卡顿期间的点击与按键就**晚记多久**，并挤在同一时刻。
- 鼠标移动按“距上一条不足 4 ms 就丢”节流，用的也是收到时刻：卡顿后一口气到达的一串移动几乎全被丢掉，那段**轨迹缺失**。
- 光标形状、前台窗口、光标位置靠主进程 120 Hz 的 `setTimeout` 轮询（koffi 调 user32），卡顿期间停采。
- 事件页的封页、内容寻址写盘在 TS 的 `CaptureLogCollector` 与 `RecordingEventStore`。

**挪进 Rust 的收益**：时间戳在钩子线程里取 QPC，精确到微秒，不受主进程卡顿影响；120 Hz 轮询在原生线程里稳定运行，卡顿期间轨迹与光标形状都不缺；时钟与系统声同源。

**代价**：
- 要自己写低级钩子线程与消息循环（mac 上是 CGEventTap 与辅助功能权限，uiohook 现在替我们处理）、按键分类、多显示器 DPI 换算（现在用 Electron 的 `screen.screenToDipPoint`）。
- 排除区域（控制条、被排除的窗口）与采集几何都在主进程，原生只能给原始事件，换算仍在主进程做；事件页格式若也挪过去，就要在两种语言里各维护一份。
- 还要新起一个原生进程，或者把输入钩子塞进 GPL 的录音进程，两者都不理想。
- 估计 3–5 天，还要补 mac 端。

**建议**：**现在不挪**。真正的风险（卡顿时时间戳偏、轨迹缺）用约 20 行 TS 就能消掉：
- 改用钩子事件自带的 `time`，用一次 `GetTickCount` 与 `hrtime` 的对应关系换算到同一时间轴（精度 1–16 ms，对 60 帧画面足够）；
- 节流改按事件自己的时刻判断。

按键不丢这一条已经由 libuiohook 的线程与队列保证。等到 mac 端的 uiohook 出问题，或真实长录里看到卡顿造成的轨迹缺口无法接受，再整体挪进一个独立的原生输入进程。这条小修改建议由录屏负责人决定是否单独做（本次没做，不在授权范围）。

## 十、需要真实录制验证的步骤

**准备**：`npm run build:audio-capture`（协议已升到 3，必须与主进程一起更新）→ `npm run electron:bundle` → `npm run electron:prod -- --dev-skip-onboarding`。正式验收不用开发版。日志用 `npm run logs:query -- --event <事件名>`。

1. **长录与无声**：4K60、开麦克风与系统声，录痕迹AI以外的窗口 60 分钟。
   - 前 10 分钟不放任何声音，之后放一段视频，再停 10 分钟。
   - 开头与结尾各拍一次手。
   - 停止后：`audio_capture.system_audio.summary` 的 `durationSeconds` 应约等于录制时长，`droppedFrames` 0，`silenceSeconds` 接近不放声音的时长。
   - 导入剪辑后系统声只有一个片段（暂停才多），时长等于录制时长；对比开头与结尾两次拍手处的音画偏差，应在一帧以内。
2. **界面重载**：录制第 5 分钟在任务管理器里结束痕迹AI的渲染进程（或开发版整页刷新）。
   - 重载期间系统声**不应有空档**：导入后系统声在重载处连续，只有麦克风有一小段空档。
   - 日志里没有 `audio_capture.system_audio.reconnect.*`。
3. **输出设备切换**：录制中插拔耳机或在系统声音设置里切换默认输出设备。
   - 日志有 `audio_capture.system_audio.device.changed`（从哪台到哪台）；之后放的声音照常录到。
   - 拔掉唯一的输出设备时控制条显示“录制设备已中断”，`device.unavailable` 带原因，插回后提示消失、`device.restored`。
   - 文件时长不变（中间是静音）。
   - 若新设备采样率不同（例如 44.1 kHz 的蓝牙耳机），确认声音不变调、时长正确（由系统格式转换负责）。
4. **独占模式应用**：录制中开一个独占输出的播放器（例如开了 WASAPI 独占的音乐播放器）。预期这段录不到（静音），日志 `device.unavailable` 原因“输出设备被其他程序独占”，播放器关掉后自动恢复。
5. **原生进程崩溃**：录制中在任务管理器里结束系统声那个 `henji-audio-capture.exe`（有两个时，命令行里看不出区别，可先只开系统声、不开麦克风再试）。
   - 约 1 秒内重连：`reconnect.start` → `reconnect.completed`、`repair.completed`；
   - 控制条短暂显示“录制设备已中断”后消失；导入后系统声在那一处有约 1 秒空档，前后都有声音。
6. **暂停与恢复**：暂停 30 秒再恢复，期间切换一次默认输出设备。导入后系统声分成两条，恢复后录的是新设备的声音。
7. **网页录制备份声音**：网页录制开启备份录屏、打开系统声，录 2 分钟并放一段声音。保存后备份视频里有系统声。

## 十一、没做到的与风险

1. **原生程序与主进程必须同版本**：协议升到 3，不配套时在握手就失败（录不了，不会录到一半断）。我没有重建 `target/release` 里的正式程序（正在运行的开发版会握手失败），留给统一验收时 `npm run build:audio-capture` 与 `electron:bundle` 一起做。
2. **开始时没有可用的输出设备，整次录屏开不了**（与原来一致）；控制条只显示通用的“录制操作未完成”，具体原因在日志 `audio_capture.system_audio.start.failed`。录制中设备没了则补静音继续。
3. **设备切换的那一下（最多约 0.2 秒检测间隔加打开时间）声音录不到**，文件里是静音，不记空档；被独占期间同样是静音。这两种情况都有控制条提示和日志，但轨道里不标记。
4. **系统转换不可用、且新设备采样率与开始时不同时**，这台设备按不可用处理（静音并提示）。正常 Windows 10 及以上都支持共享模式自动转换。
5. **原生服务崩溃时**，崩溃前还在进程里、没写进文件的几十毫秒会丢，中间按缺数据空档记（真实测试里约 0.8 秒）。原生不应答（卡在驱动里）时旧进程最多两分钟才退：新会话照常接着录，旧进程那一段要等它退出、在录制收尾时按文件补，补出的部分截到失联时刻为止。
6. **两个 `henji-audio-capture.exe`**：录屏同时开麦克风时会有两个同名进程（麦克风一个、系统声一个），任务管理器里不好区分。
7. **Cargo.lock 新增 windows 系列依赖**：全新环境构建与 GPL 对应源码仓库按原有方式从 crates.io 取；许可清单生成用 `cargo metadata`，会自动带上（MIT/Apache-2.0）。
8. **网页录制备份声音的合成（原有问题）**：`web-replay/backupVideo.ts` 把每个 5 秒段都作为一个 ffmpeg 输入，长录制时 Windows 命令行可能超长；原生系统声沿用 5 秒分段，与原来相同。建议由网页录制负责人改为先拼接（可复用 `audio-join.ts`）。
9. **macOS 没有任何改动，也没有真机验证**（第八节）。
10. **鼠标键盘事件**按第九节建议没有改动。
11. 系统声电平原生已经在发，界面没有显示的位置，没加界面。
