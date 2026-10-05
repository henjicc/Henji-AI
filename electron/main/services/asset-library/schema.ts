import type Database from 'better-sqlite3'
import { createMainLogger } from '../logging/main-logger'

/*
 * 素材库的表（迁移账本第 8 项），唯一读写入口是同目录的 index.ts。
 *
 * - 文件位置 `file_path` 按位置写法存储（实施方案 2.5），换作品目录不用改写。
 * - 缩略图在程序目录的缩略图文件夹里，只存文件名 `thumbnail_name`，读取时按当前程序目录拼出。
 * - 2.3 之前的库：补内容身份列、升级来源 / 类型约束（重建表，需先关外键，所以本迁移自己管理事务），
 *   把旧的缩略图绝对路径 `thumbnail_path` 换成文件名。每一步都可以重复执行。
 */

const THUMBNAIL_NAME_PATTERN = /^[0-9a-f]{64}\.webp$/

function assetColumns(conn: Database.Database): string[] {
  return (conn.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).map((column) => column.name)
}

/** 缩略图绝对路径 → 文件名；不是本程序生成的缩略图（名称不符）返回 null，由下次检查重新生成。 */
export function thumbnailNameFromLegacyPath(value: string | null): string | null {
  if (!value) return null
  const name = value.split(/[\\/]/).pop() ?? ''
  return THUMBNAIL_NAME_PATTERN.test(name) ? name : null
}

export function createAssetLibraryTablesV1(conn: Database.Database): void {
  const existed = assetColumns(conn).length > 0
  conn.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'code')),
      display_name TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK (source IN ('generated', 'canvas', 'camera-stage', 'imported', 'external', 'video-edit')),
      mime_type TEXT,
      size_bytes INTEGER,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      thumbnail_name TEXT,
      inspection_status TEXT NOT NULL DEFAULT 'pending' CHECK (inspection_status IN ('pending', 'ready', 'missing', 'failed')),
      inspection_error TEXT,
      file_modified_at INTEGER,
      content_identity TEXT,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_library_items (
      library_id TEXT NOT NULL REFERENCES asset_libraries(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      sort_order INTEGER,
      PRIMARY KEY (library_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_tag_items (
      tag_id TEXT NOT NULL REFERENCES asset_tags(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      PRIMARY KEY (tag_id, asset_id)
    );

    CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type);
    CREATE INDEX IF NOT EXISTS idx_assets_updated_at ON assets(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_last_used_at ON assets(last_used_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_library_items_asset ON asset_library_items(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_tag_items_asset ON asset_tag_items(asset_id);
  `)
  if (!existed) return
  if (!assetColumns(conn).includes('content_identity')) conn.exec('ALTER TABLE assets ADD COLUMN content_identity TEXT')
  upgradeAssetSources(conn)
  if (assetColumns(conn).includes('thumbnail_path')) upgradeAssetThumbnailNames(conn)
}

/** 旧的缩略图绝对路径列换成文件名列；换不出文件名的清空内容身份，下次检查重新生成缩略图。 */
function upgradeAssetThumbnailNames(conn: Database.Database): void {
  conn.transaction(() => {
    const rows = conn.prepare('SELECT id, thumbnail_path FROM assets WHERE thumbnail_path IS NOT NULL').all() as Array<{ id: string; thumbnail_path: string }>
    conn.exec('ALTER TABLE assets RENAME COLUMN thumbnail_path TO thumbnail_name')
    const keep = conn.prepare('UPDATE assets SET thumbnail_name = ? WHERE id = ?')
    const reset = conn.prepare('UPDATE assets SET thumbnail_name = NULL, content_identity = NULL WHERE id = ?')
    for (const row of rows) {
      const name = thumbnailNameFromLegacyPath(row.thumbnail_path)
      if (name) keep.run(name, row.id)
      else reset.run(row.id)
    }
  })()
}

/** Change only the known asset CHECKs; preserve every existing column and row. */
export function upgradeAssetSources(conn: Database.Database): void {
  const logger = createMainLogger('main.asset-library')
  const existing = conn.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='assets'").get() as { sql: string }
  const constraint = /\bsource\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*source\s+IN\s*\(([^)]*)\)\s*\)/i
  const values = existing.sql.match(constraint)?.[1]
  const mediaConstraint = /\bmedia_type\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*media_type\s+IN\s*\(([^)]*)\)\s*\)/i
  const mediaValues = existing.sql.match(mediaConstraint)?.[1]
  if (!values || !mediaValues) throw new Error('资产类型或来源约束无法识别，未修改素材库。')
  if (values.includes("'video-edit'") && mediaValues.includes("'code'")) return
  if (conn.inTransaction) throw new Error('资产来源升级需要独立事务，未修改素材库。')
  const replacement = existing.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"assets"|assets)\s*\(/i, 'CREATE TABLE assets_source_upgrade (')
    .replace(constraint, `source TEXT NOT NULL CHECK (source IN (${values}${values.includes("'video-edit'") ? '' : ", 'video-edit'"}))`)
    .replace(mediaConstraint, `media_type TEXT NOT NULL CHECK (media_type IN (${mediaValues}${mediaValues.includes("'code'") ? '' : ", 'code'"}))`)
  if (!replacement.startsWith('CREATE TABLE assets_source_upgrade ')) throw new Error('资产表结构无法识别，未修改素材库。')
  const objects = conn.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND type IN ('index','trigger','view')").all() as Array<{ type: string; name: string; tbl_name: string; sql: string }>
  const names = new Set(['assets'])
  const mentions = (sql: string): boolean => [...names].some(name => new RegExp(`(?:^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\w]|$)`, 'i').test(sql))
  let grew = true
  while (grew) { grew = false; for (const view of objects.filter(object => object.type === 'view')) if (!names.has(view.name) && mentions(view.sql)) { names.add(view.name); grew = true } }
  const related = objects.filter(object => object.tbl_name === 'assets' || object.type === 'view' && names.has(object.name) || object.type === 'trigger' && mentions(object.sql))
  const columns = (conn.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).map(column => `"${column.name.replaceAll('"', '""')}"`).join(',')
  const foreignKeys = conn.pragma('foreign_keys', { simple: true }) === 1
  logger.info('开始升级资产来源', { event: 'asset.schema.sources.start' })
  conn.pragma('foreign_keys=OFF')
  try {
    conn.transaction(() => {
      // DROP VIEW also removes its INSTEAD OF triggers. Drop triggers first so
      // schema creation order cannot make a later DROP target disappear.
      for (const object of related.filter(object => object.type === 'trigger')) conn.exec(`DROP TRIGGER "${object.name.replaceAll('"', '""')}"`)
      for (const object of related.filter(object => object.type === 'view')) conn.exec(`DROP VIEW "${object.name.replaceAll('"', '""')}"`)
      conn.exec(replacement)
      conn.exec(`INSERT INTO assets_source_upgrade (${columns}) SELECT ${columns} FROM assets`)
      conn.exec('DROP TABLE assets; ALTER TABLE assets_source_upgrade RENAME TO assets')
      for (const object of [...related.filter(object => object.type !== 'trigger'), ...related.filter(object => object.type === 'trigger')]) conn.exec(object.sql)
      if ((conn.pragma('foreign_key_check') as unknown[]).length) throw new Error('资产来源升级的关联核验失败，原记录已保留。')
    })()
    logger.info('资产来源升级完成', { event: 'asset.schema.sources.completed' })
  } catch (error) {
    logger.error('资产来源升级失败', { event: 'asset.schema.sources.failed', error }); throw error
  } finally { conn.pragma(`foreign_keys=${foreignKeys ? 'ON' : 'OFF'}`) }
}
