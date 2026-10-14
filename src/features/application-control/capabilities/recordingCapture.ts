import { getPlatform, isDesktopRuntime } from '@/platform'
import type { CapabilityCapture } from '@/core/captureLog/events'
import { capabilityCaptureTargets } from '@/core/captureLog/capability'
import type { ApplicationCapabilityDefinition } from '@/core/application-control/applicationCapabilities'
import { createLogger } from '@/core/logging'
import { captureRecordingOperations } from '@/core/screenRecording/script'

const logger = createLogger('features.application_control.recording')
let initialized: Promise<void> | undefined
let sessionId: string | null = null
let baselineSession: string | null = null
const capturedBaselines = new Set<string>()
async function initialize(): Promise<void> {
  if (!initialized) initialized = (async () => {
    const api = getPlatform().screenRecording
    let received = false
    const unsubscribe = api.onChanged(snapshot => { received = true; sessionId = snapshot?.phase === 'recording' ? snapshot.sessionId : null })
    try {
      const snapshot = await api.snapshot()
      if (!received) sessionId = snapshot?.phase === 'recording' ? snapshot.sessionId : null
    } catch (error) { unsubscribe(); throw error }
  })().catch(error => { initialized = undefined; logger.warn('录制事件连接未完成', { event: 'recording.capability.connect.failed', error }) })
  await initialized
}
/** UI and assistant calls through the same registry. Events contain identity only; the separate script snapshot accepts a finite property allowlist. */
export async function beginCapabilityCapture(definition: ApplicationCapabilityDefinition, input: unknown): Promise<(phase: CapabilityCapture['phase']) => Promise<void>> {
  if (!isDesktopRuntime()) return async () => undefined
  await initialize()
  const capturedSession = sessionId
  if (!capturedSession) return async () => undefined
  const callId = crypto.randomUUID()
  const targets = capabilityCaptureTargets(definition, input)
  const operations = captureRecordingOperations(definition.id, input)
  if (operations) {
    try {
      if (baselineSession !== capturedSession) { baselineSession = capturedSession; capturedBaselines.clear() }
      const { requireVideoEditInstance } = await import('@/features/videoEdit')
      const ids = [...new Set(operations.map(operation => operation.target.id.split(':')[0]))].filter(id => !capturedBaselines.has(id))
      const baselines = ids.map(documentId => ({ documentId, content: structuredClone(requireVideoEditInstance(documentId).document) }))
      await getPlatform().screenRecording.capture({ operation: 'script-call', sessionId: capturedSession, call: { callId, operations }, baselines })
      if (baselineSession === capturedSession) ids.forEach(id => capturedBaselines.add(id))
    } catch (error) { logger.warn('操作快照未保存，此次操作不能自动重录', { event: 'recording.script.capture.failed', error }) }
  }
  const record = async (phase: CapabilityCapture['phase']): Promise<void> => {
    try { await getPlatform().screenRecording.recordCapability(capturedSession, { callId, capability: definition.id, targets, phase }) }
    catch (error) { logger.warn('能力执行记录未保存', { event: 'recording.capability.append.failed', error }) }
  }
  await record('started')
  return record
}
