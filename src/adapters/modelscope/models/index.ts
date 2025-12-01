import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

export interface ModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: GenerateImageParams) => { endpoint: string; requestData: any }
}

// 魔搭所有模型使用统一的路由逻辑
export const modelscopeUnifiedRoute: ModelRoute = {
  // 匹配所有魔搭模型（预设模型 + 自定义模型）
  matches: (modelId: string) => {
    return modelId.includes('/') || modelId === 'modelscope-custom'
  },

  buildImageRequest: (params: GenerateImageParams) => {
    const requestData: any = {
      model: params.model,
      prompt: params.prompt || ''
    }

    // 分辨率（从宽高比+质量转换为 widthxheight 格式）
    if (params.width && params.height) {
      requestData.size = `${params.width}x${params.height}`
    }

    // 采样步数
    if (params.steps !== undefined) {
      requestData.steps = params.steps
    }

    // 负面提示词（仅非 Qwen-Image-Edit-2509 模型使用）
    if (params.negativePrompt && params.model !== 'Qwen/Qwen-Image-Edit-2509') {
      requestData.negative_prompt = params.negativePrompt
    }

    // 提示词引导系数（仅非 Qwen-Image-Edit-2509 模型使用）
    if (params.guidance !== undefined && params.model !== 'Qwen/Qwen-Image-Edit-2509') {
      requestData.guidance = params.guidance
    }

    // 随机种子（可选，某些模型不支持）
    // 注意：Qwen-image 等模型可能不支持 seed 参数，导致 400 错误
    // 因此只在明确需要时才添加
    if (params.seed !== undefined) {
      requestData.seed = params.seed
    }

    // 图片编辑：添加 image_url 参数（支持最多3张图片）
    // 注意：params.imageUrls 是已经上传到 fal CDN 的 URL 数组
    // ⚠️ 重要：根据魔搭 API 文档，image_url 必须是数组格式，即使只有一张图片
    if (params.imageUrls && params.imageUrls.length > 0) {
      // Qwen-Image-Edit-2509 支持最多3张图片
      const imageUrls = params.imageUrls.slice(0, 3)

      // 始终使用数组格式（符合魔搭 API 规范）
      requestData.image_url = imageUrls
    }

    return {
      endpoint: '/v1/images/generations',
      requestData
    }
  }
}

export const modelscopeModelRoutes: ModelRoute[] = [
  modelscopeUnifiedRoute
]

export const findRoute = (modelId: string): ModelRoute | undefined => {
  return modelscopeModelRoutes.find(route => route.matches(modelId))
}
