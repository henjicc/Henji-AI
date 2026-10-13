/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { AssetCardMenu } from './AssetCardMenu'
import { Z_LAYERS } from '@/core/theme/zLayers'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))
const dialog = vi.hoisted(() => ({ openDialog: vi.fn() }))
vi.mock('@/platform/desktopApi', () => ({ openDialog: dialog.openDialog }))
vi.mock('@/features/videoEdit/panels/VideoEditSendMenu', () => ({ VideoEditSendMenu: () => null }))

const asset = {
  id: 'asset-1',
  displayName: '测试资产',
  mediaType: 'image',
  filePath: 'C:/media/test.png',
  displayUrl: 'henji-media://test.png',
  source: 'imported',
  mimeType: 'image/png',
  sizeBytes: 1024,
  width: 100,
  height: 100,
  durationSeconds: null,
  thumbnailPath: null,
  thumbnailUrl: null,
  inspectionStatus: 'ready',
  inspectionError: null,
  fileModifiedAt: 1,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
  libraryIds: [],
  tags: [],
} satisfies AssetRecord

describe('资产卡片菜单', () => {
  it('缺失素材可以选文件重新定位，取消不写入，失败仍可重试', async () => {
    const onRelocate = vi.fn().mockRejectedValueOnce(new Error('文件不可用')).mockResolvedValue(undefined)
    const onClose = vi.fn()
    const props = { asset: { ...asset, inspectionStatus: 'missing' as const }, anchor: new DOMRect(100, 100, 28, 28), libraries: [], availableTags: [], onToggleLibrary: vi.fn(), onSetTags: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onOpenBatchManagement: vi.fn(), onClose, onRelocate }
    render(<AssetCardMenu {...props} />)
    dialog.openDialog.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.relocate' }))
    await waitFor(() => expect(dialog.openDialog).toHaveBeenCalledOnce())
    expect(onRelocate).not.toHaveBeenCalled()
    dialog.openDialog.mockResolvedValueOnce('/media/new.png')
    await waitFor(() => expect(screen.getByRole('button', { name: 'assetLibrary.relocate' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.relocate' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('文件不可用'))
    expect(onClose).not.toHaveBeenCalled()
    dialog.openDialog.mockResolvedValueOnce(['/media/new.png'])
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.relocate' }))
    await waitFor(() => expect(onRelocate).toHaveBeenCalledTimes(2))
    expect(onRelocate).toHaveBeenLastCalledWith('/media/new.png')
  })
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('走共享浮层：实底表面（表单内容不压玻璃）、浮层层级高于悬浮面板与弹窗，并登记为浮层层', () => {
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={vi.fn()} onOpenBatchManagement={vi.fn()} onClose={vi.fn()} />)

    const panel = document.querySelector('[data-asset-card-menu]')?.closest<HTMLElement>('[data-panel-placement]')
    expect(panel).toBeTruthy()
    expect(Number(panel?.style.zIndex)).toBe(Z_LAYERS.popover)
    expect(Number(panel?.style.zIndex)).toBeGreaterThan(Z_LAYERS.modal)
    expect(panel?.classList.contains('ui-glass')).toBe(false)
    // 资产库为空时说明可去侧栏新建，而不是留一个空的“所属资产库”
    expect(document.body.textContent).toContain('assetLibrary.noLibraries')
    expect(panel?.hasAttribute('data-ui-overlay-id')).toBe(true)
  })

  it('Escape 收起菜单，收起动画结束后回调 onClose', async () => {
    const onClose = vi.fn()
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={vi.fn()} onOpenBatchManagement={vi.fn()} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('普通菜单可以进入批量管理', () => {
    const onOpenBatchManagement = vi.fn()
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={vi.fn()} onOpenBatchManagement={onOpenBatchManagement} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.batchManage' }))

    expect(onOpenBatchManagement).toHaveBeenCalledTimes(1)
  })

  it('操作失败时保持菜单打开并展示错误', async () => {
    const onClose = vi.fn()
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={vi.fn().mockRejectedValue(new Error('删除失败'))} onOpenBatchManagement={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.deleteAsset' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('删除失败'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
