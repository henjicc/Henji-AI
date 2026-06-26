import { createLogger } from '@/core/logging'

const logger = createLogger('services.database.DatabaseService')
/**
 * Database Service Implementation
 *
 * Provides type-safe access to SQLite database
 */

import { getPlatform } from '@/platform'
import type { DbPlatform, SqlBindValue } from '@/platform/contracts/db'
import type {

  DatabaseService as IDatabaseService,
  HistoryRecord,
  PresetRecord,
  SettingRecord,
  CustomModelRecord,
  HistoryQueryOptions,
  PresetQueryOptions,
} from './types'

interface HistoryRow {
  id: string
  provider_id: string
  model_id: string
  type: HistoryRecord['type']
  prompt: string | null
  params: string | null
  file_path: string | null
  task_id: string | null
  status: HistoryRecord['status']
  error_message: string | null
  cost: number | null
  duration: number | null
  created_at: string
  updated_at: string
}

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

interface SettingValueRow {
  value: string
}

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

export class DatabaseService implements IDatabaseService {
  private db: DbPlatform | null = null
  private dbPath: string | null = null

  /**
   * Initialize database connection
   */
  async init(): Promise<void> {
    if (this.db) return

    try {
      const platform = getPlatform()
      const appDataDir = await platform.system.paths.appLocalDataDir()
      const dbPath = await platform.system.paths.join(appDataDir, 'Henji-AI', 'henji.db')
      this.dbPath = `sqlite:${dbPath}`

      this.db = platform.db
      // logger.info('[Database] Connected successfully to:', this.dbPath)

      // 创建表结构
      await this.createTables()
      // logger.info('[Database] Tables initialized')
    } catch (error) {
      logger.error('[Database] Connection failed:', error)
      throw new Error(`Database initialization failed: ${error}`)
    }
  }

  /**
   * Create database tables if they don't exist
   */
  private async createTables(): Promise<void> {
    const db = this.ensureConnected()

    // 创建历史记录表
    await db.execute(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        type TEXT NOT NULL,
        prompt TEXT,
        params TEXT NOT NULL,
        file_path TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        cost REAL,
        duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建预设表
    await db.execute(`
      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        model_id TEXT,
        params TEXT NOT NULL,
        is_favorite INTEGER DEFAULT 0,
        use_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建设置表
    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建自定义模型表
    await db.execute(`
      CREATE TABLE IF NOT EXISTS custom_models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        base_model TEXT,
        config TEXT NOT NULL,
        is_enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  }

  /**
   * Ensure database is connected
   */
  private ensureConnected(): DbPlatform {
    if (!this.db) {
      throw new Error('Database not initialized. Please call init() first.')
    }
    return this.db
  }

  // ==================== History Operations ====================

  async insertHistory(
    record: Omit<HistoryRecord, 'createdAt' | 'updatedAt'>
  ): Promise<void> {
    const db = this.ensureConnected()

    await db.execute(
      `INSERT INTO history (
        id, provider_id, model_id, type, prompt, params,
        file_path, task_id, status, error_message, cost, duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.providerId,
        record.modelId,
        record.type,
        record.prompt,
        JSON.stringify(record.params),
        record.filePath,
        record.taskId,
        record.status,
        record.errorMessage,
        record.cost,
        record.duration,
      ]
    )
  }

  async getHistory(options: HistoryQueryOptions = {}): Promise<HistoryRecord[]> {
    const db = this.ensureConnected()

    let sql = 'SELECT * FROM history WHERE 1=1'
    const params: SqlBindValue[] = []

    if (options.providerId) {
      sql += ' AND provider_id = ?'
      params.push(options.providerId)
    }

    if (options.modelId) {
      sql += ' AND model_id = ?'
      params.push(options.modelId)
    }

    if (options.type) {
      sql += ' AND type = ?'
      params.push(options.type)
    }

    if (options.status) {
      sql += ' AND status = ?'
      params.push(options.status)
    }

    if (options.searchPrompt) {
      sql += ' AND id IN (SELECT id FROM history_fts WHERE prompt MATCH ?)'
      params.push(options.searchPrompt)
    }

    sql += ' ORDER BY created_at DESC'

    if (options.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options.offset) {
      sql += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = await db.select<HistoryRow>(sql, params)
    return rows.map(this.mapHistoryRow)
  }

  async getHistoryById(id: string): Promise<HistoryRecord | null> {
    const db = this.ensureConnected()

    const rows = await db.select<HistoryRow>(
      'SELECT * FROM history WHERE id = ?',
      [id]
    )

    return rows.length > 0 ? this.mapHistoryRow(rows[0]) : null
  }

  async updateHistory(
    id: string,
    updates: Partial<Omit<HistoryRecord, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    const db = this.ensureConnected()

    const fields: string[] = []
    const values: SqlBindValue[] = []

    if (updates.providerId !== undefined) {
      fields.push('provider_id = ?')
      values.push(updates.providerId)
    }
    if (updates.modelId !== undefined) {
      fields.push('model_id = ?')
      values.push(updates.modelId)
    }
    if (updates.type !== undefined) {
      fields.push('type = ?')
      values.push(updates.type)
    }
    if (updates.prompt !== undefined) {
      fields.push('prompt = ?')
      values.push(updates.prompt)
    }
    if (updates.params !== undefined) {
      fields.push('params = ?')
      values.push(JSON.stringify(updates.params))
    }
    if (updates.filePath !== undefined) {
      fields.push('file_path = ?')
      values.push(updates.filePath)
    }
    if (updates.taskId !== undefined) {
      fields.push('task_id = ?')
      values.push(updates.taskId)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
    }
    if (updates.errorMessage !== undefined) {
      fields.push('error_message = ?')
      values.push(updates.errorMessage)
    }
    if (updates.cost !== undefined) {
      fields.push('cost = ?')
      values.push(updates.cost)
    }
    if (updates.duration !== undefined) {
      fields.push('duration = ?')
      values.push(updates.duration)
    }

    if (fields.length === 0) {
      return
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await db.execute(
      `UPDATE history SET ${fields.join(', ')} WHERE id = ?`,
      values
    )
  }

  async deleteHistory(id: string): Promise<void> {
    const db = this.ensureConnected()
    await db.execute('DELETE FROM history WHERE id = ?', [id])
  }

  async clearHistory(olderThan?: Date): Promise<number> {
    const db = this.ensureConnected()

    if (olderThan) {
      const result = await db.execute(
        'DELETE FROM history WHERE created_at < ?',
        [olderThan.toISOString()]
      )
      return result.rowsAffected
    } else {
      const result = await db.execute('DELETE FROM history')
      return result.rowsAffected
    }
  }

  // ==================== Preset Operations ====================

  async insertPreset(
    preset: Omit<PresetRecord, 'createdAt' | 'updatedAt' | 'useCount'>
  ): Promise<void> {
    const db = this.ensureConnected()

    await db.execute(
      `INSERT INTO presets (
        id, name, description, model_id, params, is_favorite
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        preset.id,
        preset.name,
        preset.description,
        preset.modelId,
        JSON.stringify(preset.params),
        preset.isFavorite ? 1 : 0,
      ]
    )
  }

  async getPresets(options: PresetQueryOptions = {}): Promise<PresetRecord[]> {
    const db = this.ensureConnected()

    let sql = 'SELECT * FROM presets WHERE 1=1'
    const params: SqlBindValue[] = []

    if (options.modelId !== undefined) {
      if (options.modelId === null) {
        sql += ' AND model_id IS NULL'
      } else {
        sql += ' AND (model_id = ? OR model_id IS NULL)'
        params.push(options.modelId)
      }
    }

    if (options.onlyFavorites) {
      sql += ' AND is_favorite = 1'
    }

    sql += ' ORDER BY is_favorite DESC, use_count DESC, created_at DESC'

    if (options.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options.offset) {
      sql += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = await db.select<PresetRow>(sql, params)
    return rows.map(this.mapPresetRow)
  }

  async getPresetById(id: string): Promise<PresetRecord | null> {
    const db = this.ensureConnected()

    const rows = await db.select<PresetRow>(
      'SELECT * FROM presets WHERE id = ?',
      [id]
    )

    return rows.length > 0 ? this.mapPresetRow(rows[0]) : null
  }

  async updatePreset(
    id: string,
    updates: Partial<PresetRecord>
  ): Promise<void> {
    const db = this.ensureConnected()

    const fields: string[] = []
    const params: SqlBindValue[] = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      params.push(updates.name)
    }

    if (updates.description !== undefined) {
      fields.push('description = ?')
      params.push(updates.description)
    }

    if (updates.params !== undefined) {
      fields.push('params = ?')
      params.push(JSON.stringify(updates.params))
    }

    if (updates.isFavorite !== undefined) {
      fields.push('is_favorite = ?')
      params.push(updates.isFavorite ? 1 : 0)
    }

    if (fields.length === 0) return

    params.push(id)

    await db.execute(
      `UPDATE presets SET ${fields.join(', ')} WHERE id = ?`,
      params
    )
  }

  async deletePreset(id: string): Promise<void> {
    const db = this.ensureConnected()
    await db.execute('DELETE FROM presets WHERE id = ?', [id])
  }

  async incrementPresetUsage(id: string): Promise<void> {
    const db = this.ensureConnected()
    await db.execute(
      'UPDATE presets SET use_count = use_count + 1 WHERE id = ?',
      [id]
    )
  }

  // ==================== Settings Operations ====================

  async getSetting(key: string): Promise<string | null> {
    const db = this.ensureConnected()

    const rows = await db.select<SettingValueRow>(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    )

    return rows.length > 0 ? rows[0].value : null
  }

  async setSetting(
    key: string,
    value: string,
    type: SettingRecord['type'] = 'string'
  ): Promise<void> {
    const db = this.ensureConnected()

    await db.execute(
      `INSERT INTO settings (key, value, type)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?, type = ?`,
      [key, value, type, value, type]
    )
  }

  async deleteSetting(key: string): Promise<void> {
    const db = this.ensureConnected()
    await db.execute('DELETE FROM settings WHERE key = ?', [key])
  }

  // ==================== Custom Model Operations ====================

  async insertCustomModel(
    model: Omit<CustomModelRecord, 'createdAt' | 'updatedAt'>
  ): Promise<void> {
    const db = this.ensureConnected()

    await db.execute(
      `INSERT INTO custom_models (
        id, name, provider_id, base_model, config, is_enabled
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        model.id,
        model.name,
        model.providerId,
        model.baseModel,
        JSON.stringify(model.config),
        model.isEnabled ? 1 : 0,
      ]
    )
  }

  async getCustomModels(providerId?: string): Promise<CustomModelRecord[]> {
    const db = this.ensureConnected()

    let sql = 'SELECT * FROM custom_models WHERE 1=1'
    const params: SqlBindValue[] = []

    if (providerId) {
      sql += ' AND provider_id = ?'
      params.push(providerId)
    }

    sql += ' ORDER BY created_at DESC'

    const rows = await db.select<CustomModelRow>(sql, params)
    return rows.map(this.mapCustomModelRow)
  }

  async getCustomModelById(id: string): Promise<CustomModelRecord | null> {
    const db = this.ensureConnected()

    const rows = await db.select<CustomModelRow>(
      'SELECT * FROM custom_models WHERE id = ?',
      [id]
    )

    return rows.length > 0 ? this.mapCustomModelRow(rows[0]) : null
  }

  async updateCustomModel(
    id: string,
    updates: Partial<CustomModelRecord>
  ): Promise<void> {
    const db = this.ensureConnected()

    const fields: string[] = []
    const params: SqlBindValue[] = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      params.push(updates.name)
    }

    if (updates.config !== undefined) {
      fields.push('config = ?')
      params.push(JSON.stringify(updates.config))
    }

    if (updates.isEnabled !== undefined) {
      fields.push('is_enabled = ?')
      params.push(updates.isEnabled ? 1 : 0)
    }

    if (fields.length === 0) return

    params.push(id)

    await db.execute(
      `UPDATE custom_models SET ${fields.join(', ')} WHERE id = ?`,
      params
    )
  }

  async deleteCustomModel(id: string): Promise<void> {
    const db = this.ensureConnected()
    await db.execute('DELETE FROM custom_models WHERE id = ?', [id])
  }

  // ==================== Utility Methods ====================

  async vacuum(): Promise<void> {
    const db = this.ensureConnected()
    await db.execute('VACUUM')
  }

  async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `sqlite:henji_backup_${timestamp}.db`

    // Note: Tauri SQL plugin doesn't directly support backup
    // This returns the backup path for the caller to handle file copying
    return backupPath
  }

  // ==================== Private Helper Methods ====================

  private mapHistoryRow(row: HistoryRow): HistoryRecord {
    return {
      id: row.id,
      providerId: row.provider_id,
      modelId: row.model_id,
      type: row.type,
      prompt: row.prompt,
      params: JSON.parse(row.params || '{}'),
      filePath: row.file_path,
      taskId: row.task_id,
      status: row.status,
      errorMessage: row.error_message,
      cost: row.cost,
      duration: row.duration,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapPresetRow(row: PresetRow): PresetRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      modelId: row.model_id,
      params: JSON.parse(row.params || '{}'),
      isFavorite: row.is_favorite === 1,
      useCount: row.use_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapCustomModelRow(row: CustomModelRow): CustomModelRecord {
    return {
      id: row.id,
      name: row.name,
      providerId: row.provider_id,
      baseModel: row.base_model,
      config: JSON.parse(row.config || '{}'),
      isEnabled: row.is_enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

// Singleton instance
export const databaseService = new DatabaseService()
