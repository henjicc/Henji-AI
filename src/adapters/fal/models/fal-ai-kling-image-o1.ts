import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

/**
 * Kling Image O1 模型路由
 * 特点：图片编辑模型，必须上传图片，支持多图参考控制
 */
export const falAiKlingImageO1Route = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId === 'fal-ai/kling-image/o1' ||
    modelId === 'fal-ai-kling-image-o1' ||
    modelId === 'kling-o1',

  // 构建图片生成请求
  buildImageRequest: async (params: GenerateImageParams) => {
    const images = params.images || []

    // Kling Image O1 必须有图片输入（根据 API 文档，image_urls 是必需参数）
    if (images.length === 0) {
      throw new Error('可灵图片 O1 需要至少上传一张图片才能使用')
    }

    const submitPath = 'fal-ai/kling-image/o1'
    const modelId = 'fal-ai/kling-image/o1'

    const requestData: any = {
      prompt: params.prompt,
      image_urls: images  // 必需参数，已上传到 fal CDN
    }

    // 添加图片数量参数（只有在有值且不为默认值时才添加）
    if (params.num_images !== undefined && params.num_images !== null && params.num_images > 0) {
      requestData.num_images = params.num_images
    }

    // 处理 aspect_ratio：auto 需要智能匹配
    let aspectRatio = params.aspect_ratio

    if (aspectRatio === 'auto' && images.length > 0) {
      try {
        const { getImageAspectRatio, formatAspectRatio } = await import('@/utils/aspectRatio')
        const ratio = await getImageAspectRatio(images[0])
        aspectRatio = formatAspectRatio(ratio)
        console.log(`[Kling O1] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
      } catch (error) {
        console.error('[Kling O1] 计算图片宽高比失败:', error)
        aspectRatio = '1:1'  // 回退默认值
      }
    }

    // 只传递实际的比例值（不传递 'auto'、undefined、null、空字符串）
    if (aspectRatio && aspectRatio !== 'auto' && aspectRatio.trim() !== '') {
      requestData.aspect_ratio = aspectRatio
    }

    // 添加 resolution 参数（只有在有值且不为空时才添加）
    if (params.resolution !== undefined && params.resolution !== null && params.resolution.trim() !== '') {
      requestData.resolution = params.resolution
    }

    return { submitPath, modelId, requestData }
  }
}
