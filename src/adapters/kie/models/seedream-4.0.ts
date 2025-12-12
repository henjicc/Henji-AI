import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

export interface KIEModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: GenerateImageParams) => {
    requestData: any
  }
}

export const kieSeedream40Route: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-seedream-4.0' ||
    modelId === 'seedream-4.0-kie',

  buildImageRequest: (params: GenerateImageParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 根据图片数量自动选择模型端点
    // 无图片：文生图 (bytedance/seedream-v4-text-to-image)
    // 有图片：图片编辑 (bytedance/seedream-v4-edit)
    const modelName = images.length === 0
      ? 'bytedance/seedream-v4-text-to-image'
      : 'bytedance/seedream-v4-edit'

    // 构建请求数据
    const requestData: any = {
      model: modelName,
      input: {
        prompt: prompt
      }
    }

    // 添加 image_size 参数
    // 注意：image_size 已经在 OptionsBuilder 中通过 transform 转换为 API 格式
    // 例如：'16:9' → 'landscape_16_9', '1:1' → 'square_hd'
    if (params.image_size !== undefined &&
        params.image_size !== 'smart' &&
        params.image_size !== 'auto') {
      requestData.input.image_size = params.image_size
    }

    // 添加 image_resolution 参数
    // 直接传递 2K/4K，不需要转换
    if (params.image_resolution !== undefined) {
      requestData.input.image_resolution = params.image_resolution
    }

    // 添加 max_images 参数
    if (params.max_images !== undefined) {
      requestData.input.max_images = params.max_images
    }

    // 如果有图片，添加到 image_urls（KIE 已上传的 URL）
    // 图片编辑端点使用 image_urls 参数
    if (images.length > 0) {
      requestData.input.image_urls = images
    }

    // 注意：seed 参数不传递给 API（用户要求隐藏）

    return { requestData }
  }
}
