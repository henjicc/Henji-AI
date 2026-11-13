import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { getProgramDataDir } from './appBasePaths'
import { assertDatabaseVersionSupported, runSchemaMigrations, SCHEMA_MIGRATIONS, SCHEMA_MIGRATIONS_TABLE, type SchemaMigrationOptions } from './db-migrations'
import { runDatabaseMaintenance } from './db-maintenance'
import { isDatabaseCorruption, isDatabaseSnapshotDue, restoreDatabaseFromSnapshot, verifyDatabase, type DatabaseRestoreResult } from './db-recovery'
import { createMainLogger, type MainLogger } from './logging/main-logger'
import { GENERATION_HISTORY_FTS_TABLE } from './generation-history/schema'

const DB_FILE_NAME = 'henji.db'

let db: Database.Database | null = null
let recovery: DatabaseRestoreResult | null = null
let logger: MainLogger | null = null
function getLogger(): MainLogger {
  // 延迟创建：logging 的写入链路在模块初始化阶段不可用。
  logger ??= createMainLogger('main.db')
  return logger
}

/**
 * 正式运行环境的迁移参数（位置换算上下文、备份目录）由主进程入口在启动时登记（db-locations.ts 提供），
 * 本模块不直接依赖作品目录（appPaths → 设置 → 本模块会形成循环）。
 * 未登记时需要位置换算的迁移会失败而不是猜一个作品目录。
 */
let migrationOptionsProvider: (conn: Database.Database) => SchemaMigrationOptions = () => ({})

export function configureDatabaseMigrations(provider: (conn: Database.Database) => SchemaMigrationOptions): void {
  migrationOptionsProvider = provider
}

/** 程序目录（数据库、密钥、日志与内部存储），唯一来源见 `appPaths.ts`。 */
export function getHenjiDataDir(): string {
  return getProgramDataDir()
}

function getHenjiDbPath(): string {
  return path.join(getHenjiDataDir(), DB_FILE_NAME)
}

/**
 * 打开 henji.db 后的结构初始化：执行统一版本化迁移账本（db-migrations.ts），全部表都由账本管理。
 * 测试传入自己的位置换算上下文；正式运行环境由 getDb 提供作品目录与备份目录。
 */
export function initializeSchema(conn: Database.Database, options: SchemaMigrationOptions = {}): void {
  runSchemaMigrations(conn, undefined, options)
}

function getBackupDir(): string {
  return path.join(getHenjiDataDir(), 'backups')
}

function getSnapshotDir(): string {
  return path.join(getBackupDir(), 'snapshots')
}

/** 后台自检发现损坏后留下的标记：下次启动在任何写入之前同步自检，不通过就走快照恢复。 */
function getVerifyMarkerPath(): string {
  return `${getHenjiDbPath()}.verify-on-start`
}

/** 迁移会大量改写数据，在损坏的库上执行只会让损坏扩散，所以有待执行的迁移时先同步自检。 */
function hasPendingMigrations(connection: Database.Database): boolean {
  if (!connection.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(SCHEMA_MIGRATIONS_TABLE)) return true
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${SCHEMA_MIGRATIONS_TABLE}`).get() as { count: number }
  return row.count !== SCHEMA_MIGRATIONS.length
}

/**
 * 打开时只做读结构与版本预检（损坏最常见的表现：打不开、读不出结构，会在这里直接暴露）；
 * 完整的 quick_check 由窗口出来之后的后台维护执行（scheduleDatabaseMaintenance）。
 * 例外是有待执行的迁移或上次后台自检报过损坏：这两种情况在首次写入前同步自检。
 */
function openDatabase(): Database.Database {
  const connection = new Database(getHenjiDbPath())
  try {
    assertDatabaseVersionSupported(connection)
    const verifyReason = fs.existsSync(getVerifyMarkerPath()) ? 'background-check-failed' : hasPendingMigrations(connection) ? 'pending-migrations' : null
    connection.pragma('journal_mode = WAL')
    connection.pragma('foreign_keys = ON')
    if (verifyReason) {
      const started = performance.now()
      // 后台报过损坏时用更全的 integrity_check（还核对索引内容）：后台可能是快照全量读时才读到坏页，quick_check 查不出。
      verifyDatabase(connection, verifyReason === 'background-check-failed' ? 'integrity_check' : 'quick_check')
      getLogger().info('启动前数据库自检通过', { event: 'db.check.completed', context: { reason: verifyReason, thread: 'main', durationMs: Math.round(performance.now() - started) } })
    }
    // 版本预检通过后才允许迁移参数经 settings 读回本连接。
    db = connection
    initializeSchema(connection, migrationOptionsProvider(connection))
  } catch (error) {
    db = null
    connection.close()
    throw error
  }
  return connection
}

export function getDb(): Database.Database {
  if (db) {
    return db
  }

  fs.mkdirSync(getHenjiDataDir(), { recursive: true })
  let connection: Database.Database
  try {
    connection = openDatabase()
  } catch (error) {
    if (!isDatabaseCorruption(error)) throw error
    // 挑快照的检查必须与换上后再次打开时的复检一致（带标记时都是 integrity_check）。
    const pragma = fs.existsSync(getVerifyMarkerPath()) ? 'integrity_check' : 'quick_check'
    const restored = restoreDatabaseFromSnapshot(getHenjiDbPath(), getSnapshotDir(), getBackupDir(), Date.now(), pragma)
    if (!restored) {
      getLogger().error('数据库已损坏且没有可用快照', { event: 'db.corrupt.unrecoverable', error })
      throw error
    }
    getLogger().error('数据库已损坏，已换上最近的快照', { event: 'db.corrupt.restored', error, context: { ...restored } })
    recovery = restored
    connection = openDatabase()
  }
  // 走到这里说明标记要求的同步自检已经通过（或已换上通过自检的快照）。
  fs.rmSync(getVerifyMarkerPath(), { force: true })
  return connection
}

export interface DatabaseMaintenanceSchedule {
  /** 录制等对磁盘与时序敏感的长任务进行中时返回 true，快照推迟（只读的自检照常）。 */
  isBusy(): boolean
  /** 后台自检发现损坏：已留下标记，下次启动会自动恢复；由调用方提示用户重启。 */
  onCorrupt(error: Error): void
  /** 首次执行前的等待，让窗口先完成加载。 */
  initialDelayMs?: number
  busyRetryMs?: number
  recheckMs?: number
}

let maintenance: { stop(): void; idle(): Promise<void> } | null = null

/**
 * 后台自检与每日快照：首次在 initialDelayMs 后执行一次自检（到间隔时顺带快照），
 * 之后每 recheckMs 看一次是否到了快照间隔（应用连开几天也有每日快照）；忙时每 busyRetryMs 再看。
 * 自检报损坏后停止，不再写快照、不删旧快照。
 */
export function scheduleDatabaseMaintenance(schedule: DatabaseMaintenanceSchedule): void {
  maintenance?.stop()
  const controller = new AbortController()
  const recheckMs = schedule.recheckMs ?? 60 * 60 * 1000
  let timer: NodeJS.Timeout | null = null
  let running: Promise<void> = Promise.resolve()
  let checked = false
  let deferredSince: number | null = null
  const arm = (delayMs: number): void => {
    if (controller.signal.aborted) return
    timer = setTimeout(() => { timer = null; running = run() }, delayMs)
    timer.unref?.()
  }
  const run = async (): Promise<void> => {
    const snapshotDue = isDatabaseSnapshotDue(getSnapshotDir())
    if (checked && !snapshotDue) return arm(recheckMs)
    // 录制中只推迟快照（要写整库大小的文件）；首次自检只读，照常执行，不让损坏的库被长时间继续写入。
    const busy = schedule.isBusy()
    if (busy && snapshotDue && deferredSince === null) {
      deferredSince = Date.now()
      getLogger().info('录制进行中，数据库快照推迟', { event: 'db.snapshot.deferred', context: { reason: 'recording' } })
    }
    if (busy && checked) return arm(schedule.busyRetryMs ?? 60 * 1000)
    const writeSnapshot = snapshotDue && !busy
    const deferredMs = deferredSince === null ? 0 : Date.now() - deferredSince
    if (!busy) deferredSince = null
    const started = performance.now()
    getLogger().debug('数据库后台维护开始', { event: 'db.maintenance.start', context: { snapshot: writeSnapshot, busy } })
    try {
      const result = await runDatabaseMaintenance({ dbPath: getHenjiDbPath(), snapshotDirectory: getSnapshotDir(), snapshot: writeSnapshot, fallbackConnection: getDb, signal: controller.signal })
      if (controller.signal.aborted) return
      if (result.workerError) {
        getLogger().warn('数据库维护线程未能启动，本次改在主线程执行', { event: 'db.maintenance.worker_failed', error: result.workerError })
      }
      if (result.status === 'corrupt') {
        getLogger().error('后台数据库自检发现损坏，下次启动将换上最近的完好快照', { event: 'db.check.failed', error: result.error, context: { thread: result.thread, durationMs: Math.round(result.checkMs) } })
        try {
          fs.writeFileSync(getVerifyMarkerPath(), `${new Date().toISOString()}\n${result.error.message}\n`)
        } catch (error) {
          getLogger().error('损坏标记未能写入，下次启动不会自动恢复', { event: 'db.check.marker_failed', error })
        }
        schedule.onCorrupt(result.error)
        return
      }
      checked = true
      getLogger().info('数据库自检通过', { event: 'db.check.completed', context: { reason: 'background', thread: result.thread, durationMs: Math.round(result.checkMs) } })
      if (result.snapshot) {
        getLogger().info('数据库快照已写入', { event: 'db.snapshot.completed', context: { snapshot: result.snapshot.path, bytes: result.snapshot.bytes, durationMs: Math.round(result.snapshot.durationMs), deferredMs, pruned: result.snapshot.pruned.map(file => path.basename(file)), thread: result.thread } })
      } else if (result.snapshotError) {
        // 新写的副本读出损坏（源库已经通过自检与全量读）多半是磁盘问题，按错误记，便于发现。
        const level = isDatabaseCorruption(result.snapshotError) ? 'error' : 'warn'
        getLogger()[level]('数据库快照未能写入，旧快照保留', { event: 'db.snapshot.failed', error: result.snapshotError })
      }
      if (snapshotDue && !writeSnapshot) return arm(schedule.busyRetryMs ?? 60 * 1000)
    } catch (error) {
      if (controller.signal.aborted) return
      getLogger().warn('数据库后台维护未完成，稍后再试', { event: 'db.maintenance.failed', error, context: { durationMs: Math.round(performance.now() - started) } })
    }
    arm(recheckMs)
  }
  arm(schedule.initialDelayMs ?? 15 * 1000)
  maintenance = {
    stop() {
      controller.abort()
      if (timer) clearTimeout(timer)
      timer = null
    },
    idle: () => running,
  }
}

/** 测试用：等当前这一轮后台维护结束。 */
export function waitForDatabaseMaintenanceIdle(): Promise<void> {
  return maintenance?.idle() ?? Promise.resolve()
}

/** 本次启动是否从快照恢复过（只取一次，用于告知用户）。 */
export function takeDatabaseRecovery(): DatabaseRestoreResult | null {
  const result = recovery
  recovery = null
  return result
}

/**
 * 空闲页超过 32 MB 且占文件四分之一以上时整库压缩一次（迁移清掉大量行后文件不会自己变小）。
 * VACUUM 是同步的，只在界面起来之后调用；被其他连接占用而报忙时只记警告，下次启动条件仍成立会再试。
 */
export function compactDatabaseIfFragmented(connection: Database.Database = getDb()): void {
  const pageSize = connection.pragma('page_size', { simple: true }) as number
  const pages = connection.pragma('page_count', { simple: true }) as number
  const freePages = connection.pragma('freelist_count', { simple: true }) as number
  if (freePages * pageSize < 32 * 1024 ** 2 || freePages * 4 < pages) return
  const beforeBytes = pages * pageSize
  const started = performance.now()
  getLogger().info('开始压缩数据库', { event: 'db.compact.start', context: { beforeBytes, freeBytes: freePages * pageSize } })
  try {
    connection.exec('VACUUM')
    // history 的主键是文本 id，VACUUM 可能重排它的行号；全文索引按行号对应，必须重建。
    connection.exec(`INSERT INTO ${GENERATION_HISTORY_FTS_TABLE}(${GENERATION_HISTORY_FTS_TABLE}) VALUES ('rebuild')`)
    connection.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    getLogger().warn('数据库压缩未完成，下次启动再试', { event: 'db.compact.failed', error })
    return
  }
  const afterBytes = (connection.pragma('page_count', { simple: true }) as number) * pageSize
  getLogger().info('数据库压缩完成', { event: 'db.compact.completed', context: { beforeBytes, afterBytes, durationMs: Math.round(performance.now() - started) } })
}

/** 退出时合并 WAL 并关闭，下次启动不必从日志恢复。 */
export function closeDb(): void {
  maintenance?.stop()
  maintenance = null
  if (!db) return
  const connection = db
  db = null
  try { connection.pragma('wal_checkpoint(TRUNCATE)') } finally { connection.close() }
}
