import type { JsonValue, JsonObject } from '../../types/runtime'

/**
 * 魔搭 API-Inference 的图像生成提交路由。
 * 曾误用 KIE 的 `/api/v1/jobs/createTask`（同一次批量改动里复制串了供应商），
 * 官方文档与每个模型页的示例代码统一都是这一条。
 */
export const MODELSCOPE_CREATE_TASK_ENDPOINT = '/v1/images/generations'

export const MODELSCOPE_ASPECT_RATIO_OPTIONS = [
  { value: '21:9' },
  { value: '16:9' },
  { value: '3:2' },
  { value: '4:3' },
  { value: '1:1' },
  { value: '3:4' },
  { value: '2:3' },
  { value: '9:16' },
  { value: '9:21' }
]

const DEFAULT_BASE_SIZE = 1024
const BASE_SIZE_STEP = 8

/**
 * 官方按模型族给出的 `size` 边界，超出会被接口拒绝：
 * SD 系列 [64, 2048]、FLUX [64, 1024]、Qwen-Image [64, 1664]、Z-Image [512, 2048]。
 * 不能对所有模型共用一组上下界。
 */
export const MODELSCOPE_DEFAULT_SIZE_BOUNDS = { min: 64, max: 2048 } as const

export interface ModelscopeSizeBounds {
  min: number
  max: number
}

interface ResolutionSize {
  width: number
  height: number
}

/**
 * Qwen-Image-Edit-2509 专用分辨率计算（不使用基数系统，每个比例自动计算 [64, 2048] 范围内的最佳值）。
 * 原实现在应用侧 `src/utils/qwenResolutionCalculator.ts`，这里内联一份纯函数副本——
 * 该文件同时被 UI 组件 `UniversalResolutionSelector.tsx` 消费，SDK 不能反向依赖 `@/utils`，
 * 只搬运 `resolveModelscopeSize` 实际用到的这一个函数（不含 logger 的批量/展示层变体）。
 */
function calculateQwenResolution(widthRatio: number, heightRatio: number): ResolutionSize {
  const MIN_SIZE = 64
  const MAX_SIZE = 2048
  const STEP = 8

  if (widthRatio === heightRatio) {
    return { width: MAX_SIZE, height: MAX_SIZE }
  }

  const ratio = widthRatio / heightRatio
  let width: number
  let height: number

  if (ratio > 1) {
    width = MAX_SIZE
    height = width / ratio
    if (height < MIN_SIZE) {
      height = MIN_SIZE
      width = height * ratio
    }
  } else {
    height = MAX_SIZE
    width = height * ratio
    if (width < MIN_SIZE) {
      width = MIN_SIZE
      height = width / ratio
    }
  }

  const finalWidth = Math.floor(width / STEP) * STEP
  const finalHeight = Math.floor(height / STEP) * STEP

  return {
    width: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalWidth)),
    height: Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalHeight))
  }
}

/** 原实现在应用侧 `src/utils/resolutionCalculator.ts`，同理只搬运用到的两个函数。 */
function calculateResolution(baseSize: number, widthRatio: number, heightRatio: number): ResolutionSize {
  if (widthRatio === heightRatio) {
    return { width: baseSize, height: baseSize }
  }
  const maxPixels = baseSize * baseSize
  const ratio = widthRatio / heightRatio
  const height = Math.sqrt(maxPixels / ratio)
  const width = height * ratio
  const finalWidth = Math.floor(width / 8) * 8
  const finalHeight = Math.floor(height / 8) * 8
  return { width: finalWidth, height: finalHeight }
}

function normalizeBaseSize(baseSize: number, min = 512, max = 2048, step = 8): number {
  let normalized = Math.max(min, Math.min(max, baseSize))
  normalized = Math.round(normalized / step) * step
  return normalized
}

function calculateResolutionWithBounds(
  baseSize: number,
  widthRatio: number,
  heightRatio: number,
  minSize = 64,
  maxSize = 2048
): ResolutionSize {
  let { width, height } = calculateResolution(baseSize, widthRatio, heightRatio)

  const maxDimension = Math.max(width, height)
  const minDimension = Math.min(width, height)

  if (maxDimension > maxSize) {
    const scale = maxSize / maxDimension
    width = Math.floor((width * scale) / 16) * 16
    height = Math.floor((height * scale) / 16) * 16
  }

  if (minDimension < minSize) {
    const scale = minSize / minDimension
    width = Math.floor((width * scale) / 16) * 16
    height = Math.floor((height * scale) / 16) * 16
  }

  width = Math.max(minSize, Math.min(maxSize, width))
  height = Math.max(minSize, Math.min(maxSize, height))
  width = Math.floor(width / 16) * 16
  height = Math.floor(height / 16) * 16

  return { width, height }
}

export function resolveModelscopeSize(
  modelId: string,
  imageSize?: string,
  baseSize?: number,
  bounds: ModelscopeSizeBounds = MODELSCOPE_DEFAULT_SIZE_BOUNDS
): string | undefined {
  if (!imageSize) return undefined

  if (imageSize.includes('x')) {
    return imageSize
  }

  const ratio = imageSize === 'smart' || imageSize === 'auto' || imageSize === '自定义'
    ? '1:1'
    : imageSize

  if (!ratio.includes(':')) return undefined

  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return undefined

  if (modelId === 'Qwen/Qwen-Image-Edit-2509') {
    const size = calculateQwenResolution(w, h)
    return `${size.width}x${size.height}`
  }

  const normalizedBase = normalizeBaseSize(
    Number(baseSize || DEFAULT_BASE_SIZE),
    bounds.min,
    bounds.max,
    BASE_SIZE_STEP
  )

  const size = calculateResolutionWithBounds(normalizedBase, w, h, bounds.min, bounds.max)
  return `${size.width}x${size.height}`
}

/** ModelScope 请求构建的唯一实现，catalog builder 与主进程直接调用本函数。 */
export function buildModelscopeRequest(
  params: JsonObject,
  options: {
    modelId: string
    allowGuidance?: boolean
    allowNegativePrompt?: boolean
    allowImage?: boolean
    baseSize?: number
    sizeBounds?: ModelscopeSizeBounds
  }
): JsonObject {
  const prompt = typeof params.prompt === 'string' ? params.prompt : ''
  const request: JsonObject = {
    model: options.modelId,
    prompt
  }

  const sizeParam = typeof params.size === 'string' ? params.size : undefined
  const imageSizeParam =
    typeof params.modelscopeImageSize === 'string'
      ? params.modelscopeImageSize
      : (typeof params.image_size === 'string'
        ? params.image_size
        : (typeof params.aspect_ratio === 'string' ? params.aspect_ratio : undefined))

  const baseSizeParam = typeof params.resolutionBaseSize === 'number'
    ? params.resolutionBaseSize
    : (typeof options.baseSize === 'number' ? options.baseSize : undefined)

  const sizeValue =
    sizeParam ||
    resolveModelscopeSize(
      options.modelId,
      imageSizeParam,
      baseSizeParam,
      options.sizeBounds ?? MODELSCOPE_DEFAULT_SIZE_BOUNDS
    )

  if (sizeValue) {
    request.size = sizeValue
  }

  const steps = (params.modelscopeSteps ?? params.steps) as number | undefined
  if (steps !== undefined) {
    request.steps = steps
  }

  if (options.allowNegativePrompt !== false && typeof params.modelscopeNegativePrompt === 'string') {
    request.negative_prompt = params.modelscopeNegativePrompt
  }

  const guidance = params.modelscopeGuidance as number | undefined
  if (options.allowGuidance !== false && guidance !== undefined) {
    request.guidance = guidance
  }

  const seed = params.seed as number | undefined
  if (seed !== undefined) {
    request.seed = seed
  }

  if (options.allowImage) {
    const filterSources = (value: JsonValue): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
    const uploaded = filterSources(params.uploadedFilePaths)
    const images = uploaded.length > 0
      ? uploaded
      : (Array.isArray(params.image_url) ? params.image_url : filterSources(params.images))

    if (images.length > 0) {
      request.image_url = images
    }
  }

  return request
}
