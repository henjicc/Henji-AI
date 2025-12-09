import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

/**
 * Fal.ai MiniMax Hailuo 2.3 模型路由
 * 支持 6 个端点：
 * - Standard Text-to-Video (768p)
 * - Standard Image-to-Video (768p)
 * - Pro Text-to-Video (1080p)
 * - Pro Image-to-Video (1080p)
 * - Fast Standard Image-to-Video (768p)
 * - Fast Pro Image-to-Video (1080p)
 */
export const falAiMinimaxHailuo23Route: FalModelRoute = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId.includes('minimax-hailuo-2.3-fal') ||
    modelId.includes('fal-ai-minimax-hailuo-2.3') ||
    modelId === 'minimax-hailuo-2.3-fal' ||
    modelId === 'fal-ai-minimax-hailuo-2.3',

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const { prompt, images = [] } = params
    const hasImages = images.length > 0

    // 获取参数（直接从 OptionsBuilder 映射的参数）
    // hailuoVersion 和 hailuoFastMode 是 OptionsBuilder 映射后的参数名
    const version = params.hailuoVersion || 'standard' // 'standard' or 'pro'
    const duration = params.duration || '6' // OptionsBuilder 已经确保这是字符串 '6' 或 '10'
    const promptOptimizer = params.prompt_optimizer !== undefined ? params.prompt_optimizer : true
    const fastMode = params.hailuoFastMode !== undefined ? params.hailuoFastMode : true

    console.log('[Hailuo 2.3] 接收到的参数:', {
      version,
      duration,
      durationType: typeof duration,
      promptOptimizer,
      fastMode,
      hasImages
    })

    // 根据版本、图片数量、快速模式选择端点
    let endpoint: string
    const modelId = 'fal-ai/minimax/hailuo-2.3' // 轮询时使用的基础 modelId

    if (hasImages) {
      // 图生视频模式
      if (fastMode) {
        // 快速模式（仅图生视频支持）
        if (version === 'pro') {
          endpoint = 'fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video'
        } else {
          endpoint = 'fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video'
        }
      } else {
        // 标准模式
        if (version === 'pro') {
          endpoint = 'fal-ai/minimax/hailuo-2.3/pro/image-to-video'
        } else {
          endpoint = 'fal-ai/minimax/hailuo-2.3/standard/image-to-video'
        }
      }
    } else {
      // 文生视频模式（不支持快速模式）
      if (version === 'pro') {
        endpoint = 'fal-ai/minimax/hailuo-2.3/pro/text-to-video'
      } else {
        endpoint = 'fal-ai/minimax/hailuo-2.3/standard/text-to-video'
      }
    }

    // 构建请求数据
    const requestData: any = {
      prompt
    }

    // 添加提示词优化参数
    if (promptOptimizer !== undefined) {
      requestData.prompt_optimizer = promptOptimizer
    }

    // 添加时长参数
    // 注意：Pro 版本固定 6 秒，不传递 duration 参数
    // Standard 版本支持 6s 和 10s
    if (version === 'standard') {
      requestData.duration = duration
    }
    // Pro 版本不传递 duration 参数（API 不支持）

    // 图生视频时添加图片 URL
    if (hasImages) {
      requestData.image_url = images[0]
    }

    console.log('[Hailuo 2.3] 端点选择:', {
      version,
      hasImages,
      fastMode,
      endpoint,
      duration: version === 'standard' ? duration : '6 (fixed)'
    })

    return { endpoint, modelId, requestData }
  }
}
