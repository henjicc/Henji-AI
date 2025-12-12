import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

export interface KIEModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: GenerateImageParams) => {
    requestData: any
  }
}

export const kieSeedream45Route: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-seedream-4.5' ||
    modelId === 'seedream-4.5-kie',

  buildImageRequest: (params: GenerateImageParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 根据图片数量自动选择模型端点
    // 无图片：文生图 (seedream/4.5-text-to-image)
    // 有图片：图片编辑 (seedream/4.5-edit)
    const modelName = images.length === 0
      ? 'seedream/4.5-text-to-image'
      : 'seedream/4.5-edit'

    // 构建请求数据
    const requestData: any = {
      model: modelName,
      input: {
        prompt: prompt
      }
    }

    // 添加宽高比参数（必填，过滤掉 'smart' 和 'auto'）
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'smart' &&
        params.aspect_ratio !== 'auto') {
      requestData.input.aspect_ratio = params.aspect_ratio
    }

    // 添加质量参数（必填）
    // 注意：quality 已经在 OptionsBuilder 中通过 transform 转换为 'basic'/'high'
    if (params.quality !== undefined) {
      requestData.input.quality = params.quality
    }

    // 如果有图片，添加到 image_urls（KIE 已上传的 URL）
    // 图片编辑端点使用 image_urls 参数
    if (images.length > 0) {
      requestData.input.image_urls = images
    }

    // 注意：seed 和 negative_prompt 参数不传递给 API
    // 这些参数在 UI 中隐藏，也不会出现在 params 中

    return { requestData }
  }
}
