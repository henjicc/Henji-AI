import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

/**
 * Fal.ai Nano Banana 模型路由
 */
export const falAiNanoBananaRoute = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'fal-ai/nano-banana' || modelId === 'nano-banana',

  // 构建图片生成请求
  buildImageRequest: (params: GenerateImageParams) => {
    const hasImages = params.images && params.images.length > 0

    // submitPath: 提交请求的完整路径（包含subpath如/edit）
    // modelId: 查询状态/结果时使用的model_id（不含subpath）
    const submitPath = hasImages ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana'
    const modelId = 'fal-ai/nano-banana'

    const requestData: any = {
      prompt: params.prompt
    }

    // 添加可选参数
    if (params.num_images !== undefined) {
      requestData.num_images = params.num_images
    }

    // aspect_ratio: 只有在不是 'auto' 时才发送
    if (params.aspect_ratio !== undefined && params.aspect_ratio !== 'auto') {
      requestData.aspect_ratio = params.aspect_ratio
    }

    // 处理图生图：添加 image_urls
    if (hasImages) {
      requestData.image_urls = params.images!.map(img => {
        if (typeof img === 'string') {
          return img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
        }
        return img
      })
    }

    return { submitPath, modelId, requestData }
  }
}
