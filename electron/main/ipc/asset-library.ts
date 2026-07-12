import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { addAssetToLibrary, createAsset, createLibrary, deleteAsset, deleteLibrary, inspectAsset, inspectAssets, listLibraries, queryAssets, relocateAsset, removeAssetFromLibrary, renameLibrary, touchAsset, updateAsset } from '../services/asset-library'
import type { AssetMediaType, AssetQuery, AssetSource, CreateAssetRequest } from '../services/asset-library/types'

const MEDIA_TYPES = new Set<AssetMediaType>(['image', 'video', 'audio'])
const SOURCES = new Set<AssetSource>(['generated', 'canvas', 'camera-stage', 'imported', 'external'])
function requiredString(record: Record<string, unknown>, key: string): string { const value = record[key]; if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`); return value }
function parseCreate(input: unknown): CreateAssetRequest { const record = parseRecord(input); const mediaType = requiredString(record, 'mediaType') as AssetMediaType; const source = requiredString(record, 'source') as AssetSource; if (!MEDIA_TYPES.has(mediaType) || !SOURCES.has(source)) throw new Error('Invalid asset type or source'); const displayName = typeof record.displayName === 'string' ? record.displayName : undefined; const libraryIds = Array.isArray(record.libraryIds) ? record.libraryIds.map((value) => { if (typeof value !== 'string') throw new Error('libraryIds must contain strings'); return value }) : undefined; return { filePath: requiredString(record, 'filePath'), mediaType, source, displayName, libraryIds } }
function parseIds(input: unknown): string[] { const record = parseRecord(input); if (!Array.isArray(record.ids)) throw new Error('ids must be an array'); return record.ids.map((value) => { if (typeof value !== 'string') throw new Error('ids must contain strings'); return value }) }
function parsePair(input: unknown): { libraryId: string; assetId: string } { const record = parseRecord(input); return { libraryId: requiredString(record, 'libraryId'), assetId: requiredString(record, 'assetId') } }
function parseName(input: unknown): { id: string; name: string } { const record = parseRecord(input); return { id: requiredString(record, 'id'), name: requiredString(record, 'name') } }
function parseQuery(input: unknown): AssetQuery { const record = parseRecord(input); const mediaType = typeof record.mediaType === 'string' && MEDIA_TYPES.has(record.mediaType as AssetMediaType) ? record.mediaType as AssetMediaType : undefined; return { mediaType, libraryId: typeof record.libraryId === 'string' ? record.libraryId : undefined, keyword: typeof record.keyword === 'string' ? record.keyword : undefined, page: Math.max(1, Number(record.page) || 1), pageSize: Math.min(200, Math.max(1, Number(record.pageSize) || 50)), sort: record.sort === 'recent' ? 'recent' : 'created' } }

export function registerAssetLibraryIpc(): void {
  registerIpcHandler('assetLibrary:createAsset', parseCreate, createAsset)
  registerIpcHandler('assetLibrary:updateAsset', parseName, ({ id, name }) => updateAsset({ id, displayName: name }))
  registerIpcHandler('assetLibrary:deleteAsset', (input) => parseStringField(input, 'id'), deleteAsset)
  registerIpcHandler('assetLibrary:queryAssets', parseQuery, queryAssets)
  registerIpcHandler('assetLibrary:touchAsset', (input) => parseStringField(input, 'id'), touchAsset)
  registerIpcHandler('assetLibrary:inspectAsset', (input) => parseStringField(input, 'id'), inspectAsset)
  registerIpcHandler('assetLibrary:inspectAssets', parseIds, inspectAssets)
  registerIpcHandler('assetLibrary:relocateAsset', (input) => { const record = parseRecord(input); return { id: requiredString(record, 'id'), filePath: requiredString(record, 'filePath') } }, ({ id, filePath }) => relocateAsset(id, filePath))
  registerIpcHandler('assetLibrary:listLibraries', parseVoid, listLibraries)
  registerIpcHandler('assetLibrary:createLibrary', (input) => parseStringField(input, 'name'), createLibrary)
  registerIpcHandler('assetLibrary:renameLibrary', parseName, ({ id, name }) => renameLibrary(id, name))
  registerIpcHandler('assetLibrary:deleteLibrary', (input) => parseStringField(input, 'id'), deleteLibrary)
  registerIpcHandler('assetLibrary:addToLibrary', parsePair, ({ libraryId, assetId }) => addAssetToLibrary(libraryId, assetId))
  registerIpcHandler('assetLibrary:removeFromLibrary', parsePair, ({ libraryId, assetId }) => removeAssetFromLibrary(libraryId, assetId))
}

