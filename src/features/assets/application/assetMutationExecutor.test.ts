import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replaceTags: vi.fn().mockResolvedValue({ assetId: 'asset-1', tags: ['新'], revision: 2 }),
  addToLibrary: vi.fn().mockResolvedValue({}),
  removeFromLibrary: vi.fn().mockResolvedValue({}),
  read: vi.fn().mockResolvedValue({ 'asset.tags': ['旧'] }),
}))

vi.mock('./assetApplicationService', () => ({
  assetApplicationService: {
    replaceTags: mocks.replaceTags,
    addToLibrary: mocks.addToLibrary,
    removeFromLibrary: mocks.removeFromLibrary,
    read: mocks.read,
  },
}))

import { AssetMutationExecutor } from './assetMutationExecutor'

/**
 * `asset.tags` 早就声明为可写，但素材领域一个 mutation 执行器都没有——
 * `describe_application_entities` 会告诉模型这个属性能改，实际写入必然命中
 * `MUTATION_EXECUTOR_NOT_FOUND`。这是一个悬空声明，本执行器把它闭合。
 *
 * `library_refs` 是 `ref_list`，集合归属用属性的 append / remove 表达，
 * 不需要独立的集合执行器：素材本身由导入链路创建，助手无法凭属性创建。
 */
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
    revision = 0
    mocks.read.mockResolvedValue({ 'asset.tags': ['旧'] })
  })

  it('标签写入委托 replaceTags 并回带写入后的 revision', async () => {
    const result = await executor.apply(step([
      { propertyId: 'asset.tags', operation: 'set', value: ['风景', '夜景'] },
    ]))

    expect(mocks.replaceTags).toHaveBeenCalledWith('asset-1', ['风景', '夜景'])
    expect(result.status).toBe('completed')
    expect(result.resultingRevisions.assets).toBe(1)
  })

  it('集合归属用 append / remove 表达，分别委托加入与移出', async () => {
    await executor.apply(step([
      { propertyId: 'asset.library_refs', operation: 'append', value: { kind: 'asset.library', id: 'lib-1' } },
    ]))
    expect(mocks.addToLibrary).toHaveBeenCalledWith('lib-1', 'asset-1')

    await executor.apply(step([
      { propertyId: 'asset.library_refs', operation: 'remove', value: 'lib-2' },
    ]))
    expect(mocks.removeFromLibrary).toHaveBeenCalledWith('lib-2', 'asset-1')
  })

  it('只读属性被拒，错误信息列出可写属性', async () => {
    await expect(executor.apply(step([
      { propertyId: 'asset.media_ref', operation: 'set', value: 'x' },
    ]))).rejects.toThrow(/ASSET_PROPERTY_NOT_WRITABLE[\s\S]*asset\.tags/)
    expect(mocks.replaceTags).not.toHaveBeenCalled()
  })

  it('集合归属不支持 set，错误信息给出替代做法', async () => {
    await expect(executor.apply(step([
      { propertyId: 'asset.library_refs', operation: 'set', value: [] },
    ]))).rejects.toThrow(/只支持 append \/ remove/)
  })

  it('批量中后一条失败时，前一条已写入的标签被恢复', async () => {
    await expect(executor.apply(step([
      { propertyId: 'asset.tags', operation: 'set', value: ['新'] },
      { propertyId: 'asset.media_ref', operation: 'set', value: 'x' },
    ]))).rejects.toThrow('ASSET_PROPERTY_NOT_WRITABLE')

    // 第一次是写入新值，第二次是回滚到写入前的旧值
    expect(mocks.replaceTags).toHaveBeenNthCalledWith(1, 'asset-1', ['新'])
    expect(mocks.replaceTags).toHaveBeenNthCalledWith(2, 'asset-1', ['旧'])
  })

  it('撤销把标签恢复到写入前', async () => {
    const result = await executor.apply(step([
      { propertyId: 'asset.tags', operation: 'set', value: ['新'] },
    ]))
    vi.clearAllMocks()
    await executor.undo(result.undoToken!)
    expect(mocks.replaceTags).toHaveBeenCalledWith('asset-1', ['旧'])
  })
})
