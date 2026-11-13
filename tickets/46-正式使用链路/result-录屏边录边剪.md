# 录屏边录边剪 · 结果（第一、二阶段 + 审查返工）

日期：2026-11-13。未碰 git，未启动/重启应用，未打包。

## 审查返工（逐条）

1. **录屏轨改为按来源认**（`src/core/videoEdit/recordingLane.ts`）：录屏画面 = 视频片段且素材带 `recordingCursor`（录屏导入给每个录屏画面素材写的指针记录，比轨名可靠：用户能改轨名、能在“屏幕”轨上放别的东西）。录屏轨 = 放着录屏画面的那条视频轨；还没有录屏画面时 `track` 为空，第一段由导入找空轨或新建“屏幕”轨。多条轨放着录屏、或录屏轨上混着别的片段时 `lane.problem` 给出用户语言的原因：录制样子把录屏轨换成 `UiError` 提示加“切到剪辑”，开始录制禁用；`videoEditRecordingTarget` / `settleVideoEditRecordingTake` 抛出该原因，助手入口转成未执行拒绝，导入时只进素材库并在回执里说明。覆盖不再对整轨 Lift：只在两端切开“被盖住的录屏块及其链接片段”（切出的右半截也算），再删掉落在范围内的那些，同一条轨上别的素材、别的轨道一概不碰；新一段的声音轨在这段范围里有非本录屏的片段时不沿用，由导入另起一条。补测试：V1 背景、V2 录屏、上面文字层与配乐、麦克风轨上用户自己的口播，覆盖后这些片段逐字段不变，新段麦克风另起一轨；多候选、混放都拒绝。
2. **录制样子快捷键与菜单白名单**（`application/videoEditRecordLayoutCommands.ts`，快捷键与菜单共用）：只认播放类、逐帧、上一段 / 下一段、首尾、撤销重做；切开 → `splitVideoEditRecordingAtPlayhead`，Delete / 波纹删除 → `deleteVideoEditRecordingBlock`（与按钮同一条路）；其余命令不响应，菜单里禁用并写原因；固定作用域的批注、预渲染分组在录制样子里禁用；录制中一律禁用。“视图 > 录制样子 / 剪辑样子”录制中禁用并写原因，`setVideoEditLayout` 录制中也拒绝；进入录制样子清掉片段选择。补菜单测试（录制中各命令与样子切换不可用、不执行）。
3. **助手 overwrite 必须写位置**：`destination` 新增 `seconds`（作品时间秒，按序列帧率换帧），与 `frame` 二选一；`placement=overwrite` 缺位置以参数错误拒绝，`placement` 缺 `sequenceId` 拒绝，录屏轨认不出拒绝；`end` 与 `overwrite` 各会发生什么写进了参数说明与助手技能。界面自己传当前指针。
4. **回执如实**：`importRecordingToVideo` 返回 `placement`（`mode`、实际 `from`/`to`、被盖住的块名与各自范围、落点变更说明；或 `refused` 原因）。停止回执与 `import_screen_recording` 回执都用 `recordingPlacementText` 按它写，`end` 不再写“第 0 帧起”。停止结果里不再混入开始时请求的放置方式与指纹。界面停止后按实际落点移指针，落点变更或没放进序列时弹提示。
- 小项：
  - 录制期间录屏轨被改过：开始时记录录屏轨指纹 `basis`（随 destination 进主进程代管的 followUp，只在内存），停止时对不上就不覆盖、改为接在末尾，回执说明。
  - 分段导入：`packVideoEditRecordingTake` 让各段首尾相连，块名“会话名（1）（2）…”。
  - 同步锁定拦下：波纹删除 / 修剪的报错换成录制样子里读得懂的说明。
  - 暗红配色：挪到 `src/index.css` 的 `--clip-recording` / `--clip-recording-title` 与 Tailwind `bg-clip-recording` / `bg-clip-recording-title`，删掉组件侧的混色函数。
  - 录制设置：`useRecordingSetupState` 改为模块级唯一状态源（`useSyncExternalStore`），两处读写同一份、只从这里存盘；没有界面在用时丢掉内存副本，下次从存盘重读。
- 已知限制：录屏画面按 `recordingCursor` 认。录制会话没有事件页（理论上不该出现）时导入不写这个标记，那一段在录制样子里会被当成“混着别的片段”而拒绝，并提示去剪辑里整理，不会被误切。

## 现成能力（复用，没有写第二份）

| 需要 | 复用的现成实现 |
|---|---|
| 覆盖放置 | `src/core/videoEdit/timelineEdits.ts` 的按片段 `split` 与非波纹 `delete`：只切被盖住的录屏块和它的链接片段，链接关系按 PR 规则分开，附着内容随片段处理 |
| 切开 / 波纹删除 / 波纹修剪 | 同文件的 `split`、`delete ripple`、`trim mode=ripple`；拖动走 `beginVideoEditTimelineDrag` / `previewVideoEditTimelineTrim` / `finishVideoEditTimelineTrim`（预览与松手同一份编辑、一步撤销） |
| 改名 | `updateVideoEditClipProperties(…, { name })`（效果控件改名同一入口）；助手侧就是片段 `name` 的通用属性写入 |
| 撤销 | 剪辑文档历史；录制落片在 `importVideoEditSources` 的同一个变换里，一步撤销 |
| 节目画面 | `VideoEditPreview`（加 `chrome="picture"` 只要画面，播放、声音、渲染、出错提示都不变） |
| 块的绘制 | `clipLabelSurface.ts`（底色、名条、`TIMELINE_SELECTED_RING_CLASS`）、`VideoEditClipFilmstrip`、`VideoEditClipWaveform`（现有缩略帧与多级波形取数） |
| 播放控制 | 剪辑命令 `play_pause`、`go_prev_edit`、`go_next_edit` 与 `timelineCommandPresentation`；主时间码 `VideoEditTimecode primary`；标尺上的播放头 `VideoEditTimelinePlayheadHead` |
| 命令带 / 分段 / 底栏 / 表单 | `UiToolbar variant="command"`（左端注入项目菜单）、`UiSegmented`、`UiToolbar variant="footer" tools`、`UiGroup` + `UiFormRow density="compact"`、`PanelTrigger` |
| 录制设置与状态 | 录屏页的设置状态抽成 `useRecordingSetupState`（两边共用同一份偏好）；`RecordingSoundRows` / `RecordingPictureRows` 从 `RecordingSetupPanel` 抽出两边共用；来源选择用 `RecordingSourcePicker`；录制控制 `startRecording` / `controlRecording` / `recordingView` |
| 停止后放进序列 | `importRecordingToVideo` → `placeCombinedRecording` / `placeRecordingMedia`（另一位子代理刚合入的“一次录制一个画面素材”） |
| 菜单 | `contributeAppMenus` |
| 斜纹 | 仿 `.ui-hatch-locked` 加 `.ui-hatch-cover`（加了渐隐遮罩） |

## 做法

1. **操作（剪辑领域，纯函数）** `src/core/videoEdit/recordingLane.ts`
   - `videoEditRecordingLane(sequence)`：录屏轨按来源认（见上文返工第 1 条）；每块 = 录屏画面片段 + 同 `linkId` 的声音/摄像头。
   - `videoEditRecordingTarget(sequence, { at: 'end' } | { at: 'frame', frame })`：落点与模式（指针在末尾或之后 = 接在末尾；在某段上 = 覆盖），以及沿用录屏轨已有的轨道（按 `VIDEO_EDIT_RECORDING_TRACK_NAMES` 轨名认麦克风、系统声音、摄像头）。
   - `settleVideoEditRecordingTake(document, sequenceId, takeClipIds)`：新一段已放好后，只切被盖住的录屏块与它们的链接片段，没盖到的原地不动，返回新文档与实际落点、被盖住的块。不改原文档。
   - 轨名常量 `VIDEO_EDIT_RECORDING_TRACK_NAMES` 现在是唯一来源，录制导入改用它（删掉了导入里那份副本）。
2. **剪辑应用层** `src/features/videoEdit/application/videoEditRecordingLane.ts`：选块（连同链接声音）、指针处切开、波纹删除、改名、按指针算落点、`placeVideoEditRecordingTake`（落定 + 日志）。`videoEditService.ts` 加视图状态 `layout`（`setVideoEditLayout` / `videoEditLayout`，不进文档）。
3. **界面** `src/features/videoEdit/recording/`：`ProjectRecordingView`（命令带右端录制控制、画面、右侧设置与“这一段”、菜单）、`ProjectRecordingLane`（播放控制 44、标尺 28、录屏轨 92、底栏 32）、`projectRecordingGeometry.ts`。剪辑工作区 `VideoEditApp` 按 `layout` 二选一渲染（录制样子懒加载），“录制 / 剪辑”分段在两种样子的命令带中间。正在录的暗红块颜色走 `clipLabelSurface.ts` 的 `videoEditRecordingClipSurface`（危险色令牌与面板底混色），不在组件里写色值。
4. **接线（第二阶段，已做）**
   - `RecordingDestination` 与主进程代管的 `captureFollowUpSchema.destination` 加可选 `placement: 'end' | 'overwrite'`。
   - `recordingVideoImport.ts`：有 `placement` 时，在导入那一刻按录屏轨重新定落点与轨道（`recordingTrackIndices` 新增 `preferred` 优先用录屏轨已有轨道），放好后把画面片段改名为会话名，再在同一个编辑变换里调用 `placeVideoEditRecordingTake` 落定。没有 `placement` 时行为不变。
   - 助手：`start_screen_recording` / `import_screen_recording` 的 `destination` 加可选 `placement`；`overwrite` 省略 `frame` 时用这条序列当前指针（序列没打开就拒绝并说明）；`placement` 缺 `sequenceId` 时拒绝。录制样子的界面也走这同一个 destination。助手技能 `video-edit-workbench/references/screen-recording.md` 补了用法。
   - 改名、写名称：已能用片段 `name` 的通用属性写入完成，没有新增能力。
5. **日志**：`video_edit.record_layout.entered/left`（features.videoEdit）、`recording.project.start` / `recording.project.start_failed`（features.videoEdit.recordLayout）、`video_edit.recording_take.placed` / `video_edit.recording_take.failed`（features.videoEdit.recordingLane）。
6. **菜单与快捷键**：“视图”菜单“录制样子 / 剪辑样子”（与分段同一份操作）；录制样子显示时多一个“录制”菜单（开始/从指针处开始、暂停或继续、停止，暂停与停止显示全局录制快捷键）。录制样子里剪辑快捷键按时间线作用域，Delete 改为波纹删除；录制中不响应剪辑快捷键。

## 改动文件

新增
- `src/core/videoEdit/recordingLane.ts`、`src/core/videoEdit/recordingLane.test.ts`
- `src/features/videoEdit/application/videoEditRecordingLane.ts`、`application/videoEditRecordLayoutCommands.ts`
- `src/features/videoEdit/recording/ProjectRecordingView.tsx`、`ProjectRecordingLane.tsx`、`projectRecordingGeometry.ts`
- `src/features/screenRecording/useRecordingSetupState.ts`

修改
- `src/features/videoEdit/VideoEditApp.tsx`、`VideoEditAppMenus.tsx`、`VideoEditAppMenus.test.tsx`（mock 补新函数）、`VideoEditPreview.tsx`、`index.ts`、`application/videoEditService.ts`、`timeline/clipLabelSurface.ts`
- `src/features/screenRecording/ScreenRecordingApp.tsx`、`RecordingSetupPanel.tsx`、`index.ts`、`application/recordingService.ts`、`application/recordingVideoImport.ts`、`application/applicationDomain.ts`、`application/recordingVideoImportTracks.test.ts`
- `src/core/screenRecording/capture.ts`、`src/core/application-control/domains/screenRecording/recordingCapabilities.ts`
- `src/index.css`（`.ui-hatch-cover`、`--clip-recording*`）、`tailwind.config.js`（`clip.recording*` 颜色）
- `resources/assistant-skills/video-edit-workbench/references/screen-recording.md`
- `docs/task/界面样板屏/录屏边录边剪/设计说明.md`（末尾“偏离与补充”）

工作区里另有不是我改的：`src/features/videoEdit/application/applicationDomain.ts`、`src/core/theme/__snapshots__/themeEngine.test.ts.snap`、`resources/assistant-skills/video-edit-code-creation/references/author-text-motion.md`，暂存时别带上。

## 契约与落盘格式

- 落盘格式：**没动**（剪辑、录制会话都没加字段）。`captureFollowUpSchema` 只在主进程内存里，不落盘。
- 对外契约：`start_screen_recording` / `import_screen_recording` 的 `destination` 新增可选 `placement`，向后兼容。

## 验证（L2：跨渲染层与 core 共享契约；返工后重跑）

- `recordingLane.test.ts` 8 例：末尾追加、中段覆盖（右半截源时间接续、回报盖住的块与范围）、跨多段 / 覆盖到结尾之后、结尾之后按末尾 / 没录麦克风时被盖住那段的麦克风也切、背景 + 录屏 + 文字层 + 配乐 + 用户口播覆盖后其余逐字段不变、多候选与混放拒绝、空序列与不改原文档、分段首尾相连。
- `recordingVideoImportTracks.test.ts`（含录屏轨导入一例）、`recordingVideoImport.test.ts`、`screenRecording/application/applicationDomain.test.ts`、`electron/main/services/application-runtime/outputContract.test.ts`、`VideoEditAppMenus.test.tsx`（新增录制中禁用一例）、`ScreenRecordingApp.test.tsx` 全过。
- 渲染层 tsc（heavy.sh）、主进程 tsc 通过；改动文件 eslint 0 问题；`check:surface`（错误 0，告警 350 与改前同）、`check:colors`、`check:ui-residue` 通过；`check:ui-design` 本次文件无命中；`check:dependency-graph` 无本次相关项（剩余 7 条是别人文件的跨 feature 非 index 导入：audioEdit→documents、canvas→cameraStage/navigation、imageEdit→navigation/generation、toolbox→navigation、videoEditInPlaceCapability→generation）。
- 未跑：真实窗口、Reality（另一位在用真实窗口验证）。

## 真实窗口并排核对（对照 `录屏边录边剪草稿.html?s=1..4`）

准备：开一个项目，新建一条序列，命令带中间点“录制”（或“视图 > 录制样子”），窗口 1440×900。
1. **① 准备录下一段**：录三段（每段几十秒），指针拖到结尾。看：结尾虚线“＋ 接在这里”，画面是所选屏幕的预览（角上“屏幕 N 实时画面”），右侧只有“录制”一组，右上“开始录制”是唯一蓝色，底栏“3 段 · 总长 …”。
2. **② 录制中**：在结尾点开始录制。看：暗红块从结尾长出、右缘一条红线跟着走，命令带右端换成红点计时、暂停、红色实底“停止”；播放、剪刀、删除、撤销重做、“录制/剪辑”禁用，设置整组压暗。中途暂停再继续，停止后仍是一块，指针停在新块结尾。
3. **③ 回看并整理**：指针拖到第二段中间、点第二段。看：画面是那一处录下的画面（角上“段名 时间”），选中块提亮加一圈细线，右侧出现“这一段”（名称、时长）；鼠标移到“开始录制”上，指针后出现渐隐斜纹，提示“从指针处开始，盖住后面的内容”。试剪刀、删除（后面接上）、拖两端、双击改名、Ctrl+Z。
4. **④ 从中间重录**：在第二段中间开始录制录几秒再停。看：暗红块压在原内容上；停止后没盖到的后半截与后面的段原地不动、无空隙；切到“剪辑”看到常规的视频轨加音频轨，新段在同一组 V1/A1/A2 上；撤销一步恢复。
5. 窗口拉窄到 1180 以下：右侧设置收成命令带的“录制设置”按钮，画面变矮，录屏轨与播放控制不变。

## 没做的与原因

- **“这一段”的描述**：片段上没有现成的备注字段（批注是给助手的修改任务，标记名是另一回事，`text` 是文字片段内容），加字段要把剪辑内容（77→78）、录制会话（80→81，内嵌剪辑 schema）、字幕清单等一起升版本、写迁移和黄金样本。按“优先不动”这一轮没做，界面上不显示描述。若要做，建议片段加可选 `note`，按 persistence.md 走一遍。
- **画面实时预览**是每 2 秒一张来源缩略图，不是视频流；真流需要主进程的显示媒体请求处理，没在这一轮做。
- **录制样子给助手的入口**：样子本身只是视图，没登记成助手可写属性；助手要边录边剪用 `start_screen_recording` 的 `placement` 即可，读回走通用实体读取。
- 剪辑样子命令带上原有的“录制”图标（跳去工具录屏页）没改成切到录制样子，等你定。

## 第三轮（真实窗口验证后的修正）

- **录制中撤销可点（E-2）的根因**：按钮靠“这份剪辑有没有登记‘屏幕录制’长任务”判断，但登记与结束长任务时不通知界面，命令带停在开始前的状态（覆盖录制时恰好有别的发布才显得正常）。修法：`holdVideoEditActivity` 登记与结束都发布一次；`undoVideoEdit` / `undoVideoEditWorkspace` 在录制样子录制中直接拒绝（按钮、快捷键、菜单、其他调用都过这里）。同一原因也让“录制 / 剪辑”切换在录制中没显示成禁用，一并修好。
- **同类入口排查**（录制中还能改时间线的地方）：
  - 录屏轨的块（选择、修剪、双击改名）原先只认“这一屏自己开始的录制”，助手开始的录制不拦，现改为按长任务判断。
  - “这一段”的名称录制中禁用。
  - 录制样子的画面原先仍可在画面上选中拖动片段、编辑文字 / 遮罩 / 跟踪 / 批注 / 代码元素，还能拖入素材，现改为只看。
  - 快捷键、菜单已由白名单挡住。
  - 助手能力不在此列（有指纹保护）。
- **外观**：录制中不画指针，正在录的块右缘红线不再被盖住；帧率分段写“30 / 60”；暗红块无波形记入设计说明。
- **窄窗口收纳复核（< 1180）**：没有真实窗口证据，只读代码核对过。
  - 右侧设置不渲染，改为命令带右端“录制设置”按钮；弹出的是同一组设置，`compact` 浮层宽 288–384，标签列 72，不裁切。
  - 画面区 `flex-1 min-h-0` 随窗口压矮。960×640 时还剩约 356 高。
  - 录屏轨 + 播放控制 + 底栏固定 198 高，不收；底栏工具按规则收进“更多”。
  - 命令带左端序列名与项目名可截断；录制中右端是计时、暂停、停止，不放设置按钮（录制中设置本来就不可改）。
- **测试**：`recordingVideoImportTracks.test.ts` 新增一例：录制样子录制中撤销与重做都拒绝、上一段保留，登记与结束长任务都会通知界面，结束后撤销恢复正常。
- **验证**：
  - 相关测试全过：录屏轨、导入两份、录屏 `applicationDomain`、菜单、录屏页，共 35 例。
  - 渲染层 tsc（heavy.sh）、改动文件 eslint、`check:surface` 通过。

## 第五轮

- **V1 名条被上方一行盖住**：不是本批改动引起的。
  - 盖住名条的那一行是“Z1 缩放”（录屏片段的自动缩放轨）。本批改过的 `clipLabelSurface.ts`、`index.css`、`VideoEditPreview.tsx`、`VideoEditApp.tsx` 都没碰时间线布局；当天别的提交也没动时间线几何。
  - 根因在 `src/features/videoEdit/timeline/timelineGeometry.ts` 的 `timelineLayout`（第 70–90 行）。
    - 视频区顶上钉着字幕行与缩放行：`sticky` = 28，加上缩放行再 +24。
    - 视频轨从视频区底边往上排（`let bottom = video.top + video.height + video.scroll`），初始滚动是 0，片段只按 `clipTop = video.top + sticky` 裁切。
    - 视频区矮到放不下“钉住的行 + 视频轨”时，最上面那条视频轨（这里是 V1）的上半截就落在钉住的行下面，名条被盖住。
  - 引入的提交：`fea0649b4`（10-13，字幕行钉在视频区顶上）与 `c86a7d0f6`（10-15，加了缩放行，`timelineGeometry.ts:71` 把 `sticky` 加到 52）。录屏片段才带缩放效果，所以现在录屏多了才常见。
  - 按要求只报告，没改。
- **“被录制的窗口已关闭，录制已保存”提示**
  - 调用路径是通的：主进程 `sourceEnded` → 快照 `phase=stopped` 且带 `sourceEnded` → `recordingService.follow` 记下 → `finish` 里 `notifyUser`，经 `notificationEvents` 交给全局 `NotificationProvider`（与窗口位置无关）。
  - 问题在时机：原先在导入剪辑之后才发。录屏页“录完进剪辑”与录制样子都要先导入（长录几十秒），提示要等到导入完、切页之后才出现，容易被错过。
  - 已改为：会话封存、`closeRecordingControl` 把主窗口从最小化恢复之后立即发，不等导入。控制条状态下主窗口是最小化的，恢复发生在 close 里，所以提示出现时窗口已经可见。
  - 没有真实窗口证据，需要你再看一次。
- **验证**：录屏 `applicationDomain`、录屏页、导入轨道测试共 16 例通过；渲染层 tsc、`recordingService.ts` eslint 通过；`check:surface` 通过（错误 0）。
