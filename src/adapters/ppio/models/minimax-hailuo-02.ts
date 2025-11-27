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
 * 海螺 02 模型路由
 */
export const minimaxHailuo02Route = {
  // 模型ID识别
  matches: (modelId: string) => modelId === 'minimax-hailuo-02',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const { duration: baseDuration, resolution: baseResolution } = normalizeHailuo(params.duration, params.resolution)
    const enable = params.promptExtend === undefined ? true : params.promptExtend

    const endpoint = '/async/minimax-hailuo-02'
    let requestData: any

    if (images.length >= 2) {
      // 首尾帧模式
      requestData = {
        prompt: params.prompt,
        image: images[0],
        end_image: images[1],
        duration: baseDuration,
        resolution: baseResolution,
        enable_prompt_expansion: enable
      }
    } else if (images.length === 1) {
      // 单图模式
      requestData = {
        prompt: params.prompt,
        image: images[0],
        duration: baseDuration,
        resolution: baseResolution,
        enable_prompt_expansion: enable
      }
    } else {
      // 文生视频模式
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
