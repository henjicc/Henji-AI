import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'

const service = vi.hoisted(() => ({
  replaceTags: vi.fn(),
  addToLibrary: vi.fn(),
  removeFromLibrary: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('./assetApplicationService', () => ({ assetApplicationService: service }))

import { deleteAssetsBatch, updateAssetLibraryBatch, updateAssetTagsBatch } from './assetBatchOperations'

const asset = (id: string, tags: string[] = [], libraryIds: string[] = []): AssetRecord => ({
  id, mediaType: 'image', displayName: id, filePath: `${id}.png`, displayUrl: id, source: 'imported', mimeType: 'image/png',
  sizeBytes: 1, width: 1, height: 1, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null,
  inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: null, lastUsedAt: null, createdAt: 1, updatedAt: 1,
  tags, libraryIds,
})

describe('assetBatchOperations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('添加标签时保留已有标签并跳过无变化资产', async () => {
    await updateAssetTagsBatch([asset('a', ['已有']), asset('b', ['新'])], ['新'], 'add')

    expect(service.replaceTags).toHaveBeenCalledTimes(1)
    expect(service.replaceTags).toHaveBeenCalledWith('a', ['已有', '新'])
  })

  it('批量资产库操作跳过已经处于目标状态的资产', async () => {
    await updateAssetLibraryBatch([asset('a', [], ['lib']), asset('b')], 'lib', 'add')

    expect(service.addToLibrary).toHaveBeenCalledTimes(1)
    expect(service.addToLibrary).toHaveBeenCalledWith('lib', 'b')
  })

  it('返回局部失败而不中断其他资产', async () => {
    service.delete.mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce(undefined)

    const result = await deleteAssetsBatch([asset('a'), asset('b')])

    expect(result.succeededIds).toEqual(['b'])
    expect(result.failures).toEqual([{ assetId: 'a', message: 'locked' }])
  })
})
