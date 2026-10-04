/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetLibraryFloatingPanel } from './AssetLibraryFloatingPanel'

vi.mock('@/components/ui/useDialogTransition', () => ({
  useDialogTransition: (open: boolean) => ({ shouldRender: open, isVisible: open }),
}))

vi.mock('./AssetLibrarySurface', async () => {
  const { default: Dropdown } = await import('@/components/ui/Dropdown')
  return {
    AssetLibrarySurface: () => (
      <div data-testid="asset-library-surface">
        <Dropdown<string> ariaLabel="类型" value="all" options={[{ value: 'all', label: '全部' }, { value: 'image', label: '图片' }]} onSelect={() => {}} />
      </div>
    ),
  }
})

afterEach(cleanup)

describe('资产悬浮面板关闭边界', () => {
  it('点击所属下拉 Portal 不关闭面板，点击真正外部才关闭', () => {
    const onClose = vi.fn()
    const view = render(<AssetLibraryFloatingPanel open position="top" onClose={onClose} onOpenWorkspace={vi.fn()} />)
    // 面板里的下拉打开后 portal 到 body：通过浮层归属认作面板的后代层（任务 4.3）
    fireEvent.click(view.getByRole('button', { name: '类型' }))
    const option = view.getByRole('option', { name: '图片' })
    expect(option.closest('[data-asset-floating-panel]')).toBeNull()

    fireEvent.pointerDown(option)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('退场完成后卸载资产列表，避免完整面板与隐藏面板重复查询', () => {
    const rendered = render(<AssetLibraryFloatingPanel open={false} position="top" onClose={vi.fn()} onOpenWorkspace={vi.fn()} />)
    expect(rendered.queryByTestId('asset-library-surface')).toBeNull()

    rendered.rerender(<AssetLibraryFloatingPanel open position="top" onClose={vi.fn()} onOpenWorkspace={vi.fn()} />)
    expect(rendered.getByTestId('asset-library-surface')).toBeTruthy()
  })
})
