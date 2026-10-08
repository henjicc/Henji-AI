# 节奏与结构

> 何时读：粗剪、精剪、选择切点、长素材按场景拆分、口播按文本剪或多机位切换时读。

## 先结构，后切点

1. 从简报和素材找主线：事件因果、观点论证、情绪体验或产品信息。先留下支撑主线的内容，不先逐镜加效果。
2. 粗排完整起承转合，在对话或序列标记记录“时间范围｜观众得到什么｜画面｜声音”。需要悬念、慢揭示、无高潮的观察性纪录片时，不硬套钩子—高潮—落版结构。
3. 回读全片区间与空隙，观察关键帧；有可播放成片与相应模态时再按真实速度审查。联系表只能检查结构和画面变化，不能证明节奏顺畅。
4. 精剪从最影响理解的交接开始：动作进行中切可维持连续感；动作完成后停留可强调结果；J切让声音先入、L切让声音后退。需要分开音画时先核对链接与源余量，分别修剪，不靠整体解除链接掩盖错位。

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

先读 `video_edit.sequence.transcript`，确认 index、text、from/to、editable 和 granularity。没有转录时走 captions 的准备与审批流程；句级或 editable=false 内容不能伪装成精确词级剪辑。

- `ripple_delete_video_edit_text` 删除匹配并闭合全轨时间；`extract_video_edit_text` 复制到紧凑新序列，name 只用于此操作；`insert_video_edit_text` 复制插入，frame 必填且为序列帧。
- selector.kind=words 时 ranges 的 start/end 是含首尾的当前词索引；kind=text 时 text 是稿子原文，occurrence 从0开始，省略匹配全部。所谓“删重复观点”需助手先读稿选择真实索引，不是工具语义搜索。
- 编辑会改变词索引；每组删除后回读新稿，不沿用旧索引。波纹会影响其他轨道，先看锁轨、配乐、字幕和时间锚点，再核对实际返回 ranges。

## 多机位

用 `create_video_edit_multicam`，给 documentRef、templateSequenceRef、name、cameras（各项 itemRef）、sync=audio/in_points/timecode，按实际素材选同步依据；audioCameraIndex 指定主音频。入点给 inPointSeconds，时间码给 timecodeSeconds。声音不能可靠同步时改用已核实入点或时间码，不编造同步成功。

返回序列素材后按 timeline 的通用片段创建路径放入父序列。`auto_switch_video_edit_multicam` 给 documentRef、clipRef，可用 minimumSeconds（2秒为尝试起点）、sensitivity 或 speech。speech 的 startSeconds/endSeconds 相对父片段起点，speaker 匹配源机位标注；没有说话人身份识别。它按声音活动出候选段，可能切到噪声最响机位；按叙事可保留反应镜头或长镜头，再用 `video_edit.clip.multicam_camera_id` 和滚动修剪校正。
