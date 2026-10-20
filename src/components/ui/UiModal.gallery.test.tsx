/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiModal } from './UiModal'
import { UiButton } from './primitives'

afterEach(cleanup)

it('长任务弹窗不能通过 Esc、遮罩或关闭按钮离开，结束后恢复正常关闭', () => {
  const close = vi.fn()
  const view = render(<UiModal isOpen title="导出" dismissible={false} onClose={close}>内容</UiModal>)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(view.getByRole('dialog').querySelector('.ui-glass-scrim')!)
  expect(view.queryByRole('button', { name: '导出 - 关闭' })).toBeNull()
  expect(close).not.toHaveBeenCalled()
  view.rerender(<UiModal isOpen title="导出" onClose={close}>内容</UiModal>)
  fireEvent.click(view.getByRole('button', { name: '导出 - 关闭' }))
  expect(close).toHaveBeenCalledOnce()
})

it('容器样张原位渲染，不抢焦点、不锁滚动、不参与模态或 Escape 栈', () => {
  const close = vi.fn()
  const view = render(<div data-testid="preview"><UiButton>外部焦点</UiButton><UiModal isOpen scope="container" title="样张" onClose={close}>内容</UiModal></div>)
  const dialog = view.getByRole('dialog', { name: '样张' })
  expect(view.getByTestId('preview').contains(dialog)).toBe(true)
  expect(dialog.className).toContain('absolute inset-0')
  expect(dialog.hasAttribute('aria-modal')).toBe(false)
  expect(dialog.hasAttribute('data-dialog')).toBe(false)
  expect(document.activeElement).not.toBe(dialog)
  expect(document.body.style.overflow).not.toBe('hidden')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
})

it('同一个打开状态从容器切回视口时能够建立 portal 宿主', () => {
  const view = render(<div data-testid="preview"><UiModal isOpen scope="container" title="切换" onClose={vi.fn()}>内容</UiModal></div>)
  view.rerender(<div data-testid="preview"><UiModal isOpen scope="viewport" title="切换" onClose={vi.fn()}>内容</UiModal></div>)
  const dialog = view.getByRole('dialog', { name: '切换' })
  expect(view.getByTestId('preview').contains(dialog)).toBe(false)
  expect(dialog.getAttribute('aria-modal')).toBe('true')
})
