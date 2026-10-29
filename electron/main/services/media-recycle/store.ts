import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { setImmediate as yieldToIO } from 'node:timers/promises'
import type { RecycleCandidate, RecycleStore } from './collector'

export interface RecycleRow { id: number; source: string; payload: string }
const referenceStates = new WeakMap<Database.Database, { signature: string; sleeping: Set<number> }>()

/** 队列顺序本身就是持久续扫位置；引用休眠仅复用本连接已完成的普查，重开连接保守复查。 */
export function createRecycleStore(db: Database.Database, signal: AbortSignal, decode: (row: RecycleRow) => RecycleCandidate): {
  store: RecycleStore
  revision(): string
  referencesReady(references: ReadonlySet<string>): void
  acknowledgeBackup(): void
  remaining(): number
  checkpointError(): unknown
  dispose(): void
} {
  let remaining = (db.prepare('SELECT count(*) AS n FROM media_recycle_candidates').get() as { n: number }).n
  const horizon = (db.prepare('SELECT max(id) AS id FROM media_recycle_candidates').get() as { id: number | null }).id ?? 0
  const read = db.prepare('SELECT id, source, payload FROM media_recycle_candidates WHERE id > ? AND id <= ? ORDER BY id LIMIT 128')
  const rotate = db.prepare('UPDATE media_recycle_candidates SET id = (SELECT max(id) + 1 FROM media_recycle_candidates) WHERE id = ? RETURNING id')
  const remove = db.prepare('DELETE FROM media_recycle_candidates WHERE id = ?')
  const changes = db.prepare('SELECT total_changes() AS n')
  const owned = new Map((db.prepare('SELECT path, identity, source_path FROM media_recycle_owned').all() as Array<{ path: string; identity: string; source_path: string | null }>).map(row => [row.path, row]))
  let ownChanges = 0
  let state = referenceStates.get(db)
  if (!state) { state = { signature: '', sleeping: new Set() }; referenceStates.set(db, state) }
  const references = state
  const visited = new Set<number>()
  const forgotten = new Set<number>()
  let checkpointError: unknown
  // 路径检查可以 await，数据库事务只包住每页结束或截止通知中的同步队列写入。
  const publish = db.transaction(() => {
    const moved: Array<[number, number]> = []
    let removed = 0
    for (const id of visited) {
      if (forgotten.has(id)) removed += remove.run(id).changes
      else { const row = rotate.get(id) as { id: number } | undefined; if (row) moved.push([id, row.id]) }
    }
    return { moved, removed }
  })
  const checkpoint = (): void => {
    if (!visited.size || db.open === false) return
    const result = publish()
    ownChanges += result.moved.length + result.removed
    remaining += forgotten.size - result.removed
    for (const [id, next] of result.moved) if (references.sleeping.delete(id)) references.sleeping.add(next)
    visited.clear(); forgotten.clear()
  }
  // AbortController 同步通知先发布续扫位置，然后启动/退出守卫才会放行窗口或关闭数据库。
  const cancelled = (): void => {
    try { checkpoint() }
    catch (error) { remaining += forgotten.size; forgotten.clear(); checkpointError = error }
  }
  signal.addEventListener('abort', cancelled, { once: true })
  return {
    remaining: () => remaining,
    checkpointError: () => checkpointError,
    dispose: () => signal.removeEventListener('abort', cancelled),
    // 仅抵消本轮已知的副本登记，其他写入仍使引用普查失效。
    acknowledgeBackup: () => { ownChanges++ },
    revision: () => String((changes.get() as { n: number }).n - ownChanges),
    referencesReady: values => {
      const signature = createHash('sha256').update(JSON.stringify([...values].sort())).digest('hex')
      if (signature !== references.signature) { references.sleeping.clear(); references.signature = signature }
    },
    store: {
      count: () => remaining,
      candidates: async function* () {
        let cursor = 0
        try {
          for (;;) {
            signal.throwIfAborted()
            const rows = read.all(cursor, horizon) as RecycleRow[]
            if (!rows.length) return
            for (const row of rows) {
              signal.throwIfAborted()
              cursor = row.id
              if (references.sleeping.has(row.id)) continue
              visited.add(row.id)
              yield decode(row)
            }
            checkpoint()
            await yieldToIO()
          }
        } finally { if (!signal.aborted) checkpoint() }
      },
      identity: file => owned.get(file)?.identity,
      protector: file => owned.get(file)?.source_path ?? undefined,
      referenced: id => { references.sleeping.add(id) },
      forget: id => {
        signal.throwIfAborted()
        if (!forgotten.has(id)) { forgotten.add(id); remaining-- }
        references.sleeping.delete(id)
      },
    },
  }
}
