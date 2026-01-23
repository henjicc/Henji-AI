import { useCallback } from 'react'
import { registry } from '@/core/ModelRegistry'
import { RequestBuilder } from '@/core/request/RequestBuilder'
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
  onGenerate: (input: string, model: string, type: string, options: any) => void
) => {
  const handleGenerate = useCallback(async () => {
    // 获取模型信息
    const modelInfo = registry.getModelInfo(selectedModel)

    if (!modelInfo) {
      console.error(`[GenerationHandler] Model not found: ${selectedModel}`)
      return
    }

    const modelType = modelInfo.type || 'image'

    // 使用新系统的 RequestBuilder
    const builder = new RequestBuilder()

    // 合并 UI 状态和模型参数
    const allParams = {
      ...modelState.params,
      prompt: input,
      images: uploadedImages,
      videos: uploadedVideos
    }

    try {
      // 构建请求（支持异步 builder）
      const result = await builder.build(selectedModel, allParams, { debug: false })

      // 准备生成选项（兼容旧的 onGenerate 接口）
      const options = {
        ...result.body,
        // 保留必要的上传文件引用
        uploadedImages,
        uploadedVideos
      }

      console.log('[GenerationHandler] Generated options:', options)
      console.log('[GenerationHandler] Model type:', modelType)

      // 调用生成回调
      onGenerate(input, selectedModel, modelType, options)
    } catch (error) {
      console.error('[GenerationHandler] Error building request:', error)
      throw error
    }
  }, [selectedModel, input, modelState.params, uploadedImages, uploadedVideos, onGenerate])

  return { handleGenerate }
}
