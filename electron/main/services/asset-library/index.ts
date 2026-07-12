import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { allowMediaRoot } from '../../protocol'
import { getDb } from '../db'
import { createMainLogger } from '../logging'
import { inspectMedia, normalizeAssetPath } from './mediaInspection'
import { ensureAssetThumbnail } from './thumbnailService'
import type { AssetDto, AssetLibraryDto, AssetPageDto, AssetQuery, CreateAssetRequest, UpdateAssetRequest } from './types'

const logger = createMainLogger('main.asset-library')
type AssetRow = { id: string; media_type: AssetDto['mediaType']; display_name: string; file_path: string; source: AssetDto['source']; mime_type: string | null; size_bytes: number | null; width: number | null; height: number | null; duration_seconds: number | null; thumbnail_path: string | null; inspection_status: AssetDto['inspectionStatus']; inspection_error: string | null; file_modified_at: number | null; last_used_at: number | null; created_at: number; updated_at: number }
type LibraryRow = { id: string; name: string; created_at: number; updated_at: number }

function mediaUrl(filePath: string): string { return `henji-media://local/${encodeURIComponent(filePath)}` }
function mapAsset(row: AssetRow): AssetDto { return { id: row.id, mediaType: row.media_type, displayName: row.display_name, filePath: row.file_path, displayUrl: mediaUrl(row.file_path), source: row.source, mimeType: row.mime_type, sizeBytes: row.size_bytes, width: row.width, height: row.height, durationSeconds: row.duration_seconds, thumbnailPath: row.thumbnail_path, thumbnailUrl: row.thumbnail_path ? mediaUrl(row.thumbnail_path) : null, inspectionStatus: row.inspection_status, inspectionError: row.inspection_error, fileModifiedAt: row.file_modified_at, lastUsedAt: row.last_used_at, createdAt: row.created_at, updatedAt: row.updated_at } }
function getAsset(id: string): AssetDto { const row = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined; if (!row) throw new Error('资产不存在'); return mapAsset(row) }

export function createAsset(input: CreateAssetRequest): AssetDto {
  const filePath = normalizeAssetPath(input.filePath)
  const now = Date.now()
  logger.info('开始登记资产', { event: 'asset.create.start', context: { mediaType: input.mediaType, source: input.source } })
  const transaction = getDb().transaction(() => {
    const existing = getDb().prepare('SELECT * FROM assets WHERE file_path = ?').get(filePath) as AssetRow | undefined
    const id = existing?.id ?? crypto.randomUUID()
    if (!existing) getDb().prepare('INSERT INTO assets (id, media_type, display_name, file_path, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.mediaType, input.displayName?.trim() || path.basename(filePath), filePath, input.source, now, now)
    const insertItem = getDb().prepare('INSERT OR IGNORE INTO asset_library_items (library_id, asset_id, added_at) VALUES (?, ?, ?)')
    for (const libraryId of input.libraryIds ?? []) insertItem.run(libraryId, id, now)
    return id
  })
  try {
    const asset = getAsset(transaction())
    logger.info('资产登记完成', { event: 'asset.create.completed', context: { assetId: asset.id } })
    void inspectAsset(asset.id)
    return asset
  } catch (error) {
    logger.error('资产登记失败', { event: 'asset.create.failed', error })
    throw error
  }
}

export async function inspectAsset(id: string): Promise<AssetDto> {
  const asset = getAsset(id)
  logger.info('开始检查资产', { event: 'asset.inspect.start', context: { assetId: id } })
  try {
    allowMediaRoot(path.dirname(asset.filePath))
    const info = await inspectMedia(asset.filePath, asset.mediaType)
    let thumbnailPath: string | null = null
    try { thumbnailPath = await ensureAssetThumbnail(asset.filePath, asset.mediaType, info.fileModifiedAt) } catch (error) { logger.warn('资产缩略图生成失败', { event: 'asset.thumbnail.failed', error, context: { assetId: id } }) }
    getDb().prepare(`UPDATE assets SET mime_type=?, size_bytes=?, width=?, height=?, duration_seconds=?, thumbnail_path=?, inspection_status='ready', inspection_error=NULL, file_modified_at=?, updated_at=? WHERE id=?`).run(info.mimeType, info.sizeBytes, info.width, info.height, info.durationSeconds, thumbnailPath, info.fileModifiedAt, Date.now(), id)
    if (thumbnailPath) allowMediaRoot(path.dirname(thumbnailPath))
    logger.info('资产检查完成', { event: 'asset.inspect.completed', context: { assetId: id } })
  } catch (error) {
    const missing = await fs.access(asset.filePath).then(() => false).catch(() => true)
    getDb().prepare('UPDATE assets SET inspection_status=?, inspection_error=?, updated_at=? WHERE id=?').run(missing ? 'missing' : 'failed', error instanceof Error ? error.message.slice(0, 500) : 'Unknown inspection error', Date.now(), id)
    logger.error('资产检查失败', { event: 'asset.inspect.failed', error, context: { assetId: id, missing } })
  }
  return getAsset(id)
}

export async function inspectAssets(ids: string[]): Promise<AssetDto[]> { return await Promise.all(ids.map(inspectAsset)) }
export async function relocateAsset(id: string, nextPath: string): Promise<AssetDto> { const filePath = normalizeAssetPath(nextPath); getDb().prepare(`UPDATE assets SET file_path=?, inspection_status='pending', inspection_error=NULL, updated_at=? WHERE id=?`).run(filePath, Date.now(), id); return await inspectAsset(id) }
export function updateAsset(input: UpdateAssetRequest): AssetDto { getDb().prepare('UPDATE assets SET display_name=?, updated_at=? WHERE id=?').run(input.displayName.trim(), Date.now(), input.id); return getAsset(input.id) }
export function deleteAsset(id: string): void { getDb().prepare('DELETE FROM assets WHERE id=?').run(id) }
export function touchAsset(id: string): void { getDb().prepare('UPDATE assets SET last_used_at=?, updated_at=? WHERE id=?').run(Date.now(), Date.now(), id) }

export function createLibrary(name: string): AssetLibraryDto { const now = Date.now(); const id = crypto.randomUUID(); getDb().prepare('INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, name.trim(), now, now); return { id, name: name.trim(), createdAt: now, updatedAt: now } }
export function listLibraries(): AssetLibraryDto[] { return (getDb().prepare('SELECT * FROM asset_libraries ORDER BY name COLLATE NOCASE').all() as LibraryRow[]).map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at })) }
export function renameLibrary(id: string, name: string): AssetLibraryDto { getDb().prepare('UPDATE asset_libraries SET name=?, updated_at=? WHERE id=?').run(name.trim(), Date.now(), id); const row = getDb().prepare('SELECT * FROM asset_libraries WHERE id=?').get(id) as LibraryRow | undefined; if (!row) throw new Error('资产库不存在'); return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at } }
export function deleteLibrary(id: string): void { getDb().prepare('DELETE FROM asset_libraries WHERE id=?').run(id) }
export function addAssetToLibrary(libraryId: string, assetId: string): void { getDb().prepare('INSERT OR IGNORE INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)').run(libraryId, assetId, Date.now()) }
export function removeAssetFromLibrary(libraryId: string, assetId: string): void { getDb().prepare('DELETE FROM asset_library_items WHERE library_id=? AND asset_id=?').run(libraryId, assetId) }

export function queryAssets(query: AssetQuery): AssetPageDto {
  const where: string[] = []; const params: Array<string | number> = []
  let join = ''
  if (query.libraryId) { join = ' JOIN asset_library_items ali ON ali.asset_id=a.id'; where.push('ali.library_id=?'); params.push(query.libraryId) }
  if (query.mediaType) { where.push('a.media_type=?'); params.push(query.mediaType) }
  if (query.keyword?.trim()) { where.push('a.display_name LIKE ? ESCAPE \'\\\''); params.push(`%${query.keyword.trim().replace(/[\\%_]/g, '\\$&')}%`) }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const total = (getDb().prepare(`SELECT COUNT(*) total FROM assets a${join}${clause}`).get(...params) as { total: number }).total
  const offset = (query.page - 1) * query.pageSize
  const order = query.sort === 'recent' ? 'COALESCE(a.last_used_at,0) DESC, a.created_at DESC' : 'a.created_at DESC'
  const rows = getDb().prepare(`SELECT a.* FROM assets a${join}${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, query.pageSize, offset) as AssetRow[]
  for (const row of rows) {
    allowMediaRoot(path.dirname(row.file_path))
    if (row.thumbnail_path) allowMediaRoot(path.dirname(row.thumbnail_path))
  }
  return { items: rows.map(mapAsset), total, page: query.page, pageSize: query.pageSize }
}
