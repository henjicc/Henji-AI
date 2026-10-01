import type Database from 'better-sqlite3'
import { createMainLogger } from '../logging'

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
