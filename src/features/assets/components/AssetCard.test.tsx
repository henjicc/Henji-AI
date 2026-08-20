/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { AssetCard } from './AssetCard'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useAudioWaveform', () => ({ useAudioWaveform: () => ({ waveform: null }) }))

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
})
