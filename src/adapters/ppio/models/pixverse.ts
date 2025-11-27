import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * 规范化 PixVerse 分辨率
 */
function normalizePixverseResolution(resolution?: string): string {
  const s = (resolution || '').toLowerCase()
  const allowed = ['360p', '540p', '720p', '1080p']
  return allowed.includes(s) ? s : '540p'
}

/**
 * PixVerse V4.5 模型路由
 */
export const pixverseV45Route = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'pixverse-v4.5',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const res = normalizePixverseResolution(params.resolution)
    const ar = params.aspectRatio || '16:9'
    const fast = params.fastMode || false

    let endpoint: string
    let requestData: any

    if (images.length > 0) {
      // 图生视频
      endpoint = '/async/pixverse-v4.5-i2v'
      const img0 = images[0]
      const base64 = typeof img0 === 'string' && img0.startsWith('data:') ? img0.split(',')[1] : img0
      // fast_mode 不支持 1080p
      const finalRes = fast && res === '1080p' ? '720p' : res
      requestData = {
        prompt: params.prompt,
        image: base64,
        resolution: finalRes,
        negative_prompt: params.negativePrompt,
        fast_mode: fast
      }
    } else {
      // 文生视频
      endpoint = '/async/pixverse-v4.5-t2v'
      const finalRes = fast && res === '1080p' ? '720p' : res
      requestData = {
        prompt: params.prompt,
        aspect_ratio: ar,
        resolution: finalRes,
        negative_prompt: params.negativePrompt,
        fast_mode: fast
      }
    }

    return { endpoint, requestData }
  }
}
