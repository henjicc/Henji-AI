import { Z_LAYERS } from '@/core/theme/zLayers'
import { positionToDirection, type DockviewApi, type DockviewGroupPanel, type DockviewOptions, type IDockviewPanel, type Position } from 'dockview-react'

/**
 * 停靠布局的 PR 式拖放（剪辑工作区与 3D 镜头参考共用，任务“剪辑对齐 PR 操作习惯”1.1，按用户 PR 录屏校正）。
 *
 * PR 的规则：
 * - 面板组或窗口的四边是“停靠区”（放下后贴在旁边、其他组让出空间），指示只是沿那条边的一条窄带（约组尺寸的 8%）；
 *   面板中部与标签栏是“编组区”（放下后叠成标签），指示是整个目标组着色。两者都是半透明的强调色着色。
 * - 在没有落点的地方松开（停靠区域外、主窗口外、副屏上）面板变成独立浮动窗口；按住 Ctrl 拖动则无论指针下有没有
 *   落点都浮出。拖到空白处时指针处显示浮动窗口预览（浅色标题条 + 面板虚影）。
 *
 * 实现分工：面板组的停靠与编组沿用 dockview 自带的判定（四边 20% 为停靠、其余为编组），指示尺寸由
 * `dropOverlayModel` 收窄为窄带；整个停靠区域四边（窗口边缘）、浮出与预览由本模块接管——dockview 的指针拖放只把
 * 事件交给指针下最近的目标，根节点四边被各组的内容目标盖住，命中不到，所以关掉它（`dndEdges: false`）。
 * 应用内浮动组不再作为入口（`disableFloatingGroups` 关掉 Shift 拖动浮出），旧布局里的浮动组恢复后贴回。
 */

/** 停靠指示窄带占目标尺寸的比例（PR 录屏约 6–10%）与最小像素。 */
const STRIP_RATIO = 0.08
const STRIP_MIN_PX = 6

/** 两个停靠布局共用的 dockview 拖放选项。 */
export const DOCKVIEW_HOST_DND_OPTIONS: Pick<DockviewOptions, 'dndStrategy' | 'disableFloatingGroups' | 'dndEdges' | 'dropOverlayModel'> = {
  dndStrategy: 'pointer',
  disableFloatingGroups: true,
  dndEdges: false,
  // 只改内容区停靠指示的大小（窄带）；判定范围仍是四边 20%。标签栏的指示保持 dockview 默认。
  dropOverlayModel: ({ location }) => location === 'content' ? { size: { type: 'percentage', value: STRIP_RATIO * 100 } } : undefined,
}

/** 距停靠区域外沿多少像素内算“贴到整个窗口边缘”。 */
export const DOCK_ROOT_EDGE_PX = 20
/** 面板组四边多大比例算停靠区（与 dockview 默认一致）。 */
const GROUP_EDGE_RATIO = 0.2

export type DockEdge = 'left' | 'right' | 'top' | 'bottom'
export interface DockRect { left: number; top: number; width: number; height: number }
/** 停靠区（贴在旁边）或编组区（叠成标签）。`rect` 为指示区域，坐标与输入点同一视口。 */
export type DockDropZone =
  | { kind: 'root'; side: DockEdge; rect: DockRect }
  | { kind: 'group'; group: DockviewGroupPanel; position: Position; rect: DockRect }
export type DockDragSource = { kind: 'panel'; panel: IDockviewPanel } | { kind: 'group'; group: DockviewGroupPanel }

/** 区分“停靠”和“编组”两种指示。 */
export function dockDropZoneKind(zone: DockDropZone): 'dock' | 'group' {
  return zone.kind === 'group' && zone.position === 'center' ? 'group' : 'dock'
}

export function rectContains(rect: DockRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
}

/** 沿某条边的窄带。 */
function edgeStrip(rect: DockRect, side: DockEdge): DockRect {
  const horizontal = side === 'left' || side === 'right'
  const band = Math.max(STRIP_MIN_PX, (horizontal ? rect.width : rect.height) * STRIP_RATIO)
  return side === 'left' ? { ...rect, width: band }
    : side === 'right' ? { ...rect, left: rect.left + rect.width - band, width: band }
      : side === 'top' ? { ...rect, height: band }
        : { ...rect, top: rect.top + rect.height - band, height: band }
}

function nearestEdge(distances: [DockEdge, number][]): [DockEdge, number] {
  return distances.reduce((best, item) => item[1] < best[1] ? item : best)
}

/** 只判定整个停靠区域的四边；点不在区域内或离边缘太远返回 null。 */
export function resolveDockRootEdge(root: DockRect, x: number, y: number): Extract<DockDropZone, { kind: 'root' }> | null {
  if (root.width <= 0 || root.height <= 0 || !rectContains(root, x, y)) return null
  const [side, distance] = nearestEdge([['left', x - root.left], ['right', root.left + root.width - x], ['top', y - root.top], ['bottom', root.top + root.height - y]])
  if (distance > DOCK_ROOT_EDGE_PX) return null
  return { kind: 'root', side, rect: edgeStrip(root, side) }
}

/** 面板组内的判定：标签栏 = 编组；内容区四边 20% = 停靠（指示为整组那条边的窄带）；其余 = 编组（整组着色）。 */
export function resolveGroupZone(group: DockRect, header: DockRect | null, x: number, y: number): { position: Position; rect: DockRect } | null {
  if (!rectContains(group, x, y)) return null
  const headerBottom = header ? header.top + header.height : group.top
  if (y <= headerBottom) return { position: 'center', rect: group }
  const content: DockRect = { left: group.left, top: headerBottom, width: group.width, height: group.top + group.height - headerBottom }
  const rx = (x - content.left) / Math.max(1, content.width)
  const ry = (y - content.top) / Math.max(1, content.height)
  const [side, distance] = nearestEdge([['left', rx], ['right', 1 - rx], ['top', ry], ['bottom', 1 - ry]])
  if (distance > GROUP_EDGE_RATIO) return { position: 'center', rect: group }
  return { position: side, rect: edgeStrip(group, side) }
}

function toRect(rect: DOMRect): DockRect { return { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }

/** 完整判定（从独立窗口拖回主窗口时用）：窗口边缘优先，其次指针下的面板组。坐标为 `root` 所在视口的客户区坐标。 */
export function resolveDockDropZone(api: DockviewApi, root: HTMLElement, x: number, y: number): DockDropZone | null {
  const edge = resolveDockRootEdge(toRect(root.getBoundingClientRect()), x, y)
  if (edge) return edge
  for (const group of api.groups) {
    if (group.api.location.type !== 'grid' || !group.api.isVisible) continue
    const header = group.element.querySelector('.dv-tabs-and-actions-container')
    const zone = resolveGroupZone(toRect(group.element.getBoundingClientRect()), header ? toRect(header.getBoundingClientRect()) : null, x, y)
    if (zone) return { kind: 'group', group, ...zone }
  }
  return null
}

/** 把面板或整组停靠到整个区域的一边。 */
export function dockSourceToRootEdge(api: DockviewApi, source: DockDragSource, side: DockEdge): void {
  const group = source.kind === 'group' ? source.group : source.panel.group.panels.length === 1 ? source.panel.group : null
  if (group) { group.api.moveTo({ position: side }); return }
  if (source.kind !== 'panel') return
  const target = api.addGroup({ direction: positionToDirection(side) })
  source.panel.api.moveTo({ group: target, position: 'center' })
}

/** 旧布局里的应用内浮动组恢复后贴回主区域（浮动统一为独立系统窗口，重要记录 001）。 */
export function dockFloatingGroupsBack(api: DockviewApi, dock: (group: DockviewGroupPanel) => void): void {
  for (const group of [...api.groups]) {
    if (group.api.location.type !== 'floating') continue
    try { dock(group) } catch { group.api.moveTo({ position: 'right' }) }
  }
}

/**
 * 最大化／还原面板组（PR 的 `` ` `` 键与“最大化面板组”）：已有最大化的组则还原；否则最大化指针下的组，
 * 指针不在任何组上时用当前活动组。返回是否有变化。
 */
export function toggleDockGroupMaximized(api: DockviewApi, point?: { clientX: number; clientY: number }, group?: DockviewGroupPanel): boolean {
  if (api.hasMaximizedGroup()) { api.exitMaximizedGroup(); return true }
  const grid = api.groups.filter(item => item.api.location.type === 'grid')
  if (grid.length < 2) return false
  const hovered = point ? grid.find(item => rectContains(toRect(item.element.getBoundingClientRect()), point.clientX, point.clientY)) : undefined
  const target = group && grid.includes(group) ? group : hovered ?? (api.activeGroup && grid.includes(api.activeGroup) ? api.activeGroup : undefined)
  if (!target) return false
  target.api.maximize()
  return true
}

/** 拖放指示：画在停靠宿主内，半透明强调色着色（与 index.css 里 dockview 自带指示同一外观）。 */
const INDICATOR_CLASS = 'bg-accent/35'
const PREVIEW_CLASS = 'flex flex-col overflow-hidden rounded-control border border-accent/60 bg-panel/50'
const PREVIEW_TITLE_CLASS = 'h-6 shrink-0 truncate bg-raised/90 px-2 text-xs leading-6 text-text1'
export interface DockDropIndicator { show(zone: DockDropZone): void; hide(): void; dispose(): void }
export function createDockDropIndicator(root: HTMLElement): DockDropIndicator {
  const element = root.ownerDocument.createElement('div')
  element.className = `${INDICATOR_CLASS} hidden`
  element.dataset.dockDropZone = ''
  element.setAttribute('aria-hidden', 'true')
  // 定位写在元素上（不藏进外观样式表）：相对停靠宿主绝对定位，压在面板内容之上、不吃指针。
  Object.assign(element.style, { position: 'absolute', zIndex: String(Z_LAYERS.drag), pointerEvents: 'none' })
  root.append(element)
  return {
    show(zone) {
      const origin = root.getBoundingClientRect()
      element.dataset.dockDropZone = dockDropZoneKind(zone)
      Object.assign(element.style, {
        left: `${Math.round(zone.rect.left - origin.left)}px`, top: `${Math.round(zone.rect.top - origin.top)}px`,
        width: `${Math.round(zone.rect.width)}px`, height: `${Math.round(zone.rect.height)}px`,
      })
      element.classList.remove('hidden')
    },
    hide() { element.classList.add('hidden') },
    dispose() { element.remove() },
  }
}

/** 浮动窗口预览（PR：拖到空白处时指针处显示浅色标题条 + 面板虚影）。只能画在主窗口内。 */
export interface DockFloatPreview { show(x: number, y: number): void; hide(): void; dispose(): void }
const PREVIEW_MAX = { width: 420, height: 300 }
export const DOCK_FLOAT_PREVIEW_GRAB = { x: 48, y: 12 }
export function createDockFloatPreview(documentRef: Document, title: string, size: { width: number; height: number }): DockFloatPreview {
  const element = documentRef.createElement('div')
  element.className = `${PREVIEW_CLASS} hidden`
  element.dataset.dockFloatPreview = ''
  element.setAttribute('aria-hidden', 'true')
  const strip = documentRef.createElement('div')
  strip.className = PREVIEW_TITLE_CLASS
  strip.textContent = title
  element.append(strip)
  Object.assign(element.style, {
    position: 'fixed', left: '0px', top: '0px', zIndex: String(Z_LAYERS.drag), pointerEvents: 'none',
    width: `${Math.round(Math.min(PREVIEW_MAX.width, Math.max(160, size.width)))}px`,
    height: `${Math.round(Math.min(PREVIEW_MAX.height, Math.max(96, size.height)))}px`,
  })
  documentRef.body.append(element)
  return {
    show(x, y) {
      element.style.transform = `translate3d(${Math.round(x - DOCK_FLOAT_PREVIEW_GRAB.x)}px, ${Math.round(y - DOCK_FLOAT_PREVIEW_GRAB.y)}px, 0)`
      element.classList.remove('hidden')
    },
    hide() { element.classList.add('hidden') },
    dispose() { element.remove() },
  }
}

export interface DockDragGestureOptions {
  /** 停靠宿主根元素（DockviewHost），用于判定窗口边缘、空白处与画指示。 */
  root: HTMLElement
  /** 该来源能否浮出为独立窗口；不提供表示此布局没有独立窗口，空白处松开不做任何事、Ctrl 不起作用。 */
  canFloat?: (source: DockDragSource) => boolean
  /** 浮出：`screen` 为松开时指针的屏幕坐标，窗口标题栏的抓取点放在这里。 */
  float?: (source: DockDragSource, screen: { x: number; y: number }) => void
}

function sourceTitle(source: DockDragSource): string {
  const panel = source.kind === 'panel' ? source.panel : source.group.activePanel
  return panel?.api.title ?? panel?.title ?? ''
}
function sourceSize(source: DockDragSource): { width: number; height: number } {
  const group = source.kind === 'panel' ? source.panel.group : source.group
  return { width: group.api.width, height: group.api.height }
}

/**
 * 接管 dockview 拖动中的三件事：按住 Ctrl 或指针在停靠区域外时不显示停靠指示、显示浮动窗口预览、松开后浮出；
 * 贴近整个停靠区域的四边时显示窗口边缘停靠指示、松开后贴到那一边。面板组的停靠与编组仍由 dockview 完成。
 */
export function bindDockDragGestures(api: DockviewApi, options: DockDragGestureOptions): () => void {
  const view = options.root.ownerDocument.defaultView ?? window
  const indicator = createDockDropIndicator(options.root)
  let active: { source: DockDragSource; float: boolean; edge: DockEdge | null; x: number; y: number; ctrl: boolean; preview: DockFloatPreview | null; detach: () => void } | null = null

  const update = (): void => {
    if (!active) return
    const floatable = Boolean(options.float) && (options.canFloat?.(active.source) ?? false)
    const outside = !rectContains(toRect(options.root.getBoundingClientRect()), active.x, active.y)
    active.float = floatable && (active.ctrl || outside)
    const zone = active.float || outside ? null : resolveDockRootEdge(toRect(options.root.getBoundingClientRect()), active.x, active.y)
    active.edge = zone?.side ?? null
    if (zone) indicator.show(zone); else indicator.hide()
    if (active.float) {
      active.preview ??= createDockFloatPreview(options.root.ownerDocument, sourceTitle(active.source), sourceSize(active.source))
      active.preview.show(active.x, active.y)
      options.root.dataset.dockFloatIntent = 'true'
    } else {
      active.preview?.hide()
      delete options.root.dataset.dockFloatIntent
    }
  }
  const end = (): void => {
    active?.detach()
    active?.preview?.dispose()
    active = null
    indicator.hide()
    delete options.root.dataset.dockFloatIntent
  }
  const begin = (source: DockDragSource, event: Event): void => {
    end()
    const pointer = event as PointerEvent
    const onMove = (next: PointerEvent): void => {
      if (!active) return
      active.x = next.clientX; active.y = next.clientY; active.ctrl = next.ctrlKey || next.metaKey
      update()
    }
    const onKey = (next: KeyboardEvent): void => {
      if (!active || (next.key !== 'Control' && next.key !== 'Meta')) return
      active.ctrl = next.ctrlKey || next.metaKey
      update()
    }
    const onUp = (next: PointerEvent): void => {
      onMove(next)
      const outcome = active
      if (!outcome) return
      const screen = { x: next.screenX, y: next.screenY }
      end()
      // dockview 在同一事件的冒泡阶段收尾（此时停靠指示已被拦下，不会落位），等它结束再改布局。
      view.setTimeout(() => {
        if (outcome.float) options.float?.(outcome.source, screen)
        else if (outcome.edge) dockSourceToRootEdge(api, outcome.source, outcome.edge)
      }, 0)
    }
    const onCancel = (): void => end()
    view.addEventListener('pointermove', onMove, true)
    view.addEventListener('pointerup', onUp, true)
    view.addEventListener('pointercancel', onCancel, true)
    view.addEventListener('keydown', onKey, true)
    view.addEventListener('keyup', onKey, true)
    active = {
      source, float: false, edge: null, x: pointer.clientX ?? 0, y: pointer.clientY ?? 0, ctrl: Boolean(pointer.ctrlKey || pointer.metaKey), preview: null,
      detach: () => {
        view.removeEventListener('pointermove', onMove, true)
        view.removeEventListener('pointerup', onUp, true)
        view.removeEventListener('pointercancel', onCancel, true)
        view.removeEventListener('keydown', onKey, true)
        view.removeEventListener('keyup', onKey, true)
      },
    }
    update()
  }
  const intercepting = (): boolean => Boolean(active && (active.float || active.edge))
  const events = [
    api.onWillDragPanel(event => begin({ kind: 'panel', panel: event.panel }, event.nativeEvent)),
    api.onWillDragGroup(event => begin({ kind: 'group', group: event.group }, event.nativeEvent)),
    api.onWillShowOverlay(event => { if (intercepting()) event.preventDefault() }),
    api.onWillDrop(event => { if (intercepting()) event.preventDefault() }),
  ]
  return () => { end(); events.forEach(event => event.dispose()); indicator.dispose() }
}
