import { calculateQwenResolution } from '@/utils/qwenResolutionCalculator'
import { calculateResolutionWithBounds, normalizeBaseSize } from '@/utils/resolutionCalculator'

export const MODELSCOPE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask'

export const MODELSCOPE_ASPECT_RATIO_OPTIONS = [
  { value: '21:9', label: '21:9' },
  { value: '16:9', label: '16:9' },
  { value: '3:2', label: '3:2' },
  { value: '4:3', label: '4:3' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '2:3', label: '2:3' },
  { value: '9:16', label: '9:16' },
  { value: '9:21', label: '9:21' }
]

const DEFAULT_BASE_SIZE = 1024
const BASE_SIZE_MIN = 512
const BASE_SIZE_MAX = 2048
const BASE_SIZE_STEP = 8

export function resolveModelscopeSize(
  modelId: string,
  imageSize?: string,
  baseSize?: number
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
    BASE_SIZE_MIN,
    BASE_SIZE_MAX,
    BASE_SIZE_STEP
  )

  const size = calculateResolutionWithBounds(normalizedBase, w, h, 64, 2048)
  return `${size.width}x${size.height}`
}

export function buildModelscopeRequest(
  params: Record<string, unknown>,
  options: {
    modelId: string
    allowGuidance?: boolean
    allowNegativePrompt?: boolean
    allowImage?: boolean
    baseSize?: number
  }
): Record<string, unknown> {
  const prompt = typeof params.prompt === 'string' ? params.prompt : ''
  const request: Record<string, unknown> = {
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
    resolveModelscopeSize(options.modelId, imageSizeParam, baseSizeParam)

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
    const images = Array.isArray(params.image_url)
      ? params.image_url
      : (Array.isArray(params.images) ? params.images : [])

    if (images.length > 0) {
      request.image_url = images
    }
  }

  return request
}
