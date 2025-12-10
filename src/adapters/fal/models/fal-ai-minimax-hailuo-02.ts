import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { FalModelRoute } from './index'

/**
 * Fal.ai MiniMax Hailuo 02 模型路由
 * 支持 5 个端点：
 * - Standard Text-to-Video (768P 固定)
 * - Standard Image-to-Video (512P/768P，支持首尾帧)
 * - Pro Text-to-Video (1080P 固定，6s 固定)
 * - Pro Image-to-Video (1080P 固定，6s 固定，支持首尾帧)
 * - Fast Image-to-Video (512P 固定，不支持首尾帧)
 */
export const falAiMinimaxHailuo02Route: FalModelRoute = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId.includes('minimax-hailuo-02-fal') ||
    modelId.includes('fal-ai-minimax-hailuo-02') ||
    modelId === 'minimax-hailuo-02-fal' ||
    modelId === 'fal-ai-minimax-hailuo-02',

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const { prompt, images = [] } = params
    const imageCount = images.length

    // 获取参数（直接从 OptionsBuilder 映射的参数）
    const version = params.hailuo02Version || 'standard' // 'standard' or 'pro'
    const resolution = params.hailuo02Resolution || '768P' // '512P', '768P', or '1080P'
    const duration = params.duration || '6' // '6' or '10'
    const promptOptimizer = params.prompt_optimizer !== undefined ? params.prompt_optimizer : true
    const fastMode = params.hailuo02FastMode !== undefined ? params.hailuo02FastMode : false

    console.log('[Hailuo 02] 接收到的参数:', {
      version,
      resolution,
      duration,
      durationType: typeof duration,
      promptOptimizer,
      fastMode,
      imageCount
    })

    // 根据图片数量、版本、快速模式选择端点
    let endpoint: string
    const modelId = 'fal-ai/minimax/hailuo-02' // 轮询时使用的基础 modelId

    if (imageCount === 0) {
      // 文生视频模式
      if (version === 'pro') {
        // Pro Text-to-Video (1080P 固定，6s 固定)
        endpoint = 'fal-ai/minimax/hailuo-02/pro/text-to-video'
      } else {
        // Standard Text-to-Video (768P 固定)
        endpoint = 'fal-ai/minimax/hailuo-02/standard/text-to-video'
      }
    } else if (imageCount === 1) {
      // 单图模式
      if (fastMode) {
        // Fast Image-to-Video (512P 固定)
        endpoint = 'fal-ai/minimax/hailuo-02-fast/image-to-video'
      } else if (version === 'pro') {
        // Pro Image-to-Video (1080P 固定，6s 固定)
        endpoint = 'fal-ai/minimax/hailuo-02/pro/image-to-video'
      } else {
        // Standard Image-to-Video (512P/768P)
        endpoint = 'fal-ai/minimax/hailuo-02/standard/image-to-video'
      }
    } else {
      // 双图模式（首尾帧）
      if (version === 'pro') {
        // Pro Image-to-Video (1080P 固定，6s 固定，支持首尾帧)
        endpoint = 'fal-ai/minimax/hailuo-02/pro/image-to-video'
      } else {
        // Standard Image-to-Video (512P/768P，支持首尾帧)
        endpoint = 'fal-ai/minimax/hailuo-02/standard/image-to-video'
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
    // Standard 版本和 Fast 模式都支持 6s 和 10s
    if (version === 'standard') {
      requestData.duration = duration
    }

    // 添加分辨率参数
    // 注意：
    // - Pro 版本固定 1080P，不传递 resolution 参数
    // - Fast 模式固定 512P，不传递 resolution 参数
    // - Standard Text-to-Video 固定 768P，不传递 resolution 参数
    // - Standard Image-to-Video 支持 512P/768P，需要传递 resolution 参数
    if (version === 'standard' && imageCount > 0 && !fastMode) {
      requestData.resolution = resolution
    }

    // 图生视频时添加图片 URL
    if (imageCount === 1) {
      // 单图模式
      requestData.image_url = images[0]
    } else if (imageCount === 2) {
      // 双图模式（首尾帧）
      requestData.first_frame_image_url = images[0]
      requestData.last_frame_image_url = images[1]
    }

    console.log('[Hailuo 02] 端点选择:', {
      version,
      resolution,
      imageCount,
      fastMode,
      endpoint,
      duration: version === 'standard' && !fastMode ? duration : '6 (fixed)',
      requestData
    })

    return { endpoint, modelId, requestData }
  }
}
