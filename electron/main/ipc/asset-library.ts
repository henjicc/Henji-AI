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

export function registerAssetLibraryIpc(): void {
  logger.info('开始注册资产库 IPC', { event: 'asset_library.ipc.register.start' })
  registerIpcHandler('assetLibrary:createAsset', parseCreate, createAsset)
  registerIpcHandler('assetLibrary:updateAsset', parseName, ({ id, name }) => updateAsset({ id, displayName: name }))
  registerIpcHandler('assetLibrary:deleteAsset', (input) => parseStringField(input, 'id'), deleteAsset)
  registerIpcHandler('assetLibrary:queryAssets', parseQuery, queryAssets)
  registerIpcHandler('assetLibrary:touchAsset', (input) => parseStringField(input, 'id'), touchAsset)
  registerIpcHandler('assetLibrary:checkPaths', parseFilePaths, checkAssetPaths)
  registerIpcHandler('assetLibrary:inspectAsset', (input) => parseStringField(input, 'id'), inspectAsset)
  registerIpcHandler('assetLibrary:inspectAssets', parseIds, inspectAssets)
  registerIpcHandler('assetLibrary:relocateAsset', (input) => { const record = parseRecord(input); return { id: requiredString(record, 'id'), filePath: requiredString(record, 'filePath') } }, ({ id, filePath }) => relocateAsset(id, filePath))
  registerIpcHandler('assetLibrary:listLibraries', parseVoid, listLibraries)
  registerIpcHandler('assetLibrary:inspectLibrary', (input) => parseStringField(input, 'id'), inspectLibrary)
  registerIpcHandler('assetLibrary:createLibrary', (input) => parseStringField(input, 'name'), createLibrary)
  registerIpcHandler('assetLibrary:renameLibrary', parseName, ({ id, name }) => renameLibrary(id, name))
  registerIpcHandler('assetLibrary:deleteLibrary', (input) => parseStringField(input, 'id'), deleteLibrary)
  registerIpcHandler('assetLibrary:restoreLibrary', parseLibrarySnapshot, restoreLibrary)
  registerIpcHandler('assetLibrary:addToLibrary', parsePair, ({ libraryId, assetId }) => addAssetToLibrary(libraryId, assetId))
  registerIpcHandler('assetLibrary:removeFromLibrary', parsePair, ({ libraryId, assetId }) => removeAssetFromLibrary(libraryId, assetId))
  registerIpcHandler('assetLibrary:listTags', parseVoid, listTags)
  registerIpcHandler('assetLibrary:setAssetTags', parseAssetTags, ({ assetId, tags }) => setAssetTags(assetId, tags))
  registerIpcHandler('assetLibrary:rebaseDataRoot', (input) => { const record = parseRecord(input); return { oldRoot: requiredString(record, 'oldRoot'), newRoot: requiredString(record, 'newRoot') } }, ({ oldRoot, newRoot }) => rebaseAssetDataRoot(oldRoot, newRoot))
  logger.info('资产库 IPC 注册完成', {
    event: 'asset_library.ipc.register.completed',
    context: { handlerCount: 20 },
  })
}
