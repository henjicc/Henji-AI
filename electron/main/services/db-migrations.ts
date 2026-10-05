import type Database from 'better-sqlite3'

import { createDocumentIndexSchemaV1 } from './documents/index-schema'
import { createMainLogger, type MainLogger } from './logging/main-logger'

/*
 * henji.db 的统一版本化迁移账本（实施方案 2.9，存储底座 2.2 建立）。
 *
 * - 账本表 `schema_migrations` 记录已执行的迁移（版本号、名称、执行时间）。
 * - 迁移按版本号严格递增，各自在独立事务里执行并同时写账本，失败整体回滚、下次启动重试。
 * - 追加迁移：在 SCHEMA_MIGRATIONS 末尾加一项（版本号 +1、名称唯一），建表 / 改表函数放在拥有该表的仓库旁边。
 *   已发布的迁移不得修改或删除（账本按版本号核对名称，不一致即拒绝启动，避免静默分叉）。
 * - 数据库由更新版本的程序写过（账本里有未知的更高版本）时只记日志，不回退、不报错。
 *
 * 2.3 数据库收口会把 db.ts 里用 `CREATE TABLE IF NOT EXISTS` + 补列维护的老表逐步并入这个账本。
 */

export interface SchemaMigration {
  /** 从 1 开始严格递增。 */
  version: number
  /** 唯一名称，写进账本用于核对。 */
  name: string
  up(db: Database.Database): void
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: 'document_index', up: createDocumentIndexSchemaV1 },
]

export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations'

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaMigrationError'
  }
}

let logger: MainLogger | null = null
function getLogger(): MainLogger {
  // 延迟创建：db → db-migrations → logging 的写入链路在模块初始化阶段不可用。
  logger ??= createMainLogger('main.db.migrations')
  return logger
}

function validateMigrationList(migrations: readonly SchemaMigration[]): void {
  const names = new Set<string>()
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new SchemaMigrationError(`迁移版本号必须从 1 开始连续递增：${migration.name}`)
    if (!migration.name || names.has(migration.name)) throw new SchemaMigrationError(`迁移名称为空或重复：${migration.name}`)
    names.add(migration.name)
  })
}

export interface SchemaMigrationResult {
  /** 本次执行的迁移版本。 */
  applied: number[]
  /** 执行后的账本最高版本。 */
  currentVersion: number
}

export function runSchemaMigrations(
  db: Database.Database,
  migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
): SchemaMigrationResult {
  validateMigrationList(migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)
  const rows = db.prepare(`SELECT version, name FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version`).all() as Array<{ version: number; name: string }>
  const appliedVersions = new Set<number>()
  for (const row of rows) {
    const known = migrations[row.version - 1]
    if (known && known.name !== row.name) {
      throw new SchemaMigrationError(`数据库迁移账本与程序不一致：版本 ${row.version} 记录为 ${row.name}，程序为 ${known.name}`)
    }
    if (!known) {
      getLogger().warn('数据库由更新版本的程序写过，保留未知迁移', {
        event: 'db.migrations.unknown_version',
        context: { version: row.version, name: row.name },
      })
    }
    appliedVersions.add(row.version)
  }

  const insert = db.prepare(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`)
  const applied: number[] = []
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    getLogger().info('开始执行数据库迁移', { event: 'db.migrations.apply.start', context: { version: migration.version, name: migration.name } })
    try {
      db.transaction(() => {
        migration.up(db)
        insert.run(migration.version, migration.name, Date.now())
      })()
    } catch (error) {
      getLogger().error('数据库迁移失败', { event: 'db.migrations.apply.failed', context: { version: migration.version, name: migration.name }, error })
      throw error
    }
    applied.push(migration.version)
    getLogger().info('数据库迁移完成', { event: 'db.migrations.apply.completed', context: { version: migration.version, name: migration.name } })
  }
  const currentVersion = Math.max(0, ...appliedVersions, ...applied)
  return { applied, currentVersion }
}
