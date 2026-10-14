import { understandRecordingCapability } from '@/core/application-control/domains/screenRecording/understandingCapability'
import type { ApplicationExecutionContext } from '@/core/application-control'
import { applicationCallerAccess } from '@/core/application-control/callerContext'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { analyzeRecording, readRecordingUnderstanding } from './recordingUnderstandingService'
import { UNDERSTANDING_ENTITY, UNDERSTANDING_PROPERTY } from './recordingUnderstandingFields'

export async function executeRecordingUnderstanding(raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const input = understandRecordingCapability.inputSchema.parse(raw)
  if (!context.commitProperties) throw new Error('录制理解事务尚未装配。')
  const grant = context.callerGrant
  const requestId = context.requestId ?? crypto.randomUUID()
  const appContext: ApplicationExecutionContext = grant ? applicationCallerAccess(grant, requestId, context.signal) : {
    exposure: 'ui', permissions: new Set(['screen_recording:read', 'screen_recording:write', 'audio_edit:write']),
    acceptedDataClasses: new Set(['C1']), requestId, signal: context.signal,
  }
  if (!appContext.permissions.has('screen_recording:read')) throw new Error('PERMISSION_DENIED:理解录制需要 screen_recording:read 权限。')
  if (input.transcribe && !appContext.permissions.has('audio_edit:write')) throw new Error('PERMISSION_DENIED:转写还需要 audio_edit:write 权限以保存识别结果。')
  const before = await readRecordingUnderstanding(input.sessionRef.id)
  if (context.expectedRevisions?.screen_recording !== undefined && before.meta.revision !== context.expectedRevisions.screen_recording) throw new Error('CONFLICT:会话已修改，请重新读取。')
  const result = await analyzeRecording(input.sessionRef.id, input, context.signal, update => context.execution?.report({ targetMutation: 'applied', audioDocumentId: update.id, ...(update.transcribed ? { billing: 'completed' } : {}) }))
  context.signal.throwIfAborted()
  if (grant) applicationCallerAccess(grant, requestId, context.signal)
  const ref = { kind: UNDERSTANDING_ENTITY, id: input.sessionRef.id }
  const revisions = { screen_recording: result.revision }
  const committed = await context.commitProperties(ref, { [UNDERSTANDING_PROPERTY]: result.understanding }, revisions, '生成录制理解结果')
  const saved = await readRecordingUnderstanding(input.sessionRef.id)
  return { resultRef: ref, steps: result.understanding.steps.length, candidates: result.understanding.candidates.length, audioUpdates: result.audioUpdates.map(({ id, ...update }) => ({ ref: { kind: 'audio_edit.document', id }, ...update })), ...(committed.undoRef ? { undoRef: committed.undoRef } : {}), verified: JSON.stringify(saved.content.understanding) === JSON.stringify(result.understanding) }
}
