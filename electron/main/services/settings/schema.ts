import type Database from 'better-sqlite3'

/** 设置表（迁移账本第 2 项），唯一读写入口是同目录的 store.ts。2.3 之前已存在的表原样保留。 */
export function createSettingsTableV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * 描述作品目录本身的设置项：值是位置换算的基准（绝对路径），不做位置换算。
 * custom_data_directory：用户指定的作品目录；user_data_root：首次确定的默认作品目录（JSON）。
 */
export const USER_ROOT_SETTING_KEYS = ['custom_data_directory', 'user_data_root'] as const
