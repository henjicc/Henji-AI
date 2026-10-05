import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { getProgramDataDir } from './appBasePaths'
import { runSchemaMigrations, type SchemaMigrationOptions } from './db-migrations'

export type SqlBindValue = string | number | boolean | null | Uint8Array

export interface SqlExecuteResult {
  rowsAffected: number
  lastInsertId?: number
}

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

function normalizeParams(params?: SqlBindValue[]): unknown[] {
  return (params ?? []).map((value) => {
    if (typeof value === 'boolean') {
      return value ? 1 : 0
    }
    return value
  })
}

function ensureWriteStatement(sql: string): void {
  const head = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase()
  if (!head || ['SELECT', 'PRAGMA'].includes(head)) {
    throw new Error('Use db:select for read statements')
  }
}

function ensureReadStatement(sql: string): void {
  const head = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase()
  if (!head || !['SELECT', 'PRAGMA', 'WITH'].includes(head)) {
    throw new Error('Use db:execute for write statements')
  }
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

/*
 * 原始 SQL 通道：生产代码不再使用，只在自动化 / 隔离测试模式下注册 IPC（ipc/db.ts），
 * 留给尚未改写的画布造数据脚本（写 storyboard_projects）。3.4 画布接入后连同通道一起删除。
 */
export function executeSql(sql: string, params?: SqlBindValue[]): SqlExecuteResult {
  ensureWriteStatement(sql)
  const result = getDb().prepare(sql).run(...normalizeParams(params))
  return {
    rowsAffected: result.changes,
    lastInsertId: typeof result.lastInsertRowid === 'number' ? result.lastInsertRowid : Number(result.lastInsertRowid),
  }
}

export function selectSql<T = unknown>(sql: string, params?: SqlBindValue[]): T[] {
  ensureReadStatement(sql)
  return getDb().prepare(sql).all(...normalizeParams(params)) as T[]
}
