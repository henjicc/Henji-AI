import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

/**
 * Fal.ai Nano Banana Pro 模型路由
 */
export const falAiNanoBananaProRoute = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'fal-ai/nano-banana-pro' || modelId === 'nano-banana-pro' || modelId === 'fal-ai-nano-banana-pro',

  // 构建图片生成请求
  buildImageRequest: (params: GenerateImageParams) => {
    const hasImages = params.images && params.images.length > 0

    // submitPath: 提交请求的完整路径（包含subpath如/edit）
    // modelId: 查询状态/结果时使用的model_id（不含subpath）
    const submitPath = hasImages ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro'
    const modelId = 'fal-ai/nano-banana-pro'

    const requestData: any = {
      prompt: params.prompt
    }

    // 添加可选参数
    if (params.falNanoBananaNumImages !== undefined) {
      requestData.num_images = params.falNanoBananaNumImages
    }

    // aspect_ratio: 不发送 'auto' 或 'smart'
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'auto' &&
        params.aspect_ratio !== 'smart') {
      requestData.aspect_ratio = params.aspect_ratio
    }

    // 添加 resolution 参数（仅 nano-banana-pro）
    const resolution = params.falNanoBananaProResolution ?? params.resolution
    if (resolution !== undefined) {
      requestData.resolution = resolution
    }

    // 处理图生图：添加 image_urls
    // 注意：FalAdapter 已经将图片上传到 fal CDN，这里直接使用 URL
    if (hasImages) {
      requestData.image_urls = params.images
    }

    return { submitPath, modelId, requestData }
  }
}
