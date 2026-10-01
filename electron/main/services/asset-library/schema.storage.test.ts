import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { initializeSchema } from '../db'

// The registered native suite runs this with the installed Electron ABI.
describe.skipIf(!process.versions.electron)('正式SQLite资产身份迁移', () => {
it('旧资产库幂等补内容身份列，保留原资产、标签和集合；新身份不被再次初始化清空', () => {
  const db = new Database(':memory:')
  try {
    initializeSchema(db)
    db.exec('ALTER TABLE assets DROP COLUMN content_identity')
    db.prepare("INSERT INTO assets (id,media_type,display_name,file_path,source,inspection_status,size_bytes,file_modified_at,created_at,updated_at) VALUES (?,?,?,?,?,'ready',?,?,?,?)").run('original', 'video', '原片', 'D:/original.mp4', 'imported', 4096, 1000, 1, 2)
    db.prepare('INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('library', '原库', 1, 2)
    db.prepare('INSERT INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)').run('library', 'original', 1)
    db.prepare('INSERT INTO asset_tags (id,name,created_at) VALUES (?,?,?)').run('tag', '原标签', 1)
    db.prepare('INSERT INTO asset_tag_items (tag_id,asset_id) VALUES (?,?)').run('tag', 'original')
    const before = db.prepare('SELECT * FROM assets').get() as Record<string, unknown>
    initializeSchema(db)
    expect(db.prepare('SELECT * FROM assets').get()).toEqual({ ...before, content_identity: null })
    expect(db.prepare('SELECT * FROM asset_library_items').all()).toHaveLength(1)
    expect(db.prepare('SELECT * FROM asset_tag_items').all()).toHaveLength(1)
    db.prepare('UPDATE assets SET content_identity=? WHERE id=?').run('a'.repeat(64), 'original')
    const identified = db.prepare('SELECT * FROM assets').get()
    initializeSchema(db); expect(db.prepare('SELECT * FROM assets').get()).toEqual(identified)
    expect((db.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).filter(column => column.name === 'content_identity')).toHaveLength(1)
  } finally { db.close() }
})
})
