import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'
import { logError, logInfo } from '../../../utils/errorLogger'

/**
 * 获取图片的宽高比
 */
async function getImageAspectRatio(imageUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // 检查是否是 data URL
    if (imageUrl.startsWith('data:')) {
      const img = new Image()
      img.onload = () => {
        resolve(img.width / img.height)
      }
      img.onerror = reject
      img.src = imageUrl
    } else {
      // 对于远程 URL，创建 Image 对象
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        resolve(img.width / img.height)
      }
      img.onerror = reject
      img.src = imageUrl
    }
  })
}

/**
 * 匹配最适合的预设宽高比
 */
function matchAspectRatio(aspectRatio: number): string {
  // 预设的宽高比选项
  const presetRatios = [
    { value: '16:9', ratio: 16 / 9 },
    { value: '9:16', ratio: 9 / 16 },
    { value: '1:1', ratio: 1 / 1 }
  ]

  // 找到最接近的预设宽高比
  let closestRatio = presetRatios[0]
  let minDiff = Math.abs(aspectRatio - closestRatio.ratio)

  for (const preset of presetRatios) {
    const diff = Math.abs(aspectRatio - preset.ratio)
    if (diff < minDiff) {
      minDiff = diff
      closestRatio = preset
    }
  }

  return closestRatio.value
}

/**
 * Fal.ai Vidu Q2 模型路由
 */
export const falAiViduQ2Route: FalModelRoute = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId.includes('vidu-q2') ||
    modelId.includes('vidu/q2'),

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const { prompt, images = [], videos = [] } = params
    const mode = params.viduQ2Mode || 'text-to-video'
    const hasImages = images.length > 0
    const hasVideos = videos.length > 0

    // 根据模式选择端点
    let endpoint: string
    const modelId = 'fal-ai/vidu/q2' // 轮询时使用不带子路径的 modelId

    if (mode === 'video-extension') {
      // 视频延长模式
      if (!hasVideos) {
        throw new Error('视频延长模式需要上传视频')
      }
      endpoint = 'fal-ai/vidu/q2/video-extension/pro'
    } else if (mode === 'reference-to-video') {
      // 参考生视频模式
      if (!hasImages) {
        throw new Error('参考生视频模式需要至少1张图片')
      }
      endpoint = 'fal-ai/vidu/q2/reference-to-video'
    } else if (mode === 'image-to-video') {
      // 图生视频模式（Pro/Turbo）
      if (!hasImages) {
        throw new Error('图生视频模式需要上传图片')
      }
      const isTurbo = params.viduQ2FastMode !== undefined ? params.viduQ2FastMode : true
      endpoint = isTurbo
        ? 'fal-ai/vidu/q2/image-to-video/turbo'
        : 'fal-ai/vidu/q2/image-to-video/pro'
    } else {
      // 文生视频模式
      endpoint = 'fal-ai/vidu/q2/text-to-video'
    }

    // 构建请求数据
    const requestData: any = {
      prompt: prompt || ''
    }

    // 添加时长参数
    const duration = params.falViduQ2VideoDuration || 4
    requestData.duration = duration

    // 处理分辨率和宽高比
    let viduQ2AspectRatio = params.viduQ2AspectRatio || params.aspectRatio
    const viduQ2Resolution = params.viduQ2Resolution || '720p'

    // 智能匹配宽高比（仅在有图片时）
    if ((viduQ2AspectRatio === 'smart' || viduQ2AspectRatio === 'auto') && hasImages) {
      try {
        const ratio = await getImageAspectRatio(images[0])
        viduQ2AspectRatio = matchAspectRatio(ratio)
        logInfo('', `[Vidu Q2] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${viduQ2AspectRatio}`)
      } catch (error) {
        logError('[Vidu Q2] 计算图片宽高比失败:', error)
        viduQ2AspectRatio = '16:9' // 回退默认值
      }
    }

    // 根据模式添加分辨率和宽高比参数
    if (mode === 'text-to-video' || mode === 'reference-to-video') {
      // 文生视频和参考生视频：支持 aspect_ratio 和 resolution
      if (viduQ2AspectRatio && viduQ2AspectRatio !== 'smart' && viduQ2AspectRatio !== 'auto') {
        requestData.aspect_ratio = viduQ2AspectRatio
      }
      if (viduQ2Resolution) {
        requestData.resolution = viduQ2Resolution
      }
    } else if (mode === 'image-to-video') {
      // 图生视频：只支持 resolution，不支持 aspect_ratio
      if (viduQ2Resolution) {
        requestData.resolution = viduQ2Resolution
      }
    } else if (mode === 'video-extension') {
      // 视频延长：支持 resolution
      if (viduQ2Resolution) {
        requestData.resolution = viduQ2Resolution
      }
    }

    // 添加运动幅度参数（除视频延长外都支持）
    if (mode !== 'video-extension') {
      const movementAmplitude = params.viduQ2MovementAmplitude || 'auto'
      requestData.movement_amplitude = movementAmplitude
    }

    // 添加背景音乐参数（所有模式都支持，但仅4秒视频有效）
    const bgm = params.viduQ2Bgm || false
    requestData.bgm = bgm

    // 处理图片
    if (hasImages) {
      if (mode === 'reference-to-video') {
        // 参考生视频：使用 reference_image_urls（最多7张）
        requestData.reference_image_urls = images.slice(0, 7)
      } else if (mode === 'image-to-video') {
        // 图生视频：使用 image_url（单张）
        requestData.image_url = images[0]
      }
    }

    // 处理视频
    if (hasVideos && mode === 'video-extension') {
      // 视频延长：使用 video_url
      requestData.video_url = videos[0]
    }

    return { endpoint, modelId, requestData }
  }
}
