# 结果：口播线索面板（待办 4q3 界面层，2026-11-13）

## 现状（改前）
- 位置：文字稿标签行“自动粗剪”浮层（`AudioEditRoughCut.tsx`）里的“剪辑线索”折叠节，组件 `AudioEditSuggestions.tsx`。
- 只列 `current_state=available` 的线索（待确认重念、语气词、长停顿），按“「嗯」/停顿/重复片段”分组，每组 5 条一页；每行是时间 + 前后 2 秒的上下文文字，点击定位；每行与每组都有“删除/压缩”“隐藏”按钮，顶部一句常驻说明。
- 看不到原因、把握、候选做法、当前做法；已自动删的重念（含助手标给用户的、值得抽看的）根本不出现；不能改判（只能整条接受或隐藏）；没有试听、键盘、计数。
- 文字稿里被删的词：`UiTextToken excluded`（划线退后），语气词 `flagged`；与本次无关，未改。

## 设计取舍
见 `docs/task/界面样板屏/口播线索/设计说明.md` 与草稿预览图。要点：
- 分层：decide = 助手没处理的待确认（attention=decide）或助手标给用户的（audience=user）；check = attention=check；auto = 其余已处理的重念；hint = 语气词、长停顿。分层直接调用助手读的同一份 attention 判断（`audioEditFields.ts` 新导出），不另写一套。
- 层内按时间排（人是顺着听的），不按把握数值排。
- 改判：重念调用与助手写 `chosen_option` 相同的 `chooseAudioEditSuggestionOption`，语气词/停顿用原来的 apply / dismiss；整步一次 `editAudioEditProject`，进撤销栈。人定了 audience=user 的那条时顺手清掉 audience（等同助手把它写回 assistant），否则“待定”计数永远不减——这是唯一新增的语义，请负责人确认。
- reason 映射集中在 `audioEditClueReview.ts` 的 `RETAKE_REASONS`；没登记的 reason 落到线索类型的通用说法（重念 / 语气词 / 停顿过长）。
- 去掉了“删除这一组 / 隐藏这一组”批量按钮与分页：批量删语气词、压缩停顿上方已有同名按钮；“整组隐藏”没有替代（见“没做的”）。

## 键盘
- ↑/↓：在当前可见的行间移动并定位播放头；回车：试听（焦点在线索行或做法上时）；←/→ 循环切换做法；1–9 直接选第 n 种做法。
- 冲突核对：浮层里没有既有快捷键；编辑器的空格、工具字母、Delete、M 只在编辑器面板有焦点时生效，与浮层不冲突。Ctrl+Z 由工作区根接住，照常撤销。

## 改动文件
- `src/features/audioEdit/AudioEditSuggestions.tsx`（重写）
- `src/features/audioEdit/audioEditClueReview.ts`（新增：分层、排序、原因与做法文案、改判）
- `src/features/audioEdit/audioEditClueReview.test.ts`（新增）
- `src/features/audioEdit/AudioEditDisclosure.tsx`（加 `defaultOpen`，只取首次值）
- `src/features/audioEdit/AudioEditApp.tsx`（`resolveSuggestions` 换成 `chooseClueOption`）
- `src/features/audioEdit/workspace/audioEditWorkspaceContext.ts`（同上）
- `src/features/audioEdit/workspace/AudioEditRoughCut.tsx`（调用处）
- `src/features/audioEdit/application/audioEditFields.ts`（只加导出：`audioEditSuggestionAttention`、`audioEditSuggestionOptionTexts`、`audioEditSuggestionTexts`；字段行为不变）
- `src/i18n/locales/zh-CN/ui.json`、`en-US/ui.json`（删掉不再使用的 `audioCuesProcessed`、`audioCuesHidden` 两行）
- `docs/task/界面样板屏/口播线索/`（草稿、预览图、设计说明）

## 验证
- 渲染层 tsc（经 heavy.sh）：通过。
- eslint（全部改动文件）：通过。
- `check:surface` / `check:colors` / `check:icons` / `check:ui-residue`：通过（改动文件无告警）。
- 精确测试：`audioEditClueReview.test.ts` 6 条（分层与排序、原因映射与兜底、做法命名、改判与助手同一操作及清 audience、语气词两种做法与失败原样返回、改判后行固定而计数按真实状态）通过；`audioEditAssistantSteps.test.ts`、`AudioEditChrome.test.tsx` 回归通过。
- 真实窗口未看。

## 真实窗口核对步骤（深色，1440×900）
1. 打开一份做过“快速处理”、无参考稿的口播（无稿时待确认多）；或用助手 `clean_audio_edit_retakes` 后再把其中一条 `audio_edit.suggestion.audience` 写成 `user`。
2. 文字稿标签行点“自动粗剪”→ 浮层里“剪辑线索”应已展开（有待定时）。截图 A：默认态（实心点行在最前、空心点次之、两行汇总、底栏计数与三个工具）。
3. 点第一条待定行：播放头跳到那里，行下展开做法单选与“试听”。截图 B。
4. 点另一种做法（或按 → / 数字键）：勾移动、行尾当前做法变、底栏“待定”减一，行不跳走；Ctrl+Z 撤回。截图 C。
5. 回车：从接缝前 1.5 秒播放剪后声音（播放模式若是原声会切到剪后）。
6. ↑/↓ 在行间移动；点底栏“只看待定”：只剩实心点行、汇总行消失、图标着强调色。截图 D。
7. 展开“另有 N 处已自动处理”，选一条已处理的重念，改成“两遍都留”，文字稿对应词恢复。
8. 把浮层缩到最窄（窗口 960 宽）看长文字截断与悬停提示全称；用 `--dev-checks` 打开看是否有布局描红。

## 没做的与原因
- 仍在“自动粗剪”浮层里：点到波形等浮层外会关掉浮层，校对时得反复打开。要求不新开一屏、不改面板骨架，所以没挪；建议之后把它做成文字稿面板的一个视图或单独停靠面板，再按样板屏流程出草稿。
- “建议抽看”的计数不会因为人看过而减少：check 由把握分数决定，没有“已看过”这个数据；要加得改线索数据结构（只读不改的范围）。
- 去掉了按词“隐藏这一组”。
- 试听不会在接缝后自动停。
- 线索的生成、判定、`chosen_option` 语义未改；只有“人定了标给用户的那条时清掉 audience”是新增的组合，见上。
- 没有走“先给用户看草稿、确认后再实现”的流程：本次是委派任务，草稿与实现同时交付，请对照草稿和真实截图一起确认。
