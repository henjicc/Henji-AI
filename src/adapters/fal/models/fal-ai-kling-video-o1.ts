import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'
import { logError, logWarning, logInfo } from '../../../utils/errorLogger'

/**
 * Kling Video O1 模型路由
 * 支持 4 种模式：
 * - image-to-video: 图生视频（首尾帧）
 * - reference-to-video: 参考生视频（多图/Elements）
 * - video-to-video-edit: 视频编辑
 * - video-to-video-reference: 视频参考生视频
 */
export const falAiKlingVideoO1Route: FalModelRoute = {
  matches: (modelId: string) =>
    modelId.includes('kling-video-o1') ||
    modelId.includes('kling-video/o1') ||
    modelId === 'fal-ai-kling-video-o1',

  buildVideoRequest: async (params: GenerateVideoParams) => {
    const {
      prompt,
      mode = 'image-to-video',
      images = [],
      videos = [],
      elements = [],
      duration = 5,
      aspectRatio,
      keepAudio = false
    } = params

    // 选择 API 端点
    let endpoint: string
    const modelId = 'fal-ai/kling-video/o1'

    switch (mode) {
      case 'image-to-video':
        endpoint = 'fal-ai/kling-video/o1/image-to-video'
        break
      case 'reference-to-video':
        endpoint = 'fal-ai/kling-video/o1/reference-to-video'
        break
      case 'video-to-video-edit':
        endpoint = 'fal-ai/kling-video/o1/video-to-video/edit'
        break
      case 'video-to-video-reference':
        endpoint = 'fal-ai/kling-video/o1/video-to-video/reference'
        break
      default:
        throw new Error(`未知的 Kling O1 模式: ${mode}`)
    }

    // 构建请求数据
    const requestData: any = {
      prompt,
      duration: `${duration}`
    }

    // 模式特定参数
    if (mode === 'image-to-video') {
      // 图生视频模式：需要至少 1 张图片
      if (images.length === 0) {
        throw new Error('图生视频模式需要至少 1 张图片')
      }
      requestData.start_image_url = images[0]

      // 如果有第二张图片，作为结束帧
      if (images.length > 1) {
        requestData.end_image_url = images[1]
      }
    }

    if (mode === 'reference-to-video') {
      // 参考生视频模式：支持图片和 Elements
      if (images.length > 0) {
        requestData.image_urls = images
      }

      if (elements && elements.length > 0) {
        requestData.elements = elements
      }

      // 宽高比（auto 不传递给 API）
      if (aspectRatio && aspectRatio !== 'auto') {
        requestData.aspect_ratio = aspectRatio
      }
    }

    if (mode === 'video-to-video-edit' || mode === 'video-to-video-reference') {
      // 视频模式：需要上传视频
      if (videos.length === 0) {
        throw new Error('视频模式需要上传视频')
      }
      requestData.video_url = videos[0]
      requestData.keep_audio = keepAudio

      // 可选的图片和 Elements
      if (images.length > 0) {
        requestData.image_urls = images
      }

      if (elements && elements.length > 0) {
        requestData.elements = elements
      }

      // video-to-video-reference 模式支持宽高比
      if (mode === 'video-to-video-reference' && aspectRatio && aspectRatio !== 'auto') {
        requestData.aspect_ratio = aspectRatio
      }
    }

    logInfo('[Kling O1] 构建请求:', {
      mode,
      endpoint,
      hasImages: images.length > 0,
      hasVideos: videos.length > 0,
      hasElements: elements && elements.length > 0,
      requestData
    })

    return { endpoint, modelId, requestData }
  }
}
