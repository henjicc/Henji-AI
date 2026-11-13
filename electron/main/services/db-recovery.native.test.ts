import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dataDir: '' }))
vi.mock('./appBasePaths', () => ({ getProgramDataDir: () => state.dataDir }))
vi.mock('./logging/main-logger', () => ({
  createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { closeDb, getDb, scheduleDatabaseMaintenance, takeDatabaseRecovery, waitForDatabaseMaintenanceIdle } from './db'
import { classifyDatabaseJob, runDatabaseMaintenance } from './db-maintenance'
import { isDatabaseCorruption, listDatabaseSnapshots, restoreDatabaseFromSnapshot, snapshotsToPrune, verifyDatabase } from './db-recovery'
/*
 * henji.db 损坏防护：后台线程自检与每日快照、按天递减保留、自检识别损坏、
 * 损坏后经下次启动的同步自检换上最新的完好快照并隔离原文件。
 * 原生驱动使用 Electron ABI，登记在 scripts/lib/testSuites.cjs 的原生清单里。
 */

const DAY = 24 * 60 * 60 * 1000

function seed(file: string, rows: number, bodyBytes = 500): void {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, body TEXT)')
  const insert = db.prepare('INSERT INTO items (body) VALUES (?)')
  db.transaction(() => { for (let index = 0; index < rows; index++) insert.run('x'.repeat(bodyBytes)) })()
  db.close()
}

/** 把一个数据页的一段改成乱码：主文件仍能打开、读得出结构，但结构自检必然失败。 */
function corrupt(file: string, offset = 4096 * 2 + 8): void {
  const bytes = fs.readFileSync(file)
  bytes.fill(0xa5, offset, offset + 192)
  fs.writeFileSync(file, bytes)
}

function count(file: string): number {
  const db = new Database(file, { readonly: true })
  try { return (db.prepare('SELECT count(*) AS n FROM items').get() as { n: number }).n } finally { db.close() }
}

function snapshotName(time: number): string {
  return `henji-snapshot-${new Date(time).toISOString().replace(/[:.]/g, '-')}.db`
}

/** 主线程定时器的最大间隔：同步阻塞多久，这个值就至少多大。 */
function watchEventLoop(): () => number {
  let last = performance.now()
  let max = 0
  const timer = setInterval(() => { const now = performance.now(); max = Math.max(max, now - last); last = now }, 2)
  return () => { clearInterval(timer); return Math.max(max, performance.now() - last) }
}

describe.skipIf(!process.versions.electron)('数据库损坏防护', () => {
  let base: string
  let dbPath: string
  let snapshots: string
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-db-recovery-'))
    dbPath = path.join(base, 'henji.db')
    snapshots = path.join(base, 'backups', 'snapshots')
    state.dataDir = base
  })
  afterEach(() => {
    closeDb()
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('后台线程写快照：每天最多一份，快照是可独立打开的完整库，不留半个文件', async () => {
    seed(dbPath, 20)
    const start = Date.UTC(2026, 9, 21, 12)
    const first = await runDatabaseMaintenance({ dbPath, snapshotDirectory: snapshots, now: start })
    expect(first.status).toBe('healthy')
    if (first.status !== 'healthy') return
    expect(first.thread).toBe('worker')
    expect(count(first.snapshot!.path)).toBe(20)
    const sameDay = await runDatabaseMaintenance({ dbPath, snapshotDirectory: snapshots, now: start + DAY / 2 })
    expect(sameDay.status === 'healthy' && sameDay.snapshot).toBeNull()
    expect(listDatabaseSnapshots(snapshots)).toHaveLength(1)
    expect(fs.readdirSync(snapshots).some(name => name.endsWith('.partial'))).toBe(false)
  })

  it('保留按天递减：每天一份连续写 60 天，始终留着最近 7 天，另有 3 份分属更早的不同周', () => {
    const start = Date.UTC(2026, 8, 1, 12)
    let kept: number[] = []
    for (let day = 0; day < 60; day++) {
      kept = [day, ...kept]
      const files = kept.map(item => path.join(snapshots, snapshotName(start + item * DAY)))
      const pruned = new Set(snapshotsToPrune(files))
      kept = kept.filter((_, index) => !pruned.has(files[index]))
      if (day >= 6) expect(kept.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, index) => day - index))
    }
    const older = kept.slice(7)
    expect(older).toHaveLength(3)
    const weeks = older.map(day => Math.floor((start + day * DAY) / (7 * DAY)))
    expect(new Set(weeks).size).toBe(3)
    expect(59 - older[older.length - 1]).toBeGreaterThanOrEqual(21)
  })

  it('新快照写成后才删旧快照；改名失败时旧快照一份不少', async () => {
    seed(dbPath, 20)
    const now = Date.UTC(2026, 10, 30, 12)
    fs.mkdirSync(snapshots, { recursive: true })
    const olds = Array.from({ length: 8 }, (_, index) => path.join(snapshots, snapshotName(now - (index + 1) * DAY)))
    for (const file of olds) fs.copyFileSync(dbPath, file)
    // 目标位置被一个同名文件夹占住：VACUUM INTO 与自检都成功，只有改成正式名这一步失败。
    fs.mkdirSync(path.join(snapshots, snapshotName(now)))
    const failed = await runDatabaseMaintenance({ dbPath, snapshotDirectory: snapshots, now })
    expect(failed.status === 'healthy' && failed.snapshotError).toBeInstanceOf(Error)
    expect(listDatabaseSnapshots(snapshots)).toEqual(olds)
    expect(fs.readdirSync(snapshots).some(name => name.endsWith('.partial'))).toBe(false)

    fs.rmSync(path.join(snapshots, snapshotName(now)), { recursive: true })
    const written = await runDatabaseMaintenance({ dbPath, snapshotDirectory: snapshots, now })
    // 新的 + 第 1–8 天旧的：最近 7 份（第 0–6 天）一定留着，只可能删第 7、8 天。
    const kept = listDatabaseSnapshots(snapshots)
    expect(kept.slice(0, 7)).toEqual([path.join(snapshots, snapshotName(now)), ...olds.slice(0, 6)])
    expect(written.status === 'healthy' && written.snapshot?.pruned.every(file => olds.indexOf(file) >= 6)).toBe(true)
  })

  it('复制时读到源库损坏按主库损坏处理；只有副本自身的问题才算快照失败', () => {
    const corruption = { message: 'database disk image is malformed', code: 'SQLITE_CORRUPT' }
    expect(classifyDatabaseJob({ check: ['ok'], copyError: corruption }).kind).toBe('corrupt')
    expect(classifyDatabaseJob({ check: ['ok'], copyError: { message: 'disk full', code: 'SQLITE_FULL' } })).toMatchObject({ kind: 'healthy', snapshotError: expect.any(Error) })
    expect(classifyDatabaseJob({ check: ['ok'], snapshotError: corruption })).toMatchObject({ kind: 'healthy', snapshotError: expect.any(Error) })
    expect(classifyDatabaseJob({ check: ['ok'], snapshotCheck: ['row 3 missing'] })).toMatchObject({ kind: 'healthy', snapshotError: expect.any(Error) })
    expect(classifyDatabaseJob({ check: ['page 5 bad'] }).kind).toBe('corrupt')
    expect(classifyDatabaseJob({ error: { message: 'busy', code: 'SQLITE_BUSY' } }).kind).toBe('failed')
  })

  it('快照阶段出错只算快照失败，不当成主库损坏', async () => {
    seed(dbPath, 20)
    const now = Date.UTC(2026, 10, 30, 12)
    // 半个快照的位置被文件夹占住：VACUUM INTO 这一步失败，主库本身完好。
    fs.mkdirSync(path.join(snapshots, `${snapshotName(now)}.partial`), { recursive: true })
    const result = await runDatabaseMaintenance({ dbPath, snapshotDirectory: snapshots, now })
    expect(result.status).toBe('healthy')
    expect(result.status === 'healthy' && result.snapshotError).toBeInstanceOf(Error)
    expect(listDatabaseSnapshots(snapshots)).toHaveLength(0)
  })

  it('自检不通过时报损坏，不写新快照也不删旧快照', async () => {
    seed(dbPath, 200)
    const now = Date.UTC(2026, 10, 30, 12)
    fs.mkdirSync(snapshots, { recursive: true })
    const old = path.join(snapshots, snapshotName(now - 3 * DAY))
    fs.copyFileSync(dbPath, old)
    corrupt(dbPath)
    const result = await runDatabaseMaintenance({ dbPath, snapshotDirectory: snapshots, now })
    expect(result.status).toBe('corrupt')
    expect(fs.readdirSync(snapshots)).toEqual([path.basename(old)])
  })

  it('自检与快照期间主线程保持响应', async () => {
    seed(dbPath, 12_000, 2_000)
    const connection = new Database(dbPath)
    let syncMs: number
    try {
      const started = performance.now()
      verifyDatabase(connection)
      connection.prepare('VACUUM INTO ?').run(path.join(base, 'sync-copy.db'))
      syncMs = performance.now() - started
    } finally { connection.close() }
    const stop = watchEventLoop()
    const result = await runDatabaseMaintenance({ dbPath, snapshotDirectory: snapshots })
    const maxGapMs = stop()
    expect(result.status === 'healthy' && result.snapshot).toBeTruthy()
    // 同步执行时主线程会整段停住 syncMs；放进后台线程后最长间隔只剩线程启动与消息往返。
    expect(maxGapMs).toBeLessThan(Math.min(100, syncMs / 2))
  })

  it('打开不等自检；后台自检发现损坏后留下标记并通知，下次启动同步自检并换上完好快照', async () => {
    // 新库：没有迁移账本，打开时同步自检后执行全部迁移。
    getDb().exec('CREATE TABLE items (id INTEGER PRIMARY KEY, body TEXT)')
    const insert = getDb().prepare('INSERT INTO items (body) VALUES (?)')
    getDb().transaction(() => { for (let index = 0; index < 400; index++) insert.run('x'.repeat(500)) })()
    closeDb()
    fs.mkdirSync(snapshots, { recursive: true })
    const good = path.join(snapshots, snapshotName(Date.now() - DAY / 2))
    fs.copyFileSync(dbPath, good)
    // 损坏放在最后写入的数据页：打开、读结构与迁移账本都碰不到它。
    corrupt(dbPath, fs.statSync(dbPath).size - 4096 * 3 + 8)

    const connection = getDb()
    expect(takeDatabaseRecovery()).toBeNull()
    expect(() => verifyDatabase(connection)).toThrow()

    // 录制进行中也照常自检（只推迟快照）。
    const onCorrupt = vi.fn()
    scheduleDatabaseMaintenance({ isBusy: () => true, onCorrupt, initialDelayMs: 0 })
    await vi.waitFor(() => expect(onCorrupt).toHaveBeenCalledOnce(), { timeout: 10_000 })
    expect(isDatabaseCorruption(onCorrupt.mock.calls[0][0])).toBe(true)
    expect(fs.existsSync(`${dbPath}.verify-on-start`)).toBe(true)
    expect(listDatabaseSnapshots(snapshots)).toEqual([good])
    closeDb()

    getDb()
    const restored = takeDatabaseRecovery()
    expect(restored?.snapshot).toBe(good)
    expect(fs.readdirSync(restored!.quarantine)).toContain('henji.db')
    expect(fs.existsSync(`${dbPath}.verify-on-start`)).toBe(false)
    expect((getDb().prepare('SELECT count(*) AS n FROM items').get() as { n: number }).n).toBe(400)
  })

  it('录制进行中推迟快照，结束后才写', async () => {
    getDb()
    let busy = true
    const isBusy = vi.fn(() => busy)
    scheduleDatabaseMaintenance({ isBusy, onCorrupt: vi.fn(), initialDelayMs: 0, busyRetryMs: 20 })
    await vi.waitFor(() => expect(isBusy.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(listDatabaseSnapshots(snapshots)).toHaveLength(0)
    busy = false
    await vi.waitFor(() => expect(listDatabaseSnapshots(snapshots)).toHaveLength(1), { timeout: 10_000 })
    await waitForDatabaseMaintenanceIdle()
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
    fs.mkdirSync(snapshots, { recursive: true })
    const older = path.join(snapshots, snapshotName(Date.UTC(2026, 9, 19)))
    const newer = path.join(snapshots, snapshotName(Date.UTC(2026, 9, 20)))
    fs.copyFileSync(dbPath, older)
    fs.copyFileSync(dbPath, newer)
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

  it('带标记恢复用 integrity_check 挑快照：跳过只坏在索引内容上的快照', () => {
    seed(dbPath, 50)
    fs.mkdirSync(snapshots, { recursive: true })
    const older = path.join(snapshots, snapshotName(Date.UTC(2026, 9, 19)))
    const newer = path.join(snapshots, snapshotName(Date.UTC(2026, 9, 20)))
    fs.copyFileSync(dbPath, older)
    // 索引条数对得上、内容与表不一致：quick_check 不核对索引内容会通过，integrity_check 报缺行。
    const broken = new Database(newer)
    broken.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, body TEXT); CREATE INDEX items_body ON items(body); INSERT INTO items (body) VALUES ('a'), ('b')")
    const index = broken.prepare("SELECT rootpage, sql FROM sqlite_schema WHERE name = 'items_body'").get() as { rootpage: number; sql: string }
    broken.unsafeMode(true)
    broken.pragma('writable_schema = ON')
    broken.prepare("DELETE FROM sqlite_schema WHERE name = 'items_body'").run()
    broken.close()
    const unindexed = new Database(newer)
    unindexed.exec("UPDATE items SET body = 'z' WHERE body = 'a'")
    unindexed.unsafeMode(true)
    unindexed.pragma('writable_schema = ON')
    unindexed.prepare("INSERT INTO sqlite_schema (type, name, tbl_name, rootpage, sql) VALUES ('index', 'items_body', 'items', ?, ?)").run(index.rootpage, index.sql)
    unindexed.close()
    const check = new Database(newer, { readonly: true })
    try {
      expect(() => verifyDatabase(check)).not.toThrow()
      expect(() => verifyDatabase(check, 'integrity_check')).toThrow()
    } finally { check.close() }

    corrupt(dbPath)
    const restored = restoreDatabaseFromSnapshot(dbPath, snapshots, path.join(base, 'backups'), Date.UTC(2026, 9, 21), 'integrity_check')!
    expect(restored.snapshot).toBe(older)
  })

  it('没有完好快照时不动原文件', () => {
    seed(dbPath, 10)
    corrupt(dbPath)
    const before = fs.readFileSync(dbPath)
    expect(restoreDatabaseFromSnapshot(dbPath, snapshots, path.join(base, 'backups'))).toBeNull()
    expect(fs.readFileSync(dbPath).equals(before)).toBe(true)
  })
})
