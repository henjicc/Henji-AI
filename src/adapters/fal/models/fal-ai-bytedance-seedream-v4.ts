import { FalModelRoute } from './index'

export const falAiBytedanceSeedreamV4Route: FalModelRoute = {
  matches: (modelId: string) => modelId === 'bytedance-seedream-v4' || modelId === 'fal-ai-bytedance-seedream-v4',

  buildImageRequest: (params: any) => {
    const images = params.images || []
    const prompt = params.prompt || ''
    const numImages = params.falSeedream40NumImages || 1

    // 处理imageSize参数，从字符串格式转换为对象格式
    let imageSize = { width: 2048, height: 2048 }
    if (params.imageSize) {
      const [width, height] = params.imageSize.split('*').map(Number)
      imageSize = { width, height }
    }

    // 注意：bytedance seedream v4 的 model ID 本身就包含完整路径
    // 不像其他模型那样有 base model ID + subpath 的结构
    // submitPath 和 modelId 使用相同的完整路径

    // 根据输入类型选择端点
    if (images.length === 0) {
      // 文生图（异步模式，支持进度回调）
      const fullPath = 'fal-ai/bytedance/seedream/v4/text-to-image'
      return {
        submitPath: fullPath,
        modelId: fullPath,
        requestData: {
          prompt,
          image_size: imageSize,
          num_images: numImages,
          enable_safety_checker: false
        }
      }
    } else {
      // 图生图/编辑（异步模式，支持进度回调）
      const fullPath = 'fal-ai/bytedance/seedream/v4/edit'
      return {
        submitPath: fullPath,
        modelId: fullPath,
        requestData: {
          prompt,
          image_size: imageSize,
          num_images: numImages,
          image_urls: images,
          enable_safety_checker: false
        }
      }
    }
  }
}
