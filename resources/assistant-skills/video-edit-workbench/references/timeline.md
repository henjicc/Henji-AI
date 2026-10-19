# 时间线与组织

> 何时读：开始整理剪辑工程、建序列或轨道、嵌套、链接、标记，或拆分、修剪、变速时读。

## 先读，再组织

1. 读 `video_edit.document` 和目标 `video_edit.sequence`，分页查子实体；序列规格优先取交付简报，再参考主素材。有理帧率 `video_edit.sequence.frame_rate` 的 numerator/denominator 不要四舍五入成整数帧率。
2. 序列用通用 `create_items` 在文档下创建，`video_edit.sequence.name` 必填；不要依赖未指定的初始规格。轨道在序列下创建，`video_edit.track.kind` 必填；片段的 `video_edit.clip.track` 写实际 `video_edit.track.index`，不是 V1/A1 显示编号。轨道 kind/index 只读，改名走 `video_edit.track.name`。
3. 命名可用“粗剪_访谈”“成片_竖版”“开场_走进工厂”；保留用户既有体系。素材箱 `video_edit.bin.name` / `video_edit.bin.parent_id`、项目项 `video_edit.item.name` / `video_edit.item.bin_id` 可通用修改。不为数量、目录层数设产品上限；列表分页，创建按发现的每次事务容量分批。
4. 常用组织起点是主画面、补充画面、图文、对白、音效、音乐分轨；纪录现场声可混合呈现，一镜到底也可只用必要轨道。分轨是为了独立编辑，不规定固定轨数或禁止某种混音。

## 时间与关联

按成片区间找来源用 `query_video_edit_source_map`，给 documentRef、sequenceRef、半开整数帧 from/to；mediums 选择 video/audio，limit 为1–50。每次放置各自保留 path，重复素材和嵌套不能合并为同一次使用。timeline 中声音边界可能是小数帧；source 为原素材微秒，不要混作序列帧。画面的 sampled_envelope 是取帧请求包络，高速跳过的源帧不算已显示；firstSample 也不是解码器核实的实际PTS。图片指向资产点0，生成内容只有生成时钟。

默认只读结构。includeContent=true 才查本页来源内容，contentLimit 为1–5，contentKinds 默认已有文字/描述/章节；显式 pause/scene 才免费分析。content.records 中的 timelineRanges 已按这次放置投影，点事件的 fromFrame=toFrame；检查每条 record 的 sourceVerified、basis、precision。初次读不到文件时保留结构并给 content.error；组合交付前再次核实所有已读来源，中途改变则拒绝旧证据。证据每页按当前来源读取，content.nextCursor 属于原素材内容查询，续查时沿此项源范围和原内容条件；映射分页保持原筛选，剪辑改变或关闭重开后重新查询。

结构候选不证明像素可见或实际可听；透明外框、遮罩、混合和代码效果不能据此判定下层完全被遮挡，用 `observe_video_edit_frame` 复核。映射不提供精剪selector，按词剪辑仍用 `query_video_edit_transcript`。范围超出单次计算预算时按错误给出的上限分段查询，不假称已返回全片。

录屏局部弹出、切换后复原或连续变化，用 `query_video_edit_content` 的 kinds=["screen_change"]（或来源映射的 contentKinds）免费查询；scene 仍是普通镜头检测，隐私文字另走OCR。先5fps扫描，再以30fps复核预算内的疑点，优先返回密集证据；未复核候选保留粗扫阶段，warnings 告知遗漏数量。screenChange 提供归一化 region、kind、stage、samplingFps 和前后源时间（各 Seconds 均是原文件秒，主 ranges 仍是微秒）。按变化区域和前后时间取帧判断；滚动、运镜、正常弹窗都可能是候选，不能直接判错或删除。分析采样时钟不是实际PTS，无法排除采样间隔内的更短闪动；可缩小源范围后继续复核。查询沿原进度、取消和来源核验，不改剪辑或播放头。

- `video_edit.clip.start` / `video_edit.clip.duration` 是序列帧；`video_edit.clip.source_in_us` 是源微秒。30 fps 的 3 秒对应第90帧，30000/1001 fps 则按有理数换算并落到实际整数帧；不要直接把秒传给 frame。
- 读 `video_edit.track.locked` / `video_edit.track.sync_locked`、`video_edit.clip.link_id` / `video_edit.clip.group_id` 与 `video_edit.document.timeline_view`。linkedSelection 控制链接选择，不等于忽略编组；普通属性修改不会替你对所有关联片段写同一个值。
- 标记用 `video_edit.marker` 通用集合，创建必填 `video_edit.marker.frame` 与 `video_edit.marker.name`；关联片段时可写 `video_edit.marker.clip_id`。一镜到底的段落用标记表达，不为套节拍表硬拆连续素材。

## 选择正确操作

| 意图 | 操作与回读 |
| --- | --- |
| 单切点拆片段 | `split_video_edit` 给 documentRef、clipRef、frame；回读前后片段和音画关联 |
| 删除片段，保留空隙 | `remove_items`；先读片段及父集合，检查关联，删除后核对其他轨道 |
| 波纹、滚动、外滑、内滑修剪 | `trim_video_edit_clip` 给 documentRef、clipRef、mode、frames；ripple/roll 给 edge=in/out。正 frames 向右；slip 正值换播放顺序更晚内容。回执实际帧数可能因余量收紧 |
| 普通倍速／倒放 | `video_edit.clip.speed_percent`（100原速）、`video_edit.clip.reverse`、`video_edit.clip.preserve_pitch`；链接音画要分别写。长出来的内容可能受后方空白限制 |
| 保持源内容、改时长并移动后续片段 | `ripple_video_edit_clip_speed`：clipRefs 与 speedPercent 或 durationFrames 二选一；linked 控制关联展开。只移动目标所在轨道后续片段，不将其他同步轨道自动外推 |
| 一组片段作为可再编辑模块 | `nest_video_edit_clips` 给 documentRef、clipRefs、name；默认展开关联，linked=false 只用列出的片段。回读新 sequenceRef/itemRef/clipRef，复查声音、首末帧与叠放 |

嵌套适合独立模块、复用和整体变换，不是整理必须步骤。遇到循环、层级或夹层拒绝，按真实提示调整，不复制一套隐藏序列绕过约束。不要把 `remove_items` 当波纹删除：按文本波纹删见 rhythm，当前没有给任意无转录范围直接闭合全轨间隙的独立公开能力。

## 修改后核对

定向看片沿 `observe_video_edit_frame`：target.kind="frames" 给1–12个 frames，去重排序；near_cut 给 cutFrame（切入后第一帧）、before/after（各0–5，默认各2），连续取帧并限制在序列首尾。临时放大直接给 cropRegion={x,y,width,height}（归一化且完整在画面内），支持源帧、合成帧和联系表，无需创建标注；与 cropAnnotationId 二选一。reference={itemRef,offsetUs?} 取同一剪辑内的参考图片/视频与成片并排，左成片右参考；视频参考时间为成片秒数加微秒偏移，图片始终取0，检查返回 comparison.referenceTimesUs。联系表与比较只叠 cropRegion，不叠标注或元素高亮。先检查 contactSheet.frames 和 documentVersion，再读取资产图片；观察期间编辑、关闭或参考文件变化会拒绝旧结果，不移动播放头或改作品。均匀联系表不能证明不存在闪帧，切点优先连续看。

回读所属序列、位置、时长、源范围、轨道与关联；涉及时间变化同时查字幕、标记和相邻片段。同目的修改进一组事务，跨返回引用分步骤。回滚前确认最近一步就是本次修改，避免撤销用户后来做的事；保存失败用 `save_video_edit` 只重试保存，不重放剪辑。
