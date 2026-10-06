// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview-react'
import type { VideoEditPopoutWindow } from './videoEditPopoutWindow'

const popouts = vi.hoisted(() => ({ host: null as null | { api: unknown; root: HTMLElement; host: unknown }, dock: vi.fn(), dockWindow: vi.fn(), move: vi.fn(), detach: vi.fn(), target: vi.fn(), at: vi.fn((): string | null => null) }))
vi.mock('./videoEditPopouts', () => ({
  videoEditPopoutDockHost: () => popouts.host,
  dockVideoEditPopout: popouts.dock,
  dockVideoEditPopoutWindow: popouts.dockWindow,
  moveVideoEditPanelsToPopout: popouts.move,
  detachVideoEditPopoutPanel: popouts.detach,
  setVideoEditPopoutDropTarget: popouts.target,
  videoEditPopoutAt: popouts.at,
  listVideoEditPopouts: () => [{ key: 'effects', panels: ['effects', 'content'] }],
}))
const { screenToHostClient, startVideoEditPopoutDrag, startVideoEditPopoutTabDrag } = await import('./videoEditPopoutDrag')

afterEach(() => { document.body.innerHTML = ''; popouts.host = null; for (const mock of [popouts.dock, popouts.dockWindow, popouts.move, popouts.detach, popouts.target]) mock.mockReset(); popouts.at.mockReset(); popouts.at.mockReturnValue(null) })

function fakePopout() {
  return { beginMove: vi.fn(), moveWith: vi.fn(), setCollapsed: vi.fn(), endMove: vi.fn(), readBounds: () => ({ x: 2700, y: 200, width: 400, height: 300 }) } as unknown as VideoEditPopoutWindow & Record<'beginMove' | 'moveWith' | 'setCollapsed' | 'endMove', ReturnType<typeof vi.fn>>
}
function bar() { const element = document.createElement('div'); element.setPointerCapture = vi.fn(); document.body.append(element); return element }
const pointer = (element: Element, type: string, init: PointerEventInit): void => { element.dispatchEvent(new PointerEvent(type, { pointerId: 1, ...init })) }
const start = { pointerId: 1, screenX: 2750, screenY: 210, ctrlKey: false, metaKey: false }

it('主窗口坐标换算考虑界面缩放与隐形边框；拖动空白处移动窗口，在主窗口外松开只移动并记住位置', () => {
  // 125% 界面缩放、左右各 7 的隐形边框：外宽 = 1000×1.25 + 14。
  const scaled = document.implementation.createHTMLDocument(''); scaled.documentElement.dataset.uiScale = '125'
  expect(screenToHostClient({ screenX: 93, screenY: 50, outerWidth: 1264, innerWidth: 1000, innerHeight: 800, document: scaled }, 600, 550)).toEqual({ x: 400, y: 400, inside: true })
  const popout = fakePopout(); const element = bar(); const callbacks = { onCollapsedChange: vi.fn(), onMoved: vi.fn() }
  startVideoEditPopoutDrag('effects', popout, element, start, callbacks)
  pointer(element, 'pointermove', { screenX: 2751, screenY: 211 })
  expect(popout.beginMove).not.toHaveBeenCalled()
  pointer(element, 'pointermove', { screenX: 2850, screenY: 260 })
  expect(popout.beginMove).toHaveBeenCalledWith({ x: 2750, y: 210 })
  expect(popout.moveWith).toHaveBeenLastCalledWith({ x: 2850, y: 260 })
  pointer(element, 'pointerup', { screenX: 2850, screenY: 260 })
  expect(popout.endMove).toHaveBeenCalledOnce()
  expect(callbacks.onMoved).toHaveBeenCalledOnce()
  expect(popout.setCollapsed).not.toHaveBeenCalled()
  expect(popouts.dockWindow).not.toHaveBeenCalled()
})

it('指针进入主窗口落点：显示停靠指示、窗口收成标题条，松开停靠到落点；离开落点恢复；按住 Ctrl 不停靠', () => {
  const root = document.createElement('div'); document.body.append(root)
  root.getBoundingClientRect = () => new DOMRect(0, 40, 1000, 600)
  popouts.host = { api: { groups: [] } as unknown as DockviewApi, root, host: { screenX: 0, screenY: 0, outerWidth: 1000, innerWidth: 1000, innerHeight: 640 } }
  const popout = fakePopout(); const element = bar(); const callbacks = { onCollapsedChange: vi.fn(), onMoved: vi.fn() }
  startVideoEditPopoutDrag('effects', popout, element, { ...start, screenX: 1250, screenY: 310 }, callbacks)
  pointer(element, 'pointermove', { screenX: 990, screenY: 310 })
  expect(popout.setCollapsed).toHaveBeenLastCalledWith(true)
  expect(callbacks.onCollapsedChange).toHaveBeenLastCalledWith(true)
  const indicator = root.querySelector<HTMLElement>('[data-dock-drop-zone]')!
  expect(indicator.classList.contains('hidden')).toBe(false)
  pointer(element, 'pointermove', { screenX: 500, screenY: 310 })
  expect(popout.setCollapsed).toHaveBeenLastCalledWith(false)
  pointer(element, 'pointermove', { screenX: 990, screenY: 310, ctrlKey: true })
  expect(indicator.classList.contains('hidden')).toBe(true)
  pointer(element, 'pointermove', { screenX: 990, screenY: 310 })
  pointer(element, 'pointerup', { screenX: 990, screenY: 310 })
  expect(popouts.dockWindow).toHaveBeenCalledWith('effects', expect.objectContaining({ kind: 'root', side: 'right' }))
  expect(root.querySelector('[data-dock-drop-zone]')).toBeNull()
  expect(callbacks.onMoved).not.toHaveBeenCalled()
})

it('整个浮窗拖到另一个浮窗上：那个浮窗高亮，松开把这里的面板全部叠进去', () => {
  const popout = fakePopout(); const element = bar(); const callbacks = { onCollapsedChange: vi.fn(), onMoved: vi.fn() }
  popouts.at.mockReturnValue('timeline')
  startVideoEditPopoutDrag('effects', popout, element, start, callbacks)
  pointer(element, 'pointermove', { screenX: 2850, screenY: 260 })
  expect(popouts.at).toHaveBeenLastCalledWith({ x: 2850, y: 260 }, 'effects')
  expect(popouts.target).toHaveBeenLastCalledWith('timeline')
  pointer(element, 'pointerup', { screenX: 2850, screenY: 260 })
  expect(popouts.move).toHaveBeenCalledWith('timeline', ['effects', 'content'])
  expect(popouts.target).toHaveBeenLastCalledWith(null)
  expect(callbacks.onMoved).not.toHaveBeenCalled()
})

it('多面板浮窗拖一个标签：窗口不动；拖到别的浮窗叠进去，拖出所有窗口单独浮出，在自己窗口里松开不变', () => {
  const popout = fakePopout()
  const drag = (to: { screenX: number; screenY: number }) => { const element = bar(); startVideoEditPopoutTabDrag('effects', 'content', popout, element, start); pointer(element, 'pointermove', to); pointer(element, 'pointerup', to) }
  popouts.at.mockReturnValueOnce('timeline')
  drag({ screenX: 3300, screenY: 260 })
  expect(popouts.move).toHaveBeenCalledWith('timeline', ['content'])
  drag({ screenX: 3300, screenY: 700 })
  expect(popouts.detach).toHaveBeenCalledWith('content', { x: 3300, y: 700 })
  drag({ screenX: 2800, screenY: 260 })
  expect(popouts.detach).toHaveBeenCalledOnce()
  expect(popout.beginMove).not.toHaveBeenCalled()
})
