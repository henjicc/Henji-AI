import type Database from 'better-sqlite3'
import type { OperationRecord } from './operationStore'
import { applicationGenerationTaskId, applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'

/** 宿主当前的修订号；恢复回执沿用它，避免对外发出缺字段的结果。 */
export interface HostRevisionSnapshot { revision: number; scopeRevisions: Record<string, number> }

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * 取本次回执该带的修订号：优先沿用原回执，其次用宿主当前快照。
 *
 * 能力的公开输出 schema 把 `revision` / `scopeRevisions` 列为必填（`capabilityOutputSchema`
 * 给每个能力都加了这两项）。这里重建回执时漏掉它们，按 schema 校验的标准 MCP 客户端
 * 会直接拒收整条结果——外部客户端因此完全用不了付费生成，而 Pi 不做 schema 校验，
 * 所以这条一直没被发现。两个来源都拿不到时宁可不重建，也不发一条违反自己契约的回执。
 */
function resolveRevisions(record: OperationRecord, current?: () => HostRevisionSnapshot | undefined): HostRevisionSnapshot | undefined {
  const previous = object(object(record.result).data)
  if (typeof previous.revision === 'number' && previous.scopeRevisions && typeof previous.scopeRevisions === 'object') {
    return { revision: previous.revision, scopeRevisions: previous.scopeRevisions as Record<string, number> }
  }
  const envelope = object(record.result)
  if (typeof envelope.resultingRevision === 'number' && envelope.resultingScopeRevisions && typeof envelope.resultingScopeRevisions === 'object') {
    return { revision: envelope.resultingRevision, scopeRevisions: envelope.resultingScopeRevisions as Record<string, number> }
  }
  return current?.()
}

/** 启动和查询仅核对本地正式行，不提交模型请求，也不重新执行创建。 */
export function recoverPersistedGenerationOperation(
  db: Database.Database,
  record: OperationRecord,
  currentRevisions?: () => HostRevisionSnapshot | undefined,
): OperationRecord | undefined {
  if (record.capabilityId !== 'create_visible_generation_task' || !['unknown', 'completed'].includes(record.state)) return undefined
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history'").get()) return undefined
  const task = db.prepare('SELECT id, model_id, prompt, status, task_id, file_path FROM history WHERE id = ?').get(applicationGenerationTaskId(applicationInvocationId(record.callerId, record.operationId))) as {
    id: string; model_id: string; prompt: string; status: string; task_id: string | null; file_path: string | null
  } | undefined
  if (!task) return undefined
  const revisions = resolveRevisions(record, currentRevisions)
  if (!revisions) return undefined
  const target = { kind: 'generation.task', id: task.id }
  return { ...record, state: 'completed', verificationState: 'verified', targetRefs: [target],
    result: { ok: true, resultingRevision: revisions.revision, resultingScopeRevisions: revisions.scopeRevisions,
      data: { taskId: task.id, status: 'submitted', taskRef: target,
        revision: revisions.revision, scopeRevisions: revisions.scopeRevisions,
        observedStatus: task.status, serverTaskId: task.task_id,
        ...(task.file_path ? { resultRef: { kind: 'generation.result', id: task.id } } : {}),
        verification: { verified: true, condition: '原任务已由正式历史主键核对；尚未执行的排队任务不会自动提交', target } } } }
}
