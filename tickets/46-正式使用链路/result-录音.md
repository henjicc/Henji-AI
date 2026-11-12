# 结果：长时间后台录音不断、不丢（2026-11-13）

对应排查报告 `排查-录制.md` 的 P0-2、P0-4（音频编辑部分）、P0-5、P0-6、P1-5（录音部分）、P1-6。验证级别 L2（原生协议、主进程服务、IPC 契约、preload）。未提交，未改持久格式。已经过两轮独立审查，审查意见的处理见第六节。

## 一、逐条根因与改法

### 1. 预览或主进程卡顿不再停录音；溢出只计数；录屏麦克风自动重连

**根因**：落盘和推流共用一条路径。原生写盘线程每写一块就同步往 stdout 推采样和电平（`main.rs` 原 284–305 行），主进程一时不读管道，写盘线程就卡在 `emit` 上，128 块的采集队列（约 1.3–2.7 秒）随之溢出，判 `BUFFER_OVERRUN` 结束录音；驱动报一次 `paInputOverflow/Underflow` 也直接判 `INPUT_OVERRUN` 结束。主进程这边，界面确认跟不上 128 块就主动 `stop`（`CONSUMER_TOO_SLOW`）。而音频编辑只用这些采样画波形。

**改法（原生 `native/audio-capture/src/main.rs`、`portaudio_bridge.c`，协议升到 2）**：
- 落盘与推流彻底分开：写盘线程只写文件，把采样、电平交给独立的推流线程（有界通道 4096 条，采样与电平合计 48 kHz 下约 30–50 秒、最多约 35 MB）；通道满了用 `try_send` 直接丢推送并计数（`droppedPreviewBlocks`），写盘线程永不等管道。控制线程上报健康计数也走这条通道（`try_send`，满了这一秒先不报，计数是累计值），主进程不读管道时控制线程也不会被卡住。
- 采集队列放大到 4096 块（约 34 MB）。音频回调先把小块合并成 512–1024 帧一块再入队（低延迟 ASIO 的 64 帧回调也合成约 21 ms 一块），48 kHz 约 44–87 秒、192 kHz 约 11–22 秒缓冲；顺带把推给主进程的消息数降了一个数量级。
- 队列仍满时（磁盘卡十几秒），丢的帧数计入 `droppedFrames`，写盘恢复后**补等长静音**：文件时长仍等于实际录制时长，后面的声音不整体提前。停止或暂停时最后几块入队失败的，也由控制线程用一个只带丢帧数的空块交给写盘补上（空块不推送，避免出现 0 帧采样）。
- 驱动溢出/欠载：只计数（`inputOverflows`/`inputUnderflows`）并记位置（`lastGlitchSeconds`），继续录。带标记的回调单独成块以便定位；桥接层只在一次回调的第一段交出标记，避免拆段重复计数。
- 只有设备真的没了（5 秒无回调或流不再活动）、写盘失败（`FILE_ERROR`/`DISK_FULL`）才结束，与原来一致。
- `status`、`interrupted`、`health` 事件都带完整计数和写盘耗时峰值 `maxWriteMs`。
- 宿主读端关闭时不再 `exit(1)`（原来可能在写盘中途被杀），改为丢弃输出、由主循环正常收尾 WAV 后退出。
- 握手协议号 1 → 2：新旧程序不配套时在握手就失败，不会在录音中途才报协议错误。

**改法（主进程 `electron/main/services/audio-capture/service.ts`、`client.ts`）**：
- 每个订阅方未确认的块达到阈值就暂停给它推送，降到四分之一以下恢复；暂停期间每 50 块仍发一块“探测”，订阅方缓过来确认了它就接着收。**从不因推送停录音**，`CONSUMER_TOO_SLOW` 已删除。阈值按用途分：音频编辑只用推送画波形，1024 块（48 kHz 约 11–22 秒）；录屏、讲解的麦克风轨就是用推送写的，4096 块（约 44–87 秒）。
- **应答超时：状态当场收拢，已采集的音频不丢**（`client.ts` 的 `lost`/`retire`）：
  - 超时判定先用 `setImmediate` 让本轮已到达管道的应答处理完；计时器比预定晚到 1 秒以上（说明主进程刚卡过，原生的应答可能还没进管道）时再宽限 5 秒，最多 3 次，才算超时。停止要先排空采集队列（48 kHz 下最多约 87 秒音频）和推流通道，超时 90 秒；其余 20 秒。
  - 确实超时后，**不等进程退出**，同步执行一次失联收拢：拒绝待定请求、走崩溃回调（中断码 `NOT_RESPONDING`）——主进程清掉会话、放开睡眠阻止、通知界面。线程卡在驱动调用里、进程迟迟不退也不会卡死。
  - 然后不强杀，而是关掉原生的输入：原生读到输入结束会走 `drop(session)` → `close`，把采集队列写完、收尾 WAV 后自己退出；录音中宽限 120 秒（空闲 3 秒）仍不退才强杀。失联进程的管道照常读空但不再处理，免得它写满卡住出不来。
  - 恢复（`recover`）与回收（`trashFile`）同一个文件前先等失联进程都退出（`settled()`），不会和还在写的进程抢文件；应用退出时再等 10 秒，仍不退就强杀，不留占着设备的孤儿进程。
  - 独占录音的停止报错（原生收到停止就会结束会话）也按中断收尾并告诉界面，界面进入“录音已中断”可以恢复，不会停在“录音中”。
- **共享麦克风的停止一定生效**：录屏、讲解停止麦克风时，无论原生应答成败（包括超时）都移除这路订阅，删空就收尾；否则停止超时后的崩溃回调会把仍在的订阅带进无限重连，麦克风一直采集、防睡眠锁不放、临时目录不断写新文件（渲染层的停止只调用一次）。
- **录屏/讲解的共享麦克风自动重连**：原生会话因任何原因中断（设备拔出、驱动停回调、原生进程崩溃或不应答、临时目录写失败）时，不再通知订阅方中断，而是保留订阅，按 0.5/1/2/3 秒（之后每 3 秒）重新枚举并重开采集，直到订阅全部结束。每次尝试换新文件名（原名-2.wav…），之前的临时文件结束时由主进程清理；推给订阅方的序号跨重连继续递增，渲染层确认计数不用重置。找不到原设备时按“开始录音”同一规则回退到默认输入，并写进日志。
  - 这部分全在主进程完成，**录屏侧文件没改**；录屏轨道会看到帧号/采样率跳变，按现有逻辑封口当前分段并记一段 `missing-data` 空档。

### 2. 切换工作区不再停止音频编辑录音；全局录音指示

**根因**：`captureApplicationService.ts` 注册了导航守卫，切到别的工作区就 `leave()` → `stopCapture`；测试把它定为期望行为。

**改法**：
- 删掉导航守卫：切换工作区、离开音频编辑页面、最小化都不影响录音（原生进程在录，界面只是观察者）。关闭窗口仍然停止并拼回原位置（关闭守卫改为“正在录或页面开着”时执行）；编辑器里的“返回列表”仍会停止并拼回——那是离开这份作品，作品要关闭（有意保留的取舍）。
- 录音期间作品实例一直被录音锁占着（`lockAudioEditRecording`，原有机制），按“有进行中的任务”处理：后台释放、删除都会被拒（`releaseAudioEditProject` 遇 `busy` 返回 false）；在音频编辑里切换到别的作品也被拒。
- 标题栏右侧新增录音指示 `AudioCaptureIndicator`（放在助手编辑提示旁，同一位置的写法）：正在录时显示红点 + 时长（每 250 ms 刷新读数，不触发重渲染）+ 停止按钮；点时长回到音频编辑里那份作品；中断时变成“录音已中断”，点它回去恢复。在音频编辑页面上不显示（那一页有完整录音控件）。
- 指示留在首屏，不静态依赖音频编辑代码：会话建立时通过 `captureIndicatorBinding.ts` 登记自己，指示直接读会话的 store、调会话的停止，不另存一份状态。

### 3. 界面重载或崩溃时录音不停，新界面接管

**根因**：`electron/main/ipc/audio-capture.ts` 在 `did-start-navigation`、`render-process-gone` 时调用 `releaseOwner` 停止录音。

**改法**：
- 重载、崩溃时只结束麦克风订阅（录屏、讲解的分段由界面写，界面一走就失去归属），音频编辑录音继续（日志 `audio_capture.owner.detached`）；窗口真正销毁才停止。同文档内的地址变化（`isInPlace`，例如安全恢复启动时 `rendererRecovery.ts` 用 `replaceState` 去掉地址参数、开发画廊改地址）不算离开，与录屏 `runtime.ts`、`application-control.ts` 的判断一致。
- 新增 IPC 动作 `active`（主进程 `activeRecording(owner)`）：返回本窗口仍在进行的音频编辑录音状态（含时长与录音参数），同时把旧界面的推送确认作废、从头计。查询应答之后再核对一次会话仍在：同一段管道数据里应答后紧跟着中断时，中断已先处理、界面还没开始收事件，这时返回 null，不把已结束的录音交给界面（标题栏会照常显示恢复入口）。
- 新界面启动时标题栏指示先轻量问一次 `active()`；确实在录才加载录音会话并 `attach()`。之后每 5 秒再问一次（会话自己在录、正在开始/停止、或有待恢复的文件时跳过），接管失败或会话不知道这段录音时会重试，录音在后台继续时标题栏总能看到并停止它。
- `attach()` 走会话的操作串行（与开始、停止互斥），失败不缓存；先登记会话、开始收事件，再去取作品位置与设置，等待期间录音若中断，中断事件不会漏掉，也不会再给作品上锁。取到位置后在音频编辑里载入并显示那份作品（不切页面）、重新上录音锁、接上电平与时长；停止后照常 `finishTake` 拼回原位置。重载前那段的实时波形不会重画（停止拼回后显示真实波形）。

### 4. 录音、录屏期间阻止系统睡眠

- 新增 `electron/main/services/recording-power.ts`：`holdRecordingWakeLock(reason)` 引用计数地持有一个 `powerSaveBlocker('prevent-app-suspension')`，最后一路结束才放开，释放函数可重复调用。不拦息屏。
- 音频编辑录音与共享麦克风：原生开始成功后持有，`finish`（停止、中断、超时被结束、最后一个订阅结束）时释放；重连期间不释放。
- 录屏：`screen-recording/runtime.ts` 只加了 4 行——`openRecordingControl` 创建会话后持有，`released` 回调（停止、`fail`、`dispose` 都会走到）里释放。命令失败的分支不经过 `released`，见第五节对接点。

### 5. 录音中断让用户知道

现有项目里没有系统通知能力或通知设置项，只有界面内 toast（`notifyUser`）。做法：
- 主进程收到独占录音（音频编辑）中断时，用 Electron `Notification` 发系统通知（标题“痕迹AI 录音已中断”，正文是中断原因，点击把窗口拉回前台），并 `flashFrame`。窗口就在前台（获得焦点、可见、没最小化）时不发——标题栏和录音面板已经显示中断。显示中的通知对象在用户点过或关掉前一直留着引用，不会在点击前被回收。不新建 IPC 通道或设置项。
- 为了让安装版 Windows 能显示系统通知，`electron/main/index.ts` 在打包版 Windows 上加了 `app.setAppUserModelId('com.henji.ai')`（与 `electron-builder.yml` 的 appId、安装器快捷方式一致）。
- 标题栏指示变为“录音已中断”。从标题栏点停止却拼接失败时，用现有 `notifyUser` 弹错误提示。

### 6. 可观察性（都走 `createMainLogger('main.audio_capture')`）

| 事件 | 时机与内容 |
|---|---|
| `audio_capture.recording.start` | 开始；模式（独占/共享）、设备类型、采样率、声道、位深 |
| `audio_capture.recording.completed` | 正常停止 |
| `audio_capture.recording.failed`（warn） | 中断；中断码 + 全部计数 |
| `audio_capture.recording.summary` | **每次结束一条汇总**：结果、时长、写入字节、实际经过秒数、重连次数、主进程丢弃的推送块、原生健康计数（溢出、欠载、丢帧、丢推送、写盘峰值、最后一次缺口位置） |
| `audio_capture.recording.glitch`（warn） | 溢出/欠载/丢帧有新增，带新增量与位置 |
| `audio_capture.preview.dropping` / `.resumed` / `.dropped` | 推送跟不上开始丢、恢复（带丢弃块数）、原生侧有推送丢弃；带 `mode`，共享模式记 warn 并说明麦克风轨会有空档，独占模式记 info（只影响波形） |
| `audio_capture.disk.slow`（warn） | 写盘耗时出现新峰值（≥100 ms，按 100 ms 一档） |
| `audio_capture.devices.changed` | 枚举到设备变化 |
| `audio_capture.reconnect.start` / `.failed` / `.completed` | 共享麦克风重连：中断码、首次失败、重连耗时 `gapSeconds` 与设备回退说明 |
| `audio_capture.owner.detached` / `.attached`，渲染层 `audio_capture.session.attach.completed` / `.failed` | 界面离开、查询与接管 |
| `recording_power.hold.start` / `.completed`（域 `main.recording_power`） | 开始/停止阻止睡眠 |

### 7. 应用退出顺序（审查第 2 条，原有问题）

录音服务原来在 `before-quit` 就释放，而 `app.quit()`（安装更新、换数据目录重启、macOS 的 Cmd+Q）时 `before-quit` 先于窗口关闭守卫：守卫再去停止录音会报“服务已关闭”并否决关闭，退出或更新被取消、录音没拼回，而且本次运行再也录不了。改为导出 `disposeAudioCapture`，放进 `index.ts` 的 `bindApplicationShutdown` 清理列表，在所有窗口批准关闭后的 `will-quit` 执行；清理会等原生进程收尾 WAV 退出（最多 3 秒后强杀）。

## 二、改动文件

原生：
- `native/audio-capture/src/main.rs`（写盘/推流分离、合并入队、计数、补静音含停止时、非阻塞健康上报、协议 2、4 个新测试）
- `native/audio-capture/src/portaudio_bridge.c`（溢出标记每回调只交一次）

主进程 / preload：
- `electron/main/services/audio-capture/service.ts`（重写：推送背压按用途只丢推送、共享麦克风重连、界面接管、汇总日志、睡眠阻止与中断钩子、可等待的释放）
- `electron/main/services/audio-capture/service.test.ts`（重写）
- `electron/main/services/audio-capture/client.ts`、`client.test.ts`、`protocol.ts`（`health` 事件、协议 2、超时收拢与停止宽限、可等待的关闭）
- `electron/main/ipc/audio-capture.ts`（重载不停录、`isInPlace`、`active` 动作、系统通知、退出清理出口）
- `electron/main/services/recording-power.ts`、`recording-power.test.ts`（新）
- `electron/main/services/screen-recording/runtime.ts`、`runtime.test.ts`（只加睡眠阻止那几行与一个用例；**这两个文件录屏子代理也在改**，`runtime.ts` 里 `Notification`、`ownerLostHandler`、`notifyRecordingProblem` 等是对方的改动）
- `electron/main/index.ts`（AppUserModelId 1 行；退出清理列表加 `disposeAudioCapture`）
- `electron/preload/audio-capture-api.ts`（`active`）

渲染层：
- `src/core/audioCapture/contracts.ts`（健康计数 schema、`health` 事件、`active` 请求，均为运行时 IPC 契约，不落盘）
- `src/platform/contracts/audioCapture.ts`、`src/platform/adapters/electron/audioCapture.ts`
- `src/features/audioCapture/captureSession.ts`（`attach`）、`captureApplicationService.ts`（删导航守卫、关闭守卫、指示登记、回到录音）
- `src/features/audioCapture/AudioCaptureIndicator.tsx`、`captureIndicatorBinding.ts`（新）
- `src/components/WindowControls.tsx`（挂指示）
- 测试：`captureSession.test.ts`、`captureApplicationService.test.ts`、`captureTestFixture.ts`

## 三、测试与检查结果

- Rust（独立 target 目录，`cargo test --locked --release -j 8`，静态 CRT）：7/7 通过。新增：推流通道堵死时写盘照常、帧数与文件完整；驱动溢出计数且继续、位置正确；队列满丢帧计数并补静音、文件时长正确；停止前最后几块入队失败也补静音，且不推出 0 帧采样。`cargo fmt` 已跑。
- Vitest（只跑直接相关的 11 个文件，41 个用例全过）：
  - `audio-capture/service.test.ts`：预览不确认时只停推送不停录、确认后恢复；界面重载保留录音、新界面接管、窗口关闭才停；**查询应答后紧跟中断时不交给新界面**；**独占录音停止超时后状态收拢、睡眠阻止已释放、文件可恢复、可以重新开始录音**；**共享麦克风停止超时后订阅照样移除、不再重连、睡眠阻止已释放、之后能重新开始**；独占录音中断通知并释放睡眠阻止；共享订阅各自暂停/停止、慢订阅到 4096 块才开始丢且不影响快订阅；共享麦克风中断后自动重连、换文件名、序号连续。
  - `audio-capture/client.test.ts`：**录音中停止不应答时 60 秒仍等着、90 秒时不等进程退出就收拢状态，进程关掉输入后还在写完队列，120 秒宽限过了才强杀，`settled()` 随之完成**；**计时器因主进程卡住明显晚到时再宽限，晚到的应答照常收下**（去掉宽限逻辑时此用例失败）；协议号不配套握手即失败；原有生命周期用例。
  - `recording-power.test.ts`（引用计数成对）、`screen-recording/runtime.test.ts`（录屏持有并恰好释放一次）、`application-shutdown.test.ts`、`protocol.test.ts`、`preload/audio-capture-api.test.ts`。
  - `captureSession.test.ts`：界面重载后接管（时长、作品锁、停止后拼回）；**接管失败可重试；接管途中中断不漏、不锁作品**。
  - `captureApplicationService.test.ts`（切换工作区不停录、关闭窗口才停）、`WindowControls.test.tsx`、`AudioEditRecordingControls.test.tsx`。
- ESLint（改动文件逐个）、`check:surface`、`check:colors`、`check:icons`、`check:ui-residue`、`check:main-imports`：通过。
- `check:dependency-graph`：只报一条已有问题（`canvas → cameraStage`，来自已提交的 faef59195），本次没有新增环、首屏重模块或跨 feature 边。
- 两个 `tsc`：剩下的错误都在别人正在改、本次没碰的文件里（`src/core/audioEdit/subtitles.ts` 的 `findLastIndex`，两个工程都报；渲染层另有 `src/features/screenRecording/capture/session.test.ts` 的类型）；本次改动的文件无类型错误。第二轮审查只改了主进程文件，重跑了主进程 `tsc`，结论相同。
- 未跑：真实录音、`electron:bundle`、Reality。未重建 `native/audio-capture/target/release` 里的正式程序（见第五节第 1 条）。

## 四、需要真实录音验证的步骤

**准备**：先 `npm run build:audio-capture`，再 `npm run electron:bundle`，用 `npm run electron:prod -- --dev-skip-onboarding` 启动（不用开发版做正式验收；第 1 步重载那一项开发版也能验）。两者必须一起更新：协议号已升到 2，旧主进程连新原生程序（或反过来）会在握手失败，录不了音。

1. **后台长录（60 分钟）**：音频编辑新建录音，Shift+空格开始。
   - 第 1 分钟：切到“剪辑”。标题栏出现红点 + 时长 + 停止按钮，时长在走。再切回音频编辑：指示消失，页面里电平和时长正常、波形在长。
   - 第 3 分钟：最小化窗口 10 分钟以上。
   - 第 15 分钟：打开一个大剪辑工程拖动时间线 30 秒，再开一个剪辑导出（给主进程和界面加压）。可能出现 `audio_capture.preview.dropping`/`.resumed`，**不能出现** `audio_capture.recording.failed`。
   - 第 25 分钟：重载界面（`electron:prod` 下用任务管理器结束“痕迹AI”的渲染进程，等它自动重载；开发版可直接整页刷新）。重载后不进音频编辑，标题栏就应显示时长，接近真实已录时长。日志依次有 `audio_capture.owner.detached`、`audio_capture.owner.attached`、`audio_capture.session.attach.completed`。
   - 第 30 分钟：Win+L 锁屏，离开超过电源计划的睡眠时间。期间管理员命令行运行 `powercfg /requests`，`EXECUTION` 或 `SYSTEM` 一栏应列出痕迹AI（Chromium 在 Windows 上用执行请求实现 `prevent-app-suspension`，非“新式待机”机器上它同时阻止睡眠）；系统不应睡眠。笔记本若是新式待机（`powercfg /a` 显示 S0 低功耗待机），息屏后要额外确认录音没有停。
   - 第 50 分钟：不回音频编辑，直接点标题栏的停止。回音频编辑看录音已拼进作品、长度约等于录制时长；`powercfg /requests` 不再列出痕迹AI。
   - 查 `npm run logs:query -- --event audio_capture.recording.summary`：看 `durationSeconds` 与 `elapsedSeconds` 是否接近、`inputOverflows`/`droppedFrames`/`droppedPreviewBlocks`/`maxWriteMs` 的值。再查 `--event audio_capture.recording.glitch`、`--event audio_capture.disk.slow`。
2. **中断提醒**：录音时最小化窗口，拔掉 USB 麦克风（或在系统声音设置里禁用该输入）。约 5 秒内弹出系统通知“痕迹AI 录音已中断”、任务栏闪烁；点通知窗口回到前台，标题栏显示“录音已中断”，点它回到音频编辑，用“恢复录音”能把已录部分拼回。日志 `audio_capture.recording.failed` 的 `code` 为 `DEVICE_REMOVED`，随后一条 summary。再在窗口前台时拔一次：不应弹系统通知，只有标题栏和面板提示。开发版（electron.exe）可能不弹系统通知（Windows 对未注册应用 ID 的限制），以安装包为准。
3. **溢出不中断**：选 ASIO 或 WASAPI 独占，缓冲调到最小（如 64 帧），录 5 分钟，同时跑高 CPU 任务。若驱动报溢出，日志有 `audio_capture.recording.glitch`（`newInputOverflows`、`lastGlitchSeconds`），录音不停；停止后 summary 里计数与之一致。
4. **录屏麦克风自动重连**：录屏开麦克风录 5 分钟；第 2 分钟拔掉 USB 麦克风，等 10 秒再插回。日志：`audio_capture.reconnect.start` → 首次 `audio_capture.reconnect.failed`（warn）→ `audio_capture.reconnect.completed`（看 `gapSeconds`）。录屏不失败；导入剪辑后麦克风轨中间有一段空档，前后都有声音。再试一次拔掉后不插回：看 `reconnect.completed` 是否带“已临时使用……”说明（回退到默认输入）。录完后系统临时目录里不应残留 `henji-microphone-*-2.wav` 这类文件。
5. **作品保护**：录音进行中切到别处，从文档列表或助手 `trash_document` 删除这份录音作品，应被拒绝（正在使用）；停止后可以删除。
6. **退出与更新**：录音进行中从菜单退出应用（或在有更新时点“重启并安装”）：退出不被取消，录音先拼回作品再退出；重启后不应出现这段录音的恢复横幅。
7. **（可选）磁盘卡顿**：录音写到 U 盘或网络盘的数据目录，中途对该盘做大文件复制，看 `audio_capture.disk.slow` 的 `maxWriteMs` 与是否有 `droppedFrames`；有丢帧时文件时长仍应等于实际时长（中间是静音）。

## 五、给录屏侧的对接点（请转给录屏子代理）

1. **命令失败时释放防睡眠锁**：`screen-recording/control.ts` 的 `execute` 失败分支（约 150 行 `.catch`，把阶段设成 `failed`）不调用 `releaseResources()`，于是 `released` 回调不执行，`runtime.ts` 持有的防睡眠锁要等用户关掉控制条（`closeRecordingControl` → `dispose`）才放开。需要：在这个失败分支里也调用 `this.releaseResources()`（或至少调用 `this.deps.released()`）；`released` 里的释放是幂等的，重复调用没有问题。我没有改 `control.ts`。
2. **共享麦克风断开时的界面提示（可选）**：主进程现在自动重连，渲染层收不到中断事件，录屏界面在重连期间不会显示“设备断开”，空档原因记为 `missing-data` 而不是 `device`。如需显示，可在主进程 `service.ts` 的 `beginReconnect` 与重连成功处给订阅方发两个新事件（如 `reconnecting`/`reconnected`），渲染层 `captureMicrophone` 映射到 `onDeviceState`。
3. **麦克风轨不丢的兜底**：推送缓冲已放宽（原生通道 4096 条，48 kHz 下约 30–50 秒；主进程 4096 块，约 44–87 秒），超过仍会丢推送、轨道出现空档。完整录音始终在原生文件里：`start` 返回的 `outputPath`（重连后为同目录 `原名-N.wav`），每个采样都在，写盘跟不上的部分是等长静音；推送里的 `firstFrame` 就是该文件内的帧号（每次重连从 0 重新计）。要做到不丢，录屏侧可在停止后用这份文件补 `missing-data` 空档，或直接以它为麦克风主轨（即排查报告 P1-2）；那样录屏侧停止后就不能再删它（`microphone.ts` 现在会删），主进程结束时清理重连前的旧文件这一步也要改成交给录屏侧。我没有做这一步。
4. **系统通知有两份实现**：我的在 `ipc/audio-capture.ts`（`notifyCaptureInterrupted`，带前台判断与引用保留），录屏子代理在 `runtime.ts` 写了 `notifyRecordingProblem`。建议合并成一个主进程小工具，两边共用。

## 六、独立审查的处理（第一轮）

| # | 问题 | 处理 |
|---|---|---|
| 1（重要） | 开始/停止应答超时后主进程状态卡死 | 已修：超时一律结束原生进程走崩溃路径收拢；超时前先让已到达的应答处理完；停止超时 90 秒；补服务层与客户端测试 |
| 2（原有） | 退出时录音服务先于关闭守卫释放 | 已修：移到 `bindApplicationShutdown`，`will-quit` 执行并等原生收尾 |
| 3（原有） | `did-start-navigation` 未排除同文档变化 | 已修；核实应用确有同文档地址变化（`rendererRecovery.ts` 的 `replaceState`、开发画廊） |
| 4 | 接管途中中断会漏 | 已修：先登记会话并收事件再等；中断后不上锁；补测试 |
| 5 | 接管失败不重试 | 已修：失败不缓存，标题栏每 5 秒探测重试；补测试 |
| 6 | 录屏命令失败不释放防睡眠锁 | 在录屏侧文件里，按要求不改，写进第五节第 1 条 |
| 7 | 协议号没升 | 已修：升到 2，补握手失败测试 |
| 8 | 共享模式日志说法错误 | 已修：共享模式记 warn 并说明会有空档；共享阈值放宽到 4096 块、原生通道 4096 条；完全不丢需要录屏侧用原生文件兜底，见第五节第 3 条 |
| 9 | 停止时末尾丢帧没补静音；健康上报阻塞控制线程 | 已修：停止/暂停时用空块补静音（补测试）；健康上报改走推流通道的非阻塞发送 |
| 10 | 系统通知对象可能被回收；前台也发 | 已修 |
| 11 | 风险里缺手动睡眠/合盖 | 已补到第七节 |

第二轮：

| # | 问题 | 处理 |
|---|---|---|
| 1（重要） | 共享麦克风停止超时后订阅不移除、无限重连 | 已修：停止无论成败都移除订阅（try/finally），删空就收尾；补测试 |
| 2 | 接管查询与中断竞态 | 已修：查询应答后再核对会话仍在且原生在录，不一致返回 null；补测试 |
| 3 | 超时只等一轮事件循环 | 已修：计时器晚到 1 秒以上时再宽限 5 秒（最多 3 次）；补测试 |
| 4 | 收拢依赖进程退出事件 | 已修：超时、协议错误后同步执行失联收拢，不等 exit |
| 5（更好的做法） | 停止超时强杀会丢队列里未写盘的音频 | 已做：先收拢主进程状态，再关原生输入让它写完、收尾 WAV 自己退出，宽限 120 秒才强杀；恢复、回收同一文件前等它退出；队列容量注释改准（48 kHz 下最多约 87 秒） |

## 七、没做到的与风险

1. **原生程序与主进程必须同版本**：协议号已升到 2，不配套时在握手就失败（录不了，但不会录到一半断）。安装包与 `electron:dev` 都会一起构建；另一位子代理正在用的开发实例还是旧主进程，所以我没有重建 `target/release` 里的正式程序，留给统一验收时一起构建。
2. **用户手动睡眠、合盖睡眠，任何机器都拦不住**：防睡眠锁只挡系统空闲时的自动睡眠。用户点“睡眠”、合上笔记本（电源计划设为合盖睡眠）、电量耗尽时，系统照样挂起；唤醒后原生采集超过 5 秒没有回调，判定设备丢失、录音中断：唤醒后会收到中断通知，已录部分在文件里，用恢复横幅或“恢复录音”找回（WAV 每秒更新检查点，按物理长度修复）。睡眠期间的声音没有录到。新式待机机器息屏后的行为需要实测（第四节第 1 步）。
3. **音频编辑录音设备拔出后不自动重连**：按要求“设备真的没了才停”。一次补录是一个文件、拼回一个位置，重连要改成多文件拼接，没做。录屏麦克风已自动重连。
4. **应答超时会结束录音**：开始、暂停、继续、查询 20 秒、停止 90 秒没有应答（原生进程挂死，或主进程卡死超过这么久）时，主进程当场收拢状态并让原生进程写完退出；独占录音因此中断（有通知、文件可恢复），共享麦克风会自动重连。主进程短暂卡住不会误判（先处理已到达的应答，计时器晚到再宽限）。失联进程卡在驱动里出不来时，120 秒后强杀，那时队列里还没写盘的音频会丢；这期间点“恢复录音”会等它退出（最多约两分钟），同时录音服务的其他操作排在后面。重连时若旧进程还占着设备，新的采集可能先报设备占用，重连会继续重试。
5. **录屏麦克风在推送积压超过缓冲时仍会出现空档**（主进程不读管道约 30 秒以上，或界面不消费约 44 秒以上）；完全不丢需要录屏侧用原生文件兜底（第五节第 3 条）。
6. **重连找不到原设备会回退到系统默认输入**（与开始录音的规则一致）。正式录制时可能换成笔记本自带麦克风，好处是不会整段无声；日志里有说明。如果宁可无声也不换设备，需要另定规则。
7. **`setAppUserModelId`** 会让安装版的任务栏分组身份对齐安装器快捷方式（应该更正确），但需要在安装包上确认任务栏图标、固定和通知都正常。
8. 界面文案（指示、通知）跟随录音功能现有写法直接用中文，没进 i18n（`ui.json` 正被别的任务修改，没去碰）。
9. 界面重载后到接管完成之间（通常不到一秒）的推送会被丢，只影响实时波形；接管时若作品已被别人改过，停止时拼接会被拒（原有的版本检查），录音文件留在恢复横幅里。接管时取作品位置失败的话，停止后这段会按“另存为新草稿”导入，不会丢。
10. 标题栏指示没有单独测试，依赖会话层测试与真实窗口目视（第四节第 1 步）；也没截图验收。标题栏每 5 秒的探测在主进程只是查一下内存状态，平时不访问原生进程。
11. 录屏侧的 P0-1（会话文档整份重存）、P0-3（中断后无恢复入口）、P1-1/P1-2/P1-4 不在本次范围，由录屏子代理处理。
