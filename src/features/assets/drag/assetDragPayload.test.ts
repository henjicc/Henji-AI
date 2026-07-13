import { describe, expect, it } from 'vitest'
import { assetRecordToDragPayload } from './assetDragPayload'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'

describe('asset drag payload', () => {
  it('只包含媒体引用和资产身份', () => {
    const asset = { id: 'a1', mediaType: 'image', displayName: 'demo.png', filePath: 'C:/demo.png', displayUrl: 'henji-media://demo', thumbnailUrl: null } as AssetRecord
    expect(assetRecordToDragPayload(asset)).toEqual(expect.objectContaining({ assetId: 'a1', type: 'image', filePath: 'C:/demo.png', sourceType: 'asset' }))
  })
})
