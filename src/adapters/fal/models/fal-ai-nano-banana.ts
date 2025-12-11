import { GenerateImageParams } from '@/adapters/base/BaseAdapter'
import { logInfo } from '../../../utils/errorLogger'

/**
 * Fal.ai Nano Banana 模型路由
 */
export const falAiNanoBananaRoute = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'fal-ai/nano-banana' || modelId === 'nano-banana' || modelId === 'fal-ai-nano-banana',

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
    if (params.falNanoBananaNumImages !== undefined) {
      requestData.num_images = params.falNanoBananaNumImages
    }

    // aspect_ratio: 不发送 'auto' 或 'smart'
    logInfo('[fal-ai-nano-banana] params.aspect_ratio:', params.aspect_ratio)
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'auto' &&
        params.aspect_ratio !== 'smart') {
      logInfo('[fal-ai-nano-banana] Adding aspect_ratio to request:', params.aspect_ratio)
      requestData.aspect_ratio = params.aspect_ratio
    } else {
      logInfo('[fal-ai-nano-banana] Skipping aspect_ratio (undefined, auto, or smart)', {})
    }

    // 处理图生图：添加 image_urls
    // 注意：FalAdapter 已经将图片上传到 fal CDN，这里直接使用 URL
    if (hasImages) {
      requestData.image_urls = params.images
    }

    return { submitPath, modelId, requestData }
  }
}
