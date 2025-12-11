import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

/**
 * Fal.ai Sora 2 模型路由
 * 支持文生视频和图生视频，标准版和专业版
 */
export const falAiSora2Route: FalModelRoute = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId.includes('sora-2') ||
    modelId.includes('sora2') ||
    modelId === 'fal-ai-sora-2',

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const { prompt, images = [], duration = 4 } = params
    const hasImages = images.length > 0

    // 获取模式参数（标准/专业）
    const soraMode = params.soraMode || 'standard'
    const isPro = soraMode === 'pro'

    // 根据是否有图片和模式选择端点
    let endpoint: string
    const modelId = 'fal-ai/sora-2' // 轮询时使用不带子路径的modelId

    if (hasImages) {
      // 图生视频
      endpoint = isPro
        ? 'fal-ai/sora-2/image-to-video/pro'
        : 'fal-ai/sora-2/image-to-video'
    } else {
      // 文生视频
      endpoint = isPro
        ? 'fal-ai/sora-2/text-to-video/pro'
        : 'fal-ai/sora-2/text-to-video'
    }

    // 构建请求数据
    const requestData: any = {
      prompt,
      duration,
      delete_video: true // 固定为 true，不暴露给用户
    }

    // 处理分辨率和宽高比
    // 使用 soraResolution 和 soraAspectRatio 参数
    let aspectRatio = params.soraAspectRatio || params.aspectRatio
    let resolution = params.soraResolution || params.resolution

    // 图生视频：支持智能匹配和 auto
    if (hasImages) {
      // 智能匹配：如果宽高比为 smart，根据上传的第一张图片计算宽高比
      if (aspectRatio === 'smart') {
        try {
          const { getImageAspectRatio } = await import('@/utils/aspectRatio')
          const ratio = await getImageAspectRatio(images[0])

          // Sora 2 支持的比例：16:9, 9:16
          const presetRatios = [
            { value: '16:9', ratio: 16 / 9 },
            { value: '9:16', ratio: 9 / 16 }
          ]

          // 找到最接近的预设宽高比
          let closestRatio = presetRatios[0]
          let minDiff = Math.abs(ratio - closestRatio.ratio)

          for (const preset of presetRatios) {
            const diff = Math.abs(ratio - preset.ratio)
            if (diff < minDiff) {
              minDiff = diff
              closestRatio = preset
            }
          }

          aspectRatio = closestRatio.value
          console.log(`[Sora2] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
        } catch (error) {
          console.error('[Sora2] 计算图片宽高比失败:', error)
          aspectRatio = 'auto' // 回退到 auto，让 API 自动处理
        }
      }

      // 图生视频支持 auto，可以传递
      if (aspectRatio && aspectRatio !== 'smart') {
        requestData.aspect_ratio = aspectRatio
      }

      if (resolution) {
        requestData.resolution = resolution
      }

      // 图生视频必须传递 image_url
      requestData.image_url = images[0]
    } else {
      // 文生视频：不支持 auto 和 smart，必须传递具体值
      // 如果是 smart 或 auto，使用默认值
      if (!aspectRatio || aspectRatio === 'smart' || aspectRatio === 'auto') {
        aspectRatio = '16:9' // 文生视频默认 16:9
      }
      requestData.aspect_ratio = aspectRatio

      // 文生视频的分辨率处理
      if (!resolution || resolution === 'auto') {
        resolution = '720p' // 文生视频默认 720p
      }
      requestData.resolution = resolution

      // 文生视频不传递 image_url
    }

    return { endpoint, modelId, requestData }
  }
}
