import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'
import { logError, logWarning, logInfo } from '../../../utils/errorLogger'

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
    { value: '21:9', ratio: 21 / 9 },
    { value: '16:9', ratio: 16 / 9 },
    { value: '4:3', ratio: 4 / 3 },
    { value: '1:1', ratio: 1 / 1 },
    { value: '3:4', ratio: 3 / 4 },
    { value: '9:16', ratio: 9 / 16 }
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
 * Fal.ai Bytedance Seedance 模型路由
 * 支持 Lite 和 Pro 版本，支持文生视频、图生视频、参考生视频三种模式
 */
export const falAiBytedanceSeedanceRoute: FalModelRoute = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId.includes('seedance') ||
    modelId === 'fal-ai-bytedance-seedance',

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const {
      prompt = '',
      images = [],
      videoDuration = 5,
      seedanceMode = 'text-to-video',
      seedanceVersion = 'lite',
      seedanceResolution = '720p',
      seedanceCameraFixed = false,
      seedanceFastMode = true,
      seedanceAspectRatio
    } = params

    const hasImages = images.length > 0

    // 根据模式、版本和快速模式选择API端点
    let endpoint: string
    const modelId = 'fal-ai/bytedance/seedance/v1' // 轮询时使用不带subpath的modelId

    // 确定版本路径
    const versionPath = seedanceVersion === 'pro' ? 'pro' : 'lite'

    // 确定是否使用快速模式（仅 Pro 版本的文生视频和图生视频支持）
    const useFastMode = seedanceFastMode && seedanceVersion === 'pro' && seedanceMode !== 'reference-to-video'
    const fastPath = useFastMode ? '/fast' : ''

    if (seedanceMode === 'reference-to-video') {
      // 参考生视频模式（仅 Lite 版本支持）
      if (images.length === 0) {
        throw new Error('参考生视频模式需要至少1张图片')
      }
      endpoint = `fal-ai/bytedance/seedance/v1/lite/reference-to-video`
    } else if (seedanceMode === 'image-to-video') {
      // 图生视频模式
      if (images.length === 0) {
        throw new Error('图生视频模式需要至少1张图片')
      }
      endpoint = `fal-ai/bytedance/seedance/v1/${versionPath}${fastPath}/image-to-video`
    } else {
      // 文生视频模式
      endpoint = `fal-ai/bytedance/seedance/v1/${versionPath}${fastPath}/text-to-video`
    }

    // 构建请求数据
    const requestData: any = {
      prompt,
      duration: `${videoDuration}`,
      enable_safety_checker: false
    }

    // 添加分辨率参数
    if (seedanceResolution) {
      requestData.resolution = seedanceResolution
    }

    // 添加固定相机参数
    if (seedanceCameraFixed !== undefined) {
      requestData.camera_fixed = seedanceCameraFixed
    }

    // 处理宽高比参数
    let aspectRatio = seedanceAspectRatio

    // 智能匹配：如果是 smart 或 auto，且有图片，则计算实际宽高比
    if ((aspectRatio === 'smart' || aspectRatio === 'auto') && hasImages) {
      try {
        const firstImageUrl = images[0]
        const ratio = await getImageAspectRatio(firstImageUrl)
        aspectRatio = matchAspectRatio(ratio)
        logInfo('', `[Seedance] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
      } catch (error) {
        logError('[Seedance] 计算图片宽高比失败:', error)
        // 如果计算失败，使用默认宽高比
        aspectRatio = seedanceMode === 'text-to-video' ? '16:9' : 'auto'
      }
    }

    // 只传递实际的比例值（不传递 smart）
    // 注意：'auto' 是 API 支持的有效值，需要传递
    if (aspectRatio && aspectRatio !== 'smart') {
      requestData.aspect_ratio = aspectRatio
    }

    // 处理图片参数
    if (hasImages) {
      if (seedanceMode === 'reference-to-video') {
        // 参考生视频模式：使用 reference_image_urls（支持多张图片）
        requestData.reference_image_urls = images
      } else if (seedanceMode === 'image-to-video') {
        // 图生视频模式：使用 image_url 和可选的 end_image_url
        requestData.image_url = images[0]
        if (images.length >= 2) {
          // 如果有第二张图片，作为结束帧
          requestData.end_image_url = images[1]
        }
      }
    }

    return { endpoint, modelId, requestData }
  }
}
