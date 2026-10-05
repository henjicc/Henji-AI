import type Database from 'better-sqlite3'

import type {
  GenerationHistoryInsertDto,
  GenerationHistoryQuery,
  GenerationHistoryRecordDto,
  GenerationHistoryUpdateDto,
} from '../../../../src/core/localRecords/types'
import { getDb } from '../db'
import { databaseLocations, type DatabaseLocations, type LocationScope } from '../db-locations'
import { GENERATION_HISTORY_FTS_TABLE } from './schema'

/*
 * 生成记录（history 表）的唯一读写入口（存储底座 2.3）。
 * 渲染层经 IPC `generationHistory:*`，主进程内部（MCP 媒体读取、操作恢复）直接调用本模块。
 *
 * - 结果文件是数组（result_paths），每项按位置写法存储；params 整份换算（实施方案 2.5）。
 * - 接口两侧的路径都是绝对路径。
 */

interface HistoryRow {
  id: string
  provider_id: string
  model_id: string
  type: GenerationHistoryRecordDto['type']
  prompt: string | null
  params: string | null
  result_paths: string | null
  task_id: string | null
  status: GenerationHistoryRecordDto['status']
  error_message: string | null
  cost: number | null
  duration: number | null
  created_at: string
  updated_at: string
}

/** 不需要解码路径的状态摘要（启动恢复核对用）。 */
export interface GenerationHistoryStatusDto {
  id: string
  modelId: string
  prompt: string | null
  status: GenerationHistoryRecordDto['status']
  taskId: string | null
  hasResult: boolean
}

type SqlValue = string | number | null

/** FTS5 trigram 至少要 3 个字符；更短的检索用 LIKE。 */
const FTS_MIN_LENGTH = 3

function parseJson(text: string | null): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function parseStoredPaths(text: string | null): string[] {
  const value = parseJson(text)
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function toRecord(row: HistoryRow, scope: LocationScope): GenerationHistoryRecordDto {
  const params = scope.decodeValue(parseJson(row.params) ?? {})
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    type: row.type,
    prompt: row.prompt,
    params: params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {},
    resultPaths: parseStoredPaths(row.result_paths).map((value) => scope.decodePath(value)),
    taskId: row.task_id,
    status: row.status,
    errorMessage: row.error_message,
    cost: row.cost,
    duration: row.duration,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function encodePaths(paths: readonly string[], scope: LocationScope): string {
  return JSON.stringify(paths.filter((item) => item.trim().length > 0).map((item) => scope.encodePath(item)))
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export class GenerationHistoryStore {
  constructor(
    private readonly database: () => Database.Database,
    private readonly locations: DatabaseLocations,
  ) {}

  list(query: GenerationHistoryQuery = {}): GenerationHistoryRecordDto[] {
    const where: string[] = []
    const params: SqlValue[] = []
    if (query.providerId) { where.push('provider_id = ?'); params.push(query.providerId) }
    if (query.modelId) { where.push('model_id = ?'); params.push(query.modelId) }
    if (query.type) { where.push('type = ?'); params.push(query.type) }
    if (query.status) { where.push('status = ?'); params.push(query.status) }
    if (query.idPrefix) { where.push("id LIKE ? ESCAPE '\\'"); params.push(`${escapeLike(query.idPrefix)}%`) }
    const search = query.search?.trim()
    if (search) {
      if ([...search].length >= FTS_MIN_LENGTH) {
        where.push(`rowid IN (SELECT rowid FROM ${GENERATION_HISTORY_FTS_TABLE} WHERE ${GENERATION_HISTORY_FTS_TABLE} MATCH ?)`)
        // 整体当作短语匹配，用户输入里的 FTS 语法字符不生效。
        params.push(`"${search.replace(/"/g, '""')}"`)
      } else {
        where.push("prompt LIKE ? ESCAPE '\\'")
        params.push(`%${escapeLike(search)}%`)
      }
    }
    let sql = `SELECT * FROM history${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC`
    if (query.limit !== undefined || query.offset !== undefined) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(query.limit ?? -1, query.offset ?? 0)
    }
    const rows = this.database().prepare(sql).all(...params) as HistoryRow[]
    return this.locations.use((scope) => rows.map((row) => toRecord(row, scope)))
  }

  get(id: string): GenerationHistoryRecordDto | null {
    const row = this.database().prepare('SELECT * FROM history WHERE id = ?').get(id) as HistoryRow | undefined
    return row ? this.locations.use((scope) => toRecord(row, scope)) : null
  }

  getStatus(id: string): GenerationHistoryStatusDto | null {
    const row = this.database()
      .prepare('SELECT id, model_id, prompt, status, task_id, result_paths FROM history WHERE id = ?')
      .get(id) as Pick<HistoryRow, 'id' | 'model_id' | 'prompt' | 'status' | 'task_id' | 'result_paths'> | undefined
    if (!row) return null
    return { id: row.id, modelId: row.model_id, prompt: row.prompt, status: row.status, taskId: row.task_id, hasResult: parseStoredPaths(row.result_paths).length > 0 }
  }

  count(): number {
    return (this.database().prepare('SELECT COUNT(*) AS total FROM history').get() as { total: number }).total
  }

  insert(record: GenerationHistoryInsertDto): void {
    this.insertMany([record])
  }

  insertMany(records: readonly GenerationHistoryInsertDto[]): void {
    const db = this.database()
    const encoded = this.locations.use((scope) => records.map((record) => ({
      record,
      params: JSON.stringify(scope.encodeValue(record.params)),
      resultPaths: encodePaths(record.resultPaths, scope),
    })))
    const withTime = db.prepare(`
      INSERT INTO history (id, provider_id, model_id, type, prompt, params, result_paths, task_id, status, error_message, cost, duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const withoutTime = db.prepare(`
      INSERT INTO history (id, provider_id, model_id, type, prompt, params, result_paths, task_id, status, error_message, cost, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      for (const { record, params, resultPaths } of encoded) {
        const values = [record.id, record.providerId, record.modelId, record.type, record.prompt, params, resultPaths,
          record.taskId, record.status, record.errorMessage, record.cost, record.duration] as const
        if (record.createdAt) withTime.run(...values, record.createdAt, record.createdAt)
        else withoutTime.run(...values)
      }
    })()
  }

  update(id: string, updates: GenerationHistoryUpdateDto): void {
    const fields: string[] = []
    const values: SqlValue[] = []
    const set = (column: string, value: SqlValue): void => { fields.push(`${column} = ?`); values.push(value) }
    if (updates.providerId !== undefined) set('provider_id', updates.providerId)
    if (updates.modelId !== undefined) set('model_id', updates.modelId)
    if (updates.type !== undefined) set('type', updates.type)
    if (updates.prompt !== undefined) set('prompt', updates.prompt)
    if (updates.params !== undefined || updates.resultPaths !== undefined) {
      this.locations.use((scope) => {
        if (updates.params !== undefined) set('params', JSON.stringify(scope.encodeValue(updates.params)))
        if (updates.resultPaths !== undefined) set('result_paths', encodePaths(updates.resultPaths, scope))
      })
    }
    if (updates.taskId !== undefined) set('task_id', updates.taskId)
    if (updates.status !== undefined) set('status', updates.status)
    if (updates.errorMessage !== undefined) set('error_message', updates.errorMessage)
    if (updates.cost !== undefined) set('cost', updates.cost)
    if (updates.duration !== undefined) set('duration', updates.duration)
    if (fields.length === 0) return
    fields.push('updated_at = CURRENT_TIMESTAMP')
    this.database().prepare(`UPDATE history SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
  }

  delete(id: string): void {
    this.database().prepare('DELETE FROM history WHERE id = ?').run(id)
  }

  deleteMany(ids: readonly string[]): number {
    const db = this.database()
    const statement = db.prepare('DELETE FROM history WHERE id = ?')
    return db.transaction(() => ids.reduce((total, id) => total + statement.run(id).changes, 0))()
  }

  clear(olderThan?: string): number {
    const statement = olderThan
      ? this.database().prepare('DELETE FROM history WHERE created_at < ?')
      : this.database().prepare('DELETE FROM history')
    return (olderThan ? statement.run(olderThan) : statement.run()).changes
  }
}

let store: GenerationHistoryStore | null = null

export function getGenerationHistoryStore(): GenerationHistoryStore {
  store ??= new GenerationHistoryStore(getDb, databaseLocations)
  return store
}
