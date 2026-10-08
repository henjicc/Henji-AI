# 声音：先可懂，再有层次

> 何时读：选配乐、平衡对白与音乐、生成音量回避、测量响度、清理口播停顿或语气词时读。

## 配乐与音量

1. 优先复用用户音乐、已有声音资产或口播结果，确认用途与使用权；缺音乐可用 cross-workspace 的原地生成流程，遵守付费审批。
2. 可独立调整的对白、音乐、音效与环境声分轨摆放。通用写 `video_edit.clip.audio_role` 为 dialogue/music/sound_effect/ambience，角色取决于内容，不由轨道位置猜测。
3. `video_edit.clip.volume` 是线性振幅0–2：1为0dB，0为静音，约0.5为−6dB，约2为+6.02dB；不是分贝参数。需要手动曲线时先发现 `video_edit.clip.volume.keyframes` 的帧时钟与点结构。
4. 常用混音起点是音乐比对白低约12–20dB，再按人声清晰度调整；音乐主导短片、无对白纪录环境声无需套此比例。短声音切点可试2–4帧淡化，音乐可试0.3–1秒；`video_edit.clip.fade_in_frames` / `video_edit.clip.fade_out_frames` 写整数序列帧。

## 自动回避：候选先做，听感校正

`generate_video_edit_audio_ducking` 给 documentRef、musicClipRefs、settings。settings.targetRole=dialogue 或 sound_effect，reductionDb 降低分贝、sensitivity 检测灵敏度、fadeSeconds 压低和恢复的缓冲秒数。12dB、50、0.3秒是可试起点；轻音乐可减小幅度，强节拍可更快，长对白可更平缓。

先读角色与曲线再调用；它检测非静音活动，不理解语义，残留噪声或音乐会触发。重新生成替换自动回避点，保留手动点且同帧手动优先；无重叠可听目标时清除旧自动点。核对曲线，再在有音频模态时试听，没试听不能说“声音自然”。

## 响度：测量范围先说清

- `measure_video_edit_loudness` 用 documentRef、clipRefs 独立测每段，含片段音量、速度、映射、淡化和效果，忽略轨道静音及邻接过渡；不是整片混音。积分 LUFS、dBTP 与采样峰值 dBFS 不混用，静音／太短的 LUFS=null 不等于0。
- `normalize_video_edit_loudness` 同样给 clipRefs，再给 targetLufs，自动迭代片段增益并核实；不加限幅，超过可用增益或受效果限制会拒绝，不靠反复加音量绕过。
- 当前能力给出的常用目标是网络视频−14 LUFS、播客−16 LUFS、广播−23 LUFS；真峰值可试−1 dBTP。先问交付规格是否已有要求，明确规格优先；这些不是所有平台统一强制标准。
- 整片在 `export_video_edit` 的 loudness 或完整 settings.loudness 指定 targetLufs/truePeakDbtp（按 schema）；通过 `query_video_edit_export` 读 loudnessMeasurement。该数据来自混音PCM，不能宣称已经复测最终AAC真峰值。编码成片需要单独听感／最终文件测量证据，当前没有独立公开成片复测入口。

## 静音压缩与语气词

先读 `video_edit.sequence.transcript`，再 `detect_video_edit_text_silence` 检测真实声音停顿，结果读 `video_edit.sequence.text_silences`。删除用 `ripple_delete_video_edit_text`，selector.kind=silence；检测复用已保存口播声音与其停顿设置，不从文字空格推断静音。

语气词用 selector.kind=fillers，可传 words；上下文中的“那个产品”可能有实义，先读稿选择范围或改用 words 索引精确删除。不默认删除全部呼吸、犹豫、反应；自然气口0.2–0.4秒可作口播起点，纪录情绪停顿可保留更长。工具会拒绝句级或受保护内容，不能把按字数估计的字幕边界当成词级剪点。修改后回读内容与全轨同步，索引刷新后再继续。
