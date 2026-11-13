# 被录窗口关闭后录制卡死：结果（2026-11-13）

## 根因

证据：`E:\文档\HenjiAI\.system\logs\henji-2026-11-13.log` 第四轮的两次复现（10:16:55 会话 22944177、10:31:59 会话 8a786b8b），加一次本机实测。

1. **FFmpeg 那一侧没有出错。** 实测：用 gfxcapture 录记事本窗口，3 秒后关掉窗口。约 **67 ms** 后进程以**退出码 0** 结束，最后一次进度是 `progress=end`，stderr 里没有报错，生成的文件完整。所以窗口关闭对它来说就是采集源正常结束（EOF），与 OBS、WebRTC 的看法一致。
2. **主进程把“来源没了”当成了采集失败。** 第一个发现窗口没了的是事件采集的轮询，它以 120 Hz 调 `geometry()`。窗口没了，`DwmGetWindowAttribute` 就读不到边界，`createCaptureGeometry` 抛出“无法读取录制来源边界”，`RecordingEventSession.fail` 随即接到 `captureFailed`。这时 `session.failed = true`，控制状态记为 `failed`，后端被释放并收尾，会话存成 `interrupted`。日志里的通知写的是“录制意外停止”。另外，如果编码进程先退出，`GfxCaptureBackend.restart` 会对着已经不在的 hwnd 续录：硬件起不来，退回软件编码也起不来，最后同样报失败。
3. **失败之后谁也释放不了“当前录制”。** 同一次录制的状态分在三个地方：服务的 `active`、控制的 `active`、界面的 `capture`。
   - `captureFailed` 释放后，服务的 `active` 被置空，控制却还留着一个 `failed` 快照，要等人去关。
   - 界面只在 `stopped` 时收尾，`failed` 时 `capture` 一直留着，所以 `startRecording` 报“请先停止或取消当前录制”。
   - 这时按停止（10:17:12），控制会对着已经结束的会话把后端链从头再走一遍：写 endUs，再给界面发 `stop` 命令。界面回执时服务的 `active` 已经是 null，回执报“录制会话不存在”，被丢掉。20 秒后超时，报出“采集窗口未响应”。
   - 按取消（10:35:19）也一样：再走一遍释放，`cancel` 命令的回执同样路由不到，2 秒超时后报同一个错。
4. **“编码进程被杀后 2 秒续录”为什么不适用。** 那条路假设来源还在、只是编码中断。来源没了，重新起进程注定失败，失败后又落进上面那条失败路径。它在退出码与来源状态上没有分辨“来源结束”和“编码中断”。

## 改法

- **来源结束是正常结尾**
  - `windows-events.ts` 增加 `exists`（`IsWindow`）。
  - `geometry.ts` 增加 `createCaptureSourcePresence`：窗口看 IsWindow，显示器看 displayId 还在不在。
  - `createCaptureGeometry` 在录制中读不到边界时沿用上一次的边界，不再抛错。只有一开始就读不到时才报不支持。
- **编码进程**（`gfxcapture.ts`）：意外退出时，如果是 `progress=end` 加退出码 0，或者来源已经不在，就不续录。这一片按进度封口，然后报 `sourceEnded`。如果退出时来源还在、续录途中才没了，也按来源结束处理，不报失败。
- **服务**（`capture/service.ts`）
  - 每 500 ms 查一次来源还在不在，暂停中也查。来源没了就调 `sourceEnded`，记下说明“被录制的窗口已关闭 / 被录制的显示器已断开”，然后调 `recordingControl.sourceEnded`。
  - 释放（取消）只做一次，并缓存结果。之后再关控制条就直接用那次的结果，不再发命令白等超时。
  - 长录事实 `facts` 增加 `sourceEnded`，汇总日志也带上它。
- **控制**（`control.ts`）
  - 新增 `sourceEnded(sessionId, 'window'|'display')`：在快照里记下 `sourceEnded`，然后调 `command('stop')`，与用户按停止走同一条路。正在切换状态时等它做完再停；已经在停止、已停止或已失败时不处理。
  - 失败后停止直接返回。
  - 命令失败时立即释放后端。由此保证一条不变式：`failed` 表示采集已经释放，已录部分已经收尾保存。
- **界面**（`recordingService.ts`）
  - 跟随快照时记下 `sourceEnded`，收尾后用现有的 `notifyUser` 弹出提示“被录制的窗口已关闭，录制已保存”（中英文 i18n 都加了）。
  - 看到 `failed` 就放开“当前录制”（`finish(id, false)`）。已录部分主进程已经存为中断，可以导入。
  - 来源结束后再按停止，等那次收尾做完再返回，不报“已结束”。
- **助手**
  - 停止回执开头写“被录制的窗口已关闭，录制在那一刻自动停止（不是采集失败）”，后面接原来的导入说明。
  - 会话读回的 `details.capture.sourceEnded` 新增为可选字段，属于向后兼容的变化。
  - `phase` 照常是 `stopped`。
- 落盘格式没有动：capture.json 与 .hjrec 都没有新字段。

## 同类排查

| 情形 | 结论 |
|---|---|
| 被录窗口关闭（原生采集） | 已修。按停止收尾为 stopped，可以导入、合并，马上能开始新的录制 |
| 被录显示器拔掉 | 已修，走同一条路，因为 displayId 不在了。编码进程退出与巡检都能触发。没有真机验证 |
| 区域采集所在的显示器消失 | 已修，区域只是来源上的一个裁剪，判断的是同一个显示器在不在 |
| 被录显示器改分辨率 | 没有改。来源还在，不应结束录制。边界每次重新读，事件坐标跟着变；WGC 换尺寸时 gfxcapture 按 `resize_mode=scale_aspect` 缩放。**没有验证**，需要真机看画面有没有断 |
| 编码进程续录达到上限，或续录起不来 | 原本就记为失败并收尾保存。现在失败后“当前录制”马上放开，取消、关控制条不会再卡超时 |
| 其他失败（磁盘满、文档存不进、事件写盘失败、命令失败） | 都经 `captureFailed` 或命令失败释放后端，结果都是 `failed`。后端释放只做一次，界面看到 `failed` 就放开，停止直接返回，取消能解开 |
| 兼容采集（chromium）录窗口时窗口关闭 | 巡检同样会按停止收尾。如果界面那边先报轨道结束，就会走失败路径，但同样会放开。没有验证 |
| 窗口最小化 | 不算结束：IsWindow 仍为真，边界读不到时沿用上一次的 |
| 倒计时内窗口就关了 | 启动会失败，记为中断并放开，没有改成正常结束 |

## 改动文件

- `electron/main/services/screen-recording/windows-events.ts`
- `electron/main/services/screen-recording/capture/geometry.ts`
- `electron/main/services/screen-recording/capture/gfxcapture.ts`
- `electron/main/services/screen-recording/capture/service.ts`
- `electron/main/services/screen-recording/control.ts`
- `src/core/screenRecording/contracts.ts`（快照增加可选的 `sourceEnded`）
- `src/core/screenRecording/capture.ts`（长录事实增加可选的 `sourceEnded`）
- `src/features/screenRecording/application/recordingService.ts`
- `src/features/screenRecording/application/applicationDomain.ts`
- `src/features/screenRecording/application/recordingReflection.ts`
- `src/i18n/locales/zh-CN/ui.json`、`src/i18n/locales/en-US/ui.json`
- 测试：`electron/main/services/screen-recording/control.test.ts`、`capture/capture.test.ts`、`capture/service.test.ts`、`src/features/screenRecording/application/applicationDomain.test.ts`

## 验证

- `npx tsc -p tsconfig.electron.json --noEmit`（经 heavy.sh）：通过
- 渲染层 tsc（经 heavy.sh）：本次改到的文件没有类型错误，有一处别的任务的错误，见下方补记
- 改到的 14 个 ts 文件跑 eslint：通过
- 相关测试 4 个文件、40 项全部通过。新增的测试：
  - 进程报 `progress=end` 并以 0 退出：不续录、按进度封口、报来源结束。
  - 续录途中来源才没了：按来源结束处理，不报失败。
  - 服务层：来源结束后收尾为 stopped，读回写明原因，关闭后能再开一次。
  - 巡检在暂停中发现显示器没了：照样按停止收尾。
  - 续录达到上限：已录部分存成 failed（即中断），释放只做一次，第二次取消不发命令、立即返回。
  - 控制层：来源结束走停止、快照带上原因；失败后停止直接返回、后端已释放；停止失败的错误不吞掉。
  - 界面：来源结束后能马上开始下一段，助手回执写明原因；`failed` 后不用先恢复就能开始。
  - 原有测试“停止失败可重试”与新的不变式冲突（失败即已释放），已改为断言新行为。

## 需要真实窗口验证

正式构建，副屏：

1. 录单个窗口（记事本即可），带麦克风，录约 10 秒后关掉那个窗口。应看到：控制条在约 0.5 秒内消失，主窗口回来，弹出“被录制的窗口已关闭，录制已保存”；会话状态是 stopped，不是 interrupted；从录屏页开始的录制自动进剪辑，画面和声音时长对得上，事件里有光标；马上能开始新的录制。
2. 同上，但让助手开始录制，关窗口后再调 `stop_screen_recording`。回执应写“被录制的窗口已关闭…自动停止”，会话读回的 `details.capture.sourceEnded` 有值、`failure` 为 null。
3. 暂停中关掉被录窗口：同样按停止收尾。
4. 录副屏时拔掉副屏（或在系统设置里断开它）：应提示“被录制的显示器已断开，录制已保存”。
5. 录副屏时改它的分辨率：录制应继续，没有中断。这一项没有验证。
6. 用任务管理器连续杀编码进程，直到超过 1 分钟 5 次：应记为中断并保存，“当前录制”马上放开，取消不报“采集窗口未响应”。

## 审查后收紧（独立审查通过，没有重要问题；以下三处都是为了不把正常的长录悄悄停掉）

1. **显示器判定改为连续几次查不到才算没了。**
   - `geometry.ts` 的 `createCaptureSourcePresence` 改为返回 `{ present, misses }`：窗口 `misses=1`（IsWindow，一次就算），显示器 `misses=3`。
   - 服务的巡检每 500 ms 查一次，连续查不到的次数达到 `misses` 才结束。显示器要连续约 1.5 秒都查不到；休眠、KVM 切换、Win+P 改投影时那种短暂消失不会结束录制。
   - 编码进程那条路用 `captureSourceGone`：按 `misses` 每隔 500 ms 连续查，期间任何一次查到就算还在。
2. **编码进程只报了结尾不再直接结束。** 要“报了结尾（`progress=end`）**并且**确认来源没了”才按来源结束，其余一律续录。续录起不来时再确认一次来源，没了就按来源结束，还在就照常报失败。依赖项从 `sourceAvailable` 改为 `sourceGone(): Promise<boolean>`。
3. **用户已按停止、或停止失败时不说“窗口已关闭”。**
   - 控制的 `sourceEnded` 改为同步返回是否接手：停止中、已停止、已失败时返回 false。服务只在接手时才记原因，所以读回和回执都不会写来源关闭。
   - 来源关闭引发的停止如果本身失败，控制会清掉快照里的 `sourceEnded`，按失败呈现；读回的 `sourceEnded` 只在没失败时给出。
   - 界面只在 `phase === 'stopped'` 时才记来源原因和弹“录制已保存”；失败时由主进程照原样提示“录制意外停止，已保存…”。

补的测试：
- 显示器每三次巡检有一次查不到时不结束，连续查不到才结束。
- 控制已在停止中时不记原因（读回没有 `sourceEnded`）。
- 只报了结尾而来源还在时照常续录。
- 用户停止途中来源才没了时，控制不接手、不记原因。
- 来源关闭引发的停止失败时，状态为 failed 且不带来源原因。
- `capture.test.ts` 里原来用 `sourceAvailable: () => true` 断言结束的那条，改为在“确认来源没了”的前提下断言结束。

重跑（经 heavy.sh）：
- capture.test、control.test、service.test、applicationDomain.test 共 44 项通过。
- 主进程 tsc 通过。
- 改到的文件 eslint 通过。

## 补记

- 渲染层 tsc（经 heavy.sh）：只报 1 处错误，`electron/main/services/db.ts(6,61)` 从 `./db-recovery` 导入的 `snapshotDatabase` 不存在。这不是本次改动的文件，像是同一工作区里另一个任务正在改。本次改到的文件没有类型错误。主进程 tsc 早先跑时通过。
