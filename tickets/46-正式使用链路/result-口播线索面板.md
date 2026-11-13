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

---

# 第二版：挪成常驻标签（2026-11-13 晚，按第五轮真实窗口结论改）

上文“现状 / 改动文件 / 真实窗口核对步骤 / 没做的”里关于“在自动粗剪浮层里”的内容已过时，以本节为准。

## 做了什么
- 线索列表是停靠面板 `clues`（标题“线索”，最小 240×160），默认三个布局预设里都与“文字稿”同组、排在它后面；保存过的旧布局由 `migrateAudioEditLayout` 补进文字稿那一组。组件 `workspace/AudioEditCluesPanel.tsx`，`AudioEditSuggestions.tsx` 已删除。
- 面板占满高度、列表自己滚动；底栏（`UiToolbar variant="footer"` 的 `tools`）常驻：左“待定 N · 建议抽看 M”，右上一条、下一条、只看待定。没有线索时是空态“没有要看的线索”。
- 有待定时“线索”标签后跟一个第三档数字（不铺底、不着色）。
- “自动粗剪”浮层里只剩一行入口“N 处待定 · 查看线索”，点了切到线索标签（布局里没有就加回文字稿那一组）并收起浮层。浮层在离开音频编辑（`useAppMenuVisibility`）或文字稿面板被别的标签盖住（面板可见性上下文）时自动收起。
- 选中：列表是一个焦点（listbox + aria-activedescendant），上下键移动的是选中行；行与做法按钮不留焦点，所以选中只有中性选中底，没有蓝色描边。焦点环只在键盘聚焦列表且还没有选中行时出现。
- 历史记录：一步里恰好改判一条线索时写成“线索改为留前一遍 / 两遍都留 / 换个切点 / 删掉 / 压缩 / 保留”，助手改判同样命名（前面照旧带助手标记）。
- 正在处理（workspace.disabled）时做法不可点，原因“正在处理，请稍候”。
- 文字稿标签行放工具所需的面板组宽度由 330 调到 390（同组多了一个标签）。

## 改动文件（本版）
- 新增 `src/features/audioEdit/workspace/AudioEditCluesPanel.tsx`；删除 `src/features/audioEdit/AudioEditSuggestions.tsx`
- `src/features/audioEdit/AudioEditApp.tsx`（`showPanel`，去掉 `chooseClueOption`）、`AudioEditDisclosure.tsx`（去掉不再使用的 `defaultOpen`）、`AudioEditApp.subscription.test.tsx`
- `src/features/audioEdit/workspace/`：`AudioEditDock.tsx`、`AudioEditRoughCut.tsx`、`audioEditDockLayout.ts`、`audioEditHistory.ts`、`audioEditWorkspaceContext.ts`、`audioEditWorkspace.test.ts`
- `src/features/audioEdit/audioEditClueReview.test.ts`（历史命名）
- `docs/task/界面样板屏/口播线索/`（草稿、预览图、设计说明）

## 验证
渲染层 tsc 通过；改动文件 eslint 通过；`check:surface` / `check:colors` / `check:ui-residue` / `check:icons` 通过；`audioEditClueReview.test.ts`（7）、`audioEditWorkspace.test.ts`（7）、`AudioEditAppMenus.test.tsx`、`AudioEditApp.subscription.test.tsx` 通过。真实窗口未看。

## 真实窗口核对步骤（深色，1440×900，开发版加 `--dev-checks`）
1. 打开一份做过“快速处理”、无参考稿的口播。左侧面板组的标签应为“文字稿 / 线索 N / 效果”，N 是待定数。若沿用旧布局，同样应自动多出“线索”。
2. 点“线索”：列表占满面板高度，底栏不用滚动就看得到（左计数，右三个图标）。截图 A。
3. 点第一条：播放头跳过去，行是中性底色、没有蓝色描边，行下展开做法与“试听”。截图 B。
4. 按 → 或数字键改判：勾移动、行尾做法变、底栏与标签上的待定数减一、行不跳走；Ctrl+Z 撤回。打开“历史记录”，这一步应写“线索改为…”。截图 C。
5. 回车试听；↑/↓ 换行（列表跟着滚动）；点“只看待定”。截图 D。
6. 回“文字稿”→“自动粗剪”：原“剪辑线索”一节变成一行“N 处待定 · 查看线索”；点它，浮层收起并切到线索标签。
7. 再打开“自动粗剪”浮层，直接切到剪辑工作区：浮层应消失，不挡点击。回来后再打开浮层，点同组“效果”标签：浮层应收起。
8. 把左侧面板拖到最窄（240）与窗口 960 宽：文字截断不折行，底栏工具收进“更多”，没有描红。
9. Tab 键把焦点移进线索列表（未选中行时）：列表有一圈焦点环；按 ↓ 选中后焦点环消失、只剩选中底。

## 没做的
- “建议抽看”计数不随人看过而减少、试听不在接缝后自动停、按词“隐藏这一组”：同第一版，未动。
- 用户主动关掉“线索”标签后，下次恢复布局会被补回（与“效果”标签同一机制）。
- 文字稿的工具仍在标签行插槽（旧规则存量），没有借这次迁到底栏。
