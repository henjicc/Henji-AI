import { expect, it } from 'vitest'
import { recoverPersistedTranscriptionOperation } from './persistedOperationRecovery'
import type { OperationRecord } from './operationStore'
import type { AudioEditStoredTask } from '../audio-edit/task-store'

const record: OperationRecord = { operationId: 'operation', callerId: 'caller', inputDigest: '', input: {}, capabilityId: 'generate_video_edit_subtitles', state: 'unknown', requestId: 'request' }
const task: AudioEditStoredTask & { document_id: string } = { request_id: 'request', document_id: 'audio', state: 'failed', provider_task_id: null, result_json: null, input_digest: '' }
it('重载后仅凭明确的提交前错误改判未执行', () => {
  expect(recoverPersistedTranscriptionOperation(() => ({ ...task, error_message: '[native_upload_unsupported] 宿主未提供本地文件直传' }), record)).toMatchObject({ state: 'not_executed', verificationState: 'verified', result: { error: { details: { execution: { billing: 'not_charged' } } } } })
  expect(recoverPersistedTranscriptionOperation(() => undefined, record)).toBeUndefined()
})
it('原生任务已提交或完成可确认计费阶段，不能推断字幕是否写入', () => {
  for (const [input, billing] of [[{ ...task, provider_task_id: 'provider' }, 'submitted'], [{ ...task, result_json: JSON.stringify({ output: { project: {} } }) }, 'completed']] as const) {
    expect(recoverPersistedTranscriptionOperation(() => input, record)).toMatchObject({ state: 'unknown', verificationState: 'unresolved', result: { error: { details: { execution: { billing, targetMutation: 'unknown' }, recovery: { audioDocumentRef: { kind: 'audio_edit.document', id: 'audio' }, replayRecognition: false } } } } })
  }
})
