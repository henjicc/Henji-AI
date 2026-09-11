import type { ApplicationRef } from '../../../src/core/application-control/identifiers'
import { applicationPersistenceCorrelationSchema, type ApplicationPersistenceCorrelation } from '../../../src/core/application-control/persistenceCorrelation'
import { AgentOperationStore } from '../services/agent-runtime/persistence/operation-store'
import { getDb } from '../services/db'
import { digestJson } from '../services/agent-runtime/tools/security'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { addAssetToLibrary, checkAssetPaths, createAsset, createLibrary, deleteAsset, deleteLibrary, inspectAsset, inspectAssets, inspectLibrary, listLibraries, listTags, queryAssets, rebaseAssetDataRoot, relocateAsset, removeAssetFromLibrary, renameLibrary, restoreLibrary, setAssetTags, touchAsset, updateAsset } from '../services/asset-library'
import type { AssetLibrarySnapshotDto, AssetMediaType, AssetQuery, AssetSource, CreateAssetRequest } from '../services/asset-library/types'
import { createMainLogger } from '../services/logging'

const logger = createMainLogger('main.asset_library')

const MEDIA_TYPES = new Set<AssetMediaType>(['image', 'video', 'audio'])
const SOURCES = new Set<AssetSource>(['generated', 'canvas', 'camera-stage', 'imported', 'external'])
function requiredString(record: Record<string, unknown>, key: string): string { const value = record[key]; if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`); return value }
function parseCreate(input: unknown): CreateAssetRequest { const record = parseRecord(input); const mediaType = requiredString(record, 'mediaType') as AssetMediaType; const source = requiredString(record, 'source') as AssetSource; if (!MEDIA_TYPES.has(mediaType) || !SOURCES.has(source)) throw new Error('Invalid asset type or source'); const displayName = typeof record.displayName === 'string' ? record.displayName : undefined; const libraryIds = Array.isArray(record.libraryIds) ? record.libraryIds.map((value) => { if (typeof value !== 'string') throw new Error('libraryIds must contain strings'); return value }) : undefined; return { filePath: requiredString(record, 'filePath'), mediaType, source, displayName, libraryIds } }
function parseIds(input: unknown): string[] { const record = parseRecord(input); if (!Array.isArray(record.ids)) throw new Error('ids must be an array'); return record.ids.map((value) => { if (typeof value !== 'string') throw new Error('ids must contain strings'); return value }) }
function parseFilePaths(input: unknown): string[] { const record = parseRecord(input); if (!Array.isArray(record.filePaths)) throw new Error('filePaths must be an array'); return record.filePaths.map((value) => { if (typeof value !== 'string') throw new Error('filePaths must contain strings'); return value }) }
function parsePair(input: unknown): { libraryId: string; assetId: string } { const record = parseRecord(input); return { libraryId: requiredString(record, 'libraryId'), assetId: requiredString(record, 'assetId') } }
function parseName(input: unknown): { id: string; name: string } { const record = parseRecord(input); return { id: requiredString(record, 'id'), name: requiredString(record, 'name') } }
function parseQuery(input: unknown): AssetQuery { const record = parseRecord(input); const mediaType = typeof record.mediaType === 'string' && MEDIA_TYPES.has(record.mediaType as AssetMediaType) ? record.mediaType as AssetMediaType : undefined; return { mediaType, libraryId: typeof record.libraryId === 'string' ? record.libraryId : undefined, tag: typeof record.tag === 'string' ? record.tag : undefined, keyword: typeof record.keyword === 'string' ? record.keyword : undefined, page: Math.max(1, Number(record.page) || 1), pageSize: Math.min(200, Math.max(1, Number(record.pageSize) || 50)), sort: record.sort === 'recent' ? 'recent' : 'created' } }
function parseAssetTags(input: unknown): { assetId: string; tags: string[] } { const record = parseRecord(input); if (!Array.isArray(record.tags) || !record.tags.every((tag) => typeof tag === 'string')) throw new Error('tags must be a string array'); return { assetId: requiredString(record, 'assetId'), tags: record.tags } }
function parseLibrarySnapshot(input: unknown): AssetLibrarySnapshotDto {
  const record = parseRecord(input)
  if (!Array.isArray(record.assetIds) || !record.assetIds.every((id) => typeof id === 'string' && id.trim())) {
    throw new Error('assetIds must contain non-empty strings')
  }
  const createdAt = Number(record.createdAt)
  const updatedAt = Number(record.updatedAt)
  if (!Number.isFinite(createdAt) || createdAt < 0 || !Number.isFinite(updatedAt) || updatedAt < 0) {
    throw new Error('createdAt and updatedAt must be non-negative numbers')
  }
  return {
    id: requiredString(record, 'id'),
    name: requiredString(record, 'name'),
    createdAt,
    updatedAt,
    assetIds: record.assetIds,
  }
}


function correlated<T>(parse: (input: unknown) => T) {
  return (input: unknown): { value: T; operationCorrelation?: ApplicationPersistenceCorrelation } => {
    const record = parseRecord(input)
    return { value: parse(input), ...(record.operationCorrelation === undefined ? {} : {
      operationCorrelation: applicationPersistenceCorrelationSchema.parse(record.operationCorrelation),
    }) }
  }
}

/** 复用原领域 SQL；新建的稳定引用由实际写入结果产生，与保存回执共用事务。 */
function persistAssetWrite<T, R>(action: string, input: { value: T; operationCorrelation?: ApplicationPersistenceCorrelation },
  webContentsId: number, write: (value: T) => R, targets: (result: R) => ApplicationRef[]): R {
  if (!input.operationCorrelation) return write(input.value)
  const correlation = input.operationCorrelation
  const database = getDb()
  const operations = new AgentOperationStore(database)
  operations.assertPersistenceOwner(correlation.operationId, webContentsId)
  return database.transaction(() => {
    const result = write(input.value)
    const actualTargets = targets(result)
    if (correlation.targets.some((ref) => !actualTargets.some((target) => target.kind === ref.kind && target.id === ref.id))) {
      throw new Error('OPERATION_PERSISTENCE_TARGET_INVALID:保存关联与实际素材目标不符')
    }
    if (!actualTargets[0]) throw new Error('OPERATION_PERSISTENCE_TARGET_MISSING')
    operations.recordPersistence({ ...correlation, targets: actualTargets }, actualTargets[0], digestJson({ action, input: input.value }))
    return result
  }).immediate()
}

export function registerAssetLibraryIpc(): void {
  logger.info('开始注册资产库 IPC', { event: 'asset_library.ipc.register.start' })
  registerIpcHandler('assetLibrary:createAsset', correlated(parseCreate), (input, event) => {
    const asset = persistAssetWrite('createAsset', input, event.sender.id, (value) => createAsset(value, { inspect: false }),
      (created) => [{ kind: 'asset', id: created.id }])
    // 必须在外层 SQLite 提交后启动异步检查，避免回滚后继续处理不存在的资产。
    void inspectAsset(asset.id).catch((error: unknown) => logger.error('资产登记后检查失败', {
      event: 'asset.create.inspect.failed', error, context: { assetId: asset.id },
    }))
    return asset
  })
  registerIpcHandler('assetLibrary:updateAsset', correlated(parseName), (input, event) => persistAssetWrite('updateAsset', input, event.sender.id, ({ id, name }) => updateAsset({ id, displayName: name }), (asset) => [{ kind: 'asset', id: asset.id }]))
  registerIpcHandler('assetLibrary:deleteAsset', correlated((input) => parseStringField(input, 'id')), (input, event) => persistAssetWrite('deleteAsset', input, event.sender.id, deleteAsset, () => [{ kind: 'asset', id: input.value }]))
  registerIpcHandler('assetLibrary:queryAssets', parseQuery, queryAssets)
  registerIpcHandler('assetLibrary:touchAsset', (input) => parseStringField(input, 'id'), touchAsset)
  registerIpcHandler('assetLibrary:checkPaths', parseFilePaths, checkAssetPaths)
  registerIpcHandler('assetLibrary:inspectAsset', (input) => parseStringField(input, 'id'), inspectAsset)
  registerIpcHandler('assetLibrary:inspectAssets', parseIds, inspectAssets)
  registerIpcHandler('assetLibrary:relocateAsset', (input) => { const record = parseRecord(input); return { id: requiredString(record, 'id'), filePath: requiredString(record, 'filePath') } }, ({ id, filePath }) => relocateAsset(id, filePath))
  registerIpcHandler('assetLibrary:listLibraries', parseVoid, listLibraries)
  registerIpcHandler('assetLibrary:inspectLibrary', (input) => parseStringField(input, 'id'), inspectLibrary)
  registerIpcHandler('assetLibrary:createLibrary', correlated((input) => parseStringField(input, 'name')), (input, event) => persistAssetWrite('createLibrary', input, event.sender.id, createLibrary, (library) => [{ kind: 'asset.library', id: library.id }]))
  registerIpcHandler('assetLibrary:renameLibrary', correlated(parseName), (input, event) => persistAssetWrite('renameLibrary', input, event.sender.id, ({ id, name }) => renameLibrary(id, name), (library) => [{ kind: 'asset.library', id: library.id }]))
  registerIpcHandler('assetLibrary:deleteLibrary', correlated((input) => parseStringField(input, 'id')), (input, event) => persistAssetWrite('deleteLibrary', input, event.sender.id, deleteLibrary, () => [{ kind: 'asset.library', id: input.value }]))
  registerIpcHandler('assetLibrary:restoreLibrary', correlated(parseLibrarySnapshot), (input, event) => persistAssetWrite('restoreLibrary', input, event.sender.id, restoreLibrary, (library) => [{ kind: 'asset.library', id: library.id }]))
  registerIpcHandler('assetLibrary:addToLibrary', correlated(parsePair), (input, event) => persistAssetWrite('addToLibrary', input, event.sender.id, ({ libraryId, assetId }) => addAssetToLibrary(libraryId, assetId), () => [{ kind: 'asset', id: input.value.assetId }]))
  registerIpcHandler('assetLibrary:removeFromLibrary', correlated(parsePair), (input, event) => persistAssetWrite('removeFromLibrary', input, event.sender.id, ({ libraryId, assetId }) => removeAssetFromLibrary(libraryId, assetId), () => [{ kind: 'asset', id: input.value.assetId }]))
  registerIpcHandler('assetLibrary:listTags', parseVoid, listTags)
  registerIpcHandler('assetLibrary:setAssetTags', correlated(parseAssetTags), (input, event) => persistAssetWrite('setAssetTags', input, event.sender.id, ({ assetId, tags }) => setAssetTags(assetId, tags), (asset) => [{ kind: 'asset', id: asset.id }]))
  registerIpcHandler('assetLibrary:rebaseDataRoot', (input) => { const record = parseRecord(input); return { oldRoot: requiredString(record, 'oldRoot'), newRoot: requiredString(record, 'newRoot') } }, ({ oldRoot, newRoot }) => rebaseAssetDataRoot(oldRoot, newRoot))
  logger.info('资产库 IPC 注册完成', {
    event: 'asset_library.ipc.register.completed',
    context: { handlerCount: 20 },
  })
}
