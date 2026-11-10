import type Database from 'better-sqlite3'
import { setImmediate as yieldToIO } from 'node:timers/promises'
import type { RecycleCandidate, RecycleStore } from './collector'

export interface RecycleRow { id: number; source: string; payload: string }

/**
 * 只读到 horizon 为止：本次运行新入队的候选可能指向界面里还没保存的文件，留给下次启动。
 * 仍被引用的候选原地不动、不改写，下次启动重新普查。
 */
export function createRecycleStore(db: Database.Database, signal: AbortSignal, horizon: number, decode: (row: RecycleRow) => RecycleCandidate): {
  store: RecycleStore
  remaining(): number
} {
  let remaining = (db.prepare('SELECT count(*) AS n FROM media_recycle_candidates').get() as { n: number }).n
  const read = db.prepare('SELECT id, source, payload FROM media_recycle_candidates WHERE id > ? AND id <= ? ORDER BY id LIMIT 128')
  const remove = db.prepare('DELETE FROM media_recycle_candidates WHERE id = ?')
  const owned = new Map((db.prepare('SELECT path, identity, source_path FROM media_recycle_owned').all() as Array<{ path: string; identity: string; source_path: string | null }>).map(row => [row.path, row]))
  return {
    remaining: () => remaining,
    store: {
      count: () => remaining,
      candidates: async function* () {
        let cursor = 0
        for (;;) {
          signal.throwIfAborted()
          const rows = read.all(cursor, horizon) as RecycleRow[]
          if (!rows.length) return
          for (const row of rows) {
            signal.throwIfAborted()
            cursor = row.id
            yield decode(row)
          }
          await yieldToIO()
        }
      },
      identity: file => owned.get(file)?.identity,
      protector: file => owned.get(file)?.source_path ?? undefined,
      forget: id => {
        // 中止后不再碰数据库：退出流程可能已经关掉连接。
        signal.throwIfAborted()
        remaining -= remove.run(id).changes
      },
    },
  }
}
