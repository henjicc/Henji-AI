import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

/**
 * 即梦 4.0 模型路由
 */
export const seedream40Route = {
  // 模型ID识别
  matches: (modelId: string) => modelId.includes('seedream'),

  // 构建图片生成请求
  buildImageRequest: (params: GenerateImageParams) => {
    const endpoint = '/seedream-4.0'

    const requestData: any = {
      prompt: params.prompt,
      watermark: false // 默认不添加水印
    }

    // 处理上传的图片
    if (params.images && params.images.length > 0) {
      requestData.images = params.images
    }

    // 处理分辨率设置
    if (params.size) {
      requestData.size = params.size
    }

    // 处理即梦图片生成4.0的特定参数
    if (params.model === 'seedream-4.0') {
      if (params.sequential_image_generation !== undefined) {
        requestData.sequential_image_generation = params.sequential_image_generation
      }

      if (params.max_images !== undefined) {
        requestData.max_images = params.max_images
      }

      if (params.watermark !== undefined) {
        requestData.watermark = params.watermark
      }
    }

    return { endpoint, requestData }
  }
}
