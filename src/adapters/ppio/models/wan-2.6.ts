import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { logInfo } from '../../../utils/errorLogger'

/**
 * PPIO Wan 2.6 模型路由
 * 支持三种模式：文生视频、图生视频、参考生视频
 */
export const wan26Route = {
  matches: (modelId: string): modelId is 'wan-2.6' => modelId === 'wan-2.6',

  buildVideoRequest: async (params: GenerateVideoParams): Promise<{ endpoint: string; requestData: any }> => {
    const mode = params.mode || 'text-image-to-video'
    const images = params.images || []
    const videos = params.videos || []
    const aspectRatio = params.aspectRatio || '16:9'
    const quality = params.quality || '720P'
    const duration = params.duration || 5
    const shotType = params.shotType || 'multi'
    const audio = params.audio !== undefined ? params.audio : true
    const promptExtend = params.promptExtend || false
    const prompt = (params.prompt || '').slice(0, 2000)

    if (!prompt.trim()) {
      throw new Error('视频生成需要提供非空的 prompt')
    }

    logInfo('[Wan 2.6] 构建请求 - 模式:', mode)
    logInfo('[Wan 2.6] 构建请求 - 图片数量:', images.length)
    logInfo('[Wan 2.6] 构建请求 - 视频数量:', videos.length)
    logInfo('[Wan 2.6] 构建请求 - 比例:', aspectRatio, '质量:', quality)

    let endpoint: string
    let requestData: any = {
      prompt,
      duration,
      shot_type: shotType,
      audio,
      prompt_extend: promptExtend,
      watermark: false  // 固定发送 false
    }

    // 分辨率映射表（比例 + 质量 → 具体数值）
    const resolutionMap: Record<string, Record<string, string>> = {
      '16:9': { '720P': '1280*720', '1080P': '1920*1080' },
      '9:16': { '720P': '720*1280', '1080P': '1080*1920' },
      '1:1': { '720P': '960*960', '1080P': '1440*1440' },
      '4:3': { '720P': '1088*832', '1080P': '1632*1248' },
      '3:4': { '720P': '832*1088', '1080P': '1248*1632' }
    }

    switch (mode) {
      case 'text-image-to-video':
        if (images.length > 0) {
          // 图生视频
          endpoint = '/async/wan2.6-i2v'
          requestData.img_url = images[0]  // Base64 编码
          requestData.resolution = quality  // 图生视频使用质量档位
          logInfo('[Wan 2.6] 使用图生视频端点, 分辨率:', quality)
        } else {
          // 文生视频
          endpoint = '/async/wan2.6-t2v'
          const size = resolutionMap[aspectRatio]?.[quality] || '1280*720'
          requestData.size = size  // 文生视频使用具体数值
          logInfo('[Wan 2.6] 使用文生视频端点, 尺寸:', size)
        }
        break

      case 'reference-to-video':
        // 参考生视频
        if (videos.length === 0) {
          throw new Error('参考生视频模式需要上传至少 1 个视频')
        }

        endpoint = '/async/wan2.6-v2v'

        // 上传视频到通用上传服务
        logInfo('[Wan 2.6] 开始上传视频到通用服务, 数量:', videos.length)
        const videoUrls = await Promise.all(
          videos.slice(0, 3).map(video => uploadVideoToGeneralService(video))
        )
        logInfo('[Wan 2.6] 视频上传完成, URLs:', videoUrls)

        requestData.reference_video_urls = videoUrls.map(url => ({ url }))

        const size = resolutionMap[aspectRatio]?.[quality] || '1280*720'
        requestData.size = size  // 参考生视频使用具体数值
        logInfo('[Wan 2.6] 使用参考生视频端点, 尺寸:', size)
        break

      default:
        throw new Error(`不支持的 Wan 2.6 模式: ${mode}`)
    }

    logInfo('[Wan 2.6] 最终请求数据:', requestData)
    return { endpoint, requestData }
  }
}

/**
 * 上传视频到通用上传服务
 */
async function uploadVideoToGeneralService(video: File | string): Promise<string> {
  if (typeof video === 'string') {
    logInfo('[Wan 2.6] 视频已是 URL, 直接返回:', video)
    return video
  }

  try {
    logInfo('[Wan 2.6] 上传视频文件, 名称:', video.name, '大小:', video.size)
    const { UploadService } = await import('@/services/upload/UploadService')
    const uploadService = UploadService.getInstance()
    const url = await uploadService.uploadFile(video)
    logInfo('[Wan 2.6] 视频上传成功, URL:', url)
    return url
  } catch (error) {
    throw new Error(`视频上传失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}
