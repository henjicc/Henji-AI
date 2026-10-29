import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { RECYCLE_RETENTION_MS, type RecycledItem } from '../../../../src/core/localRecords/recycle'

export const RECYCLE_TABLES = {
  assets: { name: 'display_name', category: '素材' },
  asset_libraries: { name: 'name', category: '集合' },
  history: { name: "COALESCE(NULLIF(prompt, ''), model_id)", category: '生成历史' },
  presets: { name: 'name', category: '预设' },
  custom_models: { name: 'name', category: '自定义模型' },
} as const
export type RecycleTable = keyof typeof RECYCLE_TABLES
export interface RecycleSnapshot { id: string; kind: 'file' | 'setting' | 'record' | 'member' | 'rows' | 'link'; target: string; name: string; payload: string; deleted_at: number }
export interface RecycledLink { relativePath: string; target: string; directory: boolean }
export interface RecycledFile { backup: string; links?: RecycledLink[]; capturePlacement?: import('../../../../src/core/audioCapture/contracts').AudioCapturePlacement }
export function recycledFile(item: RecycleSnapshot): RecycledFile { return item.payload.startsWith('{') ? JSON.parse(item.payload) as RecycledFile : { backup: item.payload } }

export function createRecycleSchema(db: Database.Database): void {
  for (const table of Object.keys(RECYCLE_TABLES)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some(column => column.name === 'deleted_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_deleted_at ON ${table}(deleted_at)`)
  }
  const librarySql = (db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='asset_libraries'").get() as { sql: string }).sql
  const withoutNameConstraint = librarySql.replace(/(\bname\s+TEXT\s+NOT\s+NULL\s+COLLATE\s+NOCASE)\s+UNIQUE/i, '$1')
  if (withoutNameConstraint !== librarySql) {
    // SQLite 的内联唯一约束只能通过重建表移除；级联前保存关系，同一迁移事务内完整放回。
    const indexes = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name='asset_libraries' AND sql IS NOT NULL").all() as Array<{ sql: string }>
    db.exec('CREATE TEMP TABLE recycle_library_items AS SELECT * FROM asset_library_items')
    db.exec(withoutNameConstraint.replace(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"asset_libraries"|`asset_libraries`|\[asset_libraries\]|asset_libraries)/i, 'CREATE TABLE asset_libraries_recycle_migration'))
    db.exec('INSERT INTO asset_libraries_recycle_migration SELECT * FROM asset_libraries')
    db.exec('DROP TABLE asset_libraries; ALTER TABLE asset_libraries_recycle_migration RENAME TO asset_libraries')
    for (const index of indexes) db.exec(index.sql)
    db.exec('INSERT OR IGNORE INTO asset_library_items SELECT * FROM recycle_library_items; DROP TABLE recycle_library_items')
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_libraries_active_name ON asset_libraries(name COLLATE NOCASE) WHERE deleted_at IS NULL')
  db.exec(`CREATE TABLE IF NOT EXISTS recycled_items (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL,
    name TEXT NOT NULL, payload TEXT NOT NULL, deleted_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_recycled_items_deleted_at ON recycled_items(deleted_at)`)
}

/** 关系仍留在原表，恢复只清除墓碑，不重建标签、排序和集合关系。 */
export function softDelete(db: Database.Database, table: RecycleTable, id: string): number {
  return db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(Date.now(), id).changes
}

export class RecycleStore {
  constructor(private readonly db: Database.Database) {}

  list(): RecycledItem[] {
    const snapshots = this.db.prepare('SELECT * FROM recycled_items').all() as RecycleSnapshot[]
    const grouped = new Set(snapshots.filter(row => row.kind === 'rows').flatMap(row => (JSON.parse(row.payload) as string[]).map(id => `${row.target}:${id}`)))
    const items: RecycledItem[] = Object.entries(RECYCLE_TABLES).flatMap(([table, definition]) =>
      (this.db.prepare(`SELECT id, ${definition.name} AS name, deleted_at FROM ${table} WHERE deleted_at IS NOT NULL`).all() as Array<{ id: string; name: string; deleted_at: number }>).map(row => ({
        id: `${table}:${row.id}`, name: row.name, category: definition.category, deletedAt: row.deleted_at,
      })))
    for (let index = items.length - 1; index >= 0; index--) if (grouped.has(items[index].id)) items.splice(index, 1)
    for (const row of snapshots) {
      const category = Object.hasOwn(RECYCLE_TABLES, row.target) ? RECYCLE_TABLES[row.target as RecycleTable].category
        : row.target === 'llm-provider' ? '供应商' : row.target === 'llm-model' ? '模型配置' : row.target === 'sound-library-folder' ? '音效文件夹' : row.kind === 'link' ? '目录链接' : row.kind === 'file' ? '文件' : '设置'
      items.push({ id: row.id, name: row.name, category, deletedAt: row.deleted_at, ...(row.kind === 'rows' ? { recordIds: JSON.parse(row.payload) as string[] } : {}), ...(row.kind === 'file' ? { path: row.target } : {}) })
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt)
  }

  restoreRows(item: RecycleSnapshot): void {
    if (!Object.hasOwn(RECYCLE_TABLES, item.target)) throw new Error('未知的回收记录类型。')
    this.db.transaction(() => {
      const restore = this.db.prepare(`UPDATE ${item.target} SET deleted_at=NULL WHERE id=?`)
      for (const id of JSON.parse(item.payload) as string[]) restore.run(id)
      this.forget(item.id)
    })()
  }

  restoreRow(id: string): boolean {
    const separator = id.indexOf(':')
    const table = id.slice(0, separator)
    if (!Object.hasOwn(RECYCLE_TABLES, table)) return false
    const rowId = id.slice(separator + 1)
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId) as { name?: string } | undefined
    if (!row) throw new Error('这项内容已过保留期。')
    if (table === 'asset_libraries' && row.name) {
      const taken = this.db.prepare('SELECT 1 FROM asset_libraries WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?')
      let name = row.name
      for (let suffix = 2; taken.get(name, rowId); suffix++) name = `${row.name} (${suffix})`
      this.db.prepare('UPDATE asset_libraries SET name = ?, deleted_at = NULL WHERE id = ?').run(name, rowId)
    } else this.db.prepare(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`).run(rowId)
    return true
  }

  preserveRow(table: RecycleTable, id: string): void {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (row) this.snapshot('record', table, String(row.name ?? id), JSON.stringify(row), `${table}:${randomUUID()}`)
  }

  restoreRecord(item: RecycleSnapshot): void {
    if (!Object.hasOwn(RECYCLE_TABLES, item.target)) throw new Error('未知的回收记录类型。')
    const table = item.target as RecycleTable
    const row = JSON.parse(item.payload) as Record<string, string | number | null>
    this.db.transaction(() => {
      this.preserveRow(table, String(row.id))
      row.deleted_at = null
      const columns = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
      this.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(column => column !== 'id').map(column => `${column}=excluded.${column}`).join(',')}`).run(...columns.map(column => row[column] ?? null))
      this.forget(item.id)
    })()
  }

  snapshot(kind: RecycleSnapshot['kind'], target: string, name: string, payload: string, id = kind === 'member' ? `${target}:${randomUUID()}` : randomUUID()): string {
    this.db.prepare('INSERT INTO recycled_items (id,kind,target,name,payload,deleted_at) VALUES (?,?,?,?,?,?)').run(id, kind, target, name, payload, Date.now())
    return id
  }
  get(id: string): RecycleSnapshot | undefined { return this.db.prepare('SELECT * FROM recycled_items WHERE id = ?').get(id) as RecycleSnapshot | undefined }
  files(): RecycleSnapshot[] { return (this.db.prepare("SELECT * FROM recycled_items WHERE kind = 'file'").all() as RecycleSnapshot[]).map(item => ({ ...item, payload: recycledFile(item).backup })) }
  forget(id: string): void { this.db.prepare('DELETE FROM recycled_items WHERE id = ?').run(id) }
  expired(now = Date.now()): RecycleSnapshot[] { return this.db.prepare('SELECT * FROM recycled_items WHERE deleted_at < ?').all(now - RECYCLE_RETENTION_MS) as RecycleSnapshot[] }
  purgeRows(now = Date.now()): void {
    this.db.transaction(() => {
      for (const table of Object.keys(RECYCLE_TABLES)) this.db.prepare(`DELETE FROM ${table} WHERE deleted_at < ?`).run(now - RECYCLE_RETENTION_MS)
    })()
  }
}
