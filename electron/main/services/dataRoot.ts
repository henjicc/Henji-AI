import { getDb } from './db'

const SETTING_KEY = 'custom_data_directory'

interface SettingValueRow {
  value: string
}

/**
 * 同步读取用户自定义数据根目录（SQLite settings 表，与渲染层 databaseService.getSetting 共用同一行）。
 * 供 path-utils.ts / protocol.ts 在主进程内直接调用，不走 IPC。
 */
export function getCustomDataRoot(): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETTING_KEY) as SettingValueRow | undefined
  const value = row?.value?.trim()
  return value ? value : null
}
