import { createLogger } from '@/core/logging'
import { emitApplicationEvent } from '@/core/events/applicationEvents'

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
import type { ProviderId } from '@/core/types'
import { stripDerivedMediaState } from '@/core/params/derivedMediaState'
import { attachVideoDurations } from './generationVideoDurations'
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
}

interface PendingProgressSampleContext {
  startedAtMs: number
  params: DynamicValueMap
  source: 'generation' | 'canvas'
  estimate: AiProgressEstimateDto | null
}


export class GenerationService {
  private static instance: GenerationService | null = null

  private keyStatusCache: Map<string, boolean>
  private pendingProgressSamples: Map<string, PendingProgressSampleContext>

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

    try {
      const model = registry.getModel(modelId) ?? getControlledExecutionModel(modelId)
      if (!model) {
        throw new Error(`Model not found: ${modelId}`)
      }
      sourceParams = stripDerivedMediaState(sourceParams)

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

      const normalized = await normalizeSmartAspectParams(model, sourceParams)
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

      const response = await aiGenerate({
        modelId,
        params: runtimeParams,
        requestId,
      })
      recordRuntimeTrace(modelId, runtimeParams, response.trace)

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
          url: response.url,
          filePath: response.filePath,
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
          hasUrl: Boolean(response.url),
          hasFilePath: Boolean(response.filePath),
          progressTiming: buildProgressTimingContext(estimate, recorded),
        },
      })
      progressTracker?.complete()

      emitApplicationEvent('generation-completed', {
        modelId,
        providerId: model.meta.provider,
      })

      return {
        status: response.status,
        url: response.url,
        filePath: response.filePath,
        createdFilePaths: response.createdFilePaths,
        metadata: response.metadata,
        structuredOutput: response.structuredOutput,
        trace: response.trace,
      }
    } catch (error) {
      const message = getErrorMessage(error)
      logger.error('[GenerationService] 生成异常', error, {
        event: 'generation.generate.failed',
        requestId,
        modelId,
        context: {
          message,
        },
      })
      progressTracker?.fail(message)
      throw new Error(`Generation failed for ${modelId}: ${message}`)
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

      const response = await aiContinuePolling({
        modelId,
        taskId,
        params: runtimeParams,
        requestId,
      })
      recordRuntimeTrace(modelId, runtimeParams, response.trace)

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
          hasUrl: Boolean(response.url),
          hasFilePath: Boolean(response.filePath),
          progressTiming: buildProgressTimingContext(
            pendingSample?.estimate ?? estimate,
            recorded
          ),
        },
      })
      progressTracker?.complete()

      emitApplicationEvent('generation-completed', {
        modelId,
        providerId: model?.meta.provider,
      })

      return {
        status: response.status,
        taskId: response.taskId,
        url: response.url,
        filePath: response.filePath,
        createdFilePaths: response.createdFilePaths,
        metadata: response.metadata,
        structuredOutput: response.structuredOutput,
        trace: response.trace,
      }
    } catch (error) {
      const message = getErrorMessage(error)
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
      throw new Error(`Continue polling failed for ${modelId}: ${message}`)
    }
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      await aiRemoveProviderApiKey(provider)
      this.keyStatusCache.set(provider, false)
      return
    }

    await aiSetProviderApiKey(provider, trimmed)
    this.keyStatusCache.set(provider, true)
  }

  async removeApiKey(provider: string): Promise<void> {
    await aiRemoveProviderApiKey(provider)
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
