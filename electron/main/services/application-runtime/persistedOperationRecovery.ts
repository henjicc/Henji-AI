import type Database from 'better-sqlite3'
import type { OperationRecord } from './operationStore'
import { applicationGenerationTaskId } from '../../../../src/core/application-control/operationIdentity'

/** 启动和查询仅核对本地正式行，不提交模型请求，也不重新执行创建。 */
export function recoverPersistedGenerationOperation(db: Database.Database, record: OperationRecord): OperationRecord | undefined {
  if (record.capabilityId !== 'create_visible_generation_task' || !['unknown', 'completed'].includes(record.state)) return undefined
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history'").get()) return undefined
  const task = db.prepare('SELECT id, model_id, prompt, status, task_id, file_path FROM history WHERE id = ?').get(applicationGenerationTaskId(record.operationId)) as {
    id: string; model_id: string; prompt: string; status: string; task_id: string | null; file_path: string | null
  } | undefined
  if (!task) return undefined
  const target = { kind: 'generation.task', id: task.id }
  return { ...record, state: 'completed', verificationState: 'verified', targetRefs: [target],
    result: { ok: true, data: { taskId: task.id, status: 'submitted', taskRef: target,
      observedStatus: task.status, serverTaskId: task.task_id,
      ...(task.file_path ? { resultRef: { kind: 'generation.result', id: task.id } } : {}),
      verification: { verified: true, condition: '原任务已由正式历史主键核对；尚未执行的排队任务不会自动提交', target } } } }
}
