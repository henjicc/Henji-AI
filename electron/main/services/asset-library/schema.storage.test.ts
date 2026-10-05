import Database from 'better-sqlite3'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { initializeSchema } from '../db'
import { createLegacyDatabase } from '../db-legacy-schema.test-support'
import { testLocationContext } from '../db.test-support'

const options = { locationContext: () => testLocationContext(os.tmpdir()) }

/** 旧列名 thumbnail_path 在迁移账本第 8 项改名为 thumbnail_name（只存文件名）。 */
function renamedThumbnail(row: Record<string, unknown>): Record<string, unknown> {
  const { thumbnail_path: thumbnail, ...rest } = row
  return { ...rest, thumbnail_name: thumbnail ?? null }
}

function ledgerVersion(db: Database.Database): number {
  return (db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number }).version
}

// The registered native suite runs this with the installed Electron ABI.
describe.skipIf(!process.versions.electron)('正式SQLite资产库迁移（迁移账本第 8 项）', () => {
it('旧资产库进入账本时补内容身份列，保留原资产、标签和集合；之后的初始化不再改动', () => {
  const db = new Database(':memory:')
  try {
    createLegacyDatabase(db)
    db.exec('ALTER TABLE assets DROP COLUMN content_identity')
    db.prepare("INSERT INTO assets (id,media_type,display_name,file_path,source,inspection_status,size_bytes,file_modified_at,created_at,updated_at) VALUES (?,?,?,?,?,'ready',?,?,?,?)").run('original', 'video', '原片', 'D:/original.mp4', 'imported', 4096, 1000, 1, 2)
    db.prepare('INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('library', '原库', 1, 2)
    db.prepare('INSERT INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)').run('library', 'original', 1)
    db.prepare('INSERT INTO asset_tags (id,name,created_at) VALUES (?,?,?)').run('tag', '原标签', 1)
    db.prepare('INSERT INTO asset_tag_items (tag_id,asset_id) VALUES (?,?)').run('tag', 'original')
    const before = db.prepare('SELECT * FROM assets').get() as Record<string, unknown>
    initializeSchema(db, options)
    expect(db.prepare('SELECT * FROM assets').get()).toEqual({ ...renamedThumbnail(before), content_identity: null })
    expect(db.prepare('SELECT * FROM asset_library_items').all()).toHaveLength(1)
    expect(db.prepare('SELECT * FROM asset_tag_items').all()).toHaveLength(1)
    db.prepare('UPDATE assets SET content_identity=? WHERE id=?').run('a'.repeat(64), 'original')
    const identified = db.prepare('SELECT * FROM assets').get()
    initializeSchema(db, options); expect(db.prepare('SELECT * FROM assets').get()).toEqual(identified)
    expect((db.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).filter(column => column.name === 'content_identity')).toHaveLength(1)
  } finally { db.close() }
})
it.each(['source', 'media_type'] as const)('升级旧%s约束保留真实附加列、库/标签关系、索引、触发器和依赖视图，并恢复外键约束', missing => {
  const db = new Database(':memory:')
  try {
    createLegacyDatabase(db)
    const sql = (db.prepare("SELECT sql FROM sqlite_schema WHERE name='assets' AND type='table'").get() as { sql: string }).sql.replace(missing === 'source' ? ", 'video-edit'" : ", 'code'", '')
    db.exec('DROP TABLE assets'); db.exec(sql); db.pragma('foreign_keys=ON')
    db.exec('ALTER TABLE assets ADD COLUMN retained_note TEXT; CREATE INDEX idx_retained_note ON assets(retained_note); CREATE TABLE asset_audit (asset_id TEXT); CREATE TRIGGER asset_insert_audit AFTER INSERT ON assets BEGIN INSERT INTO asset_audit VALUES (NEW.id); END; CREATE VIEW asset_names AS SELECT id,display_name,retained_note FROM assets; CREATE VIEW asset_names_outer AS SELECT * FROM asset_names')
    db.exec('CREATE TRIGGER asset_view_update INSTEAD OF UPDATE ON asset_names BEGIN UPDATE assets SET display_name=NEW.display_name WHERE id=OLD.id; END')
    db.prepare("INSERT INTO assets (id,media_type,display_name,file_path,source,created_at,updated_at,content_identity,retained_note) VALUES (?,?,?,?,?,?,?,?,?)").run('original', 'video', '原片', 'D:/original.mp4', 'imported', 1, 2, 'a'.repeat(64), '必须保留')
    db.prepare('INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('library', '原库', 1, 2)
    db.prepare('INSERT INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)').run('library', 'original', 1)
    db.prepare('INSERT INTO asset_tags (id,name,created_at) VALUES (?,?,?)').run('tag', '原标签', 1)
    db.prepare('INSERT INTO asset_tag_items (tag_id,asset_id) VALUES (?,?)').run('tag', 'original')
    const before = (db.prepare('SELECT * FROM assets').all() as Array<Record<string, unknown>>).map(renamedThumbnail)
    initializeSchema(db, options)
    expect(db.prepare('SELECT * FROM assets').all()).toEqual(before)
    expect(db.prepare('SELECT * FROM asset_names_outer').get()).toMatchObject({ id: 'original', retained_note: '必须保留' })
    expect(db.prepare('SELECT * FROM asset_library_items').all()).toHaveLength(1); expect(db.prepare('SELECT * FROM asset_tag_items').all()).toHaveLength(1)
    expect(db.prepare('SELECT * FROM asset_audit').all()).toEqual([{ asset_id: 'original' }])
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='idx_retained_note'").get()).toEqual({ name: 'idx_retained_note' })
    db.prepare('INSERT INTO assets (id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('output', 'image', '选帧', 'D:/frame.png', 'video-edit', 3, 4)
    expect(db.prepare('SELECT * FROM asset_audit').all()).toHaveLength(2)
    db.prepare('INSERT INTO assets (id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('editable-code', 'code', '原创源码', 'D:/original.henji-code', 'video-edit', 3, 4)
    expect(db.prepare('SELECT * FROM asset_audit').all()).toHaveLength(3)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1); expect(db.pragma('foreign_key_check')).toEqual([])
    const after = db.prepare('SELECT * FROM assets').all(); initializeSchema(db, options); expect(db.prepare('SELECT * FROM assets').all()).toEqual(after)
    db.prepare('UPDATE asset_names SET display_name=? WHERE id=?').run('通过原视图改名', 'original')
    expect(db.prepare('SELECT display_name FROM assets WHERE id=?').get('original')).toEqual({ display_name: '通过原视图改名' })
    expect(() => db.prepare('INSERT INTO asset_tag_items (tag_id,asset_id) VALUES (?,?)').run('tag', 'missing')).toThrow()
    expect(() => db.prepare('INSERT INTO assets (id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('bad', 'image', '非法来源', 'D:/bad.png', 'not-a-source', 1, 2)).toThrow()
  } finally { db.close() }
})
it('来源迁移核验失败时回滚原表、关系和schema，账本停在上一项，并恢复调用前的外键设置', () => {
  const db = new Database(':memory:')
  try {
    createLegacyDatabase(db)
    const sql = (db.prepare("SELECT sql FROM sqlite_schema WHERE name='assets' AND type='table'").get() as { sql: string }).sql.replace(", 'video-edit'", '')
    db.exec('DROP TABLE assets'); db.exec(sql)
    db.prepare('INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('library', '原库', 1, 2)
    db.pragma('foreign_keys=OFF'); db.prepare('INSERT INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)').run('library', 'missing', 1); db.pragma('foreign_keys=ON')
    expect(() => initializeSchema(db, options)).toThrow('关联核验失败')
    expect((db.prepare("SELECT sql FROM sqlite_schema WHERE name='assets' AND type='table'").get() as { sql: string }).sql).toBe(sql)
    expect(db.prepare('SELECT * FROM asset_library_items').all()).toHaveLength(1)
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='assets_source_upgrade'").get()).toBeUndefined()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(ledgerVersion(db)).toBe(7)
  } finally { db.close() }
})
})
