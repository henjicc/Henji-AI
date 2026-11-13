# 结果：录屏麦克风挪进 Rust 录音进程；导航日志关联字段（2026-11-13）

验证级别 L2（原生协议、主进程服务、IPC、preload、助手能力描述）。未碰 git，未启动/重启/关闭应用，未跑 `electron:bundle` / `electron:build` / `build:audio-capture`，原生程序只在单独的 `--target-dir`（scratchpad）里 check/test，没有动 `native/audio-capture/target`。第一版经协调方安排的独立审查没过，按审查意见返工（见文末“审查返工”），返工部分需要再审一轮。

## 任务一：录屏麦克风

### 根因
录屏的麦克风轨由界面进程写：主进程的共享麦克风订阅把原生采样推给界面，界面按 5 秒编码 WAV 再经 IPC 写回磁盘；订阅归属界面窗口，界面一导航/崩溃，`releaseOwner` 就停掉它（`audio_capture.recording.summary` 紧跟 `recording.host.detached` 就是这个）。新界面接回后另开一路，中间约 2.5 秒没有数据，轨道在 `missing-data` 空档处拆成两条。原生另写的整段副本也随订阅一起停，补不回这段。

另外查到同一设计带来的第二个问题：麦克风原生进程一次只有一个会话，音频编辑录音与录屏麦克风互斥（主进程 `RECORDING_ACTIVE`，能力层也在写入前拒绝），边长录音边录屏时录屏只能不开麦克风。

### 改法（按系统声那套）
**原生（`native/audio-capture`，协议 3 → 4）**
- 麦克风改为“一路采集、多路输出”（新文件 `microphone.rs`）：一个 PortAudio 流（`Capture`）交给一路或几路输出——音频编辑/讲解的整段文件（可暂停、可推流，沿用原写盘与推流逻辑），以及录屏的分段轨道（新命令 `startMicrophoneTrack { sessionId, directory, settings }`）。复用原有 PortAudio 回调、合并块、丢帧补静音、溢出只计数；没有另写采集。
- 线程分工：回调 → 采集队列 → **分发线程**（不碰磁盘，按每路的录制区间转块）→ **每路自己的 4096 块写盘队列与写盘线程**。控制命令只改区间登记（分发持这把锁的时间是几次内存拷贝），从不等写盘；一路写盘慢只让它自己的队列变长，另一路照常落盘。
- 分段写盘器从 `system_audio.rs` 抽到 `segments.rs`（按声道/位深参数化），系统声与麦克风轨共用同一个 `Writer`：5 秒一段、每秒更新文件头、段一开一封各发不丢的事件（新增 `bitDepth`、`uncertaintyUs` 字段）。
- 每路输出按“整次采集的帧位置”记录录制区间（`Gate`，可多段）：暂停、继续、停止都在按下那一刻定边界，写盘排队中的块照样按边界写进去——磁盘卡几十秒也不会丢暂停前或结尾的声音（写测试时先撞到了“继续把暂停前排队的块冲掉”的缺陷，改成多段区间后修好，红→绿）。
- 停止：按下那一刻定终点后控制线程立即返回，由后台线程等这一路写完、封口、经推流线程 `Barrier` 确认段事件已发出，再发应答（最多等 80 秒，超过就应答 `pending: true`，写盘线程照常写完）；最后一路停止后关设备，同样不等写盘。写盘失败只结束那一路；设备没了整路结束，每路写完封口后各报一次 `interrupted`。
- 握手协议号 4；主进程、冒烟脚本、长录脚本说明一起改，旧程序握手即失败（有测试）。

**主进程**
- `native-track.ts`（新）：原 `SystemAudioRecorder` 泛化成 `NativeTrackRecorder`，系统声与麦克风轨共用：段事件换算成轨道记录、暂停=结束原生会话/恢复=再开、原生服务失联重连并按文件补没封口的段、结束汇总。麦克风轨额外两点：设备没了（`interrupted` 非 `DISK_FULL/FILE_ERROR`）→ 从最后录到的一帧起记 `device` 空档、提示“录制设备已中断”，按 0.5/1/2/3 秒重新枚举重连（找不到原设备按录音设置规则落到默认输入），录屏不中断；电平事件交给控制条。
- `system-audio.ts`：只剩服务与系统声的取数方式。
- `service.ts`（麦克风服务）：持有麦克风轨录制器，事件与失联按会话号分发；`startTrack()`；开轨道一律带上设备设置，原生接到已开的那一路时不用；麦克风开着时不重新枚举（会断设备）；两路设置不同时以原生应答里的实际设备与格式为准（见审查返工第 5 条）。删掉只给录屏用的 `sharedMicrophoneFacts`/`lastShared`。
- `screen-recording/capture/service.ts`：`systemAudioStep` 改为 `hostTrackStep`，麦克风（所有平台）与系统声（Windows）都由主进程跟着画面开始/暂停/恢复/停止/取消，同一个 `originUs`、同一时钟换算，记录直接进录制文档 `tracks.journal`；`CapturePrepared.hostTracks` 带 `microphone`，界面不再采集。长录事实 `facts.microphone` 来自麦克风轨录制器，新增 `device`（实际用的麦克风）。
- `control.ts`：主进程轨道提示按来源记（麦克风恢复不会撤掉系统声仍在报的同一条提示）；麦克风电平改由主进程给，界面的轨道状态不再带电平。
- `ipc/audio-capture.ts`：网页录制备份声音（界面自己的录制）新增 `microphoneTrackStart/Stop`，与 `systemAudioStart/Stop` 同一套归属与离开收尾。

**界面**
- `tracks/devices.ts`：麦克风一律走原生轨（`startMicrophoneTrack`），停止时取回记录；删掉界面采麦克风写分段的路径和 `microphoneCopyDirectory`。
- `capture/session.ts`：`hostTracks` 含麦克风时界面不建麦克风这一路；`tracks/session.ts` 去掉麦克风电平。
- `creativeIntent/recording/microphone.ts` 的 `captureMicrophone` 只剩讲解（剪辑/图片讲解要把采样拿到界面转写）在用，去掉了“写进录制目录”的选项。讲解仍与音频编辑录音互斥，未改。

**助手能力**：`start_screen_recording` 不再在音频编辑录音时去掉/拒绝麦克风，那时回执的 message 说明接到了音频编辑正用的设备；`start_audio_edit_recording` 只在讲解占用时拒绝，录屏麦克风在录时沿用它的设备；`microphoneInUse` 说明改为只指讲解。已在 `docs/rules/assistant-status.md` 第五节记推翻。`recordingState` 读回不变；录屏 `details.capture.microphone` 多了 `device`（协调方要求在回执里带实际设备），其余字段不变。

### macOS
麦克风在 macOS 本来就是原生 PortAudio（CoreAudio），这次同样改为主进程驱动的原生分段轨道，界面重载不断；开始时经 `mediaPermissions.requestAccess(['microphone'])` 走系统授权。系统声在 macOS 不变，仍由界面经屏幕共享采集。**未在 mac 上验证。**

### 两路麦克风并行的结论
原来不支持（单会话，互斥并拒绝）。现在实现了“共享一路采集、分发给多个写入者”：音频编辑整段文件与录屏分段轨道可同时录，同一设备、同一采样率与声道，各自暂停/停止互不影响；任一路写盘失败只结束那一路。限制：
- 两路共用设备：后开的一方沿用先开的设备、采样率与声道（音频编辑的回执设置与提示写实际设备；反方向记 `audio_capture.microphone_track.joined` 日志，录屏回执 message 说明，`details.capture.microphone.device` 读得到）；位深各自按设置。
- 设备被拔出时整路采集结束：音频编辑按原有方式报中断（文件保留可恢复），录屏麦克风轨留空档自动重连；重连后若音频编辑没重新开始，就只有录屏那一路。**与改前不同的一点**：音频编辑暂停中、而录屏轨还开着设备时拔出设备，暂停中的音频编辑会立即收到中断（改前暂停即关流，暂停期间察觉不到，等继续时才报）。要保持改前行为得让暂停的整段文件脱离设备单独挂着、继续时再接到新开的采集上，牵涉较大，这次没做。
- 讲解与音频编辑录音仍互斥（讲解不走分段轨道，未在本次范围）。

### 落盘格式
**没有变化**，不升版本。麦克风段文件仍是 `<uuid>.wav`（原生 92 字节头，与系统声、原生副本相同，现有读入口都认），轨道记录、`tracks.journal`、`tracks.json`、录制文档 schema 未动；`CapturePrepared.hostTracks`、`RecordingTrackStatus` 只在进程间传。`check:persistence-compat` 通过（67 种格式）。旧录制照常可读：`audio-join.ts` 用原生整段副本补空档的读取路径保留（只在目录里有旧副本时起作用），恢复旧的中断录制时仍能补。

### 日志
- `main.audio_capture.microphone_track`：`audio_capture.microphone_track.start / start.completed / start.failed / device.lost / device.changed / reconnect.start / reconnect.completed / reconnect.failed / repair.* / glitch / disk.slow / stop.failed / failed / summary`。
- **结束汇总** `audio_capture.microphone_track.summary`：结果、时长、`segments`（段数）、`gaps`（空档数，含暂停与设备空档）、`reconnects`、设备、经过秒数、健康计数。系统声汇总同样多了 `gaps`。录屏 `recording.capture.summary` 的 `tracks.microphone.segments/gaps` 照常。
- 接到已开的一路时：音频编辑记 `audio_capture.recording.joined`，麦克风轨记 `audio_capture.microphone_track.joined`（实际设备、采样率、声道与请求的对照）。
- 停止时磁盘卡超过 80 秒：`audio_capture.recording.stop.pending` / `audio_capture.microphone_track.stop.pending`。
- 原生程序版本不配套：`audio_capture.process.version_mismatch`（期望与实际协议号）；麦克风轨或系统声因此不再重连时记 `<前缀>.failed`。

## 任务二：导航日志无法序列化
根因：能力处理器把整个能力上下文（含 `AbortSignal`、函数）当关联信息传下去，类型上允许（结构化多余属性），而导航服务把它整体展开进日志上下文，日志桥结构化克隆失败，`navigation.surface.open.start/completed` 整条被拒。
- 写日志处收窄：`surfaceNavigationService.ts` 新增 `navigationCorrelation()`，打开/关闭页面都只取 `requestId`、`taskId`。
- 调用方只传这两个字段：报告点名的三处（`navigation/application/applicationDomain.ts` 打开页面、`toolbox` 的 `select_toolbox_tool`、`canvas` 的 `focus_canvas_node`），以及同类写法：`focus_application_entity`（导航域）、`open_canvas_node_editor` 与 `retry_layer_stack_result`（画布，下游把 correlation 展开进 `canvas.node_editor.*`、图层结果日志）、`open_image_editor_with_source`（图片编辑）。
- 补一个用例：整个上下文进去只剩两个字段且可结构化克隆。

## 改动文件（便于精确暂存）
原生：
- `native/audio-capture/src/main.rs`
- `native/audio-capture/src/microphone.rs`（新）
- `native/audio-capture/src/segments.rs`（新）
- `native/audio-capture/src/system_audio.rs`
- `native/audio-capture/src/wasapi.rs`

主进程 / preload：
- `electron/main/services/audio-capture/native-track.ts`（新）
- `electron/main/services/audio-capture/system-audio.ts`、`system-audio.test.ts`
- `electron/main/services/audio-capture/service.ts`、`service.test.ts`
- `electron/main/services/audio-capture/client.ts`、`client.test.ts`
- `electron/main/ipc/audio-capture.ts`
- `electron/main/ipc/screen-recording.test.ts`
- `electron/main/services/screen-recording/capture/service.ts`、`capture/service.test.ts`
- `electron/main/services/screen-recording/control.ts`、`control.test.ts`、`runtime.test.ts`
- `electron/main/services/screen-recording/audio-join.ts`（只改注释）
- `electron/preload/audio-capture-api.ts`

共用与界面：
- `src/core/audioCapture/contracts.ts`
- `src/core/screenRecording/capture.ts`、`src/core/screenRecording/contracts.ts`
- `src/platform/contracts/audioCapture.ts`、`src/platform/adapters/electron/audioCapture.ts`
- `src/features/screenRecording/tracks/devices.ts`、`tracks/session.ts`、`capture/session.ts`
- `src/features/creativeIntent/recording/microphone.ts`
- `src/features/audioCapture/captureTestFixture.ts`、`audioEditRecording.ts`、`audioEditRecording.test.ts`
- `src/features/screenRecording/application/applicationDomain.ts`、`applicationDomain.test.ts`、`recordingReflection.ts`
- `src/core/application-control/domains/screenRecording/recordingCapabilities.ts`
- `src/core/application-control/domains/audioEdit/audioEditRecordingCapabilities.ts`
- `src/features/application-control/audioCaptureFields.ts`

任务二：
- `src/features/navigation/application/surfaceNavigationService.ts`、`applicationDomain.ts`、`surfaceCapabilityService.test.ts`
- `src/features/toolbox/application/registerToolboxCapabilityHandlers.ts`
- `src/features/canvas/application/registerCanvasCapabilityHandlers.ts`
- `src/features/imageEdit/application/applicationDomain.ts`
- `src/features/canvas/application/registerCanvasCapabilityHandlers.test.ts`、`src/features/application-control/capabilities/domainCapabilityHandlers.test.ts`

脚本与文档：
- `scripts/audio-capture-smoke.cjs`（协议断言 4）
- `scripts/recording-soak.cjs`（说明里的协议号）、`scripts/lib/recordingSoak.cjs`、`scripts/lib/recordingSoak.test.cjs`（麦克风与系统声一样必须一条、不许有缺数据空档）
- `docs/rules/assistant-status.md`（第五节推翻记录）
- `tickets/46-正式使用链路/result-录屏麦克风.md`（本文件）

工作区里不属于本次的改动：`electron/main/services/audio-edit/task-store.ts`、`src/features/audioEdit/application/audioEditApplicationService.ts`、`src/core/theme/__snapshots__/themeEngine.test.ts.snap`。

## 验证（返工后重跑）
- Rust（`CC= CXX= cargo test --offline --locked -j 8 --target-dir <scratchpad>`，经 heavy.sh）：第二轮修改后 19/19 通过（第一轮返工时 17/17），连跑三次都过，无警告，`cargo fmt` 已跑。麦克风部分的用例：
  - 一路采集同时喂音频编辑文件与录屏轨道（音频编辑暂停一段、录屏先停），两边帧数精确；
  - **写入端卡住时**：暂停、继续、新开一路都在 0.5 秒内完成，另一路和新开的那路照常落盘，卡住那路恢复后补齐全部数据；
  - 一路自己的写盘队列满：丢的帧计数并补等长静音，文件时长不变；
  - 停止前最后几块丢了、设备不再出数据而流没停：0.3 秒后补齐尾巴收尾，不干等；
  - 丢帧跨过暂停边界：只补落在录制区间里的那部分；
  - 溢出只计这一路期间的（开始前的那次不算），缺口位置按这一路文件里的帧；
  - 结尾丢帧补静音、预览堵塞不挡写盘、分段格式与段号（`segments.rs`、`system_audio.rs`、`wav.rs`）。
- 主进程类型检查 `npx tsc -p tsconfig.electron.json --noEmit`：0 错误。
- 渲染层类型检查（heavy.sh，`--max-old-space-size=12288`）：0 错误。
- ESLint（首轮 39 个文件；返工改到的 14 个文件重跑，`--max-warnings 0`）：通过。`check:main-imports`、`check:persistence-compat` 首轮通过（返工没有改持久格式与主进程导入）。
- Vitest（只跑相关文件，全部通过）：
  - `audio-capture/service.test.ts` 12 例。新增：音频编辑在录时开轨道（照样带设备设置）、停止互不打断；录屏轨先开、音频编辑后开且设置不同时，回执设置与提示写实际设备；设备拔出记 `device` 空档、重新枚举后接着录、写盘失败才结束。
  - `client.test.ts`（版本不配套报可操作的错）、`system-audio.test.ts`、`capture/service.test.ts`、`screenRecording/applicationDomain.test.ts`（音频编辑在录时录屏照常开麦克风，回执说明共用设备）。
  - 任务二：`registerCanvasCapabilityHandlers.test.ts`、`domainCapabilityHandlers.test.ts`（都改为断言只带 requestId / taskId）、`mediaCapabilityServices.test.ts`、`canvasNodeEditorApplicationService.test.ts`、`layerStackResultRecoveryService.test.ts`、`surfaceCapabilityService.test.ts`、`registerToolboxCapabilityHandlers.test.ts`。
  - 其余：`control.test.ts`、`runtime.test.ts`、`ipc/screen-recording.test.ts`、`ipc/audio-capture.test.ts`、`preload/audio-capture-api.test.ts`、`audio-join.test.ts`、`tracks/session.test.ts`、`tracks/devices.test.ts`、`capture/session.test.ts`、`microphone.test.ts`、`audioEditRecording.test.ts`、`videoEditExplanation.test.ts`、`audioCaptureDomain.test.ts`。
- 全仓 grep 断言旧写法（`correlation: context`、各导航入口 `toHaveBeenCalledWith(..., context)`）：只剩上面改过的两个文件，已改。
- `node --test scripts/lib/recordingSoak.test.cjs`：9/9 通过（首轮）。
- `check:assistant-capabilities:structure` 报 `src/workspaces/GenerationWorkspace/hooks/resultSelection.ts` 未建账，与本次无关（别人的新文件）。

## 待真实验证（这次做不了：应用被占用、不能重建）
准备：`npm run electron:bundle` 已含“构建原生录音引擎”一步（`scripts/lib/electronBundlePlan.cjs` 调 `build-audio-capture.cjs`，cargo 增量编译），bundle 一次即可，不必另跑 `build:audio-capture`；然后 `$env:HENJI_ELECTRON_REMOTE_DEBUGGING_PORT=9334; npm run electron:prod -- --dev-skip-onboarding --skip-build`。bundle 会改写正在运行的录音程序，必须先停应用。

1. **界面重载不断**：`npm run test:recording-soak -- --scenario screen --smoke`（3 分钟，带麦克风与系统声，中途有一次界面重载）。看 `result.json`：`checks.audioFiles.microphone` 应为 **1**（原来是 2），`checks.gaps` 里没有 `kind: microphone, reason: missing-data`；`summary.md` 结论不应再出现“麦克风缺数据空档”。日志：`npm run logs:query -- --event audio_capture.microphone_track.summary`，`segments` ≈ 时长/5、`gaps` 为 0、`reconnects` 0；重载前后不应有 `audio_capture.recording.summary`（共享订阅随界面结束）那一条。再跑一次 `--crash-renderer` 档确认渲染进程崩溃也不断。
2. **长录**：`npm run test:recording-soak -- --scenario screen`（30 分钟）同样看上面三项，并对比 `microphone_track.summary.maxWriteMs` 与系统声写盘峰值。
3. **边长录音边录屏**：音频编辑开始录音（或 `--scenario audio` 跑着），再开录屏（带麦克风），录屏中途暂停/恢复、先停录屏再停录音，以及反过来。看：录屏回执正常、音频编辑回执出现“沿用它正在用的设备「…」”提示、回执设置是实际设备（若先开的是录屏）；先开录音再开录屏时录屏回执 message 说明共用、`details.capture.microphone.device` 是录音用的设备；两边日志都没有 `interrupted`；录音拼回时长 ≈ 墙钟；录屏麦克风一条、与录音文件同一段话的波形对得上。
4. **设备拔插**：录屏中拔掉 USB 麦克风再插回。看 `audio_capture.microphone_track.device.lost` → `reconnect.completed`（若系统还有别的输入，会落到默认输入，`device` 字段是新设备名），控制条“录制设备已中断”出现后消失，导入后麦克风在那一处有 `device` 空档、前后都有声音，录屏没有中断；汇总 `gaps` ≥ 1。
5. **原生进程崩溃**：录屏中结束麦克风那个 `henji-audio-capture.exe`（只开麦克风、不开系统声更好区分），看 `reconnect.start/completed`、`repair.completed`，空档为 `missing-data` 约 1 秒。
6. **网页录制备份声音**：开备份录屏带麦克风录 1 分钟，保存后备份视频有麦克风声音。
7. **控制条电平**：录屏时麦克风电平条有跳动，暂停时归零。
8. macOS 真机：录屏麦克风能开（授权弹窗）、重载不断。
9. **写盘卡顿**（核心保证）：音频编辑录音与录屏同时在录时，让录音所在盘忙起来（例如同盘大文件拷贝），期间暂停/继续录屏、开关一次网页录制备份声音。看：两边都不中断，不出现 `audio_capture.process.failed`（NOT_RESPONDING），`disk.slow` 只记峰值，结束后两边文件时长都约等于墙钟。

## 遗留与风险
1. **返工部分需要再审一轮**：重点是 `native/audio-capture/src/microphone.rs` 的分发/写盘拆分、后台应答与关设备的收尾顺序，以及 `service.ts` 的实际设置回执。
2. 原生程序与主进程必须同版本（协议 4），不配套握手即失败、录不了，不会录到一半断。
3. 音频编辑与录屏共用设备：后开的一方不能换设备/采样率；设备拔出时音频编辑照旧中断（可恢复），不会跟着重连。
4. 只停一路时，PortAudio 回调里尚未凑满一块的采样（≤1024 帧，约 21 ms）算到下一块，落在终点之后不写进这一路；整路关设备时照旧全部写进。
7. 停止时磁盘卡超过 80 秒：原生先应答 `pending: true`，写盘线程照常写完。音频编辑那一路按可恢复的中断处理（`STOP_PENDING`，文件留在待恢复列表、有提示），写完之前原生拒绝恢复，写完后从恢复入口拼回完整录音。录屏那一路记为失败结束，没封口的段留给录制收尾按文件补，补的时候磁盘若还没写完，那一段只到当时写到的位置。
8. 每路一个 4096 块的写盘队列（约 34 MB），两路同时录约 70 MB；采集队列缩到 512 块（分发不碰磁盘）。
9. 原生“停止”的应答现在可能晚于后来的命令的应答（按请求号对应，客户端本来就按号匹配）。
5. 讲解（剪辑/图片讲解）仍由界面经推送写，界面重载会断、与音频编辑互斥，未在本次范围。
6. `recordingSoak` 的判定已改为麦克风必须一条：在新原生程序上线前跑旧构建会判失败，属预期。

## 审查返工（2026-11-13，逐条）
1. **任务二改红的测试**：`registerCanvasCapabilityHandlers.test.ts` 的 `focus_canvas_node` 断言 `('workspace.canvas', {})`，`open_canvas_node_editor` 用带 requestId/taskId 的上下文，断言 `correlation` 只剩这两个字段；`domainCapabilityHandlers.test.ts:139` 同样改为带 requestId 的上下文、断言只传 `{ requestId }`。全仓 grep 没有别的测试断言旧写法；相关 7 个文件 66 例全绿。
2. **写盘线程拿着锁写磁盘**：整段改写到 `microphone.rs`。
   - 线程分工：回调 → 采集队列 → 分发线程（不碰磁盘，只在一把短锁里转块、改区间）→ 每路自己的写盘队列与写盘线程（只它自己持有写入端，没有锁）。
   - 控制命令（开始一路、暂停、继续、停止、拿掉）只拿登记锁，分发持这把锁时只做内存拷贝，磁盘卡多久都不影响控制应答。
   - 停止不在控制线程上等：后台线程等这一路写完、封口、`Barrier` 确认段事件已发出再应答，最多 80 秒（主进程等 90 秒），超时应答 `pending: true` 并记日志；关设备也不等写盘。
   - 新建整段文件放进写盘线程，最多等 10 秒，磁盘没响应就如实报错，不拖到主进程超时。
   - 一路写盘慢只让它自己的队列变长，队列满按这一路计丢帧并补静音，另一路照常落盘。
   - 补了“写入端卡住时暂停、继续、新开一路 0.5 秒内完成，另一路继续落盘”的用例。
3. **健康计数按路归属**：每路开始时记下采集层累计计数作基线，只报这一路期间的增量；这一路自己的丢帧、预览丢块、写盘峰值、缺口位置记在这一路的计数里。原生每个会话都从零计，`native-track.ts` 跨暂停/继续累加的是各段自己的量，不再重复相加同一路采集的累计值；新会话从零开始，不会打出假的缺口日志。
4. **开轨道一律带设备设置**：主进程每次 `startMicrophoneTrack` 都带按录音设置找到的设备，原生接到已开的采集时不用；“主进程以为开着、原生刚关掉”时原生按它重新开设备。
5. **两路设置不同**：原生应答带实际的 `device`/`channels`/`bitDepth`/`joined`。
   - 音频编辑后开：回执的 `settings` 改为实际设备、采样率与声道，提示写明“沿用它正在用的设备「X」（48 kHz、双声道），录音设置里的设备与格式这次不生效”，另记 `audio_capture.recording.joined`。
   - 录屏后开：记 `audio_capture.microphone_track.joined`（实际与请求的对照）；`start_screen_recording` 在音频编辑录音时回执 message 说明接到了它正用的设备，`details.capture.microphone.device` 读得到实际设备。
6. **队列溢出边界**：
   - 丢掉的帧按覆盖的帧位置与每路的录制区间求交，只补落在区间里的部分（有用例）。
   - 流停止时补静音的收尾块带“丢掉那段的终点”时钟（按采样率推算的下一帧时刻），不再用 0 开段。
   - 停止中的一路：采集队列空了 0.3 秒还没越过终点（设备不再出数据而流没停），就把采到却丢掉的尾巴补成静音后收尾（有用例），不会干等到 90 秒。
7. `start_audio_edit_recording` 说明补了“录屏麦克风正在录时这次沿用它已开的设备、采样率与声道（回执 notice 写明实际设备）”。
8. **版本不配套**：握手发现协议号不对时报 `VERSION_MISMATCH`“录音组件版本与应用不一致，请重新安装痕迹AI；开发环境请先运行 npm run build:audio-capture 重新构建录音组件”，不再露出 zod 原始报错，另记 `audio_capture.process.version_mismatch`。`electron:bundle` 已有“构建原生录音引擎”一步（cargo 增量），不需要再加；之前报告里“bundle 之前先单独 build:audio-capture”的说法已改掉。
- **审查第 8 条（重连期间电平停在最后值）**：失联或设备中断进入重连时电平置 0。
- **审查第 7 条（暂停中的音频编辑在拔设备时立即中断）**：没保持改前行为，原因见“两路麦克风并行的结论”。

## 第二轮审查修改（2026-11-13）
重跑：Rust 19/19；主进程 tsc 0 错误；改到的 5 个 TS 文件 ESLint 通过；Vitest `audio-capture/service.test.ts`（13 例）、`client.test.ts`、`system-audio.test.ts`、`capture/service.test.ts`、`audioEditRecording.test.ts`、`captureSession.test.ts` 全过。这轮没改渲染层与持久格式，渲染层 tsc 与持久格式门禁沿用上一轮结果。

- **重要：停止应答 `pending: true` 被当成正常完成**
  - (a) `service.ts`：音频编辑那一路收到 `pending` 改走 `endInterrupted`，码 `STOP_PENDING`、可恢复，提示“磁盘写入太慢，录音结尾还在写入；录音已保留，稍后从恢复入口拼回完整录音”。主进程记下中断（`recordingState.interruption`）、通知界面（界面进入中断态，文件留在待恢复列表）、发系统提醒，停止请求以这条错误失败，不再 `finish('completed')`，界面不会去拼不完整的文件。麦克风轨那一路的 `pending` 记为失败结束。
  - (b) 原生：整段文件在写盘线程封口之前一直登记为“正在写”（建文件时登记、写入端放下时撤销，停止已应答也算），期间 `recover` 一律拒绝（“录音文件还在写入，请稍后再恢复”），写完后才放行。
  - (c) 原生：活着的写盘线程计数；进程退出前除了等后台应答线程，也等写盘线程都结束（同一个 100 秒上限）。
  - 测试：主进程“停止应答 pending 时按可恢复中断处理”；原生“写盘线程封口前文件算正在写、之后不算”。
- **小 1 建文件超时留下空 WAV**：开始命令放弃等待后，写盘线程醒来发现没人等它，就删掉自己建出的文件再退出（有用例）。没另设放弃标记，因为“等待方已放下接收端”本身就是这个信号。
- **小 2 版本不配套不算崩溃**：启动没成时先放开子进程再结束它，不记崩溃次数、不走失联回调，所以不会触发麦克风轨或系统声的自动重连，也不会累积成“录音服务连续异常”。重连或恢复中遇到 `VERSION_MISMATCH` 的那一路直接按失败结束并交出这条提示，不再反复重试。测试：连续四次都是这条可操作的提示，失联回调一次也没被调用。
- **小 3 暂停期间的采集层计数**：每路暂停时记下采集层累计值，继续时把暂停期间涨的（溢出、欠载、采集队列丢帧）并进这一路的基线，只算它录着的期间。
