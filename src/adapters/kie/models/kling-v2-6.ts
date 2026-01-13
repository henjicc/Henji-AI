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
 * KIE Kling V2.6 视频模型路由
 *
 * 特点：
 * - 根据是否有图片自动切换端点
 * - 文生视频：kling-2.6/text-to-video
 * - 图生视频：kling-2.6/image-to-video（最多1张图）
 * - 图生视频时不支持 aspect_ratio 参数
 * - 支持音频生成（enable_audio 映射为 sound 参数）
 * - 不传递 negative_prompt、cfg_scale、seed 等参数
 */
export const kieKlingV26Route: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-kling-v2-6' ||
    modelId === 'kling-v2-6-kie',

  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''
    const hasImages = images.length > 0
    // 获取自定义参数
    const mode = params.kieKlingV26Mode || 'text-image-to-video'
    const resolution = params.kieKlingV26Resolution || '720p'
    const orientation = params.kieKlingV26CharacterOrientation || 'video'
    const videoUrl = params.video // 已由 Adapter 上传并转换为 URL (如果是文件)

    // 动作控制模式
    if (mode === 'motion-control') {
      if (!hasImages) {
        throw new Error('动作控制模式需要上传一张参考图片')
      }
      if (!videoUrl) {
        throw new Error('动作控制模式需要上传一个参考视频')
      }

      return {
        requestData: {
          model: 'kling-2.6/motion-control',
          input: {
            prompt: prompt,
            input_urls: images, // 数组格式
            video_urls: [videoUrl], // 数组格式
            character_orientation: orientation,
            mode: resolution
          }
        }
      }
    }

    // 文/图生视频模式（只有在非动作控制模式下才会执行到这里）
    const model = hasImages
      ? 'kling-2.6/image-to-video'  // 图生视频
      : 'kling-2.6/text-to-video'   // 文生视频

    // 构建请求数据
    const requestData: any = {
      model: model,
      input: {
        prompt: prompt
      }
    }

    // 添加 duration 参数（必填，默认 "5"）
    requestData.input.duration = params.duration ? String(params.duration) : '5'

    // 添加 sound 参数（必填，默认 false）
    // enable_audio 参数映射为 sound
    requestData.input.sound = params.enable_audio || false

    // 文生视频：添加 aspect_ratio 参数（必填，默认 "1:1"）
    if (!hasImages) {
      requestData.input.aspect_ratio = params.aspect_ratio || '16:9'
    }

    // 图生视频：添加 image_urls 参数（数组格式）
    if (hasImages) {
      requestData.input.image_urls = images  // 注意：API 使用 image_urls（复数，数组）
    }

    // 注意：不传递 negative_prompt、cfg_scale、seed 等参数

    return { requestData }
  }
}
