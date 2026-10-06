import { readGenerationSubmission } from './generation-submissions'
import { readStringArray } from './host-response'
import { getDb } from '../db'
import { databaseLocations } from '../db-locations'

/*
 * 待取结果回执（pending_task_results，迁移账本第 7 项）的唯一读写入口。
 * 回执里的文件位置整份按位置写法存储（实施方案 2.5），读出时换回绝对路径。
 */

const TTL_MS = 24 * 60 * 60 * 1000

export interface PendingResultPayload {
  status?: string
  taskId?: string
  urls?: string[]
  filePaths?: string[]
  createdFilePaths?: string[]
  metadata?: unknown
  structuredOutput?: unknown
}

interface PendingResultRow {
  result_json: string
  completed_at: number
}

export function savePendingResult(serverTaskId: string, result: PendingResultPayload): void {
  try {
    const stored = databaseLocations.use((scope) => JSON.stringify(scope.encodeValue(result)))
    getDb().prepare(`
      INSERT OR REPLACE INTO pending_task_results (server_task_id, result_json, completed_at)
      VALUES (?, ?, ?)
    `).run(serverTaskId.trim(), stored, Date.now())
  } catch {
    // Best-effort: never throw from save to avoid breaking the generation response
  }
}

export function consumePendingResult(serverTaskId: string): PendingResultPayload | null {
  const db = getDb()
  const cutoff = Date.now() - TTL_MS
  const row = db.prepare(`
    SELECT result_json, completed_at FROM pending_task_results
    WHERE server_task_id = ? AND completed_at > ?
  `).get(serverTaskId.trim(), cutoff) as PendingResultRow | undefined

  if (!row) return readGenerationSubmission(serverTaskId)

  // 读取不是确认保存；保留回执直到过期清理，重载可再次核对。

  try {
    const parsed = JSON.parse(row.result_json) as unknown
    const decoded = databaseLocations.use((scope) => scope.decodeValue(parsed)) as PendingResultPayload
    return { ...decoded, urls: readStringArray(decoded.urls), filePaths: readStringArray(decoded.filePaths) }
  } catch {
    return null
  }
}

export function cleanupExpiredPendingResults(): void {
  try {
    const db = getDb()
    const cutoff = Date.now() - TTL_MS
    db.prepare('DELETE FROM pending_task_results WHERE completed_at <= ?').run(cutoff)
  } catch {
    // Best-effort cleanup
  }
}
