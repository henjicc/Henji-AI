/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { AssetCard } from './AssetCard'
import { ASSET_DRAG_MIME, CODE_ASSET_DRAG_MIME } from '../drag/assetDragPayload'

const mocks = vi.hoisted(() => ({ waveform: vi.fn(() => ({ waveform: null })) }))

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useAudioWaveform', () => ({ useAudioWaveform: mocks.waveform }))
vi.mock('@/contexts/dragDataTransfer', async importOriginal => ({
  ...await importOriginal<typeof import('@/contexts/dragDataTransfer')>(),
  clearCompactDragPreview: vi.fn(), setCompactDragPreview: vi.fn(), setCompactWaveformDragPreview: vi.fn(),
}))

const asset: AssetRecord = {
  id: 'asset-1', mediaType: 'image', displayName: '测试资产', filePath: 'C:/test.png', displayUrl: 'test.png', source: 'imported',
  mimeType: 'image/png', sizeBytes: 1, width: 100, height: 100, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null,
  inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
}

const renderCard = (props: Partial<React.ComponentProps<typeof AssetCard>> = {}) => {
  const onMenu = vi.fn()
  render(<AssetCard asset={asset} selected={false} thumbnailFit="cover" onSelect={vi.fn()} onMenu={onMenu} onPreview={vi.fn()} onRename={vi.fn()} {...props} />)
  return { onMenu }
}

describe('AssetCard', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(cleanup)

  it('菜单打开后离开悬浮区域仍保持菜单按钮可见', () => {
    renderCard({ menuOpen: true })

    expect(screen.getByRole('button', { name: 'menu' }).classList.contains('opacity-100')).toBe(true)
  })

  it('右键资产打开同一个资产菜单并使用鼠标坐标定位', () => {
    const { onMenu } = renderCard()

    fireEvent.contextMenu(screen.getByText('测试资产'), { clientX: 220, clientY: 180 })

    expect(onMenu).toHaveBeenCalledWith(asset, expect.objectContaining({ left: 220, top: 180, width: 0 }))
  })

  it('双击名称直接进入重命名', () => {
    renderCard()

    fireEvent.doubleClick(screen.getByText('测试资产'))

    expect(screen.getByDisplayValue('测试资产')).toBeTruthy()
  })

  it('代码只显示类型图标，清单不会进入图片、播放器或波形资源', () => {
    const code = { ...asset, mediaType: 'code' as const, displayUrl: 'henji-media://local/code.henji-code', thumbnailUrl: 'henji-media://local/code.henji-code' }
    const onPreview = vi.fn()
    renderCard({ asset: code, onPreview })
    expect(screen.getByText('assetLibrary.code')).toBeTruthy()
    expect(document.querySelector('img, video, audio')).toBeNull()
    expect(screen.queryByRole('button', { name: 'audioPlayer.playPause' })).toBeNull()
    expect(mocks.waveform).toHaveBeenCalledWith('', undefined, expect.objectContaining({ compact: true }))
    fireEvent.doubleClick(document.querySelector('[data-asset-card] .aspect-square')!)
    expect(onPreview).toHaveBeenCalledWith(code)
  })

  it('代码拖包仅写入资产ID，保持原媒体拖包为空', () => {
    renderCard({ asset: { ...asset, mediaType: 'code' } })
    const values = new Map<string, string>()
    const transfer = { setData: (type: string, value: string) => values.set(type, value), effectAllowed: 'none' }
    fireEvent.dragStart(document.querySelector('[data-asset-card]')!, { dataTransfer: transfer })
    expect(JSON.parse(values.get(CODE_ASSET_DRAG_MIME)!)).toEqual({ assetId: asset.id })
    expect(values.has(ASSET_DRAG_MIME)).toBe(false)
    expect(transfer.effectAllowed).toBe('copy')
  })

  it.each(['image', 'video', 'audio'] as const)('%s保留现有媒体拖包和播放入口', mediaType => {
    const media = { ...asset, mediaType }
    renderCard({ asset: media })
    const values = new Map<string, string>()
    fireEvent.dragStart(document.querySelector('[data-asset-card]')!, { dataTransfer: { setData: (type: string, value: string) => values.set(type, value) } })
    expect(JSON.parse(values.get(ASSET_DRAG_MIME)!)).toMatchObject({ type: mediaType, assetId: asset.id, filePath: asset.filePath })
    expect(values.has(CODE_ASSET_DRAG_MIME)).toBe(false)
    expect(Boolean(screen.queryByRole('button', { name: 'audioPlayer.playPause' }))).toBe(mediaType !== 'image')
  })
})
