# 字幕与强调文字

> 何时读：给序列生成字幕、整理分段、校对原文、翻译、设置样式，或决定字幕与花字的分工时读。

## 识别和生成

准备混音、生成原文字幕和回填识别字幕都会复核原始文件；嵌套声音按实际来源检查。源文件改变或缺少身份时先重新定位。识别完成后才发现原文件变化，会保留口播文档与真实计费事实并阻止回填；读取返回的 audioDocumentRef 和当前来源，确认可复用后恢复，不重放已完成识别。

已有源内容用 `query_video_edit_content(documentRef,itemRef)`，按 text、fromUs/toUs、kinds 筛选，limit 为1–50，原条件带 nextCursor 续查。默认同项目，discoveryScope=all 跨项目、none 仅读剪辑与显式引用；audioDocumentRef/recordingRef 可指定同源文档，受各域读取权限限制。检查 sourceVerified、discovery.complete 和 warnings；不完整不能声称没有内容，来源/实例变化须重查。

内容时间是原文件微秒；saved 为保存文本，timeline 为字幕投影，intent 为创作提示。precision/basis 不可混用；校对字幕的句级位置不作为精剪词边界。

查询由原读取请求持有，可并行用 `read_application_entity({ref:itemRef,propertyIds:["video_edit.item.content_queries"]})` 查阶段和终态，仅返回当前领域权限覆盖的查询。phaseProgress 是本阶段实测比例，null 表示未知；声音按完成声道路数、文档按已检查数量、画面按检测器回报。取消原请求或编辑/关闭剪辑会取消旧查询，迟到结果不恢复它。失败后读 error 再沿原入口重试，复用缓存、不重新识别或计费。进度只读、有界、不入作品和撤销，关闭重开清空。

0. 带 linked_caption_id 的字幕来自音频编辑：不重新识别、不重排；改字写 text（写回音频编辑），改断句用 audio_edit.caption。
1. 先用 `query_video_edit_transcript` 局部查已有口播与校对字幕，需要完整编辑时再读 `video_edit.caption` 或序列转录稿；已有可用文本不重复识别。需要识别时 `prepare_video_edit_subtitle_audio` 给 documentRef、sequenceRef，scope=sequence/in-out/selection，可给 trackRef 指定人声轨。
2. 准备是本地混音，不计识别费；selection 保持选中声音之间的序列空隙，in-out 需要完整入出点。背景音乐太强时选清楚的人声轨。
3. 拿返回 audioDocumentRef 调 `generate_video_edit_subtitles`，给同一 documentRef/sequenceRef/audioDocumentRef，按需 modelId、language=zh/en 及分段参数。识别可能计费，先走正式审批。修改声音或时序后重新准备，迟到结果不能填进已变目标。
4. 失败保留 audioDocumentRef，先查既有口播任务与结果，再恢复；已有识别结果不重复付费。字幕开始／时长为序列帧，回读文字、范围与源关联，人工校正走通用属性。

## 分段刻度与校对

默认 `style=netflix_zh_hans`：每行最多16字、最多2行，半角计半字，能一行就一行；最短5/6秒、最长7秒，成人阅读速度≤9字/秒。句中逗号句号、分号冒号破折号换一个半角空格，句尾删除；？！…保留，顿号不放行尾或字幕末尾。相邻间隔<500ms，前条结束接到后条开始。用户另有规范以用户为准；英语暂沿用原有规则。

分句先看意群，再结合音频停顿，不能只按字数均分。免费调用 `get_video_edit_clip_pauses(clipRef)` 同时取得已有 words 与真实声音 pauses，即使逐词时间连续也会分析全频和高频低谷，不重复识别。words_and_energy 表示两种证据齐全；breath/punct 只是词间候选，silence 才来自声音。字幕整理与原文字幕生成共用分析结果；声音证据可提示断句，但不会覆盖已有精确词时间。`audio_edit.transcript_block.start_frame/end_frame` 是源采样帧，除以 sample_rate 才是秒，不能当作序列帧。停顿图已计入片段起点、入点、变速、倒放及声道选择。

maxCharacters/maxLines、minDurationSeconds/maxDurationSeconds、maxReadingSpeed、joinGapMs 和 punctuation 均可覆盖。pauseSeconds 默认省略，按说话人停顿分布自适应；需要固定值时 TTS 可从0.2–0.3秒校正，0.6秒往往漏过真实气口。时间不足时保留完整词和原文；缺词级时间按已有字幕范围估算，不能冒充识别精度。

已有字幕用免费 `segment_video_edit_subtitles`，documentRef、sequenceRef，可给 captionRefs 和相同规范参数；不重新识别、不计费，一步撤销。外部 MCP 写入需正式 operationId 信封。


后续用 `video_edit.caption.text` / `video_edit.caption.start` / `video_edit.caption.duration` / `video_edit.caption.translation` 校正。重新分段前已有译文需先清除，再分段重译；尽量复用原引用，新增与合并移除的引用读返回值。

自动字幕的 `video_edit.caption.speech` 是只读来源词证据，文本剪辑、复制和嵌套共用，不手工伪造。独立创建/导入的字幕保持原有锚定语义。剪辑后读 `video_edit.caption.review_reasons`：text 表示保留的人工正文需核对，translation 表示保留的译文需改写或重译，timing 表示词内切点或估算时间需试听。先核对声音和对应字幕，再通过通用属性写 `review_reasons: []` 确认；不能把清空标记当成已经检查。译文没有词级对应时不按字数比例猜拆。

## 分批校对

长字幕用 `query_video_edit_subtitle_correction`，给 documentRef/sequenceRef，可选 captionRefs、budgets={inputTokens,outputTokens,contextTokens}、rules、glossary=[{term,variants?}]。预算是保守估算，另给会话留余量；术语仅随局部内容返回。读 packet.instructions/rules，之后沿 planId 复用，续查需要重读规则时给 includeGuidance=true。模型只给 cues=[{startWord,endWord,text}]：闭合词索引完整、连续、唯一且有序覆盖 core，不改上下文，不跨原字幕合并，不给时间。

提交 `apply_video_edit_subtitle_correction`，给相同文档/序列、planId、batchIndex、cues；应用生成时间并保留样式/词源，译文保留完整并标复核。每批一次撤销，无改动不加历史。续查只给 planId，自动取下一未完成批；失败重试本批，成功批不重做。protected 分页列出未处理字幕及原因，不视为已校对。新人工修改阻断对应批；计划不跨文档重开或声音时序变化。保存失败走原保存恢复，不重做校对。字义仍须听看复核。
## 翻译和样式

- `translate_video_edit_subtitles` 给 documentRef、sequenceRef、targetLanguage，可选 captionRefs、providerId/modelId；可能计费，不能把免费整理和翻译混同。双语流程按现有声明先 maxLines=1 整理原文，再生成下方译文；重生成替换所选译文，失败后先查原状态，不能承诺失败批次重试免费。
- 读 `video_edit.subtitle_preset` 的 style，再合并当前 `video_edit.caption.style`，同目的批量写入；字体从 `font` 实体查真实可用项，不编造字体名。
- 1080p 字号44–56像素、安全边距约画面5%–10%可作阅读起点；竖版避开实际平台遮挡区域与人脸，纪录对白可更朴素，综艺可更突出，广告可用品牌样式。视角与终端尺寸优先，不固定字幕位置、字数或字体数量。
- 花字、关键词动画和人名条若需代码素材，加载 video-edit-code-creation；字幕负责信息，花字负责强调，可并存也可按简报替代。花字提炼成词或短语、换说法，不把口播原句再贴一遍；画面上的其他小字同样只放口播与画面里没有的信息（见 video-edit-code-creation 的 attention“画面文字与信息密度”）。普通字幕默认稳定好读；需求或风格要逐字弹跳时照做，并确认读得完。

## 核对

读回文字与范围；用 `observe_video_edit_frame` 选长句、亮背景、译文与人脸拥挤处，`read_application_media(mode="image")` 真读。按需检查入出帧和相邻接缝；抽查每条字幕结束时间是否不早于最后一个词结束，尤其检查强气口与零间隔连读。SRT/VTT 与烧录见 deliver：结构回读不代替最终成片字幕检查。
