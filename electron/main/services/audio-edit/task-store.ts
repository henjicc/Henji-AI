import { getDb } from '../db'

export type AudioEditTaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export function createAudioEditTask(input: {
  requestId: string
  projectId: string
  kind: 'transcription' | 'export'
  inputDigest: string
}): void {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO audio_edit_tasks(
      request_id,project_id,kind,state,provider_task_id,input_digest,result_json,error_message,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(input.requestId, input.projectId, input.kind, 'queued', null, input.inputDigest, null, null, now, now)
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
    update.result === undefined ? null : JSON.stringify(update.result),
    update.errorMessage ?? null,
    Date.now(),
    requestId,
  )
}

export function findActiveAudioEditTask(projectId: string, kind: string, inputDigest: string): { requestId: string; state: string } | null {
  const row = getDb().prepare(`
    SELECT request_id,state FROM audio_edit_tasks
    WHERE project_id = ? AND kind = ? AND input_digest = ? AND state IN ('queued','running')
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId, kind, inputDigest) as { request_id: string; state: string } | undefined
  return row ? { requestId: row.request_id, state: row.state } : null
}
