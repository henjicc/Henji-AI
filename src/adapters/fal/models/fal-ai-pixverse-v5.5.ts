import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'
import { logError, logWarning, logInfo } from '../../../utils/errorLogger'

/**
 * Fal.ai Pixverse V5.5 模型路由
 * 支持文生视频、图生视频、首尾帧三种模式
 */
export const falAiPixverseV55Route: FalModelRoute = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId.includes('pixverse/v5.5') ||
    modelId === 'fal-ai-pixverse-v5.5',

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 根据图片数量自动选择端点
    let endpoint: string
    const modelId = 'fal-ai/pixverse/v5.5'  // 轮询时使用不带子路径的 modelId

    if (images.length === 0) {
      // 文生视频
      endpoint = 'fal-ai/pixverse/v5.5/text-to-video'
    } else if (images.length === 1) {
      // 图生视频
      endpoint = 'fal-ai/pixverse/v5.5/image-to-video'
    } else {
      // 首尾帧（2张或更多图片）
      endpoint = 'fal-ai/pixverse/v5.5/transition'
    }

    // 构建请求数据
    const requestData: any = {
      prompt
    }

    // 处理宽高比（智能匹配）
    let aspectRatio = params.pixverseAspectRatio || params.aspectRatio
    if ((aspectRatio === 'smart' || aspectRatio === 'auto') && images.length > 0) {
      try {
        const { getImageAspectRatio } = await import('@/utils/aspectRatio')
        const ratio = await getImageAspectRatio(images[0])

        // Pixverse 支持的比例：16:9, 4:3, 1:1, 3:4, 9:16
        const presetRatios = [
          { value: '16:9', ratio: 16 / 9 },
          { value: '4:3', ratio: 4 / 3 },
          { value: '1:1', ratio: 1 / 1 },
          { value: '3:4', ratio: 3 / 4 },
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
        logInfo('', `[Pixverse V5.5] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
      } catch (error) {
        logError('[Pixverse V5.5] 计算图片宽高比失败:', error)
        aspectRatio = '16:9'  // 回退默认值
      }
    }

    // 只传递实际的比例值
    if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
      requestData.aspect_ratio = aspectRatio
    }

    // 分辨率
    const resolution = params.pixverseResolution || params.resolution
    if (resolution) {
      requestData.resolution = resolution
    }

    // 时长（注意：API 需要字符串格式）
    const duration = params.falPixverse55VideoDuration || params.duration || 5
    requestData.duration = String(duration)

    // 风格（可选）
    if (params.pixverseStyle && params.pixverseStyle !== 'none') {
      requestData.style = params.pixverseStyle
    }

    // 思考模式（可选）
    if (params.pixverseThinkingType) {
      requestData.thinking_type = params.pixverseThinkingType
    }

    // 生成音频开关
    if (params.pixverseGenerateAudio !== undefined) {
      requestData.generate_audio_switch = params.pixverseGenerateAudio
    }

    // 多镜头开关
    if (params.pixverseMultiClip !== undefined) {
      requestData.generate_multi_clip_switch = params.pixverseMultiClip
    }

    // 处理图片参数
    if (images.length === 1) {
      // 图生视频：使用 image_url
      requestData.image_url = images[0]
    } else if (images.length >= 2) {
      // 首尾帧：使用 first_image_url 和 end_image_url
      requestData.first_image_url = images[0]
      if (images.length >= 2) {
        requestData.end_image_url = images[1]
      }
    }

    // ❌ 不传递 negative_prompt 和 seed

    return { endpoint, modelId, requestData }
  }
}
