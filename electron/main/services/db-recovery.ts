import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/*
 * henji.db 的损坏防护：每天一份整库快照（VACUUM INTO，按天递减保留），定期 quick_check；
 * 打开或自检发现损坏时，把损坏的主文件与 -wal/-shm 原样移到隔离目录，换上最新一份能通过自检的快照。
 * 2026-10-21 真实资料目录出现过主文件与 WAL 不同步（WAL 里是之后几天的改动，主文件却停在更早的状态），
 * 合并后整库报 malformed；起因未能确认，所以这里不假设原因，只保证能退回最近的完好状态。
 * 自检与快照的执行（后台线程）见 db-maintenance.ts，本文件只放判断与文件操作。
 */

export const DATABASE_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 最近几份逐份保留；更早的每个固定 7 天时间段留一份，最多几档。总数不超过两者之和。 */
const SNAPSHOT_RECENT_KEEP = 7
const SNAPSHOT_WEEKLY_KEEP = 3
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

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

/** quick_check 的结果行；只有一行 ok 才算通过。 */
export function quickCheckPassed(rows: readonly string[]): boolean {
  return rows.length === 1 && rows[0] === 'ok'
}

export function quickCheckFailure(rows: readonly string[]): DatabaseCorruptError {
  return new DatabaseCorruptError(`数据库自检未通过：${rows.slice(0, 3).join('；')}`)
}

/** 结构自检（quick_check 不比对索引内容；耗时随库体积线性增长，50 MB 约 0.4 秒）。 */
export function verifyDatabase(connection: Database.Database, pragma: 'quick_check' | 'integrity_check' = 'quick_check'): void {
  const rows = (connection.pragma(pragma) as Array<Record<string, string>>).map(row => row[pragma])
  if (!quickCheckPassed(rows)) throw quickCheckFailure(rows)
}

export function snapshotStamp(now: number): string {
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
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && SNAPSHOT_PATTERN.test(entry.name))
    .map(entry => entry.name).sort().reverse().map(name => path.join(directory, name))
}

/** 距最新快照超过间隔（或还没有快照）时需要写新快照。 */
export function isDatabaseSnapshotDue(directory: string, now = Date.now(), intervalMs = DATABASE_SNAPSHOT_INTERVAL_MS): boolean {
  const latest = listDatabaseSnapshots(directory)[0]
  return !latest || now - snapshotTime(latest) >= intervalMs
}

/**
 * 按天递减的保留：最新 SNAPSHOT_RECENT_KEEP 份全留；更早的按固定的周段（时间轴上每 7 天一段，不随当前时间滑动）
 * 每段留最新一份，跳过最近几份已经占了的周段，最多 SNAPSHOT_WEEKLY_KEEP 段。
 * 损坏常常过几天才被发现，只留连续几天的快照可能全都已经带着问题；周档让可退回的范围再往前推约三周。
 * 周段必须固定：按“距今几周”分段时，每天的新快照都会把同一份老快照挤出当前档，永远攒不出周档。
 */
export function snapshotsToPrune(snapshots: readonly string[]): string[] {
  const keep = new Set(snapshots.slice(0, SNAPSHOT_RECENT_KEEP))
  const recentBuckets = new Set([...keep].map(file => Math.floor(snapshotTime(file) / WEEK_MS)))
  const buckets = new Set<number>()
  for (const file of snapshots.slice(SNAPSHOT_RECENT_KEEP)) {
    const bucket = Math.floor(snapshotTime(file) / WEEK_MS)
    if (recentBuckets.has(bucket)) continue
    if (buckets.size < SNAPSHOT_WEEKLY_KEEP && !buckets.has(bucket)) {
      buckets.add(bucket)
      keep.add(file)
    }
  }
  return snapshots.filter(file => !keep.has(file))
}

/**
 * 新快照 latest 已改成正式名之后才调用：按保留策略删旧快照，永远不删 latest 本身。
 * 删除失败的留到下次再删；返回实际删掉的。
 */
export function pruneDatabaseSnapshots(latest: string): string[] {
  const pruned: string[] = []
  for (const old of snapshotsToPrune(listDatabaseSnapshots(path.dirname(latest)))) {
    if (old === latest) continue
    try { fs.rmSync(old, { force: true }); pruned.push(old) } catch { /* 被占用时下次再删。 */ }
  }
  return pruned
}

/** 清掉中途退出留下的半个快照；一小时内的可能是另一个进程正在写，不动。 */
export function removeStalePartialSnapshots(directory: string, now = Date.now()): void {
  if (!fs.existsSync(directory)) return
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.partial')) continue
    const file = path.join(directory, name)
    try {
      if (now - fs.statSync(file).mtimeMs > 60 * 60 * 1000) fs.rmSync(file, { force: true })
    } catch { /* 另一个进程刚好删掉或改名，不影响本次。 */ }
  }
}

function snapshotIsHealthy(file: string, pragma: 'quick_check' | 'integrity_check'): boolean {
  let connection: Database.Database | null = null
  try {
    connection = new Database(file, { readonly: true, fileMustExist: true })
    verifyDatabase(connection, pragma)
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
 * pragma 必须与换上后复检用的一致，否则会挑中一份复检不过的快照，每次启动都换上它再失败。
 */
export function restoreDatabaseFromSnapshot(dbPath: string, snapshotDirectory: string, quarantineRoot: string, now = Date.now(), pragma: 'quick_check' | 'integrity_check' = 'quick_check'): DatabaseRestoreResult | null {
  const snapshot = listDatabaseSnapshots(snapshotDirectory).find(file => snapshotIsHealthy(file, pragma))
  if (!snapshot) return null
  const quarantine = path.join(quarantineRoot, `corrupt-${snapshotStamp(now)}`)
  fs.mkdirSync(quarantine, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`
    if (fs.existsSync(file)) fs.renameSync(file, path.join(quarantine, path.basename(file)))
  }
  fs.copyFileSync(snapshot, dbPath)
  return { snapshot, quarantine }
}
