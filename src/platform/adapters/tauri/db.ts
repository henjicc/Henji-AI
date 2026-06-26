import Database from '@tauri-apps/plugin-sql'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir } from '@tauri-apps/plugin-fs'
import type { DbPlatform, SqlBindValue } from '@/platform/contracts/db'

let dbPromise: Promise<Database> | null = null

async function ensureDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const appDataDir = await appLocalDataDir()
      const henjiDir = await join(appDataDir, 'Henji-AI')
      if (!(await exists(henjiDir))) {
        await mkdir(henjiDir, { recursive: true })
      }
      const dbPath = await join(henjiDir, 'henji.db')
      return await Database.load(`sqlite:${dbPath}`)
    })()
  }
  return dbPromise
}

export function createTauriDb(): DbPlatform {
  return {
    async execute(sql: string, params?: SqlBindValue[]) {
      const db = await ensureDb()
      const result = await db.execute(sql, params)
      return { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId }
    },
    async select<T = unknown>(sql: string, params?: SqlBindValue[]) {
      const db = await ensureDb()
      return await db.select<T[]>(sql, params)
    },
  }
}
