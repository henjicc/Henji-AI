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
 * KIE Sora 2 视频模型路由
 *
 * 特点：
 * - 支持文生视频和图生视频（根据图片数量自动切换端点）
 * - 支持标准模式和专业模式（Pro）
 * - 标准模式：sora-2-text-to-video / sora-2-image-to-video
 * - 专业模式：sora-2-pro-text-to-video / sora-2-pro-image-to-video
 * - 最多支持 1 张图片
 * - 专业模式支持画质选择（标准/高）
 * - 始终发送 remove_watermark: true
 */
export const kieSora2Route: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-sora-2' ||
    modelId === 'sora-2-kie',

  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 获取参数
    // 重要：优先使用 API 参数名（已被 OptionsBuilder 转换），然后回退到 UI 参数名
    // 因为 finalOptions 同时包含 API 参数和 UI 参数，API 参数是已转换的正确值
    const mode = (params as any).mode || (params as any).kieSora2Mode || 'standard'
    const duration = (params as any).duration || (params as any).kieSora2Duration || '10'
    const aspectRatio = (params as any).aspect_ratio || (params as any).kieSora2AspectRatio || '16:9'
    const quality = (params as any).quality || (params as any).kieSora2Quality || 'standard'

    // 判断是否使用 Pro 端点
    const usePro = mode === 'professional'

    // 根据图片数量和是否使用 Pro 端点选择模型
    let model: string
    if (images.length === 0) {
      // 文生视频
      model = usePro
        ? 'sora-2-pro-text-to-video'
        : 'sora-2-text-to-video'
    } else {
      // 图生视频（1张图片）
      model = usePro
        ? 'sora-2-pro-image-to-video'
        : 'sora-2-image-to-video'
    }

    // 构建请求数据
    const requestData: any = {
      model: model,
      input: {
        prompt: prompt
      }
    }

    // 添加宽高比参数（过滤 'smart'）
    // 注意：格式转换（16:9 -> landscape）已在 OptionsBuilder 的 transform 中完成
    if (aspectRatio && aspectRatio !== 'smart') {
      requestData.input.aspect_ratio = aspectRatio
    }

    // 添加时长参数（n_frames）
    requestData.input.n_frames = duration

    // 专业模式：添加画质参数（size）
    if (usePro) {
      requestData.input.size = quality
    }

    // 始终添加 remove_watermark 参数
    requestData.input.remove_watermark = true

    // 图生视频：添加图片 URL
    if (images.length > 0) {
      requestData.input.image_urls = [images[0]]  // 只使用第一张图片
    }

    return { requestData }
  }
}
