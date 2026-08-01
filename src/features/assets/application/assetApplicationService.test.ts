// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const commands = vi.hoisted(() => ({
  addAssetToLibrary: vi.fn(),
  deleteAsset: vi.fn(),
  inspectAsset: vi.fn(),
  listAssetLibraries: vi.fn(),
  listAssetTags: vi.fn(),
  queryAssets: vi.fn(),
  removeAssetFromLibrary: vi.fn(),
  setAssetTags: vi.fn(),
}))

vi.mock('@/commands/assetLibrary', () => commands)

import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'

import { assetApplicationService } from './assetApplicationService'

const asset = {
  id: 'asset-1',
  mediaType: 'image' as const,
  displayName: '测试图片',
  filePath: 'C:\\private\\asset.png',
  displayUrl: 'henji-media://local/asset-1',
  source: 'imported' as const,
  mimeType: 'image/png',
  sizeBytes: 100,
  width: 10,
  height: 10,
  durationSeconds: null,
  thumbnailPath: 'C:\\private\\thumb.png',
  thumbnailUrl: 'henji-media://local/thumb-1',
  inspectionStatus: 'ready' as const,
  inspectionError: null,
  fileModifiedAt: 1,
  lastUsedAt: 1,
  createdAt: 1,
  updatedAt: 2,
  tags: ['参考'],
  libraryIds: ['library-1'],
}

describe('asset application service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commands.inspectAsset.mockResolvedValue(asset)
    commands.queryAssets.mockResolvedValue({ items: [asset], total: 1, page: 1, pageSize: 20 })
    commands.setAssetTags.mockResolvedValue({ ...asset, tags: ['主角'], updatedAt: 3 })
    useAssetLibraryStore.getState().setSelectedAsset(null)
  })

  it('查询和详情只返回稳定媒体引用，不暴露本地路径', async () => {
    const page = await assetApplicationService.query({ page: 1, pageSize: 20 })
    const detail = await assetApplicationService.read(asset.id)

    expect(JSON.stringify(page)).not.toContain('C:\\private')
    expect(JSON.stringify(detail)).not.toContain('C:\\private')
    expect(detail).toMatchObject({ id: asset.id, displayUrl: 'henji-media://local/asset-1' })
  })

  it('选择和标签写入复用正式素材命令并返回 revision', async () => {
    await assetApplicationService.select(asset.id)
    expect(useAssetLibraryStore.getState().selectedAsset?.id).toBe(asset.id)

    await expect(assetApplicationService.replaceTags(asset.id, ['主角'])).resolves.toEqual({
      assetId: asset.id,
      tags: ['主角'],
      revision: 3,
    })
    expect(commands.setAssetTags).toHaveBeenCalledWith(asset.id, ['主角'])
  })
})
