import { jsonEqual } from '@/core/jsonEqual'
import { understandRecordingCapability } from '@/core/application-control/domains/screenRecording/understandingCapability'
import { applicationCallerAccess } from '@/core/application-control/callerContext'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { analyzeRecording, readRecordingUnderstanding } from './recordingUnderstandingService'
import { editableRecordingUnderstanding, UNDERSTANDING_ENTITY, UNDERSTANDING_PROPERTY } from './recordingUnderstandingFields'

export async function executeRecordingUnderstanding(raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const input = understandRecordingCapability.inputSchema.parse(raw)
  if (!context.commitProperties) throw new Error('录制理解事务尚未装配。')
  const grant = context.callerGrant
  const requestId = context.requestId ?? crypto.randomUUID()
  const before = await readRecordingUnderstanding(input.sessionRef.id)
  if (context.expectedRevisions?.screen_recording !== undefined && before.meta.revision !== context.expectedRevisions.screen_recording) throw new Error('CONFLICT:会话已修改，请重新读取。')
  const result = await analyzeRecording(input.sessionRef.id, input, context.signal, update => context.execution?.report({ targetMutation: 'applied', audioDocumentId: update.id, ...(update.transcribed ? { billing: 'completed' } : {}) }))
  context.signal.throwIfAborted()
  if (grant) applicationCallerAccess(grant, requestId, context.signal)
  const ref = { kind: UNDERSTANDING_ENTITY, id: input.sessionRef.id }
  const revisions = { screen_recording: result.revision }
  const committed = await context.commitProperties(ref, { [UNDERSTANDING_PROPERTY]: editableRecordingUnderstanding(result.understanding) }, revisions, '生成录制理解结果')
  const saved = await readRecordingUnderstanding(input.sessionRef.id)
  return { resultRef: ref, steps: result.understanding.steps.length, candidates: result.understanding.candidates.length, audioUpdates: result.audioUpdates.map(({ id, ...update }) => ({ ref: { kind: 'audio_edit.document', id }, ...update })), ...(committed.undoRef ? { undoRef: committed.undoRef } : {}), verified: jsonEqual(editableRecordingUnderstanding(saved.content.understanding), editableRecordingUnderstanding(result.understanding)) }
}
