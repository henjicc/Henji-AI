import { getDb } from '../db'

const TTL_MS = 24 * 60 * 60 * 1000

export interface PendingResultPayload {
  url?: string
  filePath?: string
  metadata?: unknown
  structuredOutput?: unknown
}

interface PendingResultRow {
  result_json: string
  completed_at: number
}

export function savePendingResult(serverTaskId: string, result: PendingResultPayload): void {
  try {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO pending_task_results (server_task_id, result_json, completed_at)
      VALUES (?, ?, ?)
    `).run(serverTaskId.trim(), JSON.stringify(result), Date.now())
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

  if (!row) return null

  db.prepare('DELETE FROM pending_task_results WHERE server_task_id = ?').run(serverTaskId.trim())

  try {
    return JSON.parse(row.result_json) as PendingResultPayload
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
