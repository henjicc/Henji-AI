import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

export interface KIEModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: any) => {
    requestData: any
  }
  buildVideoRequest?: (params: GenerateVideoParams) => {
    requestData: any
  }
}

/**
 * KIE Hailuo 2.3 图生视频模型路由
 *
 * 特点：
 * - 图生视频模型（必须上传图片）
 * - 支持标准和专业两种模式
 * - 标准模式：hailuo/2-3-image-to-video-standard
 * - 专业模式：hailuo/2-3-image-to-video-pro
 * - 1080P 分辨率不支持 10 秒时长
 */
export const kieHailuo23Route: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-hailuo-2-3' ||
    modelId === 'hailuo-2-3-kie',

  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 获取模式参数（standard 或 pro）
    const mode = (params as any).mode || 'standard'

    // 根据模式选择端点
    const model = mode === 'pro'
      ? 'hailuo/2-3-image-to-video-pro'
      : 'hailuo/2-3-image-to-video-standard'

    // 获取时长和分辨率参数
    const duration = params.duration || 6
    const resolution = params.resolution || '768P'

    // 构建请求数据
    const requestData: any = {
      model: model,
      input: {
        prompt: prompt,
        // 图片 URL（必须，取第一张图片）
        image_url: images.length > 0 ? images[0] : '',
        // 时长（转换为字符串）
        duration: String(duration),
        // 分辨率
        resolution: resolution
      }
    }

    return { requestData }
  }
}
