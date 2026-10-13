import { getPlatform, isDesktopRuntime } from '@/platform'
import type { CapabilityCapture } from '@/core/captureLog/events'
import { capabilityCaptureTargets } from '@/core/captureLog/capability'
import type { ApplicationCapabilityDefinition } from '@/core/application-control/applicationCapabilities'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.application_control.recording')
let initialized: Promise<void> | undefined
let sessionId: string | null = null
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
/** UI and assistant calls through the same registry. Capture only validated identity, never arguments/results. */
export async function beginCapabilityCapture(definition: ApplicationCapabilityDefinition, input: unknown): Promise<(phase: CapabilityCapture['phase']) => Promise<void>> {
  if (!isDesktopRuntime()) return async () => undefined
  await initialize()
  const capturedSession = sessionId
  if (!capturedSession) return async () => undefined
  const callId = crypto.randomUUID()
  const targets = capabilityCaptureTargets(definition, input)
  const record = async (phase: CapabilityCapture['phase']): Promise<void> => {
    try { await getPlatform().screenRecording.recordCapability(capturedSession, { callId, capability: definition.id, targets, phase }) }
    catch (error) { logger.warn('能力执行记录未保存', { event: 'recording.capability.append.failed', error }) }
  }
  await record('started')
  return record
}
