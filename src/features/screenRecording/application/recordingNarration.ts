import { z } from 'zod'
import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import type { RecordingVoice } from '@/core/screenRecording/director'
import { withPaidOperation } from '@/services/paidApproval'
import { generationApplicationService, readGenerationResultMedia, waitForGenerationCompletion } from '@/features/generation'
import { registry } from '@/core/ModelRegistry'
import { transferGenerationPaidApproval } from '@/core/services/generationSubmissionConfirmation'
import type { CapabilityExecutionContext } from '@/features/application-control'

const logger = createLogger('features.screenRecording.narration')
export interface RecordingNarrationResult { path: string; durationUs: number; taskId?: string }
type Fixture = (text: string, signal: AbortSignal) => Promise<RecordingNarrationResult>
let fixture: Fixture | undefined
/** Only loaded by the isolated development tour; not a public capability parameter. */
export function installRecordingNarrationFixture(value: Fixture): void {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'development') || !window.henjiNative?.testFixtures) throw new Error('仅隔离巡检可安装模拟配音。')
  fixture = value
}
export function narrationIdentity(text: string, voice: RecordingVoice): string { return JSON.stringify([text, voice.modelId, Object.entries(voice.options).sort(([a], [b]) => a.localeCompare(b))]) }
export function recordingNarrationCost(text: string, voice: RecordingVoice): number | null {
  if (fixture) return 0
  assertSpeechModel(voice)
  const prepared = generationApplicationService.prepare({ modelId: voice.modelId, prompt: text, mediaType: 'audio', options: voice.options })
  return z.object({ comparableCnyAmount: z.number().nonnegative().nullable() }).parse(prepared.priceEstimate).comparableCnyAmount
}
function assertSpeechModel(voice: RecordingVoice): void {
  const model = registry.getModel(voice.modelId)
  if (!model || model.meta.type !== 'audio' || !model.params.some(param => 'panel' in param && param.panel === 'voice-selector')) throw new Error('请选择支持音色参数的语音合成模型。')
}
export async function generateRecordingNarration(text: string, voice: RecordingVoice, documentId: string, context: CapabilityExecutionContext, task?: { taskId?: string; operationId?: string; dispatched(id: string): Promise<void> }): Promise<RecordingNarrationResult> {
  const signal = context.signal
  signal.throwIfAborted()
  logger.info('准备录制旁白', { event: 'recording.narration.start', context: { documentId, modelId: voice.modelId, requestId: context.requestId } })
  try {
    if (fixture) return await fixture(text, signal)
    assertSpeechModel(voice)
    const input = { modelId: voice.modelId, prompt: text, mediaType: 'audio' as const, options: voice.options }
    let taskId = task?.taskId
    if (!taskId) {
      const prepared = generationApplicationService.prepare(input)
      const price = z.object({ comparableCnyAmount: z.number().nonnegative().nullable() }).parse(prepared.priceEstimate)
      await withPaidOperation({ category: 'generation', documentId, estimatedCny: price.comparableCnyAmount }, async approvedSignal => {
        approvedSignal.throwIfAborted()
        const operationId = task?.operationId ?? crypto.randomUUID()
        const releaseApproval = transferGenerationPaidApproval(operationId, approvedSignal)
        let submitted = false
        try {
          const submit = () => generationApplicationService.submit(input, operationId)
          const result = context.execution ? await context.execution.paid(submit) : await submit()
          taskId = result.taskId
          submitted = true
          // 先记住任务，断线恢复只等待原任务，避免再次付费。
          await task?.dispatched(taskId)
        } finally {
          // 排队任务仍须消费原收据，停止等待不能让它重新发起付费确认。
          if (!submitted) releaseApproval()
        }
      }, signal)
      const outcome = await waitForGenerationCompletion(taskId!, signal)
      if (!outcome.ok) throw new Error(outcome.error)
    } else {
      const outcome = await waitForGenerationCompletion(taskId, signal, true)
      if (!outcome.ok) throw new Error(outcome.error)
    }
    signal.throwIfAborted()
    const result = await readGenerationResultMedia(taskId!, 'audio', { outputIndex: 0, localOnly: true })
    if (!result) throw new Error('配音尚未保存，请从原生成任务恢复，不要重复付费。')
    const source = await getPlatform().audioEdit.probeSource(result.source, crypto.randomUUID())
    const durationUs = Math.round(source.durationFrames / source.sampleRate * 1e6)
    if (!Number.isSafeInteger(durationUs) || durationUs <= 0) throw new Error('配音没有有效时长。')
    logger.info('录制旁白已生成', { event: 'recording.narration.completed', context: { documentId, taskId, durationUs } })
    return { path: result.source, durationUs, taskId }
  } catch (error) { logger.error('录制旁白未完成', error, { event: signal.aborted ? 'recording.narration.cancelled' : 'recording.narration.failed', context: { documentId, taskId: task?.taskId } }); throw error }
}
