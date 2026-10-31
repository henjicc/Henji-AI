# 04 交叉审查（Opus high，第 1 轮）
结论：5 条必须改、8 条建议（13 条，见下）。处理：必须改全部修；建议 6、7、8、9、10、11、12 修，13 中重复报属原有问题可不修，offValue 小问题顺手修。
审查原文要点按条列出，位置以 worktree D:\VibeCode\Henji-AI-t04 为准。

## 必须改
1. `src/core/videoEdit/codeCanvasReview.ts:29-31` 文字撑框把“与墨迹有重叠的最小矩形”当所在框：下划线、单词荧光底、光标、小图标、进度条都会被当卡片 → 大量误报。要求候选框基本包住墨迹（墨迹中心在框内、重叠超过墨迹一半或框至少一边不小于墨迹）。
2. `src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.ts:250` 任一非 source-over 绘制或局部 clearRect 清空 canvasReview，刚记的 shadow_outside_source 也清掉；辉光常用 lighter + 阴影 → 定向漏报。文字只标“不能证明保留”，框与阴影事实不清。
3. `src/features/videoEdit/application/videoEditVisualReview.ts:39` 嵌套序列句首用整段投影与可见范围取交集：字幕开头剪在入点前时伪造句首；倒放时 from 是句尾；render-only 拆段可能各算句首（未确认）。改单点投影 {from:start,to:start} 并核对可见。
4. `videoEditVisualReview.ts:80-124` 与 `videoEditReviewCapability.ts:28` visual 默认同时开 narration 与 effects，离屏渲染次数随字幕数与效果数乘积增长，无预算，长片易超 300 秒整体失败且占用独享离屏池。事先估算并超预算提示缩小 from/to；同帧“开”基线跨效果共用（3E → E+2）。
5. `codeCanvasReview.ts:59` 与 `codeMotionReview.ts:125` visibility_dip 无时长上限：同一图层 id 分场景复用或元素出画再回，都被报“中途下降后恢复”。限定下降段最长时长（如 1 秒）或长空窗另作提示。

## 建议
6. `codeCanvasReview.ts:26,31` 合并相邻帧的 key 含 facts 下标，条件绘制会切碎连续问题；用文字内容 + 近似几何。
7. `videoEditAuthorCanvasRecorder.ts:243` 栅格坐标乘了 fullResolution，shadowOffset/blur 仍是作者单位；shadowColor 只比原始字符串（rgba 无空格、#0000 误报）。
8. `:246` 与 `author-api.md:179` 静止层栅格即整幅画布，规范行为下画布外源图形投影照常绘制 → 可能误报；只对运动层报或区分层类型（不确定）。
9. `src/core/videoEdit/effectPixelReview.ts:7` 1 个像素差 1/255 即判生效；同时返回最大差、平均差或变化像素占比。
10. `videoEditVisualReview.ts:112` 与 `videoEditMotionReviewWorkerClient.ts:10` 每次比较新建 Worker 并克隆整份 composition（比较不用它）；每次 render 还 replaceContent 序列化整份文档。复用 Worker、不传 composition。
11. `videoEditVisualReview.ts:80` 每段字幕都渲染完整根帧只为拿图层观察；无代码放置的帧白做；嵌套放置在根与嵌套文档间来回 replaceContent。
12. `codeMotionReview.ts:64` 每元素展开一次 current.values()、重算全部兄弟框，单帧 O(E²)；每帧算一次 boxes。
13. `codeCanvasReview.ts:30` 与 `videoEditAuthorRuntime.ts:143` 静止层文字超画布时与 text_clipped 重复报；flat 段 layerIndex undefined 时同一问题报 N 次（原有问题）。另 `videoEditVisualReview.ts:143` 返回原始 probe.offValue 而非校验后实际值。

## 第 2 轮复审（Opus high）
1–12 与 offValue 均已解决（7 按理由接受），13 保留。修复新引入：
- 必须改：`src/core/videoEdit/sourceMap.ts:191` 为修句首把共享函数 `projectVideoEditSequenceMapRange` 单点投影倒放分支 `<` 改 `<=`，`review.ts:100` 的 clip_boundary 与不透明度关键帧事件也走它 → 倒放嵌套里现有检查整体提前一帧。恢复原逻辑，句首在 `videoEditVisualReview.ts:43` 单独求（对 {from:S,to:S+1} 区间投影取 from）。
- 建议：`videoEditAuthorCanvasRecorder.ts:244-246` 每条指令录制都给 measure.shadowColor 赋值并跑四个正则（播放逐帧逐指令都执行）；只在有 primitive 且阴影偏移非零时规范化。
- 建议：`codeCanvasReview.ts:12-18` 要求框至少墨迹一半宽 → 文字宽过卡片一倍以上的严重撑框反而漏报；墨迹中心在框内且框高不小于墨迹高一半即为候选，宽度不设下限。
- 建议（不确定）：`videoEditVisualReview.ts:41` 嵌套从原始字幕取 start，若 contentAnchor 投影会平移字幕时间则映射错；补一条带 contentAnchor 的嵌套用例确认。
