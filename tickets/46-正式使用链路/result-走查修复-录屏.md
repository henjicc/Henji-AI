# 结果：主链路走查修复（录屏侧）2026-11-13

只改代码与测试，没碰 git、没启动或重启应用、没 bundle。

## 逐条

### Q21 一次录屏的所有片段共用一个链接组（已修）
- 根因：`recordingVideoImport.ts` 的 `placeRecordingMedia` 整次导入只生成一个 `linkId`，暂停分成的每段画面、每段系统声、麦克风全挂在同一组上，裁剪或调速一段就带动全部。
- 对照：Premiere 与 DaVinci Resolve 链接的是同一片段（同一时间跨度）的画面与它的声音，导入多个片段不会互相链接（Adobe 帮助页被拒绝抓取，这里依据两家公开的产品行为；项目里 `projectItems.placeVideoEditItem` 每个素材项一组、`recordingMoviePlan` 按时间跨度一组，也是这个约定）。
- 改法：按会话暂停把片段分段，每段的画面、系统声、麦克风各成一组；段内设备空档切出的几截声音仍跟这段画面同组；只有一个片段的段不链接。早期会话没有 `pauses`、只在各轨空档里记了 `pause` 的也认（同一次暂停在声画两轨上前后差一点，先合并再计数）。
- 契约：不变。落盘格式不变；已导入的旧工程不迁移，只影响新导入。
- 同类排查：文件夹导入 / 批量放置（`placeVideoEditItems` → 每个素材项一组）、多机位（`multicam.ts` 不设链接）、口播送进剪辑（单个片段）、录制成片（`recordingMoviePlan.ts` 按 `start:duration` 一组）、重配旁白（`redub.ts` 新片段清掉链接）：都没有把不相干片段链在一起。
- 测试：`recordingVideoImport.test.ts` 新增“会话暂停分出的每段画面只和同段的系统声、麦克风链接…”；原用例里钉死“全部同一组”的断言改为按段断言。

### Q13 destination.sequenceId 不认“文档:序列”（已修）
- 根因：处理器把 `sequenceId` 原样交给导入，导入在剪辑事务里按裸 id 找序列，找不到就抛“录制期间目标序列已移除”。这句话在写入前抛出却没标成未执行，执行层只能记成结果未知。
- 改法：`applicationDomain.ts` 新增 `resolveRecordingDestination`，`start_screen_recording` 与 `import_screen_recording` 在任何写入前调用：去掉 `文档id:` 前缀（两种写法都认），打开目标剪辑核对序列存在；文档打不开、序列不在这份剪辑里、开始录制时剪辑不在项目里，都用 `notExecutedFailure` 拒绝，报错列出这份剪辑里可用的完整序列引用和名称。schema 描述写明两种写法都可以。
- 契约：只放宽输入（同一字段多认一种写法）与补说明，向后兼容。
- 测试：`applicationDomain.test.ts` 新增“目标序列认读回的‘文档:序列’与裸 id…”：错误序列 not_executed 且没开始采集、导入也没调用；组合 id 开始后按裸 id 交给采集。

### Q3 屏幕来源补分辨率、是否主屏、位置（已修）
- `screen_recording.source` 的 details 新增可选 `display`：桌面坐标 x/y/width/height、scaleFactor、primary，以及 pixelWidth/pixelHeight（实际像素）。数据本来就由主进程 `media-permissions.sources()` 给出，只是没投影。
- 契约：新增可选字段。测试：`applicationDomain.test.ts`“屏幕来源读得出实际像素分辨率…”。

### Q4 录制中 events/markers 恒为 0（已修）
- 根因：录制中事件与标记在主进程里，会话文档还没封存，计数读的是文档。
- 改法：录制中（主进程还有这个会话的快照）不给这两个字段，字段说明指向 `read_screen_recording_events`；停止后照常给。

### Q5 elapsed_ms 口径不一（已修）
- 根因：录制中用主进程的 `elapsedMs`（不含暂停）；停止后用 `max(media.monoUs + durationUs)`，是单调时钟上的结束时刻，含暂停与开头偏移。
- 改法：停止后改用 `recordingDurationUs`（共同录制区间减暂停，与成品时长同一实现），属性标题写明“不含暂停，录制中与停止后同一口径”。
- 测试（Q4、Q5 同一用例）：录制中读回 elapsed=6000、details 没有 events；停止后 8 秒区间减 2 秒暂停读回 6000，events/markers 给出。

### Q6 录屏素材项命名（已修）
- 改法：`recordingItemNames`：带会话名，只有一段不编号，暂停分成几段才写“第 N 段”，例如“走查录屏 · 屏幕 第 1 段”“走查录屏 · 麦克风”。轨道名复用同一张名称表。
- 测试：`recordingVideoImport.test.ts`“素材项带会话名…”。

### Q7 stop_screen_recording 回执不说导入了什么（已修）
- 改法：停止时自动导入的结果记在 `recordingService`（`recordingImportedOnStop`），回执的 message 列出导入的素材名、是否放进序列与起始帧；新增可选 `imported`（documentRef、sequenceRef、itemRefs）。开始时没给目标时说明没有导入、改用 `import_screen_recording`。
- 契约：新增可选输出字段。测试：同 Q13 用例的后半段，并用正式输出 schema 校验。
- 未做：停止等不及 45 秒返回 finishing 时，之后读会话 details 仍看不到导入了哪些素材（要另加 details 字段，没做）。

### Q10 开始录音的回执（已修）
- `start_audio_edit_recording` 回执新增可选 `documentName`、`outputPath`，message 写口播名和录音文件位置。新建口播叫“未命名音频 1”本身没改（属于命名规则，不在这次范围）。
- 测试：`audioEditRecording.test.ts` 第一条用例追加断言。

### 第二轮新发现：query_video_edit_export 旧完成项排在前面（已修）
- 根因：列表按 `id` 字符串排序，id 是随机 UUID，顺序与时间无关，看起来像“旧的在前”。
- 改法：最新的在前（排队、待接回没有时间的排最前；其余按完成、结束、开始时间，同时刻后加入的在前）；分页游标改为按位置续读，上一页最后一项不在了就明确报 INVALID_INPUT 让从首页读。说明里写明最新在前，并提示用 export_video_edit 回执的 `queue[].id` 作 `taskId` 精确读取（按 taskId 精确取原本就支持）。
- 契约：只改排序与说明，字段不变。测试：`videoEditExportQueue.test.tsx` 归档分页用例改成 id 字典序与完成先后不一致的数据，断言按时间最新在前（旧代码按 id 排会失败）。

## 审查第一轮（1 条重要，判定为实现疏漏，直接修）
- 重要：用户在录屏页开始的录制（handoff，快速录制另带 quick）由助手停止时，停止时走的是“送进剪辑”或“存成视频文件”分支，之前只有“开始时给了目标”的分支记下去向，回执就写成“没有导入，需要时用 import_screen_recording”，照做会多出重复素材。属于漏改已有分支，不是方案问题。改法：`recordingService` 改为按会话记下停止后的去向（`RecordingStopOutcome`：进了哪份剪辑与素材项，或存成的文件、存储中、存储失败），三个分支都记；`openRecordingInEditor` 返回这次导入的 itemIds；回执按实际去向写，进了剪辑或存成文件时不提示再导入。测试：`applicationDomain.test.ts`“用户在录屏页开始、助手停止的录制…”。
- 小问题：回执为取素材名打开剪辑失败时退回用 id 写，不让成功的停止变成报错；导出查询把运行中的也算最新、排在最前，与说明一致；`resources/assistant-skills/video-edit-workbench/references/screen-recording.md` 补了“录制中省略事件数与标记数，用 read_screen_recording_events 读”与 elapsed 口径（`check:skill-sync` 通过；这份技能只有这一处，没有第二份）。
- 记录不改：素材名“第 N 段”按每类文件计数，同一段里设备重连切出两个文件时编号会比暂停段数多。

## 改动文件
- `src/features/screenRecording/application/recordingVideoImport.ts`
- `src/features/screenRecording/application/recordingVideoImport.test.ts`
- `src/features/screenRecording/application/applicationDomain.ts`
- `src/features/screenRecording/application/applicationDomain.test.ts`
- `src/features/screenRecording/application/recordingService.ts`
- `src/features/screenRecording/application/recordingReflection.ts`
- `src/core/application-control/domains/screenRecording/recordingCapabilities.ts`
- `src/core/application-control/domains/audioEdit/audioEditRecordingCapabilities.ts`
- `src/features/audioCapture/audioEditRecording.ts`
- `src/features/audioCapture/audioEditRecording.test.ts`
- `src/features/videoEdit/application/videoEditExportCapability.ts`
- `src/core/application-control/domains/videoEdit/videoEditExportCapabilities.ts`
- `src/features/videoEdit/application/videoEditExportQueue.test.tsx`
- `resources/assistant-skills/video-edit-workbench/references/screen-recording.md`（审查轮）

内置助手与 MCP 都从同一份能力声明与处理器投影，改动同源生效。

## 验证
- 精确测试：`recordingVideoImport.test.ts`、`screenRecording/application/applicationDomain.test.ts`、`audioEditRecording.test.ts` 全部通过；`videoEditExportQueue.test.tsx` 中本次改的归档排序与分页用例通过，另有 8 条失败是原有问题：cac964260 给 `export_video_edit` 加了无窗口检查，测试替身 `src/tests/harnessNativeStorage.ts` 没实现 `runtimeInfo.headlessWindow`，所有经正式能力提交导出的用例都在入口被拒，与本次改动无关。
- 渲染层 tsc（heavy.sh，12G）：0 错误；主进程 `tsc -p tsconfig.electron.json`：0 错误（两次都包含工作区里别人未提交的改动）。
- eslint（13 个改动文件）：通过。
- 审查轮修完后重跑：两个录屏测试文件 12/12 通过；导出归档排序用例通过；渲染层与主进程 tsc 0 错误；改到文件的 eslint 通过；`check:skill-sync` 通过。
- `npm run check:assistant-capabilities:structure`：失败，只有一条，不是本次引入：`src/workspaces/GenerationWorkspace/hooks/resultSelection.ts` 的 store 没建账也没登记原因（来自 64a776803 生成页多选结果）。

## 待真实窗口验证
1. 录屏中暂停一次、停止并导入到序列：两段画面各自和同段声音成组；裁剪或调速前段，后段不动。
2. `start_screen_recording` / `import_screen_recording` 用读回的“文档:序列”成功放进序列；写一个不存在的序列返回 not_executed 与可用序列清单。
3. 录制中读会话：details 没有 events/markers，elapsed 不含暂停；停止后 elapsed 与录制中同口径。
4. 列出 `screen_recording.source`：副屏的 display.primary=false、像素分辨率正确。
5. 导入后素材库名称为“会话名 · 屏幕 第 N 段”。
6. `stop_screen_recording`（带 destination）回执列出导入的素材与序列。
7. `start_audio_edit_recording` 回执带口播名与录音文件路径。
7a. 在录屏页点开始（普通与快速各一次），由助手 `stop_screen_recording`：回执分别说明已进哪份剪辑、已存成哪个文件，不提示再导入。
8. 连续两次导出后 `query_video_edit_export` 第一项是刚提交的那次。

## 没做
- Q21 的“裁剪联动时回执不提”：分组修好后联动只在同一段内，回执没另加说明。
- Q7 的 finishing 之后在 details 里补导入结果。
