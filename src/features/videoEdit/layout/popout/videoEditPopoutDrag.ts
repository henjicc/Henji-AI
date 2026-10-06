import { createDockDropIndicator, resolveDockDropZone, type DockDropIndicator, type DockDropZone } from '@/components/dockviewDocking'
import type { VideoEditPanelId } from '../videoEditDockLayout'
import type { VideoEditPopoutWindow } from './videoEditPopoutWindow'
import { dockVideoEditPopout, videoEditPopoutDockHost } from './videoEditPopouts'

/**
 * 独立窗口标题栏拖动（窗口没有系统边框，也不用 `-webkit-app-region: drag`——那样拿不到指针事件）。
 *
 * 拖标题栏（含面板标签）移动窗口；指针进入主窗口的停靠区域时，在主窗口显示与 Dock 内拖动相同的停靠／编组指示，
 * 窗口收成只剩标题条（PR 拖动时的浮动窗口预览是“浅色标题条 + 面板虚影”，也避免窗口盖住指示），松开即停靠；
 * 离开落点恢复原尺寸；在主窗口外或没有落点处松开只移动窗口。按住 Ctrl 不停靠（PR：Ctrl 拖动 = 保持浮动）。
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

export function startVideoEditPopoutDrag(id: VideoEditPanelId, popout: VideoEditPopoutWindow, element: Element, start: PointerLike, callbacks: VideoEditPopoutDragCallbacks): void {
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
  const finish = (): void => {
    indicator?.dispose(); indicator = null; indicatorRoot = null
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
    const target = videoEditPopoutDockHost()
    const point = target && !event.ctrlKey && !event.metaKey ? screenToHostClient(target.host, event.screenX, event.screenY) : null
    showZone(target && point?.inside ? resolveDockDropZone(target.api, target.root, point.x, point.y) : null, target?.root ?? null)
    setCollapsed(zone !== null)
    popout.moveWith({ x: event.screenX, y: event.screenY })
  }
  const up = (raw: Event): void => {
    const event = raw as PointerEvent
    if (event.pointerId !== start.pointerId) return
    const dropped = zone
    finish()
    if (!dragging) return
    if (dropped) { popout.endMove(); dockVideoEditPopout(id, dropped); return }
    popout.endMove()
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
