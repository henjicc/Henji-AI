import type Database from 'better-sqlite3'

import type { SettingEntryDto, SettingValueType } from '../../../../src/core/localRecords/types'
import { getDb } from '../db'
import { databaseLocations, type DatabaseLocations, type LocationScope } from '../db-locations'
import { USER_ROOT_SETTING_KEYS } from './schema'

/*
 * 设置表的唯一读写入口（存储底座 2.3）。渲染层经 IPC `appSettings:*`，主进程各服务直接调用本模块。
 *
 * - 值里的文件位置按位置写法存储（实施方案 2.5）：`json` 类型整份换算，其他类型按单值换算；
 *   描述作品目录本身的两项（USER_ROOT_SETTING_KEYS）是换算基准，原样存取。
 * - 只有值看起来含路径时才解析作品目录，读写普通设置不会提前确定作品目录。
 */

const MAY_CONTAIN_LOCATION = /henji:|henji-media:|file:|[A-Za-z]:[\\/]|(?:^|")[\\/]/

interface SettingRow {
  key: string
  value: string
  type: string
}

function isRootKey(key: string): boolean {
  return (USER_ROOT_SETTING_KEYS as readonly string[]).includes(key)
}

function normalizeType(type: string): SettingValueType {
  return type === 'number' || type === 'boolean' || type === 'json' ? type : 'string'
}

function convert(value: string, type: SettingValueType, scope: LocationScope, direction: 'encode' | 'decode'): string {
  if (type === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      return value
    }
    const next = direction === 'encode' ? scope.encodeValue(parsed) : scope.decodeValue(parsed)
    const serialized = JSON.stringify(next)
    // 内容没变时保留原文（不因重新序列化改变格式）。
    return serialized === JSON.stringify(parsed) ? value : serialized
  }
  return direction === 'encode' ? scope.encodePath(value) : scope.decodePath(value)
}

export class SettingsStore {
  constructor(
    private readonly database: () => Database.Database,
    private readonly locations: DatabaseLocations,
  ) {}

  private transform(key: string, value: string, type: SettingValueType, direction: 'encode' | 'decode'): string {
    if (isRootKey(key) || !MAY_CONTAIN_LOCATION.test(value)) return value
    return this.locations.use((scope) => convert(value, type, scope, direction))
  }

  getEntry(key: string): SettingEntryDto | null {
    const row = this.database().prepare('SELECT key, value, type FROM settings WHERE key = ?').get(key) as SettingRow | undefined
    if (!row) return null
    const type = normalizeType(row.type)
    return { key: row.key, value: this.transform(row.key, row.value, type, 'decode'), type }
  }

  get(key: string): string | null {
    return this.getEntry(key)?.value ?? null
  }

  set(key: string, value: string, type: SettingValueType = 'string'): void {
    const stored = this.transform(key, value, type, 'encode')
    this.database().prepare(`
      INSERT INTO settings (key, value, type, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = CURRENT_TIMESTAMP
    `).run(key, stored, type)
  }

  delete(key: string): void {
    this.database().prepare('DELETE FROM settings WHERE key = ?').run(key)
  }
}

let store: SettingsStore | null = null

export function getSettingsStore(): SettingsStore {
  store ??= new SettingsStore(getDb, databaseLocations)
  return store
}
