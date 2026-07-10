# 简易模式时间轴重做 · 交接说明（给第二/第三阶段）

第一阶段（1.1~1.3）已完成，简易模式时间轴是端到端可用的比例块轨道。本文件写清第二阶段（trim/重排/缩放）和第三阶段（多机位）需要知道的接口、数据结构与约定，避免重复造轮子或破坏既有不变量。

## 目录结构（新增文件都在这里）

```
src/features/cameraStage/simple/
├── ShotTimelinePanel.tsx          # 面板编排：工具条 + TimeRuler + ShotClipTrack + 播放头 overlay
├── TransitionObjectRow.tsx        # 逐对象过渡细节行（1.3 前就有，被 TransitionPopover 复用，未改动内部实现）
└── timeline/
    ├── shotClipGeometry.ts        # 纯函数：帧量化/钳制 + 块布局 + 命中判断 + 只读段判断（本阶段核心）
    ├── shotClipGeometry.test.ts
    ├── shotTimecodeFormat.ts      # 纯函数：三态时间码格式化
    ├── shotTimecodeFormat.test.ts
    ├── shotTimelineLayout.ts      # 布局常量（SHOT_CLIP_TRACK_HEIGHT=64），故意与组件文件分开避免 react-refresh 警告
    ├── ShotTimecodeText.tsx       # Ctrl+点击循环切换时间码格式（组件）
    ├── ShotClipTrack.tsx          # 块轨道编排：调 buildClipLayout，渲染 StaticClipBlock/TransitionClipBlock + 添加块
    ├── StaticClipBlock.tsx        # 静止块：名称/时长/选中态/播放头态/双击重命名/悬浮删除
    ├── TransitionClipBlock.tsx    # 过渡块：自身即 PanelTrigger 触发器，弹 TransitionPopover
    └── TransitionPopover.tsx      # 过渡参数气泡内容：时长(帧)+批量速度预设+可折叠逐对象细节
```

`simple/ShotCard.tsx`、`simple/TransitionDetailPanel.tsx` 已删除（分别被 `StaticClipBlock`/新气泡替代），不要再引用。

## `shotClipGeometry.ts` 导出清单（第二/三阶段的主要复用面）

```ts
// 帧量化/钳制（写入口用；读取路径不强制量化）
function quantizeToFrame(seconds: number, fps: number): number
function clampHold(seconds: number, fps: number): number         // ≥ 1 帧
function clampTransition(seconds: number, fps: number): number   // ≥ 0（第二个参数保留位，暂未使用）

// 块布局
type ShotClipBlockKind = 'static' | 'transition'
interface ShotClipBlock {
  kind: ShotClipBlockKind
  shotId: string   // 过渡块归属"前一张"静止卡（transitionDuration 挂在这张卡上）
  index: number     // 该卡在 shots 数组中的下标
  startTime: number
  endTime: number
  x: number         // = timeToX(startTime, pxPerSecond)
  width: number      // = timeToX(endTime, pxPerSecond) - x；0 帧过渡时为 0
}
function buildClipLayout(shots: StageShot[], pxPerSecond: number): ShotClipBlock[]
function findClipAtTime(layout: ShotClipBlock[], time: number): ShotClipBlock | null

// 只读段判断（2.1 trim 拖拽范围钳制、3.2 机位切换都可能要用）
function isTimeInShotStaticSegment(shots: StageShot[], shotId: string, time: number, fps: number): boolean
function isTimeInTransition(shots: StageShot[], time: number, fps: number): boolean
```

**重要**：`buildClipLayout` 的 `pxPerSecond` 只影响 `x`/`width`，不影响 `startTime`/`endTime`/`kind`/`shotId`/`index`。如果只需要时间判断（不需要渲染坐标），可以传任意正数（面板里的"选中跟随播放头"逻辑就是传 `1`）。

## 关键组件 Props

### `ShotClipTrack`

```ts
interface ShotClipTrackProps {
  shots: StageShot[]
  objects: StageObject[]
  pxPerSecond: number
  contentWidth: number   // 必须与外层 TimeRuler 的 contentWidth 一致，否则标尺与块错位
  fps: number
  selectedShotId: string | null
  currentTime: number
  onSelectShot: (id: string) => void
  onRenameShot: (id: string, name: string) => void
  onRemoveShot: (id: string) => void
  onUpdateShotTiming: (id: string, patch: ShotTimingPatch) => void        // 来自 store，透传给 TransitionClipBlock 改时长
  onUpdateShotTransition: (id: string, patch: ShotTransitionPatch) => void // 透传给 TransitionPopover
  onAddShot: () => void
}
```

**2.1（trim）落点**：`StaticClipBlock` 目前没有边缘拖拽把手；trim 应该在 `StaticClipBlock.tsx` 里新增右边缘拖拽区域（参考 `useReorderDrag.ts` 的"拖拽中只改本地视觉状态，松手一次性提交"模式），提交时调用 `onUpdateShotTiming(shotId, { hold: quantizeToFrame(clampHold(newHold, fps), fps) })`（`quantizeToFrame`/`clampHold` 已在 `shotClipGeometry.ts` 导出，直接复用，不要重新实现钳制/量化）。

**2.2（重排）落点**：`ShotClipTrack.tsx` 目前渲染逻辑是纯粹按 `buildClipLayout` 顺序绝对定位，没有拖拽重排。`reorderShot(id, toIndex)` action 在 store 里已经存在（`shotSlice.ts`），1.2 移除了旧的 `useReorderDrag` 接线（它假设等宽卡片，不适配变宽块），2.2 需要重新设计一套适配"变宽块"的拖拽重排交互，不能照抄旧 204px 硬编码偏移那套。

**2.3（滚轮缩放）落点**：`ShotTimelinePanel.tsx` 目前 `pxPerSecond` 是硬编码常量 `SHOT_TRACK_PX_PER_SECOND = 120`（不是 state）。2.3 需要改成 `useState` 并接入滚轮缩放，参考专业模式 `timeline/TimelinePanel.tsx` 的 `handleWheel`（`clampPxPerSecond`/`TIMELINE_MIN_PX_PER_SECOND`/`TIMELINE_MAX_PX_PER_SECOND` 已在 `timeline/timeScale.ts` 导出，直接复用）。

### `StaticClipBlock` / `TransitionClipBlock`

```ts
interface StaticClipBlockProps {
  shot: StageShot
  block: ShotClipBlock   // kind 必为 'static'
  selected: boolean
  isPlayhead: boolean    // 播放头当前落在本块（跟随高亮，非选中态）
  onSelect: () => void
  onRename: (name: string) => void
  onRemove: () => void
}

interface TransitionClipBlockProps {
  shot: StageShot        // "from" 卡，transitionDuration/transition 挂在它身上
  nextShot: StageShot    // "to" 卡，diffShotObjects 用
  shotIndex: number
  block: ShotClipBlock   // kind 必为 'transition'；block.width<=0 时组件内部渲染成硬切竖线
  objects: StageObject[]
  fps: number
  updateShotTiming: (id: string, patch: ShotTimingPatch) => void
  updateShotTransition: (id: string, patch: ShotTransitionPatch) => void
}
```

极窄块保底最小可视宽度 16px（`MIN_VISUAL_WIDTH`/`MIN_TRANSITION_WIDTH` 常量），硬切命中区 16px（`HARD_CUT_HIT_WIDTH`）——2.1 做 trim 拖拽把手时注意不要和这个最小宽度保底冲突（拖到极窄时视觉宽度是保底值，不是真实 `block.width`，边缘把手的命中判定建议用真实 `block.width` 而不是渲染宽度）。

### 时间码组件复用

`simple/timeline/ShotTimecodeText.tsx`（`<ShotTimecodeText currentTime duration fps />`）已经是完整实现（Ctrl+点击循环 纯秒/纯帧/秒:帧），第二阶段如果有别的地方需要展示时间码（比如 trim 拖拽时的实时数值提示），直接复用这个组件或复用 `shotTimecodeFormat.ts` 里的 `formatShotTimecode`/`nextShotTimecodeMode` 纯函数，不要重新写格式化逻辑。

## 捕获守卫（3.2 需要知道）

`store/shotSlice.ts` 新增了两个内部 helper（未导出，若第三阶段需要在别处复用相同判断逻辑，建议导出或直接调用 `isTimeInShotStaticSegment`）：

```ts
function canCaptureAtCurrentTime(state: CameraStageState): boolean
function logCaptureSkipped(selectedShotId: string): void
```

`compileSimpleEdit`/`captureIntoSelectedShot` 现在只有当"播放头落在选中卡自己的静止段内"才会把编辑写回 `shots`；否则只更新瞬时 `objects`（视觉变化）但不落盘、不重编译。**3.2 做机位切换时如果涉及"切换机位时是否允许编辑"，这个既有守卫已经处理了"过渡段不可编辑"的情况，机位切换本身如果也想复用"是否可编辑"的判断，直接调用 `isTimeInShotStaticSegment`，不要另起一套判断。**

## `addShot` 现在会移动播放头（1.3 补的修复，见 decisions.md D1）

`addShot()` 现在除了 `selectedShotId` 外，也会把 `playback.currentTime` 设到新卡起点（复用 `shotStartTime` helper）。**第二阶段做重排/trim 时如果也有"插入/移动镜头卡"的操作，务必同步检查播放头是否需要跟着移动**，否则会重新触发"选中卡与播放头不同步 → 编辑被静止段守卫拦截"的同类问题。判断标准很简单：任何让"当前选中卡"发生变化的 action，都应该让 `playback.currentTime` 落在该卡的静止段内（可以直接调用 `shotStartTime(shots, index)` 或未来提炼出的等价 helper）。

## 过渡细节入口的最终形态

过渡参数编辑已经**不再有底部抽屉**，唯一入口是点击过渡块/硬切线弹出的 `TransitionPopover`（`PanelTrigger alignment="aboveCenter"`，380px 宽）。第三阶段如果要在气泡里加"机位不同禁用过渡时长编辑"的提示（重要记录 005/3.2 需求），改动点在：

- `TransitionPopover.tsx` 的时长输入框：加一个 `disabled` prop + 提示文案。
- `TransitionClipBlock.tsx` 需要透传"两侧机位是否不同"的布尔值给 `TransitionPopover`（目前没有这个 prop，需要新增；机位数据本身在 3.1 才会加到 `StageShot`）。

## 视口只读联动（3.2 播放/视口切换要复用）

`scene/StageScene.tsx` 已经有 `isSimpleTransitionReadOnly` 判断和门槛（`editorMode==='simple' && isTimeInTransition(...)`），`scene/StageTransitionReadOnlyOverlay.tsx` 是独立的纯展示 overlay，挂载在 `layout/CameraStageDock.tsx` 的 `ViewportPanel` 里、与 `StageAspectRatioOverlay` 同级。3.2 如果要在过渡段内额外处理"渲染机位切换"，建议复用同一个 `isSimpleTransitionReadOnly`/`isTimeInTransition` 判断，不要另起一套时间段判断逻辑。

## 已知限制 / 未完成事项

- 时长精确编辑目前只有过渡时长（气泡里的"帧"输入框）；**停留时长（hold）目前完全没有 UI 入口**（旧的数字输入框在 1.2 被移除，2.1 的 trim 拖拽是唯一计划中的替代方案）。第二阶段动手前请确认这一点，不要假设"停留时长已经有地方能改"。
- 块身拖拽重排（2.2）、块边缘 trim（2.1）、滚轮缩放（2.3）均未实现，当前 `pxPerSecond` 固定 120。
- `TransitionClipBlock` 目前没有"机位不同禁用"相关 prop，3.2 需要时自行扩展。
