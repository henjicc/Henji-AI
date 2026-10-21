import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/*
 * henji.db 的损坏防护：每天一份整库快照（VACUUM INTO，保留最近几份），打开时 quick_check；
 * 打开或自检发现损坏时，把损坏的主文件与 -wal/-shm 原样移到隔离目录，换上最新一份能通过自检的快照。
 * 2026-10-21 真实资料目录出现过主文件与 WAL 不同步（WAL 里是之后几天的改动，主文件却停在更早的状态），
 * 合并后整库报 malformed；起因未能确认，所以这里不假设原因，只保证能退回最近的完好状态。
 */

export const DATABASE_SNAPSHOT_KEEP = 7
export const DATABASE_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000

const SNAPSHOT_PATTERN = /^henji-snapshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/

export class DatabaseCorruptError extends Error {
  constructor(message: string) { super(message); this.name = 'DatabaseCorruptError' }
}

/** better-sqlite3 的损坏类错误：文件不是数据库，或页面结构损坏。 */
export function isDatabaseCorruption(error: unknown): boolean {
  if (error instanceof DatabaseCorruptError) return true
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || (typeof code === 'string' && code.startsWith('SQLITE_CORRUPT_'))) return true
  return error instanceof Error && /database disk image is malformed|file is not a database/i.test(error.message)
}

/** 结构自检（quick_check 不比对索引内容，几 MB 的库只需几毫秒）。 */
export function verifyDatabase(connection: Database.Database): void {
  const rows = connection.pragma('quick_check') as Array<{ quick_check: string }>
  if (rows.length !== 1 || rows[0].quick_check !== 'ok') {
    throw new DatabaseCorruptError(`数据库自检未通过：${rows.slice(0, 3).map(row => row.quick_check).join('；')}`)
  }
}

function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}

/** 快照写入时刻取自文件名（不看文件修改时间，复制或同步过的文件也一样）。 */
function snapshotTime(file: string): number {
  const match = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(path.basename(file))
  return match ? Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`) : 0
}

/** 快照从新到旧。 */
export function listDatabaseSnapshots(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter(name => SNAPSHOT_PATTERN.test(name)).sort().reverse().map(name => path.join(directory, name))
}

/**
 * 距最新快照超过间隔时写一份新快照，并只保留最近 keep 份。写到临时名再改名，中途退出不会留下半个快照。
 * 返回新快照路径；未到间隔返回 null。
 */
export function snapshotDatabase(connection: Database.Database, directory: string, now = Date.now(), options: { keep?: number; intervalMs?: number } = {}): string | null {
  const keep = options.keep ?? DATABASE_SNAPSHOT_KEEP
  const intervalMs = options.intervalMs ?? DATABASE_SNAPSHOT_INTERVAL_MS
  const existing = listDatabaseSnapshots(directory)
  if (existing[0] && now - snapshotTime(existing[0]) < intervalMs) return null
  fs.mkdirSync(directory, { recursive: true })
  const target = path.join(directory, `henji-snapshot-${stamp(now)}.db`)
  const partial = `${target}.partial`
  fs.rmSync(partial, { force: true })
  connection.prepare('VACUUM INTO ?').run(partial)
  fs.renameSync(partial, target)
  for (const old of listDatabaseSnapshots(directory).slice(keep)) fs.rmSync(old, { force: true })
  return target
}

function snapshotIsHealthy(file: string): boolean {
  let connection: Database.Database | null = null
  try {
    connection = new Database(file, { readonly: true, fileMustExist: true })
    verifyDatabase(connection)
    return true
  } catch {
    return false
  } finally {
    connection?.close()
  }
}

export interface DatabaseRestoreResult {
  /** 换上的快照。 */
  snapshot: string
  /** 损坏文件原样移到的目录。 */
  quarantine: string
}

/**
 * 损坏后的恢复：先找到能通过自检的最新快照（没有就什么都不动、返回 null），
 * 再把 dbPath 与 -wal/-shm 移进隔离目录，最后复制快照到 dbPath。
 */
export function restoreDatabaseFromSnapshot(dbPath: string, snapshotDirectory: string, quarantineRoot: string, now = Date.now()): DatabaseRestoreResult | null {
  const snapshot = listDatabaseSnapshots(snapshotDirectory).find(snapshotIsHealthy)
  if (!snapshot) return null
  const quarantine = path.join(quarantineRoot, `corrupt-${stamp(now)}`)
  fs.mkdirSync(quarantine, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`
    if (fs.existsSync(file)) fs.renameSync(file, path.join(quarantine, path.basename(file)))
  }
  fs.copyFileSync(snapshot, dbPath)
  return { snapshot, quarantine }
}
