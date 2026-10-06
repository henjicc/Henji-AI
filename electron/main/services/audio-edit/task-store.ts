import { getDb } from '../db'
import { databaseLocations } from '../db-locations'
import crypto from 'node:crypto'
import type { AudioEditTask } from '../../../../src/core/audioEdit/types'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.audio_edit.tasks')
const active = new Map<string, { controller: AbortController; projectId: string; progress?: number; readOnly: boolean }>()

/*
 * 口播处理任务（转写、停顿分析、声音处理、导出）的回执表 `audio_edit_tasks`（迁移账本第 16 项）。
 * 任务按口播文档 ID（`document_id`）归属；接口里的 projectId 就是文档 ID。
 */

/** 任务结果里的文件位置整份按位置写法存储（实施方案 2.5）。 */
function encodeTaskResult(result: unknown): string {
  return databaseLocations.use((scope) => JSON.stringify(scope.encodeValue(result)))
}

function decodeTaskResult(text: string): unknown {
  const parsed = JSON.parse(text) as unknown
  return databaseLocations.use((scope) => scope.decodeValue(parsed))
}

export type AudioEditTaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export function createAudioEditTask(input: {
  requestId: string
  projectId: string
  kind: string
  inputDigest: string
}): void {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO audio_edit_tasks(
      request_id,document_id,kind,state,provider_task_id,input_digest,result_json,error_message,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(input.requestId, input.projectId, input.kind, 'queued', null, input.inputDigest, null, null, now, now)
}

export function registerAudioEditTaskController(requestId: string, projectId: string, controller: AbortController, readOnly = false): () => void {
  active.set(requestId, { controller, projectId, readOnly })
  return () => { active.delete(requestId) }
}

export function assertAudioEditProjectIdle(projectId: string): void {
  if ([...active.values()].some((task) => task.projectId === projectId && !task.readOnly)) throw new Error('口播还有处理任务，请先取消或等待完成。')
}

export function cancelAudioEditTask(requestId: string): void { active.get(requestId)?.controller.abort() }

export function listAudioEditTasks(projectId: string): AudioEditTask[] {
  const rows = getDb().prepare('SELECT request_id,document_id,kind,state,error_message FROM audio_edit_tasks WHERE document_id = ? ORDER BY updated_at DESC LIMIT 30').all(projectId) as Array<{ request_id: string; document_id: string; kind: string; state: AudioEditTaskState; error_message?: string }>
  return rows.map((row) => {
    const running = active.get(row.request_id)
    const interrupted = !running && (row.state === 'running' || row.state === 'queued')
    return { requestId: row.request_id, projectId: row.document_id, kind: row.kind, state: interrupted ? 'failed' : row.state,
      progress: running?.progress, errorMessage: interrupted ? '上次处理已中断。转写不会自动重新提交。' : row.error_message }
  })
}

export async function runAudioEditTask<T>(projectId: string, kind: string, operation: (signal: AbortSignal, progress: (value: number) => void) => Promise<T>, requestId: string = crypto.randomUUID(), input: string = '', readOnly = false): Promise<T> {
  const inputDigest = crypto.createHash('sha256').update(input).digest('hex')
  const existing = getDb().prepare('SELECT document_id,kind,state,result_json,input_digest FROM audio_edit_tasks WHERE request_id = ?').get(requestId) as { document_id: string; kind: string; state: string; result_json: string | null; input_digest: string } | undefined
  if (existing) {
    if (existing.document_id !== projectId || existing.kind !== kind || existing.input_digest !== inputDigest) throw new Error('任务引用与当前口播不匹配。')
    if (existing.state === 'completed' && existing.result_json) return decodeTaskResult(existing.result_json) as T
    throw new Error('该任务已提交，请查询原任务状态。')
  }
  if (!readOnly) assertAudioEditProjectIdle(projectId)
  const controller = new AbortController()
  const release = registerAudioEditTaskController(requestId, projectId, controller, readOnly)
  try {
    createAudioEditTask({ requestId, projectId, kind, inputDigest })
    updateAudioEditTask(requestId, { state: 'running' })
  } catch (error) { release(); throw error }
  logger.info('口播处理开始', { event: `audio_edit.${kind}.start`, requestId, context: { projectId } })
  try {
    const result = await operation(controller.signal, (progress) => {
      const task = active.get(requestId)
      if (task) task.progress = Math.max(0, Math.min(1, progress))
    })
    updateAudioEditTask(requestId, { state: 'completed', result: result ?? null })
    logger.info('口播处理完成', { event: `audio_edit.${kind}.completed`, requestId, context: { projectId } })
    return result
  } catch (error) {
    updateAudioEditTask(requestId, { state: controller.signal.aborted ? 'cancelled' : 'failed', errorMessage: error instanceof Error ? error.message : String(error) })
    if (controller.signal.aborted) logger.info('口播处理已取消', { event: `audio_edit.${kind}.cancelled`, requestId, context: { projectId } })
    else logger.error('口播处理失败', { event: `audio_edit.${kind}.failed`, requestId, context: { projectId }, error })
    throw error
  } finally { release() }
}

export function updateAudioEditTask(requestId: string, update: {
  state: AudioEditTaskState
  providerTaskId?: string
  result?: unknown
  errorMessage?: string
}): void {
  getDb().prepare(`
    UPDATE audio_edit_tasks SET
      state = ?,
      provider_task_id = COALESCE(?, provider_task_id),
      result_json = COALESCE(?, result_json),
      error_message = ?,
      updated_at = ?
    WHERE request_id = ?
  `).run(
    update.state,
    update.providerTaskId ?? null,
    update.result === undefined ? null : encodeTaskResult(update.result),
    update.errorMessage ?? null,
    Date.now(),
    requestId,
  )
}

export function findActiveAudioEditTask(projectId: string, kind: string, inputDigest: string): { requestId: string; state: string } | null {
  const row = getDb().prepare(`
    SELECT request_id,state FROM audio_edit_tasks
    WHERE document_id = ? AND kind = ? AND input_digest = ? AND state IN ('queued','running')
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId, kind, inputDigest) as { request_id: string; state: string } | undefined
  return row ? { requestId: row.request_id, state: row.state } : null
}

export interface AudioEditStoredTask { request_id: string; state: AudioEditTaskState; provider_task_id: string | null; input_digest: string; result_json: string | null }
export function findAudioEditTranscription(projectId: string): AudioEditStoredTask | undefined {
  const row = getDb().prepare("SELECT request_id,state,provider_task_id,input_digest,result_json FROM audio_edit_tasks WHERE document_id = ? AND kind = 'transcription' ORDER BY created_at DESC LIMIT 1").get(projectId) as AudioEditStoredTask | undefined
  return row?.result_json ? { ...row, result_json: JSON.stringify(decodeTaskResult(row.result_json)) } : row
}
export function isAudioEditTaskActive(requestId: string): boolean { return active.has(requestId) }
