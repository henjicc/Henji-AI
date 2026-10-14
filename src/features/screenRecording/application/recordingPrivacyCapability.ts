import type { CapabilityExecutionContext } from '@/features/application-control'
import { detectRecordingPrivacyCapability } from '@/core/application-control/domains/screenRecording/privacyCapability'
import { applicationCallerAccess } from '@/core/application-control/callerContext'
import { analyzeRecordingPrivacy } from './recordingPrivacyService'
import { readRecordingUnderstanding } from './recordingUnderstandingService'
import { UNDERSTANDING_ENTITY, UNDERSTANDING_PROPERTY } from './recordingUnderstandingFields'

export async function executeRecordingPrivacy(raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  const input = detectRecordingPrivacyCapability.inputSchema.parse(raw)
  if (!context.commitProperties) throw new Error('录制理解事务尚未装配。')
  if (context.callerGrant) { const access = applicationCallerAccess(context.callerGrant, context.requestId ?? crypto.randomUUID(), context.signal); if (!access.permissions.has('screen_recording:read')) throw new Error('PERMISSION_DENIED:隐私分析还需要 screen_recording:read。') }
  const before = await readRecordingUnderstanding(input.sessionRef.id)
  if (context.expectedRevisions?.screen_recording !== undefined && before.meta.revision !== context.expectedRevisions.screen_recording) throw new Error('CONFLICT:会话已改变，请重新读取。')
  const result = await analyzeRecordingPrivacy(input.sessionRef.id, context.signal, undefined, input.quality)
  if (result.revision !== before.meta.revision) throw new Error('CONFLICT:会话已变化，请重新识别。')
  context.signal.throwIfAborted()
  if (context.callerGrant) applicationCallerAccess(context.callerGrant, context.requestId ?? crypto.randomUUID(), context.signal)
  const ref = { kind: UNDERSTANDING_ENTITY, id: input.sessionRef.id }, understanding = { ...before.content.understanding, privacy: result.privacy }
  const committed = await context.commitProperties(ref, { [UNDERSTANDING_PROPERTY]: understanding }, { screen_recording: result.revision }, '生成敏感信息候选')
  const read = await readRecordingUnderstanding(ref.id)
  return { resultRef: ref, candidates: result.privacy.candidates.length, ...(committed.undoRef ? { undoRef: committed.undoRef } : {}), verified: JSON.stringify(read.content.understanding.privacy) === JSON.stringify(result.privacy) }
}
