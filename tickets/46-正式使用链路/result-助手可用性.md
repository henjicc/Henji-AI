# 结果：主链路助手可用性补齐（2026-11-13）

> 对应 `排查-助手可用性.md` 的 B1、A3、B2、C1–C3、C5、C6 与台账一项。没有碰 git、没有启动开发版、没有跑 assistant:cli 或付费调用。

## 一、每条怎么改的

### B1 待确认线索补字段
- `audioEditFields.ts` 给 `audio_edit.suggestion` 追加只读属性（追加在原有五项之后，不重排）：
  - 数据里已有的：`kind`（retake / filler / long_silence）、`confidence`（high / medium / low）、`start_frame`、`end_frame`、`sample_rate`、`block_ids`。
  - 读取时由词块现算、不落盘的：`removed_text`（block_ids 原样拼接）、`kept_text`（紧接其后、还保留着的一段，取到句读为止且至少与被删段一样长，重念时通常就是重来的那一遍）、`before_text`（前面保留着的一句）、`after_text`（kept_text 之后的一句）。上下文只取当前还听得到的词，单侧最多 60 字；按作品对象缓存，作品一变自然失效。
- 命名与设计文档 8.1 一致（removed_text、kept_text、before_text、after_text）。8.1 规划的 `restart_block_id`、`options`、`reason`、`score`、`audience` 没有登记，那几项要落盘新字段，等粗剪那边在 `types.ts` / `schema.ts` 加好后，直接在 `AUDIO_EDIT_FIELDS[E.suggestion]` 末尾追加即可，不需要改已有项。
- 回执（`retakeReviewText`）、`clean_audio_edit_retakes` 描述与 `block_ids` 说明：按 `kind=retake、current_state=available` 筛并带上这些属性；**整条接受直接写 `status=applied`**（`applyAudioEditSuggestion` 同时删词并补上接缝处的停顿剪切 `withRetakePauseCuts`），驳回写 `dismissed`；只想删其中一部分时才逐个改词块 `included`。不能先改 included 再写 status：词块一删，线索就判为 removed，再写 status 会被拒，也会漏掉停顿剪切（审查第 1 条）。

### A3 音频编辑的算法操作能单步撤销
- 新增能力 `undo_audio_edit`、`redo_audio_edit`（documentRef + undoRef），追加在音频编辑能力列表末尾。
- 取舍：剪辑的 `undo_video_edit` 是“撤最近一步，不管是谁做的”。音频编辑这边要求“只撤助手自己那一步、不动用户手改”，所以改成按回执撤：
  - 去重念、快速处理、呼吸、停顿、语气词、字幕整理、响度匹配、口水音检测、插入、修复、全部还原这些操作完成后，若恰好形成一步，回执带 `undoRef`（`AUDIO_EDIT_UNDOABLE_OPERATIONS`）。
  - 撤销调用的是界面同一个撤销栈（`undoAudioEditProject`），撤完立即保存并回读核对；之后可 `redo_audio_edit` 恢复，重做后还能再撤。
  - 每次按内容判断这一步此刻在栈里的位置：生效且在栈顶才撤；已撤销且在重做栈顶才重做（用户在界面先撤了也能用 redo 恢复）。拒绝的原因分开说：已经撤销了（可能是用户按了撤销）、这一步现在生效不需要重做、保存冲突后重新载入过历史已清空、之后又有修改（可能是用户手改）、口播关掉重开过、引用不属于这份口播；都在写入前失败、记为未执行。
  - 回执引用只在本次运行内有效（最多记最近 256 步），口播关闭时（`subscribeAudioEditProjectDisposal`）清掉这份口播的登记，不留作品快照。
- 新文件 `src/features/audioEdit/application/audioEditStepUndo.ts` 持有回执登记，业务仍走 `audioEditProjectInstances.ts` 的撤销。
- 账本 `audioEditStoreLedger.ts`：界面 `undo`/`redo` 原来记成“绑定全部可写属性”（账面成立、实际撤不掉算法操作），改为绑定这两个能力。
- 通用撤销核对：`change_application_entities` 返回的 undoRef 经 `undo_application_changes` 在音频编辑上可用（`audioEditReflectionResult.test.ts` 已有两条结果测试：撤销恢复内容和锁并保存；与手工历史共存、不抹去之前的手改），不用补。两者分工写进了 `undo_audio_edit` 的描述。
- 相关描述更新：`reset_audio_edit` 指向 undo_audio_edit；快速处理回执“可用回执的 undoRef 整批撤销”。

### B2 转写说明与可重提状态
- `transcribe_audio_edit` 描述补清：会一直等到转写完成并保存才返回（最长约 10 分钟）；等不到只是不再等，转写照常进行，用 `query_audio_edit_tasks` 查、completed 后读词块；已有转写不再识别；超上传上限时不上传不收费，省略 modelId 让应用自动选长音频模型重试，只配了短音频模型就请用户配置长音频模型；中断或失败后看 resubmission。
- `modelId` 补 describe：通常省略（自动选已配置供应商里的长音频模型，与界面“开始转写”同一路径，核对过 `resolveTimestampedLocalAsr`）；要指定时取设置项 `transcription.default_model` 的可选值（auto 除外）。没有在描述里列模型 ID：列表来自 SDK 目录，能力声明模块不引 SDK。
- 状态读回：`query_audio_edit_tasks` 里这份口播最近一次转写带 `resubmission`：
  - `allowed` 没有计费，可以重新转写；`resume` 已交给识别服务或已拿到结果，再调只续查或取回、不重复计费；`blocked` 无法确认是否已计费、或素材已变化，不会再提交；`running_elsewhere` 助手命令行（无窗口运行的助手，另一个进程）正在转写。同一应用的多个窗口共用一个主进程，不会得到它。
  - 判断写在主进程 `asr.ts` 的 `transcriptionResubmission`，与 `preflightAudioEditTranscription` / `transcribeAudioEditProject` 的拒绝条件同源（同一个 `timestampedAsrNeverSubmitted`、同一份回执，并比对回执里的素材摘要与当前素材）；IPC `audioEdit:tasks:list` 改为返回 `listAudioEditTaskStatuses`。
  - 类型 `AudioEditTaskStatus` 与取值放在 `src/core/application-control/domains/audioEdit/audioEditTaskStatus.ts`（`src/core/audioEdit/types.ts` 正被别人改，没有动），平台接口与 preload 声明只改返回类型。
- 中断文案 `task-store.ts`：“上次处理已中断。转写不会自动重新提交。”改为“上次处理已中断。”，能否重提由 resubmission 说明。
- 没改：`asrCatalog.ts` 的超上限提示（在 `src/core/audioEdit/**`，见第五节）。

### C1–C3 过时的技能与说明
- `video-edit-workbench/references/cross-workspace.md`：口播那一行改为“剪切、恢复后剪辑里的声音、片段长度和字幕跟着更新（规则逐条写明；跨多个片段、变速或倒放片段上的字幕仍只对回参考并标时间待复核），改字、改分段不同步，剪辑改字幕不写回”；新增一段说明何时更新（停改约 5 秒、切回剪辑、开始播放、导出前）、`send_video_edit_clip_to_audio_edit` 立即更新、去 `video_edit.document.audio_link_notices` 读等待/失败/截短/移除、一次更新是一步撤销。原地生成第 1 步补“`list_generation_history` 可按关键词、模型、类型、时间筛”。
- `captions.md` 第 0 条：改为字幕文字与分段在剪辑定稿、互不同步，但剪切与恢复后字幕跟着声音更新（指向跨工作区）。
- `rhythm.md` 多机位：补读 `video_edit.sequence.multicam_playback`，may_stutter 时对 mediaWithoutProxy 逐个 `generate_video_edit_proxy`、读 `proxy_state`。为守住单篇 8 KB 上限，同篇几句原有措辞做了等义压缩（意思不变）。
- `deliver.md`：内置预设帧率跟随序列、投稿类默认高画质、母版为 H.265、80 Mbps 指定码率（要视觉无损用 quality=visually_lossless）；导出前先等链接口播更新、没更新上 notice 带提示；新增“播放与预渲染”一条（自动预渲染何时进行、何时让出、手动用 `render_video_edit_preview`、导出默认不复用预览）。
- 能力与属性说明：`format_audio_edit_subtitles`、`audio_edit.caption.text` 里“剪辑字幕不随此处更新”改为“改字、改分段不同步，剪切与恢复会让剪辑字幕跟着声音更新”；`video_edit.document.audioLinkNotices` 的 schema 说明补“等待更新、更新失败（稍后自动重试）”（C2）；`trash_document` 补“有进行中的任务或正在打开、关闭的也会被拒绝”（C6，核对过 faef59195 的判断）。
- 逐项核对过、没有不一致所以没改的：剪辑技能里没有提到 `audio_edit.document.cuts`（口播单条切点只在音频编辑技能里，见第五节）；生成历史筛选在 `list_generation_history` 描述与参数里已齐（生成排障技能还没对智能体开放）。

### C5 录屏技能文档
- 新增 `resources/assistant-skills/video-edit-workbench/references/screen-recording.md`：开始前（选来源与设备、参数显式给、声音轨、麦克风与音频编辑录音不同时开、绑定剪辑目标）、录制中（phase / elapsed_ms / details、暂停继续、标记、停止时等不到结果先读 phase 不重发、中止）、中断后恢复、录完进剪辑（导入、一键成片、理解、敏感文字）、鼠标键盘事件怎么用（注意力推近、光标与窗口跟踪、按标记找段落）、长录注意。
- 取舍：放进 video-edit-workbench 作为参考，而不是新建独立技能。原因：技能索引在首轮提示里，内置索引预算守在 3000 字节以内（现约 2.85 KB），新技能的说明一加就会超，而且那部分正被 DeepSeek 适配与缓存优化在调；录屏的产物本来就落在剪辑。入口的 description 加了“录屏并放进剪辑”，路由表加一行。只写了现在稳定的行为：分辨率、帧率、声音按用户要求显式给，不写省略时的默认值；系统声来源、长录事实读回都没写。
- 接入方式：参考文件随正式技能注册表自动发现；`electron/main/services/embedded-agent/skills.test.ts` 里钉着该技能的参考清单，补了一项（只改测试里的清单与标题里的“七份”）。
- 技能篇幅上限（协调方决定）：按需加载的技能正文与参考去掉逐技能的字节数（4000、4500、6144、8 KB、10 KB、16 KB），统一为只防事故的 64 KB，注释写明理由（按需加载一次、拆分按主题相关性不按字节）；常驻的技能索引保留预算，放到 6000 字节，注释写明属于常驻前缀、总量由 payload-audit 总账把关。改在 `electron/main/services/embedded-agent/skills.test.ts`、`src/core/application-control/domains/assistantSkill/{videoEditWorkbenchSkill,imageEditWorkbenchSkill}.test.ts`。docs/rules 与技能编写规范里没有写这些字节数的地方。`author-text-motion.md` 保持原文未动。

### 台账
- `docs/rules/assistant-status.md` 顶部加 11-13 一条（含“推翻：界面撤销绑定全部可写属性只是账面成立”）；第三节新增“主链路上助手还走不通或没走过的”：音频编辑录音无助手能力、录屏默认值与长录事实读回、并如实写明主链路自 10-25 之后的改动尚未由真实助手走过。

## 二、改动文件
- `src/features/audioEdit/application/audioEditFields.ts`
- `src/features/audioEdit/application/audioEditStepUndo.ts`（新）
- `src/features/audioEdit/application/audioEditAssistantSteps.test.ts`（新）
- `src/features/audioEdit/application/registerAudioEditCapabilityHandlers.ts`
- `src/features/audioEdit/application/audioEditStoreLedger.ts`
- `src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts`
- `src/core/application-control/domains/audioEdit/audioEditTaskStatus.ts`（新）
- `src/core/application-control/domains/documents/documentsApplicationCapabilities.ts`
- `src/features/videoEdit/application/videoEditFields.ts`（只改 audioLinkNotices 一句说明）
- `src/platform/contracts/audioEdit.ts`、`electron/preload/api-media.d.ts`（只改 listTasks 返回类型）
- `electron/main/services/audio-edit/asr.ts`、`asr.test.ts`、`task-store.ts`、`electron/main/ipc/audio.ts`
- `electron/main/services/embedded-agent/skills.test.ts`（参考清单加一项）
- `resources/assistant-skills/video-edit-workbench/SKILL.md`、`references/{cross-workspace,captions,rhythm,deliver}.md`、`references/screen-recording.md`（新）
- `docs/rules/assistant-status.md`
- 本文件

能力与属性的登记顺序：全部追加在同类末尾，没有重排已有项。输出 schema 末尾多了可选的 `undoRef`、任务项末尾多了可选的 `resubmission`，输入多了可选的 `undoRef`（只有撤销、重做两个能力取用）。

## 三、检查与测试
（审查返工后重跑）`audioEditAssistantSteps.test.ts` 5 项通过，新增“筛出线索 → 写 status=applied → 读回词块与两段接缝停顿剪切、线索变 removed”与“用户已在界面撤销：undo 说明已撤销、redo 恢复、再 redo 说明不需要”；`asr.test.ts` 15 项通过（新增素材变化判 blocked）；`skills.test.ts` 全过（含原先超限的那项）；`videoEditWorkbenchSkill`、`imageEditWorkbenchSkill`、`videoEditCodeCreationSkill`、`audioEditReflectionResult`、`storeActionCoverage`、`task-store` 通过；`check:application-control-coverage` 15 项通过；改动文件 ESLint 通过。以下为第一轮记录：

- `npm run check:application-control-coverage`：15 项通过。
- `npm run check:assistant-capabilities`：结构检查只报 `resultSelection.ts` 未建账（既有问题）；因它中断了后续链，单独跑 `check:application-control-invariants`：31 个文件 251 项通过。
- 新测试 `audioEditAssistantSteps.test.ts` 3 项通过：线索按 kind=retake、confidence=low 筛出，读回类型、把握、起止帧、采样率、词块与四段文字，删掉前一句后前文跟着变；按回执撤销自己那一步并保存、之前的手改保留、重做后可再撤；之后用户手改时拒绝撤销（未执行）、手改与保存内容不变、伪造引用给出原因。
- `asr.test.ts` 新增 1 项（共 15 项通过）：上传阶段取消 allowed、交给识别服务时中断 blocked、有供应商任务号 resume、另一进程在跑 running_elsewhere、心跳停了的未计费记录 allowed、已完成不标。
- 相关测试通过：`storeActionCoverage.test.ts`、`collectionCoverage.test.ts`、`audioEditReflectionResult.test.ts`、`audioEditWorkbenchSkill.test.ts`、`videoEditWorkbenchSkill.test.ts`（工具名、实体与属性 ID、篇幅上限都过）、`task-store.test.ts`、`toolCatalog.test.ts`、`externalCapabilityInventory.test.ts`。
- `electron/main/services/embedded-agent/skills.test.ts`：第一轮剩一项既有失败（`author-text-motion.md` 超 10240 上限）；返工后按协调方决定放开逐篇上限，现已全过。
- ESLint：改动的 15 个代码文件通过。
- 类型检查：见第六节。

## 四、留给后续：A1、A2、B3、B4、B5 的具体补法

等录音与系统声那批改动（`src/core/audioCapture/**`、`src/platform/contracts/audioCapture.ts`、`src/features/audioCapture/**`、`electron/main/services/{audio-capture,screen-recording}/**`、`src/features/screenRecording/**`）交回后直接做。

### A1 音频编辑录音能力
- 新能力（`src/core/application-control/domains/audioCapture/` 新建声明，处理器在 `src/features/application-control/audioCaptureDomain.ts` 的 `registerCapabilities`，现为空）：
  - `start_audio_edit_recording`：documentRef 可选（不给就用 `createAudioEditDraft(null)` 新建录音草稿，不切页面）、positionSeconds（默认作品末尾）、replaceUntilSeconds（可选，覆盖到该秒）、projectId 可选（新建草稿放进哪个项目）。流程：`prepareAudioEditTake(projectId, start, end)` → `getAudioCaptureSession().start(placement)`。返回 documentRef 与会话状态，completionKind 用 submitted。先核实：`create_document` 新建、没有素材的口播能否直接进 `prepareAudioEditTake`（`loadAudioEditProject` 遇到无素材会抛 `AudioEditSourceMissingError`），不能就和界面一样先建录音草稿。
  - `pause_audio_edit_recording` / `resume_audio_edit_recording`：`togglePause()`，按当前 phase 判断，phase 不对时拒绝并说明当前状态。
  - `stop_audio_edit_recording`：`stop()`，拼回作品（`restoreAudioEditTake`）并保存，回读作品 `duration_frames / sample_rate` 作为成功证据；回执带 undoRef，直接复用本次的 `recordAudioEditStep`（拼接是一步撤销），这样 `undo_audio_edit` 就能撤录音拼接。timeout 按长任务给足，描述写“等不到就读 recording 的 phase，不要重复停止”。
  - `recover_audio_edit_recording`：`recoverTake()` / `recover()`，恢复中断的录音或待恢复文件；放弃时文件进回收区（现有 `trashFile`）。
  - 安全语义：不付费、不执行外来代码；放弃录音走回收区。拒绝要说清：录屏开着麦克风时开始录音会被拒（`RECORDING_ACTIVE`）、作品正在处理（busy）时拒绝。
- 同步修改：`AUDIO_CAPTURE_CONTROL_EXCLUSION`、`audio_capture.settings` 实体描述与 `recording` 的 readOnlyReason（改指向这几个能力）、`insert_audio_edit_file` 描述里“录音设备控制不在此能力内”、`audioEditStoreLedger` 之外录音相关 store 的账本条目、音频编辑技能加录音一步。
- 结果测试：开始→读 recording 为 recording→停止→作品时长变长且 `undo_audio_edit` 能撤掉这次拼接；录屏开麦克风时开始被拒且未执行。

### A2 录音状态读回
- `audio_capture.settings.recording`（`src/features/application-control/audioCaptureFields.ts`）改为先问主进程 `active()`（界面重载后也是真实状态），再合并渲染层会话里的 placement、error、notice；新增读回字段：`document_id`（placement.projectId）、`position_seconds`、`error`（中断原因）、`notice`、健康计数（溢出、丢帧、写盘峰值，取平台接口实际给出的名字）。
- 新只读属性 `audio_capture.settings.pending_files`：文件名、时长、所属作品，供 `recover_audio_edit_recording` 选。
- 同步 `audioCaptureDomain.ts` 的 schemaDocuments；平台接口 `src/platform/contracts/audioCapture.ts` 若 `active()` 没有带 placement，就在那边补。
- 结果测试：模拟“主进程在录、渲染层会话未建立”时读到 recording 而不是 idle。

### B3 录屏默认值与长录事实
- `recordingCapabilities.ts`：width / height / fps / tracks 去掉 `.default(...)`，处理器（`src/features/screenRecording/application/applicationDomain.ts` 的 start 分支）省略时取 `loadRecordingSetup()` 里用户保存的分辨率、帧率、声音设置（编码参数已经是这么取的）；描述写明“省略时用用户保存的录制设置”，并写“音频编辑正在录音时不要开麦克风”。
- 新只读实体 `screen_recording.setup`（分辨率、帧率、画质、编码、默认麦克风/系统声/摄像头），通用属性读；用户要改默认值时可再开写入（走设置的同一服务）。
- `recordingReflection.ts` 的 session details 填 schema 里已有的 `warnings`、`error`，再加收尾汇总（`recording.capture.summary` 的中断原因、`missing-data` 空档数与总时长、丢帧/重复帧、编码续录次数、拼好的声音条数），字段名按那边交回的汇总结构定，detailsSchema 同步加可选项。
- 技能：交回后在 `screen-recording.md` 的“开始前”补默认值说明（以用户保存的设置为准）、系统声来源（Windows 上由录音进程采集，重载不断）、长录事实读回的字段；“长录注意”补空档与丢帧怎么读。
- 结果测试：不传参数开始录制时用的是保存的设置；收尾后 details 里能读到空档与警告。

### B4 `render_cache.rendering.paused`
- `src/features/videoEdit/application/videoEditFields.ts:156` 的 `rendering` schema 加 `paused: z.string().optional()`（现在 strict 会挡住数据里已有的 paused），属性说明补“paused 为暂停原因，例如正在录屏”。小改动，与录屏那批无关，可随时做；本次按要求留着。

### B5 录屏停止等待时长
- 先看长录测试（待办 4r）里两小时录制 stop / recover / import 的实测耗时；若会超过 60 秒，把这三个能力的 `timeoutMs` 按长任务给足（与音频编辑的 600 秒一致），或改成 completionKind submitted、靠读 session phase 判完成。描述已在技能里写了“等不到先读 phase，不要重发停止”，能力描述本身也要补同一句（在 `recordingCapabilities.ts` 的 controls 描述里）。

## 五、需要音频编辑技能负责人改的点（`resources/assistant-skills/audio-edit-workbench/**` 与相关提示词）
1. 线索现在读得到：`kind`、`confidence`、`start_frame`、`end_frame`、`sample_rate`、`block_ids`、`removed_text`、`kept_text`、`before_text`、`after_text`。8.2 的第 2 步可写成：`list_application_entities` 读 `audio_edit.suggestion`，`where {document_id, kind: 'retake', current_state: 'available'}`，propertyIds 带上述字段，按 confidence 从低到高看。落实：整条接受直接写线索 `status=applied`（同时删词并补接缝处的停顿剪切），驳回写 `status=dismissed`；只想删其中一部分时才逐个改词块 `included`（这条线索随之判为已处理，不要再写它的 status）。不要先改 included 再写 status，那样会被拒且漏掉停顿剪切。`status=pending` 不排除已被删掉的，用 `current_state=available` 更准。
2. 撤销：每个算法操作回执带 `undoRef`，助手要撤自己的某一步用 `undo_audio_edit`（同一 undoRef 可 `redo_audio_edit`），之后用户手改过会被拒绝；通用属性写入的回执用 `undo_application_changes`。技能里不要再让助手用 `reset_audio_edit` 撤销自己的粗剪（那会连用户手改一起还原）。
3. 转写：说明会等到完成；等不到就查 `query_audio_edit_tasks`；能否重新转写看最近一次转写的 `resubmission`（allowed / resume / blocked / running_elsewhere），不要从错误文字猜；modelId 通常省略。
4. 口播单条切点：挪接缝、改停顿用 `audio_edit.cut` 逐条改（create_items / remove_items / set_properties），`audio_edit.document.cuts` 只读；技能里若还写整组写 cuts 要改。
5. `SKILL.md` 里“保存后多轨里自动换成新声音……两边后续字幕修改互不影响”要改：剪切与恢复后剪辑里的声音和字幕跟着更新（停改约 5 秒、回到剪辑、播放或导出前），只有改字、改分段不同步。
6. 录音那一步现在助手做不了（A1），技能里先写“请用户在音频编辑里点录音”，A1 补上后再改成能力调用。
7. `src/features/audioEdit/application/audioEditAssistant.ts` 的“一键优化”提示词按 8.2 改写时，同样用上面的线索字段与 undo_audio_edit。
8. 另外：`src/core/audioEdit/asrCatalog.ts` 的 `asrUploadLimitProblem` 提示只说“在设置里换用百炼 Fun-ASR”，建议补“省略 modelId 重试会自动选长音频模型”（那个文件在 `src/core/audioEdit/**`，本次没动）。

## 六、类型检查
- 渲染层 tsc（按要求只跑一次，放在最后）：只报 1 处，在本次新测试 `audioEditAssistantSteps.test.ts`（对 unknown 取下标）；已改成对整个 items 用 toMatchObject，单测重跑通过，没有再跑第二次全量 tsc。别人文件里没有报错。
- Electron tsc（`tsconfig.electron.json`，覆盖 asr.ts、task-store.ts、ipc/audio.ts 与 preload 声明）：0 错误。

## 七、提交前审查
协调方做了一轮独立审查：撤销重做判定、IPC、登记顺序、线索属性开销核对通过；重要 2 条（线索落实步骤教错、母版预设说法不符）与小问题 5 条均已修，见上文各节。
