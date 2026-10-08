# 调色与转场

> 何时读：统一镜头、自动校色或参考匹配、用已有LUT与HSL辅助，或选择并检查转场时读。

## 调色从意图与现状开始

读片段效果链与 `video_edit.builtin_effect` 目录。全能调色使用 `video_edit.effect` 集合，在片段下创建必填 `video_edit.effect.definition_id`，值为 effect:color_grade；参数走 `video_edit.effect.parameters`，动画走 `video_edit.effect.frame_curves`。先读已有参数，避免覆盖用户的Look、曲线或遮罩。

通常可先统一白平衡与明暗，再加风格、曲线、色轮、HSL与晕影；夜戏、黑白、胶片或舞台色光可能有意偏离中性，不要求所有素材“校正成白”。曝光±0.3–1档、Look强度20%–60%可试起步，不能作为审美上限。实际效果顺序与单位以目录为准，不承诺完整HDR/Log或PR公式等价。

## 自动校色与参考匹配是建议

`analyze_video_edit_color` 给 documentRef、sequenceRef、clipRef；sampleCount=1–9，不指定 frame 时均匀采样（5帧为工具起点），指定 frame 只采该整数序列帧。

- 自动校色：将返回 temperature/tint/exposure/contrast 绝对建议合并已读参数，经通用属性写入；不是“在当前值再加一次”。纯色或极暗分析失败可选其他代表帧或手调。
- 参考匹配：referenceClipRef 给同序列已调好参考，matchMethod=moments/histogram。返回完整中性参数和RGB曲线，用 parameters 整体替换，并在同一事务清除相应 frame_curves（全部换时写{}），防止旧Look或动画重复作用；此替换会移除旧风格，先确认它符合任务范围。
- 统计不识别艺术意图：对白肤色、混合光源、夕阳不可只按均值判断。写入后观察代表帧与镜头交接，再按素材调整。

## LUT、HSL与统一效果

`video_edit.document.color_luts` 是只读的已导入LUT目录；parameters 的 input_lut/look_lut 写实际返回ID，强度0–100。当前没有独立公开导入LUT能力，缺LUT如实说明，可让用户通过已有界面导入或改用参数，不编造上传或文件路径调用。

HSL辅助的色相／饱和度／亮度为联合选区。肤色15–50°、天空190–250°、柔和度5–20可作选区起点；灯光和肤色差异很大，先显示蒙版，再调选区与校正，完成关闭蒙版。红色跨0°要用真实回绕契约，不按普通数轴裁掉。

需要统一风格可复用已有效果或正式调整片段（先查 `video_edit.clip.adjustment` 与所属轨道）。透明图片不是调整图层，不能把只作用自己像素的效果当成作用下方合成。预设从 `video_edit.effect_preset` 读实际 creation_items，不照搬别的软件索引。

## 转场选择与时长

硬切适合连续动作、语义交接和直接对比；叠化可表达时间或情绪连接；擦除、推动、缩放、模糊及 `shaders.*` 框架转场可服务品牌、空间关系或夸张综艺。选择来自故事、参考和素材方向，不固定“首选硬切”或禁止花哨。

1. 从 `video_edit.builtin_effect` 查实际 transition: 条目与参数语义。`shaders.*` 是命名空间，不是可直接调用的完整种类；从目录取确切后缀。需要自写代码画面或着色器转去 video-edit-code-creation。
2. 在序列下通用创建 `video_edit.transition`，必填 `video_edit.transition.duration_frames`，给 `video_edit.transition.kind` 与真实 `video_edit.transition.left_clip_id` / `video_edit.transition.right_clip_id`。两端是相邻编辑点；单侧只写一端，表示片段入／出过渡。不可拿任意两个远隔镜头硬建转场。
3. 30fps时8–15帧（约0.27–0.5秒）可试柔和叠化；快动作3–8帧，梦境／回忆0.8–2秒也可成立。技术上 durationFrames 至少2帧；其他帧率按目标秒数换算。艺术时长不是硬限制。
4. alignment=center/start/end/custom；custom 才使用 `video_edit.transition.frames_before_cut`。查源余量、链接声音与既有效果，拒绝时按返回原因收短或换对齐，不吞错。
5. 用 `observe_video_edit_frame` 在切点前、中、后及需要的连续帧检查，配合 `read_application_media` 看跳变、重复、冻结、黑帧与字幕；框架转场成功不等于观感适合。声音另核实恒定功率等过渡与实际听感。
