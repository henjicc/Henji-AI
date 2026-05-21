import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { registry } from '@/core/ModelRegistry'
import type { ModelType } from '@/core/types'
import { stripReferenceAtPrefix } from '@/core/inputs/referenceTokens'
import type { ModelState } from '../state/useModelState'
import {

  findSquareAspectValue,
  getAspectChoiceParams,
  isSmartAspectValue,
  resolveClosestAspectValue,
} from '@/core/params/ratioResolution'

const logger = createLogger('components.MediaGenerator.hooks.useGenerationHandler')

function getFirstImageSource(options: Record<string, unknown>): string | null {
  const images = options.images
  if (!Array.isArray(images) || images.length === 0) {
    return null
  }

  const first = images[0]
  return typeof first === 'string' && first.trim().length > 0 ? first : null
}

async function getImageRatio(imageSrc: string): Promise<number | null> {
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
    image.src = imageSrc
  })
}

async function resolveSmartAspectValues(
  modelId: string,
  rawOptions: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const model = registry.getModel(modelId)
  if (!model) {
    return rawOptions
  }

  const nextOptions: Record<string, unknown> = { ...rawOptions }
  const firstImage = getFirstImageSource(nextOptions)
  const hasReferenceImage = typeof firstImage === 'string'
  const targetRatio = hasReferenceImage ? await getImageRatio(firstImage) : null
  const normalizedTargetRatio = targetRatio && Number.isFinite(targetRatio) ? targetRatio : 1

  const aspectParams = getAspectChoiceParams(model.params)
  for (const aspectParam of aspectParams) {
    const currentValue = nextOptions[aspectParam.id] ?? (
      aspectParam.apiField ? nextOptions[aspectParam.apiField] : undefined
    )
    if (!isSmartAspectValue(currentValue)) {
      continue
    }

    let resolvedValue = hasReferenceImage
      ? resolveClosestAspectValue(aspectParam, normalizedTargetRatio)
      : findSquareAspectValue(aspectParam)

    if (resolvedValue === null) {
      resolvedValue = resolveClosestAspectValue(aspectParam, 1)
    }

    if (resolvedValue !== null) {
      nextOptions[aspectParam.id] = resolvedValue
      if (aspectParam.apiField) {
        nextOptions[aspectParam.apiField] = resolvedValue
      }
    }
  }

  if (isSmartAspectValue(nextOptions.aspect_ratio)) {
    nextOptions.aspect_ratio = '1:1'
  }

  return nextOptions
}

/**
 * 生成请求处理
 * 职责：处理生成按钮点击，构建请求
 * 文件大小: < 150 行
 */
export const useGenerationHandler = (
  selectedModel: string,
  input: string,
  modelState: ModelState,
  uploadedImages: string[],
  uploadedVideos: string[],
  uploadedVideoFiles: File[],
  uploadedFilePaths: string[],
  uploadedVideoFilePaths: string[],
  onGenerate: (input: string, model: string, type: ModelType, options?: unknown) => void | Promise<void>
) => {
  const handleGenerate = useCallback(async () => {
    // 获取模型信息
    const modelInfo = registry.getModelInfo(selectedModel)

    if (!modelInfo) {
      logger.error(`[GenerationHandler] Model not found: ${selectedModel}`)
      return
    }

    const rawType: unknown = modelInfo.type
    const modelType: ModelType = rawType === 'image' || rawType === 'video' || rawType === 'audio' ? rawType : 'image'

    // 准备生成选项
    // 直接传递原始参数，让 GenerationService 统一构建请求
    // 避免双重构建导致参数丢失
    const rawOptions = {
      ...modelState.params,  // 传递所有模型参数（包括 maxImages 等）
      images: uploadedImages,
      videos: uploadedVideos,
      uploadedFilePaths,
      uploadedVideoFilePaths,
      // 仅用于需要参考视频的模型
      video: uploadedVideoFiles[0]
    }

    const options = await resolveSmartAspectValues(selectedModel, rawOptions)

    logger.info('[GenerationHandler] Prepared options summary:', {
      model: selectedModel,
      modelType,
      imagesCount: Array.isArray(options.images) ? options.images.length : 0,
      videosCount: Array.isArray(options.videos) ? options.videos.length : 0,
      uploadedFilePathsCount: Array.isArray(options.uploadedFilePaths) ? options.uploadedFilePaths.length : 0,
      uploadedVideoFilePathsCount: Array.isArray(options.uploadedVideoFilePaths) ? options.uploadedVideoFilePaths.length : 0,
      hasInlineVideoFile: options.video instanceof File
    })

    // 调用生成回调（将 @图N 规范化为 图N）
    await onGenerate(stripReferenceAtPrefix(input), selectedModel, modelType, options)
  }, [
    selectedModel,
    input,
    modelState.params,
    uploadedImages,
    uploadedVideos,
    uploadedVideoFiles,
    uploadedFilePaths,
    uploadedVideoFilePaths,
    onGenerate
  ])

  return { handleGenerate }
}

