import { AsyncLocalStorage } from 'node:async_hooks'
import {
  AiRuntimeError,
  bailianNonRealtimeAsrPresets,
  createBailianAsrModule, createCapabilityClient, createGroqAsrModule,
  createSiliconFlowAsrModule, createVolcengineAsrModule,
  groqWhisperLargeV3, groqWhisperLargeV3Turbo,
  siliconFlowSenseVoiceSmall, volcengineSeedAsrFile,
  type RuntimeContext, type SpeechRecognitionEvent, type SpeechRecognitionOutput, type Transport,
} from '@henjicc/ai-sdk'
import { ASR_CATALOG, asrUploadLimitProblem, estimateAsrCost, type AsrCostEstimate, asrProviderId, isTimestampedLocalAsr, resolveTimestampedLocalAsr } from '../../../../src/core/audioEdit/asrCatalog'
import { normalizeTimestampedTranscript, type TimestampedTranscript } from '../../../../src/core/audioEdit/timestampedTranscript'
import { getAiProviderApiKey } from '../keystore'
import { sdkRuntimeContext } from '../ai-runtime/sdk-runtime'
import { createMainLogger } from '../logging'
import { resolveUploadFile } from '../ai-runtime/native-file-upload'
import { assertElectronHostCapabilities } from '../ai-runtime/host-capabilities'
import type { TranscriptionFacts, TranscriptionPreflight } from '../../../../src/core/audioEdit/transcriptionFailure'

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

interface TimestampedAsrModel {
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
  /** uploadBytes：实际要上传的文件大小（已知时，比按时长估算准）。 */
  preflight(input: TranscriptionPreflight, uploadBytes?: number): Promise<{ modelId: string; cost: AsrCostEstimate }>
  prepare(input: { modelId?: string; providerId?: string; audioPath: string; durationMs: number; language?: string }): TimestampedTranscriptionPlan
  execute(plan: TimestampedTranscriptionPlan, context: TimestampedAsrSubmissionContext): Promise<TimestampedTranscript>
  /** 明确声明不需要付费回执的调用（开发者测试台直接用 client 测模型）：只在这里面放行写请求，正式转写不走这里。 */
  withoutReceipt<T>(work: () => Promise<T>): Promise<T>
}

export interface TimestampedAsrExecutionContext {
  requestId: string
  signal: AbortSignal
  resumeTaskId?: string
  onEvent?: (event: SpeechRecognitionEvent) => void | Promise<void>
  /** 供应商完成后、取消与本地规范化前，由 owner 持久化已付费原始 DTO。 */
  onOutput?: (output: SpeechRecognitionOutput) => void | Promise<void>
  /** 第一个可能计费的请求发出之前调用并等待；抛错则不发出。 */
  onSubmitting?: () => void
}

/** 直接执行时提交钩子必填：漏传就无法在发请求前写下“结果未知”，取消或闪退后会被当作未计费而重复提交。 */
export type TimestampedAsrSubmissionContext = TimestampedAsrExecutionContext & { onSubmitting: () => void }

/** 两种 owner 共用的付费事实；最终结果和任务状态仍由各自 owner 保存。 */
export interface TimestampedAsrReceipt {
  modelId?: string
  sourceDigest?: string
  language?: string
  billing?: TranscriptionFacts['billing']
  rawOutput?: SpeechRecognitionOutput
}

/**
 * 上一次识别是否从未把请求交给供应商：任务已经结束（失败或取消；进程退出遗留的运行中由启动或下一次转写先记为中断），
 * 回执明确记为未计费，没有供应商任务号，也没有已付费结果。仍在运行中的一律不算：可能有别的进程正在上传或提交。
 * 历史回执里 native_upload_unsupported 的错误同样是零提交证据。
 */
export function timestampedAsrNeverSubmitted(task: { state: string; provider_task_id: string | null; error_message?: string | null }, receipt: TimestampedAsrReceipt | undefined): boolean {
  if ((task.state !== 'failed' && task.state !== 'cancelled') || task.provider_task_id || receipt?.rawOutput) return false
  return receipt?.billing === 'not_charged' || Boolean(task.error_message?.startsWith('[native_upload_unsupported]'))
}

export function prepareTimestampedAsrWithReceipt(
  service: Pick<TimestampedAsrService, 'prepare'>,
  input: Parameters<TimestampedAsrService['prepare']>[0],
  receipt: TimestampedAsrReceipt | undefined,
  sourceDigest: string,
): TimestampedTranscriptionPlan {
  if (!receipt?.rawOutput) return service.prepare(input)
  if (receipt.sourceDigest !== sourceDigest) throw new Error('素材已变化，不能复用旧识别任务。')
  const entry = ASR_CATALOG.find(entry => entry.descriptor.id === receipt.modelId)
  if (!entry) throw new Error('原转写模型不在目录中，请保留已付费结果。')
  // 本地恢复不依赖凭据，也不预检上传或访问供应商。
  return Object.freeze({ modelId: entry.descriptor.id, providerId: asrProviderId(entry),
    audioPath: input.audioPath, durationMs: input.durationMs, language: receipt.language ?? 'zh',
    cost: estimateAsrCost(entry.descriptor.id, input.durationMs) })
}

export async function executeTimestampedAsrWithReceipt(
  service: Pick<TimestampedAsrService, 'execute'>,
  plan: TimestampedTranscriptionPlan,
  context: TimestampedAsrExecutionContext,
  receipt: TimestampedAsrReceipt,
  persist: (receipt: TimestampedAsrReceipt) => void,
): Promise<TimestampedTranscript> {
  context.signal.throwIfAborted()
  try {
    if (receipt.rawOutput) {
      receipt.billing = 'completed'
      const entry = ASR_CATALOG.find(entry => entry.descriptor.id === receipt.modelId)
      if (!entry) throw new Error('原转写模型不在目录中，请保留已付费结果。')
      return normalizeTimestampedTranscript(receipt.rawOutput, plan.durationMs, entry.wordGranularity)
    }
    // 上传期间仍记为未计费：这时取消或进程退出，下次可以放心重新提交；写请求发出前才改成结果未知。
    receipt.billing = context.resumeTaskId ? 'submitted' : 'not_charged'
    persist({ ...receipt })
    const output = await service.execute(plan, { ...context,
      onSubmitting: () => {
        if (receipt.billing !== 'not_charged') return
        // 先写成功再改内存：owner 写不进去（任务已被接管）时抛错，请求不发，这次仍是未计费
        persist({ ...receipt, billing: 'unknown' })
        receipt.billing = 'unknown'
        context.onSubmitting?.()
      },
      onOutput: async output => {
        receipt.rawOutput = output
        receipt.billing = 'completed'
        persist({ ...receipt })
        await context.onOutput?.(output)
      },
      onEvent: async event => {
        if (event.type === 'processing') receipt.billing = 'submitted'
        await context.onEvent?.(event)
      },
    })
    receipt.billing = 'completed'
    return output
  } catch (error) {
    if (!receipt.rawOutput && ((error instanceof AiRuntimeError && error.details?.billing === 'not_charged')
      || (error instanceof Error && error.message.startsWith('[native_upload_unsupported]')))) receipt.billing = 'not_charged'
    throw error
  }
}

/** 当前这次识别的提交钩子；按异步上下文找到，同一时刻可以有多份识别在跑。 */
const submissionHook = new AsyncLocalStorage<() => void>()

/**
 * 识别前的准备都不计费：只读请求（申请临时存储凭证、查询任务）和临时存储直传（uploadFile）。
 * 第一个写请求（提交识别任务，或携带音频的同步识别）发出前先通知 owner 把回执记为结果未知，
 * 所以回执还是“未计费”时进程退出或取消，供应商一定没收到识别请求。
 */
function watchSubmission(transport: Transport): Transport {
  const beforeWrite = (method: string): void => {
    if (method === 'GET' || method === 'HEAD') return
    const hook = submissionHook.getStore()
    // 找不到这次识别的回执（异步上下文丢了）就不发：回执会一直写着“未计费”，发出去之后中断就可能重复付费
    if (!hook) {
      logger.warn('识别写请求不在回执上下文里，已阻止发送', { event: 'audio_edit.timestamped_asr.submission_unscoped' })
      throw new AiRuntimeError('host_capability_unsupported', '识别请求缺少付费回执，已阻止发送；未提交、未计费。', { retryable: false, billing: 'not_charged', execution: { notExecuted: true } })
    }
    hook()
  }
  const { fetchStream } = transport
  return {
    ...transport,
    fetch: async (url, init) => { beforeWrite((init?.method ?? 'GET').toUpperCase()); return transport.fetch(url, init) },
    ...(fetchStream ? { fetchStream: async (url: string, init: Parameters<typeof fetchStream>[1]) => { beforeWrite('POST'); return fetchStream(url, init) } } : {}),
  }
}

export function createTimestampedAsrService(runtime: RuntimeContext, isConfigured: (providerId: string) => boolean, checkMedia: (ref: string) => Promise<unknown> = resolveUploadFile): TimestampedAsrService {
  const client = createCapabilityClient({ runtime: { ...runtime, transport: watchSubmission(runtime.transport) }, modules: [
    ...bailianNonRealtimeAsrPresets.map((preset) => createBailianAsrModule(preset)),
    createGroqAsrModule(groqWhisperLargeV3Turbo), createGroqAsrModule(groqWhisperLargeV3),
    createSiliconFlowAsrModule(siliconFlowSenseVoiceSmall),
    createVolcengineAsrModule(volcengineSeedAsrFile),
  ] })
  return {
    client,
    withoutReceipt: (work) => submissionHook.run(() => undefined, work),
    async preflight(input, uploadBytes) {
      const selected = resolveTimestampedLocalAsr(isConfigured, input.modelId)
      assertElectronHostCapabilities(runtime, ['file-asr'])
      const tooLarge = asrUploadLimitProblem(selected, input.durationMs, uploadBytes)
      if (tooLarge) throw new AiRuntimeError('media_too_large', tooLarge, { retryable: false, billing: 'not_charged', execution: { notExecuted: true } })
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
      context: TimestampedAsrSubmissionContext,
    ): Promise<TimestampedTranscript> => {
      context.signal.throwIfAborted()
      const entry = ASR_CATALOG.find((entry) => entry.descriptor.id === plan.modelId)
      if (!entry || !isTimestampedLocalAsr(entry) || asrProviderId(entry) !== plan.providerId || !isConfigured(plan.providerId)) throw new Error('ASR_MODEL_UNAVAILABLE')
      if (context.resumeTaskId && !client.get(plan.modelId)?.descriptor.features?.includes('resume-task')) throw new Error('ASR_RESUME_UNSUPPORTED：此模型无法恢复查询，禁止重复提交。')
      // Callers may bypass planning. Resuming an already paid task needs no new upload or not-charged claim.
      if (!context.resumeTaskId) assertElectronHostCapabilities(runtime, ['file-asr'])
      logger.info('带时间转写开始', { event: 'audio_edit.timestamped_asr.start', requestId: context.requestId, modelId: plan.modelId, context: { costStatus: plan.cost.status } })
      try {
        const output = await submissionHook.run(context.onSubmitting, () => client.execute<unknown, SpeechRecognitionOutput, SpeechRecognitionEvent>(plan.modelId, {
          audio: { kind: 'media-ref', ref: plan.audioPath }, language: plan.language, punctuation: true, timestamps: true,
          options: { ...entry.timestampOptions, ...(context.resumeTaskId ? { resumeTaskId: context.resumeTaskId } : {}) },
        }, context))
        await context.onOutput?.(output)
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
