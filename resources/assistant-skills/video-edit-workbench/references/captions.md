# 字幕与强调文字

> 何时读：给序列生成字幕、整理分段、校对原文、翻译、设置样式，或决定字幕与花字的分工时读。

## 识别和生成

1. 先查现有 `video_edit.caption` 与 `video_edit.sequence.transcript`，已有可用文本不重复识别。需要识别时 `prepare_video_edit_subtitle_audio` 给 documentRef、sequenceRef，scope=sequence/in-out/selection，可给 trackRef 指定人声轨。
2. 准备是本地混音，不计识别费；selection 保持选中声音之间的序列空隙，in-out 需要完整入出点。背景音乐太强时选清楚的人声轨。
3. 拿返回 audioDocumentRef 调 `generate_video_edit_subtitles`，给同一 documentRef/sequenceRef/audioDocumentRef，按需 modelId、language=zh/en 及分段参数。识别可能计费，先走正式审批。修改声音或时序后重新准备，迟到结果不能填进已变目标。
4. 失败保留 audioDocumentRef，先查既有口播任务与结果，再恢复；已有识别结果不重复付费。字幕开始／时长为序列帧，回读文字、范围与源关联，人工校正走通用属性。

## 分段刻度与校对

常用中文起点：每行14–18字、1–2行，约6–9字/秒，单条1–7秒；竖屏或高密信息可更短，歌词、无障碍字幕、客户规格可不同。断在语义边界，不拆姓名、数字单位或英语词；听觉断句与字幕断行可以不同。不要统一去标点或强迫“上短下长”。

maxCharacters 是每行字数，maxLines 是每条行数；pauseSeconds 可试0.4–0.8秒，minDurationSeconds 可试1秒，它只利用下一句前的空隙延伸，不保证每条强制达到目标。缺词级时刻时按比例估算，不冒充逐词对齐；数值不能代替看画面和校对专有名词。

已有长句用免费 `segment_video_edit_subtitles`，documentRef、sequenceRef，可给 captionRefs 与 maxCharacters/maxLines。以下只是调用形状，引用需换成真实返回引用；不是对所有片子的样式限制。JSON 包含工具名与业务 input，外部 MCP 写入还需正式 operationId 信封。

```json
{
  "tool": "segment_video_edit_subtitles",
  "input": {
    "documentRef": {"kind": "video_edit.document", "id": "替换为文档引用"},
    "sequenceRef": {"kind": "video_edit.sequence", "id": "替换为序列引用"},
    "maxCharacters": 16,
    "maxLines": 2
  }
}
```

后续用 `video_edit.caption.text` / `video_edit.caption.start` / `video_edit.caption.duration` / `video_edit.caption.translation` 校正。重新分段前已有译文需先清除，再分段重译；原引用保留第一段，新段引用读返回值。

## 翻译和样式

- `translate_video_edit_subtitles` 给 documentRef、sequenceRef、targetLanguage，可选 captionRefs、providerId/modelId；可能计费，不能把免费整理和翻译混同。双语流程按现有声明先 maxLines=1 整理原文，再生成下方译文；重生成替换所选译文，失败后先查原状态，不能承诺失败批次重试免费。
- 读 `video_edit.subtitle_preset` 的 style，再合并当前 `video_edit.caption.style`，同目的批量写入；字体从 `font` 实体查真实可用项，不编造字体名。
- 1080p 字号44–56像素、安全边距约画面5%–10%可作阅读起点；竖版避开实际平台遮挡区域与人脸，纪录对白可更朴素，综艺可更突出，广告可用品牌样式。视角与终端尺寸优先，不固定字幕位置、字数或字体数量。
- 花字、关键词动画和人名条若需代码素材，加载 video-edit-code-creation；字幕负责信息，花字负责强调，可并存也可按简报替代。不要把普通字幕全做成逐字弹跳。

## 核对

读回文字与范围；用 `observe_video_edit_frame` 选长句、亮背景、译文与人脸拥挤处，`read_application_media` 真读。按需检查入出帧和相邻接缝。SRT/VTT 与烧录见 deliver：结构回读不代替最终成片字幕检查。
