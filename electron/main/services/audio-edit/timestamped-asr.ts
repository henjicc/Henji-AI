import {
  bailianNonRealtimeAsrPresets,
  createBailianAsrModule, createCapabilityClient, createGroqAsrModule,
  createSiliconFlowAsrModule, createVolcengineAsrModule,
  groqWhisperLargeV3, groqWhisperLargeV3Turbo,
  siliconFlowSenseVoiceSmall, siliconFlowTeleSpeechAsr, volcengineSeedAsrFile,
  type RuntimeContext, type SpeechRecognitionEvent, type SpeechRecognitionOutput,
} from '@henjicc/ai-sdk'
import { ASR_CATALOG, estimateAsrCost, type AsrCostEstimate, asrProviderId, isTimestampedLocalAsr, resolveTimestampedLocalAsr } from '../../../../src/core/audioEdit/asrCatalog'
import { normalizeTimestampedTranscript, type TimestampedTranscript } from '../../../../src/core/audioEdit/timestampedTranscript'
import { getAiProviderApiKey } from '../keystore'
import { sdkRuntimeContext } from '../ai-runtime/sdk-runtime'
import { createMainLogger } from '../logging'
import { scopedUploadFile } from '../ai-runtime/native-file-upload'
import { assertElectronHostCapabilities } from '../ai-runtime/host-capabilities'
import type { TranscriptionPreflight } from '../../../../src/core/audioEdit/transcriptionFailure'

const logger = createMainLogger('main.audio_edit.asr')

export interface TimestampedTranscriptionPlan {
  readonly modelId: string
  readonly providerId: string
  readonly audioPath: string
  readonly durationMs: number
  readonly language: string
  /** 时长乘 SDK 资料中的所选模型单价；缺少单价时明确未知。 */
  readonly cost: Readonly<AsrCostEstimate>
}

export interface TimestampedAsrModel {
  id: string
  providerId: string
  configured: boolean
  timestamps: boolean
  longAudio: boolean
  localAudio: boolean
}

export interface TimestampedAsrService {
  client: ReturnType<typeof createCapabilityClient>
  listModels(): TimestampedAsrModel[]
  preflight(input: TranscriptionPreflight): Promise<{ modelId: string; cost: AsrCostEstimate }>
  prepare(input: { modelId?: string; providerId?: string; audioPath: string; durationMs: number; language?: string }): TimestampedTranscriptionPlan
  execute(plan: TimestampedTranscriptionPlan, context: { requestId: string; signal: AbortSignal; resumeTaskId?: string; onEvent?: (event: SpeechRecognitionEvent) => void | Promise<void> }): Promise<TimestampedTranscript>
}

export function createTimestampedAsrService(runtime: RuntimeContext, isConfigured: (providerId: string) => boolean, checkMedia: (ref: string) => Promise<unknown> = scopedUploadFile): TimestampedAsrService {
  const client = createCapabilityClient({ runtime, modules: [
    ...bailianNonRealtimeAsrPresets.map((preset) => createBailianAsrModule(preset)),
    createGroqAsrModule(groqWhisperLargeV3Turbo), createGroqAsrModule(groqWhisperLargeV3),
    createSiliconFlowAsrModule(siliconFlowSenseVoiceSmall), createSiliconFlowAsrModule(siliconFlowTeleSpeechAsr),
    createVolcengineAsrModule(volcengineSeedAsrFile),
  ] })
  return {
    client,
    async preflight(input) {
      const selected = resolveTimestampedLocalAsr(isConfigured, input.modelId)
      assertElectronHostCapabilities(runtime, ['file-asr'])
      await checkMedia(input.sourcePath)
      return { modelId: selected.descriptor.id, cost: estimateAsrCost(selected.descriptor.id, input.durationMs) }
    },
    listModels: (): TimestampedAsrModel[] => client.list('speech-recognition').filter((descriptor) => {
      const entry = ASR_CATALOG.find((entry) => entry.descriptor.id === descriptor.id)
      return entry !== undefined && isTimestampedLocalAsr(entry)
    }).map((descriptor) => ({
      id: descriptor.id,
      providerId: descriptor.providerIds?.[0] ?? '',
      configured: isConfigured(descriptor.providerIds?.[0] ?? ''),
      timestamps: descriptor.features?.includes('timestamps') ?? false,
      longAudio: descriptor.tags?.includes('long-audio') ?? false,
      localAudio: ASR_CATALOG.find((entry) => entry.descriptor.id === descriptor.id)?.localAudio ?? false,
    })),
    prepare: (input: { modelId?: string; providerId?: string; audioPath: string; durationMs: number; language?: string }): TimestampedTranscriptionPlan => {
      const selected = resolveTimestampedLocalAsr(isConfigured, input.modelId, input.providerId)
      if (!input.audioPath.trim() || !Number.isFinite(input.durationMs) || input.durationMs <= 0) throw new Error('ASR_AUDIO_INVALID')
      return Object.freeze({
        modelId: selected.descriptor.id, providerId: asrProviderId(selected), audioPath: input.audioPath,
        durationMs: input.durationMs, language: input.language ?? 'zh',
        cost: Object.freeze(estimateAsrCost(selected.descriptor.id, input.durationMs)),
      })
    },
    /** 仅执行一次；owner 负责授权、operationId、任务账本、恢复和音频→墙钟映射。 */
    execute: async (
      plan: TimestampedTranscriptionPlan,
      context: { requestId: string; signal: AbortSignal; resumeTaskId?: string; onEvent?: (event: SpeechRecognitionEvent) => void | Promise<void> },
    ): Promise<TimestampedTranscript> => {
      context.signal.throwIfAborted()
      const entry = ASR_CATALOG.find((entry) => entry.descriptor.id === plan.modelId)
      if (!entry || !isTimestampedLocalAsr(entry) || asrProviderId(entry) !== plan.providerId || !isConfigured(plan.providerId)) throw new Error('ASR_MODEL_UNAVAILABLE')
      if (context.resumeTaskId && !client.get(plan.modelId)?.descriptor.features?.includes('resume-task')) throw new Error('ASR_RESUME_UNSUPPORTED：此模型无法恢复查询，禁止重复提交。')
      // Callers may bypass planning. Resuming an already paid task needs no new upload or not-charged claim.
      if (!context.resumeTaskId) assertElectronHostCapabilities(runtime, ['file-asr'])
      logger.info('带时间转写开始', { event: 'audio_edit.timestamped_asr.start', requestId: context.requestId, modelId: plan.modelId, context: { costStatus: plan.cost.status } })
      try {
        const output = await client.execute<unknown, SpeechRecognitionOutput, SpeechRecognitionEvent>(plan.modelId, {
          audio: { kind: 'media-ref', ref: plan.audioPath }, language: plan.language, punctuation: true, timestamps: true,
          options: { ...entry.timestampOptions, ...(context.resumeTaskId ? { resumeTaskId: context.resumeTaskId } : {}) },
        }, context)
        context.signal.throwIfAborted()
        const result = normalizeTimestampedTranscript(output, plan.durationMs, entry.wordGranularity)
        logger.info('带时间转写完成', { event: 'audio_edit.timestamped_asr.completed', requestId: context.requestId, modelId: plan.modelId, context: { granularity: result.granularity } })
        return result
      } catch (error) {
        logger.error('带时间转写失败', { event: 'audio_edit.timestamped_asr.failed', requestId: context.requestId, modelId: plan.modelId, context: { cancelled: context.signal.aborted } })
        throw error
      }
    },
  }
}

export const timestampedAsrService = createTimestampedAsrService(sdkRuntimeContext, (providerId) => Boolean(getAiProviderApiKey(providerId)))
