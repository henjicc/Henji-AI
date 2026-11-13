# 结果：录音与录屏的助手能力（2026-11-13）

对应 `result-助手可用性.md` 第四节的 A1、A2、B3、B4、B5，`result-系统声.md` 第九节鼠标键盘事件的时间，`docs/task/界面统一/规格写法统一.md` 的待补清单，录屏参考文档与台账。验证级别 L2（新能力、IPC 动作、跨进程状态读回）。没有碰 git、没有启动应用、没有跑 assistant:cli、没有付费调用、没有改持久格式。提交前审查由协调方安排。

## 一、每条怎么改的

### A1 音频编辑录音的助手能力
- 新增五个语义能力（`src/core/application-control/domains/audioEdit/audioEditRecordingCapabilities.ts`，领域 audio_edit，追加在音频编辑能力之后注册；工具目录按名字排序，位置不影响已有工具）：
  - `start_audio_edit_recording`：documentRef 可省略（省略时用 `createAudioEditDraft(null)` 新建录音口播，projectId 指定放进哪个项目，不切页面）；positionSeconds 省略接在末尾；replaceUntilSeconds 覆盖一段。
  - `pause_audio_edit_recording`：与界面“暂停”一致，先把这一段拼进作品并保存。
  - `resume_audio_edit_recording`：接在刚拼回那段末尾继续录（与界面“继续录音”同一个位置：起点 + 已录秒数）。
  - `stop_audio_edit_recording`：停止、拼回、保存，回读作品时长。
  - `recover_audio_edit_recording`：action=restore 拼回原作品原位置，discard 进回收区；outputPath 省略时用刚中断的或唯一的待恢复文件。
- 处理器在 `src/features/application-control/audioCaptureDomain.ts` 的 `registerCapabilities`，业务在新文件 `src/features/audioCapture/audioEditRecording.ts`：调用的是界面录音按钮用的同一个 `getAudioCaptureSession()` 会话（start / togglePause / stop / recoverTake / restore / discard）和 `prepareAudioEditTake`，没有第二套录音实现。这个文件只补三件事：写入前的拒绝（`notExecutedFailure`）、秒数换成采样帧、把拼回登记成一步撤销。
- 撤销：暂停、停止、恢复拼回后用 `recordAudioEditStep` 登记，回执带 undoRef，交给已有的 `undo_audio_edit`。录音被别处停下（界面按钮、标题栏、覆盖到头自动停）时，停止能力仍返回已拼回的结果和 undoRef（记住了开始那一刻的作品）；暂停已发过的那一步，停止不再重复发。
- 设备参数：没有给能力加“这次用哪个设备”的参数。理由：界面录音没有单次覆盖，设备就是录音设置那一份；助手要换设备就改 `audio_capture.settings` 的通用属性（与用户在设置里改一样，之后都用它）。描述里写明了。
- 写入前就拒绝并说清原因的：已经在录（含界面重载后还没接管的那段）、上一段中断没处理、录屏或讲解占着麦克风、正在开始或保存、口播正在处理、位置越界或落在锁定词块里、新建口播却给了位置、projectId 与 documentRef 同时给、待恢复文件不唯一、原作品在录音后被改过（不能拼回）。
- 停止时若界面还没接管重载前的录音，先 `session.attach()` 接上再停，照常拼回原位置。
- 删除 `AUDIO_CAPTURE_CONTROL_EXCLUSION`；`audio_capture.settings` 的实体描述、recording 的只读原因改为指向这组能力；`insert_audio_edit_file` 描述里“录音设备控制不在此能力内”改为“要用麦克风现录用 start_audio_edit_recording”；`check-assistant-capabilities.cjs` 的 audioCapture 说明同步。
- 取舍：录音是占着设备的长会话，写不成属性，所以照 `start_screen_recording` 的先例做成语义能力（这与“专用能力只留给算法型操作”的字面有出入，属于生命周期类操作，与录屏一致）。

### A2 录音状态读回
- 主进程新增只读 IPC 动作 `recordingState`（`src/core/audioCapture/contracts.ts`、平台接口、Electron 适配、preload 各一行）：`AudioCaptureService.recordingState(owner)` 只读内存里的事实，不问原生进程、不排在开始停止后面、不动推送确认。给出本窗口的独占录音（文件、在录或暂停、时长、健康计数）、录屏或讲解是否占着麦克风、最近一次中断（文件、中断码、原因、时间；再开始录音就清掉）。
- `audio_capture.settings.recording` 改为以主进程为准、界面会话补充（`readAudioCaptureRecording`）：phase、durationSeconds、documentId、positionSeconds、replaceUntilSeconds、busy、attached（界面是否已接管）、error（中断原因）、notice、outputPath、health、microphoneInUse。界面重载后、标题栏接管之前读到的是“在录”，所属口播从主进程的恢复登记里取。
- 新增只读属性 `audio_capture.settings.pending_files`（追加在原有属性之后）：文件名、路径、时长、原口播与位置、中断原因。两个属性只在被读到时才去主进程取，改录音参数时不顺带扫录音文件。
- 原来的 `readAudioCaptureSession` 删除，`scripts/recording-soak.cjs` 读的 phase、durationSeconds 两个键保持不变。

### B3 录屏默认值跟随用户设置、长录事实读回
- `start_screen_recording` 的 width、height、fps、tracks 去掉默认值：省略时取录屏设置里保存的值（`loadRecordingSetup`），分辨率与编码用 `recordingOutput`，声音与摄像头用新的 `recordingTracksFromSetup`（放在 `src/features/screenRecording/recordingSetupModel.ts`，录屏页“开始录制”改为用同一个函数），所以与用户点按钮得到的一样。width 与 height 只给一个时在写入前拒绝。描述里写明默认跟随设置、音频编辑录音时不要开麦克风。
- 长录事实：主进程新增 capture 操作 `facts`（`src/core/screenRecording/capture.ts` 的 `RecordingCaptureFacts`，走已有的 capture 通道，不改 preload）。录制中实时给出，停止后保留到应用退出（最近 32 次）：
  - 画面丢帧、重复帧、编码续录次数与编码器（`GfxCaptureBackend.stats()`）；
  - 系统声补的静音（没声音、设备不可用分开）、写盘丢帧、数据不连续、设备切换、重连（`SystemAudioRecorder.stats()`，新增的公开读取）；
  - 麦克风驱动溢出与欠载、写盘丢帧、来不及送到轨道的块、重连（`AudioCaptureService.sharedFacts()`，录音 IPC 注册时用 `provideMicrophoneFacts` 登记一次；录屏收尾时麦克风已先停，取最近结束的那一路）；
  - 界面断开次数、采集失败原因、是否为启动时自动补齐的；录制中另带实时轨道。
- `screen_recording.session.details` 追加 `tracks`（每路分段数、空档按原因计数、缺数据总秒数、提示；录制中来自主进程实时轨道，停止后来自录制文档，重启后仍在）、`capture`（上面的计数，重启后为 null）、`finishing`，并填 `error`。

### B4 render_cache.rendering.paused
- `videoEditFields.ts` 的 rendering schema 加 `paused: z.string().optional()`，属性说明补一句含义（运行期属性的 schema，不是落盘格式）。

### B5 录屏停止按收尾等待
- stop、recover、import 的等待上限改为 600 秒（与音频编辑长任务一致）。
- stop 的处理器经新文件 `recordingStopWait.ts` 等收尾：到约 9 分钟（上限减 60 秒余量）还没完，返回 `finishing: true` 和说明，收尾照常在后台进行，不报失败；读回看 `details.finishing` 与 phase。描述里写了“不要再次停止”。
- 取舍：录屏收尾没有可读的进度，所以“按进度等待”做成“等到上限前如实返回仍在收尾、可继续查询”；收尾真正失败时由录制服务原有的日志与通知负责。

### 鼠标键盘事件按钩子时刻记时
- 新文件 `electron/main/services/screen-recording/hook-clock.ts` 的 `HookEventClock`：钩子事件的 `time`（系统滴答毫秒）与主进程单调时钟的差取见过的最小值作偏移；平时仍用收到的时刻（精度不降），晚到超过 20 毫秒（主进程卡过）才改用事件自己的时刻；滴答回绕或卡超过一分钟时重新对齐；不早于录制原点。
- `input-events.ts` 把 `event.time` 传给监听；`events.ts` 的点击、滚轮、按键、移动都用换算后的时刻，移动的 4 毫秒节流也按它算。
- 定时采样（光标形状、前台窗口）晚到超过 20 毫秒时先 `setImmediate` 让一下，让卡顿期间排队的钩子事件按各自时刻先记下，免得被压到这次采样之后。
- 卡顿期间移动的分辨率受系统滴答粒度限制（约 16 毫秒一格，也就是约 64 次每秒），比原来整段丢掉好；正常时不变。

### 界面文案待补清单
- `WebAppRecordingPanel.tsx` 清晰度 `1080P`；两个录屏面板帧率分段改 `formatFrameRate(fps, 'compact')`（`30fps`、`60fps`）；`AudioEditPanels.tsx` XML 帧率 `formatFrameRate(n)`（`25 帧/秒`）；`captureSettingsModel.ts` 用 `formatSampleRate`；主进程录音服务的采样率提示用 `formatSampleRate`（相对路径引用，`check:main-imports` 通过）。
- `asrCatalog.ts` 没动，留在清单里；清单已更新。

### 录屏参考文档与技能
- `resources/assistant-skills/video-edit-workbench/references/screen-recording.md`：开始前写默认跟随录屏设置、系统声来源（Windows 原生录整个系统混音、跟随默认输出设备、重载不断；macOS 仍由界面采集）、麦克风与音频编辑录音分用并写明音频编辑录音可由助手开始与停止；录制中补 finishing；中断后的恢复分成界面重载、编码续录、应用崩溃后自动补齐、recover 四种；新增“长录事实怎么读回”一节。
- `video-edit-workbench/SKILL.md` 路由表那一行补“长录事实读回”“音频编辑录音（助手可直接开始、停止）”。
- `audio-edit-workbench/**` 没动，要改的点见第五节。

### 台账
- `docs/rules/assistant-status.md` 顶部加 11-13 一条（推翻 10-23 起“录音生命周期不向助手开放”）；第三节“音频编辑录音没有助手能力”“录屏省略参数不跟设置……”两条销掉，改为一条“已接通但未由真实助手走过”，写明哪些没实测、录屏采集计数只在本次运行内有。

## 二、改动文件
新建：
- `src/core/application-control/domains/audioEdit/audioEditRecordingCapabilities.ts`
- `src/features/audioCapture/audioEditRecording.ts`、`audioEditRecording.test.ts`
- `src/features/screenRecording/application/recordingStopWait.ts`、`recordingStopWait.test.ts`
- `electron/main/services/screen-recording/hook-clock.ts`
- 本文件

修改：
- 录音：`src/core/audioCapture/contracts.ts`、`src/platform/contracts/audioCapture.ts`、`src/platform/adapters/electron/audioCapture.ts`、`electron/preload/audio-capture-api.ts`（一行）、`electron/main/ipc/audio-capture.ts`、`electron/main/services/audio-capture/service.ts`、`system-audio.ts`、`src/features/audioCapture/{captureApplicationService,index,captureSettingsModel,captureTestFixture}.ts`、`src/features/application-control/{audioCaptureDomain,audioCaptureFields,audioCaptureDomain.test}.ts`
- 录屏：`src/core/screenRecording/capture.ts`、`src/core/application-control/domains/screenRecording/recordingCapabilities.ts`、`electron/main/services/screen-recording/capture/service.ts`、`capture/service.test.ts`（替身补 ledger）、`events.ts`、`events.test.ts`、`input-events.ts`、`src/features/screenRecording/{recordingSetupModel.ts,ScreenRecordingApp.tsx,RecordingSetupPanel.tsx,WebAppRecordingPanel.tsx}`、`application/{applicationDomain,applicationDomain.test,recordingReflection}.ts`
- 登记与说明：`src/core/application-control/builtinApplicationCapabilityRegistry.ts`（两行）、`src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts`（insert 描述一句）、`scripts/check-assistant-capabilities.cjs`（一条说明）
- 不在我名下但必须动的：`src/features/audioEdit/index.ts`（导出 `prepareAudioEditTake`、`recordAudioEditStep`）、`src/features/audioEdit/workspace/AudioEditPanels.tsx`（文案两处）、`src/features/videoEdit/application/videoEditFields.ts`（B4 一处 schema 与一句说明）
- 文档：`resources/assistant-skills/video-edit-workbench/references/screen-recording.md`、`video-edit-workbench/SKILL.md`（路由表一行）、`docs/rules/assistant-status.md`、`docs/task/界面统一/规格写法统一.md`

能力与属性都追加在同类之后，没有重排已有项。持久格式与落盘 schema 的说明文字没有改（`check:persistence-compat` 通过）。

## 三、检查与测试
- 新测试：
  - `audioEditRecording.test.ts` 3 项：界面没接管时按主进程读出在录、所属口播与位置；录屏占麦克风时开始在写入前拒绝、不建文件；助手开始后界面那一个会话就在录、停止后拼回原位置并保存、按回执 undo 恢复原作品。
  - `applicationDomain.test.ts` 新增 1 项：不传分辨率帧率声音时，采集选项与轨道等于用保存的设置算出的值（4K60 + 麦克风 + 系统声），授权种类对应。
  - `recordingStopWait.test.ts` 2 项：超过上限返回仍在收尾、之后失败不冒成未处理的拒绝；上限内完成为成功、停止被拒照常报错。
  - `events.test.ts` 新增 1 项：主进程卡 600 毫秒后一起送到的 50 次移动与 1 次点击按事件自己的时刻记下；红→绿已验证（把晚到门槛调到无穷大时这项失败，恢复后通过）。
- 相关测试通过：`audioCaptureDomain.test.ts`（更新了 recording 的期望并补 pending_files）、`captureSession`、`captureApplicationService`、`AudioCaptureSettingsForm`、`AudioEditRecordingControls`、`audio-capture/service`、`system-audio`、`ipc/audio-capture`、`preload/audio-capture-api`、`screen-recording/capture/service`、`events`、`storeActionCoverage`、`collectionCoverage`、`resultBehaviorCoverage`、`externalCapabilityInventory`、`videoEditWorkbenchSkill`、`embedded-agent/skills`。
- `npm run check:application-control-coverage`：15 项通过。`npm run check:persistence-compat`：通过（67 种格式）。`check:main-imports`、`check:surface:strict` 通过（surface 只有既有启发式告警）。改动文件 ESLint 通过。
- `check:assistant-capabilities:structure` 只报既有的 `resultSelection.ts` 未建账。
- `toolCatalog.test.ts` 有 2 项失败，报的是 `revert_assistant_memory`、`describe_application_contract` 的参数表不一致，来自工作区里别人正在改的 `toolCatalog.ts` / `inputValidation.ts`（信息精简那边），与本次无关。
- 用整张注册表的 `createApplicationHarness` 跑录音测试时，被别人进行中的 `audioEditFields.ts` 改动挡住（`audio_edit.suggestion` 某个属性标题超过 120 字，反射注册失败）；所以新测试改为直接用领域注册的处理器，不经整张注册表。那边改好后，`audioEditAssistantSteps.test.ts` 等走整张注册表的测试才会恢复。
- 两套类型检查：见第六节。

## 四、需要真实助手走查确认的步骤
准备：`npm run build:audio-capture` → `npm run electron:bundle` → `npm run electron:prod -- --dev-skip-onboarding`（或 assistant:cli 用隔离资料目录加真实麦克风）。
1. 让助手“新建一份口播录 30 秒”：应调 `start_audio_edit_recording`（不给 documentRef），不切页面；标题栏出现录音指示；`audio_capture.settings.recording` 读到 phase=recording、documentId、durationSeconds 在涨。
2. 让助手暂停再继续：暂停后作品里有这一段、可以试听；继续后接在末尾录。
3. 录音中重载界面（任务管理器结束渲染进程），在标题栏接管前让助手读 recording：应为 recording、attached=false；接着让助手停止：拼回原位置，作品时长约等于录制时长。
4. 让助手撤销刚才的录音：`undo_audio_edit` 带停止回执的 undoRef，作品恢复。
5. 录音中拔掉 USB 麦克风：recording 读到 interrupted 与原因、pending_files 有这个文件；让助手 `recover_audio_edit_recording` 拼回。
6. 录屏开着麦克风时让助手开始录音：应被拒并说明，录音文件不会多出来。
7. 录屏设置保存成 4K60、开系统声，让助手“录一下这个窗口”且不说参数：录出来是 4K60、有系统声。
8. 两小时录屏后让助手停止：9 分钟内没收尾完时回执 finishing=true，之后读 details.finishing 变回 false；读 details.tracks / capture，空档、丢帧、续录与日志 `recording.capture.summary` 对得上。
9. 录屏中让主进程卡几秒（例如开大工程导出），之后看 `read_screen_recording_events`：卡顿期间的移动与点击时刻连续，不挤在同一刻。

## 五、要音频编辑技能负责人改的点（`resources/assistant-skills/audio-edit-workbench/**`）
1. 录音一步改成能力调用：新录用 `start_audio_edit_recording`（不给 documentRef 就新建；补录给 documentRef 与 positionSeconds，覆盖一段再给 replaceUntilSeconds），停用 `stop_audio_edit_recording`，回执的 undoRef 交给 `undo_audio_edit`。删掉“请用户在音频编辑里点录音”。
2. 录音期间读 `audio_capture.settings.recording`：phase、durationSeconds、documentId、positionSeconds；attached=false 表示界面重载后还没接管，停止照样可用；microphoneInUse=true 时录屏占着麦克风，不能开始。
3. 暂停的含义与界面一致：`pause_audio_edit_recording` 会先把这一段拼进作品并保存（可撤销），`resume_audio_edit_recording` 接在这段末尾录新的一段。
4. 中断后：读 `audio_capture.settings.pending_files`，`recover_audio_edit_recording` 的 restore 拼回原位置、discard 进回收区；原作品在录音后被改过时只能请用户在恢复横幅里另存为新草稿。
5. 换麦克风或采样率：改 `audio_capture.settings` 的通用属性（之后的录音都用它），开始能力没有单次设备参数。
6. 录完通常接着转写与粗剪：先 `transcribe_audio_edit`，再 `quick_process_audio_edit`。

## 六、类型检查
- 渲染层（`heavy.sh` 下 `tsc -p tsconfig.json`，一次）与主进程（`tsc -p tsconfig.electron.json`，一次）：都只报 `electron/main/services/application-runtime/resultProjection.ts` 的 3 处（`data.effects` 为 unknown、两个隐式 any），是工作区里别人正在改的文件；本次改动的文件零错误。

## 七、没做的与风险
1. **没有真实设备与真实助手验证**：麦克风录音、界面重载后接管、拔设备中断、两小时录屏收尾都只有精确测试，按第四节走。
2. **录屏采集计数只在本次运行内有**（null 表示不知道）：丢帧、续录、补静音、麦克风溢出不在录制文档里（不改持久格式），应用重启后 `details.capture` 为 null，只剩轨道空档；日志 `recording.capture.summary` 一直在。
3. **麦克风计数取“最近结束的那一路”**：录屏收尾时麦克风已经先停；同一时间又有讲解用过麦克风时可能取到那一路。另外订阅停止后被移除的那一路的推送丢弃块不计入（原有汇总日志也是这样）。
4. **短等加可查询**：录屏停止、恢复、导入与录音暂停、停止、恢复都最多等 45 秒；长任务之后靠读回或 get_application_operation 判断完成，原操作记录里留的是“仍在进行”那份回执。
5. **助手开始录音失败但已经建了文件**：与界面一样，会话保留这个文件位置（`captureSession.test` 的既有约定），下次开始会提示先用 `recover_audio_edit_recording` 处理；新建口播后录音没开成时那份空口播留着，错误里写明了 ID。
6. **钩子时刻在卡顿时的粒度约 16 毫秒**：卡顿期间的移动约 64 次每秒；按键与点击时刻误差在一个滴答内。偏移按最近 15–30 秒取最小值，能跟上时钟漂移；卡顿超过约 30 秒、期间没有准时事件时偏移可能被晚到事件抬高。没在真机上验证。macOS 不换算，维持原行为（主进程卡顿时仍晚记）。
7. `scripts/recording-soak.cjs` 已改为默认走正式能力（见第八节）；没有真跑长录验证这条新路径。
8. 没做 `screen_recording.setup` 实体（只读录屏设置）：本次只要求省略时跟随，没有加新的设置读写入口。

## 八、第一轮独立审查的处理（2026-11-13）

| # | 问题 | 处理 |
|---|---|---|
| 1（重要） | 继续录音的位置与界面不一致 | 新增 `audioEditPlayheadFrame`（`audioEditSpliceService.ts`），界面“开始/继续录音”（`AudioEditRecordingControls.tsx`）与 `resume_audio_edit_recording` 共用：默认从当前播放头接；能力可给 positionSeconds 指定从作品哪一秒接，同样按拼接位置规则在写入前检查。没做“接在刚才那段后面”这个选项：暂停后可以编辑，按录音前坐标推算的位置会错，用户要这个效果时播放头本来就停在那里 |
| 2（重要） | 读回与写入前检查仍走排队的 IPC | `recordingState` 带出待恢复文件（含作品位置与时长，读恢复登记与文件头，不碰原生进程）和录音设置修订号，在 IPC 里不进 `service.run` 队列；读回、五个能力的写入前检查、恢复选文件都只用它。只读 recording / pending_files 时 `readEntity` 走 `readCaptureLifecycle`，不再调 enumerate 与 getSettings；台账与说明措辞改准 |
| 3（重要） | 钩子时钟偏移只降不升、未处理回绕、门槛太低、macOS 单位不同 | `hook-clock.ts` 改为最近 15–30 秒的最小值（两格滚动），处理 32 位回绕，门槛 50 毫秒，卡超过一分钟重新对齐；只在 Windows 换算，macOS 总用收到的时刻。新增 `hook-clock.test.ts`：滴答慢 100 ppm 录两小时后准时事件仍用收到时刻、卡顿后晚到事件误差小于 2 毫秒（把窗口改成全程最小值时这项失败，已验证）；回绕后照常；不换算时不动 |
| 4（重要） | 录屏停止一次等 9 分钟 | 新增通用 `src/core/application-control/execution/waitWithin.ts`（`CAPABILITY_SHORT_WAIT_MS` = 45 秒）。录屏停止、恢复、导入都最多等 45 秒，没做完返回 finishing=true 与如实说明（导入时 itemIds 为空），后台进行中的工作登记在 `recordingWork.ts`，会话 `details.finishing` 据此为 true；超时上限回到 60 秒。摘要按 finishing 写，不再说“已完成”。音频编辑录音的暂停、停止、恢复同样改为 45 秒短等（上限 60 秒），等不及的拼回做完后撤销引用放进 `recording.lastTake`；这三个能力的验证改为不要求 verified（“仍在进行”不被判失败） |
| 5 | 停止回执可能谎报成功 | 回执按真实结果写：拼回后核对已保存、文件已不在待恢复列表；停止时拼回失败抛出说明文件位置与 recover；上次停止没拼回成功（会话停在 stopped 还留着文件）时写入前拒绝并指向 recover；“此前已停止”分是否找到那次拼回、是否暂停中结束三种说法 |
| 6 | 重载后中断的录音调停止只说“没有在录” | 停止、暂停都先看主进程读回：已中断就拒绝并指向 recover_audio_edit_recording，带中断原因；主进程在录但界面接不上时也如实拒绝 |
| 7 | 新建口播后录音没开成留下空口播与录音文件 | 失败时把预建的录音文件（`session.discard`）与空口播（`trashDocument`）移进回收区，提示按真实清理结果写；补测试 |
| 8 | 搭了界面操作的车 | 能力调用会话前同步检查 `busy`，界面正在开始、停止或保存时如实拒绝（`own()`，检查与调用之间没有 await） |
| 9 | 录屏默认值与音频编辑抢麦克风、快速模式带摄像头 | 音频编辑正在录音时省略 tracks 就不带麦克风并在回执说明，显式写 microphone 在写入前拒绝；省略 tracks 时按保存的模式传 quick，快速模式不录摄像头，与界面一致；补测试 |
| 10 | null 的含义、麦克风计数取到上一次 | 说明补“null 表示不知道，不等于没有丢帧或空档”（schema 与参考文档）；麦克风计数录制中只认正在进行的那一路，收尾时只认本次录制开始之后结束的那一路（`endedAt` 与 `startedAt`） |
| 11（原有） | discard 不管丢哪个文件都清空会话 | 丢的不是会话自己的文件时，不停录音、不清会话的作品位置与文件路径 |
| 12 | 测试 | `audioEditRecording.test.ts` 改为经正式注册表与执行上下文（`createApplicationHarness`），6 项：未接管时读回（并断言没有去排队的 pendingFiles）；麦克风被占时写入前拒绝；开始→暂停→从挪过的播放头继续→停止，两段各自拼回、逐段撤销；中断后读回中断与待恢复文件、停止被拒指向恢复、恢复拼回可撤销、再恢复一次说明已没有；新建录音口播并录入；新建口播后没开成时清理且下一次不被挡。注册表那边已恢复，没有测试绕开注册表 |
| 另 | soak 脚本 | `scripts/recording-soak.cjs` 录音场景默认用 start/stop_audio_edit_recording，`--audio-control ui` 切回界面按钮与标题栏；停止回执 finishing 时照常进入等作品拼回的核对；已知缺口里过时的说法改掉。`scripts/lib/recordingSoak.cjs` 加参数解析，`recordingSoak.test.cjs` 通过 |

第二轮改动文件（在第一轮之外新增或再改的）：`src/core/application-control/execution/waitWithin.ts`、`waitWithin.test.ts`（新）、`src/features/screenRecording/application/recordingWork.ts`（新）、`electron/main/services/screen-recording/hook-clock.test.ts`（新）、`electron/main/services/audio-capture/settings.ts`（`currentRevision`）、`src/features/audioEdit/application/audioEditSpliceService.ts`、`src/features/audioEdit/workspace/AudioEditRecordingControls.tsx` 与其测试（替身保留真实的播放头函数）、`src/features/audioCapture/captureSession.ts`（discard）、`scripts/recording-soak.cjs`、`scripts/lib/recordingSoak.cjs`；删除了第一轮的 `recordingStopWait.ts` 与其测试（由通用 waitWithin 取代）。其余为第一轮文件的增量。

第二轮检查：上面列的相关测试 19 个文件 87 项通过；`check:application-control-coverage` 15 项通过；改动文件 ESLint 通过；`check:main-imports` 通过；`check:dependency-graph` 只报 canvas→cameraStage、imageEdit/videoEdit→generation 三条，都不是本次的文件；主进程 `tsc` 0 错误；渲染层 `tsc`（这一轮一次）只报本次两份测试里 3 处对 unknown 取属性（`audioEditRecording.test.ts` 两处、`applicationDomain.test.ts` 一处），已改成显式类型、两份测试重跑通过、ESLint 通过；按每轮只跑一次的约定没有再跑全量渲染层 tsc，请在第二轮审查或提交前复核一次。`check:persistence-compat` 这次报 `document.audio_edit/v9` 指纹被改写，来自工作区里粗剪那边未提交的 `src/core/audioEdit/schema.ts`、`src/core/documents/kinds/audioEdit.ts`（本次没碰这两个文件；第一轮跑时还是通过的）。

## 九、第二轮独立审查的处理（2026-11-13）

| # | 问题 | 处理 |
|---|---|---|
| 1（重要） | 后台做完后成败读不到；lastTake 可能是上一段的引用 | 录音：`commitTake` 在拼回开始时把 lastTake 改成这一段（outputPath）、state=saving，做完写 saved（带 undoRef）或 failed（带原因）；后台失败也登记，不再被吞掉。录屏：`recordingWork.ts` 记下后台停止收尾、恢复、导入失败的原因（再发起一次就清掉），`details.error` 带出。删掉指向 get_application_operation 的说法；回执、schema 说明与参考文档都写明 finishing 结束后读哪个字段判断成败（录屏看 details.error，录音看 lastTake.state、undoRef、error） |
| 2（重要） | 正忙时的拒绝文字引错做法、“未执行”标记丢失 | 四个录音能力（开始、暂停、继续、停止，恢复也一样）的写入前检查第一条就是“界面或后台正在处理上一个录音操作，等它完成后读 audio_capture.settings.recording 再决定”（未执行）；“正忙”包括会话忙和本层仍在后台拼回的操作。`own()` 的拒绝在 work 外同步抛出，不再被包装 |
| 3 | 继续录音默认位置读全局播放头 | 新增 `audioEditResumeFrame`（`audioEditSpliceService.ts`）：音频编辑正显示这份口播时与界面一样取当前播放头，正在试听先停（`useAudioEditPreview.ts` 订阅“播放中→停下”的变化，与按钮停播放一样停掉输出）；没显示这份口播时接在刚拼回那一段的真实末尾（暂停拼回后按拼回前后作品长度算出的位置）。界面按钮仍用 `audioEditPlayheadFrame`，行为不变 |
| 4 | 钩子时钟长时间无事件沿用旧偏移 | 换格时距上一格超过两格就把上一格置为无穷大；补测试（两分钟没事件、两个时钟差变了 80 毫秒后准时事件仍按收到时刻记；去掉这条处理时失败，已验证） |
| 5 | 回绕测试拦不住回退 | 改成回绕时主进程正卡着、回绕后第一批事件就是晚到的：不认回绕会当成跳变重新对齐、按收到时刻记而晚 1 秒；去掉回绕处理时失败，已验证 |
| 6 | 录音读回两部分不同时刻取 | IPC 先 `await files.pending()`，再在同一个同步段里取录音状态 |
| 另 | outputContract 缺样例回执 | 补了 5 个录音能力与 `undo_audio_edit`、`redo_audio_edit` 的样例回执（按大版本 4 约定，不带修订号），271 项通过 |

新增测试：`audioEditRecording.test.ts` 增至 8 项，新增“没显示这份口播时继续录音接在刚拼回那一段末尾”“暂停成功后停止等不及、后台拼回失败：lastTake 指向这一段并写明原因、不带上一段的撤销引用；后台期间停止、继续、开始、暂停都请调用方等待（未执行）；之后按提示恢复”，原有一项改为“音频编辑正显示这份口播且在试听时，继续录音先停试听、接在播放头”。为走到“等不及”的路径，测试把短等改成 50 毫秒（只替换这个常量）。`recordingWork.test.ts`（新）1 项。`hook-clock.test.ts` 4 项。

第三轮检查：`audioEditRecording`、`useAudioEditPreview`、`recordingWork`、`applicationDomain`（录屏）、`hook-clock`、`events`、`outputContract`、`ipc/audio-capture`、`audioCaptureDomain`、`AudioEditRecordingControls`、`audioEditSpliceService`、`captureSession`、`waitWithin`、`storeActionCoverage`、`audio-capture/service` 共 15 个文件全部通过；`check:application-control-coverage` 15 项通过；改动文件 ESLint 通过；主进程 tsc 0 错误。渲染层 tsc 本轮按规矩用 heavy.sh 跑了一次（结果见下一行）；另外中途我误跑过一次不带 heavy.sh 的渲染层 tsc（输出被丢弃，没有用作结论），如实记下。

渲染层 tsc（heavy.sh，本轮一次）：0 错误。

## 十、只属于这项的文件清单（交给协调方提交）

新建（整份都是这项的）：
- `src/core/application-control/domains/audioEdit/audioEditRecordingCapabilities.ts`
- `src/core/application-control/execution/waitWithin.ts`、`waitWithin.test.ts`
- `src/features/audioCapture/audioEditRecording.ts`、`audioEditRecording.test.ts`
- `src/features/screenRecording/application/recordingWork.ts`、`recordingWork.test.ts`
- `electron/main/services/screen-recording/hook-clock.ts`、`hook-clock.test.ts`
- `tickets/46-正式使用链路/result-录制的助手能力.md`

修改、整份改动都是这项的：
- 录音：`src/core/audioCapture/contracts.ts`、`src/platform/contracts/audioCapture.ts`、`src/platform/adapters/electron/audioCapture.ts`、`electron/preload/audio-capture-api.ts`、`electron/main/ipc/audio-capture.ts`、`electron/main/services/audio-capture/{service,settings,system-audio}.ts`、`src/features/audioCapture/{captureApplicationService,captureSession,captureSettingsModel,captureTestFixture,index}.ts`、`src/features/application-control/{audioCaptureDomain,audioCaptureFields,audioCaptureDomain.test}.ts`
- 录屏：`src/core/screenRecording/capture.ts`、`src/core/application-control/domains/screenRecording/recordingCapabilities.ts`、`electron/main/services/screen-recording/{capture/service.ts,capture/service.test.ts,events.ts,events.test.ts,input-events.ts}`、`src/features/screenRecording/{recordingSetupModel.ts,ScreenRecordingApp.tsx,RecordingSetupPanel.tsx,WebAppRecordingPanel.tsx}`、`src/features/screenRecording/application/{applicationDomain.ts,applicationDomain.test.ts,recordingReflection.ts}`
- 脚本与文档：`scripts/recording-soak.cjs`、`scripts/lib/recordingSoak.cjs`、`resources/assistant-skills/video-edit-workbench/references/screen-recording.md`

与别人共用的文件（只提交标出的部分，按行区分）：
- `src/core/application-control/builtinApplicationCapabilityRegistry.ts`：`AUDIO_EDIT_RECORDING_CAPABILITIES` 的 import 一行与数组里一行
- `src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts`：只有 `insert_audio_edit_file` 描述末尾一句（“要用麦克风现录用 start_audio_edit_recording”）；`clean_audio_edit_retakes` 那一行的改动不是我的
- `electron/main/services/application-runtime/outputContract.test.ts`：音频编辑样例列表里加的 `undo_audio_edit`、`redo_audio_edit`，以及“音频编辑录音”那一段样例回执（两个 for 循环）；`includeDetails` 那两处不是我的
- `scripts/check-assistant-capabilities.cjs`：`ASSISTANT_BLIND_FEATURES.audioCapture` 一条说明
- `src/features/audioEdit/index.ts`：`audioEditPlayheadFrame`、`audioEditResumeFrame`、`prepareAudioEditTake`、`recordAudioEditStep` 的导出
- `src/features/audioEdit/application/audioEditSpliceService.ts`：两个 import 与 `audioEditPlayheadFrame`、`audioEditResumeFrame` 两个函数
- `src/features/audioEdit/workspace/AudioEditRecordingControls.tsx`（import 与取播放头那一行）、`AudioEditRecordingControls.test.tsx`（`audioEditSpliceService` 替身那一行）
- `src/features/audioEdit/workspace/AudioEditPanels.tsx`：`formatFrameRate` 的 import 与 XML 帧率两处文案
- `src/features/audioEdit/preview/useAudioEditPreview.ts`：`togglePlayback` 前新增的“别处叫停试听”订阅
- `src/features/videoEdit/application/videoEditFields.ts`：`render_cache.rendering` 的 `paused` 与说明里一句
- `resources/assistant-skills/video-edit-workbench/SKILL.md`：路由表“录屏”那一行
- `docs/rules/assistant-status.md`：顶部“2026-11-13（音频编辑录音接通助手……）”一条，与第三节“音频编辑录音与录屏长录读回已接通……”一条（替换原来两条欠账）
- `docs/task/界面统一/规格写法统一.md`：“别人目录里的待补清单”一节
