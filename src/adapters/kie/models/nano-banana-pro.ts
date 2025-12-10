import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

export interface KIEModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: GenerateImageParams) => {
    requestData: any
  }
}

export const kieNanoBananaProRoute: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-nano-banana-pro' ||
    modelId === 'nano-banana-pro',

  buildImageRequest: (params: GenerateImageParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 构建请求数据
    const requestData: any = {
      model: 'nano-banana-pro',
      input: {
        prompt: prompt
      }
    }

    // 添加可选参数
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'smart' &&
        params.aspect_ratio !== 'auto') {
      requestData.input.aspect_ratio = params.aspect_ratio
    }

    if (params.resolution !== undefined) {
      requestData.input.resolution = params.resolution
    }

    // 如果有图片，添加到 image_input（KIE 已上传的 URL）
    if (images.length > 0) {
      requestData.input.image_input = images
    }

    // 添加回调 URL（可选，如果需要）
    // requestData.callBackUrl = 'https://your-domain.com/api/callback'

    return { requestData }
  }
}
