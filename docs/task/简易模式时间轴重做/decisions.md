# 简易模式时间轴重做 · 补充技术决策

本文件记录第一阶段执行过程中，在任务文件既定方案基础上做出的补充性技术决策（非重要记录里已定稿的产品决策，那些见 `重要记录.md`）。

## 决策 D1：`addShot` 需要同步移动播放头到新卡起点

- 日期：2026-07-11（1.3 执行时发现并修复）
- 背景：1.3 给 `compileSimpleEdit`/`captureIntoSelectedShot` 接入了"播放头必须落在选中卡自己的静止段内才允许捕获编辑"的守卫（重要记录 003）。回归测试时发现 `addShot`（`store/shotSlice.ts`）原实现只切换 `selectedShotId`，不移动 `playback.currentTime`——`selectShot` 会移动播放头，但 `addShot` 不会。这导致"新建镜头卡后立即拖拽 gizmo 调整画面"这个高频操作被新守卫拦截：新卡的静止段起点在时间轴上更靠后，而播放头还停留在旧位置，guard 判断"播放头不在选中卡静止段内"从而拒绝捕获。
- 决定：`addShot` 补上与 `selectShot` 一致的播放头跳转逻辑（复用已有的 `shotStartTime` helper），插入新卡后把 `playback.currentTime` 设为新卡起点。新卡创建时（`createShot`）已经从当前 `state.objects` 取过一次快照，因此这里只需要挪播放头，不需要重新采样对象。
- 影响范围：`store/shotSlice.ts` 的 `addShot`；顺带修复了 1.2 引入的"scrub 跟随选中"逻辑里一个潜在的连带问题——如果 `addShot` 后播放头不同步，1.2 的跟随 `useEffect` 会在下一次渲染时把 `selectedShotId` 错误地跟随回旧播放头所在的卡，与"新建即选中新卡"的预期相悖。
- 验证：`store/shotSlice.test.ts` 存量用例（"编辑对象时原子写回选中卡并保留完整编译产物""选择镜头卡会应用快照并定位到卡片起点"）在接入 1.3 守卫后一度失败，修复后全部恢复通过；新增用例进一步显式覆盖了"过渡段/别的卡静止段编辑被跳过、回到静止段后正常捕获"的行为。

## 决策 D2：过渡气泡顶部"速度预设"实现为批量应用，不是单一状态展示

- 日期：2026-07-11（1.3 执行时）
- 背景：`01-实施方案.md` 的过渡气泡设计写"顶部常用区：过渡时长（帧）+ 速度预设"，但数据模型里 `speedPreset` 是逐对象字段（`StageShotTransitionObjectDetail.perObject[id].speedPreset`），不存在卡级别的统一速度预设值，因此顶部控件不可能像时长输入框那样展示/编辑一个单一真值。
- 决定：顶部"速度预设"实现为一个"批量设置"下拉——选中某个预设后，一次性把该预设写入本段过渡中**当前有差异的全部对象**的 `perObject[id].speedPreset`；不维持自己的选中态展示（因为多对象值可能不一致，展示任一值都会误导）。下方折叠的"逐对象细节"区仍可对单个对象二次覆盖。没有变化对象时该控件禁用。
- 选择原因：保留"顶部常用区快速设置"的可用性，同时不假造一个不存在的卡级别字段，也不掩盖逐对象覆盖的能力。
- 影响范围：`simple/timeline/TransitionPopover.tsx`。

## 决策 D3：时间码组件在 1.2 直接实现记录 008 最终方案，不做秒模式占位

- 日期：2026-07-11
- 背景：1.2 任务文件原文写"时间码显示先沿用 formatTimecode 秒模式，重要记录 008 待确认"，但下发任务时已明确告知记录 008 是最终定案（纯秒/纯帧/秒:帧三态，Ctrl+点击循环切换），不需要再走占位实现再改一轮。
- 决定：1.2 执行时直接新建 `shotTimecodeFormat.ts`（格式化纯函数）+ `ShotTimecodeText.tsx`（Ctrl+点击交互），秒:帧格式采用 SMPTE 风格 `hh:mm:ss:ff`，与概念图 `00:00:04:23` 对齐。
- 影响范围：`simple/timeline/shotTimecodeFormat.ts`、`simple/timeline/ShotTimecodeText.tsx`；1.2 任务文件"当前情况"章节的旧描述未回改（保留原始设计记录，实际执行以任务状态里的"执行记录"为准）。

## 决策 D4：2.1 与 2.2 合并实现、合并交付，但拆成两次独立提交

- 日期：2026-07-11（第二阶段执行时）
- 背景：2.1（trim）与 2.2（重排）任务文件标注"可并行设计但顺序实现"，且都改动同一批文件
  （`ShotClipTrack.tsx`/`StaticClipBlock.tsx`/`TransitionClipBlock.tsx`）——两者的手势命中区互斥
  （块身 vs 右边缘），一次性把两套 pointer 事件都设计进组件 props 比先实现一套再回头拆分/插入
  第二套更不容易出现手势冲突遗漏，因此实际编码是合并进行的。
- 决定：编码合并进行，但提交仍按任务粒度拆成两次独立 commit——先把 `ShotTimelinePanel.tsx`
  还原成"只接入 2.2 的 `reorderShot` 透传、不含 2.3 滚轮缩放"的中间态提交为 2.1+2.2 一次提交
  （commit message 显式写明"2.1 块边缘拖拽调时长 + 2.2 变宽块拖拽重排"，不假装是纯 2.1），
  随后再补上 2.3 的滚轮缩放/自适应改动作为第二次提交。`useClipTrim.ts`/`useClipReorder.ts`
  两个 hook 本身职责边界清晰、互不依赖，可独立阅读/复用，未来如需回退其中一个手势，
  按 hook 文件单独回退即可。
- 影响范围：仅提交历史组织方式，不影响功能边界或代码结构。

## 决策 D5：2.1 trim 浮签与 2.2 插入指示线复用同一层叠加 overlay，不新建独立组件

- 日期：2026-07-11
- 背景：trim 拖拽需要"实时时长浮签"，重排拖拽需要"插入位置指示线"，两者都只在对应拖拽会话
  存在时短暂出现，且都需要基于 `buildClipLayout` 算出的像素坐标定位。
- 决定：不新建独立组件文件，直接在 `ShotClipTrack.tsx` 内以两个 `pointer-events-none` 的绝对定位
  `<div>` 实现（`trimBlock`/`insertIndicatorX` 两个 `useMemo` 算坐标），复用 `formatShotTimecode`
  格式化浮签文案。两者互斥出现（trim 与重排的命中区分离，同一时刻只可能触发其一），不存在层叠冲突。
- 影响范围：`ShotClipTrack.tsx`。

## 决策 D6：滚轮缩放触发条件与专业模式保持一致（Alt+滚轮），未额外支持 Ctrl+滚轮

- 日期：2026-07-11
- 背景：2.3 任务文件写"Ctrl/无修饰滚轮（与专业模式行为保持一致，执行时对照 TimelinePanel 的触发条件）"，
  两种表述指向不完全一致；专业模式 `timeline/TimelinePanel.tsx` 的 `handleWheel` 实际触发条件是
  `event.altKey`（Alt+滚轮），既是任务文件里明确要求"照抄"的参照实现，也是当前项目里唯一已验证
  、不与原生页面/浏览器缩放及普通滚动手势冲突的现成方案。
- 决定：以"与专业模式行为保持一致"为准，直接复用 Alt+滚轮触发（`event.altKey`），未额外实现
  Ctrl+滚轮或无修饰滚轮触发缩放（无修饰滚轮已占用垂直/水平滚动语义，不能同时挪作缩放用）。
- 影响范围：`ShotTimelinePanel.tsx` 的 `handleWheel`。
