import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

import type {
  AssistantDockMode,
  AssistantPanelPosition,
  AssistantPanelSize,
} from '../store/assistantUiStore'

const VIEWPORT_GAP = 12
/** 窗口标题栏高度；停靠态紧贴其下沿 */
const TITLEBAR_HEIGHT = 40
/** 悬浮态与标题栏之间再留一档空隙，避免助手顶栏和窗口按钮贴在一起 */
const TITLEBAR_BOTTOM = 48
const PANEL_MIN_WIDTH = 320
const PANEL_MIN_HEIGHT = 320
const MIN_WORKSPACE_WIDTH = 320
/** 面板边沿离视口边缘不超过这个距离就吸附停靠；必须大于 VIEWPORT_GAP，否则永远够不着 */
const DOCK_EDGE_THRESHOLD = 48
/** 指针走过这个距离才算真的在拖，避免轻点顶栏就把停靠的侧栏弹成悬浮窗 */
const DRAG_ACTIVATION_DISTANCE = 6

export type AssistantDockEdge = Exclude<AssistantDockMode, 'floating'>

interface ViewportSize {
  width: number
  height: number
}

interface AssistantPanelLayout {
  position: AssistantPanelPosition
  size: AssistantPanelSize
}

export type AssistantResizeAxis = 'width' | 'height' | 'both'

interface AssistantWorkspaceInsets {
  left: number
  right: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function currentViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight }
}

function floatingTransform(position: AssistantPanelPosition): string {
  return `translate3d(${position.x}px, ${position.y}px, 0)`
}

/**
 * 面板的定位属性（top/bottom/left/right/width/height/transform）**只由本 hook 写**，
 * 组件的内联 style 不再声明这些键。
 *
 * 原因：拖拽期间要把停靠态的面板临时"脱手"成悬浮框跟随指针，而 React 只在 style 对象
 * 的值发生变化时才写 DOM——松手落回同一侧时 style 对象前后完全相同，React 什么都不写，
 * 面板就会永远停在脱手时的悬浮定位上。把这几个属性收归 hook 独占后不存在这个盲区。
 */
function applyPanelFrame(
  panel: HTMLDivElement,
  mode: AssistantDockMode,
  layout: AssistantPanelLayout
): void {
  const style = panel.style
  style.width = `${layout.size.width}px`
  if (mode === 'floating') {
    style.top = '0px'
    style.bottom = 'auto'
    style.left = '0px'
    style.right = 'auto'
    style.height = `${layout.size.height}px`
    style.maxWidth = `calc(100vw - ${VIEWPORT_GAP * 2}px)`
    style.maxHeight = `calc(100vh - ${TITLEBAR_BOTTOM + VIEWPORT_GAP}px)`
    style.transformOrigin = 'top left'
    style.transform = floatingTransform(layout.position)
    return
  }
  style.top = `${TITLEBAR_HEIGHT}px`
  style.bottom = '0px'
  style.height = 'auto'
  style.maxWidth = 'none'
  style.maxHeight = 'none'
  style.left = mode === 'left' ? '0px' : 'auto'
  style.right = mode === 'right' ? '0px' : 'auto'
  style.transformOrigin = mode === 'right' ? 'top right' : 'top left'
  style.transform = 'translate3d(0, 0, 0)'
}

/**
 * 吸附判定看的是**面板矩形离视口边缘有多近**，不是指针在哪。
 *
 * 按指针判定时，把宽面板推到右边缘、面板右沿已经贴死，指针却还在屏幕中间，
 * 于是"明明已经贴边了却不吸附"。判据必须和用户眼睛看到的东西一致。
 */
export function dockEdgeForLayout(layout: AssistantPanelLayout, viewport: ViewportSize): AssistantDockEdge | null {
  const leftGap = layout.position.x
  const rightGap = viewport.width - (layout.position.x + layout.size.width)
  if (leftGap > DOCK_EDGE_THRESHOLD && rightGap > DOCK_EDGE_THRESHOLD) return null
  return leftGap <= rightGap ? 'left' : 'right'
}

export function getAssistantWorkspaceInsets(
  mode: AssistantDockMode,
  width: number
): AssistantWorkspaceInsets {
  return mode === 'left'
    ? { left: width, right: 0 }
    : mode === 'right'
      ? { left: 0, right: width }
      : { left: 0, right: 0 }
}

export function clampAssistantFloatingPosition(
  position: AssistantPanelPosition,
  size: AssistantPanelSize,
  viewport: ViewportSize
): AssistantPanelPosition {
  const maxX = Math.max(VIEWPORT_GAP, viewport.width - Math.min(size.width, viewport.width) - VIEWPORT_GAP)
  const maxY = Math.max(TITLEBAR_BOTTOM, viewport.height - Math.min(size.height, viewport.height) - VIEWPORT_GAP)
  return {
    x: Math.min(Math.max(position.x, VIEWPORT_GAP), maxX),
    y: Math.min(Math.max(position.y, TITLEBAR_BOTTOM), maxY),
  }
}

export function clampAssistantPanelSize(
  mode: AssistantDockMode,
  size: AssistantPanelSize,
  position: AssistantPanelPosition,
  viewport: ViewportSize
): AssistantPanelSize {
  const minWidth = Math.min(PANEL_MIN_WIDTH, Math.max(1, viewport.width - VIEWPORT_GAP * 2))
  const minHeight = Math.min(PANEL_MIN_HEIGHT, Math.max(1, viewport.height - TITLEBAR_BOTTOM - VIEWPORT_GAP))
  const maxWidth = mode === 'floating'
    ? Math.max(minWidth, viewport.width - position.x - VIEWPORT_GAP)
    : Math.max(minWidth, viewport.width - MIN_WORKSPACE_WIDTH)
  const maxHeight = mode === 'floating'
    ? Math.max(minHeight, viewport.height - position.y - VIEWPORT_GAP)
    : Math.max(minHeight, viewport.height - TITLEBAR_BOTTOM - VIEWPORT_GAP)
  return {
    width: Math.round(clamp(size.width, minWidth, maxWidth)),
    height: Math.round(clamp(size.height, minHeight, maxHeight)),
  }
}

function normalizeLayout(
  mode: AssistantDockMode,
  layout: AssistantPanelLayout,
  viewport: ViewportSize
): AssistantPanelLayout {
  if (mode !== 'floating') {
    return {
      position: layout.position,
      size: clampAssistantPanelSize(mode, layout.size, layout.position, viewport),
    }
  }
  let position = clampAssistantFloatingPosition(layout.position, layout.size, viewport)
  const size = clampAssistantPanelSize(mode, layout.size, position, viewport)
  position = clampAssistantFloatingPosition(position, size, viewport)
  return { position, size }
}

export function resizeAssistantPanelLayout(
  mode: AssistantDockMode,
  axis: AssistantResizeAxis,
  layout: AssistantPanelLayout,
  delta: AssistantPanelPosition,
  viewport: ViewportSize
): AssistantPanelLayout {
  const widthDelta = mode === 'right' ? -delta.x : delta.x
  const desiredSize = {
    width: layout.size.width + (axis === 'height' ? 0 : widthDelta),
    height: layout.size.height + (axis === 'width' ? 0 : delta.y),
  }
  return normalizeLayout(mode, { position: layout.position, size: desiredSize }, viewport)
}

interface UseAssistantPanelInteractionInput {
  enabled: boolean
  mode: AssistantDockMode
  position: AssistantPanelPosition
  size: AssistantPanelSize
  workspaceRef: RefObject<HTMLDivElement>
  onCommitPosition: (position: AssistantPanelPosition) => void
  onCommitSize: (size: AssistantPanelSize) => void
  onCommitMode: (mode: AssistantDockMode) => void
}

interface UseAssistantPanelInteractionResult {
  /**
   * 回调 ref，不是 RefObject：面板 DOM 会随开合反复销毁重建，而本 hook 实例常驻
   * （App 的装载闩挂上就不再卸载）。定位样式若只写在 layout effect 里，重开时
   * mode/position/size 一个都没变，effect 不重跑，新建的节点就一条定位样式都拿不到，
   * `position: fixed` 退化成静态位置——面板落到左上角且顶栏被挤出可视区。
   * 改由节点挂载这一事实触发写入后，重建与首挂共用同一条路径。
   */
  panelRef: (node: HTMLDivElement | null) => void
  dragging: boolean
  resizing: AssistantResizeAxis | null
  /** 拖拽中指针停在哪条边缘；非 null 时组件渲染吸附预览 */
  dockPreview: AssistantDockEdge | null
  onDragPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>, axis: AssistantResizeAxis) => void
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLElement>, axis: AssistantResizeAxis) => void
}

function samePosition(left: AssistantPanelPosition, right: AssistantPanelPosition): boolean {
  return left.x === right.x && left.y === right.y
}

function sameSize(left: AssistantPanelSize, right: AssistantPanelSize): boolean {
  return left.width === right.width && left.height === right.height
}

export function useAssistantPanelInteraction({
  enabled,
  mode,
  position,
  size,
  workspaceRef,
  onCommitPosition,
  onCommitSize,
  onCommitMode,
}: UseAssistantPanelInteractionInput): UseAssistantPanelInteractionResult {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef<AssistantPanelLayout>({ position, size })
  const disposeRef = useRef<(() => void) | null>(null)
  const transitionRestoreFrameRef = useRef<number | null>(null)
  const restoreTransitionRef = useRef<(() => void) | null>(null)
  const dockEdgeRef = useRef<AssistantDockEdge | null>(null)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState<AssistantResizeAxis | null>(null)
  const [dockPreview, setDockPreview] = useState<AssistantDockEdge | null>(null)

  const applyCommittedLayout = useCallback((layout: AssistantPanelLayout): void => {
    layoutRef.current = layout
    const panel = panelRef.current
    if (!panel) return
    applyPanelFrame(panel, mode, layout)
  }, [mode])

  /** 节点一挂上就按当前布局落一次定位样式，不依赖 React 的依赖比较 */
  const attachPanel = useCallback((node: HTMLDivElement | null): void => {
    panelRef.current = node
    if (!node) return
    const next = normalizeLayout(mode, layoutRef.current, currentViewport())
    layoutRef.current = next
    applyPanelFrame(node, mode, next)
  }, [mode])

  const applyDragPreview = useCallback((layout: AssistantPanelLayout): void => {
    layoutRef.current = layout
    // 拖拽全程按悬浮框走：停靠态在按下时就已脱手成悬浮定位
    if (panelRef.current) panelRef.current.style.transform = floatingTransform(layout.position)
  }, [])

  const applyLiveResize = useCallback((next: AssistantPanelLayout): void => {
    // 所有尺寸读取在 pointermove 中完成；这里在同一动画帧批量写局部样式，
    // 不修改根级变量，也不触发 React/Zustand 的高频状态更新。
    layoutRef.current = next
    const panel = panelRef.current
    if (!panel) return
    panel.style.width = `${next.size.width}px`
    if (mode === 'floating') panel.style.height = `${next.size.height}px`
    const workspace = workspaceRef.current
    if (!workspace || mode === 'floating') return
    const insets = getAssistantWorkspaceInsets(mode, next.size.width)
    workspace.style.paddingLeft = `${insets.left}px`
    workspace.style.paddingRight = `${insets.right}px`
  }, [mode, workspaceRef])

  const commitLayout = useCallback((layout: AssistantPanelLayout): void => {
    if (!samePosition(layout.position, position)) onCommitPosition(layout.position)
    if (!sameSize(layout.size, size)) onCommitSize(layout.size)
  }, [onCommitPosition, onCommitSize, position, size])

  useLayoutEffect(() => {
    if (disposeRef.current) return
    const next = normalizeLayout(mode, { position, size }, currentViewport())
    applyCommittedLayout(next)
    commitLayout(next)
  }, [applyCommittedLayout, commitLayout, mode, position, size])

  useEffect(() => {
    const onViewportResize = (): void => {
      if (disposeRef.current) return
      const next = normalizeLayout(mode, layoutRef.current, currentViewport())
      applyCommittedLayout(next)
      commitLayout(next)
    }
    window.addEventListener('resize', onViewportResize)
    return () => window.removeEventListener('resize', onViewportResize)
  }, [applyCommittedLayout, commitLayout, mode])

  useEffect(() => () => {
    disposeRef.current?.()
    if (transitionRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionRestoreFrameRef.current)
      transitionRestoreFrameRef.current = null
    }
    restoreTransitionRef.current?.()
  }, [])

  const startPointerInteraction = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    kind: 'drag' | 'resize',
    axis: AssistantResizeAxis = 'both'
  ): void => {
    if (!enabled || event.button !== 0) return
    if (kind === 'drag') {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('button,input,textarea,select,a,[data-assistant-drag-ignore]')) return
    }
    // 拖拽不 preventDefault：顶栏本身可聚焦（方向键改停靠位置），阻止默认会连焦点一起吞掉。
    // 防选中由顶栏的 select-none 与激活后的 userSelect: none 负责。
    if (kind === 'resize') event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    disposeRef.current?.()
    if (transitionRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionRestoreFrameRef.current)
      transitionRestoreFrameRef.current = null
    }
    restoreTransitionRef.current?.()

    let dragOrigin = layoutRef.current
    const initialLayout = layoutRef.current
    const startPoint = { x: event.clientX, y: event.clientY }
    let pendingLayout = initialLayout
    let frameId: number | null = null
    const rootStyle = document.documentElement.style
    const bodyStyle = document.body.style
    const previousCursor = rootStyle.cursor
    const previousUserSelect = bodyStyle.userSelect
    const previousTransitionDuration = rootStyle.getPropertyValue('--assistant-layout-transition-duration')
    const restoreTransition = (): void => {
      if (previousTransitionDuration) {
        rootStyle.setProperty('--assistant-layout-transition-duration', previousTransitionDuration)
      } else {
        rootStyle.removeProperty('--assistant-layout-transition-duration')
      }
      restoreTransitionRef.current = null
    }
    restoreTransitionRef.current = restoreTransition

    // 拖拽要走过激活距离才算数：顶栏也是可点击/可聚焦区域，按下就脱手会让每一次轻点
    // 都把停靠的侧栏弹成悬浮窗。缩放手柄没有这个歧义，按下即生效。
    let activated = kind === 'resize'
    const activate = (): void => {
      activated = true
      rootStyle.cursor = kind === 'drag' ? 'grabbing' : axis === 'height' ? 'ns-resize' : axis === 'both' ? 'nwse-resize' : 'ew-resize'
      bodyStyle.userSelect = 'none'
      if (kind === 'resize') {
        rootStyle.setProperty('--assistant-layout-transition-duration', '0ms')
        setResizing(axis)
        return
      }
      // 停靠态在这一刻「脱手」：保留当前左上角，换成悬浮尺寸，之后整段拖拽都按悬浮框计算。
      // 工作区的让位内边距留到松手才变，避免拖动过程中整页跟着抖。
      if (mode !== 'floating' && panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect()
        const detached = normalizeLayout(
          'floating',
          { position: { x: rect.left, y: rect.top }, size: layoutRef.current.size },
          currentViewport()
        )
        layoutRef.current = detached
        dragOrigin = detached
        applyPanelFrame(panelRef.current, 'floating', detached)
      }
      setDragging(true)
    }
    if (activated) activate()

    const flush = (): void => {
      frameId = null
      if (kind === 'resize') applyLiveResize(pendingLayout)
      else applyDragPreview(pendingLayout)
    }
    const queueLayout = (layout: AssistantPanelLayout): void => {
      pendingLayout = layout
      if (frameId === null) frameId = window.requestAnimationFrame(flush)
    }
    const onPointerMove = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== event.pointerId) return
      const delta = { x: pointerEvent.clientX - startPoint.x, y: pointerEvent.clientY - startPoint.y }
      if (kind === 'drag') {
        if (!activated) {
          if (Math.hypot(delta.x, delta.y) < DRAG_ACTIVATION_DISTANCE) return
          activate()
        }
        const viewport = currentViewport()
        const next = {
          position: clampAssistantFloatingPosition({
            x: dragOrigin.position.x + delta.x,
            y: dragOrigin.position.y + delta.y,
          }, dragOrigin.size, viewport),
          size: dragOrigin.size,
        }
        const edge = dockEdgeForLayout(next, viewport)
        if (edge !== dockEdgeRef.current) {
          dockEdgeRef.current = edge
          setDockPreview(edge)
        }
        queueLayout(next)
      } else {
        queueLayout(resizeAssistantPanelLayout(mode, axis, initialLayout, delta, currentViewport()))
      }
    }
    const cleanup = (deferTransitionRestore = false): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = null
      rootStyle.cursor = previousCursor
      bodyStyle.userSelect = previousUserSelect
      dockEdgeRef.current = null
      setDockPreview(null)
      if (deferTransitionRestore) {
        transitionRestoreFrameRef.current = window.requestAnimationFrame(() => {
          transitionRestoreFrameRef.current = null
          restoreTransition()
        })
      } else {
        restoreTransition()
      }
      disposeRef.current = null
    }
    const finish = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== event.pointerId) return
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      // 没走过激活距离就是一次点击，不改任何布局
      if (!activated) {
        cleanup(false)
        return
      }
      if (kind === 'resize') {
        applyLiveResize(pendingLayout)
        commitLayout(pendingLayout)
      } else {
        // 松手落位：贴边就停靠，否则留在悬浮。停靠时也把悬浮位置一并存下，
        // 下次再拖出来才会回到用户上次放的地方。
        const nextMode: AssistantDockMode = dockEdgeRef.current ?? 'floating'
        layoutRef.current = pendingLayout
        if (panelRef.current) applyPanelFrame(panelRef.current, nextMode, pendingLayout)
        commitLayout(pendingLayout)
        if (nextMode !== mode) onCommitMode(nextMode)
      }
      setDragging(false)
      setResizing(null)
      cleanup(kind === 'resize')
    }
    disposeRef.current = () => cleanup(false)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [applyDragPreview, applyLiveResize, commitLayout, enabled, mode, onCommitMode])

  const onDragPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    startPointerInteraction(event, 'drag')
  }, [startPointerInteraction])

  const onResizePointerDown = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    axis: AssistantResizeAxis
  ): void => startPointerInteraction(event, 'resize', axis), [startPointerInteraction])

  const onResizeKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLElement>,
    axis: AssistantResizeAxis
  ): void => {
    const step = event.shiftKey ? 32 : 16
    const widthChange = axis !== 'height'
      ? event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
      : 0
    const heightChange = axis !== 'width'
      ? event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
      : 0
    if (widthChange === 0 && heightChange === 0) return
    event.preventDefault()
    const pointerDelta = { x: mode === 'right' ? -widthChange : widthChange, y: heightChange }
    const next = resizeAssistantPanelLayout(mode, axis, layoutRef.current, pointerDelta, currentViewport())
    applyCommittedLayout(next)
    commitLayout(next)
  }, [applyCommittedLayout, commitLayout, mode])

  return {
    panelRef: attachPanel,
    dragging,
    resizing,
    dockPreview,
    onDragPointerDown,
    onResizePointerDown,
    onResizeKeyDown,
  }
}
