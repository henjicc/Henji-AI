import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

export interface KIEModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params: GenerateImageParams) => {
    requestData: any
  }
}

export const kieGrokImagineRoute: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-grok-imagine' ||
    modelId === 'grok-imagine-kie',

  buildImageRequest: (params: GenerateImageParams) => {
    const prompt = params.prompt || ''

    // 构建请求数据
    const requestData: any = {
      model: 'grok-imagine/text-to-image',
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

    // 注意：Grok Imagine 不支持图片输入，仅支持文本生成图片
    // 不需要处理 images 参数

    // 添加回调 URL（可选，如果需要）
    // requestData.callBackUrl = 'https://your-domain.com/api/callback'

    return { requestData }
  }
}
