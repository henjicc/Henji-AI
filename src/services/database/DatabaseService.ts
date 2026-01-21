/**
 * Database Service Implementation
 *
 * Provides type-safe access to SQLite database
 */

import Database from '@tauri-apps/plugin-sql'
import type {
  DatabaseService as IDatabaseService,
  HistoryRecord,
  PresetRecord,
  SettingRecord,
  CustomModelRecord,
  HistoryQueryOptions,
  PresetQueryOptions,
} from './types'

class DatabaseService implements IDatabaseService {
  private db: Database | null = null
  private dbPath = 'sqlite:henji.db'

  /**
   * Initialize database connection
   */
  async init(): Promise<void> {
    if (this.db) return

    try {
      this.db = await Database.load(this.dbPath)
      console.log('[Database] Connected successfully')
    } catch (error) {
      console.error('[Database] Connection failed:', error)
      throw new Error(`Database initialization failed: ${error}`)
    }
  }

  /**
   * Ensure database is connected
   */
  private ensureConnected(): Database {
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
    const params: any[] = []

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

    const rows = await db.select<any[]>(sql, params)
    return rows.map(this.mapHistoryRow)
  }

  async getHistoryById(id: string): Promise<HistoryRecord | null> {
    const db = this.ensureConnected()

    const rows = await db.select<any[]>(
      'SELECT * FROM history WHERE id = ?',
      [id]
    )

    return rows.length > 0 ? this.mapHistoryRow(rows[0]) : null
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
    const params: any[] = []

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

    const rows = await db.select<any[]>(sql, params)
    return rows.map(this.mapPresetRow)
  }

  async getPresetById(id: string): Promise<PresetRecord | null> {
    const db = this.ensureConnected()

    const rows = await db.select<any[]>(
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
    const params: any[] = []

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

    const rows = await db.select<any[]>(
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
    const params: any[] = []

    if (providerId) {
      sql += ' AND provider_id = ?'
      params.push(providerId)
    }

    sql += ' ORDER BY created_at DESC'

    const rows = await db.select<any[]>(sql, params)
    return rows.map(this.mapCustomModelRow)
  }

  async getCustomModelById(id: string): Promise<CustomModelRecord | null> {
    const db = this.ensureConnected()

    const rows = await db.select<any[]>(
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
    const params: any[] = []

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

  private mapHistoryRow(row: any): HistoryRecord {
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

  private mapPresetRow(row: any): PresetRecord {
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

  private mapCustomModelRow(row: any): CustomModelRecord {
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
