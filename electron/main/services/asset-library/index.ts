import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { allowMediaRoot, isPathWithinAllowedMediaRoots } from '../../protocol'
import { getProgramStoreDir } from '../appPaths'
import { getDb } from '../db'
import { databaseLocations } from '../db-locations'
import { createMainLogger } from '../logging'
import { inspectMedia, normalizeAssetPath } from './mediaInspection'
import { ensureAssetThumbnail } from './thumbnailService'
import type { AssetDto, AssetFileContent, AssetLibraryDto, AssetLibrarySnapshotDto, AssetPageDto, AssetQuery, CreateAssetRequest, UpdateAssetRequest } from './types'

const logger = createMainLogger('main.asset-library')
type AssetRow = { id: string; media_type: AssetDto['mediaType']; display_name: string; file_path: string; source: AssetDto['source']; mime_type: string | null; size_bytes: number | null; width: number | null; height: number | null; duration_seconds: number | null; thumbnail_path: string | null; inspection_status: AssetDto['inspectionStatus']; inspection_error: string | null; file_modified_at: number | null; content_identity?: string | null; last_used_at: number | null; created_at: number; updated_at: number }
type LibraryRow = { id: string; name: string; created_at: number; updated_at: number }
/** 表里的原始行：文件位置是位置写法（实施方案 2.5），缩略图只存文件名（迁移账本第 8、14 项）。 */
type StoredAssetRow = Omit<AssetRow, 'thumbnail_path'> & { thumbnail_name: string | null }

function thumbnailPathFor(name: string | null): string | null {
  return name ? path.join(getProgramStoreDir('thumbnails'), name) : null
}
/** 读出：文件位置换回绝对路径，缩略图按当前程序目录拼出。 */
function decodeAssetRows(rows: StoredAssetRow[]): AssetRow[] {
  if (rows.length === 0) return []
  return databaseLocations.use((scope) => rows.map(({ thumbnail_name: thumbnailName, ...row }) => ({
    ...row, file_path: scope.decodePath(row.file_path), thumbnail_path: thumbnailPathFor(thumbnailName),
  })))
}
/** 写入与按位置查找：绝对路径 → 位置写法。 */
function encodeAssetPath(filePath: string): string {
  return databaseLocations.use((scope) => scope.encodePath(filePath))
}

function mediaUrl(filePath: string): string { return `henji-media://local/${encodeURIComponent(filePath)}` }
function mapAsset(row: AssetRow): AssetDto {
  const tags = (getDb().prepare('SELECT t.name FROM asset_tags t JOIN asset_tag_items ati ON ati.tag_id=t.id WHERE ati.asset_id=? ORDER BY t.name COLLATE NOCASE').all(row.id) as Array<{ name: string }>).map((item) => item.name)
  const libraryIds = (getDb().prepare('SELECT library_id FROM asset_library_items WHERE asset_id=?').all(row.id) as Array<{ library_id: string }>).map((item) => item.library_id)
  return { id: row.id, mediaType: row.media_type, displayName: row.display_name, filePath: row.file_path, displayUrl: mediaUrl(row.file_path), source: row.source, mimeType: row.mime_type, sizeBytes: row.size_bytes, width: row.width, height: row.height, durationSeconds: row.duration_seconds, thumbnailPath: row.thumbnail_path, thumbnailUrl: row.thumbnail_path ? mediaUrl(row.thumbnail_path) : null, inspectionStatus: row.inspection_status, inspectionError: row.inspection_error, fileModifiedAt: row.file_modified_at, contentIdentity: row.content_identity ?? null, lastUsedAt: row.last_used_at, createdAt: row.created_at, updatedAt: row.updated_at, tags, libraryIds }
}
function getAssetRow(id: string): AssetRow | undefined {
  const row = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as StoredAssetRow | undefined
  return row ? decodeAssetRows([row])[0] : undefined
}
function getAsset(id: string): AssetDto { const row = getAssetRow(id); if (!row) throw new Error('资产不存在'); return mapAsset(row) }

interface AssetFileIdentity { size: number; modifiedAt: number; changedAt: number; device: number; inode: number }
interface AssetInspection {
  asset: AssetDto
  database: ReturnType<typeof getDb>
  controller: AbortController
  identity?: AssetFileIdentity
  completion: Promise<void>
}
type InspectionPreflight = { identity: AssetFileIdentity } | { error: unknown }
// Entries exist only while I/O is in flight. Persistent reuse comes from the DB,
// and relinking invalidates this owner even when the path returns to its old value.
const assetInspections = new Map<string, AssetInspection>()

async function readAssetFileIdentity(filePath: string): Promise<AssetFileIdentity> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('资产路径不是文件。')
  return { size: stat.size, modifiedAt: stat.mtimeMs, changedAt: stat.ctimeMs, device: stat.dev, inode: stat.ino }
}
function sameAssetFileIdentity(left: AssetFileIdentity, right: AssetFileIdentity): boolean {
  return left.size === right.size && left.modifiedAt === right.modifiedAt && left.changedAt === right.changedAt && left.device === right.device && left.inode === right.inode
}
/**
 * 内容身份按规范化后的路径计算：库里的路径存成位置写法（存储底座 2.3），读出时作品目录部分保留原大小写，
 * 而按路径核对（inspectAssetFileContent）用的是规范化（Windows 上全小写）的路径；两边必须用同一种写法，
 * 否则作品目录里的文件（生成结果、编辑帧渲染等）每次核对都被判为“内容已改变”。
 */
function assetContentIdentity(asset: Pick<AssetDto, 'filePath' | 'mediaType'>, identity: AssetFileIdentity): string {
  return crypto.createHash('sha256').update(JSON.stringify([normalizeAssetPath(asset.filePath), asset.mediaType, identity.size, identity.modifiedAt, identity.changedAt, identity.device, identity.inode])).digest('hex')
}
let fileContentActive = 0
const fileContentQueue: Array<() => void> = []
/** Verify a saved original path independently of the lifetime of its library row. */
export async function inspectAssetFileContent(filePath: string, mediaType: AssetDto['mediaType']): Promise<AssetFileContent> {
  if (fileContentActive >= 2) {
    if (fileContentQueue.length >= 200) throw new Error('源文件检查繁忙，请稍后重试。')
    await new Promise<void>(resolve => fileContentQueue.push(resolve))
  } else fileContentActive++
  try {
    const normalized = normalizeAssetPath(filePath)
    if (!isPathWithinAllowedMediaRoots(normalized)) throw new Error('源素材尚未获得读取权限，请先从文档或素材库打开。')
    const canonical = await fs.realpath(normalized)
    if (!isPathWithinAllowedMediaRoots(canonical)) throw new Error('源素材的实际路径不在已授权目录内。')
    const identity = await readAssetFileIdentity(canonical)
    if (await fs.realpath(normalized) !== canonical) throw new Error('源素材的实际路径在检查期间发生变化，请重新定位。')
    return { sizeBytes: identity.size, fileModifiedAt: identity.modifiedAt, contentIdentity: assetContentIdentity({ filePath: normalized, mediaType }, identity) }
  } finally { const next = fileContentQueue.shift(); if (next) next(); else fileContentActive-- }
}
function matchesInspectionAsset(row: AssetRow | undefined, asset: AssetDto): boolean {
  return Boolean(row && row.file_path === asset.filePath && row.media_type === asset.mediaType && row.created_at === asset.createdAt)
}
function ownsAssetInspection(job: AssetInspection): boolean {
  return assetInspections.get(job.asset.id) === job && getDb() === job.database && matchesInspectionAsset(getAssetRow(job.asset.id), job.asset)
}
function invalidateAssetInspection(id: string): void {
  const previous = assetInspections.get(id)
  if (!previous) return
  assetInspections.delete(id)
  previous.controller.abort(new Error('资产已重新定位、移除或开始新的内容检查。'))
}
function missingAssetFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}
function markChangedAssetFile(job: AssetInspection): void {
  if (!ownsAssetInspection(job)) return
  getDb().prepare(`UPDATE assets SET inspection_status='pending', content_identity=NULL, inspection_error=?, updated_at=? WHERE id=?`).run('源文件在检查期间发生变化，请重新检查此资产。', Date.now(), job.asset.id)
  logger.warn('源文件已变化，丢弃本次资产检查结果', { event: 'asset.inspect.discarded', context: { assetId: job.asset.id, stale: true, reason: 'file_changed' } })
}
function logDiscardedAssetInspection(job: AssetInspection): void {
  logger.info('资产检查已失去原内容归属，结果未发布', { event: 'asset.inspect.discarded', context: { assetId: job.asset.id, stale: true, reason: 'owner_changed' } })
}

async function runAssetInspection(job: AssetInspection, preflight?: InspectionPreflight): Promise<void> {
  const asset = job.asset
  logger.info('开始检查资产', { event: 'asset.inspect.start', context: { assetId: asset.id } })
  try {
    if (preflight && 'error' in preflight) throw preflight.error
    const identity = preflight?.identity ?? await readAssetFileIdentity(asset.filePath)
    job.identity = identity
    if (!ownsAssetInspection(job)) { logDiscardedAssetInspection(job); return }
    allowMediaRoot(path.dirname(asset.filePath))
    const current = getAssetRow(asset.id)!
    const contentIdentity = assetContentIdentity(asset, identity)
    if (current.inspection_status === 'ready' && current.size_bytes === identity.size && current.file_modified_at === identity.modifiedAt && current.content_identity === contentIdentity) {
      if (current.thumbnail_path) allowMediaRoot(path.dirname(current.thumbnail_path))
      logger.info('资产检查命中原文件内容', { event: 'asset.inspect.completed', context: { assetId: asset.id, reused: true } })
      return
    }
    const info = await inspectMedia(asset.filePath, asset.mediaType)
    if (!ownsAssetInspection(job)) { logDiscardedAssetInspection(job); return }
    const afterProbe = await readAssetFileIdentity(asset.filePath)
    if (!ownsAssetInspection(job)) { logDiscardedAssetInspection(job); return }
    if (!sameAssetFileIdentity(identity, afterProbe) || info.sizeBytes !== identity.size || info.fileModifiedAt !== identity.modifiedAt) { markChangedAssetFile(job); return }
    let thumbnailPath: string | null = null
    try { thumbnailPath = await ensureAssetThumbnail(asset.filePath, asset.mediaType, info.fileModifiedAt, job.controller.signal) }
    catch (error) { logger.warn('资产缩略图生成失败', { event: 'asset.thumbnail.failed', error, context: { assetId: asset.id, stale: !ownsAssetInspection(job) } }) }
    if (!ownsAssetInspection(job)) { logDiscardedAssetInspection(job); return }
    const afterThumbnail = await readAssetFileIdentity(asset.filePath)
    if (!ownsAssetInspection(job)) { logDiscardedAssetInspection(job); return }
    if (!sameAssetFileIdentity(identity, afterThumbnail)) { markChangedAssetFile(job); return }
    getDb().prepare(`UPDATE assets SET mime_type=?, size_bytes=?, width=?, height=?, duration_seconds=?, thumbnail_name=?, inspection_status='ready', inspection_error=NULL, file_modified_at=?, content_identity=?, updated_at=? WHERE id=?`).run(info.mimeType, info.sizeBytes, info.width, info.height, info.durationSeconds, thumbnailPath ? path.basename(thumbnailPath) : null, info.fileModifiedAt, contentIdentity, Date.now(), asset.id)
    if (thumbnailPath) allowMediaRoot(path.dirname(thumbnailPath))
    logger.info('资产检查完成', { event: 'asset.inspect.completed', context: { assetId: asset.id, reused: false } })
  } catch (error) {
    let changed = false
    let missing = missingAssetFile(error)
    if (job.identity && ownsAssetInspection(job)) {
      try { changed = !sameAssetFileIdentity(job.identity, await readAssetFileIdentity(asset.filePath)) }
      catch (identityError) { missing ||= missingAssetFile(identityError); logger.warn('失败后无法复核原资产文件', { event: 'asset.inspect.identity_failed', error: identityError, context: { assetId: asset.id, stale: !ownsAssetInspection(job) } }) }
    }
    const stale = !ownsAssetInspection(job)
    if (!stale) {
      if (changed) markChangedAssetFile(job)
      else getDb().prepare('UPDATE assets SET inspection_status=?, inspection_error=?, updated_at=? WHERE id=?').run(missing ? 'missing' : 'failed', error instanceof Error ? error.message.slice(0, 500) : 'Unknown inspection error', Date.now(), asset.id)
    }
    logger.error('资产检查失败', { event: 'asset.inspect.failed', error, context: { assetId: asset.id, missing, stale: stale || changed, discarded: stale || changed } })
  }
}

function startAssetInspection(asset: AssetDto, preflight?: InspectionPreflight): AssetInspection {
  invalidateAssetInspection(asset.id)
  const job: AssetInspection = { asset, database: getDb(), controller: new AbortController(), completion: Promise.resolve() }
  assetInspections.set(asset.id, job)
  job.completion = runAssetInspection(job, preflight).finally(() => {
    if (assetInspections.get(asset.id) === job) assetInspections.delete(asset.id)
  })
  return job
}

export function createAsset(input: CreateAssetRequest): AssetDto {
  const filePath = normalizeAssetPath(input.filePath)
  const storedPath = encodeAssetPath(filePath)
  const now = Date.now()
  logger.info('开始登记资产', { event: 'asset.create.start', context: { mediaType: input.mediaType, source: input.source } })
  const transaction = getDb().transaction(() => {
    const existing = getDb().prepare('SELECT id FROM assets WHERE file_path = ?').get(storedPath) as { id: string } | undefined
    const id = existing?.id ?? crypto.randomUUID()
    if (!existing) getDb().prepare('INSERT INTO assets (id, media_type, display_name, file_path, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.mediaType, input.displayName?.trim() || path.basename(filePath), storedPath, input.source, now, now)
    const insertItem = getDb().prepare('INSERT OR IGNORE INTO asset_library_items (library_id, asset_id, added_at) VALUES (?, ?, ?)')
    for (const libraryId of input.libraryIds ?? []) insertItem.run(libraryId, id, now)
    return { id, wasExisting: Boolean(existing) }
  })
  try {
    const result = transaction()
    const asset = { ...getAsset(result.id), wasExisting: result.wasExisting }
    logger.info('资产登记完成', { event: 'asset.create.completed', context: { assetId: asset.id } })
    void inspectAsset(asset.id).catch(error => logger.error('后台资产检查未完成', { event: 'asset.inspect.background_failed', error, context: { assetId: asset.id } }))
    return asset
  } catch (error) {
    logger.error('资产登记失败', { event: 'asset.create.failed', error })
    throw error
  }
}

export async function inspectAsset(id: string): Promise<AssetDto> {
  const asset = getAsset(id)
  const previous = assetInspections.get(id)
  let preflight: InspectionPreflight | undefined
  if (previous && previous.database === getDb() && matchesInspectionAsset(getAssetRow(id), previous.asset)) {
    try { preflight = { identity: await readAssetFileIdentity(asset.filePath) } } catch (error) { preflight = { error } }
    const current = assetInspections.get(id)
    // A relink/delete/new owner while this stat was pending wins even for A→B→A.
    if (current && current !== previous || !matchesInspectionAsset(getAssetRow(id), asset)) return getAsset(id)
    if (current === previous && previous.identity && 'identity' in preflight && sameAssetFileIdentity(previous.identity, preflight.identity)) {
      await previous.completion
      return getAsset(id)
    }
  }
  await startAssetInspection(asset, preflight).completion
  return getAsset(id)
}

export async function inspectAssets(ids: string[]): Promise<AssetDto[]> { return await Promise.all(ids.map(inspectAsset)) }
export async function relocateAsset(id: string, nextPath: string): Promise<AssetDto> { const filePath = normalizeAssetPath(nextPath); invalidateAssetInspection(id); getDb().prepare(`UPDATE assets SET file_path=?, inspection_status='pending', inspection_error=NULL, content_identity=NULL, updated_at=? WHERE id=?`).run(encodeAssetPath(filePath), Date.now(), id); return await inspectAsset(id) }
export function updateAsset(input: UpdateAssetRequest): AssetDto { getDb().prepare('UPDATE assets SET display_name=?, updated_at=? WHERE id=?').run(input.displayName.trim(), Date.now(), input.id); return getAsset(input.id) }
export function deleteAsset(id: string): void { invalidateAssetInspection(id); getDb().prepare('DELETE FROM assets WHERE id=?').run(id) }
export function touchAsset(id: string): void { getDb().prepare('UPDATE assets SET last_used_at=?, updated_at=? WHERE id=?').run(Date.now(), Date.now(), id) }
export function checkAssetPaths(filePaths: string[]): boolean[] {
  const find = getDb().prepare('SELECT 1 FROM assets WHERE file_path=? LIMIT 1')
  return databaseLocations.use((scope) => filePaths.map((filePath) => {
    try { return Boolean(find.get(scope.encodePath(normalizeAssetPath(filePath)))) } catch { return false }
  }))
}

/**
 * 素材库名称唯一冲突要翻译成人话，不能把 SQLite 的原文抛出去。
 *
 * `UNIQUE constraint failed: asset_libraries.name` 对调用方等于没有信息：它既不知道是哪个字段
 * 冲突（"name" 是列名不是属性 ID），也不知道该改名还是改用已存在的那个。实测助手连撞两次，
 * 每次都原样重试同一个名字。
 */
function translateLibraryNameConflict(error: unknown, name: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (!/UNIQUE constraint failed:\s*asset_libraries\.name/i.test(message)) {
    return error instanceof Error ? error : new Error(message)
  }
  return new Error(
    `素材库名称「${name}」已被占用。换一个名称，或先用列表能力取到同名素材库的稳定引用直接使用它。`
  )
}

export function createLibrary(name: string): AssetLibraryDto {
  const now = Date.now()
  const id = crypto.randomUUID()
  const trimmed = name.trim()
  try {
    getDb().prepare('INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .run(id, trimmed, now, now)
  } catch (error) {
    throw translateLibraryNameConflict(error, trimmed)
  }
  return { id, name: trimmed, createdAt: now, updatedAt: now }
}
export function listLibraries(): AssetLibraryDto[] { return (getDb().prepare('SELECT * FROM asset_libraries ORDER BY name COLLATE NOCASE').all() as LibraryRow[]).map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at })) }
export function inspectLibrary(id: string): AssetLibrarySnapshotDto {
  const row = getDb().prepare('SELECT * FROM asset_libraries WHERE id=?').get(id) as LibraryRow | undefined
  if (!row) throw new Error('资产库不存在')
  const assetIds = (getDb().prepare(
    'SELECT asset_id FROM asset_library_items WHERE library_id=? ORDER BY added_at, asset_id'
  ).all(id) as Array<{ asset_id: string }>).map((item) => item.asset_id)
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, assetIds }
}
export function renameLibrary(id: string, name: string): AssetLibraryDto {
  const trimmed = name.trim()
  try {
    getDb().prepare('UPDATE asset_libraries SET name=?, updated_at=? WHERE id=?')
      .run(trimmed, Date.now(), id)
  } catch (error) {
    throw translateLibraryNameConflict(error, trimmed)
  }
  const row = getDb().prepare('SELECT * FROM asset_libraries WHERE id=?').get(id) as LibraryRow | undefined
  if (!row) throw new Error('资产库不存在')
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}
export function deleteLibrary(id: string): void { getDb().prepare('DELETE FROM asset_libraries WHERE id=?').run(id) }
export function restoreLibrary(snapshot: AssetLibrarySnapshotDto): AssetLibraryDto {
  logger.info('开始恢复素材集合', {
    event: 'asset.library.restore.start', context: { libraryId: snapshot.id, assetCount: snapshot.assetIds.length },
  })
  try {
    getDb().transaction(() => {
      getDb().prepare(
        'INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)'
      ).run(snapshot.id, snapshot.name.trim(), snapshot.createdAt, snapshot.updatedAt)
      const insertItem = getDb().prepare(
        'INSERT INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)'
      )
      for (const assetId of snapshot.assetIds) insertItem.run(snapshot.id, assetId, snapshot.updatedAt)
    })()
    logger.info('素材集合恢复完成', {
      event: 'asset.library.restore.completed', context: { libraryId: snapshot.id },
    })
    return { id: snapshot.id, name: snapshot.name.trim(), createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt }
  } catch (error) {
    logger.error('素材集合恢复失败', {
      event: 'asset.library.restore.failed', error, context: { libraryId: snapshot.id },
    })
    throw error
  }
}
export function addAssetToLibrary(libraryId: string, assetId: string): void { getDb().prepare('INSERT OR IGNORE INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)').run(libraryId, assetId, Date.now()) }
export function removeAssetFromLibrary(libraryId: string, assetId: string): void { getDb().prepare('DELETE FROM asset_library_items WHERE library_id=? AND asset_id=?').run(libraryId, assetId) }
export function listTags(): string[] { return (getDb().prepare('SELECT name FROM asset_tags ORDER BY name COLLATE NOCASE').all() as Array<{ name: string }>).map((row) => row.name) }
export function setAssetTags(assetId: string, tags: string[]): AssetDto {
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 32)
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM asset_tag_items WHERE asset_id=?').run(assetId)
    const insertTag = getDb().prepare('INSERT OR IGNORE INTO asset_tags (id,name,created_at) VALUES (?,?,?)')
    const findTag = getDb().prepare('SELECT id FROM asset_tags WHERE name=? COLLATE NOCASE')
    const insertItem = getDb().prepare('INSERT OR IGNORE INTO asset_tag_items (tag_id,asset_id) VALUES (?,?)')
    for (const name of normalized) {
      insertTag.run(crypto.randomUUID(), name, Date.now())
      const row = findTag.get(name) as { id: string }
      insertItem.run(row.id, assetId)
    }
  })()
  return getAsset(assetId)
}

export function queryAssets(query: AssetQuery): AssetPageDto {
  const where: string[] = []; const params: Array<string | number> = []
  let join = ''
  if (query.libraryId) { join = ' JOIN asset_library_items ali ON ali.asset_id=a.id'; where.push('ali.library_id=?'); params.push(query.libraryId) }
  if (query.mediaType) { where.push('a.media_type=?'); params.push(query.mediaType) }
  if (query.tag) { where.push('EXISTS (SELECT 1 FROM asset_tag_items ati JOIN asset_tags t ON t.id=ati.tag_id WHERE ati.asset_id=a.id AND t.name=? COLLATE NOCASE)'); params.push(query.tag) }
  if (query.keyword?.trim()) { where.push('a.display_name LIKE ? ESCAPE \'\\\''); params.push(`%${query.keyword.trim().replace(/[\\%_]/g, '\\$&')}%`) }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const total = (getDb().prepare(`SELECT COUNT(*) total FROM assets a${join}${clause}`).get(...params) as { total: number }).total
  const offset = (query.page - 1) * query.pageSize
  const order = query.sort === 'recent' ? 'COALESCE(a.last_used_at,0) DESC, a.created_at DESC' : 'a.created_at DESC'
  const rows = decodeAssetRows(getDb().prepare(`SELECT a.* FROM assets a${join}${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, query.pageSize, offset) as StoredAssetRow[])
  for (const row of rows) {
    allowMediaRoot(path.dirname(row.file_path))
    if (row.thumbnail_path) allowMediaRoot(path.dirname(row.thumbnail_path))
  }
  return { items: rows.map(mapAsset), total, page: query.page, pageSize: query.pageSize }
}

/** 资产原文件的绝对路径（MCP 媒体读取用）；资产不存在返回 null。 */
export function getAssetFilePath(id: string): string | null {
  return getAssetRow(id)?.file_path ?? null
}
