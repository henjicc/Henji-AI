import { GenerateImageParams } from '@/adapters/base/BaseAdapter'
import { logError, logInfo } from '../../../utils/errorLogger'

/**
 * Kling Image O1 模型路由
 * 特点：支持图片编辑和无图文字生成，支持多图参考控制
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

    const submitPath = 'fal-ai/kling-image/o1'
    const modelId = 'fal-ai/kling-image/o1'

    const requestData: any = {
      prompt: params.prompt,
      image_urls: images  // 已上传到 fal CDN，允许为空数组
    }

    // 添加图片数量参数（只有在有值且不为默认值时才添加）
    if (params.falKlingImageO1NumImages !== undefined && params.falKlingImageO1NumImages !== null && params.falKlingImageO1NumImages > 0) {
      requestData.num_images = params.falKlingImageO1NumImages
    }

    // 处理 aspect_ratio：auto 需要智能匹配
    let aspectRatio = params.aspect_ratio

    if (aspectRatio === 'auto' && images.length > 0) {
      try {
        const { getImageAspectRatio, formatAspectRatio } = await import('@/utils/aspectRatio')
        const ratio = await getImageAspectRatio(images[0])
        aspectRatio = formatAspectRatio(ratio)
        logInfo('', `[Kling O1] 智能计算宽高比: ${ratio.toFixed(2)}，匹配预设: ${aspectRatio}`)
      } catch (error) {
        logError('[Kling O1] 计算图片宽高比失败:', error)
        aspectRatio = '1:1'  // 回退默认值
      }
    } else if (aspectRatio === 'auto') {
      // 没有图片时，auto 宽高比回退到默认值
      aspectRatio = '1:1'
    }

    // 只传递实际的比例值（不传递 'auto'、undefined、null、空字符串）
    if (aspectRatio && aspectRatio !== 'auto' && aspectRatio.trim() !== '') {
      requestData.aspect_ratio = aspectRatio
    }

    // 添加 resolution 参数（只有在有值且不为空时才添加）
    const resolution = params.falKlingImageO1Resolution ?? params.resolution
    if (resolution !== undefined && resolution !== null && resolution.trim() !== '') {
      requestData.resolution = resolution
    }

    return { submitPath, modelId, requestData }
  }
}
