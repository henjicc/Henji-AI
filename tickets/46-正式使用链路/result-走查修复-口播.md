# 走查修复：口播与音频编辑（2026-11-13）

按协调方要求收窄范围：只做 Q9、Q12、Q17、Q19、Q20、Q11。Q16、Q10、“HTTP 改成 HTTPS”这几条没做，方案见第三节。没碰 git，没启动应用，也没有 bundle。

## 一、做完的

| 条 | 根因 | 改法 | 契约 |
|---|---|---|---|
| Q9 | 测试过时，不是回归。b65e1db43 把去重念落刀时“后一遍开头前留的气口”从 `BREATH_MS = 120` 改成了 `AUDIO_EDIT_RHYTHM.sentenceMs`（200 毫秒，句末与接缝共用一个数），这是有意的取值变化；测试还按 120 算（2180−500=1680），实际是 2300−200−500=1600 | 断言改为 `2300 - AUDIO_EDIT_RHYTHM.sentenceMs - 500`，直接引用 rhythm.ts | 无 |
| Q12 | `export_audio_edit` 的 schema 把 destination 设成必填，处理器没配置就拒绝；剪辑导出用的是 `videoEditProjectOutputDirectory`，但它要先取剪辑实例，口播用不了 | 新建 `src/features/documents/projectOutputs.ts`：按文档的 container 解析项目“导出”文件夹（`projectExportDirectory`），重名加“ (2)”序号、连同附带的 SRT 一起避让（`uniqueOutputPath`）。destination 改为可选，省略时放进口播所在项目的“导出”文件夹，文件名“<口播名>-剪辑.wav/xml”；口播不在项目里才要求指定。回执新增 `outputPath`、`audioPath`（XML 时）、`subtitlePath`，消息里写出路径。界面的导出按钮走保存对话框，没有“没配就不能导”的问题，不用改 | 输入：destination 由必填改为可选（放宽，旧调用照常可用）；输出：新增三个可选字段 |
| Q17 | 参考稿原样送进对稿：`# 引入`这类标题的字也是读音单元，参与 Myers 对齐。走查那段稿子有 `# 开发过程`、`# 结尾` 等标题，标题字既混进 `script_text`，也会在“一段稿子换成一段识别”的按比例对齐里把附近念的字拉过去（“好”对上“开”就是这类） | `scriptCaptions.ts` 新增 `audioEditScriptPlainText`：标题行与分隔线整行去掉（保留换行，仍算断句），列表符号、引用符号、`**`/`*`/`__`/`~~`、行内代码、链接、图片与转义反斜杠只去标记。对稿（`alignAudioEditToScript`）和去重念的稿子单元（retakes.ts）都用剥过的正文；对齐结果带上它用的正文 `text`，`audioEditScriptTextFor` 从这里取原文，两处位置不会错开 | 无 |
| Q19 | 快速处理回执的 `count` 只是新压缩的停顿处数，名字看不出来；待确认数只在消息里、且只算这次新列出的 | 回执新增 `quickProcess`：`retakesRemoved`、`breathsRemoved`、`breathsAttenuated`、`gapsSilenced`、`pausesCompressed`、`fillersRemoved`、`retakesToDecide`（处理后整份口播 attention=decide 的条数）、`retakesToCheck`（attention=check），不再给 `count`。待确认数复用字段层同一个 `suggestionAttention` 判断（新导出 `audioEditRetakeAttentionCounts`）。消息一句话列出各项、时长变化和待确认数 | 输出：快速处理不再给 `count`（原来就是可选字段），新增 `quickProcess` |
| Q20 | 主进程 `transcriptionResubmission` 对已完成、本窗口正在跑的转写返回 undefined，和说明“最近一次转写带 resubmission”不一致 | 枚举加 `completed`（已转写完成，再调不会再识别）、`running`（本窗口正在转写）；最近一次转写总会带这个字段（口播文件读不出来时除外）。说明同步改 | 输出枚举新增两个值 |
| Q11 | 处理器转写完只写一句固定文字；`transcribeAudioEdit` 不返回模型与粒度 | `transcribeAudioEdit` 返回 `{ modelId, granularity }`（其他调用方忽略返回值，不受影响）。回执新增 `transcription`：`modelId`、`granularity`、`blockCount`、`characterCount`、`costCny`。费用用 `transcriptionEstimatedCny(prepared)`，与付费账本登记的金额同一口径；不需要确认的（续查原任务、取回已付费结果）记 0，模型没有单价时为 null | 输出：新增可选字段 |

契约变化都是放宽输入或新增可选输出，没有不兼容变化，不升对外契约大版本。落盘格式没动。内置助手与 MCP 用同一份能力声明与处理器，两边同时生效。

## 二、改动文件

- `src/features/documents/projectOutputs.ts`（新）
- `src/features/documents/projectOutputs.test.ts`（新）
- `src/features/audioEdit/application/registerAudioEditCapabilityHandlers.ts`
- `src/features/audioEdit/application/audioEditApplicationService.ts`
- `src/features/audioEdit/application/audioEditFields.ts`
- `src/features/audioEdit/application/audioEditQuickProcess.test.ts`
- `src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts`
- `src/core/application-control/domains/audioEdit/audioEditTaskStatus.ts`
- `src/core/audioEdit/scriptCaptions.ts`
- `src/core/audioEdit/captionReview.ts`
- `src/core/audioEdit/retakes.ts`
- `src/core/audioEdit/subtitles.test.ts`
- `electron/main/services/audio-edit/asr.ts`
- `electron/main/services/audio-edit/asr.test.ts`

## 三、验证

- `npx vitest run src/features/documents/projectOutputs.test.ts src/core/audioEdit/subtitles.test.ts src/features/audioEdit/application/audioEditQuickProcess.test.ts`：19/19 通过（Q9 那条已转绿；新断言：快速处理分开计数 Q19、Markdown 稿子对稿 Q17、默认导出目录与避让序号 Q12）
- `npx vitest run electron/main/services/audio-edit/asr.test.ts`：15/15 通过（已完成的转写带 `resubmission=completed`，Q20）
- `npm run eval:rough-cut`（动了 retakes.ts）：与基线一致，没有变差项（评估用例的稿子不含 Markdown）
- 渲染层 tsc（heavy.sh，12 GB）：0 错；主进程 `tsc -p tsconfig.electron.json`：0 错
- 改到的 14 个文件 eslint：通过
- `npm run check:assistant-capabilities:structure`：失败，两条都不是本次改的文件：
  - `applicationControlRegistry.ts:6` 直接依赖 `src/features/documents/application/documentOverwriteReceipt.ts`（未跟踪的新文件，属文档会话那位）
  - `src/workspaces/GenerationWorkspace/hooks/resultSelection.ts` 的 store 未建账
- 没改技能文档，没跑 `check:skill-sync`

Q11 与 Q12 的处理器拼装（回执字段、默认路径进入导出请求）没有处理器级测试，靠类型检查与下面的真实验证。

## 四、待真实窗口验证（bundle 后）

1. 项目里的口播，`export_audio_edit` 只给 `documentRef` 和 `format=wav`：读回 `outputPath` 应在 `<项目>\导出\<口播名>-剪辑.wav`，ffprobe 时长等于剪后时长；再导一次应得到“ (2)”。`includeSrt=true` 时 `subtitlePath` 同名 .srt。
2. 对带 Markdown 标题的参考稿跑 `format_audio_edit_subtitles`，读 `audio_edit.caption.script_text`，不应再有 `#` 与标题字。
3. `quick_process_audio_edit` 回执的 `quickProcess` 各项与线索按 attention 筛出的条数一致。
4. `query_audio_edit_tasks`：转写完成后最近一次转写带 `resubmission=completed`。
5. 真实转写一次：回执的 `transcription.costCny` 与付费账本那一笔一致。

## 五、没做的

- **Q16(a) 插入位置按剪后时间**：没改行为，只在 `insert_audio_edit_file` 的说明里写清现在 positionSeconds 按原素材时间算（等于 transcript_block 的 start_frame ÷ sample_rate）。方案：`timeline.ts` 已有 `outputFrameToSourceFrame`；positionSeconds / replaceUntilSeconds 改为剪后作品时间（与 `audio_edit.caption.start_ms` 同一坐标），落在剪切处时取剪切之后那段保留声音的开头；另给明确命名的 `positionSourceFrame` / `replaceUntilSourceFrame` 按原素材帧，两者二选一。录音那边同源：`src/features/audioCapture/audioEditRecording.ts` 的 `takeRange` 也按原素材秒换算，需要录音那位用同一个换算函数。
- **Q16(b) 只补转写插入段**：涉及计费与任务登记，按要求没动。方案：
  - 占位词块由 `splice.ts` 唯一生成（id 以 `recording-` 开头、granularity=segment、confidence=0），在 core 里给一个判断函数，不改落盘格式。
  - 主进程转写在“已有转写但有保留着的占位段”时走补转写：每段从源文件按采样区间截出 16 kHz 副本（`prepareAudioEditTranscriptionAudio` 加区间参数，缓存名带区间），任务 kind 用 `transcription_fill:<源摘要+区间摘要>`，这样 `claimAudioEditTask` 的“同类无记录才新建”、执行者令牌、`timestampedAsrNeverSubmitted` 续查与防重复计费原样复用；`findAudioEditTranscription`、`latestSettledTranscription` 加 kind 参数。
  - 识别结果的时间加上区间起点，词块 id 用“占位 id:序号”避免与 `transcript-N` 撞号，替换占位块；新词块的语气词线索用 `analyzeAudioEditTranscript` 追加。
  - preflight 按待补段总时长估价，只对没付过费的段计费。
  - 字幕：`buildAudioEditSubtitleCues` 跳过占位块，导出的 SRT 与送进剪辑的字幕（`videoEditAudioLinks`、`videoEditCreativeSources`）都走这一个函数，一处就够。
  - 同源问题：占位块是 segment，`hasWordTranscript` 会因此判成“只有整句时间”，插入后去重念会失败。补完转写后自然消失，在那之前也应让这个判断忽略占位块。
  - 界面目前也没有“补转写”的入口，要按 `henji-ui-surface` 另外设计。
- **Q10 新建录音口播的默认名**：没做。
- **内置助手把念的“HTTP”改成稿子的“HTTPS”**：没核对技能文档与能力说明的措辞。
- **Q14（转剪辑那位）**：口播侧所有能力的 documentRef 都是 `{ kind: 'audio_edit.document', id: <口播文档 ID> }`（`audioEditApplicationCapabilities.ts:10`）。`place_video_edit_creative_result` 的 `result.documentRef.kind` 却要求 `documents.document`，传 `audio_edit.document` 时报“收到字符串”，看不出要什么。建议两种 kind 都接受（同一个文档 ID），或者报错时点名期望值。
- **Q10 回执部分（转录音那位）**：`start_audio_edit_recording` 的回执只有口播 id，建议带上口播名与录音文件路径。
- **剪辑导出（转剪辑那位）**：`videoEditExportQueue.ts` 里的 `videoEditProjectOutputDirectory`、`uniqueVideoEditOutputPath`、`joinVideoEditOutputPath` 与新的 `projectOutputs.ts` 做的是同一件事。建议剪辑那边改为调用 `projectExportDirectory(session.documentMeta.container)` 与 `uniqueOutputPath`，就只剩一套实现。我没碰 videoEdit 的文件。
