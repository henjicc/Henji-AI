import { createLogger } from '@/core/logging'

const logger = createLogger('core.services.GenerationService')
/**
 * GenerationService - unified AI runtime gateway.
 *
 * Frontend only prepares model params and delegates execution to Rust backend.
 */

import { registry } from '@/core/ModelRegistry'
import { findSquareAspectValue, getAspectChoiceParams, isSmartAspectValue, resolveClosestAspectValue } from '@/core/params/ratioResolution'
import { createProgressTracker, resolveProgressSpec } from '@/core/progress/progressTracker'
import type { GenerateResult, ProgressStatus } from '@/core/providers/base'
import type { ModelDefinition, ProviderId } from '@/core/types'
import { UploadService } from '@/services/upload/UploadService'
import { recordApiTrace } from '@/utils/testMode'
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
  type AiGenerateResponseDto,
  type AiProgressEstimateDto,
  type ProviderKeyStatusDto,
} from '@/commands/aiRuntime'

/**
 * Backward-compatible type kept for API stability.
 */
export type ProviderFactory = never

export interface GenerationExecutionOptions {
  progressSource?: 'generation' | 'canvas'
}

interface PendingProgressSampleContext {
  startedAtMs: number
  params: Record<string, unknown>
  source: 'generation' | 'canvas'
  estimate: AiProgressEstimateDto | null
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    const trimmed = error.trim()
    return trimmed.length > 0 ? trimmed : 'Generation failed'
  }

  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim().length > 0) {
      return record.message
    }
  }

  return 'Generation failed'
}

function createRequestId(modelId: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${modelId}-${suffix}`
}

function attachUploadRuntimeParams(params: Record<string, unknown>): Record<string, unknown> {
  const uploadService = UploadService.getInstance()
  const next = {
    ...params,
    __upload_provider: uploadService.getCurrentProvider(),
    __upload_fallback: uploadService.isFallbackEnabled(),
  }
  logger.info('[GenerationService] 上传策略', {
    provider: next.__upload_provider,
    fallbackEnabled: next.__upload_fallback,
  })
  return next
}

function formatFailedMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return ''
  try {
    return `: ${JSON.stringify(metadata)}`
  } catch {
    return ''
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function getFirstImageSource(params: Record<string, unknown>): string | null {
  const candidates: unknown[] = [params.images, params.uploadedFilePaths]
  for (const candidate of candidates) {
    if (!isStringArray(candidate)) {
      continue
    }

    const first = candidate.find((item) => item.trim().length > 0)
    if (first) {
      return first
    }
  }

  return null
}

type SmartAspectResolveReason = 'reference-image' | 'fallback-square' | 'fallback-nearest'

interface SmartAspectAdjustment {
  paramId: string
  apiField?: string
  from?: string | number
  to: string | number
  reason: SmartAspectResolveReason
}

interface SmartAspectResolutionReport {
  totalSmartParams: number
  adjustments: SmartAspectAdjustment[]
  unresolvedParamIds: string[]
}

interface SmartAspectNormalizationResult {
  params: Record<string, unknown>
  report: {
    hasReferenceImage: boolean
    hasImageInput: boolean
    imageRatioReadFailed: boolean
    referenceImageRatio?: number
    totalSmartParams: number
    adjustments: SmartAspectAdjustment[]
    unresolvedParamIds: string[]
  }
}

interface ResolutionPreprocessSummary {
  mode: 'smart' | 'fixed' | 'unknown'
  aspectRatio?: string
  quality?: string
  width?: number
  height?: number
  ratioHint?: number
}

function resolveChoiceSmartAspectValues(
  model: ModelDefinition,
  params: Record<string, unknown>,
  hasReferenceImage: boolean,
  targetRatio: number
): SmartAspectResolutionReport {
  const aspectParams = getAspectChoiceParams(model.params)
  const adjustments: SmartAspectAdjustment[] = []
  const unresolvedParamIds: string[] = []
  let totalSmartParams = 0

  for (const aspectParam of aspectParams) {
    const currentValue = params[aspectParam.id] ?? (
      aspectParam.apiField ? params[aspectParam.apiField] : undefined
    )

    if (!isSmartAspectValue(currentValue)) {
      continue
    }
    totalSmartParams += 1

    let reason: SmartAspectResolveReason = hasReferenceImage ? 'reference-image' : 'fallback-square'
    let resolvedValue = hasReferenceImage
      ? resolveClosestAspectValue(aspectParam, targetRatio)
      : findSquareAspectValue(aspectParam)

    if (resolvedValue === null) {
      reason = 'fallback-nearest'
      resolvedValue = resolveClosestAspectValue(aspectParam, 1)
    }

    if (resolvedValue !== null) {
      const before = typeof currentValue === 'string' || typeof currentValue === 'number'
        ? currentValue
        : undefined
      params[aspectParam.id] = resolvedValue
      if (aspectParam.apiField) {
        params[aspectParam.apiField] = resolvedValue
      }
      adjustments.push({
        paramId: aspectParam.id,
        apiField: aspectParam.apiField,
        from: before,
        to: resolvedValue,
        reason,
      })
      continue
    }

    unresolvedParamIds.push(aspectParam.id)
  }

  return {
    totalSmartParams,
    adjustments,
    unresolvedParamIds,
  }
}

async function readImageRatio(imageSource: string): Promise<number | null> {
  if (typeof Image === 'undefined') {
    return null
  }

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image.naturalWidth / image.naturalHeight)
        return
      }
      resolve(null)
    }
    image.onerror = () => resolve(null)
    image.src = imageSource
  })
}

async function normalizeSmartAspectParams(
  model: ModelDefinition,
  params: Record<string, unknown>
): Promise<SmartAspectNormalizationResult> {
  const nextParams: Record<string, unknown> = { ...params }
  const firstImageSource = getFirstImageSource(nextParams)
  const hasImageInput = typeof firstImageSource === 'string' && firstImageSource.trim().length > 0
  const imageRatio = firstImageSource ? await readImageRatio(firstImageSource) : null
  const hasReferenceImage = imageRatio !== null && Number.isFinite(imageRatio) && imageRatio > 0
  const targetRatio = hasReferenceImage ? imageRatio : 1

  if (hasReferenceImage) {
    nextParams.__firstImageRatio = targetRatio
  } else {
    delete nextParams.__firstImageRatio
  }

  const report = resolveChoiceSmartAspectValues(model, nextParams, hasReferenceImage, targetRatio)

  return {
    params: nextParams,
    report: {
      hasReferenceImage,
      hasImageInput,
      imageRatioReadFailed: hasImageInput && !hasReferenceImage,
      referenceImageRatio: hasReferenceImage ? targetRatio : undefined,
      totalSmartParams: report.totalSmartParams,
      adjustments: report.adjustments,
      unresolvedParamIds: report.unresolvedParamIds,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function buildResolutionPreprocessSummary(
  sourceParams: Record<string, unknown>,
  runtimeParams: Record<string, unknown>
): ResolutionPreprocessSummary | null {
  const resolution = isRecord(sourceParams.resolution) ? sourceParams.resolution : null
  if (!resolution) {
    return null
  }

  const aspectRatio = getStringValue(resolution.aspectRatio)
  const quality = getStringValue(resolution.quality)
  const width = getNumberValue(resolution.width)
  const height = getNumberValue(resolution.height)
  const ratioHint = getNumberValue(runtimeParams.__firstImageRatio)

  if (aspectRatio === 'smart') {
    return {
      mode: 'smart',
      aspectRatio,
      quality,
      ratioHint,
    }
  }

  if (aspectRatio) {
    return {
      mode: 'fixed',
      aspectRatio,
      quality,
      width,
      height,
      ratioHint,
    }
  }

  return {
    mode: 'unknown',
    quality,
    width,
    height,
    ratioHint,
  }
}

function countNonEmptyStringItems(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0
  }
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0).length
}

function hasPromptInput(params: Record<string, unknown>): boolean {
  const candidates = [params.prompt, params.text]
  return candidates.some((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
}

function buildGeneratePreflightSummary(
  sourceParams: Record<string, unknown>,
  runtimeParams: Record<string, unknown>,
  normalization: SmartAspectNormalizationResult['report']
): Record<string, unknown> {
  const imagesCount = countNonEmptyStringItems(runtimeParams.images)
  const videosCount = countNonEmptyStringItems(runtimeParams.videos)
  const uploadedImagePathCount = countNonEmptyStringItems(runtimeParams.uploadedFilePaths)
  const uploadedVideoPathCount = countNonEmptyStringItems(runtimeParams.uploadedVideoFilePaths)
  const hasVideoInput = videosCount > 0 || uploadedVideoPathCount > 0 || typeof runtimeParams.video === 'string'
  const resolutionPreprocess = buildResolutionPreprocessSummary(sourceParams, runtimeParams)

  return {
    smartAspect: {
      totalSmartParams: normalization.totalSmartParams,
      hasReferenceImage: normalization.hasReferenceImage,
      hasImageInput: normalization.hasImageInput,
      imageRatioReadFailed: normalization.imageRatioReadFailed,
      referenceImageRatio: normalization.referenceImageRatio,
      adjustments: normalization.adjustments,
      unresolvedParamIds: normalization.unresolvedParamIds,
    },
    resolutionPreprocess,
    mediaInputs: {
      hasPrompt: hasPromptInput(sourceParams),
      imagesCount,
      videosCount,
      uploadedImagePathCount,
      uploadedVideoPathCount,
      hasVideoInput,
    },
    uploadStrategy: {
      provider: runtimeParams.__upload_provider,
      fallbackEnabled: runtimeParams.__upload_fallback === true,
    },
  }
}

function recordRuntimeTrace(
  modelId: string,
  params: Record<string, unknown>,
  trace: AiGenerateResponseDto['trace']
): void {
  if (!trace) {
    return
  }

  logger.info('[GenerationService] API原始响应(JSON)', {
    event: 'generation.runtime.response_json',
    requestId: trace.requestId,
    taskId: trace.taskId,
    modelId: trace.modelId || modelId,
    providerId: trace.providerId,
    context: {
      phase: trace.phase,
      route: trace.route,
      method: trace.method,
      responseBody: trace.responseBody,
    },
  })

  const prompt = typeof params.prompt === 'string'
    ? params.prompt
    : typeof params.text === 'string'
      ? params.text
      : undefined

  const model = registry.getModel(modelId)
  recordApiTrace({
    model: modelId,
    type: model?.meta.type,
    prompt,
    timestamp: new Date().toISOString(),
    trace
  })
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
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    let progressTracker: ReturnType<typeof createProgressTracker> | null = null
    const requestId = createRequestId(modelId)
    const sourceParams = params as Record<string, unknown>
    const progressSource = options.progressSource ?? 'generation'
    const startedAtMs = Date.now()

    try {
      const model = registry.getModel(modelId)
      if (!model) {
        throw new Error(`Model not found: ${modelId}`)
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

      const normalized = await normalizeSmartAspectParams(model, sourceParams)
      const runtimeParams = attachUploadRuntimeParams(normalized.params)
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
      recordRuntimeTrace(modelId, params, response.trace)

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
          metadata: response.metadata,
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
          progressTiming: this.buildProgressTimingContext(estimate, recorded),
        },
      })
      progressTracker?.complete()

      return {
        status: response.status,
        url: response.url,
        filePath: response.filePath,
        metadata: response.metadata,
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
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress, options)
  }

  async generateVideo(
    modelId: string,
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress, options)
  }

  async generateAudio(
    modelId: string,
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    return this.generate(modelId, params, onProgress, options)
  }

  async continuePolling(
    modelId: string,
    taskId: string,
    params: Record<string, unknown> = {},
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    let progressTracker: ReturnType<typeof createProgressTracker> | null = null
    const requestId = createRequestId(`${modelId}-continue`)

    try {
      const model = registry.getModel(modelId)
      const estimate = model
        ? await this.getProgressEstimate(modelId, params).catch((error) => {
          logger.warn('[GenerationService] 获取继续轮询进度估算失败，回退本地默认', error)
          return null
        })
        : null
      const progressSpec = model && onProgress ? resolveProgressSpec(model, params, estimate?.durationMs) : null
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
        params,
      })
      recordRuntimeTrace(modelId, params, response.trace)

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
          progressTiming: this.buildProgressTimingContext(
            pendingSample?.estimate ?? estimate,
            recorded
          ),
        },
      })
      progressTracker?.complete()

      return {
        status: response.status,
        taskId: response.taskId,
        url: response.url,
        filePath: response.filePath,
        metadata: response.metadata,
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
    params: Record<string, unknown>
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
    params: Record<string, unknown>,
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

  private buildProgressTimingContext(
    estimate: AiProgressEstimateDto | null,
    recorded: AiRecordProgressSampleResponseDto | null
  ): Record<string, unknown> {
    return {
      estimatedDurationMs: estimate?.durationMs,
      estimatedSource: estimate?.source,
      actualDurationMs: recorded?.actualDurationMs,
      timeBucket: recorded?.estimate.timeBucket ?? estimate?.timeBucket,
      globalSampleCount: recorded?.estimate.globalSampleCount ?? estimate?.globalSampleCount,
      bucketSampleCount: recorded?.estimate.bucketSampleCount ?? estimate?.bucketSampleCount,
      defaultDurationMs: recorded?.estimate.defaultDurationMs ?? estimate?.defaultDurationMs,
      globalEstimateMs: recorded?.estimate.globalEstimateMs ?? estimate?.globalEstimateMs,
      bucketEstimateMs: recorded?.estimate.bucketEstimateMs ?? estimate?.bucketEstimateMs,
      recentGlobalDurationsMs: recorded?.estimate.recentGlobalDurationsMs ?? estimate?.recentGlobalDurationsMs,
      recentBucketDurationsMs: recorded?.estimate.recentBucketDurationsMs ?? estimate?.recentBucketDurationsMs,
    }
  }
}

export const generationService = GenerationService.getInstance()

