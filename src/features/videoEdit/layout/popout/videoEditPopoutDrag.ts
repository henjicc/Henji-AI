import { createDockDropIndicator, resolveDockDropZone, type DockDropIndicator, type DockDropZone } from '@/components/dockviewDocking'
import type { VideoEditPanelId } from '../videoEditDockLayout'
import type { VideoEditPopoutWindow } from './videoEditPopoutWindow'
import { detachVideoEditPopoutPanel, dockVideoEditPopout, dockVideoEditPopoutWindow, listVideoEditPopouts, moveVideoEditPanelsToPopout, setVideoEditPopoutDropTarget, videoEditPopoutAt, videoEditPopoutDockHost } from './videoEditPopouts'

/**
 * 独立窗口标题栏拖动（窗口没有系统边框，也不用 `-webkit-app-region: drag`——那样拿不到指针事件）。
 *
 * 拖标题栏（含面板标签）移动窗口；指针进入主窗口的停靠区域时，在主窗口显示与 Dock 内拖动相同的停靠／编组指示，
 * 窗口收成只剩标题条（PR 拖动时的浮动窗口预览是“浅色标题条 + 面板虚影”，也避免窗口盖住指示），松开即停靠；
 * 离开落点恢复原尺寸；指针落在另一个浮窗上时那个浮窗的标题栏高亮，松开就把这里的面板全部叠进那个浮窗（PR 浮动窗口编组）；
 * 在主窗口外或没有落点处松开只移动窗口。按住 Ctrl 不停靠（PR：Ctrl 拖动 = 保持浮动）。
 * 多面板浮窗里拖一个标签（startVideoEditPopoutTabDrag）只带走这个面板：窗口不动，落点同上，拖到所有窗口外就单独浮出。
 * 窗口几何（跟随、收起、最大化时先还原）由窗口宿主执行，桌面端交给主进程（见 videoEditPopoutWindow.ts）。
 *
 * 事件来自浮窗文档（portal 进子窗口的 React 节点），坐标用 screenX/Y（DIP），与 moveTo 同一坐标系。
 */

const DRAG_THRESHOLD = 4

type PointerLike = Pick<PointerEvent, 'pointerId' | 'screenX' | 'screenY' | 'ctrlKey' | 'metaKey'>

/**
 * 屏幕坐标 → 主窗口客户区坐标。主窗口无系统边框，但 Windows 上 `screenX/outerWidth` 含左右下三边的隐形缩放边框：
 * 左边框 = (外宽 − 内宽×缩放) / 2，上边无。界面缩放（webContents 缩放）取根元素的 `data-ui-scale`（百分比）。
 */
export function screenToHostClient(host: Pick<Window, 'screenX' | 'screenY' | 'outerWidth' | 'innerWidth' | 'innerHeight'> & { document?: Document }, screenX: number, screenY: number): { x: number; y: number; inside: boolean } {
  const percent = Number(host.document?.documentElement.dataset.uiScale)
  const zoom = Number.isFinite(percent) && percent > 0 ? percent / 100 : 1
  const left = Math.max(0, (host.outerWidth - host.innerWidth * zoom) / 2)
  const x = (screenX - host.screenX - left) / zoom
  const y = (screenY - host.screenY) / zoom
  return { x, y, inside: x >= 0 && y >= 0 && x <= host.innerWidth && y <= host.innerHeight }
}

export interface VideoEditPopoutDragCallbacks {
  /** 窗口收成标题条／恢复：标题条状态下面板内容不必排版。 */
  onCollapsedChange: (collapsed: boolean) => void
  /** 窗口位置变了（未停靠），用于记住位置。 */
  onMoved: () => void
}

/** 主窗口里的停靠落点；指针不在主窗口、按住 Ctrl 或 Dock 未就绪时为 null。 */
function dockZoneAt(event: PointerLike): { zone: DockDropZone | null; root: HTMLElement | null } {
  const target = videoEditPopoutDockHost()
  const point = target && !event.ctrlKey && !event.metaKey ? screenToHostClient(target.host, event.screenX, event.screenY) : null
  return { zone: target && point?.inside ? resolveDockDropZone(target.api, target.root, point.x, point.y) : null, root: target?.root ?? null }
}

export function startVideoEditPopoutDrag(key: string, popout: VideoEditPopoutWindow, element: Element, start: PointerLike, callbacks: VideoEditPopoutDragCallbacks): void {
  let dragging = false
  let collapsed = false
  let zone: DockDropZone | null = null
  let indicator: DockDropIndicator | null = null
  let indicatorRoot: HTMLElement | null = null
  const showZone = (next: DockDropZone | null, root: HTMLElement | null): void => {
    zone = next
    if (!next || !root) { indicator?.hide(); return }
    if (indicatorRoot !== root) { indicator?.dispose(); indicator = createDockDropIndicator(root); indicatorRoot = root }
    indicator?.show(next)
  }
  const setCollapsed = (next: boolean): void => {
    if (next === collapsed) return
    collapsed = next
    popout.setCollapsed(next)
    callbacks.onCollapsedChange(next)
  }
  let merge: string | null = null
  const finish = (): void => {
    indicator?.dispose(); indicator = null; indicatorRoot = null
    setVideoEditPopoutDropTarget(null)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
    element.removeEventListener('lostpointercapture', cancel)
  }
  const move = (raw: Event): void => {
    const event = raw as PointerEvent
    if (event.pointerId !== start.pointerId) return
    if (!dragging) {
      if (Math.hypot(event.screenX - start.screenX, event.screenY - start.screenY) < DRAG_THRESHOLD) return
      dragging = true
      popout.beginMove({ x: start.screenX, y: start.screenY })
    }
    const at = dockZoneAt(event)
    showZone(at.zone, at.root)
    merge = zone || event.ctrlKey || event.metaKey ? null : videoEditPopoutAt({ x: event.screenX, y: event.screenY }, key)
    setVideoEditPopoutDropTarget(merge)
    setCollapsed(zone !== null)
    popout.moveWith({ x: event.screenX, y: event.screenY })
  }
  const up = (raw: Event): void => {
    const event = raw as PointerEvent
    if (event.pointerId !== start.pointerId) return
    const dropped = zone; const into = merge
    finish()
    if (!dragging) return
    if (dropped) { popout.endMove(); dockVideoEditPopoutWindow(key, dropped); return }
    popout.endMove()
    if (into) { moveVideoEditPanelsToPopout(into, listVideoEditPopouts().find(entry => entry.key === key)?.panels ?? []); return }
    if (collapsed) { collapsed = false; callbacks.onCollapsedChange(false) }
    callbacks.onMoved()
  }
  const cancel = (raw: Event): void => {
    if ((raw as PointerEvent).pointerId !== start.pointerId) return
    finish()
    if (!dragging) return
    popout.endMove()
    if (collapsed) { collapsed = false; callbacks.onCollapsedChange(false) }
  }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
  element.addEventListener('lostpointercapture', cancel)
  try { element.setPointerCapture(start.pointerId) } catch { /* 指针已抬起：pointerup 仍会收尾 */ }
}

/**
 * 多面板浮窗里拖一个标签：窗口不动，只带走这个面板。落在主窗口停靠区就停靠，落在另一个浮窗上就叠进去，
 * 拖出自己的窗口又没有落点就单独浮出成新窗口；没拖动（单击）不做事，由标签的单击切换当前面板。
 */
export function startVideoEditPopoutTabDrag(key: string, id: VideoEditPanelId, popout: VideoEditPopoutWindow, element: Element, start: PointerLike): void {
  let dragging = false
  let zone: DockDropZone | null = null
  let merge: string | null = null
  let indicator: DockDropIndicator | null = null
  let indicatorRoot: HTMLElement | null = null
  const finish = (): void => {
    indicator?.dispose(); indicator = null; indicatorRoot = null
    setVideoEditPopoutDropTarget(null)
    element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel); element.removeEventListener('lostpointercapture', cancel)
  }
  const move = (raw: Event): void => {
    const event = raw as PointerEvent
    if (event.pointerId !== start.pointerId) return
    if (!dragging && Math.hypot(event.screenX - start.screenX, event.screenY - start.screenY) < DRAG_THRESHOLD) return
    dragging = true
    const at = dockZoneAt(event)
    zone = at.zone
    if (zone && at.root) {
      if (indicatorRoot !== at.root) { indicator?.dispose(); indicator = createDockDropIndicator(at.root); indicatorRoot = at.root }
      indicator?.show(zone)
    } else indicator?.hide()
    merge = zone ? null : videoEditPopoutAt({ x: event.screenX, y: event.screenY }, key)
    setVideoEditPopoutDropTarget(merge)
  }
  const up = (raw: Event): void => {
    const event = raw as PointerEvent
    if (event.pointerId !== start.pointerId) return
    const dropped = zone; const into = merge
    finish()
    if (!dragging) return
    if (dropped) { dockVideoEditPopout(id, dropped); return }
    if (into) { moveVideoEditPanelsToPopout(into, [id]); return }
    const own = popout.readBounds()
    const inside = own && event.screenX >= own.x && event.screenX <= own.x + own.width && event.screenY >= own.y && event.screenY <= own.y + own.height
    if (!inside) detachVideoEditPopoutPanel(id, { x: event.screenX, y: event.screenY })
  }
  const cancel = (raw: Event): void => { if ((raw as PointerEvent).pointerId === start.pointerId) finish() }
  element.addEventListener('pointermove', move); element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel); element.addEventListener('lostpointercapture', cancel)
  try { element.setPointerCapture(start.pointerId) } catch { /* 指针已抬起：pointerup 仍会收尾 */ }
}
