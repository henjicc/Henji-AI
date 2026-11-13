import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import Database from 'better-sqlite3'
import {
  isDatabaseCorruption, isDatabaseSnapshotDue, pruneDatabaseSnapshots, quickCheckFailure, quickCheckPassed,
  removeStalePartialSnapshots, snapshotStamp,
} from './db-recovery'

/*
 * henji.db 的结构自检与每日快照放在后台线程：两步都要把整库读一遍（50 MB 约 0.4 秒与 0.8 秒，160 MB 约 1.7 秒与 2.6 秒），
 * 放在主进程会让窗口、IPC 与录制控制整段停住。
 * 后台线程用自己的只读连接：WAL 下读事务看到的是一个一致的版本，主连接照常读写，不会互相阻塞，
 * VACUUM INTO 写出的就是这一版的完整副本。没有用 better-sqlite3 的 backup()：它在主线程分步拷页，
 * 实测单步仍会占住主线程 0.1–0.5 秒，且其他进程（命令行助手）写库会让它从头再来。
 * 顺序固定为先自检、通过才写快照，快照写完再自检一次才改成正式名，然后才删旧快照。
 * 自检阶段与快照阶段的错误分开回报：快照没写成只算快照失败，不能当成主库损坏。
 */

const SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
const Database = require(workerData.driver)
const rowsOf = connection => connection.pragma('quick_check').map(row => row.quick_check)
const passed = rows => rows.length === 1 && rows[0] === 'ok'
const describe = error => ({ message: String((error && error.message) || error), code: error && error.code })
let source = null
try {
  source = new Database(workerData.dbPath, { readonly: true, fileMustExist: true })
  let started = performance.now()
  const result = { check: rowsOf(source) }
  result.checkMs = performance.now() - started
  if (workerData.partial && passed(result.check)) {
    started = performance.now()
    let copying = false
    try {
      fs.rmSync(workerData.partial, { force: true })
      copying = true
      source.prepare('VACUUM INTO ?').run(workerData.partial)
      copying = false
      const copy = new Database(workerData.partial, { readonly: true, fileMustExist: true })
      try { result.snapshotCheck = rowsOf(copy) } finally { copy.close() }
    } catch (error) {
      result[copying ? 'copyError' : 'snapshotError'] = describe(error)
    }
    result.snapshotMs = performance.now() - started
  }
  parentPort.postMessage(result)
} catch (error) {
  parentPort.postMessage({ error: describe(error) })
} finally {
  if (source) source.close()
}
`

interface ErrorShape { message: string; code?: string }

export interface JobResult {
  check?: string[]
  checkMs?: number
  snapshotCheck?: string[]
  snapshotMs?: number
  /** 清理半成品、打开或自检副本时的错误：只说明这份快照没写成。 */
  snapshotError?: ErrorShape
  /** VACUUM INTO 读源库、写副本时的错误；损坏类说明源库本身有 quick_check 没查出的损坏。 */
  copyError?: ErrorShape
  /** 自检阶段（打开源库或 quick_check）的错误。 */
  error?: ErrorShape
}

export type DatabaseJobOutcome =
  | { kind: 'corrupt'; error: Error }
  | { kind: 'failed'; error: Error }
  | { kind: 'healthy'; snapshotError?: Error }

/**
 * 判定一次自检加快照的结果。VACUUM INTO 会把源库全量读一遍，比 quick_check 读得更全：
 * 它报损坏时源库就是坏的，必须走损坏处理（提示重启并恢复），不能只当快照失败。
 */
export function classifyDatabaseJob(raw: JobResult): DatabaseJobOutcome {
  if (raw.error) {
    const error = toError(raw.error)
    return isDatabaseCorruption(error) ? { kind: 'corrupt', error } : { kind: 'failed', error }
  }
  const check = raw.check ?? []
  if (!quickCheckPassed(check)) return { kind: 'corrupt', error: quickCheckFailure(check) }
  if (raw.copyError) {
    const error = toError(raw.copyError)
    return isDatabaseCorruption(error) ? { kind: 'corrupt', error } : { kind: 'healthy', snapshotError: error }
  }
  if (raw.snapshotError) return { kind: 'healthy', snapshotError: toError(raw.snapshotError) }
  if (raw.snapshotCheck && !quickCheckPassed(raw.snapshotCheck)) {
    return { kind: 'healthy', snapshotError: new Error(`新快照自检未通过：${raw.snapshotCheck.slice(0, 3).join('；')}`) }
  }
  return { kind: 'healthy' }
}

function runWorker(dbPath: string, partial: string | null): { result: Promise<JobResult>; stop(): void } {
  const driver = createRequire(__filename).resolve('better-sqlite3')
  const worker = new Worker(SOURCE, { eval: true, workerData: { driver, dbPath, partial }, name: 'henji-db-maintenance' })
  const result = new Promise<JobResult>((resolve, reject) => {
    worker.once('message', (message: JobResult) => resolve(message))
    worker.once('error', reject)
    worker.once('exit', code => reject(new Error(`数据库维护线程未返回结果就退出（${code}）`)))
  })
  return { result: result.finally(() => { void worker.terminate() }), stop: () => { void worker.terminate() } }
}

function describeError(error: unknown): ErrorShape {
  const code = (error as { code?: unknown } | null)?.code
  return { message: error instanceof Error ? error.message : String(error), ...(typeof code === 'string' ? { code } : {}) }
}

function toError(error: ErrorShape): Error {
  return Object.assign(new Error(error.message), error.code ? { code: error.code } : {})
}

/** 与后台线程同一套步骤的主线程版本：只在后台线程起不来时使用（与改动前一样会同步占住主线程）。 */
function runOnMainThread(connection: Database.Database, partial: string | null): JobResult {
  const rowsOf = (target: Database.Database): string[] => (target.pragma('quick_check') as Array<{ quick_check: string }>).map(row => row.quick_check)
  let started = performance.now()
  let check: string[]
  try { check = rowsOf(connection) } catch (error) { return { error: describeError(error), checkMs: performance.now() - started } }
  const result: JobResult = { check, checkMs: performance.now() - started }
  if (partial && quickCheckPassed(check)) {
    started = performance.now()
    let copying = false
    try {
      fs.rmSync(partial, { force: true })
      copying = true
      connection.prepare('VACUUM INTO ?').run(partial)
      copying = false
      const copy = new Database(partial, { readonly: true, fileMustExist: true })
      try { result.snapshotCheck = rowsOf(copy) } finally { copy.close() }
    } catch (error) {
      result[copying ? 'copyError' : 'snapshotError'] = describeError(error)
    }
    result.snapshotMs = performance.now() - started
  }
  return result
}

export type DatabaseMaintenanceResult = {
  checkMs: number
  thread: 'worker' | 'main'
  /** 后台线程起不来、改在主线程执行时的原因。 */
  workerError?: Error
} & (
  | { status: 'corrupt'; error: Error }
  | {
    status: 'healthy'
    /** 本次写入的快照；未到间隔或本次只自检时为 null。 */
    snapshot: { path: string; durationMs: number; bytes: number; pruned: string[] } | null
    /** 快照没写成的原因；旧快照原样保留。 */
    snapshotError?: Error
  }
)

export interface DatabaseMaintenanceOptions {
  dbPath: string
  snapshotDirectory: string
  now?: number
  /** false 时只自检不写快照（录制进行中，只读不写磁盘）。 */
  snapshot?: boolean
  /** 后台线程起不来时回退到主线程执行（与改动前相同的同步行为），保证自检与快照不会因此停掉。 */
  fallbackConnection?: () => Database.Database
  signal?: AbortSignal
}

function removePartial(partial: string | null): void {
  if (!partial) return
  try { fs.rmSync(partial, { force: true }) } catch { /* 留给下次的过期清理。 */ }
}

/**
 * 自检一次；到了快照间隔且自检通过时顺带写一份快照。
 * 自检不通过返回 corrupt（不写快照、不删旧快照）；自检阶段出现非损坏类错误时抛出。
 */
export async function runDatabaseMaintenance(options: DatabaseMaintenanceOptions): Promise<DatabaseMaintenanceResult> {
  const now = options.now ?? Date.now()
  let target: string | null = null
  let partial: string | null = null
  if (options.snapshot !== false && isDatabaseSnapshotDue(options.snapshotDirectory, now)) {
    fs.mkdirSync(options.snapshotDirectory, { recursive: true })
    removeStalePartialSnapshots(options.snapshotDirectory, now)
    target = path.join(options.snapshotDirectory, `henji-snapshot-${snapshotStamp(now)}.db`)
    partial = `${target}.partial`
  }
  let thread: 'worker' | 'main' = 'worker'
  let workerError: Error | undefined
  let raw: JobResult
  try {
    const job = runWorker(options.dbPath, partial)
    options.signal?.addEventListener('abort', job.stop, { once: true })
    try { raw = await job.result } finally { options.signal?.removeEventListener('abort', job.stop) }
  } catch (error) {
    if (options.signal?.aborted || !options.fallbackConnection) { removePartial(partial); throw error }
    thread = 'main'
    workerError = error instanceof Error ? error : new Error(String(error))
    try { raw = runOnMainThread(options.fallbackConnection(), partial) } catch (fallbackError) { removePartial(partial); throw fallbackError }
  }
  const base = { checkMs: raw.checkMs ?? 0, thread, ...(workerError ? { workerError } : {}) }
  const outcome = classifyDatabaseJob(raw)
  if (outcome.kind !== 'healthy') removePartial(partial)
  if (outcome.kind === 'failed') throw outcome.error
  if (outcome.kind === 'corrupt') return { ...base, status: 'corrupt', error: outcome.error }
  const healthy = { ...base, status: 'healthy' as const, snapshot: null }
  if (!partial || !target) return healthy
  if (outcome.snapshotError || !raw.snapshotCheck) {
    removePartial(partial)
    return { ...healthy, snapshotError: outcome.snapshotError ?? new Error('新快照自检没有结果') }
  }
  let bytes: number
  try {
    bytes = fs.statSync(partial).size
    fs.renameSync(partial, target)
  } catch (error) {
    removePartial(partial)
    return { ...healthy, snapshotError: error instanceof Error ? error : new Error(String(error)) }
  }
  const pruned = pruneDatabaseSnapshots(target)
  return { ...healthy, snapshot: { path: target, durationMs: raw.snapshotMs ?? 0, bytes, pruned } }
}
