# 03 交叉审查（Opus xhigh，第 1 轮）+ 真机问题
结论：3 条必须改、9 条建议；真机另有 1 条必须改（拖动中只出 1 帧）。
处理：必须改全部修；建议 4、5、6、9、10、11、12 修，7、8 先实机核实再定；流水线未达 6.5ms 与“倍率按窗口在屏幕上的实际大小”记为遗留，不在本轮做。

## 必须改
1. `electron/main/services/web-source/page.ts:423`（同源 :432、:401）未开始就被取消的任务直接返回，不等前一任务的 previousPaint → paintTail 早于前面流水线任务的快照领取完成：C 覆盖输出画布并清 snapshotMark，A 把 C 的画面当自己的票据送出（错画面），或 A 抢走 C 的 paint、C 超时崩页并永久降级；reload() 同样与在途快照并发。取消路径也要等 previousPaint，或 paintTail 串住全部在途任务。
2. `src/features/videoEdit/engine/videoEditRenderer.ts:1558、:463`（配合 :787）取样轨道键含 webScope（渲染器实例号），updateDocument 每次结构编辑都重建嵌套与代码输入渲染器 → 嵌套网页每改一次文档就重新 openWeb（几百毫秒到数秒透明占位，旧页面 60 秒或超 4 个才回收）。
3. `src/features/videoEdit/application/videoEditExport.ts:112`（配合 webSource.ts:31-36、pages.ts:26 的 'output' 放宽）输出比序列大时比例 > 1，网页倍率被放大（1080p 序列导 4K、声明 2 → 7680×4320，多路超 512MB 预算报错、近 8192 超纹理上限）；下界没夹，小取景得 0 像素。比例上限夹到 1，有效像素夹到 [1, 8192]。
4. 真机：拖动经过未缓存网页段时整段拖动只出 1 帧（远跳页面 seek 1–2.5 秒，拖动请求等精确网页帧）。拖动也要走“一帧预算内没到就沿用该轨道上一幅（标 approximate）”，松手后补精确帧。

## 建议
4. `videoEditRenderer.ts:1558` clip.id 进轨道键：同一网页被剪成多段每段各开页面，跨剪点冷启动透明占位；护栏只需“同一帧两个时刻”分槽。
5. `:772` 结构性 updateDocument 调 invalidate() 清 session.last，播放中改一次就闪透明；只失效读请求，保留上一幅。
6. `page.ts:400` + `videoEditWebInputs.ts:162` 网页文件改动或 latest 预览请求把未开始的精确任务标 dropped，导出/预渲染该帧抛 AbortError；精确消费者应在新内容上重排这一帧。
7. `page.ts:362-365`（不确定）倍率切换：视口原点未计 viewport.scale、ceil 造成纹理比 pixelWidth 宽几像素带杂边、HiC 快照可能仍按打开时设备倍率栅格化；每次切换多等 100–500ms。
8. `page.ts:491`（不确定）快照失败后主动崩页时下一任务的 seek 可能挂在 executeJavaScript，卡满 30 秒。
9. `videoEditWebInputs.ts:166`、`videoEditRenderer.ts:1548` 每幅新建大纹理、512MB 预算不计前视与待销毁纹理；同帧同轨同时刻重复请求重复计预算。
10. `page.ts:458` 调整尺寸期间到达的取消，调整后未再检查。
11. `videoEditRenderer.ts:1527`（不确定）嵌套结果不带 approximate，回退画面被缓存成精确并在冻结帧复用。
12. `videoEditGpuCompositor.ts` blankWebPicture 1×1、boxes 为 {}，按输入宽高排版或解构 box 的作者代码会报错。

# 第 2 轮复审（同一审查员，只审增量）+ 第 2 轮真机
结论：必须改 1–4 已修；增量带出 3 条重要、2 条值得修的小问题；其余小问题无问题或属原有。
真机（10-31 12:00，窗口恢复后）：重要 3 已在真片复现——6150 起播放约 1.2 秒即报“超过显存预算”中断（3 次全中）。
处理：重要 1、2、3 与小问题 4、5 全修。

## 重要
1. `videoEditWebInputs.ts:97-103` 槽位按本帧首次出现顺序分配：同源两段叠化结束后 B 落到停在 A 时刻的槽 0，远跳 1–2.5 秒且回退画面是 A 段；槽 1 闲置。同源画中画重叠同理。槽位应延续上一帧归属或按页面当前时刻就近分配。
2. `videoEditRenderer.ts:1544` + `:1040-1049` 读下层轨道的代码输入渲染器回放除数固定为 1，根渲染器 1/2、1/4 播放时为 1/除数：同页同刻两种倍率 → 每次取帧都 resize（120–166ms），降分辨率播放/拖动时这层基本只出回退。
3. `videoEditWebInputs.ts:195-199` + `videoEditRenderer.ts:1427/1490/1981` 512MB 硬预算改成计全部存活网页纹理（前视、上一幅、待回收、复用池、60 秒闲置会话）：4 倍网页稳态 3–4 幅 ≈400–530MB，当前帧抛错。真机 6150 已复现。前视、复用池、闲置会话应是软占用：不够时先放弃前视、回收池与闲置会话，只有“本帧必须的纹理”超预算才报错。

## 小问题（修）
4. `videoEditGpuCompositor.ts:393` 透明占位报真实宽高但纹理 1×1，未用 VideoEditCodePicture 已有 `display` 区分；按 input.width 做 copyTextureToTexture 会校验失败。
5. `videoEditRenderer.ts` 近似计数从渲染开始值起算，计数器整棵树共享，同帧并发的兄弟嵌套/代码输入会被误标近似（只影响缓存复用与性能）。

# 第 3 轮复审（同一审查员，增量）+ /code-review（Claude，high）
复审：重要 1、2 与小问题 4（物理尺寸）、5 已修；重要 3 修偏 → 新重要 A：reclaim 先取消无纹理的在途读，持续压力下慢页面永远取不完、导出前视每帧建了又取消。小问题 B：帧状态单份，重叠帧互相清保护集合；C：同源硬剪点只有一个页面，B 远跳期间回退为 A 末帧（符合设计，记遗留）。
/code-review 10 条：同 A、B；deviceScale 固定为首次打开倍率（升倍率可能发糊，待核实）；updateDocument 每次全量 invalidate；复用池每到一个读就清空；lane 无调用方；512MB 字面量重复；blankWebPicture 绕建帧、作者看到 1×1；删掉了“为什么”注释；captureWeb scale 无上限。
处理：A、B、deviceScale（先核实）、invalidate、lane、预算常量、blankWebPicture、注释、scale 上限交第 4 轮定点修复；复用池清空为前视多于一幅时的分配抖动，随 A 的回收顺序一并看；作者占位宽高与硬剪点预开页面记遗留。
偏离：复审已满三轮，第 4 轮修复不再派独立复审，由 Claude 读增量 + 真机验收（理由：剩余问题局部、根因明确，真机已达标）。
