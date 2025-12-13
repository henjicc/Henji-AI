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
 * KIE Grok Imagine 视频模型路由
 *
 * 特点：
 * - 根据是否有图片自动切换端点
 * - 文生视频：grok-imagine/text-to-video
 * - 图生视频：grok-imagine/image-to-video（最多1张图）
 * - 图生视频时不支持 aspect_ratio 参数
 * - 图生视频时不支持 spicy 模式
 */
export const kieGrokImagineVideoRoute: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-grok-imagine-video' ||
    modelId === 'grok-imagine-video-kie',

  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''
    const hasImages = images.length > 0

    // 根据是否有图片选择端点
    const model = hasImages
      ? 'grok-imagine/image-to-video'  // 图生视频
      : 'grok-imagine/text-to-video'   // 文生视频

    // 构建请求数据
    const requestData: any = {
      model: model,
      input: {
        prompt: prompt
      }
    }

    // 文生视频：添加 aspect_ratio 参数
    if (!hasImages && params.aspect_ratio !== undefined) {
      requestData.input.aspect_ratio = params.aspect_ratio
    }

    // 图生视频：添加 image_urls 参数（最多1张图）
    if (hasImages) {
      requestData.input.image_urls = [images[0]]  // 只取第一张图片
    }

    // 添加 mode 参数（可选）
    if (params.mode !== undefined) {
      // 图生视频时，如果是 spicy 模式，改为 normal（因为不支持）
      if (hasImages && (params as any).mode === 'spicy') {
        requestData.input.mode = 'normal'
      } else {
        requestData.input.mode = params.mode
      }
    }

    // 注意：不传递 task_id、index、seed、negative_prompt 等参数

    return { requestData }
  }
}
