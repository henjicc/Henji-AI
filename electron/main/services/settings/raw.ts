import { getDb } from '../db'

/*
 * 设置表的原始读写（不做位置换算），只给描述作品目录本身的设置用（dataRoot.ts）。
 * 作品目录是位置换算的基准；单独成模块，避免 作品目录 → 设置仓库 → 位置换算 → 作品目录 的循环。
 * 其他设置一律经 store.ts。
 */

export function readRawSettings(keys: readonly string[]): Map<string, string> {
  if (keys.length === 0) return new Map()
  const rows = getDb()
    .prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`)
    .all(...keys) as Array<{ key: string; value: string }>
  return new Map(rows.map((row) => [row.key, row.value]))
}

export function writeRawSetting(key: string, value: string, type: string): void {
  getDb().prepare(`
    INSERT INTO settings (key, value, type, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, type)
}

export function deleteRawSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}
