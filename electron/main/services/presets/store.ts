import type Database from 'better-sqlite3'

import type { PresetInsertDto, PresetQuery, PresetRecordDto, PresetUpdateDto } from '../../../../src/core/localRecords/types'
import { getDb } from '../db'
import { databaseLocations, type DatabaseLocations, type LocationScope } from '../db-locations'

/*
 * 预设表的唯一读写入口（存储底座 2.3）。渲染层经 IPC `presets:*` 访问。
 * 参数里的文件位置整份按位置写法存储（实施方案 2.5），读出时换回绝对路径。
 */

interface PresetRow {
  id: string
  name: string
  description: string | null
  model_id: string | null
  params: string | null
  is_favorite: number
  use_count: number
  created_at: string
  updated_at: string
}

function parseParams(text: string | null, scope: LocationScope): Record<string, unknown> {
  if (!text) return {}
  try {
    const value = scope.decodeValue(JSON.parse(text) as unknown)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function toRecord(row: PresetRow, scope: LocationScope): PresetRecordDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    modelId: row.model_id,
    params: parseParams(row.params, scope),
    isFavorite: row.is_favorite === 1,
    useCount: row.use_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class PresetStore {
  constructor(
    private readonly database: () => Database.Database,
    private readonly locations: DatabaseLocations,
  ) {}

  list(query: PresetQuery = {}): PresetRecordDto[] {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.modelId !== undefined) {
      if (query.modelId === null) where.push('model_id IS NULL')
      else {
        where.push('(model_id = ? OR model_id IS NULL)')
        params.push(query.modelId)
      }
    }
    if (query.onlyFavorites) where.push('is_favorite = 1')
    let sql = `SELECT * FROM presets${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY is_favorite DESC, use_count DESC, created_at DESC`
    if (query.limit !== undefined || query.offset !== undefined) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(query.limit ?? -1, query.offset ?? 0)
    }
    const rows = this.database().prepare(sql).all(...params) as PresetRow[]
    return this.locations.use((scope) => rows.map((row) => toRecord(row, scope)))
  }

  get(id: string): PresetRecordDto | null {
    const row = this.database().prepare('SELECT * FROM presets WHERE id = ?').get(id) as PresetRow | undefined
    return row ? this.locations.use((scope) => toRecord(row, scope)) : null
  }

  insert(preset: PresetInsertDto): void {
    const params = this.locations.use((scope) => JSON.stringify(scope.encodeValue(preset.params)))
    this.database().prepare(`
      INSERT INTO presets (id, name, description, model_id, params, is_favorite)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(preset.id, preset.name, preset.description, preset.modelId, params, preset.isFavorite ? 1 : 0)
  }

  update(id: string, updates: PresetUpdateDto): void {
    const fields: string[] = []
    const values: Array<string | number | null> = []
    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.params !== undefined) {
      const params = updates.params
      fields.push('params = ?')
      values.push(this.locations.use((scope) => JSON.stringify(scope.encodeValue(params))))
    }
    if (updates.isFavorite !== undefined) {
      fields.push('is_favorite = ?')
      values.push(updates.isFavorite ? 1 : 0)
    }
    if (fields.length === 0) return
    fields.push('updated_at = CURRENT_TIMESTAMP')
    this.database().prepare(`UPDATE presets SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
  }

  delete(id: string): void {
    this.database().prepare('DELETE FROM presets WHERE id = ?').run(id)
  }

  incrementUsage(id: string): void {
    this.database().prepare('UPDATE presets SET use_count = use_count + 1 WHERE id = ?').run(id)
  }
}

let store: PresetStore | null = null

export function getPresetStore(): PresetStore {
  store ??= new PresetStore(getDb, databaseLocations)
  return store
}
