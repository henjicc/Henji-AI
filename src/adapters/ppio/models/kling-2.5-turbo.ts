import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * 可灵 2.5 Turbo 模型路由
 */
export const klingTurbo25Route = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'kling-2.5-turbo',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const cfgScale = typeof params.cfgScale === 'number' ? Math.max(0, Math.min(1, params.cfgScale)) : 0.5
    const duration = params.duration === 10 ? 10 : 5
    const prompt = (params.prompt || '').slice(0, 2500)
    const negative_prompt = params.negativePrompt ? params.negativePrompt.slice(0, 2500) : undefined
    const ar = ['16:9', '9:16', '1:1'].includes(params.aspectRatio || '') ? (params.aspectRatio as string) : '16:9'

    if (!prompt || prompt.trim() === '') {
      throw new Error('Kling 文生视频需要提供非空的 prompt')
    }

    let endpoint: string
    let requestData: any

    if (images.length > 0) {
      // 图生视频
      endpoint = '/async/kling-2.5-turbo-i2v'
      const img0 = images[0]
      const base64 = typeof img0 === 'string' && img0.startsWith('data:') ? img0.split(',')[1] : img0
      requestData = {
        image: base64,
        prompt,
        duration: String(duration),
        cfg_scale: cfgScale,
        mode: params.mode || 'pro',
        negative_prompt
      }
    } else {
      // 文生视频
      endpoint = '/async/kling-2.5-turbo-t2v'
      requestData = {
        prompt,
        duration: String(duration),
        aspect_ratio: ar,
        cfg_scale: cfgScale,
        mode: params.mode || 'pro',
        negative_prompt
      }
    }

    return { endpoint, requestData }
  }
}
