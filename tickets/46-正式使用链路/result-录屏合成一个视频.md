# 结果：一次录屏是一个视频素材（2026-11-13）

只改代码与测试，没碰 git、没启动或重启应用、没 bundle。另一位子代理负责的音频编辑文件一个没动。

## 现状与对照结论

**画面怎么分段**：`gfxcapture.ts` 的 `pause()` = 发 `q` 结束 FFmpeg 并按进度封口，`resume()` = 重新开进程、`storage.openSpan` 新建 `screen-00000N.mp4`。`capture.json` 的 `spans` 和录制文档 `media` 里每片一项（`screen-N`，`monoUs` 是这片第一帧的会话时刻，按 `now − out_time` 的最小值估）。停止收尾 `RecordingSessionDocument.finish`：`recoverCapture` 补齐未封口分片 → `audio-join` 拼声音 → 一次写全文档。原分片、5 秒声音分段收尾后都不删。

**声音拼接在有暂停时不是一条**：`audio-join.ts` 遇到轨道空档（含 `reason: 'pause'`）就另起一条，所以一次暂停每路是两条（真实会话 `606aa4a1…`：`microphone-joined-000/001`、`systemAudio-joined-000/001`）。“去掉暂停后的连续一条”要在这之后再拼。

**三套暂停区间对不上（这是根因）**。同一次暂停，真实会话里量到：

| 来源 | 暂停开始 | 恢复 |
|---|---|---|
| 文档 `pauses`（按下暂停 / 恢复命令全部完成） | 50.387 s | 63.655 s |
| 事件时钟（collector 的 pause/resume 控制事件，`recordingUs` 按它扣暂停） | 50.717 s | 63.653 s |
| 麦克风/系统声的 pause 空档 | 50.720 s | 61.45 s |
| 画面（上一片结尾 / 下一片第一帧） | 51.03 s | **62.557 s** |

画面恢复后约 1.1 秒（用户已经按了继续）才等到恢复命令完成，事件时钟这时才接着走；文档按下暂停后又要等一次存盘（约 0.33 秒）事件时钟才停。

**由此查出两处已有的光标错位**（`recordingMovieSources.ts`，与合并无关、修根因一并修了）：
- 恢复后的分片：选事件时钟偏移时按“偏移变化点 ≤ 素材起点”找，恢复后的分片第一帧早于 resume 事件，于是用了暂停前的偏移，**整段光标错开一个暂停长度**（这个会话是 12.9 秒）。已改成用素材第一帧之后第一段事件的偏移。
- 第一片：事件时钟在画面第一帧约 1 秒后才开始，`recordingStartUs` 为负被截成 0，**整段光标提前约 1 秒**。`recordingStartUs` 是剪辑持久格式里的非负字段，旧会话改不了；新录制从源头修（下面第 2 条）。

**对照 OBS**（调研第 7 节）：暂停期间编码器不停，按时间戳丢帧并从所有时间戳里减去累计暂停，结果是一个连续文件。核心是“画面、声音、事件扣掉的是同一段”。FFmpeg 命令行没有暂停丢帧的接口（调研已论证 (b) 不可行），所以不做方案 B。

**concat 分离器的约束（FFmpeg 官方 formats 文档）**：各文件要同样的流与编码参数；`outpoint` 按解码时间戳判断结束，非帧内编码有 B 帧时会多出包，我们录制是 `-bf 0`，DTS=PTS，按帧切准；下一文件从 `outpoint` 处接上；`inpoint` 落在非关键帧会带出关键帧前的包，所以只用每片自己的第一帧（关键帧）起，不用 inpoint。

**实测（只读原目录，输出在临时目录，已删）**：会话 `606aa4a1…` 的两片 4K60 NVENC（extradata SHA256 一致）。按帧边界取 outpoint 拼接：13300 帧 = 2881 + 10419，时长 221.666667 s = 13300/60，全片帧距零异常，接缝前后 4 秒逐帧解码 240 帧无报错；491 MB，缓存热时 1.3 秒（冷盘约为磁盘顺序读写速度）。第一次试验用未取整的 outpoint，接缝处出现一个 5 ms 的帧距，所以实现里 outpoint 取到帧边界再向下舍到微秒。

**下游对“一个素材 / 多个素材”的假设**：剪辑里的光标、自动缩放、注意力推近、跟踪都只经 `media.recordingCursor`（事件页引用 + `recordingStartUs`，`素材时间 + recordingStartUs = recordingUs`）读事件，是线性换算。只要合并文件扣掉的暂停与事件时钟扣掉的一样长，一个 `recordingStartUs` 就处处对齐。录制文档上的理解、打码、多产物、导演、成片、重配旁白、快速录制都按会话时钟读 `media` 里的各分片，所以**录制文档里的原分片保留不动**，合并文件只作为剪辑素材。

## 选的做法与理由：A（停止后无损合并），加一处源头对齐

1. **统一暂停区间**（`alignRecordingPauses`，收尾与崩溃恢复都调用）：暂停长度以事件时钟为准（事件页不可改），暂停结束放在恢复后画面第一帧上、起点往前推同样长度。只有暂停/恢复事件成对、恢复后的分片落在其间、两者相差 ≤250 ms 时才改；旧会话（差约 1.1 秒）原样保留、按分段导入。
2. **事件时钟跟画面走**（`events.ts`，采集里唯一的改动，只改传给事件时钟的时刻）：开始时零点放在画面第一帧前 1 秒（`recordingStartUs` 不会为负）；恢复时从画面第一帧接着走（新增可选 `capturingSinceUs()`，gfxcapture 返回当前分片第一帧）；按下暂停那一刻就停事件（`pausing` 先停事件再存文档）。FFmpeg 进程、暂停与续录流程都没动。
3. **合并**（主进程 `combine.ts`，导入剪辑前由新的 `combine` 采集操作调用）：画面复用 `quick-export.ts` 的 concat 列表与 FFmpeg 调用，`-c copy`，每片只切末尾，输出与录制同样的分片 MP4；先写 `.partial`，核对“时长 = 各段帧数之和（误差 <1.5 帧）”后才改名，失败删半成品、原分片不动。编码参数（含 extradata 哈希）不同的两片、编码器重启留下的真实空档（不是暂停）从那里分组，空档如实留空。声音每路按同一份分组流式拼成一条，与画面文件时间一致，没录到的地方写静音占位。已合并且完整的直接复用；10 分钟没动过的半成品下次合并时清掉。
4. **导入**（`recordingVideoImport.ts`）：能合并时导入“会话名 · 屏幕 / 麦克风 / 系统声音”三项，暂停不占时间线，一个画面片段、两条声音片段对齐，同一组链接；声音只在真录到的地方放片段，设备断开的空档仍分开；摄像头保持分段、按同一换算落位、同组链接。合并失败或不需要（旧会话、只有一片）时走原来的逐片导入（“第 N 段”），结果里写明原因。

不选 B：FFmpeg 命令行做不到暂停丢帧续写同一文件；继续后约 1.6 秒没画面的问题仍在（需要改采集，留作以后）。

## 改动文件

- `src/core/screenRecording/combine.ts`（新）：合并规划、文件时间换算、暂停对齐
- `src/core/screenRecording/combine.test.ts`（新）
- `src/core/screenRecording/capture.ts`：新增 `combine` 采集操作
- `electron/main/services/screen-recording/combine.ts`（新）：画面与声音合并
- `electron/main/services/screen-recording/combine.test.ts`（新，真实 FFmpeg）
- `electron/main/services/screen-recording/control.ts`：`capturingSinceUs` 接口
- `electron/main/services/screen-recording/events.ts`：事件时钟起点、恢复点与按下暂停即停
- `electron/main/services/screen-recording/events.test.ts`
- `electron/main/services/screen-recording/session-document.ts`：收尾与恢复时统一暂停区间
- `electron/main/services/screen-recording/session-document.test.ts`
- `electron/main/services/screen-recording/quick-export.ts`：导出 `runFfmpeg` 供合并复用
- `electron/main/services/screen-recording/capture/service.ts`：`capturingSinceUs`、`combine` 操作
- `src/features/screenRecording/application/recordingVideoImport.ts`：合并导入、结果带 `combined/separate`
- `src/features/screenRecording/application/recordingVideoImport.test.ts`
- `src/features/screenRecording/application/recordingMovieSources.ts`：恢复后分片的事件偏移；可传合并文件
- `src/features/screenRecording/application/recordingMovieSources.test.ts`
- `src/features/screenRecording/application/recordingService.ts`：停止去向带 `combined/separate`
- `src/features/screenRecording/application/applicationDomain.ts`：停止与导入回执改成“一个画面素材”的说法
- `src/features/screenRecording/application/applicationDomain.test.ts`
- `src/features/screenRecording/application/recordingReflection.ts`：details.media 说明是录制原件
- `src/core/application-control/domains/screenRecording/recordingCapabilities.ts`：暂停、停止、导入的描述
- `resources/assistant-skills/video-edit-workbench/references/screen-recording.md`

## 落盘格式

没改。录制文档 schema 不变，只是收尾时 `pauses` 写得更准（含义不变：从按下暂停到各轨都恢复）；`capture.json`、`tracks.journal`、剪辑文档不变。新增文件 `screen-combined-NNN.mp4`、`<轨>-combined-NNN.wav` 是标准媒体文件，放在会话目录。`check:persistence-compat` 通过（67 种格式）。已有录屏工程照常打开，旧会话按分段导入。

## 验证

- 精确测试全部通过：`combine.test.ts`（core 3 条：时长等于各段之和、合并文件上事件与画面逐点对齐、旧会话与编码重启/编码参数变化不合并）；`combine.test.ts`（main 2 条，真实 FFmpeg 生成两片 H.264：拼出 195 帧 = 90+105、时长 6.5 s、接缝帧距恒定、原分片大小不变、声音逐点来自对应时刻且没录到处是静音、再导复用；时长对不上时报错、不留半成品、原分片都在）；`recordingVideoImport.test.ts` 8 条（新增：只导一个画面片段且与两路声音同组链接、设备空档分开、预热裁掉；合并失败照原样导入并写明原因）；`recordingMovieSources.test.ts` 2 条（新增：恢复后分片光标对齐，旧逻辑会差 3 秒）；`events.test.ts` 7 条（新增事件时钟起点/恢复点/按下暂停即停）；`session-document.test.ts` 7 条（新增收尾统一暂停）；`applicationDomain.test.ts` 6 条；另跑 `quick-export`、`control`、`runtime`、`capture/service`、`capture/capture`、`range`、`document` 的测试，35 条通过。
- 主进程 tsc 0 错误；渲染层 tsc（heavy.sh，12G）0 错误（都含工作区里别人未提交的改动）。
- 改到文件的 eslint 通过；`check:main-imports`、`check:skill-sync` 通过。
- `check:assistant-capabilities:structure` 失败一条，原有问题：`src/workspaces/GenerationWorkspace/hooks/resultSelection.ts` 的 store 未建账。
- 独立审查一轮由主代理完成，见下节。

## 审查一轮之后的修改

- 重要（实现疏漏，主代理已修）：`recordingCombinePlan` 里同一次录制只要有一次暂停没对齐（恢复后的分片第一帧落在暂停里），整次录制逐片导入；原先会把暂停里约 1 秒画面算进来、结尾少一截。`joins` 里重复的同一条件已删。补测试：两次暂停一次对齐、一次没对齐（文档暂停 20–23.1 s，画面 22 s 恢复）→ 计划为 null。
- 磁盘空间检查按要写的每个文件扣：画面按原分片大小、各路声音按原文件采样量，不够整次不合并。
- `writeCombinedAudio` 的改名放进 try，失败清掉半成品。
- 一路声音中途换了采样格式：只这一路照原样分段导入（素材名“麦克风 第 N 段”，按同一换算落在暂停折叠后的时间线上、同组链接），画面与另一路照样合并；结果写“麦克风中途换了采样格式，拼不成一条，照原样分段导入”。补主进程与导入测试各一条。
- 编码器中途重启分成几组时，停止回执与导入回执按实际个数写（“画面因编码中途重启分成 2 个素材，各自与同段声音链接成组”），不说“一个”；导入结果新增 `screens`（画面素材个数）。补回执测试。
- 重跑：`src/core/screenRecording/combine.test.ts`、`electron/main/services/screen-recording/combine.test.ts`（3 条，真实 FFmpeg）、`recordingVideoImport.test.ts`（9 条）、`applicationDomain.test.ts`（6 条）全部通过；主进程与渲染层 tsc 0 错误；改到文件的 eslint 通过。

## 待真实窗口验证

需要先 `electron:bundle`，新录一段（旧会话不会合并）：
1. 录屏 → 暂停 → 继续 → 暂停 → 继续 → 停止并送进剪辑：素材库只有“会话名 · 屏幕 / 麦克风 / 系统声音”三项；时间线一个画面片段、两条声音，同一组链接，暂停不占时间线；会话目录多出 `screen-combined-000.mp4` 与两条 `*-combined-000.wav`。
2. 播放每次继续后的那几秒：重绘光标、点击、自动缩放与画面对齐（光标在继续后约 1 秒内不显示，是那段没有事件，见风险）。
3. 拍手核对音画：开头、每个接缝前后、结尾。
4. 日志：`recording.pauses.aligned` 的 aligned 等于暂停次数；`recording.combine.completed` 的 elapsedMs；没有 `recording.combine.failed`。
5. 读 `screen_recording.session` 的 elapsed_ms 与时间线片段时长一致。
6. 对今天走查留下的旧会话再导一次：仍是分段导入，第二段光标不再错开 12.9 秒（第一段约 1 秒的提前仍在）。

## 风险与没做的

- **磁盘多一份画面**：原分片不删（录制文档上的理解、打码、多产物、导演、成片、快速录制按会话时钟读它们），4K60 40 Mbps 一小时多约 18 GB，合并时间约等于顺序复制一遍。要删分片，得先把录制文档里的画面改成“合并文件 + 时间换算”并迁移这十来处读取方（持久格式要升版本、提高最低可读版本），建议另立一项。
- 旧会话（今天及以前录的）不合并，第一段光标约 1 秒的提前改不了（`recordingStartUs` 不能为负）。
- 继续后约 1 秒事件钩子还没挂上，那段没有光标与点击；继续后画面约 1.6 秒才出（方案 B 的问题）都没动。
- 暂停对齐的容差 250 ms 按估算定，`span.monoUs` 在事件时钟接着走之后还会往前修正，实际差多少没在真实录制里量过（看日志 `recording.pauses.aligned`）。
- 兼容采集（chromium 后端）没有 `capturingSinceUs`，暂停对不齐，照旧按分段导入。
- 只是编码参数不同、因而没合并时，导入结果里没写原因（只记日志 `recording.combine.skipped`）。
- 合并在导入时做，停止回执最多等 45 秒；超长录制时返回 finishing，导入照常在后台完成。
- 合并没有进度、不能单独取消（取消导入不会中断正在跑的 FFmpeg 拼接）。
- 界面不提示合并会多占一份画面的磁盘空间。
- 原分片不能删（理由见第一条），暂不提供“合并后删除分片”。

## 第三轮走查 A-1“光标超前约 1 秒”的核查（2026-11-13 晚）

**结论：录屏 A2 的换算链没有 1 秒的错；“超前 1 秒”来自任务栏时钟这个锚点本身晚跳约 1 秒。新录制实测光标与画面差约 1.3 帧，已把画面第一帧时刻改成按采集出帧打点估，预计降到一帧以内（待重录确认）。**

### 1. A2 换算链逐环（会话 `00b6ae83…`，脚本 scratchpad `a2-chain.cjs`）

| 环 | 值 |
|---|---|
| 事件时钟零点（collector start，会话时钟） | 0.739 s（= 恢复时画面时刻 1.739 − 1 s 余量） |
| 第一片画面第一帧（span.monoUs，收尾时修正后的最小估计） | 1.666 s |
| recordingStartUs（剪辑里实际存的） | 0.926647 s = 1.666 − 0.739 ✔ |
| 片段 sourceIn（去掉预热） | 1.7398 s = startUs 3.4057 − 1.666 ✔ |
| 两次暂停长度：文档（对齐后） / 事件时钟 | 11.95984 / 11.95984 s，11.94622 / 11.94622 s，完全相等 ✔ |
| 时间线 29.62 s → 合并文件 31.36 s → 会话时钟 44.994 s | 画面按链算的事件时刻 32.2947 s，剪辑取光标用的事件时刻 32.2865 s（差 8 ms，按帧取整） |
| 验证者按任务栏跳分推的事件时刻 | 31.26 s，比链上的 32.29 s 早 1.03 s |

链内部一致；与验证者相差的 1.03 s 全部落在“任务栏在真实整分那一刻跳字”这个假设上。

### 2. 用 QPC 真值核对（不依赖任务栏）

- **任务栏时钟本身晚跳**（`taskbar-clock-probe.cjs`，同一台机器录任务栏区域跨整分，画面时刻按采集打点、墙钟按 `Date.now` 与 hrtime 对照）：两次分别晚 **985 ms** 与 **498 ms**。所以任务栏时钟只能当 ±1 秒的粗锚，A2 那次正好晚了约 1 秒。
- **正式应用真实录制**（会话 `22944177…`，“光标对齐核对”，录的是一个按 QPC 每秒黑白翻转、同时把鼠标移到窗口另一侧的小窗口，翻转时刻用 `Stopwatch.GetTimestamp` 记；`real-align.cjs` 逐次对照，21 次）：
  - 画面：分片帧号推出的时刻比真实翻转晚 24–36 ms（中位 34 ms，含合成上屏 ≤1 帧与帧网格取整）；
  - 事件：光标跳变比真实移动晚 0.6–14.5 ms（中位 9 ms，120 Hz 采样）；
  - 剪辑：在翻转出现的那一帧，剪辑取光标用的事件时刻比真实跳变晚 13.7–33.8 ms（中位 22 ms ≈ 1.3 帧），即光标比画面早约 1.3 帧，**不是 1 秒**。
- **单独跑同样参数的 FFmpeg**（`flip-probe.cjs`，录同一种翻转窗口）：现在的“编码进度估计”（`now − out_time` 最小值）比真实翻转晚 26–38 ms；改成在采集之后立即打点（下面的修法）后 12–25 ms，两者差 7–14 ms，这部分就是编码与封装排队。

### 3. 对照成熟做法与 FFmpeg 源码

- gfxcapture 帧时间戳 = WGC 的 `SystemRelativeTime` 减去第一帧的值（`frame->pts -= ctx->first_pts`），第一帧的 QPC 不输出，`-copyts`、`-use_wallclock_as_timestamps` 都在它减完之后，拿不回绝对时刻（`调研-Rust画面采集进程.md` 第 1 节同此结论）。OBS 与 Cap 都是在采集进程里直接拿每帧的系统时刻；在 FFmpeg 命令行架构下，最接近的是在滤镜图里紧跟采集打点：`setpts='PTS+0*print(PTS*TB\,16)'` 把每帧相对时刻以错误级打到 stderr，不改时间戳，开销是每秒 60 行。
- “60 Hz 屏上实际出帧不足 60”不影响时长：输出是 `-fps_mode cfr -r 60`，文件帧数就是名义帧数；A2 合并文件 6025 帧 = 100.4167 s × 60。

### 4. 合并后少 1.97 秒（A-2）：有意裁掉

三段各自在“按下暂停（或停止）”之后还录了约 0.65 s（发 `q` 到编码器收尾）：0.6585 + 0.6494 + 0.6592 = **1.9670 s**，正好是 102.3833 − 100.4167。时间线再少的 1.74 s 是开头倒计时预热。都不进成品，符合设计。

### 5. 修法（本次改动）

- `electron/main/services/screen-recording/capture/gfxcapture.ts`：采集滤镜后加 `setpts` 打点；第一帧会话时刻取“打点到达 − 帧时刻”与“编码进度到达 − out_time”两类估计的最小值（打点总是更早），打点行不进报错文本。暂停对齐、事件时钟起点与恢复点读的都是这个值，三条路（无暂停、合并、分段回退）同时受益。
- `capture.test.ts` 新增一例：打点 3.0 s、编码进度晚 100 ms 时，起点取 3.0 s（旧逻辑得 3.1 s，红）；打点行不进报错文本、命令行带打点滤镜。
- 主进程 tsc 0 错误；`capture.test.ts`、`encoding.test.ts`、`service.test.ts` 共 50 条通过；eslint 通过。

**精度说明（如实）**：改后预计光标比画面早约 0.5 帧（按真实录制 22 ms 减去单独实测的 7–14 ms 估）。剩下的来自 WGC 合成到上屏的不确定（≤1 帧）和帧网格取整，命令行架构下消不掉；要逐帧精确，需要调研里的自有采集进程（逐帧 QPC 时刻表）。改后的数字是推算的，正式应用里还没重录核对（不能重新打包）。

### 6. 需要真实窗口重录验证

1. `electron:bundle` 后，用 scratchpad 的 `flip-window2.ps1`（窗口按 QPC 每秒翻转并移动鼠标，记 `flips.log`）录一段，中间暂停、继续一次，停止。
2. 跑 `real-align.cjs <ffmpeg> <会话目录> <.hjrec> flips.log`：`editLookupMinusCursorEventMs` 中位应在 ±16.7 ms 内（现在 22 ms）；暂停之后与之前一致。
3. 不要再用任务栏时钟做绝对锚（实测会晚跳 0.5–1 秒）。

测试留下的会话“光标对齐核对”（`Recordings/光标对齐核对.hjrec`，状态 interrupted：录到一半测试窗口关了）是本次证据，可删。
