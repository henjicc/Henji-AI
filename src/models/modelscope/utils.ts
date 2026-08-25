import { calculateQwenResolution } from '@/utils/qwenResolutionCalculator'
import { calculateResolutionWithBounds, normalizeBaseSize } from '@/utils/resolutionCalculator'

/**
 * 魔搭 API-Inference 的图像生成提交路由。
 * 曾误用 KIE 的 `/api/v1/jobs/createTask`（同一次批量改动里复制串了供应商），
 * 官方文档与每个模型页的示例代码统一都是这一条。
 */
export const MODELSCOPE_CREATE_TASK_ENDPOINT = '/v1/images/generations'

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

/**
 * ⚠️ 这个函数会被序列化进 manifest 的 builderJs，实际在
 * `electron/main/services/ai-runtime/js-runtime.ts` 的 JS_PRELUDE 里执行——
 * 那里有一份**手工维护的等价实现**。改动本函数（或 resolveModelscopeSize）
 * 必须同步改 PRELUDE 那份，否则运行时行为不变、改动静默失效。
 */
export function buildModelscopeRequest(
  params: DynamicValueMap,
  options: {
    modelId: string
    allowGuidance?: boolean
    allowNegativePrompt?: boolean
    allowImage?: boolean
    baseSize?: number
    sizeBounds?: ModelscopeSizeBounds
  }
): DynamicValueMap {
  const prompt = typeof params.prompt === 'string' ? params.prompt : ''
  const request: DynamicValueMap = {
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
    const filterSources = (value: DynamicValue): string[] =>
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
