import { readPaidApprovalSettingsValue } from '../../../src/core/application-control/paidApproval'
import { SQLITE_SCHEMA_VERSION } from '../../../src/core/persistence/schemaVersions'
import { createRecycleSchema } from './recycle/store'
import { createMediaRecycleTablesV21 } from './media-recycle/schema'
import { PersistenceError } from '../../../src/core/persistence/migrations'
import { migrateApplicationReviewsV20 } from './application-runtime/operationStore'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

import type { LocationContext } from '../../../src/core/storage/locationCodec'
import { createApplicationOperationTablesV1 } from './application-runtime/operationStore'
import { createAiRuntimeTablesV1, createGenerationSubmissionsTableV1, createPendingTaskResultsTableV1 } from './ai-runtime/schema'
import { createAssetLibraryTablesV1, addAssetForeignMarker, restrictAssetPathUniquenessToActive } from './asset-library/schema'
import { createAssistantMemoryTablesV1, replaceAssistantMemoryTablesV22, assistantMemoryNeedsBackup } from './assistant/storageSchema'
import { createCameraStageRenderTaskTableV1 } from './camera-stage-render-task-schema'
import { createCustomModelsTableV1 } from './custom-models-schema'
import { addDocumentIndexLastOpenedV1, createDocumentIndexSchemaV1 } from './documents/index-schema'
import { createGenerationHistoryTablesV1, generationHistoryNeedsBackup } from './generation-history/schema'
import {
  audioEditProjectsNeedBackup,
  cameraStageProjectsNeedBackup,
  canvasProjectsNeedBackup,
  retireAudioEditProjects,
  retireCameraStageProjects,
  retireCanvasProjects,
} from './project-table-retirement'
import { createMainLogger, type MainLogger } from './logging/main-logger'
import { createModelTraceTablesV1 } from './logging/traceSchema'
import { createPresetsTableV1 } from './presets/schema'
import { createSettingsTableV1 } from './settings/schema'
import { storedLocationsNeedBackup, upgradeStoredLocationsV1 } from './stored-locations-migration'

/*
 * henji.db 的统一版本化迁移账本，保证每个结构变更只执行一次。
 *
 * - 账本表 `schema_migrations` 记录已执行的迁移（版本号、名称、执行时间）。
 * - 迁移按版本号严格递增，默认各自在独立事务里执行并同时写账本，失败整体回滚、下次启动重试。
 *   需要自己管理事务（例如重建带外键的表，必须先关外键）的迁移声明 `transaction: false`，
 *   这类迁移必须可以重复执行（中途退出后下次启动会再跑一遍）。
 * - 有破坏性步骤（重建表、改写已有数据）的迁移声明 `backupWhen`：库里确有要改的数据时，
 *   执行前先把整库复制一份到程序目录 `backups/`（`VACUUM INTO`，一致快照）；备份失败不执行迁移。
 * - 需要位置换算的迁移经 `context.locations()` 取作品目录与项目，只有真的有数据要换时才取，
 *   全新安装不会因为迁移提前确定作品目录。
 * - 追加迁移：在 SCHEMA_MIGRATIONS 末尾加一项（版本号 +1、名称唯一），建表 / 改表函数放在拥有该表的仓库旁边。
 *   已发布的迁移不得修改或删除（账本按版本号核对名称，不一致即拒绝启动，避免静默分叉）。
 * - 数据库由更新版本的程序写过（账本里有未知的更高版本）时只记日志，不回退、不报错。
 *
 * 未接入账本的库需要用 `IF NOT EXISTS` 建表并补齐缺列，
 * 已有的表与数据原样保留，就地进入账本。
 *
 * 工程表退役由独立迁移函数管理，避免在账本外变更数据库结构。
 * 迁移函数位于 project-table-retirement.ts，对应第 15–17 项。
 */

export interface SchemaMigrationContext {
  /** 位置换算上下文（作品目录、已知项目、程序目录）；第一次调用时才解析。 */
  locations(): LocationContext
}

export interface SchemaMigration {
  /** 从 1 开始严格递增。 */
  version: number
  /** 唯一名称，写进账本用于核对。 */
  name: string
  up(db: Database.Database, context: SchemaMigrationContext): void
  /** false：迁移自己管理事务，必须可重复执行。默认 true。 */
  transaction?: boolean
  /** 返回 true 时执行前先备份整库（库里有这次要改写的数据）。 */
  backupWhen?(db: Database.Database): boolean
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: 'document_index', up: createDocumentIndexSchemaV1 },
  { version: 2, name: 'settings', up: createSettingsTableV1 },
  { version: 3, name: 'custom_models', up: createCustomModelsTableV1 },
  { version: 4, name: 'presets', up: createPresetsTableV1 },
  { version: 5, name: 'generation_history', up: createGenerationHistoryTablesV1, backupWhen: generationHistoryNeedsBackup },
  { version: 6, name: 'progress_samples', up: createAiRuntimeTablesV1 },
  { version: 7, name: 'pending_task_results', up: createPendingTaskResultsTableV1 },
  { version: 8, name: 'asset_library', up: createAssetLibraryTablesV1, transaction: false },
  { version: 9, name: 'assistant_memory', up: createAssistantMemoryTablesV1 },
  { version: 10, name: 'application_operations', up: createApplicationOperationTablesV1 },
  { version: 11, name: 'generation_submissions', up: createGenerationSubmissionsTableV1 },
  { version: 12, name: 'camera_stage_render_tasks', up: createCameraStageRenderTaskTableV1 },
  { version: 13, name: 'model_traces', up: createModelTraceTablesV1 },
  { version: 14, name: 'stored_locations', up: upgradeStoredLocationsV1, backupWhen: storedLocationsNeedBackup },
  // 删除 camera_stage_projects，清空工程回执；新回执的 cameraStageDocumentId 指向文档 ID，工程内容不迁移。
  { version: 15, name: 'retire_camera_stage_projects', up: retireCameraStageProjects, backupWhen: cameraStageProjectsNeedBackup },
  // 删除 audio_edit_projects，将 audio_edit_tasks 整表重建为按 document_id 归属；清空工程回执，不迁移内容。
  { version: 16, name: 'retire_audio_edit_projects', up: retireAudioEditProjects, backupWhen: audioEditProjectsNeedBackup },
  // 删除 storyboard_projects 与 canvas_projects，不迁移内容；henji.db 的全部表由迁移账本管理。
  { version: 17, name: 'retire_canvas_projects', up: retireCanvasProjects, backupWhen: canvasProjectsNeedBackup },
  // 作品索引记最近打开时间（只是索引元数据，可重建）
  { version: 18, name: 'document_index_last_opened', up: addDocumentIndexLastOpenedV1 },
  // TEXT state/record_json need no DDL. Register the new durable confirmation state semantics
  // in the existing SQLite ledger; startup reconciliation owns interrupted invocations.
  { version: 19, name: 'application_operation_user_confirmation', up: () => {} },
  { version: 20, name: 'application_operation_persistent_review', up: migrateApplicationReviewsV20,
    backupWhen: db => !!db.prepare("SELECT 1 FROM application_invocations WHERE json_extract(record_json, '$.confirmation.purpose') = 'review' LIMIT 1").get() },
  { version: 21, name: 'global_media_recycle', up: createMediaRecycleTablesV21 },
  { version: 22, name: 'replace_assistant_memory_user_authorized_reset', up: replaceAssistantMemoryTablesV22, backupWhen: assistantMemoryNeedsBackup },
  { version: 23, name: 'asset_foreign_marker', up: addAssetForeignMarker },
  { version: 24, name: 'user_data_recycle', up: createRecycleSchema,
    backupWhen: db => !!db.prepare('SELECT 1 FROM asset_libraries LIMIT 1').get() },
  // 24 → 25：保留用户额度与完全放开选择，移除项目许可和连接权限；收据绑定生成请求为可选元数据。
  { version: 25, name: 'shared_paid_policy', up: db => {
    const paid = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai.paid_approval') as { value: string } | undefined
    if (paid) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(readPaidApprovalSettingsValue(JSON.parse(paid.value))), 'ai.paid_approval')
    const mcp = db.prepare('SELECT value FROM settings WHERE key = ?').get('mcp.preferences') as { value: string } | undefined
    if (mcp) {
      const { defaultAccess: _access, ...preferences } = JSON.parse(mcp.value) as Record<string, unknown>
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(preferences), 'mcp.preferences')
    }
  } },
  { version: SQLITE_SCHEMA_VERSION, name: 'active_asset_path_uniqueness', up: restrictAssetPathUniquenessToActive, transaction: false,
    backupWhen: db => !!db.prepare('SELECT 1 FROM assets LIMIT 1').get() },
]

export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations'

/** Read-only preflight: reject a newer ledger before any initialization writes. */
export function assertDatabaseVersionSupported(
  db: Database.Database,
  supportedVersion = SQLITE_SCHEMA_VERSION,
): void {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(SCHEMA_MIGRATIONS_TABLE)) return
  const row = db.prepare(`SELECT MAX(version) AS version FROM ${SCHEMA_MIGRATIONS_TABLE}`).get() as { version: number | null }
  if (row.version !== null && row.version > supportedVersion) {
    // Even callers retaining an initializeSchema connection must not write it.
    db.pragma('query_only = ON')
    throw new PersistenceError('newer-version', 'sqlite-ledger', '应用数据', row.version, supportedVersion)
  }
}

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaMigrationError'
  }
}

export interface SchemaMigrationOptions {
  /** 位置换算上下文的来源；没有时需要换算的迁移会失败（测试必须显式提供）。 */
  locationContext?: () => LocationContext
  /** 破坏性迁移前的备份目录；不提供或内存库时跳过备份并记日志。 */
  backupDirectory?: string | null
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
  /** 本次执行前备份的文件；没有备份为 null。 */
  backupPath: string | null
}

function createContext(options: SchemaMigrationOptions): SchemaMigrationContext {
  let cached: LocationContext | null = null
  return {
    locations() {
      if (cached) return cached
      if (!options.locationContext) throw new SchemaMigrationError('迁移需要位置换算，但没有提供作品目录。')
      cached = options.locationContext()
      return cached
    },
  }
}

/** 整库一致快照；文件名带时间与即将执行的迁移版本，不覆盖已有备份。 */
export function backupDatabase(db: Database.Database, directory: string, version: number): string {
  fs.mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(directory, `henji-${stamp}-before-v${version}.db`)
  if (fs.existsSync(target)) throw new SchemaMigrationError(`备份文件已存在：${target}`)
  db.prepare('VACUUM INTO ?').run(target)
  return target
}

export function runSchemaMigrations(
  db: Database.Database,
  migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
  options: SchemaMigrationOptions = {},
): SchemaMigrationResult {
  validateMigrationList(migrations)
  assertDatabaseVersionSupported(db, migrations.length)
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
      throw new SchemaMigrationError(`数据库迁移账本包含无效版本：${row.version}`)
    }
    appliedVersions.add(row.version)
  }

  const context = createContext(options)
  const insert = db.prepare(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`)
  const applied: number[] = []
  let backupPath: string | null = null
  let backupChecked = false
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    if (!backupChecked && migration.backupWhen?.(db)) {
      backupChecked = true
      backupPath = backupBeforeMigration(db, migration, options)
    }
    getLogger().info('开始执行数据库迁移', { event: 'db.migrations.apply.start', context: { version: migration.version, name: migration.name } })
    try {
      if (migration.transaction === false) {
        migration.up(db, context)
        insert.run(migration.version, migration.name, Date.now())
      } else {
        db.transaction(() => {
          migration.up(db, context)
          insert.run(migration.version, migration.name, Date.now())
        })()
      }
    } catch (error) {
      getLogger().error('数据库迁移失败', { event: 'db.migrations.apply.failed', context: { version: migration.version, name: migration.name }, error })
      throw error
    }
    applied.push(migration.version)
    getLogger().info('数据库迁移完成', { event: 'db.migrations.apply.completed', context: { version: migration.version, name: migration.name } })
  }
  const currentVersion = Math.max(0, ...appliedVersions, ...applied)
  return { applied, currentVersion, backupPath }
}

function backupBeforeMigration(db: Database.Database, migration: SchemaMigration, options: SchemaMigrationOptions): string | null {
  if (db.memory || !options.backupDirectory) {
    getLogger().info('迁移前备份已跳过（内存库或未指定备份目录）', {
      event: 'db.migrations.backup.skipped',
      context: { version: migration.version, name: migration.name, memory: db.memory },
    })
    return null
  }
  getLogger().info('迁移前开始备份数据库', { event: 'db.migrations.backup.start', context: { version: migration.version, name: migration.name } })
  try {
    const target = backupDatabase(db, options.backupDirectory, migration.version)
    getLogger().info('迁移前备份完成', { event: 'db.migrations.backup.completed', context: { version: migration.version, path: target } })
    return target
  } catch (error) {
    getLogger().error('迁移前备份失败，未执行迁移', { event: 'db.migrations.backup.failed', context: { version: migration.version, name: migration.name }, error })
    throw error
  }
}
