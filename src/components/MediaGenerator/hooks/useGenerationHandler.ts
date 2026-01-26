import { useCallback } from 'react'
import { registry } from '@/core/ModelRegistry'
import type { ModelType } from '@/core/types'
import type { ModelState } from '../state/useModelState'

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
  onGenerate: (input: string, model: string, type: ModelType, options?: unknown) => void
) => {
  const handleGenerate = useCallback(async () => {
    // 获取模型信息
    const modelInfo = registry.getModelInfo(selectedModel)

    if (!modelInfo) {
      console.error(`[GenerationHandler] Model not found: ${selectedModel}`)
      return
    }

    const rawType: unknown = modelInfo.type
    const modelType: ModelType = rawType === 'image' || rawType === 'video' || rawType === 'audio' ? rawType : 'image'

    // 准备生成选项
    // 直接传递原始参数，让 GenerationService 统一构建请求
    // 避免双重构建导致参数丢失
    const options = {
      ...modelState.params,  // 传递所有模型参数（包括 maxImages 等）
      images: uploadedImages,
      videos: uploadedVideos,
      uploadedFilePaths,
      uploadedVideoFilePaths,
      // 仅用于需要参考视频的模型
      video: uploadedVideoFiles[0]
    }

    console.log('[GenerationHandler] Generated options:', options)
    console.log('[GenerationHandler] Model type:', modelType)

    // 调用生成回调
    onGenerate(input, selectedModel, modelType, options)
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
