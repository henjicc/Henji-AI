/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiViewerShell } from './UiViewerShell'
import { useUiViewerShell } from './useUiViewerShell'
import { useUiOverlayLayer, UiOverlayLayerProvider } from './overlayOwnership'

function ChildLayer() {
  const layer = useUiOverlayLayer(true)
  return <UiOverlayLayerProvider id={layer.id}><span>子浮层</span></UiOverlayLayerProvider>
}
function Viewer({ open, close, child = false }: { open: boolean; close: () => void; child?: boolean }) {
  const viewer = useUiViewerShell(open, close)
  return <UiViewerShell viewer={viewer} aria-label="预览">{child ? <ChildLayer /> : <span>内容</span>}</UiViewerShell>
}
afterEach(() => { cleanup(); vi.useRealTimers(); document.body.style.overflow = '' })
it('子层优先 Escape，退出立即 inert，冒泡过渡不卸载，重开取消旧退出', () => {
  vi.useFakeTimers()
  const close = vi.fn()
  const view = render(<Viewer open close={close} child />)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  view.rerender(<Viewer open close={close} />)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(close).toHaveBeenCalledTimes(1)
  view.rerender(<Viewer open={false} close={close} />)
  expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('inert')).toBe(true)
  fireEvent.transitionEnd(screen.getByText('内容'))
  expect(screen.getByText('内容')).toBeTruthy()
  view.rerender(<Viewer open close={close} />)
  act(() => vi.advanceTimersByTime(600))
  expect(screen.getByRole('dialog').hasAttribute('inert')).toBe(false)
  view.rerender(<Viewer open={false} close={close} />)
  fireEvent.transitionEnd(screen.getByRole('dialog', { hidden: true }))
  expect(screen.queryByText('内容')).toBeNull()
})
it('多个查看器关闭顺序不提前恢复滚动，最后一个退出后恢复原值', () => {
  document.body.style.overflow = 'scroll'
  const a = render(<Viewer open close={() => undefined} />)
  const b = render(<Viewer open close={() => undefined} />)
  a.unmount()
  expect(document.body.style.overflow).toBe('hidden')
  b.unmount()
  expect(document.body.style.overflow).toBe('scroll')
})
