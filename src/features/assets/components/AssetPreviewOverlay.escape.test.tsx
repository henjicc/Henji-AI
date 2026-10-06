/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { isTopmostUiOverlay, useUiOverlayLayer } from '@/components/ui/overlayOwnership'
import { AssetPreviewOverlay } from './AssetPreviewOverlay'

const mocks = vi.hoisted(() => ({ viewerLayer: { id: '' } }))

// 查看器替身：与真实全屏查看器一样登记一个模态层，并记下层 id，用来判断 Escape 是否轮得到它
function ViewerDouble({ open }: { open: boolean }): null {
  const layer = useUiOverlayLayer(open, { modal: true })
  if (open) mocks.viewerLayer.id = layer.id
  return null
}

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/commands/assetLibrary', () => ({ touchAsset: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
vi.mock('@/components/mediaViewer/ImageViewerModal', () => ({ ImageViewerModal: ViewerDouble }))
vi.mock('@/components/mediaViewer/VideoViewerModal', () => ({ VideoViewerModal: () => null }))
vi.mock('@/components/mediaViewer/AudioViewerModal', () => ({ AudioViewerModal: () => null }))
vi.mock('@/features/videoEdit/application/videoEditCodeAssets', () => ({ readVideoEditCodeAsset: vi.fn(), importVideoEditCodeAsset: vi.fn() }))
vi.mock('@/features/videoEdit/application/videoEditService', () => ({ activeVideoEditInstance: () => undefined, subscribeVideoEdit: () => () => undefined, subscribeVideoEditDomain: () => () => undefined }))

const image: AssetRecord = {
  id: 'img', mediaType: 'image', displayName: '图片', filePath: 'C:/a.png', displayUrl: 'henji-media://local/a.png', source: 'imported',
  mimeType: 'image/png', sizeBytes: 1, width: 10, height: 10, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null,
  inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
}

afterEach(cleanup)

describe('资产预览的 Escape 归属（5.6 第二批 B-43）', () => {
  it('预览层与查看器同时打开时，查看器在栈顶，Escape 能关掉预览', () => {
    render(<AssetPreviewOverlay asset={image} onClose={vi.fn()} />)
    expect(mocks.viewerLayer.id).not.toBe('')
    expect(isTopmostUiOverlay(mocks.viewerLayer.id)).toBe(true)
  })
})
