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

    // 负面提示词
    if (params.negativePrompt) {
      requestData.negative_prompt = params.negativePrompt
    }

    // 分辨率（从宽高比+质量转换为 widthxheight 格式）
    if (params.width && params.height) {
      requestData.size = `${params.width}x${params.height}`
    }

    // 采样步数
    if (params.steps !== undefined) {
      requestData.steps = params.steps
    }

    // 提示词引导系数
    if (params.guidance !== undefined) {
      requestData.guidance = params.guidance
    }

    // 随机种子（自动生成）
    requestData.seed = Math.floor(Math.random() * 2147483647)

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
