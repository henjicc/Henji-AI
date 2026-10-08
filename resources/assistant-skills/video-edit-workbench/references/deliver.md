# 交付、改画幅与收录

> 何时读：选导出预设、指定范围、多序列导出、横版改竖版或把完成结果收进资产库时读。

## 导出前自检

- 简报与结构：目标序列、时长、画幅、帧率、片头片尾及声音符合约定；停留长短有理由，不用同一个快剪套路验所有项目。
- 时间线：查末尾多余声音、禁用片段、空隙、锁轨、来源缺失、跟踪及长任务状态；确认字幕和标记在剪后位置。
- 画面：取片头、关键停留、调色交接、转场附近与片尾，真实读取；竖版看主体与字幕，循环看首末接缝。
- 声音：核实声音角色、静音／独奏、音量与淡化、声道、目标响度；未试听或未最终测量就保留说明。
- 文本与依赖：错字、专名、译文、字体、图片及代码素材依赖；按要求烧录或单独交字幕。
- 保存与证据：保存失败先 `save_video_edit`，不能靠再提交导出来证明已保存。工具回执、结构、已看帧、听感、成片检查分别报告，不把一种当全部验收。

## 预设与范围

先读 `video_edit.export_preset`，再 `export_video_edit`。不猜预设ID或输出路径，文件由本机正式选择流程授权。

单项可给 format=mp4/aac/wav/srt/vtt、range、loudness，或完整 settings；settings 不能混 format/loudness/subtitleClock。完整设置查正式 schema：codec=avc/hevc、bitrateMode=vbr/cbr、encoderPreference=hardware/software、captionMode=none/burn/srt/vtt；不编造ProRes或VBR双次编码选项。只用预设或省略设置会适配设备，完整 settings 不支持时明确拒绝；回读 queue.settings 确认实际编码与规格。

range 的 startFrame 包含、endFrame 不包含；省略用序列入出点，无入出点用整序列。范围标记在 `video_edit.document.timeline_view` 的 inFrame/outFrame，修改需合并其他视图字段。独立 SRT/VTT 不接受自定义 range，使用时间线入出点；subtitleClock=range 从导出入点计零，sequence 保持原序列钟，只用于独立字幕。视频旁带字幕的自定义范围用完整 settings.captionMode。

## 多项导出

exports 每项可给 documentRef、sequenceRef、presetRef、settings、fit、range；用了 exports 就不能混顶层 format/settings/range/loudness/subtitleClock/retryTaskId。此示例仅示调用形状，引用替换为正式返回值；外部MCP写工具另带 operationId。

```json
{
  "tool": "export_video_edit",
  "input": {
    "documentRef": {"kind": "video_edit.document", "id": "替换为文档引用"},
    "exports": [
      {"sequenceRef": {"kind": "video_edit.sequence", "id": "替换为横版序列引用"}, "presetRef": {"kind": "video_edit.export_preset", "id": "替换为实际预设引用"}},
      {"sequenceRef": {"kind": "video_edit.sequence", "id": "替换为竖版序列引用"}, "range": {"startFrame": 0, "endFrame": 90}}
    ]
  }
}
```

90只是范围示例，不规定成片时长。队列串行编码，`query_video_edit_export` 查 documentRef，可带 taskId；`cancel_video_edit_export` 的 taskId 用 queue.id，只取消明确项，省略会取消此剪辑全部未完成项。需要取消一项时不要省略。失败 retryTaskId 使用原快照，不能混新设置；已发布输出只恢复收录，不重新编码。

## 竖版改画幅

`auto_reframe_video_edit` 给 documentRef、sequenceRef、targetSize（如1080×1920），复制成新序列；给 clipRef 则只改原片段，两者二选一。settings.motion=slow/default/fast，attention=auto/person/face/tracker；tracker 模式用 trackerBindings 指定已完成框／形状跟踪器。1:1可试1080×1080，4:5可试1080×1350，尺寸优先按交付要求。

算法先生成位置／必要缩放曲线，人校正遗漏；无检测保持构图，主体装不下、手动运动冲突等会提示或拒绝，不承诺全片每帧都跟好。它保留手动点，但字幕／图文构图需另查，不能只裁主体就算竖版完成。exportPresetRef 可入队；取消文件选择不删除已生成序列。

## 结果闭环

query 返回 completed 且 outputReady 才表示已核验输出，排队成功不是成片成功。自动收录时用 queue.assetRef；需要另收录时 `collect_video_edit_output` 给 documentRef、kind=export、taskId（已完成项 id 或 taskId），可给 libraryRef。返回 asset 引用可直接流往画布、另一剪辑或其他正式媒体消费入口。

核对队列实际分辨率／帧率／时长范围／响度与素材引用；有最终文件读取和相应模态再检查首尾、字幕、接缝、听感。当前没有独立公开导出成片取帧与编码后响度复测能力，不将节目帧或PCM报告说成最终编码文件验收。交付列实际位置、可编辑序列、已验证及未验证内容。
