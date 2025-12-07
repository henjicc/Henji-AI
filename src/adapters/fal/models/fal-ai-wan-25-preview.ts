import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

/**
 * Fal.ai Wan 2.5 Preview 模型路由
 *
 * 支持：
 * - 文生视频 (text-to-video)
 * - 图生视频 (image-to-video)
 *
 * 根据上传图片数量自动切换端点
 */
export const falAiWan25PreviewRoute: FalModelRoute = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId === 'fal-ai-wan-25-preview' ||
    modelId === 'wan-25-preview' ||
    modelId.includes('fal-ai/wan-25-preview'),

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''
    const hasImages = images.length > 0

    // 根据是否有图片选择端点
    const endpoint = hasImages
      ? 'fal-ai/wan-25-preview/image-to-video'  // 图生视频
      : 'fal-ai/wan-25-preview/text-to-video'   // 文生视频

    const modelId = 'fal-ai/wan-25-preview'  // 轮询时使用不带子路径的 modelId

    // 构建请求数据
    const requestData: any = {
      prompt,
      enable_safety_checker: false  // 按要求设置为 false
    }

    // 添加时长参数（5 或 10 秒）
    const duration = params.duration || 5
    requestData.duration = `${duration}`  // API 要求字符串格式 "5" 或 "10"

    // 添加提示词扩展参数
    if (params.wanPromptExpansion !== undefined) {
      requestData.enable_prompt_expansion = params.wanPromptExpansion
    }

    // 图生视频：只添加分辨率参数
    if (hasImages) {
      requestData.image_url = images[0]  // 使用第一张图片

      // 图生视频只支持分辨率参数
      if (params.wanResolution) {
        requestData.resolution = params.wanResolution.toLowerCase()  // "480p", "720p", "1080p"
      }
    } else {
      // 文生视频：添加比例和分辨率参数
      if (params.wanAspectRatio && params.wanAspectRatio !== 'smart' && params.wanAspectRatio !== 'auto') {
        requestData.aspect_ratio = params.wanAspectRatio  // "16:9", "9:16", "1:1"
      }

      if (params.wanResolution) {
        requestData.resolution = params.wanResolution.toLowerCase()  // "480p", "720p", "1080p"
      }
    }

    return { endpoint, modelId, requestData }
  }
}
