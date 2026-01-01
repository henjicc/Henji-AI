import { GenerateImageParams } from '@/adapters/base/BaseAdapter'

/**
 * 即梦图片模型路由
 * 支持 seedream-4.0 和 seedream-4.5
 */
export const seedream40Route = {
  // 模型ID识别
  matches: (modelId: string) => modelId.includes('seedream') && !modelId.includes('kie'),

  // 构建图片生成请求
  buildImageRequest: (params: GenerateImageParams) => {
    const is45 = params.model === 'seedream-4.5'
    const endpoint = is45 ? '/seedream-4.5' : '/seedream-4.0'

    const requestData: any = {
      prompt: params.prompt,
      watermark: false // 始终不添加水印
    }

    // 处理分辨率设置
    if (params.size) {
      requestData.size = params.size
    }

    if (is45) {
      // Seedream 4.5 特定参数处理
      // 图片参数：使用 image 而不是 images
      if (params.images && params.images.length > 0) {
        requestData.image = params.images
      }

      // 组图设置
      if (params.sequential_image_generation !== undefined) {
        requestData.sequential_image_generation = params.sequential_image_generation

        // max_images 嵌套在 sequential_image_generation_options 中
        if (params.max_images !== undefined && params.sequential_image_generation === 'auto') {
          requestData.sequential_image_generation_options = {
            max_images: params.max_images
          }

          // workaround: Seedream 4.5 需要在提示词中显式指定生成数量才能触发多图生成
          if (params.max_images > 1) {
            requestData.prompt = `Generate ${params.max_images} images. ${requestData.prompt}`
          }
        }
      }

      // 提示词优化
      if (params.optimize_prompt === true) {
        requestData.optimize_prompt_options = {
          mode: 'standard'
        }
      }
    } else {
      // Seedream 4.0 特定参数处理
      if (params.images && params.images.length > 0) {
        requestData.images = params.images
      }

      if (params.sequential_image_generation !== undefined) {
        requestData.sequential_image_generation = params.sequential_image_generation
      }

      if (params.max_images !== undefined) {
        requestData.max_images = params.max_images

        // workaround: 为 Seedream 4.0 也应用同样的提示词修复
        if (params.max_images > 1) {
          requestData.prompt = `Generate ${params.max_images} images. ${requestData.prompt}`
        }
      }
    }

    return { endpoint, requestData }
  }
}

