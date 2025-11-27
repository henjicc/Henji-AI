import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * Wan 2.5 Preview 模型路由
 */
export const wan25PreviewRoute = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'wan-2.5-preview',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const duration = params.duration || 5
    const prompt_extend = params.promptExtend === undefined ? true : params.promptExtend
    const audio = params.audio === undefined ? true : params.audio

    let endpoint: string
    let requestData: any

    if (images.length > 0) {
      // 图生视频
      endpoint = '/async/wan-2.5-i2v-preview'
      const img0 = images[0]
      const imgUrl = typeof img0 === 'string'
        ? (img0.startsWith('data:') ? img0 : `data:image/jpeg;base64,${img0}`)
        : img0
      requestData = {
        input: {
          prompt: params.prompt,
          negative_prompt: params.negativePrompt,
          img_url: imgUrl
        },
        parameters: {
          resolution: (params.resolution || '1080P'),
          duration,
          prompt_extend,
          watermark: false,
          audio
        }
      }
    } else {
      // 文生视频
      endpoint = '/async/wan-2.5-t2v-preview'
      requestData = {
        input: {
          prompt: params.prompt,
          negative_prompt: params.negativePrompt
        },
        parameters: {
          size: params.size || '1920*1080',
          duration,
          prompt_extend,
          watermark: false,
          audio
        }
      }
    }

    return { endpoint, requestData }
  }
}
