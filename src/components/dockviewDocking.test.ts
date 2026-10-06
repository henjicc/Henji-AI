// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockviewEmitter, type DockviewApi } from 'dockview-react'
import { bindDockDragGestures, resolveDockRootEdge, resolveGroupZone, type DockDragSource } from './dockviewDocking'

const root = { left: 0, top: 40, width: 1000, height: 600 }

describe('PR 式停靠落点判定', () => {
  it('整个区域四边 20px 内是窗口边缘停靠，指示为沿边窄带（约 8%）', () => {
    expect(resolveDockRootEdge(root, 10, 300)).toMatchObject({ side: 'left', rect: { left: 0, top: 40, width: 80, height: 600 } })
    expect(resolveDockRootEdge(root, 500, 635)).toMatchObject({ side: 'bottom', rect: { left: 0, top: 592, width: 1000, height: 48 } })
    expect(resolveDockRootEdge(root, 500, 300)).toBeNull()
    expect(resolveDockRootEdge(root, 500, 10)).toBeNull()
  })

  it('标签栏与内容中部是编组（整组着色）；内容四边 20% 是停靠（整组那条边的窄带）', () => {
    const group = { left: 100, top: 100, width: 400, height: 332 }
    const header = { left: 100, top: 100, width: 400, height: 32 }
    expect(resolveGroupZone(group, header, 110, 110)).toEqual({ position: 'center', rect: group })
    expect(resolveGroupZone(group, header, 300, 280)).toEqual({ position: 'center', rect: group })
    expect(resolveGroupZone(group, header, 120, 280)).toEqual({ position: 'left', rect: { ...group, width: 32 } })
    const bottom = resolveGroupZone(group, header, 300, 420)!
    expect(bottom.position).toBe('bottom')
    expect(bottom.rect.height).toBeCloseTo(332 * 0.08)
    expect(bottom.rect.top + bottom.rect.height).toBeCloseTo(432)
    expect(resolveGroupZone(group, header, 50, 50)).toBeNull()
  })
})

describe('拖动手势', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function setup(options: { floatable: boolean }) {
    const panelDrag = new DockviewEmitter<{ panel: unknown; nativeEvent: Event }>()
    const overlays = new DockviewEmitter<{ preventDefault: () => void }>()
    const drops = new DockviewEmitter<{ preventDefault: () => void }>()
    const groupMove = vi.fn()
    const group = { panels: [{}], api: { moveTo: groupMove, width: 300, height: 200 }, activePanel: undefined }
    const panel = { id: 'effects', title: '效果控件', api: { title: '效果控件' }, group }
    group.panels = [panel]
    const api = {
      onWillDragPanel: panelDrag.event, onWillDragGroup: new DockviewEmitter().event,
      onWillShowOverlay: overlays.event, onWillDrop: drops.event,
    } as unknown as DockviewApi
    const element = document.createElement('div'); document.body.append(element)
    element.getBoundingClientRect = () => new DOMRect(0, 40, 1000, 600)
    const float = vi.fn<[DockDragSource, { x: number; y: number }], void>()
    const dispose = bindDockDragGestures(api, { root: element, canFloat: () => options.floatable, float: options.floatable ? float : undefined })
    const start = (): void => panelDrag.fire({ panel, nativeEvent: new PointerEvent('pointerdown', { clientX: 500, clientY: 300 }) })
    const overlayPrevented = (): boolean => { let prevented = false; overlays.fire({ preventDefault: () => { prevented = true } }); return prevented }
    return { start, float, groupMove, element, overlayPrevented, dispose }
  }
  const pointer = (type: string, init: PointerEventInit): void => { window.dispatchEvent(new PointerEvent(type, init)) }

  it('按住 Ctrl 松开浮出到指针处，拖动中不显示停靠指示、改显示浮动窗口预览', async () => {
    const { start, float, element, overlayPrevented } = setup({ floatable: true })
    start()
    pointer('pointermove', { clientX: 500, clientY: 300, ctrlKey: true })
    expect(overlayPrevented()).toBe(true)
    expect(element.dataset.dockFloatIntent).toBe('true')
    expect(document.querySelector('[data-dock-float-preview]')?.textContent).toBe('效果控件')
    pointer('pointerup', { clientX: 500, clientY: 300, screenX: 2900, screenY: 400, ctrlKey: true })
    expect(document.querySelector('[data-dock-float-preview]')).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(float).toHaveBeenCalledWith(expect.objectContaining({ kind: 'panel' }), { x: 2900, y: 400 })
  })

  it('不按修饰键：区域内正常停靠不干预；拖到区域外（主窗口外、副屏）松开也浮出', async () => {
    const { start, float, overlayPrevented } = setup({ floatable: true })
    start()
    pointer('pointermove', { clientX: 500, clientY: 300 })
    expect(overlayPrevented()).toBe(false)
    pointer('pointermove', { clientX: 1400, clientY: 300 })
    expect(overlayPrevented()).toBe(true)
    pointer('pointerup', { clientX: 1400, clientY: 300, screenX: 3000, screenY: 500 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(float).toHaveBeenCalledWith(expect.anything(), { x: 3000, y: 500 })
  })

  it('贴近整个区域的边缘显示窗口边缘停靠指示，松开贴到那一边；没有独立窗口时区域外松开不做任何事', async () => {
    const { start, float, groupMove, overlayPrevented } = setup({ floatable: false })
    start()
    pointer('pointermove', { clientX: 995, clientY: 300 })
    expect(overlayPrevented()).toBe(true)
    const zone = document.querySelector<HTMLElement>('[data-dock-drop-zone]')!
    expect(zone.classList.contains('hidden')).toBe(false)
    expect(zone.dataset.dockDropZone).toBe('dock')
    pointer('pointerup', { clientX: 995, clientY: 300 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(groupMove).toHaveBeenCalledWith({ position: 'right' })

    start()
    pointer('pointermove', { clientX: 1400, clientY: 300, ctrlKey: true })
    expect(overlayPrevented()).toBe(false)
    pointer('pointerup', { clientX: 1400, clientY: 300, ctrlKey: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(float).not.toHaveBeenCalled()
    expect(groupMove).toHaveBeenCalledTimes(1)
  })
})
