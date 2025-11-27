import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * 规范化海螺参数
 */
function normalizeHailuo(duration?: number, resolution?: string): { duration: number; resolution: string } {
  const d = duration === 10 ? 10 : 6
  const rInput = (resolution || '').toUpperCase()
  const r = d === 10 ? '768P' : (rInput === '1080P' ? '1080P' : '768P')
  return { duration: d, resolution: r }
}

/**
 * 海螺 2.3 模型路由
 */
export const minimaxHailuo23Route = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId === 'minimax-hailuo-2.3' ||
    modelId === 'minimax-hailuo-2.3-fast',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const { duration: baseDuration, resolution: baseResolution } = normalizeHailuo(params.duration, params.resolution)
    const enable = params.promptExtend === undefined ? true : params.promptExtend

    const isFast = (params.model === 'minimax-hailuo-2.3-fast') || (!!(params as any).hailuoFast && images.length > 0)

    let endpoint: string
    let requestData: any

    if (images.length > 0) {
      endpoint = isFast ? '/async/minimax-hailuo-2.3-fast-i2v' : '/async/minimax-hailuo-2.3-i2v'
      requestData = {
        prompt: params.prompt,
        image: images[0],
        duration: baseDuration,
        resolution: baseResolution,
        enable_prompt_expansion: enable
      }
    } else {
      endpoint = '/async/minimax-hailuo-2.3-t2v'
      requestData = {
        prompt: params.prompt,
        duration: baseDuration,
        resolution: baseResolution,
        enable_prompt_expansion: enable
      }
    }

    return { endpoint, requestData }
  }
}
