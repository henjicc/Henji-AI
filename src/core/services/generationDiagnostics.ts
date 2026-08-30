import { registry } from '@/core/ModelRegistry'
import { getControlledExecutionModel } from '@/core/modelCatalog/controlledExecutionModels'
import type {
  AiGenerateResponseDto,
  AiProgressEstimateDto,
  AiRecordProgressSampleResponseDto,
} from '@/commands/aiRuntime'
import { recordApiTrace } from '@/utils/testMode'
import type { SmartAspectNormalizationResult } from './generationRequestPreflight'

interface ResolutionPreprocessSummary {
  mode: 'smart' | 'fixed' | 'DynamicValue'
  aspectRatio?: string
  quality?: string
  width?: number
  height?: number
  ratioHint?: number
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
  runtimeParams: DynamicValueMap,
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

export function buildGeneratePreflightSummary(
  sourceParams: DynamicValueMap,
  runtimeParams: DynamicValueMap,
  normalization: SmartAspectNormalizationResult['report'],
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

export function recordRuntimeTrace(
  modelId: string,
  params: DynamicValueMap,
  trace: AiGenerateResponseDto['trace'],
): void {
  if (!trace) {
    return
  }

  // 主进程已经用同一份 trace 落盘；渲染层仅保留测试模式的 opt-in 调试通道。
  const prompt = typeof params.prompt === 'string'
    ? params.prompt
    : typeof params.text === 'string'
      ? params.text
      : undefined

  const model = registry.getModel(modelId) ?? getControlledExecutionModel(modelId)
  recordApiTrace({
    model: modelId,
    type: model?.meta.type,
    prompt,
    timestamp: new Date().toISOString(),
    trace,
  })
}

export function buildProgressTimingContext(
  estimate: AiProgressEstimateDto | null,
  recorded: AiRecordProgressSampleResponseDto | null,
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
