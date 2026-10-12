import { createLogger } from '@/core/logging'
import type { DocumentContainerRef } from '@/core/documents/types'
import { emitApplicationEvent } from '@/core/events/applicationEvents'
import { clearProviderAvailability, rememberProviderFailure } from './providerAvailability'

const logger = createLogger('core.services.GenerationService')
/**
 * GenerationService - unified AI runtime gateway.
 *
 * Frontend only prepares model params and delegates execution to the Electron backend.
 */

import { registry } from '@/core/ModelRegistry'
import { getControlledExecutionModel } from '@/core/modelCatalog/controlledExecutionModels'
import { createProgressTracker, resolveProgressSpec } from '@/core/progress/progressTracker'
import type { GenerateResult, ProgressStatus } from '@/core/providers/base'
import { getI18nText, type ProviderId } from '@/core/types'
import { stripDerivedMediaState } from '@/core/params/derivedMediaState'
import { captureClonedVoice } from '@/services/voiceLibrary/captureClonedVoice'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'
import { attachVideoDurations } from './generationVideoDurations'
import { confirmGenerationSubmission, consumeGenerationPaidApproval, GenerationSubmissionCancelledError, type GenerationPaidExecution } from './generationSubmissionConfirmation'
import {
  buildGeneratePreflightSummary,
  buildProgressTimingContext,
  recordRuntimeTrace,
} from './generationDiagnostics'
import {
  attachUploadRuntimeParams,
  compressFirstVideoIfNeeded,
  createRequestId,
  formatFailedMetadata,
  getErrorMessage,
  normalizeSmartAspectParams,
  trimFirstVideoIfSelected,
} from './generationRequestPreflight'
import {
  aiCancelTask,
  aiContinuePolling,
  aiGenerate,
  aiGetProgressEstimate,
  aiGetProviderKeyStatus,
  aiRecordProgressSample,
  type AiRecordProgressSampleResponseDto,
  aiRemoveProviderApiKey,
  aiSetProviderApiKey,
  type AiProgressEstimateDto,
  type ProviderKeyStatusDto,
} from '@/commands/aiRuntime'

/**
 * Backward-compatible type kept for API stability.
 */
export type ProviderFactory = never

export interface GenerationExecutionOptions {
  progressSource?: 'generation' | 'canvas'
  requestId?: string
  /** 结果文件放进哪个容器的“生成结果”（画布所在项目或作品目录）；省略为作品目录“生成结果”。 */
  outputContainer?: DocumentContainerRef
  /** 宿主持有的业务任务信号；不传入模型参数或 IPC DTO。 */
  signal?: AbortSignal
}

interface PendingProgressSampleContext {
  startedAtMs: number
  params: DynamicValueMap
  source: 'generation' | 'canvas'
  estimate: AiProgressEstimateDto | null
}


/**
 * 生成失败：`message` 就是供应商或运行时给出的原因，可以直接展示给用户（任务 5.8）。
 * 原来抛 `Generation failed for <modelId>: <原因>`，克隆面板、画布节点等直接展示 error.message 的地方
 * 把英文前缀与模型 ID 带进了正式界面；模型 ID 已写进结构化日志，这里单独挂在 modelId 上。
 */
export class GenerationFailedError extends Error {
  readonly modelId: string
  readonly code?: string
  constructor(modelId: string, reason: string) {
    super(reason.replace(/\[provider_[a-z_]+\]\s*/gi, ''))
    this.name = 'GenerationFailedError'
    this.modelId = modelId
    this.code = /\[(provider_[a-z_]+)\]/i.exec(reason)?.[1].toUpperCase()
  }
}

export class GenerationService {
  private static instance: GenerationService | null = null

  private keyStatusCache: Map<string, boolean>
  private pendingProgressSamples: Map<string, PendingProgressSampleContext>
  private pendingConfirmations = new Map<string, AbortController>()

  private constructor() {
    this.keyStatusCache = new Map()
    this.pendingProgressSamples = new Map()
  }

  static getInstance(): GenerationService {
    if (!GenerationService.instance) {
      GenerationService.instance = new GenerationService()
    }
    return GenerationService.instance
  }

  private async dispatchCancellable<T>(taskId: string, signal: AbortSignal | undefined, dispatch: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    // 先发送正式请求，再发送取消，避免取消标记在请求初始化时被清除。
    const pending = dispatch()
    let rejectCancellation: ((reason: Error) => void) | undefined
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
    const cancel = (): void => { void this.cancelTask(taskId).catch(error => {
      logger.error('[GenerationService] 业务取消请求失败', error, { event: 'generation.cancel.signal_failed', taskId })
    }); rejectCancellation?.(new DOMException('本地生成已停止', 'AbortError')) }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    try { return await Promise.race([pending, cancelled]) } finally { signal?.removeEventListener('abort', cancel) }
  }

  async generate(
    modelId: string,
    params: DynamicValueMap,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    let progressTracker: ReturnType<typeof createProgressTracker> | null = null
    const requestId = options.requestId?.trim() || createRequestId(modelId)
    let sourceParams = params as DynamicValueMap
    const progressSource = options.progressSource ?? 'generation'
    const startedAtMs = Date.now()
    let paidExecution: GenerationPaidExecution | undefined
    let paidStarted = false
    let paidCompleted = false
    const paidApproved = consumeGenerationPaidApproval(requestId)

    try {
      options.signal?.throwIfAborted()
      const model = registry.getModel(modelId) ?? getControlledExecutionModel(modelId)
      if (!model) {
        throw new Error(`Model not found: ${modelId}`)
      }
      sourceParams = stripDerivedMediaState(sourceParams)

      if (model.submissionConfirmation?.condition(sourceParams) && !paidApproved) {
        // 等待确认期间界面可以继续编辑；只提交用户确认的这份快照。
        sourceParams = structuredClone(sourceParams)
        const controller = new AbortController()
        const abort = (): void => controller.abort()
        options.signal?.addEventListener('abort', abort, { once: true })
        this.pendingConfirmations.set(requestId, controller)
        if (options.signal?.aborted) abort()
        logger.info('等待用户确认提交', { event: 'generation.confirmation.requested', requestId, modelId })
        try {
          paidExecution = await confirmGenerationSubmission(model, sourceParams, controller.signal,
            options.outputContainer?.kind === 'project' ? options.outputContainer.projectId : undefined)
          logger.info('用户已确认提交', { event: 'generation.confirmation.accepted', requestId, modelId })
        } finally {
          options.signal?.removeEventListener('abort', abort)
          this.pendingConfirmations.delete(requestId)
        }
      }

      const estimate = await this.getProgressEstimate(modelId, sourceParams).catch((error) => {
        logger.warn('[GenerationService] 获取进度估算失败，回退本地默认', error)
        return null
      })
      const progressSpec = onProgress
        ? resolveProgressSpec(model, sourceParams, estimate?.durationMs)
        : null
      progressTracker = onProgress && progressSpec
        ? createProgressTracker(progressSpec, onProgress)
        : null
      progressTracker?.start()

      const normalized = await normalizeSmartAspectParams(model, sourceParams, requestId)
      const paramsWithCompressedVideo = await compressFirstVideoIfNeeded(model, normalized.params)
      const paramsWithTrimmedVideo = await trimFirstVideoIfSelected(paramsWithCompressedVideo)
      const paramsWithVideoDuration = await attachVideoDurations(paramsWithTrimmedVideo)
      const runtimeParams = attachUploadRuntimeParams(paramsWithVideoDuration)
      const preflightSummary = buildGeneratePreflightSummary(sourceParams, runtimeParams, normalized.report)
      logger.info('[GenerationService] 开始生成', {
        event: 'generation.generate.start',
        requestId,
        modelId,
        providerId: model.meta.provider,
        context: {
          preflight: preflightSummary,
          progressEstimate: estimate,
        },
      })

      options.signal?.throwIfAborted()
      if (paidExecution) { await paidExecution.start(); paidStarted = true }
      const response = await this.dispatchCancellable(requestId, options.signal, () => aiGenerate({
        modelId,
        params: runtimeParams,
        requestId,
        ...(options.outputContainer ? { outputContainer: options.outputContainer } : {}),
      }))
      if (paidExecution) { await paidExecution.complete(); paidCompleted = true }
      recordRuntimeTrace(modelId, runtimeParams, response.trace)
      await captureClonedVoice(modelId, model.meta.provider, response)

      if (response.status === 'pending') {
        if (response.taskId) {
          this.pendingProgressSamples.set(response.taskId, {
            startedAtMs,
            params: sourceParams,
            source: progressSource,
            estimate,
          })
        }
        logger.info('[GenerationService] 生成进入轮询', {
          event: 'generation.generate.pending',
          requestId,
          taskId: response.taskId,
          modelId,
          context: {
            metadata: response.metadata,
          },
        })
        progressTracker?.stop()
        return {
          status: response.status,
          taskId: response.taskId,
          urls: response.urls,
          filePaths: response.filePaths,
          createdFilePaths: response.createdFilePaths,
          metadata: response.metadata,
          structuredOutput: response.structuredOutput,
          trace: response.trace,
        }
      }

      if (response.status !== 'completed') {
        logger.error('[GenerationService] 生成失败状态', {
          event: 'generation.generate.invalid_status',
          requestId,
          taskId: response.taskId,
          modelId,
          context: {
            status: response.status,
            metadata: response.metadata,
          },
        })
        throw new Error(`Generation ${response.status}${formatFailedMetadata(response.metadata)}`)
      }

      const recorded = await this.recordProgressSample(modelId, sourceParams, startedAtMs, Date.now(), progressSource)
      logger.info('[GenerationService] 生成完成', {
        event: 'generation.generate.completed',
        requestId,
        taskId: response.taskId,
        modelId,
        providerId: model.meta.provider,
        context: {
          urlCount: response.urls.length,
          filePathCount: response.filePaths.length,
          progressTiming: buildProgressTimingContext(estimate, recorded),
        },
      })
      options.signal?.throwIfAborted()
      progressTracker?.complete()

      clearProviderAvailability(model.meta.provider, modelId)
      emitApplicationEvent('generation-completed', {
        modelId,
        providerId: model.meta.provider,
      })

      return {
        status: response.status,
        taskId: response.taskId,
        urls: response.urls,
        filePaths: response.filePaths,
        createdFilePaths: response.createdFilePaths,
        metadata: response.metadata,
        structuredOutput: response.structuredOutput,
        trace: response.trace,
      }
    } catch (error) {
      if (paidExecution && !paidCompleted) {
        try { await (paidStarted ? paidExecution.failed() : paidExecution.reject()) }
        catch (receiptError) { logger.error('生成费用回执保存失败', receiptError, { event: 'generation.paid_receipt.failed', requestId }) }
      }
      let message = getErrorMessage(error)
      if (options.signal?.aborted || error instanceof GenerationSubmissionCancelledError) {
        logger.info('[GenerationService] 本地生成已停止', { event: 'generation.generate.cancelled', requestId, modelId })
        progressTracker?.stop()
        throw error
      }
      const model = registry.getModel(modelId) ?? getControlledExecutionModel(modelId)
      const unavailable = model && rememberProviderFailure(model.meta.provider, modelId, getI18nText(model.meta.name, 'zh'), message)
      if (unavailable) message = `[${unavailable.code}] ${unavailable.message}`
      logger.error('[GenerationService] 生成异常', error, {
        event: 'generation.generate.failed',
        requestId,
        modelId,
        context: {
          message,
        },
      })
      progressTracker?.fail(message)
      throw new GenerationFailedError(modelId, message)
    }
  }

  async generateImage(
    modelId: string,
    params: DynamicValueMap,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress, options)
  }

  async generateVideo(
    modelId: string,
    params: DynamicValueMap,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress, options)
  }

  async generateAudio(
    modelId: string,
    params: DynamicValueMap,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress, options)
  }

  async continuePolling(
    modelId: string,
    taskId: string,
    params: DynamicValueMap = {},
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    let progressTracker: ReturnType<typeof createProgressTracker> | null = null
    const requestId = options.requestId?.trim() || createRequestId(`${modelId}-continue`)

    try {
      options.signal?.throwIfAborted()
      const runtimeParams = stripDerivedMediaState(params)
      const model = registry.getModel(modelId) ?? getControlledExecutionModel(modelId)
      const estimate = model
        ? await this.getProgressEstimate(modelId, runtimeParams).catch((error) => {
          logger.warn('[GenerationService] 获取继续轮询进度估算失败，回退本地默认', error)
          return null
        })
        : null
      const progressSpec = model && onProgress ? resolveProgressSpec(model, runtimeParams, estimate?.durationMs) : null
      progressTracker = onProgress && progressSpec
        ? createProgressTracker(progressSpec, onProgress)
        : null
      progressTracker?.start()

      logger.info('[GenerationService] 开始继续轮询', {
        event: 'generation.continue_polling.start',
        requestId,
        taskId,
        modelId,
      })

      const response = await this.dispatchCancellable(taskId, options.signal, () => aiContinuePolling({
        modelId,
        taskId,
        params: runtimeParams,
        requestId,
        ...(options.outputContainer ? { outputContainer: options.outputContainer } : {}),
      }))
      recordRuntimeTrace(modelId, runtimeParams, response.trace)
      if (model) await captureClonedVoice(modelId, model.meta.provider, response)

      if (response.status !== 'completed') {
        logger.error('[GenerationService] 继续轮询返回非完成状态', {
          event: 'generation.continue_polling.invalid_status',
          requestId,
          taskId,
          modelId,
          context: {
            status: response.status,
            metadata: response.metadata,
          },
        })
        throw new Error(`Continue polling ${response.status}${formatFailedMetadata(response.metadata)}`)
      }

      const pendingSample = this.pendingProgressSamples.get(taskId)
      const progressSource = pendingSample?.source ?? options.progressSource ?? 'generation'
      let recorded = null
      if (pendingSample) {
        recorded = await this.recordProgressSample(
          modelId,
          pendingSample.params,
          pendingSample.startedAtMs,
          Date.now(),
          progressSource
        )
        this.pendingProgressSamples.delete(taskId)
      }
      logger.info('[GenerationService] 继续轮询完成', {
        event: 'generation.continue_polling.completed',
        requestId,
        taskId: response.taskId || taskId,
        modelId,
        providerId: model?.meta.provider,
        context: {
          urlCount: response.urls.length,
          filePathCount: response.filePaths.length,
          progressTiming: buildProgressTimingContext(
            pendingSample?.estimate ?? estimate,
            recorded
          ),
        },
      })
      options.signal?.throwIfAborted()
      progressTracker?.complete()

      if (model) clearProviderAvailability(model.meta.provider, modelId)
      emitApplicationEvent('generation-completed', {
        modelId,
        providerId: model?.meta.provider,
      })

      return {
        status: response.status,
        taskId: response.taskId,
        urls: response.urls,
        filePaths: response.filePaths,
        createdFilePaths: response.createdFilePaths,
        metadata: response.metadata,
        structuredOutput: response.structuredOutput,
        trace: response.trace,
      }
    } catch (error) {
      let message = getErrorMessage(error)
      if (options.signal?.aborted) {
        logger.info('[GenerationService] 本地续查已停止', { event: 'generation.continue_polling.cancelled', requestId, taskId, modelId })
        progressTracker?.stop()
        throw error
      }
      const model = registry.getModel(modelId) ?? getControlledExecutionModel(modelId)
      const unavailable = model && rememberProviderFailure(model.meta.provider, modelId, getI18nText(model.meta.name, 'zh'), message)
      if (unavailable) message = `[${unavailable.code}] ${unavailable.message}`
      if (/\[(voice_training_failed|voice_not_found)\]/.test(message)) {
        try { await voiceLibraryService.markTaskFailed(taskId) }
        catch (storageError) { logger.warn('保存音色失败状态失败', storageError, { event: 'generation.voice_status.save_failed', taskId, modelId }) }
      }
      logger.error('[GenerationService] 继续轮询异常', error, {
        event: 'generation.continue_polling.failed',
        requestId,
        taskId,
        modelId,
        context: {
          message,
        },
      })
      progressTracker?.fail(message)
      throw new GenerationFailedError(modelId, message)
    }
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      await aiRemoveProviderApiKey(provider)
      clearProviderAvailability(provider)
      this.keyStatusCache.set(provider, false)
      return
    }

    await aiSetProviderApiKey(provider, trimmed)
    clearProviderAvailability(provider)
    this.keyStatusCache.set(provider, true)
  }

  async removeApiKey(provider: string): Promise<void> {
    await aiRemoveProviderApiKey(provider)
    clearProviderAvailability(provider)
    this.keyStatusCache.set(provider, false)
  }

  async validateApiKey(provider: string): Promise<boolean> {
    const statusList = await aiGetProviderKeyStatus()
    this.syncKeyStatusCache(statusList)
    return this.keyStatusCache.get(provider) === true
  }

  async getConfiguredProviders(): Promise<string[]> {
    const statusList = await aiGetProviderKeyStatus()
    this.syncKeyStatusCache(statusList)
    return statusList.filter((item) => item.configured).map((item) => item.providerId)
  }

  async cancelTask(taskId: string): Promise<void> {
    consumeGenerationPaidApproval(taskId)
    const confirmation = this.pendingConfirmations.get(taskId)
    if (confirmation) {
      confirmation.abort()
      return
    }
    logger.info('[GenerationService] 请求取消任务', {
      event: 'generation.cancel.start',
      taskId,
    })
    try {
      await aiCancelTask(taskId)
      this.pendingProgressSamples.delete(taskId)
      logger.info('[GenerationService] 取消任务完成', {
        event: 'generation.cancel.completed',
        taskId,
      })
    } catch (error) {
      logger.error('[GenerationService] 取消任务失败', error, {
        event: 'generation.cancel.failed',
        taskId,
      })
      throw error
    }
  }

  registerProviderFactory(
    _providerId: ProviderId,
    _factory: ProviderFactory,
    _options?: { overwrite?: boolean }
  ): void {
    if (import.meta.env.DEV) {
      logger.warn('[GenerationService] registerProviderFactory is deprecated in backend runtime mode')
    }
  }

  clearProviderCache(_provider?: string): void {
    // No-op: provider execution moved to backend runtime.
  }

  async getProgressEstimate(
    modelId: string,
    params: DynamicValueMap
  ): Promise<AiProgressEstimateDto | null> {
    try {
      return await aiGetProgressEstimate({
        modelId,
        params,
      })
    } catch (error) {
      logger.warn('[GenerationService] 读取后端进度估算失败', error, {
        event: 'generation.progress_estimate.failed',
        modelId,
      })
      return null
    }
  }

  private async recordProgressSample(
    modelId: string,
    params: DynamicValueMap,
    startedAtMs: number,
    finishedAtMs: number,
    source: 'generation' | 'canvas'
  ): Promise<AiRecordProgressSampleResponseDto | null> {
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs) || finishedAtMs <= startedAtMs) {
      return null
    }

    try {
      return await aiRecordProgressSample({
        modelId,
        params,
        startedAtMs,
        finishedAtMs,
        source,
      })
    } catch (error) {
      logger.warn('[GenerationService] 记录进度样本失败', error, {
        event: 'generation.progress_sample.failed',
        modelId,
        context: {
          startedAtMs,
          finishedAtMs,
          source,
        },
      })
      return null
    }
  }

  private syncKeyStatusCache(statusList: ProviderKeyStatusDto[]): void {
    this.keyStatusCache.clear()
    statusList.forEach((item) => {
      this.keyStatusCache.set(item.providerId, item.configured)
    })
  }

  static reset(): void {
    GenerationService.instance = null
  }

}

export const generationService = GenerationService.getInstance()
