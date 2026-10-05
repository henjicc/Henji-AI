import path from 'node:path'
import type Database from 'better-sqlite3'

import { createLocationCodec, type LocationCodec, type LocationContext } from '../../../src/core/storage/locationCodec'
import type { SchemaMigrationContext } from './db-migrations'
import { createMainLogger } from './logging/main-logger'
import { USER_ROOT_SETTING_KEYS } from './settings/schema'

/*
 * 迁移账本第 14 项：把 2.3 之前写进数据库的文件位置换成位置写法（实施方案 2.5，重要记录 013）。
 *
 * 换算后换作品目录、移动或拷贝项目文件夹都不需要再改写这些记录：
 *
 * | 表 | 列 |
 * |---|---|
 * | history | result_paths（数组逐项）、params（整份；上传素材的旧相对路径先补成绝对路径） |
 * | presets | params（整份） |
 * | settings | value（JSON 整份 / 单值；描述作品目录本身的两项除外） |
 * | assets | file_path（缩略图在第 8 项已换成文件名） |
 * | pending_task_results / generation_submissions / camera_stage_render_tasks / audio_edit_tasks | 回执 JSON（整份） |
 *
 * - 旧版生成记录的结果与上传素材存的是相对作品目录的路径（不带前缀），这里补成 `henji://user/…`。
 * - 本地显示地址（`henji-media://local/…`、`file://…`）在整份换算时还原成路径；
 *   生成记录 params 里冗余的本地显示地址 `__resultUrl` 直接去掉（结果已在 result_paths 里）。
 * - 程序目录里的路径与外部文件原样保留。
 * - 只在确有数据时才解析作品目录（全新安装不触发）；单行写入失败（如唯一约束冲突）保留原值并记日志。
 * - 画布、镜头参考、口播的工程表内容不在这里换算：它们在 3.x 随工具接入整体删除。
 */

const RELATIVE_UPLOAD_KEYS = ['uploadedFilePaths', 'uploadedVideoFilePaths', 'uploadedAudioFilePaths'] as const
const LOCAL_DISPLAY_URL = /^(?:henji-media:|file:)/i
const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/

interface JsonColumnStore {
  table: string
  key: string
  column: string
}

const JSON_COLUMN_STORES: readonly JsonColumnStore[] = [
  { table: 'presets', key: 'id', column: 'params' },
  { table: 'pending_task_results', key: 'server_task_id', column: 'result_json' },
  { table: 'generation_submissions', key: 'request_id', column: 'response_json' },
  { table: 'camera_stage_render_tasks', key: 'request_id', column: 'record_json' },
  { table: 'audio_edit_tasks', key: 'request_id', column: 'result_json' },
]

const ALL_TABLES = ['history', 'settings', 'assets', ...JSON_COLUMN_STORES.map((store) => store.table)]

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table))
}

export function storedLocationsNeedBackup(db: Database.Database): boolean {
  return ALL_TABLES.some((table) => tableExists(db, table) && Boolean(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()))
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class LegacyLocationConverter {
  private codec: LocationCodec | null = null
  private locationContext: LocationContext | null = null

  constructor(private readonly context: SchemaMigrationContext) {}

  private get(): { codec: LocationCodec; context: LocationContext } {
    this.locationContext ??= this.context.locations()
    this.codec ??= createLocationCodec({ ...this.locationContext, container: undefined })
    return { codec: this.codec, context: this.locationContext }
  }

  /** 旧版相对作品目录的路径（不带前缀、不是 URL、不是绝对路径）补成绝对路径。 */
  absolutizeLegacy(value: string): string {
    const trimmed = value.trim()
    if (!trimmed || trimmed.startsWith('henji:') || URL_LIKE.test(trimmed)) return value
    const { context } = this.get()
    const host = context.style === 'win32' ? path.win32 : path.posix
    if (host.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) return value
    return host.join(context.userRoot, trimmed)
  }

  encodePath(value: string): string {
    return this.get().codec.encode(value).stored
  }

  encodeContent(value: unknown): unknown {
    return this.get().codec.encodeContent(value).content
  }
}

function convertHistoryParams(params: unknown, converter: LegacyLocationConverter, hasResults: boolean): unknown {
  if (!isRecord(params)) return params
  const next: Record<string, unknown> = { ...params }
  for (const key of RELATIVE_UPLOAD_KEYS) {
    const list = next[key]
    if (Array.isArray(list)) next[key] = list.map((item) => (typeof item === 'string' ? converter.absolutizeLegacy(item) : item))
  }
  const resultUrl = next['__resultUrl']
  if (hasResults && typeof resultUrl === 'string' && LOCAL_DISPLAY_URL.test(resultUrl)) delete next['__resultUrl']
  return converter.encodeContent(next)
}

export function upgradeStoredLocationsV1(db: Database.Database, context: SchemaMigrationContext): void {
  const logger = createMainLogger('main.db.migrations')
  const converter = new LegacyLocationConverter(context)
  const counts: Record<string, number> = {}
  const failures: Record<string, number> = {}
  const tryUpdate = (table: string, run: () => void): void => {
    try {
      run()
      counts[table] = (counts[table] ?? 0) + 1
    } catch (error) {
      failures[table] = (failures[table] ?? 0) + 1
      logger.warn('记录位置换算写入失败，保留原值', { event: 'db.migrations.stored_locations.row_failed', context: { table }, error })
    }
  }

  // 生成记录：结果数组逐项 + params 整份。
  if (tableExists(db, 'history')) {
    const rows = db.prepare('SELECT id, params, result_paths FROM history').all() as Array<{ id: string; params: string; result_paths: string }>
    const update = db.prepare('UPDATE history SET params = ?, result_paths = ? WHERE id = ?')
    for (const row of rows) {
      const parsedPaths = parseJson(row.result_paths)
      const paths = parsedPaths.ok && Array.isArray(parsedPaths.value) ? parsedPaths.value.filter((item): item is string => typeof item === 'string') : []
      const nextPaths = JSON.stringify(paths.map((item) => converter.encodePath(converter.absolutizeLegacy(item))))
      const parsedParams = parseJson(row.params)
      const nextParams = parsedParams.ok ? JSON.stringify(convertHistoryParams(parsedParams.value, converter, paths.length > 0)) : row.params
      if (nextParams === row.params && nextPaths === row.result_paths) continue
      tryUpdate('history', () => update.run(nextParams, nextPaths, row.id))
    }
  }

  // 设置：描述作品目录本身的两项不换算（它们就是换算的基准）。
  if (tableExists(db, 'settings')) {
    const rows = db.prepare('SELECT key, value, type FROM settings').all() as Array<{ key: string; value: string; type: string }>
    const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?')
    for (const row of rows) {
      if ((USER_ROOT_SETTING_KEYS as readonly string[]).includes(row.key)) continue
      let next = row.value
      const parsed = row.type === 'json' ? parseJson(row.value) : { ok: false as const }
      if (parsed.ok) next = JSON.stringify(converter.encodeContent(parsed.value))
      else if (row.type !== 'json') next = converter.encodePath(row.value)
      if (next === row.value) continue
      // JSON 只是被重新序列化（内容没变）时不写。
      if (parsed.ok && JSON.stringify(parsed.value) === next) continue
      tryUpdate('settings', () => update.run(next, row.key))
    }
  }

  // 素材库：文件位置。
  if (tableExists(db, 'assets')) {
    const rows = db.prepare('SELECT id, file_path FROM assets').all() as Array<{ id: string; file_path: string }>
    const update = db.prepare('UPDATE assets SET file_path = ? WHERE id = ?')
    for (const row of rows) {
      const next = converter.encodePath(row.file_path)
      if (next !== row.file_path) tryUpdate('assets', () => update.run(next, row.id))
    }
  }

  // 其余回执 JSON：整份换算。
  for (const store of JSON_COLUMN_STORES) {
    if (!tableExists(db, store.table)) continue
    const rows = db.prepare(`SELECT ${store.key} AS id, ${store.column} AS value FROM ${store.table} WHERE ${store.column} IS NOT NULL`).all() as Array<{ id: string; value: string }>
    const update = db.prepare(`UPDATE ${store.table} SET ${store.column} = ? WHERE ${store.key} = ?`)
    for (const row of rows) {
      const parsed = parseJson(row.value)
      if (!parsed.ok) continue
      const next = JSON.stringify(converter.encodeContent(parsed.value))
      if (next === JSON.stringify(parsed.value)) continue
      tryUpdate(store.table, () => update.run(next, row.id))
    }
  }

  logger.info('记录位置换算完成', { event: 'db.migrations.stored_locations.completed', context: { updated: counts, failed: failures } })
}
