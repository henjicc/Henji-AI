import { FalModelRoute } from './index'

export const falAiZImageTurboRoute: FalModelRoute = {
  matches: (modelId: string) => modelId === 'fal-ai-z-image-turbo',

  buildImageRequest: (params: any) => {
    const images = params.uploadedImages || []
    const prompt = params.prompt || ''
    const numImages = params.numImages || 1
    const numInferenceSteps = params.numInferenceSteps || 8
    const enablePromptExpansion = params.enablePromptExpansion || false
    const acceleration = params.acceleration || 'none'

    // 处理imageSize参数
    // params.imageSize 格式为 "width*height" (如 "1760*1168")
    // 需要转换为 fal.ai 支持的格式
    let imageSize: any = 'landscape_4_3' // 默认值

    if (params.imageSize) {
      // 如果是 "width*height" 格式，转换为对象 { width, height }
      if (params.imageSize.includes('*')) {
        const [width, height] = params.imageSize.split('*').map(Number)
        imageSize = { width, height }
      } else {
        // 否则直接使用（可能是预设值）
        imageSize = params.imageSize
      }
    }

    // 完整的模型ID路径
    const fullPath = 'fal-ai/z-image/turbo'

    // 根据输入类型选择端点
    if (images.length === 0) {
      // 文生图（异步模式，支持进度回调）
      return {
        submitPath: fullPath,
        modelId: fullPath,
        requestData: {
          prompt,
          image_size: imageSize,
          num_inference_steps: numInferenceSteps,
          num_images: numImages,
          enable_safety_checker: false,
          output_format: 'png',
          enable_prompt_expansion: enablePromptExpansion,
          acceleration: acceleration
        }
      }
    } else {
      // 图生图/编辑（异步模式，支持进度回调）
      return {
        submitPath: fullPath,
        modelId: fullPath,
        requestData: {
          prompt,
          image_size: imageSize,
          num_inference_steps: numInferenceSteps,
          num_images: numImages,
          enable_safety_checker: false,
          output_format: 'png',
          enable_prompt_expansion: enablePromptExpansion,
          acceleration: acceleration,
          image_urls: images
        }
      }
    }
  }
}