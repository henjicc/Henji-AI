import { cropImageSource, readImageInfo } from '@/commands/image'
import { compressVideoToFit, trimVideoSource } from '@/commands/video'
import { createLogger } from '@/core/logging'
import type { ModelDefinition } from '@/core/types'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import {
  findSquareAspectValue,
  getAspectChoiceParams,
  isSmartAspectValue,
  resolveClosestAspectValue,
  resolveLeastCropAspectValue,
} from '@/core/params/ratioResolution'
import { UploadService } from '@/services/upload/UploadService'
import { resolveGenerationVideoSources } from './generationVideoDurations'

const logger = createLogger('core.services.GenerationService')

export function getErrorMessage(error: DynamicValue): string {
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

export function createRequestId(modelId: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${modelId}-${suffix}`
}

export function attachUploadRuntimeParams(params: DynamicValueMap): DynamicValueMap {
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

export function formatFailedMetadata(metadata: DynamicValueMap | undefined): string {
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

function getFirstImageSource(params: DynamicValueMap, model: ModelDefinition): string | null {
  const candidates: DynamicValue[] = [params.uploadedFilePaths, params.images, params.uploadedImages,
    ...model.params.filter((param) => param.type === 'image-upload').map((param) => params[param.id])]
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
  return resolveGenerationVideoSources(params)[0] ?? null
}

function replaceVideoSourceInParams(
  params: DynamicValueMap,
  oldSource: string,
  newSource: string,
): DynamicValueMap {
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
 * 压缩耗时由已经启动的任务进度条覆盖，用户感知更“无感”。
 */
export async function compressFirstVideoIfNeeded(
  model: ModelDefinition,
  params: DynamicValueMap,
): Promise<DynamicValueMap> {
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
 * 生成提交时再应用用户选择的视频裁剪区间，避免上传阶段产生昂贵处理。
 */
export async function trimFirstVideoIfSelected(
  params: DynamicValueMap,
): Promise<DynamicValueMap> {
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

export interface SmartAspectNormalizationResult {
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

function resolveChoiceSmartAspectValues(
  model: ModelDefinition,
  params: DynamicValueMap,
  hasReferenceImage: boolean,
  targetRatio: number,
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

async function readSourceImageInfo(imageSource: string): Promise<{ width: number; height: number } | null> {
  try {
    const info = await readImageInfo(imageSource)
    if (Number.isFinite(info.width) && Number.isFinite(info.height) && info.width > 0 && info.height > 0) {
      const swapsAxes = info.orientation !== null && info.orientation >= 5 && info.orientation <= 8
      return swapsAxes ? { width: info.height, height: info.width } : info
    }
    return null
  } catch {
    return null
  }
}

export async function normalizeSmartAspectParams(
  model: ModelDefinition,
  params: DynamicValueMap,
  requestId?: string,
): Promise<SmartAspectNormalizationResult> {
  const nextParams: DynamicValueMap = { ...params }
  const firstImageSource = getFirstImageSource(nextParams, model)
  const hasImageInput = typeof firstImageSource === 'string' && firstImageSource.trim().length > 0
  const info = firstImageSource ? await readSourceImageInfo(firstImageSource) : null
  const imageRatio = info ? info.width / info.height : null
  const hasReferenceImage = imageRatio !== null && Number.isFinite(imageRatio) && imageRatio > 0
  const targetRatio = hasReferenceImage ? imageRatio : 1

  if (hasReferenceImage) {
    nextParams.__firstImageRatio = targetRatio
  } else {
    delete nextParams.__firstImageRatio
  }

  const report = resolveChoiceSmartAspectValues(model, nextParams, hasReferenceImage, targetRatio)

  if (model.sourceImageFraming) {
    const context = { requestId, modelId: model.meta.id, providerId: model.meta.provider }
    logger.info('匹配源图画幅', { ...context, event: 'generation.source_framing.start' })
    try {
      if (!firstImageSource || !info || !hasReferenceImage) {
        throw new Error('无法读取输入图片尺寸，请重新选择图片后重试，避免按错误比例生成。')
      }
      const param = getAspectChoiceParams(model.params)
        .find((choice) => choice.id === model.sourceImageFraming?.aspectParamId)
      const matched = param ? resolveLeastCropAspectValue(param, targetRatio) : null
      if (!param || typeof matched !== 'string' || !/^\d+:\d+$/.test(matched)) {
        throw new Error('当前模型缺少可匹配的输出比例，无法保持输入图片比例。')
      }
      const [width, height] = matched.split(':').map(Number)
      const outputRatio = width / height
      // 一像素内的舍入误差无需重编码；其余情况只裁剪，不改变像素的横纵比例。
      const cropped = Math.abs(targetRatio - outputRatio) > 1 / info.height
      const preparedSource = cropped
        ? await cropImageSource({ source: firstImageSource, aspectRatio: matched })
        : firstImageSource
      const imageKeys = new Set(['uploadedFilePaths', 'images', 'uploadedImages',
        ...model.params.filter((entry) => entry.type === 'image-upload').map((entry) => entry.id)])
      for (const key of imageKeys) {
        const value = nextParams[key]
        if (isStringArray(value)) {
          nextParams[key] = value.map((source) => source === firstImageSource ? preparedSource : source)
        }
      }
      // 即使旧工程保存了一个固定比例，也必须依据这次的源图重新匹配。
      nextParams[param.id] = matched
      if (param.apiField) nextParams[param.apiField] = matched
      nextParams.__firstImageRatio = outputRatio
      report.adjustments = report.adjustments.filter((entry) => entry.paramId !== param.id)
      report.adjustments.push({ paramId: param.id, apiField: param.apiField,
        from: typeof params[param.id] === 'string' ? params[param.id] as string : undefined,
        to: matched, reason: 'reference-image' })
      report.unresolvedParamIds = report.unresolvedParamIds.filter((id) => id !== param.id)
      logger.info('源图画幅匹配完成', { ...context, event: 'generation.source_framing.completed',
        context: { sourceWidth: info.width, sourceHeight: info.height, aspectRatio: matched, cropped,
          retainedArea: Math.min(targetRatio / outputRatio, outputRatio / targetRatio) } })
    } catch (error) {
      logger.error('源图画幅匹配失败', error, { ...context, event: 'generation.source_framing.failed' })
      throw error
    }
  }

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
