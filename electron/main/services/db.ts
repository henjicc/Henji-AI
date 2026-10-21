import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { getProgramDataDir } from './appBasePaths'
import { assertDatabaseVersionSupported, runSchemaMigrations, type SchemaMigrationOptions } from './db-migrations'
import { isDatabaseCorruption, restoreDatabaseFromSnapshot, snapshotDatabase, verifyDatabase, type DatabaseRestoreResult } from './db-recovery'
import { createMainLogger, type MainLogger } from './logging/main-logger'

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

export function getHenjiDbPath(): string {
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

function openDatabase(): Database.Database {
  const connection = new Database(getHenjiDbPath())
  try {
    assertDatabaseVersionSupported(connection)
    connection.pragma('journal_mode = WAL')
    connection.pragma('foreign_keys = ON')
    verifyDatabase(connection)
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
    const restored = restoreDatabaseFromSnapshot(getHenjiDbPath(), path.join(getBackupDir(), 'snapshots'), getBackupDir())
    if (!restored) {
      getLogger().error('数据库已损坏且没有可用快照', { event: 'db.corrupt.unrecoverable', error })
      throw error
    }
    getLogger().error('数据库已损坏，已换上最近的快照', { event: 'db.corrupt.restored', error, context: { ...restored } })
    recovery = restored
    connection = openDatabase()
  }
  try {
    const snapshot = snapshotDatabase(connection, path.join(getBackupDir(), 'snapshots'))
    if (snapshot) getLogger().info('数据库快照已写入', { event: 'db.snapshot.completed', context: { snapshot } })
  } catch (error) {
    getLogger().warn('数据库快照未能写入', { event: 'db.snapshot.failed', error })
  }
  return connection
}

/** 本次启动是否从快照恢复过（只取一次，用于告知用户）。 */
export function takeDatabaseRecovery(): DatabaseRestoreResult | null {
  const result = recovery
  recovery = null
  return result
}

/** 退出时合并 WAL 并关闭，下次启动不必从日志恢复。 */
export function closeDb(): void {
  if (!db) return
  const connection = db
  db = null
  try { connection.pragma('wal_checkpoint(TRUNCATE)') } finally { connection.close() }
}
