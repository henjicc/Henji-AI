import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  libraries: new Map<string, { id: string; name: string; createdAt: number; updatedAt: number; assetIds: string[] }>(),
  createLibrary: vi.fn(),
  deleteLibrary: vi.fn(),
  restoreLibrary: vi.fn(),
  inspectLibrary: vi.fn(),
  renameLibrary: vi.fn(),
  listLibraries: vi.fn(),
}))

vi.mock('./assetApplicationService', () => ({
  assetApplicationService: {
    createLibrary: mocks.createLibrary,
    deleteLibrary: mocks.deleteLibrary,
    restoreLibrary: mocks.restoreLibrary,
    inspectLibrary: mocks.inspectLibrary,
    renameLibrary: mocks.renameLibrary,
    listLibraries: mocks.listLibraries,
  },
}))

import {
  AssetLibraryCollectionExecutor,
  resetAssetLibraryCollectionStateForTests,
} from './assetLibraryCollectionExecutor'
import {
  AssetLibraryMutationExecutor,
  resetAssetLibraryMutationStateForTests,
} from './assetLibraryMutationExecutor'

describe('素材集合通用写入执行器', () => {
  let revision = 1
  const dependencies = {
    readRevision: () => revision,
    bumpRevision: () => { revision += 1 },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetAssetLibraryCollectionStateForTests()
    resetAssetLibraryMutationStateForTests()
    revision = 1
    mocks.libraries.clear()
    mocks.libraries.set('lib-old', {
      id: 'lib-old', name: '旧集合', createdAt: 10, updatedAt: 20, assetIds: ['asset-1', 'asset-2'],
    })
    mocks.listLibraries.mockImplementation(async () => [...mocks.libraries.values()].map(({ assetIds: _assetIds, ...item }) => ({ ...item })))
    mocks.inspectLibrary.mockImplementation(async (id: string) => {
      const item = mocks.libraries.get(id)
      if (!item) throw new Error('NOT_FOUND')
      return { ...item, assetIds: [...item.assetIds] }
    })
    mocks.createLibrary.mockImplementation(async (name: string) => {
      const item = { id: 'lib-created', name, createdAt: 30, updatedAt: 30, assetIds: [] }
      mocks.libraries.set(item.id, item)
      return { ...item }
    })
    mocks.deleteLibrary.mockImplementation(async (id: string) => {
      if (!mocks.libraries.delete(id)) throw new Error('NOT_FOUND')
      return {}
    })
    mocks.restoreLibrary.mockImplementation(async (snapshot: { id: string; name: string; createdAt: number; updatedAt: number; assetIds: string[] }) => {
      mocks.libraries.set(snapshot.id, { ...snapshot, assetIds: [...snapshot.assetIds] })
      return { ...snapshot }
    })
    mocks.renameLibrary.mockImplementation(async (id: string, name: string) => {
      const item = mocks.libraries.get(id)
      if (!item) throw new Error('NOT_FOUND')
      item.name = name
      return { ...item }
    })
  })

  it('创建集合后可通过补偿 token 删除创建结果', async () => {
    const executor = new AssetLibraryCollectionExecutor(dependencies)
    const result = await executor.apply({
      kind: 'collection', parent: { kind: 'asset.catalog', id: 'default' }, entityType: 'asset.library',
      expectedRevisions: { assets: 1 },
      operation: { kind: 'create', items: [{ properties: { 'asset.library.name': '新集合' } }] },
    } as never)

    expect(mocks.libraries.get('lib-created')?.name).toBe('新集合')
    await executor.undo(String(result.undoToken))
    expect(mocks.libraries.has('lib-created')).toBe(false)
  })

  it('删除集合后按原 ID、时间和成员关系完整恢复', async () => {
    const executor = new AssetLibraryCollectionExecutor(dependencies)
    const before = structuredClone(mocks.libraries.get('lib-old'))
    const result = await executor.apply({
      kind: 'collection', parent: { kind: 'asset.catalog', id: 'default' }, entityType: 'asset.library',
      expectedRevisions: { assets: 1 },
      operation: { kind: 'remove', targets: [{ kind: 'asset.library', id: 'lib-old' }] },
    } as never)

    expect(mocks.libraries.has('lib-old')).toBe(false)
    await executor.undo(String(result.undoToken))
    expect(mocks.libraries.get('lib-old')).toEqual(before)
  })

  it('集合名称修改后可恢复包含冒号的原名称', async () => {
    const old = mocks.libraries.get('lib-old')
    if (old) old.name = '旧:集合'
    const executor = new AssetLibraryMutationExecutor(dependencies)
    const result = await executor.apply({
      kind: 'mutation', target: { kind: 'asset.library', id: 'lib-old' }, entityType: 'asset.library',
      expectedRevisions: { assets: 1 },
      mutations: [{ propertyId: 'asset.library.name', operation: 'set', value: '新集合名' }],
    } as never)

    expect(mocks.libraries.get('lib-old')?.name).toBe('新集合名')
    await executor.undo(String(result.undoToken))
    expect(mocks.libraries.get('lib-old')?.name).toBe('旧:集合')
  })
})
