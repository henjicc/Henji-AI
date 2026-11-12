# 结果：口播送进剪辑后再改口播、导出三点（2026-11-13）

## 一、口播改动后的剪辑刷新

### 根因
1. **每次保存都刷新**：`startVideoEditAudioDocumentLinks` 订阅口播实例，每个新的 `persistedRevision`（自动保存防抖 800ms）都立刻 `refresh`，校对几十处就刷新几十次。
2. **每次都复制一份完整 WAV**：`durableAudio` 用 `importFile` 把主进程渲染缓存里的成品**复制**进项目“生成结果”；同时每次刷新往剪辑里**追加**一条新素材与素材项，旧素材一直被文档引用，旧文件既不能清也越积越多（素材箱也每次多一条）。
3. **字幕不跟**：`updateVideoEditAudioLinks` 按 10-30 的决定只对回逐词参考，字幕起止不动，一律标“时间待复核”，越界的还解除归属。

渲染本身不是问题：主进程已经按内容缓存成品（`finished-<内容键>.wav`），同一版内容只渲一次，且在工作线程里做，不阻塞界面。

### 改法
- **停改后才刷新**（`videoEditAudioLinks.ts`）：口播保存只排一个 5 秒的停改计时（`VIDEO_EDIT_AUDIO_LINK_IDLE_MS`），连续保存反复顺延；到时、**切回剪辑工作区**（`useNavigationStore`）、**剪辑开始播放**、**导出前**（`exportVideoEdit` 与 `enqueueVideoEditExports` 取快照之前 `await flushVideoEditAudioLinks`）立即刷新。刷新期间口播又保存了新版本，这一版直接作废（`AudioLinkStaleError`），不再报“音频更新未完成”。旧声音在新成品就绪并写入前一直可播。
- **不复制，用硬链接**：`ImportFileRequest` 新增可选 `link`；主进程 `linkOrCopyFileNoOverwrite` 同盘用硬链接，跨盘或不支持时照常复制（`no-overwrite.ts`、`media-transfer.ts`、`repository.ts`）。口播的三处放入（送到音频编辑、刷新、多轨新建）都改用它。媒体缓存与项目同在资料盘时不再多占空间；缓存被淘汰后项目里那份仍在。
- **素材项原地换新**：链接片段只用一个素材项、且没有别的片段/镜头备选/放入记录用它时，新成品换进这个素材项，旧素材条目从文档里移除（撤销快照里仍在）；否则沿用原来追加的做法。
- **旧副本最多留两版**：按“剪辑:口播”记下放进项目的成品序列；每次刷新后，把最新两版之外、**本次运行里新建的**、且**不被任何打开剪辑的当前文档与撤销/重做记录引用**的文件移入回收区（`settings.trashFile`，可恢复）。还被撤销记录引用的，在下一次刷新或该剪辑关闭（撤销记录释放）时再清。不动用户原有文件或别处复用来的文件。
- **字幕跟着声音**（`core/videoEdit/audioLink.ts`）：只属于一个按词对回片段的字幕，首尾按“旧成品 → 源录音 → 新成品”换算（`remapVideoEditLinkedSeconds`），保留用户留的前后余量；词全删的句子字幕移除；后面的整体前移；没手改过的文字按剩下的词重写（复用 `retainedCaptionText`），手改过的文字与样式保留、删掉其中词时标“正文待复核”；有译文的标“译文待复核”；只有剪到词中间、首尾都落进剪掉处才标“时间待复核”。片段上没有逐词依据的手动字幕也跟着移动，中间被剪短才标时间待复核。**恢复的整句**在原本带着这份口播字幕的片段上按口播字幕段补回（`videoEditRestoredCues`）；用户删光字幕的片段不会被重新加上。跨多个片段、变速/倒放片段上的字幕仍按旧规则（对回参考、标时间待复核）。
- **一步撤销**：一次刷新（声音、片段长度、字幕、素材换新）仍是一个 `editVideoProject`，剪辑里撤销一步全部还原（测试已断言）。
- **助手同源**：没有新增工具或实体。复用 `send_video_edit_clip_to_audio_edit`：对已链接片段调用时立即刷新（描述与返回文案已更新）；等待中、失败、截短/移除结果都经已有只读属性 `video_edit.document.audioLinkNotices` 读回。导出前自动刷新，助手导出无需额外步骤。
- **日志**：新增 `video_edit.audio_link.refresh.start/completed`（含耗时、是否复用）、`refresh.superseded`、`cleanup.completed/failed`。
- 台账 `docs/rules/assistant-status.md` 新增 11-13 一条（部分推翻 10-30“字幕成品不变”）。

### 取舍
- **局部刷新没做到“只渲改动那一段”**：渲染、缓存在 `electron/main/services/audio-edit/render.ts`，成品按整条内容键缓存；改成分段成品要动渲染缓存结构，超出本次范围。现在的局部性体现在：渲染在后台工作线程、同一版只渲一次、片段和字幕只按映射局部更新、剪辑全程可用。若要进一步降耗，建议另开任务：成品改 24 位 PCM（体积减四分之一）或分段缓存。
- 停改 5 秒是“一小段时间”的取值；校对时边听边停，仍可能隔一会儿刷新一次，但每次是后台渲染 + 硬链接，不再复制大文件，旧版会被清理。
- 不改持久格式：只新增 IPC 请求的可选字段 `link`，不涉及落盘结构。

### 改动文件（本任务）
- `src/features/videoEdit/application/videoEditAudioLinks.ts`、`videoEditAudioLinks.test.ts`
- `src/core/videoEdit/audioLink.ts`、`audioEditLink.ts`、`audioEditLink.test.ts`、`captionSpeech.ts`（导出 `retainedCaptionText`）
- `src/features/videoEdit/application/videoEditExport.ts`、`videoEditExportQueue.ts`（导出前刷新）
- `src/features/videoEdit/application/applicationDomain.ts`、`src/core/application-control/domains/videoEdit/videoEditAudioLinkCapability.ts`（描述与返回文案）
- `src/core/documents/types.ts`、`requests.ts`；`electron/main/services/fs/no-overwrite.ts`、`documents/media-transfer.ts`、`documents/repository.ts`、`repository.test.ts`
- `src/tests/harnessNativeStorage.ts`（补 `settings.trashFile` 只存实现）
- `docs/rules/assistant-status.md`

## 二、测试
- `src/core/videoEdit/audioEditLink.test.ts` 10 项通过（含新增：删句字幕移除且后面前移、手改文字保留；同句删词手改标正文待复核；恢复整句补回、无字幕片段不补；改写的旧用例按新行为断言）。
- `src/features/videoEdit/application/videoEditAudioLinks.test.ts` 8 项通过（新增：连续三次保存不渲染、等待期间可读回提示、一次 flush 只渲染一次且再 flush 不重渲；旧版成品在撤销记录里时不清、关闭剪辑后只清最早那份；删句后一步撤销还原字幕与片段长度；素材项原地换新）。
- `electron/main/services/documents/repository.test.ts` 25 项通过（新增：`link: true` 同盘硬链接同 inode、同名同内容复用）。
- `videoEditExportQueue.test.tsx` 60 项、`videoEditAssistantDescriptions.test.ts` 2 项通过。
- ESLint（改动的 15 个文件）通过。
- 渲染层 tsc：只有 1 个错误，在 `src/features/screenRecording/capture/session.ts`（`'tracks'`），属于别人正在改的录制代码，本任务文件没有类型错误。Electron tsc：错误只在 `electron/main/services/screen-recording/session-document.test.ts`（同一处 `tracks` 改名），同样不属于本任务。

## 三、导出三点
- **(a) 断点续导**：现在导出是一条 mediabunny MP4 流（索引收尾才写），“按画质”还要先写中间文件再由 FFmpeg 压缩；响度标准化需要先把整段声音测完。续导要改成：按关键帧对齐分段（每段独立编码、闭合 GOP）→ 段完成后把段文件与快照、设置、范围一起登记进现有导出恢复记录 → 重启后跳过已完成段 → 最后用 FFmpeg concat 无损拼接；声音整段先混好（已有 spool）再按段切，避免 AAC 起始填充在接缝处出错；渲染端需要能从任意帧开始取帧并保证与连续渲染逐帧一致（代码效果的帧缓存、运动模糊历史帧）。涉及导出主循环、恢复队列和压缩阶段，并需要真实长片验证接缝，**半天内做不到可靠**，本次不做，按此方案留待后续。
- **(b) 是否按完整分辨率合成**：已核实**按导出分辨率合成**。`resolveVideoEditExportSettings` 默认 `renderAtOutputResolution: true`，`prepareVideoEditExportFrame` → `setOutputScale(scale, true)`，渲染端按 `videoEditOutputRenderDivisor` 降低合成尺寸（只有放大导出超过尺寸上限时才回到原尺寸）。无浪费，未改。
- **(c) 只能设码率、体积大**：已核实**已有“按画质（恒定质量）”**：编码设置 `rateControl: 'quality'`（软件 CRF、NVIDIA CQ），导出档位有“视觉无损 / 高画质 / 标准画质 / 指定码率”（`applyVideoEditExportQuality`），助手 `export_video_edit` 也接受 `quality`。排查文档里“只能设码率”的说法不准确。体积大的原因是内置视频预设默认用“视觉无损”（x264 CRF 20 / NVENC CQ 28），而“高质量母版”预设直接按 80Mbps 码率。建议（未改界面）：投稿类预设默认改“高画质”（CRF 24 / CQ 32，体积约降一半，肉眼通常难辨），母版保留视觉无损。

## 四、需要真实窗口确认
1. 剪辑开着，回音频编辑连续删几处、调切点：停手约 5 秒后剪辑里片段变短、字幕前移；连续操作期间剪辑不卡、旧声音可播。
2. 切回剪辑工作区、按播放、开导出：都会先把待更新的口播应用进来。
3. 项目“生成结果”文件夹：同盘时新成品为硬链接（体积不再成倍增长，可用 `fsutil hardlink list <文件>` 核对）；关闭剪辑后旧版只留最新两份，其余在应用回收区可恢复。
4. 剪辑里撤销一步，声音、片段长度、字幕一起回到改口播前。
5. 用 30–60 分钟口播看一次刷新的后台耗时（日志 `video_edit.audio_link.refresh.completed` 的 `elapsedMs`）。

## 五、没做到的与风险
- 没有分段/局部渲染（见“取舍”）；长口播每次刷新仍整条渲染一遍（后台）。
- 硬链接的项目文件与缓存是同一份数据：若用户在外部软件里**原地**改写项目里的这份 WAV，缓存里的成品也被改（多数软件另存后替换，不受影响）。
- 旧版清理只认本次运行里新建的文件；跨会话遗留的旧版不会被清。若同一份成品在本次运行里又被另一个已关闭的剪辑复用，关闭后可能被移入回收区（可恢复）。
- 删掉整句后，若这个片段上的口播字幕全被删光，之后在音频编辑里恢复不会自动补回（没有可依据的“原本有字幕”），可在剪辑里撤销那次更新。
- 跨片段、变速/倒放片段上的字幕仍只标待复核。
- 导出续导未做。

## 六、独立审查第一轮及处理（2026-11-13）

重要：
1. **旧成品清理会清走还在用的文件**：已修。清理前的引用判断改为：打开剪辑的当前内容与撤销/重做记录，加上**磁盘上全部剪辑文档（不限项目、含草稿、含已关闭和未打开的）最后存盘的内容**，按文件名在整份内容里查找（宁可多留）；任一剪辑读不出来就这次不清（日志 `video_edit.audio_link.cleanup.deferred`）。剪辑关闭时也走同一判断，不再直接清。清理前再核对一次，避免并发清理重复移入回收区。新增测试“撤销回第一版再关闭”“素材项还被普通片段用着”“另一份未打开的剪辑引用着旧版”，并断牙验证：去掉磁盘扫描后前后两条立即失败。
2. **硬链接退回复制的错误码不全**：已修。`linkOrCopyFileNoOverwrite` 除“目标已存在”外一律退回复制；`moveFileNoOverwrite` 同类缺口一并修：硬链接不可用时（EISDIR/EBUSY/EACCES 等）先确认目标不存在再改名，改名跨盘再复制后删原文件。新增测试覆盖 EISDIR、EBUSY、EACCES、EXDEV、EPERM 五种和目标已存在。

小问题：
3. 刷新途中作废、已放进项目的成品记入 `discarded`，随后续清理一起处理（同样过引用判断）。
4. 导出前刷新可随导出提交的取消信号取消（`flushVideoEditAudioLinks(…, signal)`；取消只是不再等，更新本身在后台完成）。没能更新时 `prepareVideoEditAudioLinksForExport` 返回提示，写进导出任务的 `notice`（助手查询导出结果可见），导出队列行里也显示（`VideoEditExportQueueList.tsx` 加一行文字，同时让原来只在助手侧可见的“跳过响度标准化”提示在界面可见）；响度跳过提示改为追加，不再覆盖。导出前刷新没有单独的进度显示。
5. 播放说明改为如实描述：开始播放时开始更新，新声音就绪前继续播旧的；导出前才是先等更新完成（提示文字与能力描述已改）。
6. 刷新失败后保留待刷新状态并按 5 秒起、指数退避（上限 5 分钟）自动重试；新的保存重置退避；剪辑已关闭则停止。提示改为“稍后自动重试”。新增测试：一次失败后提示可读回、导出前给出提示、下一次同步自动补上。
7. 恢复内容后片段被同轨后面的片段挡住、句尾词落在片段外时，字幕（含手改）保留原位、解除归属并标“时间待复核”，不再删除；只有词全部真被剪掉才移除。新增测试。
8. `sameFileContent` 先比是否同一文件（dev+ino），再比大小，最后才读内容。

改动文件补充：`electron/main/services/fs/no-overwrite.test.ts`、`electron/main/services/documents/media-transfer.ts`（`sameFileContent`）、`src/features/videoEdit/panels/VideoEditExportQueueList.tsx`。

测试（审查后重跑）：`audioEditLink.test.ts`、`videoEditAudioLinks.test.ts`、`no-overwrite.test.ts`、`repository.test.ts`、`videoEditExportQueue.test.tsx`、`videoEditAssistantDescriptions.test.ts` 共 6 个文件 131 项全部通过（其中 `audioEditLink` 11 项、`videoEditAudioLinks` 12 项）；改动文件 ESLint 通过。

仍有的风险：应用回收区里的剪辑（已删除、尚未恢复）不在磁盘扫描范围内，若之后从回收区恢复且它引用了被清的旧版，需从回收区一并恢复那份成品；每次清理要读一遍全部剪辑文档，剪辑很多时清理会慢一些（只在有待清文件时才读，且在后台）。

类型检查（审查后重跑）：两套 tsc 剩余错误都在别人正在改的文件里（`src/core/audioEdit/retakes.ts`、`src/core/audioEdit/subtitles.ts`、`src/features/screenRecording/capture/session.test.ts`），本任务改动的文件没有类型错误。

## 七、独立审查第二轮及处理（2026-11-13）

1. **（重要）被挡住的句尾字幕留在原位、与补回的句子叠在一起**：已修。句尾落到片段外时，字幕按声音换算出的新位置放（新位置有效时），并标“时间待复核”、解除归属；新位置无效才退回原位。补回恢复的句子时，与这份口播原有字幕时间重叠的不补。测试改为真实链路一样传入字幕段（cues），断言补回第二句、第三句移到 20–25 帧、任意两条字幕不时间重叠。
2. **开始播放不会触发更新**：已修。播放开关只发视图变化，改为订阅 `subscribeVideoEditView`，由停到播的那一刻开始更新（没有改 `videoEditService.ts`）。新增测试，并断牙验证：去掉触发后测试失败。提示与能力描述保持“开始播放时开始更新，新声音就绪前继续播放旧的”。
3. 刷新进行中口播又保存并已排好 5 秒计时时，进行中的刷新失败不再把计时改成退避（只要已有更新的等待项就交给它）。
4. 清理前查引用改为直接读剪辑文件原文做文本查找（`system.fs.readTextFile`），不走文档读取，不会升级写回旧格式文件；列表含缺失文档，有任何剪辑文件缺失或读不出来就暂缓清理。
5. 导出提示改为“音频作品的最新改动没能更新进剪辑……”，与同功能其他提示一致。

测试（第二轮后重跑）：`audioEditLink.test.ts` 11 项、`videoEditAudioLinks.test.ts` 13 项、`videoEditExportQueue.test.tsx`、`repository.test.ts`、`no-overwrite.test.ts`、`videoEditAssistantDescriptions.test.ts` 全部通过。`no-overwrite.test.ts` 中“跨进程文件锁 · 同一把锁串行执行”在与其他文件并跑时偶发一次超时失败，单独重跑 21 项全过，与本次改动无关（锁计时用例）。改动文件 ESLint 通过。

渲染层 tsc（第二轮后重跑）：只剩 `src/core/audioEdit/subtitles.ts` 2 处，是别人正在改的文件；本任务文件无类型错误。
