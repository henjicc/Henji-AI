# 结果：录屏长时间录制不断、不丢（2026-11-13）

对应排查报告 `排查-录制.md` 的 P0-1、P0-3、P0-4（录屏部分）、P1-1、P1-2、P1-3、P1-5（录屏部分）、S-2、S-5，以及协调方转来的录音侧对接点（`result-录音.md` 第五节）。验证级别 L2（持久格式新增、主进程服务、IPC 契约、跨进程状态机）。未提交、未碰 git、未启动开发版。做过两轮独立审查，处理见第七节。

## 一、逐条根因与改法

### 1. 越录越慢直至失败（P0-1）

**根因**：每封一页事件（约 2 秒一页）、每封一段声音（每路 5 秒一段），`RecordingSessionDocument` 都把整份文档按 schema 校验后整份写盘；文档随时长线性变大，总写入量按时长平方增长。另外采集器积压到 4 页就判失败停录。

**改法**：
- 录制期间文档只在开始、暂停、恢复、画面分片变化这些少数时刻保存，内容里不带事件页索引和声音轨道（这两样留在主进程内存）。停止、取消或失败时由唯一的收尾 `finish()` 一次写全（`session-document.ts`）。
- 事件页本来就是独立的内容寻址文件，`page()` 只记索引不存文档。录制中读事件（助手）走内存里的页索引。
- 声音与摄像头分段改成追加式记录：界面每开一段、封一段、记一个空档或警告，就通过新的 `track` 操作报给主进程；主进程 `RecordingTrackLedger`（`track-ledger.ts`）追加一行到会话目录的 `tracks.journal` 并 `datasync`。每次写入大小与录制时长无关。
- 归并规则只有一份：`src/core/screenRecording/trackJournal.ts` 的 `RecordingTrackState`。界面本地状态、主进程权威状态、崩溃后重放都用它（漂移造成的一个量子重叠以下一段起点为界，这条规则从界面搬到了这里）。
- 积压不再停录：`CaptureLogCollector` 写盘跟不上时页留在内存排队，积压翻倍（8、16、32…页）时记一条 `recording.events.backlog`，峰值进汇总；只有写盘真的失败才结束。声音轨的单路排队上限从 4 MiB 放到 256 MiB（系统声约 8 分钟），超过 16 MiB 记 `recording.tracks.backlog`。
- 轨道记录写不进去只记错误（`recording.tracks.journal.failed`），不中断录制：它只影响崩溃恢复，收尾用的是内存状态。

### 2. 界面重载或崩溃不结束录屏（P0-4）

**根因**：`runtime.ts` 在宿主页面导航、渲染进程退出时直接 `closeRecordingControl()` 取消整次录制；声音轨的状态只在界面里。

**改法**：
- 宿主断开时交给协调器处理（`openRecordingControl` 新增 `ownerLost`）：原生画面采集（gfxcapture）和事件采集都在主进程，照常录；只把声音轨标为“断开”，并在轨道记录里写一条 `detach`。断开期间发给界面的开始、暂停、停止命令直接跳过，不等回执；暂停与恢复不再核对已随导航撤销的页面授权（同一会话的来源已经确认过）。
- 兼容采集（chromium 后端）的画面本身在界面里编码，界面没了就录不下去：按采集失败收尾，已录部分保住。
- 同文档内的地址变化（`replaceState`、锚点）不算断开，判断与录音侧一致。
- 界面回来后（`App.tsx` 启动时调用 `attachActiveRecording`）：通过新的 `attach` 操作接回，主进程为同一宿主重新登记这次会话的授权，交还 `prepared`、轨道选项和停止后的安排（进剪辑、存成视频、目标剪辑；准备时通过 `followUp` 交给主进程保管）。界面按当时阶段处理：录制中或倒计时立刻开设备，暂停中等恢复命令，还没开始的等开始命令，已停止的直接走原来的收尾（进剪辑或存视频），失败的只关控制条。录制页显示时长、可暂停和停止，目标剪辑重新被占用。
- 断开期间声音没有数据：收尾时，归属不同界面的相邻分段之间自动记一段 `missing-data` 空档（不是静音）。
- 声音写法改成可随时安全截断：WAV 按 32 KiB 一块写盘（48 kHz 24 位单声道约 0.2 秒），每段一开头就登记 `open` 记录（位置、时钟、第一个锚点）。界面任何时刻退出，收尾时主进程按文件里实际写到的完整帧补齐 WAV 头部长度，把这一段补成正常分段。分段仍是 5 秒（漂移校正需要），但丢的部分不超过约 0.2 秒，再由第 5 条的原生副本补齐。

### 3. 中断后的恢复入口（P0-3、S-2、S-5）

**根因**：失败或取消时画面分片不封口，时长记 0，被导入过滤；应用崩溃时文档停在录制中，从素材库打开报“请先停止录制或恢复已中断会话”；恢复只有助手能调；恢复把每个分片完整复制一份；最后一个没封口的声音段不在清单里。

**改法**：
- 收尾 `finish()` 和恢复 `recoverRecordingSession()` 共用补齐逻辑：
  - 画面分片没封口的，先直接用 ffprobe 读原分片的真实时长（分片 MP4 边录边可读），用原件；原件读不出时才另存一份重新封装的副本（`storage.ts` 的 `recoverCapture`，不再整份复制每个分片）。
  - 事件页从目录重建（原有）；声音轨道重放 `tracks.journal`，半行丢弃，未封口的分段按文件补齐（第 2 条）；没有 `tracks.journal` 的旧录制沿用文档里的轨道。
  - 拼接声音（第 4 条），写回文档，状态记为“已中断”。什么也没录到的（倒计时里中断）记为已结束。
- 结束状态只由收尾写：收尾进行到一半崩溃，文档仍停在录制中，下次会被找出来。已经收尾或恢复过的不再重做。
- 启动时自动发现：主进程新增 `unfinished` 操作，列出停在“准备/录制中/暂停”的录制（跳过正在录和正在准备的那一个），逐个恢复。界面弹提示“上次录制意外中断，已恢复「名称」到 mm:ss”，可直接“打开剪辑”。
- 录制页设置栏顶部显示两周内中断、还没进过剪辑的录制（`RecordingRecoveryBanner.tsx`，照 `AudioCaptureRecoveryBanner` 的写法，用 `UiGroup` + 次要按钮“打开剪辑”+ 删除图标按钮“移到回收站”）。
- 导入前（`recordingVideoImport.ts`）遇到需要恢复的录制先调同一个 `recover-session`，所以从素材库打开、助手导入、横幅打开走的都是同一实现。
- 用户点“取消”记为已结束（内容完整保留，只是没导入）；只有采集出错才记“已中断”，横幅不会把用户自己取消的列出来。

### 4. 声音每 5 秒一个文件（P1-1）

**根因**：导入时每个 5 秒分段单独成为一个素材和片段。一小时约 1440 个，而且每段起点按视频帧取整，段与段之间有亚帧的缺口或重叠（每 5 秒一次微小断续）。快速导出把每段都作为一个 ffmpeg 输入，长录制会超出命令行长度。

**改法**（`audio-join.ts`）：收尾时每路声音拼成连续的一条 WAV（`microphone-joined-000.wav` 等），作为文档 `media` 里的声音条目；导入、快速导出、成片、理解等所有读 `media` 的消费方自动变成每路一条。
- 每段按它真实开始的时刻落在对应采样位置上。设备时钟与系统时钟的偏差（几十 ppm，两小时可达几百毫秒）在每个拼接处吸收：把前一段末尾约 0.2 秒用四点三次插值轻微拉伸或压缩几个采样，让下一段准时开始。前后采样连续，不会爆音。
- 真实空档（暂停、设备断开、界面断开）处分成新的一条；相邻段之间超过 20 毫秒也分开。
- 超过 4 GiB 写 RF64；奇数长度补位。拼接失败（例如磁盘满）就沿用逐段文件，记 `recording.audio.join.failed`。
- 摄像头仍是分段（不在本次场景内）。分段文件保留，作为原始采集。

### 5. 麦克风在 C 盘多写一份完整 WAV（P1-2）+ 录音侧对接点 2

**根因**：共享麦克风的原生整段副本写在系统临时目录，正常停止才删；崩溃后没人清理，也没用于恢复。

**改法**：
- 录屏的麦克风副本写到录制自己的目录（`microphone-native-<uuid>.wav`；重连后的续写文件 `-N.wav` 也在这里）。只有录屏宿主传这个目录，网页录制备份录屏和讲解录制不变（`tracks/session.ts` 的 `microphoneCopyDirectory`，`microphone.ts` 的 `outputDirectory`）。
- 给了录制目录时，渲染层停止后不再删副本，留给主进程收尾。
- 收尾或恢复拼接麦克风时，用副本补齐推送丢掉的采样：按分段的源时钟偏移推出它在副本里的帧号，核对分段末尾 256 帧与副本同位置的声音一致（全零的数字静音说明不了出处，不认），才认定出自同一份录音。
  - 下一段也出自同一份副本时，补齐中间缺的帧，并把那段 `missing-data` 空档从轨道里去掉；
  - 否则（界面进程退出前没写完）补到副本结束、下一段开始或按下停止为止（没按停止的以最后一帧画面为止）。
- 拼接成功、麦克风有分段才删副本；一段都没有时留着并记 warn。

### 6. 编码进程意外退出（P1-3）

**根因**：ffmpeg 的 `close` 事件里不是预期退出就整次失败；硬件到软件的回退只在启动时。

**改法**（`gfxcapture.ts`）：
- 开始、暂停、停止与续录串行执行，任何时刻最多一个编码进程。
- 意外退出后，在新分片里按原参数接着录；硬件起不来就退回软件编码，H.265 再退 H.264（与启动时同一条回退链）。
- 退出的那一片不按进度报的时长封口（最后一个没写完的片段已经丢了），留给收尾按文件里真实的画面算时长。两片之间重启的一两秒没有画面，如实留空。
- 续录成功发系统通知“画面编码中断过一次，已自动接着录（已改用软件编码）”，日志 `recording.capture.restart.start/completed`。
- 一分钟内续录超过 5 次（来源窗口关了、显卡起不来）才停下，按采集失败收尾，已录部分照常可导入。

### 7. 提示与可观察性（P1-5）+ 录音侧对接点 3

- 系统通知合成一个共用实现 `electron/main/services/recording-notice.ts` 的 `notifyRecording`：窗口在前台不发；闪任务栏；点通知回到窗口；通知对象在用户点过或关掉前一直留着引用。录屏的 `notifyRecordingProblem` 与录音的中断通知（`electron/main/ipc/audio-capture.ts`）都改用它。
- 录屏意外停止（采集失败、界面退出导致兼容采集失败、编码反复退出、停止/暂停/恢复时存不进文档）时发“录制意外停止，已保存 X 分 Y 秒，可以导入剪辑”；收尾本身失败时提示“已写的文件都在，导入或重启应用时会自动补齐”。
- 每次结束（停止、取消、失败）写一条 `recording.capture.summary`，内容包括：
  - 状态、是否失败、后端、时长；
  - 画面分片数、补齐/弃用的分片数；
  - 丢帧与重复帧（解析 `-progress` 的 `drop_frames`/`dup_frames`）、编码续录次数、编码器；
  - 事件页数、事件条数、单页最长写盘耗时、事件页积压峰值、轨道记录单次最长写入耗时；
  - 界面断开次数、各轨分段数与空档数、拼成的声音条数。
- 其他新事件：`recording.host.detached/attached`、`recording.session.attach.completed/failed`、`recording.tracks.repair.completed/failed`、`recording.audio.join.completed`（含补齐的空档数）、`recording.session.recover.start/completed/failed/notified`、`recording.capture.recovery.completed`。

### 8. 事件与画面时间轴的对齐保持不变

时钟来源没有改：事件、画面、声音都用主进程 `hrtime` 与同一个 `originUs`；界面重新接上时沿用同一个原点。`audio-join.test.ts` 第一条断言了跨轨对齐：设备时钟快 100 ppm、8 段 5 秒；同一次“点击”在事件时刻与拼接后声音里的位置相差不到一个采样。直接首尾相接会晚约 3 毫秒，测试也确认了这一点。

### 录音侧对接点 1：命令失败时释放防睡眠锁

`control.ts` 的 `execute` 失败分支补上 `this.releaseResources()`，与采集失败（`fail()`）一致：放开快捷键、权限与防睡眠锁。`released` 里的释放是幂等的。

### 录音侧对接点 4（可选，未做）

主进程自动重连麦克风期间录屏界面不提示，空档记为 `missing-data`。没加 `reconnecting/reconnected` 事件；空档在收尾时能从副本补的会补上（重连前的旧文件由录音服务在会话结束时清理，所以跨重连那一段补不回来，本来那段时间设备也不在）。

## 二、持久格式变化与迁移

- **新增**资源格式 `screen-recording-track-journal` v1（`tracks.journal` 的一行；`minReaderVersion` 1）。
  - 登记在 `src/core/persistence/resourceContracts.ts`。
  - schema 在 `trackJournal.ts`：每行 `{ version, sessionId, record }`，`record` 是 open/seal/gap/warning/detach 之一。
  - 黄金样本 `tests/fixtures/persistence/screen-recording-track-journal/v1.json`，由正式序列化函数 `recordingTrackJournalLine` 生成。
  - 已运行 `npm run persistence:baseline` 与 `npm run persistence:release-snapshot`，`schemaBaseline.json`、`releasedCompatibility.json` 各追加一条；`check:persistence-compat` 通过（67 种格式）。
  - 重放时：更新版本写的记录整体拒绝（`newer-version`）；读不懂的单行跳过并记 warn。
- **录制会话文档（v80）、屏幕采集清单（capture.json v2）、`screen-recording-tracks` v1 的 schema 都没有改**，指纹不变。只是把 `tracks.ts` 里的几个子 schema 导出复用。
- 语义变化，不需要迁移：
  - 新录制的文档 `media` 里，声音是拼好的整条（文件名 `*-joined-*.wav`）；`tracks` 仍逐段记录原始采集。同一个 schema，旧程序读得懂（同样是“文件 + 起点 + 时长”）。
  - 录制进行中文档里不再有事件页和声音轨道，停止时一次写入。
- **旧录制照常可读**：没有 `tracks.journal` 的录制恢复时沿用文档里的轨道（有测试）；旧录制的逐段声音媒体照旧可导入；旧的“已中断、画面时长为 0”的录制在导入前会被补齐。

## 三、改动文件

核心（主进程与渲染层共用）：
- `src/core/screenRecording/trackJournal.ts`（新）、`trackJournal.test.ts`（新）
- `src/core/screenRecording/tracks.ts`：导出子 schema，结构不变
- `capture.ts`：IPC 契约新增 `track`/`attach`/`unfinished` 与 `prepare.followUp`；删除整份快照的 `tracks` 操作
- `document.ts`：`recordingNeedsRecovery`
- `range.ts`：`recordingDurationUs`
- `src/core/captureLog/collector.ts`、`collector.test.ts`
- `src/core/persistence/resourceContracts.ts`、`resourceContracts.test.ts`、`schemaBaseline.json`、`releasedCompatibility.json`
- `tests/fixtures/persistence/screen-recording-track-journal/v1.json`（新）

主进程：
- `electron/main/services/screen-recording/session-document.ts`（重写）、`session-document.test.ts`（重写）
- 新文件：`track-ledger.ts`、`audio-join.ts`、`audio-join.test.ts`、`wav-file.ts`
- `events.ts`、`control.ts`（失败分支释放资源）
- `runtime.ts`：宿主断开交给协调器、同文档导航不算断开、共用通知、事件页积压峰值。另一位同事加的防睡眠几行保留未动
- `capture/service.ts`（断开/接回/启动恢复/收尾汇总/失败标记）、`capture/service.test.ts`
- `capture/gfxcapture.ts`（串行化、自动续录、丢帧计数）、`capture/storage.ts`（补齐未封口分片，不再整份复制）、`capture/capture.test.ts`
- `electron/main/services/recording-notice.ts`（新，录音录屏共用通知）
- `electron/main/ipc/audio-capture.ts`：只把中断通知改用共用实现

渲染层：
- `src/features/screenRecording/tracks/session.ts`、`session.test.ts`、`tracks/output.ts`、`tracks/devices.ts`
- `capture/session.ts`、`capture/session.test.ts`
- `application/recordingService.ts`（接回、启动恢复提示、中断列表）
- `application/recordingVideoImport.ts`：只改导入前恢复那一处
- `RecordingRecoveryBanner.tsx`（新）
- `RecordingSetupPanel.tsx`：挂横幅；按新文案规则把 1080p 改成 1080P
- `ScreenRecordingApp.test.tsx`：补 mock
- `src/features/creativeIntent/recording/microphone.ts`：副本目录、给了目录时停止不删
- `src/App.tsx`：启动时接回与恢复的一个 effect
- `src/i18n/locales/zh-CN/ui.json`、`en-US/ui.json`：新增 `recording.interrupted*` 与 `notifications.recordingRecovered*`。**这两个文件里也有别人未提交的改动**，提交时需要按行区分

证据：`tickets/46-正式使用链路/证据/recording-write-stress.cjs`、`recording-write-stress.txt`

## 四、测试与压测结果

Vitest（只跑直接相关的文件；最后一轮全过）：
- 本次新增或改写的用例：
  - `trackJournal.test.ts`：界面重新接上前后的分段之间记为缺数据空档；漂移重叠以下一段起点为界。
  - `collector.test.ts`：写盘慢时页在内存排队不结束采集、积压按 8/16 报；写盘失败照常报错。
  - `resourceContracts.test.ts`：新格式加入通用解码与迁移链用例。
  - `audio-join.test.ts`：
    - 100 ppm 漂移下每段准时开始、点击跨轨对齐、接缝无跳变、暂停处分条；
    - 用原生副本补齐丢掉的 0.5 秒、空档去掉、逐采样一致；
    - 补尾巴，对不上的副本不补；
    - WAV 头按实际长度补齐。
  - `session-document.test.ts`：
    - **两小时量（3600 页事件 + 1440 段声音）录制中文档保存次数不变**，停止时只存一次且内容完整；
    - 录制中读事件走内存索引；
    - **应用崩溃后从页文件与轨道记录重建**：含没封口的声音段按文件补回、半行丢弃、收尾中途崩溃文档不提前变成已结束、重复恢复结果相同；
    - **旧录制（无 `tracks.journal`）照常恢复**。
  - `capture.test.ts`：**编码进程意外退出后续录**、丢帧计数、一分钟内反复退出才失败；续录期间停止不留后台编码。
  - `capture/service.test.ts`：**界面断开期间画面照常录、不向断开的界面发命令；接回后重新登记授权、交还接续信息；停止时只收尾一次、正常停止不发通知**。
  - `tracks/session.test.ts`：交给主进程的记录按顺序送达、重放得到相同轨道；写盘慢时多排队不停录，超过上限才失败。
  - `capture/session.test.ts`：**界面重载后接回录制中/暂停中的录制**，命令照常送达；轨道记录逐条交给主进程。
- 跑过但没改用例的：`events.test.ts`、`runtime.test.ts`、`control.test.ts`、`output.test.ts`、`ScreenRecordingApp.test.tsx`、`microphone.test.ts`、`ipc/audio-capture.test.ts`。

ESLint（改动文件逐个）、`check:main-imports`、`check:persistence-compat`、`check:surface`、`check:icons`、`check:colors`、`check:ui-residue` 均通过。

类型检查：两套 `tsc` 在两轮审查修复之后重跑，只剩 `src/core/audioEdit/subtitles.ts` 的 `findLastIndex` 两条（别人的文件，两套都报）；本次改动的文件零错误（协调方提到的 `capture/session.test.ts` 已清零）。

压测（`node tickets/46-正式使用链路/证据/recording-write-stress.cjs`，结果在同目录 `recording-write-stress.txt`）：

| 做法 | 录制分钟 | 文档或记录写入总量 | 单次最长 | 备注 |
|---|---|---|---|---|
| 旧（每次封页/封段整份写） | 10 | 78.7 MB | 19 ms | 521 次保存 |
| 旧 | 20 | 314.7 MB | 79 ms | 时长翻倍、写入量翻 4 倍；外推 120 分钟约 11 GB，单次超过 1 秒 |
| 新（追加一行，停止写一次） | 15 / 30 / 60 / 120 | 0.6 / 1.2 / 2.5 / 5.0 MB | 追加最长 31 ms | 线性；120 分钟停止时文档 2.4 MB，写一次 63 ms |

事件页用正式采集器灌入两小时 120 Hz 光标（86.4 万条 → 3376 页、216 MB），19 秒灌完（真实录制用时 7200 秒）。最快灌入时积压峰值 2862 页，只占内存、不停采集；真实速率下每 2 秒一页、单页写盘最长 174 ms，不会积压。

## 五、需要真实录制验证的步骤

准备：`npm run build:audio-capture`（录音侧协议已升到 2，必须配套）→ `npm run electron:bundle` → `npm run electron:prod -- --dev-skip-onboarding`。正式验收不用开发版。日志用 `npm run logs:query -- --event <事件名>`。

1. **两小时长录**：4K60、开麦克风和系统声，录痕迹AI以外的窗口，鼠标持续移动。
   - 第 0 分钟与结束前各拍一次手。
   - 每 30 分钟查一次：
     - 不应有 `recording.capture.failed`、`recording.events.backlog`；
     - `documents.save.completed` 在录制中应只在暂停或恢复时出现，`bytes` 不随时长增长。
   - 停止后：
     - `recording.capture.summary`：`eventPages` 约 3400、`droppedFrames`/`duplicatedFrames`、`maxPageWriteMs`、`maxTrackWriteMs`、`encoderRestarts=0`；
     - `recording.audio.join.completed`：`files` 应为每路 1 条，暂停才多；
     - 导入剪辑后麦克风、系统声各只有一个片段；对比开头与结尾两次拍手的音画偏差（检验漂移校正），偏差应在一帧以内；
     - 录制目录里不应残留 `microphone-native-*.wav`。
2. **界面重载**：录制第 5 分钟，在任务管理器里结束痕迹AI的渲染进程（或开发版整页刷新），等界面自动重载。
   - 控制条一直在、时长继续走；重载后录制页显示进行中的录制，可以暂停和停止。
   - 日志依次有 `recording.host.detached`、`recording.host.attached`、`recording.session.attach.completed`、`recording.tracks.reattach.completed`。
   - 停止后自动进剪辑，画面连续；麦克风与系统声在重载处有一小段空档（约 1–3 秒，看 `missing-data`），之前和之后都有声音。如果麦克风副本还在，重载前最后约 0.2 秒应被补上。
   - 再试一次：暂停中重载，然后恢复，再停止。
3. **应用崩溃**：录 3 分钟后在任务管理器里结束痕迹AI主进程，重启。
   - 启动后弹提示“上次录制意外中断，已恢复「名称」到 03:xx”，点“打开剪辑”能导入画面、声音与鼠标；录制页设置栏顶部出现这条录制。
   - 日志：`recording.session.recover.start/completed`、`recording.tracks.repair.completed`（补回没封口的声音段）。
   - 另试从素材库直接打开这条录制，同样能进剪辑。
4. **编码进程意外退出**：录制中在任务管理器结束 ffmpeg 子进程（`ffmpeg.exe`）。
   - 约 1 秒后收到系统通知“画面编码中断过一次，已自动接着录”；录制不停。
   - 日志：`recording.capture.restart.start` → `.completed`；summary 里 `encoderRestarts=1`。
   - 导入后画面在那一处有一两秒空白，其余连续。
   - 再试：关掉被录的窗口（单窗口录制），应在几次重试后停止并通知，已录部分可导入。
5. **推送跟不上**：录制中打开大剪辑工程、拖动时间线并开一次重型导出。
   - 若出现 `audio_capture.preview.dropping`，停止后看 `recording.audio.join.completed` 的 `filledGaps`，导入后麦克风轨不应有对应空档。
6. **意外停止通知**：录制中把录制所在盘写满（或拔掉外接盘）。
   - 应收到系统通知“录制意外停止，已保存 …”，导入已录部分正常。
   - 窗口在前台时不应弹系统通知。
7. **防睡眠**：任何录屏失败或停止后，`powercfg /requests` 不应再列出痕迹AI。

## 六、与录音侧的对接点

- 用到的录音侧接口：
  - 共享麦克风的 `start(outputPath)`：我把 `outputPath` 放进录制目录；
  - 推送采样的 `firstFrame` 等于原生副本里的帧号：补采样依赖这一点；
  - 主进程自动重连时，重连前的旧文件仍由录音服务在会话结束时清理；
  - 防睡眠锁：`runtime.ts` 里同事加的几行未动，`control.ts` 失败分支已补释放。
- **需要注意**：录屏补采样只在副本里的声音与分段核对一致时才补。如果录音服务以后改变副本的采样格式（例如位深与推送不一致），核对会失败，退化为不补（不会补错），但应同步告诉录屏侧。
- 可选未做：重连期间给界面的 `reconnecting/reconnected` 事件（录音侧第五节第 2 条）。
- 共用通知改动了 `electron/main/ipc/audio-capture.ts` 里通知相关的十几行，录音侧的行为（前台不发、保留引用、点击回到窗口）原样搬进 `recording-notice.ts`。

## 七、独立审查（两轮）

第一轮（全新上下文，只给改动、目标与规则）：1 条重要、8 条小问题，没有原有问题。

| # | 问题 | 处理 |
|---|---|---|
| 1（重要） | 停止或失败时中间的清单保存先把文档写成结束状态，收尾途中崩溃就不会再被恢复，声音丢失 | 已修：`capture()` 不写结束状态，终态只由 `finish()` 写；补了测试断言 |
| 2 | 续录时按进度时长封口，比文件里的真实画面长 | 已修：不封口，交给收尾探测 |
| 3 | 续录间隙的画面空白注释不实 | 已改注释，如实留空 |
| 4 | 停止/暂停/恢复钩子保存失败没标记为采集失败 | 已修：三个钩子包上失败标记。`events.ts` 停止路径里只有输入钩子释放失败的分支未处理（极少见） |
| 5 | 网页录制备份的声音会多留一份麦克风副本 | 已修：只有录屏宿主传副本目录 |
| 6 | 安静段补不上；最后一段补尾巴没有上限 | 已修：只拒绝全零静音、核对窗口 256 帧；尾巴以按下停止的时刻为上限 |
| 7 | 轨道记录中间一行坏了整次恢复失败 | 已修：只跳过坏行；更新版本的记录才整体拒绝 |
| 8 | 启动恢复可能误伤正在准备的录制 | 已修：跳过正在准备的会话 |
| 9 | 接回时目标剪辑没有重新占用 | 已修 |

第二轮只审增量：9 条都已修到位，没有新的重要问题；另有 4 条小问题，已全部修掉。

| # | 问题 | 处理 |
|---|---|---|
| 1 | 钩子失败只做了标记，后端没停，画面会一直录到用户关掉控制条 | 改为走 `fail(session)`：立即停下后端并按中断收尾 |
| 2 | 取消、失败、崩溃时没有 `endUs`，补尾巴又没有上限 | 改为以最后一帧画面的时刻兜底 |
| 3 | 接回时先等目标剪辑打开才开始监听，期间停下会漏掉“已停止” | 改为先订阅，再按最新状态判断是否已停止 |
| 4 | 记录格式正确但轨道不属于这次录制时整次恢复失败；收尾失败的提示说法不准确 | 这类行也跳过；提示改为“导入或重启应用时会自动补齐” |

## 八、没做到的与风险

1. **界面重载期间声音有空档**：约 1–3 秒，就是重载的时间。原因是声音轨（尤其系统声，只能在渲染进程里用 getDisplayMedia 回环采集）仍由界面写，麦克风订阅也随界面结束。要做到重载期间声音不断，需要把声音轨挪到独立的隐藏采集窗口或原生服务（排查报告 P1-4，大工作量）；这次没做，空档如实记为缺数据。
2. **兼容采集（chromium 后端，WGC 不可用时）界面一退出就停**：按采集失败收尾，已录部分保住，不能续录。
3. **摄像头仍是 5 秒分段导入**；摄像头没封口的分段用 ffprobe 补时长，帧数按设定帧率估算。
4. **声音分段文件在拼接后保留**：磁盘多占一份声音（两小时 16 位双声道系统声约 1.4 GB、麦克风约 1 GB），对比 4K60 画面约 36 GB。以后可以在拼接成功后删分段。
5. **漂移校正在每个拼接处轻微变速约 0.2 秒**：变速幅度是几十 ppm 量级、加上时钟校准抖动，正常不可闻；需要在真实长录里听一遍（第五节第 1 步）。
6. **跨重连的麦克风采样补不回来**：重连前的副本由录音服务清理，而且那段时间设备本来就不在。
7. **事件采集频率没动**：光标仍 120 Hz，两小时约 216 MB 页文件。写盘已不是瓶颈，没做静止时降频；它会改变事件密度，可能影响消费方。
8. **启动恢复只处理停在“准备/录制中/暂停”的录制**；更早版本留下的“已中断但画面时长为 0”的录制，在打开或导入时补齐，不主动提示。
9. 横幅与提示没有截图验收（不启动开发版的约束），需要在统一验收时目视（第五节第 3 步）。
10. `ui.json` 两个语言文件、`runtime.ts`、`electron/main/ipc/audio-capture.ts` 里都有别人的改动，提交时需要按行区分。
