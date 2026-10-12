import { readGenerationSubmission } from './generation-submissions'
import { readStringArray } from './host-response'
import { getDb } from '../db'
import { databaseLocations } from '../db-locations'
import { createMainLogger } from '../logging'

/*
 * 待取结果回执（pending_task_results，迁移账本第 7 项）的唯一读写入口。
 * 回执里的文件位置整份按位置写法存储（实施方案 2.5），读出时换回绝对路径。
 */

const logger = createMainLogger('ai-runtime.pending-results')
// 保存故障期间保留真实结果，原任务可重试保存；绝不重放供应商生成。
const unconfirmedResults = new Map<string, PendingResultPayload>()

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
  const taskId = serverTaskId.trim()
  unconfirmedResults.set(taskId, result)
  try {
    const stored = databaseLocations.use((scope) => JSON.stringify(scope.encodeValue(result)))
    getDb().prepare(`
      INSERT OR REPLACE INTO pending_task_results (server_task_id, result_json, completed_at)
      VALUES (?, ?, ?)
    `).run(taskId, stored, Date.now())
    unconfirmedResults.delete(taskId)
  } catch (cause) {
    logger.error('结果已生成，保存尚未确认', { event: 'ai_runtime.pending_result.save_failed', taskId, error: cause })
    throw new Error('结果已生成、保存未确认。请从原任务继续获取结果。', { cause })
  }
}

export function consumePendingResult(serverTaskId: string): PendingResultPayload | null {
  const pending = unconfirmedResults.get(serverTaskId.trim())
  if (pending) {
    savePendingResult(serverTaskId, pending)
    return pending
  }
  const db = getDb()
  const row = db.prepare(`
    SELECT result_json, completed_at FROM pending_task_results
    WHERE server_task_id = ?
  `).get(serverTaskId.trim()) as PendingResultRow | undefined

  if (!row) return readGenerationSubmission(serverTaskId)

  // 读取不是确认保存；恢复记录不因时间流逝而失效。

  try {
    const parsed = JSON.parse(row.result_json) as unknown
    const decoded = databaseLocations.use((scope) => scope.decodeValue(parsed)) as PendingResultPayload
    return { ...decoded, urls: readStringArray(decoded.urls), filePaths: readStringArray(decoded.filePaths) }
  } catch (error) {
    logger.error('生成结果恢复记录读取失败', { event: 'ai_runtime.pending_result.read_failed', taskId: serverTaskId, error })
    throw error
  }
}
