import { getDb } from './db'

type JsonObject = Record<string, unknown>

interface CustomModelRow {
  id: string
  name: string
  provider_id: string
  base_model: string | null
  config: string | null
  is_enabled: number
  created_at: string
  updated_at: string
}

export interface CustomModelRecordDto {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: JsonObject
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface InsertCustomModelDto {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: JsonObject
  isEnabled: boolean
}

export interface UpdateCustomModelDto {
  name?: string
  config?: JsonObject
  isEnabled?: boolean
}

function safeParseConfig(config: string | null): JsonObject {
  if (!config) return {}
  try {
    const parsed = JSON.parse(config) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {}
  } catch {
    return {}
  }
}

function rowToRecord(row: CustomModelRow): CustomModelRecordDto {
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id,
    baseModel: row.base_model,
    config: safeParseConfig(row.config),
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function insertCustomModel(model: InsertCustomModelDto): void {
  getDb().prepare(
    `INSERT INTO custom_models (
      id, name, provider_id, base_model, config, is_enabled
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    model.id,
    model.name,
    model.providerId,
    model.baseModel,
    JSON.stringify(model.config),
    model.isEnabled ? 1 : 0
  )
}

export function listCustomModels(providerId?: string): CustomModelRecordDto[] {
  const db = getDb()
  const rows = providerId
    ? db.prepare(
      `SELECT id, name, provider_id, base_model, config, is_enabled, created_at, updated_at
       FROM custom_models
       WHERE provider_id = ?
       ORDER BY created_at DESC`
    ).all(providerId) as CustomModelRow[]
    : db.prepare(
      `SELECT id, name, provider_id, base_model, config, is_enabled, created_at, updated_at
       FROM custom_models
       ORDER BY created_at DESC`
    ).all() as CustomModelRow[]
  return rows.map(rowToRecord)
}

export function getCustomModel(modelId: string): CustomModelRecordDto | null {
  const row = getDb().prepare(
    `SELECT id, name, provider_id, base_model, config, is_enabled, created_at, updated_at
     FROM custom_models
     WHERE id = ?
     LIMIT 1`
  ).get(modelId) as CustomModelRow | undefined
  return row ? rowToRecord(row) : null
}

export function updateCustomModel(modelId: string, updates: UpdateCustomModelDto): void {
  const fields: string[] = []
  const values: Array<string | number> = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.config !== undefined) {
    fields.push('config = ?')
    values.push(JSON.stringify(updates.config))
  }
  if (updates.isEnabled !== undefined) {
    fields.push('is_enabled = ?')
    values.push(updates.isEnabled ? 1 : 0)
  }

  if (fields.length === 0) return

  fields.push('updated_at = CURRENT_TIMESTAMP')
  values.push(modelId)

  getDb().prepare(
    `UPDATE custom_models SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values)
}

export function deleteCustomModel(modelId: string): void {
  getDb().prepare('DELETE FROM custom_models WHERE id = ?').run(modelId)
}
