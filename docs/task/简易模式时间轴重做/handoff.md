# 简易模式时间轴重做 · 交接说明（给第三阶段）

第一、二阶段（1.1~1.3、2.1~2.3）已完成，简易模式时间轴是端到端可用、带完整编辑手感（trim/重排/滚轮缩放）的比例块轨道。本文件写清第三阶段（多机位）需要知道的接口、数据结构与约定，避免重复造轮子或破坏既有不变量。第二阶段新增的接口见文末新增章节。

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
    ├── ShotClipTrack.tsx          # 块轨道编排：调 buildClipLayout，渲染 StaticClipBlock/TransitionClipBlock + 添加块；
    │                               # 2.1/2.2 起还负责接 useClipTrim/useClipReorder 两个 hook、trim 本地覆盖布局、浮签/插入指示线
    ├── StaticClipBlock.tsx        # 静止块：名称/时长/选中态/播放头态/双击重命名/悬浮删除/块身拖拽重排/右边缘 trim
    ├── TransitionClipBlock.tsx    # 过渡块：自身即 PanelTrigger 触发器，弹 TransitionPopover；右边缘叠加 trim 命中区
    ├── TransitionPopover.tsx      # 过渡参数气泡内容：时长(帧)+批量速度预设+可折叠逐对象细节
    ├── useClipTrim.ts             # 2.1：块右边缘 PR 式 trim 拖拽 hook（本地预览 + 松手一次性提交）
    ├── useClipReorder.ts          # 2.2：静止块块身拖拽重排 hook（含可单测的 computeInsertIndex 纯函数）
    └── useClipReorder.test.ts
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

## 关键组件 Props（第二阶段结束后的最终形态）

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
  onUpdateShotTiming: (id: string, patch: ShotTimingPatch) => void        // 来自 store，透传给 TransitionClipBlock 改时长；trim 拖拽提交也走它
  onUpdateShotTransition: (id: string, patch: ShotTransitionPatch) => void // 透传给 TransitionPopover
  onReorderShot: (id: string, toIndex: number) => void                    // 2.2 新增：重排拖拽提交，透传自 store reorderShot
  onAddShot: () => void
}
```

内部行为（3.x 如需改动块轨道渲染逻辑要知道）：

- 接入 `useClipTrim({ fps, pxPerSecond, onCommit: onUpdateShotTiming })`：拖拽中用预览值覆盖对应卡的 `hold`/`transitionDuration` 生成 `layoutShots`，再走 `buildClipLayout(layoutShots, pxPerSecond)` 重算真实布局（不是另开一套几何算法）。传给 `StaticClipBlock`/`TransitionClipBlock` 的 `shot` prop 用的是 `layoutShots[block.index]`，不是原始 `shots[block.index]`——**3.x 如果要在块上叠加机位徽标，读取的 `shot.cameraId`（3.1 新增字段）在 trim 拖拽中依然是原值，只有 `hold`/`transitionDuration` 被覆盖，不受影响**。
- 接入 `useClipReorder({ staticBlocks, trackRef, onReorder: onReorderShot, onSelect: onSelectShot })`：`staticBlocks` 从当前 `layout` 派生（`{ shotId, x, width }[]`）。
- trim 实时预览浮签、重排插入指示线都是 `ShotClipTrack.tsx` 内联的 `pointer-events-none` 绝对定位 `<div>`，没有拆独立组件（决策 D5）。

### `StaticClipBlock` / `TransitionClipBlock`

```ts
/** 块身重排 / 右边缘 trim 共用的一组 pointer 事件透传，导出自 StaticClipBlock.tsx 供 TransitionClipBlock 复用类型 */
interface ClipBlockPointerHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
}

interface StaticClipBlockProps {
  shot: StageShot
  block: ShotClipBlock   // kind 必为 'static'
  selected: boolean
  isPlayhead: boolean    // 播放头当前落在本块（跟随高亮，非选中态）
  onSelect: () => void   // 仅供键盘 Enter/Space 用；指针点击选卡走 reorderHandlers 内部的点击判定
  onRename: (name: string) => void
  onRemove: () => void
  reorderHandlers: ClipBlockPointerHandlers  // 挂在块身 wrapper 上：pointerdown 记录起点，阈值内当点击、超阈值当重排拖拽
  dragging: boolean          // 本块是否正在被重排拖拽（跟手视觉：z-30 + opacity-70 + translateX）
  dragOffsetX: number        // 重排拖拽中的水平位移 px，仅 dragging 为 true 时生效
  trimHandlers: ClipBlockPointerHandlers  // 挂在右边缘 6px 命中区
  trimming: boolean          // 本块右边缘是否正在被 trim（边框高亮）
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
  trimHandlers: ClipBlockPointerHandlers  // 挂在右边缘 6px 命中区（与 PanelTrigger 是兄弟节点，后渲染盖在其上，不会误触发气泡）
  trimming: boolean
}
```

极窄块保底最小可视宽度 16px（`MIN_VISUAL_WIDTH`/`MIN_TRANSITION_WIDTH` 常量），硬切命中区 16px（`HARD_CUT_HIT_WIDTH`），trim 边缘命中区 6px（`w-1.5`）——三者共存已在 2.1 验证过不冲突。**3.x 如果要在块内新增机位徽标之类的展示元素，注意不要挤占块身 wrapper 的 pointer 事件（`reorderHandlers` 挂在最外层 `<div>` 上），徽标本身建议用 `pointer-events-none` 或明确 `stopPropagation`（参照删除按钮/重命名输入框的处理方式），否则会打断块身拖拽重排手势。**

### 时间码组件复用

`simple/timeline/ShotTimecodeText.tsx`（`<ShotTimecodeText currentTime duration fps />`）与 `shotTimecodeFormat.ts` 的 `formatShotTimecode` 纯函数已被 2.1 的 trim 浮签复用（`formatShotTimecode(value, 'secondsFrames', fps)`），无需再重复实现格式化逻辑。

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

## 第二阶段（2.1~2.3）交付内容速览

- **2.1 trim**：静止块/过渡块右边缘拖拽调时长，1 帧吸附，拖拽中只改 `ShotClipTrack` 内的 hook 本地状态、不写 store，松手才调一次 `onUpdateShotTiming` 提交（单条撤销历史）。停留时长（hold）**现在有 UI 入口了**（右边缘拖拽），过渡时长仍可在气泡里精确输入帧数，两个入口共存。
- **2.2 重排**：静止块块身拖拽换序，4px 阈值区分点击/拖拽，松手一次性调 `onReorderShot` 提交；过渡块跟随前面的静止卡自然移动（数据层面无需额外处理）。插入位置用 `useClipReorder.ts` 导出的纯函数 `computeInsertIndex` 计算，已单测覆盖边界情况。
- **2.3 滚轮缩放**：`ShotTimelinePanel.tsx` 的 `pxPerSecond` 改为 `useState`，Alt+滚轮锚点缩放（决策 D6：与专业模式保持一致，未做 Ctrl/无修饰滚轮触发）；面板挂载/可视宽度变化/总时长变化时自动 `clampPxPerSecond(可视宽度/总时长)` 铺满可见区域，用户手动缩放一次后停止自动介入（`userZoomedRef`）；标尺缩放到 200px/s 以上自动切帧刻度。

## 已知限制 / 未完成事项

- `TransitionClipBlock` 目前没有"机位不同禁用"相关 prop，3.2 需要时自行扩展（见上方"关键组件 Props"里 `TransitionClipBlockProps` 现状）。
- trim/重排两个 hook 目前只服务于简易模式时间轴，未做成跨模式通用组件；如果专业模式未来也要类似手感，需要单独评估复用边界，不要直接跨域 import。
- 滚轮缩放的"用户已手动缩放"状态（`userZoomedRef`）是面板内部 ref，不持久化、不跟随工程保存；每次重新打开工程/切换 dock 面板都会从自适应缩放重新开始，这是当前的预期行为（未与用户单独确认是否需要记忆缩放级别，3.x 若涉及需另行确认）。
