# 节奏与结构

> 何时读：粗剪、精剪、选择切点、长素材按场景拆分、口播按文本剪或多机位切换时读。

## 先结构，后切点

1. 从简报和素材找主线：事件因果、观点论证、情绪体验或产品信息。先留下支撑主线的内容，不先逐镜加效果。
2. 粗排完整起承转合，在对话或序列标记记录“时间范围｜观众得到什么｜画面｜声音”。需要悬念、慢揭示、无高潮的观察性纪录片时，不硬套钩子—高潮—落版结构。
3. 回读全片区间与空隙，观察关键帧；有可播放成片与相应模态时再按真实速度审查。联系表只能检查结构和画面变化，不能证明节奏顺畅。
4. 精剪从最影响理解的交接开始：动作进行中切可维持连续感；动作完成后停留可强调结果；J切让声音先入、L切让声音后退。需要分开音画时先核对链接与源余量，分别修剪，不靠整体解除链接掩盖错位。

## 花字与配图随内容

先用 `query_video_edit_transcript` 找到具体那一次口述，再通过 `video_edit.clip.content_anchor` 写 `{matchId,startOffsetSeconds?,endOffsetSeconds?}`；同一候选可在原词与位置未变化时关联多个包装。开始/结束偏移以秒表示，负数提前、正数延后，例如提前0.1秒出现、说完后停留0.2秒。创建片段也可直接带此属性，无需助手手算时间。改文字或源位置后重新查询；字幕句级候选不能冒充原始词级来源。

读回得到 `ranges` 来源区间；内容移动、删减、变速、倒放会统一更新关联画面，关联内容完全移除时删除画面。拖动/修剪包装保留人工偏移，空间位置、正文与样式保持人工调整。复制来源会携带关联包装并建立新实例关系；单独复制包装解除旧关联。嵌套时来源和关联包装一起进入子序列；单独嵌套包装需先选来源或解除关联。`null` 解除关联并保留当前时间。只需固定时间的元素不建立关联。操作仍受锁轨、来源余量与速度范围限制，失败读取原因后修正；结构跟随不证明最终节奏正确，仍需观察和试听。

## 镜头时长刻度：只作起点

| 项目方向 | 可试的尺度 | 何时打破 |
| --- | --- | --- |
| 节拍快剪／活动预告 | 0.3–1.5秒短镜搭配2–4秒信息镜 | 信息读不完就放长；重复节拍可故意错拍 |
| 广告产品／教程 | 1.5–4秒动作，3–6秒关键读图 | 高密度说明更长，情绪广告也可整段长镜 |
| 纪录／访谈 | 4–12秒或更长，跟完整语义和反应 | 犹豫与停顿可能正是内容，不能一概删掉 |
| 长镜头／沉浸 | 15–60秒乃至整段连续 | 变化可以来自表演、镜头和环境声，无须定时切镜 |
| 综艺／喜剧 | 0.5–2秒反应插切与2–5秒铺垫 | 笑点前停顿、笑点后留白按实际表演判断 |

这些例子示范判断方式，不是自动剪法。可对照快密版与舒缓版的相同段落，解释各自保留什么；不要擅自创建无关工程或删除落选版本。

## 场景检测与批量应用

`detect_video_edit_scenes` 给 documentRef、clipRef、sensitivity（0–100，50是分析起点）；免费本地检测原视频源范围，cutsSeconds 为原文件秒，cutFrames 为当前序列帧。先判断返回切点是否符合素材；连续摇镜、闪光会误判，低反差切换可能漏判。

随后 `apply_video_edit_scenes` 使用原 analysisId，options 为 split/markers/subclips 三个布尔值，至少一项 true；不要逐点反复调用拆分。拆分关联声音并保留源时间及锚定内容，整组一步撤销。检测后改过剪辑或源文件就重新检测；旧能力文案的数量说法可能滞后，以当前 schema、执行结果和 recovery 为准，不自行截断素材。

## 按文字剪口播

原素材用 `query_video_edit_content(documentRef,itemRef)` 按文字和源微秒范围查询。默认发现项目内同源文档，跨项目用 `discoveryScope=all`，`none` 关闭。显式请求 `pause/scene` 才免费分析，翻页复用缓存。检查 `discovery.complete`、逐条 `sourceVerified`、`basis`、`precision` 和 warnings；仅按路径关联的录制记录不算核实。结果是候选，不能直接作精剪 selector；来源与分页规则见 [captions.md](captions.md)。

进度读素材项只读属性 `video_edit.item.content_queries`：phaseProgress 是实测阶段比例，null 表示未知；取消原请求或编辑/关闭剪辑会取消旧查询。失败沿原入口重试，进度不保存。

优先用 `query_video_edit_transcript` 按 text 或 from/to 局部查已有口播与校对字幕，可限定 clipRef（含链接声音）或 itemRef。from/to 是半开序列帧；matchSource 可选 asr/caption/all；limit 为1–50，contextWords 为0–20。分页时重复原条件并带 nextCursor，不把整份长稿读进上下文。没有转录时走 captions 的准备与审批流程。

- `ripple_delete_video_edit_text` 删除匹配并闭合全轨时间；`extract_video_edit_text` 复制到紧凑新序列，name 只用于此操作；`insert_video_edit_text` 复制插入，frame 必填且为序列帧。
- 优先直接使用查询命中的 selector（kind=match）；候选包含必要上下文、序列位置和源微秒，剪辑改变、关闭或被最近查询回收后须重新查。校对字幕命中标为 precision=caption，不能冒充精确词源；editable=false 不可直接剪。
- 需要原始词表时再读 `video_edit.sequence.transcript`。selector.kind=words 的 start/end 为含首尾词索引；kind=text 忽略标点、空白、全半角与英文大小写，occurrence 从0开始，省略匹配全部。重复观点仍需根据实际内容选择，不能把文字检索当语义判断。
- 编辑会改变词索引；每组删除后回读新稿，不沿用旧索引。波纹会影响其他轨道，先看锁轨、配乐、字幕和时间锚点，再核对实际返回 ranges。

局部词源查询、文字剪辑、恢复保存稿，以及设置/创建 `video_edit.clip.content_anchor` 都会复核真实来源；嵌套按叶子文件检查，纯画面、静音及直接指定源范围也不例外。文件被替换、丢失或未绑定身份时先重新定位，不用手算绕过。查询后换文件、核对期间取消或编辑，旧候选/关联不会提交。文件失效仍可用 `null` 解除关联。

选声音切点时，把转录查询结果的 from/to 作为 `get_video_edit_clip_pauses` 的 range，clipRef 指向其声音片段；searchMs 默认300、retainedMs 默认120，单位均为播放毫秒。返回 cutCandidates 最多包含目标首尾各一个候选，cutFrame 和 retainedFromFrame/retainedToFrame 均为序列帧；保留区间不会越过检测低谷。没有候选就说明附近缺乏足够声音证据，不按标点补造切点。结果只读且未改作品，修改前后需试听；同一素材分析按内容和声道复用，不能将候选当作已通过听感验收。

## 多机位

用 `create_video_edit_multicam`，给 documentRef、templateSequenceRef、name、cameras（各项 itemRef）、sync=audio/in_points/timecode，按实际素材选同步依据；audioCameraIndex 指定主音频。入点给 inPointSeconds，时间码给 timecodeSeconds。声音不能可靠同步时改用已核实入点或时间码，不编造同步成功。

返回序列素材后按 timeline 的通用片段创建路径放入父序列。`auto_switch_video_edit_multicam` 给 documentRef、clipRef，可用 minimumSeconds（2秒为尝试起点）、sensitivity 或 speech。speech 的 startSeconds/endSeconds 相对父片段起点，speaker 匹配源机位标注；没有说话人身份识别。它按声音活动出候选段，可能切到噪声最响机位；按叙事可保留反应镜头或长镜头，再用 `video_edit.clip.multicam_camera_id` 和滚动修剪校正。
