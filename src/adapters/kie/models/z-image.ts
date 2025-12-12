import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

export interface KIEModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: GenerateImageParams) => {
    requestData: any
  }
}

export const kieZImageRoute: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-z-image' ||
    modelId === 'z-image-kie',

  buildImageRequest: (params: GenerateImageParams) => {
    const prompt = params.prompt || ''

    // 构建请求数据
    const requestData: any = {
      model: 'z-image',
      input: {
        prompt: prompt
      }
    }

    // 添加可选参数：aspect_ratio
    if (params.aspect_ratio !== undefined &&
        params.aspect_ratio !== 'smart' &&
        params.aspect_ratio !== 'auto') {
      requestData.input.aspect_ratio = params.aspect_ratio
    }

    // 注意：Z-Image 不支持图片输入，仅支持文本生成图片
    // 不需要处理 images 参数

    return { requestData }
  }
}
