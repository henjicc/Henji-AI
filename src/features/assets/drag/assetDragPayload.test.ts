import { describe, expect, it } from 'vitest'
import { ASSET_DRAG_MIME, CODE_ASSET_DRAG_MIME, assetRecordToDragPayload, readCodeAssetDrag, writeCodeAssetDrag } from './assetDragPayload'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'

describe('asset drag payload', () => {
  it('只包含媒体引用和资产身份', () => {
    const asset = { id: 'a1', mediaType: 'image', displayName: 'demo.png', filePath: 'C:/demo.png', displayUrl: 'henji-media://demo', thumbnailUrl: null } as AssetRecord
    expect(assetRecordToDragPayload(asset)).toEqual(expect.objectContaining({ assetId: 'a1', type: 'image', filePath: 'C:/demo.png', sourceType: 'asset' }))
  })
  it('代码资产只传稳定身份，不混入媒体拖拽或可伪造文件路径', () => {
    const values = new Map<string, string>()
    const transfer = { setData: (kind: string, value: string) => { values.set(kind, value) }, getData: (kind: string) => values.get(kind) ?? '', effectAllowed: 'copy' } as unknown as DataTransfer
    writeCodeAssetDrag(transfer, 'code-asset')
    expect(readCodeAssetDrag(transfer)).toBe('code-asset')
    expect(values.has(ASSET_DRAG_MIME)).toBe(false)
    expect(() => assetRecordToDragPayload({ mediaType: 'code' } as AssetRecord)).toThrow('可编辑代码')
    for (const value of ['null', '[]', '{"assetId":""}', '{"assetId":"a","filePath":"D:/other.henji-code"}', '{']) {
      values.set(CODE_ASSET_DRAG_MIME, value); expect(() => readCodeAssetDrag(transfer)).toThrow()
    }
    values.clear(); expect(readCodeAssetDrag(transfer)).toBeNull()
  })
})
