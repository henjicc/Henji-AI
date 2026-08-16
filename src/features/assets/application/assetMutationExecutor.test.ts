import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {
    displayName: '旧名称',
    tags: ['旧'],
    libraryIds: ['lib-old'],
  },
  rename: vi.fn(),
  replaceTags: vi.fn(),
  addToLibrary: vi.fn(),
  removeFromLibrary: vi.fn(),
  readMutationSnapshot: vi.fn(),
}))

vi.mock('./assetApplicationService', () => ({
  assetApplicationService: {
    rename: mocks.rename,
    replaceTags: mocks.replaceTags,
    addToLibrary: mocks.addToLibrary,
    removeFromLibrary: mocks.removeFromLibrary,
    readMutationSnapshot: mocks.readMutationSnapshot,
  },
}))

import {
  AssetMutationExecutor,
  resetAssetMutationUndoStateForTests,
} from './assetMutationExecutor'

describe('素材属性写入执行器', () => {
  let revision = 0
  const executor = new AssetMutationExecutor({
    readRevision: () => revision,
    bumpRevision: () => { revision += 1 },
  })

  function step(mutations: Array<{ propertyId: string; operation: string; value?: unknown }>) {
    return {
      kind: 'mutation' as const,
      target: { kind: 'asset', id: 'asset-1' },
      entityType: 'asset',
      expectedRevisions: { assets: 0 },
      mutations,
    } as never
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetAssetMutationUndoStateForTests()
    revision = 0
    mocks.state.displayName = '旧名称'
    mocks.state.tags = ['旧']
    mocks.state.libraryIds = ['lib-old']
    mocks.readMutationSnapshot.mockImplementation(async () => ({
      displayName: mocks.state.displayName,
      tags: [...mocks.state.tags],
      libraryIds: [...mocks.state.libraryIds],
    }))
    mocks.rename.mockImplementation(async (_assetId: string, name: string) => {
      mocks.state.displayName = name
      return {}
    })
    mocks.replaceTags.mockImplementation(async (_assetId: string, tags: string[]) => {
      mocks.state.tags = [...tags]
      return {}
    })
    mocks.addToLibrary.mockImplementation(async (libraryId: string) => {
      if (!mocks.state.libraryIds.includes(libraryId)) mocks.state.libraryIds.push(libraryId)
      return {}
    })
    mocks.removeFromLibrary.mockImplementation(async (libraryId: string) => {
      mocks.state.libraryIds = mocks.state.libraryIds.filter((id) => id !== libraryId)
      return {}
    })
  })

  it('名称与标签写入委托正式领域服务', async () => {
    const result = await executor.apply(step([
      { propertyId: 'asset.display_name', operation: 'set', value: '新名称' },
      { propertyId: 'asset.tags', operation: 'set', value: ['风景', '夜景'] },
    ]))

    expect(mocks.rename).toHaveBeenCalledWith('asset-1', '新名称')
    expect(mocks.replaceTags).toHaveBeenCalledWith('asset-1', ['风景', '夜景'])
    expect(mocks.state).toMatchObject({ displayName: '新名称', tags: ['风景', '夜景'] })
    expect(result.resultingRevisions.assets).toBe(1)
  })

  it('集合归属用 append / remove 表达', async () => {
    await executor.apply(step([
      { propertyId: 'asset.library_refs', operation: 'append', value: { kind: 'asset.library', id: 'lib-1' } },
      { propertyId: 'asset.library_refs', operation: 'remove', value: 'lib-old' },
    ]))
    expect(mocks.addToLibrary).toHaveBeenCalledWith('lib-1', 'asset-1')
    expect(mocks.removeFromLibrary).toHaveBeenCalledWith('lib-old', 'asset-1')
    expect(mocks.state.libraryIds).toEqual(['lib-1'])
  })

  it('批量中后一条失败时恢复真实领域快照，包括集合归属', async () => {
    await expect(executor.apply(step([
      { propertyId: 'asset.display_name', operation: 'set', value: '不应保留' },
      { propertyId: 'asset.tags', operation: 'set', value: ['新'] },
      { propertyId: 'asset.library_refs', operation: 'append', value: 'lib-new' },
      { propertyId: 'asset.media_ref', operation: 'set', value: 'x' },
      // 不可写属性的错误码全项目统一成 PROPERTY_NOT_WRITABLE:<propertyId>，
      // 不再每个领域一个前缀——引擎按这一个码归类，模型也只需认一个。
    ]))).rejects.toThrow('PROPERTY_NOT_WRITABLE:asset.media_ref')

    expect(mocks.state).toEqual({
      displayName: '旧名称',
      tags: ['旧'],
      libraryIds: ['lib-old'],
    })
  })

  it('撤销恢复本次改过的名称、标签和集合归属', async () => {
    const result = await executor.apply(step([
      { propertyId: 'asset.display_name', operation: 'set', value: '新名称' },
      { propertyId: 'asset.tags', operation: 'set', value: ['新'] },
      { propertyId: 'asset.library_refs', operation: 'append', value: 'lib-new' },
    ]))

    await executor.undo(String(result.undoToken))
    expect(mocks.state).toEqual({
      displayName: '旧名称',
      tags: ['旧'],
      libraryIds: ['lib-old'],
    })
    await expect(executor.undo(String(result.undoToken))).rejects.toThrow('ASSET_UNDO_NOT_FOUND')
  })

  it('集合归属不支持 set，错误信息给出替代做法', async () => {
    await expect(executor.apply(step([
      { propertyId: 'asset.library_refs', operation: 'set', value: [] },
    ]))).rejects.toThrow(/只支持 append \/ remove/)
  })
})
