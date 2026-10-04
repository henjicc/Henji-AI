/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { AssetCardMenu } from './AssetCardMenu'
import { Z_LAYERS } from '@/core/theme/zLayers'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))

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

  it('走共享浮层：玻璃表面、浮层层级高于悬浮面板与弹窗，并登记为浮层层', () => {
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onOpenBatchManagement={vi.fn()} onClose={vi.fn()} />)

    const panel = document.querySelector('[data-asset-card-menu]')?.closest<HTMLElement>('[data-panel-placement]')
    expect(panel).toBeTruthy()
    expect(Number(panel?.style.zIndex)).toBe(Z_LAYERS.popover)
    expect(Number(panel?.style.zIndex)).toBeGreaterThan(Z_LAYERS.modal)
    expect(panel?.classList.contains('ui-glass')).toBe(true)
    expect(panel?.hasAttribute('data-ui-overlay-id')).toBe(true)
  })

  it('Escape 收起菜单，收起动画结束后回调 onClose', async () => {
    const onClose = vi.fn()
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onOpenBatchManagement={vi.fn()} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('普通菜单可以进入批量管理', () => {
    const onOpenBatchManagement = vi.fn()
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onOpenBatchManagement={onOpenBatchManagement} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.batchManage' }))

    expect(onOpenBatchManagement).toHaveBeenCalledTimes(1)
  })

  it('操作失败时保持菜单打开并展示错误', async () => {
    const onClose = vi.fn()
    render(<AssetCardMenu asset={asset} anchor={new DOMRect(100, 100, 28, 28)} libraries={[]} availableTags={[]} onToggleLibrary={vi.fn()} onSetTags={vi.fn()} onRename={vi.fn()} onDelete={vi.fn().mockRejectedValue(new Error('删除失败'))} onOpenBatchManagement={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.deleteAsset' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('删除失败'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
