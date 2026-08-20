/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetLibraryFloatingPanel } from './AssetLibraryFloatingPanel'

vi.mock('@/components/ui/useDialogTransition', () => ({
  useDialogTransition: (open: boolean) => ({ shouldRender: open, isVisible: open }),
}))

vi.mock('./AssetLibrarySurface', () => ({
  AssetLibrarySurface: () => <div data-testid="asset-library-surface" />,
}))

afterEach(cleanup)

describe('资产悬浮面板关闭边界', () => {
  it('点击所属下拉 Portal 不关闭面板，点击真正外部才关闭', () => {
    const onClose = vi.fn()
    render(<AssetLibraryFloatingPanel open position="top" onClose={onClose} onOpenWorkspace={vi.fn()} />)
    const dropdownPortal = document.createElement('div')
    dropdownPortal.dataset.dropdownPortal = 'true'
    document.body.appendChild(dropdownPortal)

    fireEvent.pointerDown(dropdownPortal)
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
