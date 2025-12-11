import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'
import { logError, logWarning, logInfo } from '../../../utils/errorLogger'

/**
 * LTX-2 模型路由
 * 支持 3 种模式：
 * - text-to-video: 文生视频
 * - image-to-video: 图生视频
 * - retake-video: 视频编辑
 */
export const falAiLtx2Route: FalModelRoute = {
  matches: (modelId: string) =>
    modelId.includes('ltx-2') ||
    modelId.includes('ltx2') ||
    modelId === 'fal-ai-ltx-2',

  buildVideoRequest: async (params: GenerateVideoParams) => {
    const {
      prompt,
      mode = 'text-to-video',
      images = [],
      videos = [],
      duration = 6,
      ltxFastMode = true,  // 默认使用快速模式
      ltxResolution = '1080p',
      ltxFps = 25,
      ltxGenerateAudio = true,
      ltxRetakeStartTime = 0,
      ltxRetakeMode = 'replace_audio_and_video'
    } = params

    // 选择 API 端点
    let endpoint: string
    const modelId = 'fal-ai/ltx-2'

    if (mode === 'retake-video') {
      // 视频编辑模式
      if (videos.length === 0) {
        throw new Error('视频编辑模式需要上传视频')
      }
      endpoint = 'fal-ai/ltx-2/retake-video'
    } else if (mode === 'image-to-video') {
      // 图生视频模式
      if (images.length === 0) {
        throw new Error('图生视频模式需要上传图片')
      }
      endpoint = ltxFastMode
        ? 'fal-ai/ltx-2/image-to-video/fast'
        : 'fal-ai/ltx-2/image-to-video'
    } else {
      // 文生视频模式
      endpoint = ltxFastMode
        ? 'fal-ai/ltx-2/text-to-video/fast'
        : 'fal-ai/ltx-2/text-to-video'
    }

    // 构建请求数据
    const requestData: any = {
      prompt
    }

    // 视频编辑模式的特殊参数
    if (mode === 'retake-video') {
      requestData.video_url = videos[0]
      requestData.start_time = ltxRetakeStartTime
      requestData.duration = duration
      requestData.retake_mode = ltxRetakeMode
    } else {
      // 文生视频和图生视频的通用参数
      requestData.duration = duration
      requestData.resolution = ltxResolution
      requestData.aspect_ratio = '16:9'  // LTX-2 固定使用 16:9 比例
      requestData.fps = ltxFps
      requestData.generate_audio = ltxGenerateAudio

      // 图生视频时添加图片
      if (mode === 'image-to-video' && images.length > 0) {
        requestData.image_url = images[0]
      }
    }

    logInfo('[LTX-2] 构建请求:', {
      mode,
      endpoint,
      fastMode: ltxFastMode,
      hasImages: images.length > 0,
      hasVideos: videos.length > 0,
      requestData
    })

    return { endpoint, modelId, requestData }
  }
}
