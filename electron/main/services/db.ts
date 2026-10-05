import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { getProgramDataDir } from './appBasePaths'
import { runSchemaMigrations, type SchemaMigrationOptions } from './db-migrations'

const DB_FILE_NAME = 'henji.db'

let db: Database.Database | null = null

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

export function getDb(): Database.Database {
  if (db) {
    return db
  }

  fs.mkdirSync(getHenjiDataDir(), { recursive: true })
  const connection = new Database(getHenjiDbPath())
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  // 迁移期间解析作品目录会经 settings 读回本连接，所以先登记连接再初始化。
  db = connection
  try {
    initializeSchema(connection, migrationOptionsProvider(connection))
  } catch (error) {
    db = null
    connection.close()
    throw error
  }
  return connection
}
