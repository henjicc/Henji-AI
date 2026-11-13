# Q16 插入段：补转写、插入位置坐标、占位块拖垮去重念

没碰 git，没启动、重启或关闭应用，没跑 bundle 或 build，没做真实付费调用。重命令都经 heavy.sh 排队。

## 一、逐条根因与改法

### (c) 占位块让整份口播被判成“只有整句时间”

- **根因**：`audioEditApplicationService.ts` 的 `hasWordTranscript` 要求每个词块都是 `granularity=word`。插入段的占位块是 `segment`，所以只要插过一次，`clean_audio_edit_retakes` 就报“只有整句时间”；快速处理不报错，但会悄悄跳过去重念。检测器内部（`detectAudioEditRetakes`）原本只是把非逐词块过滤掉，于是占位两侧的词被当成紧挨着，重念候选可能跨过插入段，`boundary()` 找下刀点时会在两侧词之间找安静段，这个窗口正好是插入的那段声音，下刀可能落进去。
- **改法**：
  - `src/core/audioEdit/splice.ts` 新增 `isAudioEditUntranscribedBlock`、`audioEditUntranscribedBlocks`、`AUDIO_EDIT_UNTRANSCRIBED_TEXT`。识别特征是 `granularity=segment` 且 id 匹配 `^recording-\d+-\d+-\d+$`（`spliceAudioEditProject` 是唯一生成它的地方）。没改落盘格式。补转写得到的词块 id 是“占位 id:序号”，不会再被认成占位。
  - `hasWordTranscript` 不看占位块，“够不够 4 个词”只数逐词块。
  - `detectAudioEditRetakes` 在任何非逐词块处把词序列切开，各段分别检测再合并。不跨过插入段比对，下刀也不落进它的声音。没有插入段时只有一段，行为和原来完全一样。

### (b) 插入段没法补转写，占位文字进字幕

- **根因**：主进程 `transcribeRegisteredProject` 看到已有转写就直接拒绝。preflight 也只有“整份”一种口径，没有按区间截副本的入口。字幕的唯一构建函数 `buildAudioEditSubtitleCues` 把占位当普通文字。
- **改法**（沿用现有机制，没有另起一套）：
  - `electron/main/services/audio-edit/asr.ts`：把原来整份转写的付费流程抽成 `runPaidTranscription`，按 kind 参数化。续查或取回回执、`timestampedAsrNeverSubmitted`、执行者令牌认领、带令牌写回执、提交前那次写入、计费事实，这些逐行都是原来的代码。整份转写和补转写共用这一条路，没有第二份实现。
  - 已有转写、又有保留着的占位时，走 `fillUntranscribedSegments`。每段一条任务，kind 是 `transcription_fill:<sha256(素材摘要:起点:终点) 前 32 位>`，requestId 是 `<父请求号>:fill-<序号>`，取消父请求时会一并取消。音频用 `prepareAudioEditTranscriptionAudio(…, range)` 按区间截出 16 kHz 副本，缓存名里带区间。识别结果的时间加上区间起点，并夹在区间内。全部段都拿到后，一次换掉占位块，并给新词块追加语气词线索（`analyzeAudioEditTranscript`）。哪段识别不出字（插入的是静音），就只去掉它的占位。中途失败时，已付费的段留在各自回执里，再调用直接取回。
  - 计费：preflight 逐段判断。已经拿到结果或能续查的段算免费；交给识别服务后无法确认的段，照原规则拒绝。剩下的段，上传上限按最长的一段检查，估价按段相加（`sumAsrCost`，和逐段计费同一口径）。全部免费时 `requiresConfirmation=false`。付费仍走渲染层原来的 `withPaidOperation`、付费账本和单次、每日额度，没有新加确认，也没有绕开。
  - 模型：默认沿用口播第一次识别的模型（同一种时间粒度）。那个模型的凭据已经不在时，交给自动选择。
  - `task-store.ts` 的 `findAudioEditTranscription` 加了 kind 参数，默认 `transcription`。最近一次整份转写的 `resubmission` 不受补转写影响。
  - 撤销：渲染层 `acceptAudioEditNativeResult` 原本就会把补转写压进撤销历史。能力回执在补转写时另外带 `undoRef`，交给 `undo_audio_edit` 可以撤回到补之前（有测试验证）。
  - 字幕：`buildAudioEditSubtitleCues` 跳过占位块。导出的 SRT（`export.ts` → `buildAudioEditSrt`）、送进剪辑的字幕（`videoEditAudioLinks`、`videoEditCreativeSources`）、`audio_edit.caption` 读回，都走这一个函数。文字稿区域仍然显示占位，用户看得到哪里还没识别。
  - 界面：文字稿标签行在有未转写段时出现“补识别插入的部分”（`UiButton size=sm`，悬停提示“只识别插入后还没有文字的声音，按这几段的时长计费”）。它调用的 `transcribeAudioEdit` 和“开始转写”是同一个，付费确认也是同一条路。

### (a) 插入位置按原素材时间算

- **根因**：`insert_audio_edit_file` 和录音的 `takeRange` 都直接用 `秒 × 采样率` 当作原素材帧。助手能看到的“秒”是剪后作品时间（`audio_edit.caption.start_ms`、剪后时长）。只要前面有剪切，就会插错位置。
- **方案选择**：秒数一律按剪后作品时间解释，另外新增原素材采样帧参数 `positionSourceFrame` / `replaceUntilSourceFrame`，同一端两者只能给一个。理由：
  1. 和读回的单位天然对应。项目里凡是 `*_frame` 都是原素材帧（transcript_block、cut、suggestion、breath），凡是秒、毫秒都是剪后时间（caption.start_ms、剪后时长）。助手按单位就能选对，不用记哪个参数是例外。
  2. 依赖素材秒语义的调用方：界面不走这两个能力（界面用的是播放头的原素材帧）；技能文档没写坐标；现有测试的口播都没有剪切，两种解释结果相同。所以不需要保留旧语义，也就不必再加一个“作品秒”参数。
  3. 想按词块精确定位时，直接把 `start_frame` 抄过去就行，不用自己除采样率再去猜剪切。
- **改法**：`splice.ts` 新增 `audioEditPlacementFrames`（剪后秒 → 原素材帧）。落在剪切处时，起点取剪切之后那段保留声音的开头，覆盖终点取剪切之前那段的末尾。参数错误时点名字段，例如“超出剪后作品长度（x 秒）”“只能给一个”。另新增 `audioEditOutputSeconds`（原素材帧 → 剪后秒，读回用）。插入能力、`start_audio_edit_recording`、`resume_audio_edit_recording` 都用这一个换算函数。录音读回 `audio_capture.settings.recording` / `pending_files` 里的 `positionSeconds`，以及各回执消息里的秒数，都改成剪后时间，传进去和读回来是同一坐标。

## 二、契约与落盘格式

- **落盘格式**：没动。占位块靠现有特征识别，`buildProjectAudioEditTimeline` 只是把参数类型放宽成 `Pick`，所以没跑 `check:persistence-compat`。
- **契约**：只放宽了输入，增加了可选字段。
  - `insert_audio_edit_file`：`positionSeconds` 从必填改为可选（两种位置给一个），新增 `positionSourceFrame`、`replaceUntilSourceFrame`。
  - `start_audio_edit_recording` 新增两个帧参数，`resume_audio_edit_recording` 新增 `positionSourceFrame`。
  - 输出 schema 没变；`transcribe_audio_edit` 的回执多了原本就有的可选字段 `undoRef`。
- **语义变化（需要协调方知悉）**：有剪切的口播上，`positionSeconds` / `replaceUntilSeconds` 的含义从原素材秒变成了剪后秒，录音读回的 `positionSeconds` 也随之变化。这是把行为改回能力最初的说法“作品的 positionSeconds 秒处”。说明里写的“按原素材时间”是上一位今天临时补的。我没升对外契约大版本，如果协调方认为该升，请决定。
- **说明文字已同步**：插入、转写、快速处理、去重念、`query_audio_edit_tasks.resubmission`、录音三个参数、`audio_capture.settings` 的 recording 与 pending_files、技能 `audio-edit-workbench/SKILL.md` 第 3 步，都已更新。`docs/rules/assistant-status.md` 顶部加了一条（推翻了同日“已有转写不再识别”和录音按原素材秒的说法）。

## 三、改动文件

- `src/core/audioEdit/splice.ts`
- `src/core/audioEdit/splice.test.ts`
- `src/core/audioEdit/retakes.ts`
- `src/core/audioEdit/retakes.test.ts`
- `src/core/audioEdit/subtitles.ts`
- `src/core/audioEdit/subtitles.test.ts`
- `src/core/audioEdit/timeline.ts`（只放宽 `buildProjectAudioEditTimeline` 的参数类型）
- `electron/main/services/audio-edit/asr.ts`
- `electron/main/services/audio-edit/asr.test.ts`
- `electron/main/services/audio-edit/media.ts`
- `electron/main/services/audio-edit/task-store.ts`
- `src/features/audioEdit/application/audioEditApplicationService.ts`
- `src/features/audioEdit/application/registerAudioEditCapabilityHandlers.ts`
- `src/features/audioEdit/application/audioEditQuickProcess.test.ts`
- `src/features/audioEdit/application/audioEditReflectionResult.test.ts`
- `src/features/audioEdit/workspace/AudioEditPanels.tsx`
- `src/features/audioCapture/audioEditRecording.ts`
- `src/features/audioCapture/captureApplicationService.ts`
- `src/features/application-control/audioCaptureFields.ts`
- `src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts`
- `src/core/application-control/domains/audioEdit/audioEditRecordingCapabilities.ts`
- `resources/assistant-skills/audio-edit-workbench/SKILL.md`
- `docs/rules/assistant-status.md`
- `tickets/46-正式使用链路/result-插入段补转写.md`（本文件）

## 四、验证

- 精确测试，全部通过：
  - `electron/main/services/audio-edit/asr.test.ts` 16/16。新增：只补插入段、按段截副本、只按 0.8 秒估价与查上限、结果换掉占位、整份转写记录不受影响、重载后重试只取回回执不再提交、没有插入段照旧拒绝。替身改成按 kind 存任务，与正式表的“同类无记录才新建”一致。
  - `src/core/audioEdit/retakes.test.ts` 78/78。新增：两遍之间夹着插入段时不跨过比对；插入段一侧的重念照常删，下刀不落进插入段（改前代码会检出 1 处，这条会变红）。
  - `src/core/audioEdit/splice.test.ts` 7/7。新增：剪后秒换算（剪切处取后段开头、终点取前段末尾）、帧参数原样使用、越界与二选一报错、读回秒数；占位能被认出、补出的词块不算占位。
  - `src/core/audioEdit/subtitles.test.ts` 13/13。新增：占位不进字幕段和 SRT。
  - `src/features/audioEdit/application/audioEditQuickProcess.test.ts` 6/6。新增：带占位时去重念删 1 处、快速处理删 1 处重念，占位保留。
  - `src/features/audioEdit/application/audioEditReflectionResult.test.ts` 17/17。新增：经正式能力，剪后 1 秒插到原素材第 49000 帧，帧参数、二选一拒绝且记为未执行；补转写回执 `blockCount=1`、`costCny=0`，`undo_audio_edit` 能回到占位。
  - `src/features/audioCapture/audioEditRecording.test.ts` 8/8、`src/features/application-control/audioCaptureDomain.test.ts`、`audioEditWorkbenchSkill.test.ts`、`timeline.test.ts`、`media.test.ts`、`outputContract.test.ts` 通过。
- `npm run eval:rough-cut`：每一项都和基线（2026-11-13，241a3fcdf）一致，输出里没有一处“（基线 …）”差异标注。
- 渲染层 tsc（heavy.sh，12 GB）：0 错。主进程 `tsc -p tsconfig.electron.json`：0 错。
- 改到的 21 个 ts/tsx 文件 eslint：通过。
- `npm run check:assistant-capabilities:structure`：失败，只有一条，不是本次改动引起的：“store 未建账且未登记原因：`src/workspaces/GenerationWorkspace/hooks/resultSelection.ts`”（已提交在 64a776803，本次没碰）。
- `npm run check:dependency-graph`：列出的 7 条跨 feature 导入都不是本次新增的，其中 audioEdit → documents/projectOutputs 来自 Q12。
- **原有问题**：`electron/main/services/application-runtime/externalToolContracts.test.ts` 里“口播十一工具……真实必填项”一条失败，是 `export_audio_edit` 的 destination 在 Q12 改成了可选，而测试仍要求必填。不是本次引入的，我没改。

## 五、待真实窗口验证（要新产物，需要协调方安排 bundle 和重启的时机）

1. 打开一份已转写的口播，先删掉前面一句（制造剪切），再在剪后某一秒用 `insert_audio_edit_file`（positionSeconds）插一段约 20–30 秒的补录。读 `audio_edit.caption`，确认新声音紧接在那一秒处，文字稿显示“（需要重新转写）”，字幕区没有这几个字。
2. 文字稿标签行出现“补识别插入的部分”，点它（或者助手调 `transcribe_audio_edit`）。在付费账本里确认只记了这一段的金额。日志查 `audio_edit.transcription.start` 的 `context.kind` 以 `transcription_fill:` 开头，`audio_prepared` 的 audioSeconds 约等于插入段时长。
3. 补完后占位变成逐词文字；撤销一次回到占位，重做恢复。再调一次转写，应拒绝“口播已有转写”，且不计费。
4. 补完后跑快速处理和去重念，不报错；导出 XML+SRT，SRT 里没有占位文字；送进剪辑后字幕也没有。
5. 在补转写还没完成时插两段，再补：两段各一条任务，合计计费一次。
6. 用 `start_audio_edit_recording` 带 positionSeconds 录进有剪切的口播，读 `audio_capture.settings.recording.positionSeconds`，应与传入值一致。

预计费用：按走查实测单价（7.4 分钟 ¥0.0971，约 ¥0.013/分钟），30 秒插入段一次补转写约 ¥0.007，在单次 ¥2 额度内自动通过。如果供应商有单次最低计费，以账本为准。

## 六、没做的与原因

- **插入段里的呼吸与字间气口**：快速处理和呼吸处理是按声音做的，没有跳过插入段。占位块会被当成一个很长的“词”，所以段内呼吸只会减弱、不删，字间气口也不清。这么做是保守的，补识别后再跑一次就正常了。任务要求“未转写的区段跳过”，我按“依赖转写的步骤（去重念）”来理解，压缩停顿、处理呼吸仍按声音照常处理。
- **新词块没有字幕分段标记**：`captionBreakAfter` 是空的。已经整理过字幕的口播，补完后插入段会按停顿和长度兜底分段，需要再跑一次 `format_audio_edit_subtitles`。我没自动重排，免得冲掉用户手调过的分段。
- **再次插入落在占位块中间（原有问题）**：`spliceAudioEditProject` 会整块丢掉被跨过的占位，只给新插入的那段生成占位，原插入段剩下的部分没有占位，也就补不了转写。这不是本次引入的，没改。建议以后在 splice 里把被切开的占位按左右两半保留。
- **提交前审查**：本次碰到付费计费路径（`asr.ts` 的付费任务流程重构），按 AGENTS 需要提交前由干净上下文审一遍，请协调方安排。
- **对外契约大版本**：见第二节，由协调方决定要不要升。
