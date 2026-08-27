import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { registry } from '@/core/ModelRegistry'
import type { BuiltinModelType } from '@/core/types'
import { isBuiltinModelType } from '@/core/modelSortOrder'
import {
  toModelPromptText,
  type PromptDocumentV1,
  type PromptDocumentReferenceLabel,
} from '@/core/inputs/promptDocument'
import type { ModelState } from '../state/useModelState'

const logger = createLogger('components.MediaGenerator.hooks.useGenerationHandler')

interface GenerationHandler {
  handleGenerate: () => Promise<void>
}

/**
 * 生成请求处理
 * 职责：处理生成按钮点击，构建请求
 * 文件大小: < 150 行
 */
export const useGenerationHandler = (
  selectedModel: string,
  promptDocument: PromptDocumentV1,
  promptReferences: readonly PromptDocumentReferenceLabel[],
  modelState: ModelState,
  uploadedImages: string[],
  uploadedVideos: string[],
  uploadedAudios: string[],
  uploadedVideoFiles: File[],
  uploadedFilePaths: string[],
  uploadedVideoFilePaths: string[],
  uploadedAudioFilePaths: string[],
  onGenerate: (input: string, model: string, type: BuiltinModelType, options?: DynamicValue) => void | Promise<void>,
  uploadedVideoTrimStart?: number | null,
  uploadedVideoTrimEnd?: number | null
): GenerationHandler => {
  const handleGenerate = useCallback(async () => {
    // 获取模型信息
    const modelInfo = registry.getModelInfo(selectedModel)

    if (!modelInfo) {
      logger.error(`[GenerationHandler] Model not found: ${selectedModel}`)
      return
    }

    const modelType = modelInfo.type
    if (!isBuiltinModelType(modelType)) {
      logger.error('[GenerationHandler] Unsupported model type for media generation:', {
        model: selectedModel,
        modelType,
      })
      return
    }

    // 准备生成选项
    // 直接传递原始参数，让 GenerationService 统一构建请求
    // 避免双重构建导致参数丢失
    const rawOptions = {
      ...modelState.params,  // 传递所有模型参数（包括 maxImages 等）
      images: uploadedImages,
      videos: uploadedVideos,
      audios: uploadedAudios,
      uploadedFilePaths,
      uploadedVideoFilePaths,
      uploadedAudioFilePaths,
      // 仅用于需要参考视频的模型
      video: uploadedVideoFiles[0],
      // 裁剪窗口选中的 [start, end]（若用户裁剪过）；GenerationService 在生成提交时
      // 用它对完整视频做一次快速裁剪，不在这里提前处理
      ...(typeof uploadedVideoTrimStart === 'number' ? { uploadedVideoTrimStart } : {}),
      ...(typeof uploadedVideoTrimEnd === 'number' ? { uploadedVideoTrimEnd } : {})
    }

    const options = rawOptions

    logger.info('[GenerationHandler] Prepared options summary:', {
      model: selectedModel,
      modelType,
      imagesCount: Array.isArray(options.images) ? options.images.length : 0,
      videosCount: Array.isArray(options.videos) ? options.videos.length : 0,
      audiosCount: Array.isArray(options.audios) ? options.audios.length : 0,
      uploadedFilePathsCount: Array.isArray(options.uploadedFilePaths) ? options.uploadedFilePaths.length : 0,
      uploadedVideoFilePathsCount: Array.isArray(options.uploadedVideoFilePaths) ? options.uploadedVideoFilePaths.length : 0,
      uploadedAudioFilePathsCount: Array.isArray(options.uploadedAudioFilePaths) ? options.uploadedAudioFilePaths.length : 0,
      hasInlineVideoFile: options.video instanceof File
    })

    const modelPromptText = toModelPromptText(promptDocument, { references: promptReferences })
    await onGenerate(modelPromptText, selectedModel, modelType, options)
  }, [
    selectedModel,
    promptDocument,
    promptReferences,
    modelState.params,
    uploadedImages,
    uploadedVideos,
    uploadedAudios,
    uploadedVideoFiles,
    uploadedFilePaths,
    uploadedVideoFilePaths,
    uploadedAudioFilePaths,
    onGenerate,
    uploadedVideoTrimStart,
    uploadedVideoTrimEnd
  ])

  return { handleGenerate }
}
