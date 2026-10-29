// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const commands = vi.hoisted(() => ({
  addAssetToLibrary: vi.fn(),
  deleteAsset: vi.fn(),
  inspectAsset: vi.fn(),
  inspectAssets: vi.fn(),
  listAssetLibraries: vi.fn(),
  listAssetTags: vi.fn(),
  queryAssets: vi.fn(),
  relocateAsset: vi.fn(),
  removeAssetFromLibrary: vi.fn(),
  setAssetTags: vi.fn(),
}))

vi.mock('@/commands/assetLibrary', () => commands)

import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'

import { assetApplicationService } from './assetApplicationService'
import { deleteAssetsBatch } from './assetBatchOperations'
import { registerAssetCapabilityHandlers } from './registerAssetCapabilityHandlers'
import type { CapabilityHandler } from '@/features/application-control/capabilities/handlerTypes'
import { ApplicationControlExecutionEngine, ApplicationReflectionRegistry, type ApplicationExecutionContext } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { createAssetReflectionRegistrations } from './assetReflection'
import { AssetMutationExecutor } from './assetMutationExecutor'

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
  contentIdentity: 'a'.repeat(64),
  lastUsedAt: 1,
  createdAt: 1,
  updatedAt: 2,
  tags: ['参考'],
  libraryIds: ['library-1'],
}

describe('asset application service', () => {
  it('位置通过正式描述、通用属性事务和读回生效，撤销恢复失联位置', async () => {
    let revision = 0
    const original = 'henji://project/lost/materials/image.png'
    let current = { ...asset, filePath: original, displayUrl: '' }
    commands.inspectAsset.mockImplementation(async () => current)
    commands.relocateAsset.mockImplementation(async (_id: string, location: string) => {
      current = { ...current, filePath: location, displayUrl: location.startsWith('henji:') ? '' : location }
      return current
    })
    const registry = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
    createAssetReflectionRegistrations(() => revision).forEach(item => registry.register(item))
    const engine = new ApplicationControlExecutionEngine(registry)
    const executor = new AssetMutationExecutor({ readRevision: () => revision, bumpRevision: () => { revision++ } })
    engine.registerMutationExecutor(executor)
    const context: ApplicationExecutionContext = { requestId: 'asset-location', exposure: 'assistant', acceptedDataClasses: new Set(['C0', 'C1']) }
    const descriptor = registry.describe({ entityTypes: ['asset'] }, context).properties.find(item => item.id === 'asset.location')
    expect(descriptor).toMatchObject({ requiredPermissions: { write: ['assets:write'] } })
    expect(executor.propertyOperations.get('asset.location')).toEqual(new Set(['set']))
    const location = 'henji-media://local/%2Fmedia%2Fnew.png'
    const request = { summary: '重新定位素材', transactionMode: 'atomic' as const, steps: [{ kind: 'mutation' as const, target: { kind: 'asset', id: asset.id }, entityType: 'asset', expectedRevisions: { assets: 0 }, mutations: [{ propertyId: 'asset.location', operation: 'set' as const, value: location }] }] }
    const invalidPlan = await engine.plan({ ...request, steps: [{ ...request.steps[0], mutations: [{ propertyId: 'asset.location', operation: 'set', value: 'https://example.com/image.png' }] }] }, context)
    expect((await engine.commit({ planRef: invalidPlan.planRef, expectedRevisions: { assets: 0 }, idempotencyKey: 'asset-location-invalid-01' }, context)).status).toBe('failed')
    expect(current.filePath).toBe(original)
    expect(commands.relocateAsset).not.toHaveBeenCalled()
    const plan = await engine.plan(request, context)
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: { assets: 0 }, idempotencyKey: 'asset-location-change-01' }, context)
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    const provider = createAssetReflectionRegistrations(() => revision).find(item => item.entity.id === 'asset')!.provider!
    expect((await provider.readEntity({ kind: 'asset', id: asset.id }, {})).properties['asset.location']).toBe(location)
    expect(current.filePath).toBe(location)
    const undo = await engine.undo({ undoRef: result.undoRef!, expectedRevisions: { assets: revision }, idempotencyKey: 'asset-location-undo-01' }, context)
    expect(undo.status).toBe('completed')
    expect(current.filePath).toBe(original)
    expect((await provider.readEntity({ kind: 'asset', id: asset.id }, {})).properties['asset.location']).toBe(original)
  })
  it('重新定位复用正式命令并刷新选中素材，失败保持选择', async () => {
    useAssetLibraryStore.getState().setSelectedAsset(asset)
    const next = { ...asset, filePath: '/media/new.png', displayUrl: 'henji-media://local/%2Fmedia%2Fnew.png' }
    commands.relocateAsset.mockResolvedValueOnce(next)
    await assetApplicationService.relocate(asset.id, next.filePath)
    expect(commands.relocateAsset).toHaveBeenCalledWith(asset.id, next.filePath)
    expect(useAssetLibraryStore.getState().selectedAsset).toEqual(next)
    commands.relocateAsset.mockRejectedValueOnce(new Error('位置无效'))
    await expect(assetApplicationService.relocate(asset.id, 'bad')).rejects.toThrow('位置无效')
    expect(useAssetLibraryStore.getState().selectedAsset).toEqual(next)
  })
  it('删除由主进程核验；不存在的素材不能再用严格检查接口读回', async () => {
    commands.inspectAssets.mockRejectedValue(new Error('资产不存在'))
    expect(await assetApplicationService.delete(asset.id)).toMatchObject({ verification: { verified: true } })
    expect(commands.inspectAssets).not.toHaveBeenCalled()
  })
  it('批量删除复用正式服务，全部删除成功时没有失败记录', async () => {
    commands.inspectAssets.mockRejectedValue(new Error('资产不存在'))
    const result = await deleteAssetsBatch([asset, { ...asset, id: 'asset-2' }])
    expect(result).toMatchObject({ succeededIds: ['asset-1', 'asset-2'], failures: [] })
  })
  it('delete_asset 处理器通过同源服务返回已核验的删除结果', async () => {
    commands.inspectAssets.mockRejectedValue(new Error('资产不存在'))
    const handlers = new Map<string, CapabilityHandler>()
    registerAssetCapabilityHandlers({ registerHandler: (id, handler) => { handlers.set(id, handler) } })
    await expect(handlers.get('delete_asset')!({ assetId: asset.id }, { signal: new AbortController().signal })).resolves.toMatchObject({ assetId: asset.id, status: 'deleted', verification: { verified: true } })
  })
  it('删除或主进程核验失败继续上抛，不清除当前选择', async () => {
    useAssetLibraryStore.getState().setSelectedAsset(asset)
    commands.deleteAsset.mockRejectedValueOnce(new Error('删除后素材仍存在'))
    await expect(assetApplicationService.delete(asset.id)).rejects.toThrow('仍存在')
    expect(useAssetLibraryStore.getState().selectedAsset?.id).toBe(asset.id)
  })
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
    expect(JSON.stringify(page)).not.toContain('contentIdentity')
    expect(detail).not.toHaveProperty('contentIdentity')
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
