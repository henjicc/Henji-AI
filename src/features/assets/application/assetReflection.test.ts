import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn<[], Promise<Record<string, unknown>>>(),
  listLibraries: vi.fn(async () => [{
    id: 'library-1', name: '参考', createdAt: 10, updatedAt: 999,
  }]),
}))

vi.mock('./assetApplicationService', () => ({
  assetApplicationService: { read: mocks.read, listLibraries: mocks.listLibraries },
}))

import { createAssetReflectionRegistrations } from './assetReflection'

describe('asset reflection revision contract', () => {
  it('回收后的素材缺失可被验证器识别，读取失败仍原样上抛', async () => {
    const provider = createAssetReflectionRegistrations(() => 0).find(item => item.entity.id === 'asset')!.provider!
    mocks.read.mockRejectedValueOnce(new Error('资产不存在'))
    await expect(provider.readEntity({ kind: 'asset', id: 'removed' }, {})).rejects.toThrow('NOT_FOUND:资产不存在')
    const failure = new Error('索引读取失败')
    mocks.read.mockRejectedValueOnce(failure)
    await expect(provider.readEntity({ kind: 'asset', id: 'removed' }, {})).rejects.toBe(failure)
  })
  it('所有素材实体使用同一个领域 revision，不把单条记录时间戳伪装成全局基线', async () => {
    let revision = 41
    const registration = createAssetReflectionRegistrations(() => revision)
      .find((item) => item.entity.id === 'asset.library')
    if (!registration?.provider) throw new Error('asset.library registration missing')
    const provider = registration.provider

    const first = await provider.readEntity(
      { kind: 'asset.library', id: 'library-1' },
      {},
    )
    expect(first.revisions).toEqual({ assets: 41 })

    revision = 42
    const listed = await provider.listEntities({ limit: 20 })
    const availability = await provider.getCollectionAvailability({
      kind: 'asset.catalog', id: 'default',
    })
    expect(listed.revisions).toEqual({ assets: 42 })
    expect(availability.revisions).toEqual({ assets: 42 })
  })
})
