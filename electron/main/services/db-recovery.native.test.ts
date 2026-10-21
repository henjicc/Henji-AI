import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isDatabaseCorruption, listDatabaseSnapshots, restoreDatabaseFromSnapshot, snapshotDatabase, verifyDatabase } from './db-recovery'

/*
 * henji.db 损坏防护：每日快照与保留份数、自检识别损坏、损坏后换上最新的完好快照并隔离原文件。
 * 原生驱动使用 Electron ABI，登记在 scripts/lib/testSuites.cjs 的原生清单里。
 */

const DAY = 24 * 60 * 60 * 1000

function seed(file: string, rows: number): void {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, body TEXT)')
  const insert = db.prepare('INSERT INTO items (body) VALUES (?)')
  for (let index = 0; index < rows; index++) insert.run('x'.repeat(500))
  db.close()
}

/** 把数据表页面的一段改成乱码：主文件仍能打开，但结构自检必然失败。 */
function corrupt(file: string): void {
  const bytes = fs.readFileSync(file)
  bytes.fill(0xa5, 4096 * 2 + 8, 4096 * 2 + 200)
  fs.writeFileSync(file, bytes)
}

function count(file: string): number {
  const db = new Database(file, { readonly: true })
  try { return (db.prepare('SELECT count(*) AS n FROM items').get() as { n: number }).n } finally { db.close() }
}

describe.skipIf(!process.versions.electron)('数据库损坏防护', () => {
  let base: string
  let dbPath: string
  let snapshots: string
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-db-recovery-'))
    dbPath = path.join(base, 'henji.db')
    snapshots = path.join(base, 'backups', 'snapshots')
  })
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

  it('每天最多一份快照，只保留最近几份，快照是可独立打开的完整库', () => {
    seed(dbPath, 20)
    const db = new Database(dbPath)
    try {
      const start = Date.UTC(2026, 9, 21, 12)
      const first = snapshotDatabase(db, snapshots, start, { keep: 3 })!
      expect(count(first)).toBe(20)
      expect(snapshotDatabase(db, snapshots, start + DAY / 2, { keep: 3 })).toBeNull()
      for (let day = 1; day <= 4; day++) expect(snapshotDatabase(db, snapshots, start + day * DAY, { keep: 3 })).not.toBeNull()
      const kept = listDatabaseSnapshots(snapshots)
      expect(kept).toHaveLength(3)
      expect(path.basename(kept[0])).toContain('2026-10-25')
      expect(fs.readdirSync(snapshots).some(name => name.endsWith('.partial'))).toBe(false)
    } finally { db.close() }
  })

  it('页面损坏的库自检报损坏', () => {
    seed(dbPath, 200)
    corrupt(dbPath)
    const db = new Database(dbPath)
    try {
      let failure: unknown = null
      try { verifyDatabase(db); db.prepare('SELECT count(*) FROM items').get() } catch (error) { failure = error }
      expect(isDatabaseCorruption(failure)).toBe(true)
    } finally { db.close() }
  })

  it('损坏后换上最新一份完好快照，跳过同样损坏的快照，原文件连同 -wal/-shm 原样隔离', () => {
    seed(dbPath, 50)
    const db = new Database(dbPath)
    const older = snapshotDatabase(db, snapshots, Date.UTC(2026, 9, 19))!
    const newer = snapshotDatabase(db, snapshots, Date.UTC(2026, 9, 20))!
    db.close()
    corrupt(newer)
    seed(dbPath, 10)
    fs.writeFileSync(`${dbPath}-wal`, 'stale wal')
    fs.writeFileSync(`${dbPath}-shm`, 'stale shm')
    corrupt(dbPath)

    const restored = restoreDatabaseFromSnapshot(dbPath, snapshots, path.join(base, 'backups'), Date.UTC(2026, 9, 21))!
    expect(restored.snapshot).toBe(older)
    expect(fs.readdirSync(restored.quarantine).sort()).toEqual(['henji.db', 'henji.db-shm', 'henji.db-wal'])
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
    expect(count(dbPath)).toBe(50)
  })

  it('没有完好快照时不动原文件', () => {
    seed(dbPath, 10)
    corrupt(dbPath)
    const before = fs.readFileSync(dbPath)
    expect(restoreDatabaseFromSnapshot(dbPath, snapshots, path.join(base, 'backups'))).toBeNull()
    expect(fs.readFileSync(dbPath).equals(before)).toBe(true)
  })
})
