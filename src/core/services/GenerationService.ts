import { createLogger } from '@/core/logging'
import { emitApplicationEvent } from '@/core/events/applicationEvents'

const logger = createLogger('core.services.GenerationService')
/**
 * GenerationService - unified AI runtime gateway.
 *
 * Frontend only prepares model params and delegates execution to the Electron backend.
 */

import { registry } from '@/core/ModelRegistry'
import { getMultiAngleExecutionModel } from '@/core/modelCatalog/multiAngleExecutionModels'
import { findSquareAspectValue, getAspectChoiceParams, isSmartAspectValue, resolveClosestAspectValue } from '@/core/params/ratioResolution'
import { createProgressTracker, resolveProgressSpec } from '@/core/progress/progressTracker'
import type { GenerateResult, ProgressStatus } from '@/core/providers/base'
import type { ModelDefinition, ProviderId } from '@/core/types'
import { UploadService } from '@/services/upload/UploadService'
import { readImageInfo } from '@/commands/image'
import { compressVideoToFit, readVideoInfo, trimVideoSource } from '@/commands/video'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { stripDerivedMediaState } from '@/core/params/derivedMediaState'
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
  params: DynamicValueMap
  source: 'generation' | 'canvas'
  estimate: AiProgressEstimateDto | null
}

function getErrorMessage(error: DynamicValue): string {
  if (typeof error === 'string') {
    const trimmed = error.trim()
    return trimmed.length > 0 ? trimmed : 'Generation failed'
  }

  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as DynamicValueMap
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

function attachUploadRuntimeParams(params: DynamicValueMap): DynamicValueMap {
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

function formatFailedMetadata(metadata: DynamicValueMap | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return ''
  try {
    return `: ${JSON.stringify(metadata)}`
  } catch {
    return ''
  }
}

function isStringArray(value: DynamicValue): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function getFirstImageSource(params: DynamicValueMap): string | null {
  const candidates: DynamicValue[] = [params.images, params.uploadedFilePaths]
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

function getFirstVideoSource(params: DynamicValueMap): string | null {
  const candidates: DynamicValue[] = [params.uploadedVideoFilePaths, params.videos]
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

function replaceVideoSourceInParams(params: DynamicValueMap, oldSource: string, newSource: string): DynamicValueMap {
  const next = { ...params }
  for (const key of ['uploadedVideoFilePaths', 'videos'] as const) {
    const candidate = next[key]
    if (!isStringArray(candidate)) {
      continue
    }
    const index = candidate.indexOf(oldSource)
    if (index === -1) {
      continue
    }
    const updated = [...candidate]
    updated[index] = newSource
    next[key] = updated
  }
  return next
}

/**
 * 体积超限的视频在生成提交时压缩，而不是上传时拦截/拒绝：上传体验保持即时，
 * 压缩耗时由已经启动的任务进度条覆盖，用户感知更"无感"。已在限制内时
 * compressVideoToFit 内部直接短路返回原路径，这里不会产生多余开销。
 */
async function compressFirstVideoIfNeeded(model: ModelDefinition, params: DynamicValueMap): Promise<DynamicValueMap> {
  const firstVideoSource = getFirstVideoSource(params)
  if (!firstVideoSource) {
    return params
  }

  const limits = resolveInputLimits(model.meta.id, params)
  const maxSizeMB = limits.videoConstraints?.maxSizeMB
  if (!maxSizeMB) {
    return params
  }

  try {
    const compressed = await compressVideoToFit(firstVideoSource, maxSizeMB)
    if (compressed.path === firstVideoSource) {
      return params
    }
    return replaceVideoSourceInParams(params, firstVideoSource, compressed.path)
  } catch (error) {
    logger.warn('[GenerationService] 视频压缩失败，使用原始文件继续生成', error)
    return params
  }
}

/**
 * 裁剪窗口确认时只记录用户选中的 [start, end]（uploadedVideoTrimStart/End），不立即跑 ffmpeg；
 * 真正切出这段画面发生在这里——生成提交那一刻，藏在已经在走的任务进度条后面。
 * 作用在 compressFirstVideoIfNeeded 之后（即已压缩、关键帧已铺密的版本上），裁剪可以一直
 * 用代价极低的流复制，且能精确卡在用户选的秒数上。trimVideoSource 内部已有哈希缓存，
 * 同一个源 + 同一段 [start,end] 重复提交（如改了别的参数再生成一次）不会重复编码。
 */
async function trimFirstVideoIfSelected(params: DynamicValueMap): Promise<DynamicValueMap> {
  const start = params.uploadedVideoTrimStart
  const end = params.uploadedVideoTrimEnd
  if (typeof start !== 'number' || typeof end !== 'number' || !(end > start)) {
    return params
  }

  const source = getFirstVideoSource(params)
  if (!source) {
    return params
  }

  try {
    const result = await trimVideoSource(source, start, end)
    return replaceVideoSourceInParams(params, source, result.path)
  } catch (error) {
    logger.warn('[GenerationService] 视频裁剪失败，使用未裁剪版本继续生成', error)
    return params
  }
}

async function readVideoDurationSeconds(videoSource: string): Promise<number | null> {
  try {
    const info = await readVideoInfo(videoSource)
    return info.durationSeconds > 0 ? info.durationSeconds : null
  } catch {
    return null
  }
}

/**
 * request.builder 在 Node VM 中执行、无法读取真实视频时长；这里在生成前统一探测
 * "第一个视频输入"的真实时长，写入 __firstVideoDurationSeconds，供需要 start/end
 * 截取秒数的视频模型（如 Gemini Omni 的 video_list）直接读取，而不必各自重复探测。
 */
async function attachFirstVideoDuration(params: DynamicValueMap): Promise<DynamicValueMap> {
  const firstVideoSource = getFirstVideoSource(params)
  if (!firstVideoSource) {
    if (params.__firstVideoDurationSeconds === undefined) {
      return params
    }
    const next = { ...params }
    delete next.__firstVideoDurationSeconds
    return next
  }

  const durationSeconds = await readVideoDurationSeconds(firstVideoSource)
  if (durationSeconds === null) {
    return params
  }
  return { ...params, __firstVideoDurationSeconds: durationSeconds }
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
  params: DynamicValueMap
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
  mode: 'smart' | 'fixed' | 'DynamicValue'
  aspectRatio?: string
  quality?: string
  width?: number
  height?: number
  ratioHint?: number
}

function resolveChoiceSmartAspectValues(
  model: ModelDefinition,
  params: DynamicValueMap,
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
  try {
    const info = await readImageInfo(imageSource)
    if (info.width > 0 && info.height > 0) {
      return info.width / info.height
    }
    return null
  } catch {
    return null
  }
}

async function normalizeSmartAspectParams(
  model: ModelDefinition,
  params: DynamicValueMap
): Promise<SmartAspectNormalizationResult> {
  const nextParams: DynamicValueMap = { ...params }
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

function isRecord(value: DynamicValue): value is DynamicValueMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getNumberValue(value: DynamicValue): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getStringValue(value: DynamicValue): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function buildResolutionPreprocessSummary(
  sourceParams: DynamicValueMap,
  runtimeParams: DynamicValueMap
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
    mode: 'DynamicValue',
    quality,
    width,
    height,
    ratioHint,
  }
}

function countNonEmptyStringItems(value: DynamicValue): number {
  if (!Array.isArray(value)) {
    return 0
  }
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0).length
}

function hasPromptInput(params: DynamicValueMap): boolean {
  const candidates = [params.prompt, params.text]
  return candidates.some((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
}

function buildGeneratePreflightSummary(
  sourceParams: DynamicValueMap,
  runtimeParams: DynamicValueMap,
  normalization: SmartAspectNormalizationResult['report']
): DynamicValueMap {
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
  params: DynamicValueMap,
  trace: AiGenerateResponseDto['trace']
): void {
  if (!trace) {
    return
  }

  // 主进程（ai-runtime/runtime.ts）已经用同一份 trace 直接落盘 generation.runtime.response_json，
  // 渲染层不再重复记录——独立日志窗口（2.1）通过 henji://log-event 实时订阅主进程权威事件。
  // 这里只保留 recordApiTrace()：测试模式下 opt-in 的独立调试通道（api.trace），语义与用途
  // 都和统一日志事件不同，不属于本次删除范围（1.2/1.3 决策已确立，见 decisions.md）。

  const prompt = typeof params.prompt === 'string'
    ? params.prompt
    : typeof params.text === 'string'
      ? params.text
      : undefined

  const model = registry.getModel(modelId) ?? getMultiAngleExecutionModel(modelId)
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
    params: DynamicValueMap,
    onProgress?: (status: ProgressStatus) => void,
    options: GenerationExecutionOptions = {}
  ): Promise<GenerateResult> {
    let progressTracker: ReturnType<typeof createProgressTracker> | null = null
    const requestId = createRequestId(modelId)
    let sourceParams = params as DynamicValueMap
    const progressSource = options.progressSource ?? 'generation'
    const startedAtMs = Date.now()

    try {
      const model = registry.getModel(modelId) ?? getMultiAngleExecutionModel(modelId)
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
      const paramsWithVideoDuration = await attachFirstVideoDuration(paramsWithTrimmedVideo)
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

      emitApplicationEvent('generation-completed', {
        modelId,
        providerId: model.meta.provider,
      })

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
    const requestId = createRequestId(`${modelId}-continue`)

    try {
      const runtimeParams = stripDerivedMediaState(params)
      const model = registry.getModel(modelId) ?? getMultiAngleExecutionModel(modelId)
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
          progressTiming: this.buildProgressTimingContext(
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

  private buildProgressTimingContext(
    estimate: AiProgressEstimateDto | null,
    recorded: AiRecordProgressSampleResponseDto | null
  ): DynamicValueMap {
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
