import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * PPIO Kling O1 模型路由
 * 支持 4 种模式：文/图生视频、首尾帧、参考生视频、视频编辑
 */
export const klingO1Route = {
  matches: (modelId: string): modelId is 'kling-o1' => modelId === 'kling-o1',

  buildVideoRequest: async (params: GenerateVideoParams): Promise<{ endpoint: string; requestData: any }> => {
    const mode = (params.mode as string) || 'text-image-to-video'
    const images = params.images || []
    const video = params.video
    const duration = params.duration || 5
    const aspectRatio = params.aspectRatio || '16:9'
    const keepAudio = params.keepAudio !== undefined ? params.keepAudio : true
    const fastMode = params.fastMode || false
    const prompt = (params.prompt || '').slice(0, 2500)

    if (!prompt || prompt.trim() === '') {
      throw new Error('视频生成需要提供非空的 prompt')
    }

    let endpoint: string
    let requestData: any = {
      prompt,
      duration
    }

    switch (mode) {
      case 'text-image-to-video':
        // 文/图生视频：根据图片数量智能选择端点
        if (images.length === 0) {
          // 无图片 → 文生视频
          endpoint = '/async/kling-o1-t2v'
          requestData.aspect_ratio = aspectRatio
        } else {
          // 有图片 → 图生视频
          endpoint = '/async/kling-o1-i2v'
          requestData.image = images[0]

          // 如果有第二张图片，作为末帧
          if (images.length > 1) {
            requestData.last_image = images[1]
          }

          requestData.aspect_ratio = aspectRatio
        }
        break

      case 'start-end-frame':
        // 首尾帧：强制要求2张图片
        if (images.length < 2) {
          throw new Error('首尾帧模式需要上传2张图片')
        }
        endpoint = '/async/kling-o1-i2v'
        requestData.image = images[0]
        requestData.last_image = images[1]
        requestData.aspect_ratio = aspectRatio
        break

      case 'reference-to-video':
        // 参考生视频
        if (!video) {
          throw new Error('参考生视频模式需要上传视频')
        }

        // 上传视频到 Fal CDN
        const videoUrl = await uploadVideoToFal(video)

        endpoint = '/async/kling-o1-ref2v'
        requestData.video = videoUrl
        requestData.aspect_ratio = aspectRatio
        requestData.keep_original_sound = keepAudio

        // 可选的参考图片（最多7张）
        if (images.length > 0) {
          requestData.images = images.slice(0, 7)
        }
        break

      case 'video-edit':
        // 视频编辑
        if (!video) {
          throw new Error('视频编辑模式需要上传视频')
        }

        // 上传视频到 Fal CDN
        const editVideoUrl = await uploadVideoToFal(video)

        endpoint = '/async/kling-o1-video-edit'
        requestData.video = editVideoUrl
        requestData.fast_mode = fastMode
        requestData.keep_original_sound = keepAudio

        // 可选的参考图片（最多4张）
        if (images.length > 0) {
          requestData.images = images.slice(0, 4)
        }

        // 可选的宽高比
        if (aspectRatio) {
          requestData.aspect_ratio = aspectRatio
        }
        break

      default:
        throw new Error(`不支持的 Kling O1 模式: ${mode}`)
    }

    return { endpoint, requestData }
  }
}

/**
 * 上传视频到 Fal CDN
 * 将 File 对象转换为 base64，然后上传到 Fal CDN 获取 URL
 */
async function uploadVideoToFal(video: File | string): Promise<string> {
  // 如果已经是 URL，直接返回
  if (typeof video === 'string') {
    return video
  }

  try {
    // 将 File 转换为 base64
    const base64 = await fileToBase64(video)

    // 获取 Fal API Key
    const falApiKey = localStorage.getItem('fal_api_key')
    if (!falApiKey) {
      throw new Error('未配置 Fal API Key，无法上传视频')
    }

    // 上传到 Fal CDN
    const { uploadToFalCDN } = await import('@/utils/falUpload')
    const url = await uploadToFalCDN(base64, falApiKey)

    return url
  } catch (error) {
    throw new Error(`视频上传失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 将 File 对象转换为 base64 字符串
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
