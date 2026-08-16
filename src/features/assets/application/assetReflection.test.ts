import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listLibraries: vi.fn(async () => [{
    id: 'library-1', name: '参考', createdAt: 10, updatedAt: 999,
  }]),
}))

vi.mock('./assetApplicationService', () => ({
  assetApplicationService: { listLibraries: mocks.listLibraries },
}))

import { createAssetReflectionRegistrations } from './assetReflection'

describe('asset reflection revision contract', () => {
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
