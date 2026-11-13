---
name: audio-edit-workbench
description: 剪口播时使用：把录音全自动粗剪成可继续修改的口播工程（去重念、换遍拼接、呼吸声、停顿、语气词、字幕），并逐处复核算法结果。
---

# 口播剪辑：全自动粗剪，交回可继续修改的工程

目标：用户只给录音（可以附口播稿），交回一份剪好的口播工程。用户在口播里边听边改，满意后自己导出；每一步都可撤销、可逐处恢复。

**分两段做：本地算法先粗剪，你做二次优化。** 本地算法不懂意思：有把握的它直接剪掉（都留痕、可逐处恢复），拿不准的不动声音，连同原因和几种做法列成线索交给你。没有接入助手时，算法结果就是全部；有你在时，它只是起点，你要逐条裁决这份线索、再通读补漏，效果要明显好于只点“快速处理”。只调用工具、读一眼结果就交付，等于没有完成任务。

## 一、先让算法打底

1. **口播文档**：已有口播就用它（`list_documents`，kind=audio_edit）。只有文件时先 `create_document`（kind=audio_edit；用户在某个项目里工作就传 projectId），再 `import_audio_edit_source` 导入本机音频或视频。默认引用原文件，不复制。
2. **参考稿（可选）**：用户给了口播稿就写入 `audio_edit.document.reference_script`。稿子只用来避免误删稿子里本来就有的重复、辅助校对近音字，不能覆盖识别出的原话；录音时改过稿也没关系。
3. **转写**：`transcribe_audio_edit`（modelId 通常省略，自动选合适的模型）。按时长计费，走应用的付费授权；调用会等到识别完成，等不到时用 `query_audio_edit_tasks` 查，不重复提交。失败后能不能重新提交看最近一次转写的 resubmission（allowed / resume / blocked / running_elsewhere），不要从报错文字猜。已有转写不再整份识别；插入或补录进来、文字显示为“（需要重新转写）”的段，再调一次 `transcribe_audio_edit` 只补识别这些段（只按这些段的时长计费），回执的 undoRef 可撤回补之前。插入音频的位置 positionSeconds 是剪后作品时间（与 `audio_edit.caption` 的 start_ms 同一坐标）；要按词块定位就给 positionSourceFrame（与 transcript_block 的 start_frame 同一坐标）。
4. **去掉重念**：`clean_audio_edit_retakes`。同一内容念了几遍只留最后一遍；呼吸也算气口，原切点连读时会在两遍对应位置的明显气口换遍拼接，贴着念坏那遍的一两个字一起删。拿不准的（换了说法又没有稿子佐证、短的原样重复、像排比的两句、删完后保留内容里前后两段开头仍相同）不删，列为待确认的剪辑线索；每条线索（包括已经自动删掉的）都带着原因和几种做法，第二步先裁决这份清单。
5. **呼吸声**：`process_audio_edit_breaths`（本机模型，第一次用时下载约 13 MB）。默认（快节奏）去掉呼吸，并按声音电平把字与字之间残留的气声、呼吸尾巴整段静音、再从中间删去多余部分（句间与接缝留约 0.2 秒、句中约 0.12 秒；标识以 `gap:` 开头的静音与删除剪切），和字连着的只减弱；用户说过的节奏偏好优先（偏自然就把句中的改成减弱或保留）。用户说先不处理呼吸时跳过。
6. **停顿**：`compress_audio_edit_silence` 按实际声音压缩停顿、保留自然气口。不要把词间时间差当作停顿。

## 二、逐处复核（必做，不能跳过）

读数据：分页读取全部词块 `audio_edit.transcript_block`（按 document_id 筛选，包括 included=false 的，才知道每一刀删了什么），读呼吸声 `audio_edit.breath`（context、前后文字、gap_ms、handling）。

0. **先裁决重念线索（二次优化的主体）**。一份长口播有几百条重念线索，大多数是本地有把握自动删掉的，不要全部带着做法读一遍。按线索的 `attention` 分层读（`list_application_entities` 读 `audio_edit.suggestion`，where 里写 document_id、kind=retake 和 attention，分页读完）：先读 `attention: 'decide'`（待确认，必须逐条裁决），再读 `attention: 'check'`（已自动删、但把握 score 低于 0.7 或原因是口吃，值得抽看）；这两层 propertyIds 带 reason、score、options、chosen_option、removed_text、kept_text、before_text、after_text、start_frame、sample_rate。其余（attention=none）不读做法；通读全文时发现哪一刀不对，再点名读那一条的 options。
   - **待确认的**（attention=decide）每条都要定，score 低的先看。线索自己的 removed_text（本地想删的那一遍）、kept_text（紧跟着留下的那一遍）、before_text、after_text 是整段上下文；options 里每种做法给它删掉的文字（removed_text，长的只有头尾）和删完后接缝两侧连起来读的样子（reads_as，“｜”是接缝）。选最通顺、意思最完整、不丢只说过一次的话的那种，把它的 id 写进 `audio_edit.suggestion.chosen_option`：keep_later 留后一遍、keep_earlier 留前一遍、splice_ 开头的是换个切点；不是重念就写 keep_both（都留着，总是可选，不在 options 列表里）。id 原样照抄。写入会删词并补好接缝处的停顿剪切，不要自己先改词块 included 再来写。只想删其中一部分、options 里没有合适的，才逐个改词块 included。
   - **按 reason 看语义，这些本地算法分不出来，必须由你判断**：reworded 换了说法没有稿子佐证（是同一句重说，还是本来就是两句）；short_repeat 短的原样重复（强调、叠句、口号要留）；parallel 开头相同的两句（排比、列举、对比要留）；complete_clause 说完的整句又说一遍（有意重复还是重念）；unsaid 前一遍有后一遍没再说的内容（删了会不会丢话，常要 keep_earlier 或都留）；joined 两遍之间没有停顿；stutter 口吃还是叠词；loop 连着重复多遍；inside_unsure 所在整段还没定（先定那一整段）；residual 去重念后前后两段开头仍相同。有参考稿时对照稿子：稿子里写了两遍的是有意的。
   - **已自动删、值得抽看的**（attention=check）：本地只能按“留最后一遍”定，留哪一遍更好要看意思。前一遍说得更完整、更准确，或后一遍少了内容时，写 chosen_option=keep_earlier；发现删的其实是有意的重复，写 keep_both 恢复；两遍字面一样时保持本地的选择。为什么是 0.7：在有定稿的口播上，本地自动删的重念里把握低于 0.7 的约两成与定稿不一致，不低于 0.7 的约百分之五，后者靠第三步通读兜底，不逐条看。
   - **定不了的交给用户**：两遍字面相同只差语气、要听才知道的，或你确实拿不准的，不改它现在的做法（待确认的保持待确认，已自动删的保持本地的选择），把 `audio_edit.suggestion.audience` 写成 user，并在汇报里按时间点名。不要为了清空清单硬选。
   - 写 chosen_option 被拒绝时照报错处理：待确认线索要删的内容已经被删掉，或已删的内容被手动恢复过一部分（多半是用户改的），这类不要硬改，以当前口播内容为准。
   - **裁决落实后再跑一次自检**：再调一次 `clean_audio_edit_retakes`。你定过的那一对两遍（都留着、改过做法、或被手动恢复过的）它不会再动；你的改判让别的两遍挨到一起时（比如删掉后一遍后，前一遍与更后面的第三遍相邻），它会照常新删或新列出来。回执里的待确认条数是这次真正新列出的；再读一遍 attention=decide：清空了就继续，还有就再裁决一轮，仍定不了的标给用户。只复查这一次，不循环。
   - 要撤掉自己的某一步：算法操作回执里带 undoRef，用 `undo_audio_edit`（之后用户手改过会被拒绝）；属性写入用 `undo_application_changes`。不要用 `reset_audio_edit` 撤销粗剪，那会连用户的手改一起还原。
1. **线索之外的每一处重念也回答三个问题**（options 不够用、需要自己动词块时），再决定留哪里：
   - 他为什么重念？口误、没念好、在不该断的地方断开、还是现场改了稿？
   - 前一遍从哪里开始坏的？坏之前的部分有没有念好？
   - 接缝两侧有没有停顿或呼吸？语气接得上吗？
   前一遍开头念得好、且两遍在坏点之前有对应的明显气口时，可以留前一遍的开头、在气口处接后一遍（用 `audio_edit.transcript_block.included` 改词块）；找不到好气口就整遍留最后一遍。留下的碎字（如“那”“好，”）会去接几秒后的另一遍，语气接不上，一律跟着念坏那遍删掉。
2. **找算法漏掉的重念**：隔得较远的重述、两遍说法完全不同的完整表达、中间插了一句引子的重念、同一个英文名一遍识别成字母一遍识别成汉字、没有重念的明显口误。有把握才删；拿不准就保留并在汇报里点名。
3. **逐处看呼吸与气口**：按 context 与前后文字判断。去掉一口气后前后挨得太紧、句中这口气承担了强调或停顿的语气、或删掉后前后语速突变时，改成减弱或保留（写 `audio_edit.breath.handling`）。段落转折、需要停一下的地方，把对应 `gap:` 删除剪切缩短或停用（逐条写 `audio_edit.cut.start_frame`、`audio_edit.cut.end_frame` 或 `audio_edit.cut.enabled`），让静音停顿长一点；不要恢复成带气声的原声。
4. **语气词按位置判断**：接在句尾、和前一个字连着念的“啊、呢、吧、哦”带着语气，通常保留（删了还容易切到字尾）；单独成词、在句首或重念前的“哎、诶、嗯、呃、啊”多是起头习惯，没用就删。起作用的“就是、那个”保留。用户说先不删语气词时不删。
5. **字幕**：`format_audio_edit_subtitles` 整理分段（有参考稿时按稿子的逗号、句号等断句，一行一句）。然后逐段核对成片字幕 `audio_edit.caption`：用 list_application_entities 按 document_id 与 script_match=different、not_in_script 筛选，带上 text、script_text、spoken_text、original_text 一起读回。
   - 校对既不完全照稿也不完全照识别：实际念的与稿子不同（改词、加词、少念）按念的写；同音错字、产品名和专有名词、英文大小写、数字按稿子写；拿不准就保留识别，并在汇报里点名。
   - 改字写 `audio_edit.caption.text`（会逐字写回词块，词时间与声音不变）；断句不对时改最后一个词块（block_ids 末项）的 `audio_edit.transcript_block.caption_break_after`。
   - 排版不用手动做：中英文与数字之间的空格、行尾逗号句号、单独的“哎”“嗯”这类叹词都按规则自动处理，间隔短于 0.5 秒的两条字幕自动接上。

## 三、回读核对再交付

- 重新分页读一遍保留的全文：每个接缝两侧连起来读是否通顺、有没有重复、有没有把半句话切掉。
- 读 `audio_edit.render.output_duration_frames` 核对剪后时长。
- 对照第二步，确认每一处都看过；发现问题就继续改，不要在第一批修改后宣布完成。

## 四、汇报

- 口播在哪个项目、剪后时长、去掉多少处重念、呼吸声怎么处理的。
- **你在算法结果之上改了什么**（换遍拼接、补剪的重念、恢复的误删、呼吸与语气词的取舍）以及理由——这是用户判断你有没有用心的依据。
- 少数需要试听的位置，按时间列出（audience 标成 user 的线索、接缝两侧没有停顿、你拿不准的）。
- 只报实际处理内容和具体位置，不展示词块 ID、采样帧、字段名等内部信息。

## 五、声音处理（用户要求处理声音时）

剪辑与声音处理分开：粗剪交付时不动声音处理；用户说“处理一下声音”“让人声更清楚”“去噪”“去口水音”等再做。改时长的（重念、停顿、语气词、删除呼吸）是剪辑；改声音不改时长的都在效果控件里。

1. **效果控件**（`audio_edit.document.effect_chain`）是一串有顺序的效果，从上到下依次处理录音本身，顺序就是处理顺序（例如先去除口水音、再压呼吸声，呼吸声处理的就是去掉口水音之后的声音）。写入时整条数组 set，保留用户已有的项与顺序，只在合适的位置插入或修改；每项 `{ id, kind, enabled, … }`，新项的 id 用新的 UUID。
2. **常用的项**：
   - `essential` 基本声音（与 Audition 的基本声音同一套思路，settings 同剪辑片段的基本声音，不含 loudness/volume）：type=dialogue；按听到的问题打开 repair 的 noise 底噪、rumble 低频隆隆、hum 电源嗡声（国内 mains=50）、deEss 齿音，clarity 的 dynamics 让音量平稳、eq 选预设（podcast 播客语音等）、enhance 按嗓音选 low/high；量 0–100，适中即可。
   - `kind=mouth_declick` 去除口水音：先加一项（`analyzed: false, clicks: []`）或直接调 `detect_audio_edit_mouth_clicks`（不给 itemId 时用第一项，没有就加到链末尾），检测听的是这一项之前的声音；数量明显异常（每分钟上百处）时降低灵敏度重测，在汇报里列几处让用户试听。
   - `breath` 呼吸声：把全部呼吸统一减弱（mode attenuate、reductionDb）或静音，不改时长；要删掉呼吸用 `process_audio_edit_breaths`（剪辑）。
   - `separation` 去混响（mode dereverb）/ 人声分离（mode isolate）：本地模型整段处理，第一次下载约 67 MB，有显卡约 20 秒处理 10 分钟。
   - `builtin` 内置效果（均衡器、限幅器、立体声扩展等），builtin.id 与参数同剪辑的音频效果；`plugin` 第三方插件，pluginId 取自 `audio_edit.processor_chain.available_processors`。
   `audio_edit.document.chain_bypassed` 整体关闭（对比处理前后）。
3. **输出**（`audio_edit.document.output`）作用在剪好的整条声音上：`volumeDb` 音量；响度用 `match_audio_edit_loudness`（短视频平台 -14、播客 -16 LUFS）测量后补偿，不要自己猜 gainDb。
4. **多轨**：口播要和音乐、音效一起混时，多轨就是剪辑的序列：音轨的 `video_edit.track.volume_db`、`video_edit.track.pan`、`video_edit.track.effects` 与序列的 `video_edit.sequence.master`（主轨音量、主轨效果）都是剪辑实体属性；片段的 `video_edit.clip.essential_sound` 与口播的基本声音同一套设置。口播放进多轨后是动态链接：这里剪切或恢复之后，剪辑里的声音和字幕跟着更新（停改约 5 秒、回到剪辑、播放或导出前）；只有改字、改字幕分段不同步过去，最终字幕文字在剪辑里定稿。
5. 处理完回读属性核对，汇报加了哪些效果、顺序、量多少、为什么。

## 边界

- 不改写原话。校对只改有充分依据的近音错字，绝不改真实人名、地名、产品名和机构名。
- 不加或调整第三方插件、不导出、不撤销全部修改，除非用户要求；效果控件与输出只在用户要求处理声音时改。
- 已有的手工删除、校正、锁定和字幕分段一律保留，在此基础上追加。
- 用户在应用里接管了这份口播时，写入会被拒绝（USER_TAKEOVER）：立即停手，告诉用户你做到了哪一步，等用户交还。
