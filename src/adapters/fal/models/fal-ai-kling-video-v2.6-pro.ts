import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'
import { logInfo } from '../../../utils/errorLogger'

/**
 * Kling Video v2.6 Pro 模型路由
 * 支持 2 种模式：
 * - text-to-video: 文生视频
 * - image-to-video: 图生视频
 *
 * 特性：
 * - 支持 5 秒和 10 秒时长
 * - 支持 16:9、9:16、1:1 宽高比（仅文生视频）
 * - 支持原生音频生成（中英文）
 * - 支持 CFG Scale 调节（仅文生视频）
 */
export const falAiKlingVideoV26ProRoute: FalModelRoute = {
  matches: (modelId: string) =>
    modelId.includes('kling-video-v2.6-pro') ||
    modelId.includes('kling-video/v2.6/pro') ||
    modelId === 'fal-ai-kling-video-v2.6-pro',

  buildVideoRequest: async (params: GenerateVideoParams) => {
    const {
      prompt = '',
      images = [],
      videos = [], // FalAdapter 处理后的视频 URL 数组
      duration = 5,
      aspectRatio = '16:9',
      klingV26GenerateAudio = true,
      klingV26CfgScale = 0.5,
      falKlingV26ProMode = 'text-image-to-video',
      falKlingV26ProResolution = '720p',
      falKlingV26ProCharacterOrientation = 'video',
      falKlingV26ProKeepOriginalSound = true
    } = params

    // 动作控制模式
    if (falKlingV26ProMode === 'motion-control') {
      if (!images || images.length === 0) {
        throw new Error('Motion Control mode requires an input image')
      }
      if (!videos || videos.length === 0) {
        throw new Error('Motion Control mode requires an input video')
      }

      // 根据分辨率选择端点 (Standard: 720p, Pro: 1080p)
      const endpoint = falKlingV26ProResolution === '1080p'
        ? 'fal-ai/kling-video/v2.6/pro/motion-control'
        : 'fal-ai/kling-video/v2.6/standard/motion-control'

      const modelId = `fal-ai/kling-video/v2.6/${falKlingV26ProResolution === '1080p' ? 'pro' : 'standard'}/motion-control`

      const requestData: any = {
        image_url: images[0],
        video_url: videos[0],
        character_orientation: falKlingV26ProCharacterOrientation,
        keep_original_sound: falKlingV26ProKeepOriginalSound
      }

      if (prompt) {
        requestData.prompt = prompt
      }

      logInfo('[Kling v2.6 Pro] 构建动作控制请求:', {
        mode: 'motion-control',
        endpoint,
        requestData
      })

      return { endpoint, modelId, requestData }
    }

    // 文/图生视频模式
    const hasImages = images.length > 0
    const endpoint = hasImages
      ? 'fal-ai/kling-video/v2.6/pro/image-to-video'
      : 'fal-ai/kling-video/v2.6/pro/text-to-video'

    const modelId = 'fal-ai/kling-video/v2.6/pro'

    // 构建请求数据
    const requestData: any = {
      prompt,
      duration: `${duration}`,
      generate_audio: klingV26GenerateAudio
    }

    // 图生视频模式：添加图片 URL
    if (hasImages) {
      requestData.image_url = images[0]
    } else {
      // 文生视频模式：添加宽高比和 CFG Scale
      if (aspectRatio && aspectRatio !== 'auto') {
        requestData.aspect_ratio = aspectRatio
      }

      if (klingV26CfgScale !== undefined) {
        requestData.cfg_scale = klingV26CfgScale
      }
    }

    logInfo('[Kling v2.6 Pro] 构建请求:', {
      mode: hasImages ? 'image-to-video' : 'text-to-video',
      endpoint,
      hasImages,
      requestData
    })

    return { endpoint, modelId, requestData }
  }
}
