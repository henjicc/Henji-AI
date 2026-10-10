/** @vitest-environment jsdom */
import '@/tests/imageEditDocumentFixture'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UiInput } from '@/components/ui'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { getImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import type { ImageEditorV3Controller } from '../editor/types'
import { useImageEditorSessionStoreV3 } from '../store'
import { useToolInputRouter } from './useToolInputRouter'

const cancelled = vi.fn(), committed = vi.fn(), begun = vi.fn()
const keyboardCommand = vi.fn(() => true)
const viewportCommand = vi.fn()
const nav = { down: vi.fn(), move: vi.fn(), up: vi.fn(), cancel: vi.fn() }
const documentValue = createImageEditDocumentV3({ width: 100, height: 100, documentId: 'tool-input-host' })
const bus = new ImageEditCommandBusV3(documentValue)
const controller = { sessionId: 'router', document: documentValue, profile: getImageEditorHostProfileV3('full') } as ImageEditorV3Controller

function Harness(): JSX.Element {
  const surface = useRef<HTMLElement>(null)
  const active = useImageEditorSessionStoreV3(state => state.sessions.router.activeTool)
  const router = useToolInputRouter(surface, controller, active, bus)
  router.connect({ navigation: nav, move: nav, viewport: viewportCommand })
  const { bindKeyboard } = router
  useLayoutEffect(() => bindKeyboard('raster', keyboardCommand), [bindKeyboard])
  return <div data-image-editor-v3 tabIndex={0} data-testid="root">
    <UiInput aria-label="文字输入" />
    <main ref={surface} data-effective-tool={router.effectiveTool} {...router.handlers}>
      <div data-tool-overlay-slot="raster"><div data-testid="owned" onPointerDown={begun} onPointerUp={committed} onPointerCancel={cancelled} /></div>
      <div data-tool-overlay-slot="selection"><div data-testid="other" onPointerDown={begun} /></div>
    </main>
  </div>
}

beforeEach(() => {
  vi.clearAllMocks()
  useImageEditorSessionStoreV3.setState({ sessions: {} })
  useImageEditorSessionStoreV3.getState().ensureSession('router', ['raster-brush', 'hand', 'zoom', 'move', 'eraser'], undefined, 'raster-brush')
})
afterEach(cleanup)

describe('实际宿主输入桥', () => {
  it('Ctrl/Meta+0/1 只在编辑器非输入态触发视口预设，并阻止外层缩放', () => {
    const view = render(<Harness />), root = view.getByTestId('root')
    for (const [key, modifier, preset] of [['0', 'ctrlKey', 'fit'], ['1', 'metaKey', 'actual']] as const) {
      const event = new KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true, cancelable: true })
      fireEvent(root, event)
      expect(event.defaultPrevented).toBe(true)
      expect(viewportCommand).toHaveBeenLastCalledWith(preset)
    }
    viewportCommand.mockClear()
    fireEvent.keyDown(view.getByRole('textbox'), { key: '0', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '1', ctrlKey: true })
    fireEvent.keyDown(root, { key: '1', ctrlKey: true, altKey: true })
    root.setAttribute('inert', '')
    fireEvent.keyDown(root, { key: '0', ctrlKey: true })
    expect(viewportCommand).not.toHaveBeenCalled()
  })
  it('未持有工具租约时不截断宿主拖动穿过预览，持有租约时仍拒绝第二指针', () => {
    const view = render(<Harness />), owned = view.getByTestId('owned'), other = view.getByTestId('other')
    const moved = vi.fn(), released = vi.fn(), pointerCancelled = vi.fn()
    document.addEventListener('pointermove', moved)
    document.addEventListener('pointerup', released)
    document.addEventListener('pointercancel', pointerCancelled)
    try {
      fireEvent.pointerMove(other, { pointerId: 9 })
      fireEvent.pointerUp(other, { pointerId: 9 })
      fireEvent.pointerCancel(other, { pointerId: 9 })
      expect(moved).toHaveBeenCalledTimes(1)
      expect(released).toHaveBeenCalledTimes(1)
      expect(pointerCancelled).toHaveBeenCalledTimes(1)
      fireEvent.pointerDown(owned, { pointerId: 1, isPrimary: true, button: 0 })
      fireEvent.pointerMove(other, { pointerId: 2 })
      expect(moved).toHaveBeenCalledTimes(1)
      expect(committed).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('pointermove', moved)
      document.removeEventListener('pointerup', released)
      document.removeEventListener('pointercancel', pointerCancelled)
    }
  })

  it('关闭中的菜单不阻断临时导航，仍打开的菜单保留输入优先权', () => {
    const view = render(<Harness />), root = view.getByTestId('root')
    root.focus()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    vi.spyOn(menu, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList)
    document.body.append(menu)
    try {
      fireEvent.keyDown(root, { code: 'Space', key: ' ' })
      expect(view.container.querySelector('main')?.getAttribute('data-effective-tool')).toBe('raster-brush')
      menu.setAttribute('inert', '')
      menu.setAttribute('aria-hidden', 'true')
      fireEvent.keyDown(root, { code: 'Space', key: ' ' })
      expect(view.container.querySelector('main')?.getAttribute('data-effective-tool')).toBe('hand')
      fireEvent.keyUp(root, { code: 'Space', key: ' ' })
      menu.removeAttribute('inert')
      menu.removeAttribute('aria-hidden')
      menu.style.visibility = 'hidden'
      fireEvent.keyDown(root, { code: 'Space', key: ' ' })
      expect(view.container.querySelector('main')?.getAttribute('data-effective-tool')).toBe('hand')
    } finally { menu.remove() }
  })

  it('只给登记的 overlay 路由；第二指针取消不会终止第一指针，Esc 不提交残留', () => {
    const view = render(<Harness />)
    const owned = view.getByTestId('owned'), other = view.getByTestId('other'), root = view.getByTestId('root')
    root.focus()
    fireEvent.pointerDown(other, { pointerId: 2, isPrimary: true, button: 0 })
    expect(begun).not.toHaveBeenCalled()
    fireEvent.pointerDown(owned, { pointerId: 1, isPrimary: true, button: 0 })
    expect(begun).toHaveBeenCalledTimes(1)
    fireEvent.pointerCancel(owned, { pointerId: 2 })
    expect(cancelled).not.toHaveBeenCalled()
    fireEvent.keyDown(root, { key: 'Escape', code: 'Escape' })
    expect(cancelled).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(owned, { pointerId: 1 })
    expect(committed).not.toHaveBeenCalled()
  })
  it('临时导航取消旧草稿，在释放键后恢复当前工具；输入框和 IME 不触发快捷键', () => {
    const view = render(<Harness />), root = view.getByTestId('root'), owned = view.getByTestId('owned')
    root.focus()
    fireEvent.pointerDown(owned, { pointerId: 1, isPrimary: true, button: 0 })
    fireEvent.keyDown(root, { code: 'Space', key: ' ' })
    expect(view.container.querySelector('main')?.getAttribute('data-effective-tool')).toBe('hand')
    expect(cancelled).toHaveBeenCalledTimes(1)
    fireEvent.keyUp(root, { code: 'Space', key: ' ' })
    expect(view.container.querySelector('main')?.getAttribute('data-effective-tool')).toBe('raster-brush')
    fireEvent.keyDown(root, { key: 'Enter', code: 'Enter' })
    expect(keyboardCommand).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: 'Delete', code: 'Delete' })
    fireEvent.keyDown(root, { key: 'Delete', code: 'Delete', ctrlKey: true })
    expect(keyboardCommand).toHaveBeenCalledTimes(1)
    const field = view.getByRole('textbox')
    field.focus()
    fireEvent.compositionStart(field)
    fireEvent.keyDown(field, { code: 'KeyE', key: 'e', isComposing: true })
    fireEvent.keyDown(field, { code: 'Space', key: ' ' })
    expect(useImageEditorSessionStoreV3.getState().sessions.router.activeTool).toBe('raster-brush')
    expect(keyboardCommand).toHaveBeenCalledTimes(1)
    fireEvent.compositionEnd(field)
  })
})
