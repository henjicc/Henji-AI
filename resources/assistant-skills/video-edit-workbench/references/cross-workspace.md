# 跨工作区与原地生成

> 何时读：把生成、画布、图片文档或口播产物放进剪辑，把节目帧送出去，或在时间线缺素材处生成时读。

## 已有产物直接复用

先读真实源引用与目标剪辑／序列／轨道。`place_video_edit_creative_result` 给 documentRef、sequenceRef、placement、result；不传网址或文件路径，不要求先收藏再复用。

| 来源 | result 的正式写法 |
| --- | --- |
| 生成历史结果 | type=generation，resultRef 为 generation.result，outputIndex 从0开始 |
| 画布结果节点（含三维结果） | type=document，documentRef 为 list_documents 返回的 documents.document，nodeRef 为 canvas.node |
| 图片文档 | type=document，documentRef 为 documents.document；导出当前编辑结果，片段保持来源链接 |
| 口播剪后声音 | type=document，documentRef 为 documents.document，可用 includeProcessing 指定是否带声音处理；不是原录音替代剪后声音 |
| 已有资产 | type=asset，assetRef 为 asset；原文件引用导入还可用 `import_video_edit_asset` |

placement.mode=library 只进素材面板；replace 给 clipRef；insert/overwrite 给 frame、trackRef，可给 durationFrames；add 给 frame 且 trackRef/newTrack 二选一，newTrack=video/audio。时长是序列帧，overwrite 会覆盖相交区间，insert 会按同步锁定后移；选择来自实际剪辑意图。

示例仅为输入形状，所有引用替换为发现结果；外部 MCP 写入另附 operationId。

```json
{
  "tool": "place_video_edit_creative_result",
  "input": {
    "documentRef": {"kind": "video_edit.document", "id": "替换为目标文档引用"},
    "sequenceRef": {"kind": "video_edit.sequence", "id": "替换为目标序列引用"},
    "placement": {"mode": "add", "frame": 90, "newTrack": "video", "durationFrames": 60},
    "result": {"type": "generation", "resultRef": {"kind": "generation.result", "id": "替换为已完成结果引用"}, "outputIndex": 0}
  }
}
```

回读返回片段／项目项及来源，检查落点、时长、画面和声音。准备期间目标改动或关闭会拒绝迟到结果，不能偷偷放到当前别的工程；先查现状，不重复插入。要回来源继续改，用 `open_video_edit_clip_source` 给 documentRef、clipRef；它会切页，仅用户要求回去编辑时用。

## 剪辑帧到图片编辑／画布

- `send_video_edit_to_canvas` 给 documentRef、sequenceRef、canvasRef，selection.kind=frame + frame，或 kind=clip + clipRef；placement 取画布正式schema。帧是最终合成，片段带当前裁切、速度、效果与链接声音，结果进目标画布撤销栈，不付费且不切页。源／目标变化后拒绝，准备完成文件可能保留，恢复前先读两端状态。
- `edit_video_edit_program_frame` 只给 documentRef，从当前序列播放头取合成并打开图片编辑器。先用 `video_edit.document.program_playback` 定位并暂停目标帧；该入口有真实导航，仅用户要求编辑画面时用。
- 进入图片编辑后从实际宿主／文档目录取得图片文档引用，经其通用实体编辑并保存；保留返回的原剪辑 documentRef、sequenceRef、frameEditSessionRef、returnPlacement。回填 `place_video_edit_creative_result` 用保存图片的 documents.document 来源，并原样带 frameEditSessionRef 与 returnPlacement（作为 placement）；时长恰为1帧，不能用普通图片默认时长。不要把返回的剪辑 documentRef 冒充图片文档。
- 只是看画面用 `observe_video_edit_frame`，取 program 目标 sequenceRef/frame 或 source 目标itemRef/timeUs，随后 `read_application_media`；无需打开图片编辑。收录选帧用 `collect_video_edit_output` 的 kind=frame，依赖当前节目已暂停和定位。

## 原地生成：计划、审批、等待、落位

1. 优先查已有产物。确需新镜头／配音／音乐，用 `prepare_video_edit_in_place_generation` 固定 documentRef、sequenceRef，target.action 为 generate_shot/replace_shot/extend_shot/generate_audio，prompt 为内容。新镜头用 startSeconds/durationSeconds，可给 trackRef；替换／续接用 clipRef；声音给 startSeconds 或 clipRef 二选一。
2. 准备校验落点、参考、参数及费用信息，不取帧、不生成、不改剪辑。模型字段按 `get_model_schema`，不编造时长／比例。referenceRoles 从返回规划选择，referenceTimeSeconds 可给指定节目时刻；仅用指定帧时 referenceRoles=[]。useReferenceFrames=false 不能同时指定参考，声音不接受参考帧。
3. 有正式付费授权后 `generate_video_edit_in_place` 用相同业务参数提交；不可由助手替用户批准。占位出现不等于已生成。已知目标要精确长度就显式给 durationSeconds，省略时规划常用5秒但落位取实际生成长度。
4. 返回 taskRef 后 `wait_generation_task` 等终态，再 `get_video_edit_in_place_generation` 给 documentRef/taskRef 查落位；生成完成不等于已放入时间线。用户取消时 `cancel_generation_task` 撤回占位，取消等待不等于取消任务。
5. 读返回 clipRef、位置、实际时长和声音；原位置被占可落新轨，说明实际位置。替换保留旧 take，需切回时读 `video_edit.clip.takes` 再 `restore_video_edit_clip_take`，takeIndex 用真实序号。

免费准备／本地跨工作区处理与付费提交分开说明。未知结果先查原操作和任务，失败后不重新生成来掩盖保存或落位问题；真实审批、任务恢复与来源身份优先于任何配方。

放入返回 partial 且保存未确认时，使用 `retry_application_operation_save`，将原调用 operationId 传给 originalOperationId；恢复会核对原 item、clip 和媒体文件内容并保存，成功后查原操作 completed/verified。`save_video_edit` 不是绕过原操作保护的入口。prepare 的 prepared=true 不保证供应商可用，canSubmit=false 时先配置供应商或改用已配置模型，不提交付费任务。
