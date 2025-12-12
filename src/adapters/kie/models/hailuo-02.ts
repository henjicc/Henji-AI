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
 * KIE Hailuo 02 视频模型路由
 *
 * 特点：
 * - 支持文生视频和图生视频（根据图片数量自动切换）
 * - 当 duration = 6s 且 resolution = 1080P 时，自动使用 Pro 端点（不传递参数）
 * - 其他情况使用 Standard 端点（传递 duration 和 resolution 参数）
 * - 最多支持 2 张图片（第二张作为 end_image_url）
 */
export const kieHailuo02Route: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-hailuo-02' ||
    modelId === 'hailuo-02-kie',

  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 获取时长和分辨率参数
    const duration = params.duration || 6
    const resolution = params.resolution || '768P'

    // 获取提示词优化参数
    const promptOptimizer = (params as any).prompt_optimizer || false

    // 判断是否使用 Pro 端点：6秒 + 1080P
    const usePro = duration === 6 && resolution === '1080P'

    // 根据图片数量和是否使用 Pro 端点选择模型
    let model: string
    if (images.length === 0) {
      // 文生视频
      model = usePro
        ? 'hailuo/02-text-to-video-pro'
        : 'hailuo/02-text-to-video-standard'
    } else {
      // 图生视频（1-2张图片）
      model = usePro
        ? 'hailuo/02-image-to-video-pro'
        : 'hailuo/02-image-to-video-standard'
    }

    // 构建请求数据
    const requestData: any = {
      model: model,
      input: {
        prompt: prompt
      }
    }

    // 添加图片参数（图生视频）
    if (images.length > 0) {
      // 第一张图片作为 image_url
      requestData.input.image_url = images[0]

      // 第二张图片作为 end_image_url（如果存在）
      if (images.length > 1) {
        requestData.input.end_image_url = images[1]
      }
    }

    // Standard 端点：添加时长和分辨率参数
    if (!usePro) {
      // 时长（转换为字符串）
      requestData.input.duration = String(duration)

      // 分辨率（仅图生视频支持）
      if (images.length > 0) {
        requestData.input.resolution = resolution
      }
    }

    // 添加提示词优化参数
    if (promptOptimizer) {
      requestData.input.prompt_optimizer = true
    }

    return { requestData }
  }
}
