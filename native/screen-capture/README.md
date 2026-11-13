# henji-screen-capture

原生画面采集进程。画面全程留在显卡里：采集 → 显卡上转 BT.709 NV12 → 硬件编码 → 单文件分片 MP4，另写一份逐帧时刻表和一份活动时间线。

第一版范围：Windows 10 2004 及以上、NVIDIA 显卡、整块显示器。其他情况在 `prepare` 时返回 `ENCODER_UNSUPPORTED` / `CAPTURE_UNSUPPORTED`，由主进程改用现有录法。

尚未接进应用。设计方向见 [docs/task/自研画面采集/设计方向.md](../../docs/task/自研画面采集/设计方向.md)，进度、实测数字与下一步见 [进度与交接.md](../../docs/task/自研画面采集/进度与交接.md)。

## 构建与自测

```bash
node scripts/build-screen-capture.cjs            # 发布构建，产物在 native/screen-capture/target/release/
node scripts/build-screen-capture.cjs --test     # 单元测试（色彩转换那一条要 NVIDIA 显卡，没有就跳过）
node native/screen-capture/selftest/selftest.cjs record --motion   # 真实录制自测，场景见脚本文件头
```

链接的是视频解码服务同一份随包 FFmpeg（`scripts/video-decoder-ffmpeg.cjs` 固定的构建）。打包时可执行文件要与 FFmpeg 的 DLL 放在同一目录（建议就放 `resources/video-decoder/`，与解码服务共用）。

开发用子命令（应用不调用）：

```bash
henji-screen-capture sources                                  # 列出显示器
henji-screen-capture record --out <目录> --point 3841,1 --seconds 30   # 直接录一段，事件按行打印
henji-screen-capture inspect <目录>                            # 统计一次录制的时刻表
```

## 目录结构

```
src/
  main.rs            服务主循环（读指令、分发）与子命令入口
  dev.rs             开发用子命令 record / inspect
  core/              共用核心，不出现任何系统接口
    protocol.rs      协议：消息帧、可靠 / 可丢两个通道、握手、参数解析、错误码
    session.rs       一次录制的生命周期与会话线程（唯一碰网格、旁路文件、写文件接口的线程）
    pacer.rs         恒定帧率网格：选帧、补重复帧、暂停、积压丢格
    timing.rs        逐帧时刻表的读写
    activity.rs      活动时间线
    health.rs        健康计数、采集帧的有界收件箱
  platform/
    mod.rs           平台层接口（Platform、FrameWriter）
    windows/         device（显卡与显示器）、wgc（采集）、convert（BGRA→NV12）、encode（硬件编码）、mux（分片 MP4 与写盘线程）
    macos/           位置与说明，尚未实现
selftest/selftest.cjs  真实录制自测，也是主进程用法的可运行示例
```

线程：主循环（指令）｜系统线程池上的采集回调（转换后放进收件箱，从不等待）｜会话线程（网格、编码）｜写盘线程（封装、落盘）｜推流线程（标准输出）。

背压：采集回调 → 收件箱（8 张，满了丢最旧并计 `captureDropped`）→ 会话线程 → 写盘队列（240 包，满了会话线程等待）。会话线程落后超过半秒时网格把格子记为“丢弃”（占帧序号、不编码，计 `droppedFrames`）。

## 协议（版本 1）

约定与录音进程（`native/audio-capture`）相同。

- 标准输入：一行一条 UTF-8 JSON 指令，`{"id": <任意>, "type": "<指令>", ...}`。
- 标准输出：`u32 小端 JSON 字节数` + `UTF-8 JSON` + `binaryBytes 字节的二进制`（目前恒为 0）。
  - 应答：`{"id", "ok": true, "result": {...}}` 或 `{"id", "ok": false, "error": {"code", "message", "recoverable"}}`
  - 事件：`{"event": "<名字>", "sessionId", ...}`
- 应答与状态事件不丢、按发生顺序；`health` 事件可丢（管道慢时直接丢弃）。
- 标准输入关闭或主进程的读端关闭：正在录的文件正常收尾（排空编码器、写好结尾、清单标记完成）后退出，最多等 100 秒。
- 标准错误：FFmpeg 与本进程的诊断文字，主进程按行记进日志即可。
- 同一时间只有一次录制。
- 时刻一律是本进程的单调时钟，单位微秒（Windows 上是 QPC 换算，与录音进程的 `nativeMonoUs`、主进程的 `hrtime` 同一个计数器）。主进程用 `hello` / `clock` 返回的 `nativeMonoUs` 与自己的时钟校准，做法同录音进程的 `correlateNativeClock`。

### 指令

| 指令 | 参数 | 应答 |
|---|---|---|
| `hello` | `protocol`（可选，主进程期望的协议号） | `{protocol, nativeMonoUs, platform, codecs, sources, pauseInPlace}`。带了 `protocol` 且不相等时返回 `PROTOCOL_MISMATCH`，消息里写了怎么办 |
| `clock` | — | `{nativeMonoUs}` |
| `sources` | — | `{displays: [{kind: "display", id, x, y, width, height, primary, refreshHz}]}`，坐标与尺寸是物理像素；`id` 是系统设备名（如 `\\.\DISPLAY1`） |
| `prepare` | 见下 | `{sessionId, width, height, fps, codec, encoder, source, files: {video, timing, activity, manifest}}`。建好采集与编码并开始采集，但不录；本机不支持时在这里报错 |
| `start` | `sessionId`，`atUs`（可选） | 同 `prepare` 的应答。从 `atUs`（默认此刻）起录。也可以不先 `prepare`，直接带上 `prepare` 的全部参数 |
| `pause` | `sessionId`，`atUs`（可选） | `{}`；生效后另发 `paused` 事件 |
| `resume` | `sessionId`，`atUs`（可选） | `{}`；生效后另发 `resumed` 事件 |
| `stop` | `sessionId`，`atUs`（可选） | 文件收尾之后才应答：见“停止的结果” |
| `cancel` | `sessionId` | `{}`；停止并删掉这次的全部文件 |
| `status` | `sessionId` | 最近一次健康汇报的内容加 `state`（`prepared` / `recording` / `paused` / `stopping` / `ended`） |

`prepare` 的参数：

| 字段 | 说明 |
|---|---|
| `sessionId` | 主进程给的会话号 |
| `directory` | 这次录制的目录（不存在会创建） |
| `name` | 文件名前缀，默认 `screen` |
| `source` | `{kind: "display", id}`；或 `{kind: "display", point: [x, y]}`（物理像素坐标所在的显示器）；都不给是主显示器 |
| `fps` | 默认 60 |
| `codec` | `h264`（默认）或 `hevc` |
| `rateControl` | `quality`（默认，恒定质量、码率只作上限）、`vbr`、`cbr` |
| `bitrate` | 比特每秒；0 或不给时按分辨率与帧率取默认（4K60 约 40 Mbps） |
| `keyframeFrames` | 关键帧间隔，默认等于帧率（一秒）。每个关键帧起一个分片，这也是进程被杀时最多丢的时长 |

### 事件

| 事件 | 字段 | 说明 |
|---|---|---|
| `started` | `originUs`，`firstSourceUs` | 网格起点已定：文件第 0 帧对应 `originUs` |
| `fragment` | `frames`，`bytes` | 又有分片落盘：进程此刻被杀，前 `frames` 帧读得回来。约每秒一条 |
| `paused` | `atUs`，`cell`，`frame` | 暂停生效：文件第 `frame` 帧之前的内容已落盘 |
| `resumed` | `atUs`，`cell`，`frame` | 继续生效：文件第 `frame` 帧是继续后的第一帧（关键帧） |
| `interrupted` | 停止的结果 + `error` | 录制被迫结束（来源消失、设备被移除、编码或写盘失败）。能收尾的已收尾，已录部分保留 |
| `health`（可丢） | 见下 | 每秒一次 |

`health` 的字段：`frames`（已出的帧序号数）、`encodedFrames`、`cells`、`freshFrames`、`repeatedFrames`、`droppedFrames`、`sourceSurplus`、`pausedCells`、`sourceFrames`、`captureDropped`、`captureQueueMax`、`writeQueue`、`writeQueueMax`、`encodeAvgUs`、`encodeMaxUs`、`writeMaxUs`（“最大”类是最近一秒内的）、`bytes`、`durableFrames`、`sourceIntervalUs {count, p50, p99, max}`、`arrivalLatencyUs {count, min, avg, max}`、`sourceAgeUs`、`cpuPercent`（100 = 占满一个核）、`privateBytes`、`gpuBytes`、`nativeMonoUs`。

计数的含义：

- `freshFrames`：系统给的新画面第一次进文件的帧数。
- `repeatedFrames`：没有新画面、重复上一帧的帧数。画面静止时这是常态，不是问题。
- `droppedFrames`：会话线程积压过多被跳过的格子（占帧序号、文件里没有这一帧）。**不为 0 就是编码或磁盘跟不上。**
- `captureDropped`：收件箱满了被挤掉的来源帧。**不为 0 说明会话线程卡住过。**
- `sourceSurplus`：来源帧多于格子、没进文件的张数（高刷新率显示器上是常态）。

### 停止的结果

`{frames, encodedFrames, cells, durationUs, originUs, freshFrames, repeatedFrames, droppedFrames, sourceSurplus, pausedCells, sourceFrames, captureDropped, bytes, durableFrames, files}`。

`frames` 是时刻表的条数，也是文件时间轴的长度（帧）；`encodedFrames = frames - droppedFrames` 是文件里实际的帧数。一帧都没录到时不留文件，`frames` 为 0。

### 错误码

| 错误码 | 含义 | 主进程该怎么办 |
|---|---|---|
| `ENCODER_UNSUPPORTED` | 没有 NVIDIA 显卡，或硬件编码器打不开 | 改用现有录法 |
| `CAPTURE_UNSUPPORTED` | 系统太旧（没有采集接口或关不掉光标） | 改用现有录法 |
| `SOURCE_MISSING` | 找不到要录的显示器 | 重新枚举，让用户重选 |
| `SOURCE_LOST` | 录制中显示器断开 | 已录部分保留；可以重新 `prepare` 续录到新文件 |
| `DEVICE_REMOVED` | 显卡设备重置或被移除 | 同上（进程也可能直接崩掉，按意外退出处理） |
| `ENCODER_FAILED` | 编码中途失败 | 同上 |
| `DISK_FULL` / `FILE_ERROR` | 写盘失败 | 已录部分保留，提示用户 |
| `SESSION_ACTIVE` / `SESSION_MISSING` / `INVALID_STATE` | 指令与当前状态不符 | 调用方的问题 |
| `INVALID_ARGUMENT` | 参数不对 | 调用方的问题 |
| `PROTOCOL_MISMATCH` | 应用与采集程序版本不配套 | 把消息原样给用户（重新安装；开发环境重新构建） |
| `CAPTURE_FAILED` | 其他 | 记日志，改用现有录法 |

`recoverable` 为 `false` 的只有 `INVALID_ARGUMENT` 与 `PROTOCOL_MISMATCH`。

## 文件

一次录制在 `directory` 下写四个文件（`name` 默认 `screen`）：

| 文件 | 内容 | 进程被杀后 |
|---|---|---|
| `screen.mp4` | 分片 MP4，H.264 或 HEVC，恒定帧率，BT.709 有限范围，无 B 帧，默认每秒一个关键帧、一个分片。时间基 1/fps 上 pts = 帧序号 | 读得到最后一个落盘的分片（最多丢约一秒） |
| `screen.frames` | 逐帧时刻表（二进制） | 每秒落盘一次；尾部不完整的记录舍去 |
| `screen.activity.jsonl` | 活动时间线（一行一条 JSON） | 同上 |
| `screen.capture.json` | 清单：参数、起点、结果 | 开始时写一次（`completed: false`），收尾时重写 |

被杀之后三份文件的长度可能差一秒以内：取“文件帧数”与“时刻表条数”里较小的那个为准。

### 逐帧时刻表 `screen.frames`（版本 1，小端）

文件头 64 字节：

| 偏移 | 类型 | 内容 |
|---|---|---|
| 0 | 4 字节 | 魔数 `HJFT` |
| 4 | u32 | 版本，目前为 1 |
| 8 | u32 | 文件头字节数（64） |
| 12 | u32 | 每条记录字节数（16） |
| 16 | u32 | 帧率分子 |
| 20 | u32 | 帧率分母 |
| 24 | i64 | 网格起点 `originUs` |
| 32 | u32 | 时钟种类：1 = QPC，2 = mach_absolute_time |
| 36 | — | 保留，全 0 |

之后每条记录 16 字节，**第 n 条对应文件里 pts = n 的帧**：

| 偏移 | 类型 | 内容 |
|---|---|---|
| 0 | i64 | 这一帧所用来源帧的系统时刻（微秒）。同一张来源帧重复出现时这个值相同 |
| 8 | u32 | 网格格号 `cell`。格时刻 = `originUs + cell × 1000000 × 分母 / 分子` |
| 12 | u16 | 标志：1 = 新帧（没有这一位是重复帧）；2 = 被丢弃（文件里没有这一帧）；4 = 强制关键帧；8 = 继续后的第一帧 |
| 14 | u16 | 保留 |

怎么用：

- **事件对到帧**：事件时刻 `t`（换算到同一时钟）落在哪一帧——找第一条“新帧且系统时刻 ≥ t”的记录，它的序号就是这个事件之后第一张新画面。
- **帧对到真实时间**：第 n 帧在录制时间轴上的位置是格时刻；它显示的画面真正出现的时刻是记录里的系统时刻。
- **暂停**：相邻两条记录的格号不连续，中间缺的格子就是暂停掉的；文件时间轴在这里是连续的。也可以直接看活动时间线里的 `pause` / `resume`。
- 读的时候按文件头里的“文件头字节数”“每条记录字节数”跳，后续版本只会在保留区加字段或加长记录。

Windows 上来源帧的系统时刻取自 `Direct3D11CaptureFrame.SystemRelativeTime`。实测它比帧到达进程的时刻**晚**几毫秒（见进度与交接里的数字）：它是这一帧上屏的时刻，不是合成完成的时刻。

### 活动时间线 `screen.activity.jsonl`

一行一条 JSON，`timeUs` 是单调时钟微秒，`frame` 是文件帧序号：

| `type` | 字段 | 说明 |
|---|---|---|
| `start` | `timeUs`，`fps` | 网格起点 |
| `motion` | `frame`，`timeUs`，`cells`，`freshFrames`，`bytes` | 从第 `frame` 帧起的 `cells` 帧（通常一秒）里，系统给了几张新画面、编码后共多少字节。`freshFrames` 为 0 一定是静止；屏幕上有窗口不停重画时新帧一直有，这时看 `bytes`（没变的帧编码后只有几百字节） |
| `foreground` | `frame`，`timeUs`，`title`，`process`，`pid` | 前台窗口或它的标题变了（约四分之一秒查一次） |
| `pause` / `resume` / `stop` | `frame`，`timeUs` | |

### 清单 `screen.capture.json`

`{format: "henji-screen-capture", version: 1, protocol, sessionId, completed, video: {file, codec, encoder, width, height, fpsNum, fpsDen, colorMatrix, colorRange, keyframeFrames}, timing: {file, version}, activity: {file}, clock, originUs, writtenAtUnixMs, source, result, error}`。

`completed` 为 `false` 说明进程没能正常收尾（被杀或出错），此时 `result` 为空，以文件与时刻表的实际内容为准。

## 主进程怎么调用（建议的顺序）

1. 启动进程，发 `hello`（带上自己的协议号）；失败就整个改用现有录法。
2. 用户点开录制面板时发 `prepare`：这一步会真正打开采集与编码器（约 0.3–0.5 秒），失败按错误码处理；Windows 10 上此刻黄色边框出现。
3. 倒计时结束发 `start`；收到 `started` 后记下 `originUs`。声音、事件按同一时钟对齐。
4. 暂停 / 继续发 `pause` / `resume`；以 `paused` / `resumed` 事件里的 `frame` 为准记暂停位置。
5. 发 `stop`，等应答（文件已收尾）。之后读时刻表与活动时间线。
6. 录制中进程意外退出：文件按“被杀之后”处理（读到最后一个完整分片），重新启动进程续录到新文件。

可运行的示例见 `selftest/selftest.cjs` 里的 `CaptureClient`。
