import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'
import { logError, logWarning, logInfo } from '../../../utils/errorLogger'

/**
 * Vidu Q1 模型路由
 */
export const viduQ1Route = {
  // 模型ID识别
  matches: (modelId: string) => modelId.includes('vidu-q1'),

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const mode = params.mode || 'text-image-to-video'
    const images = params.images || []

    logInfo('[viduRoute] 选择的模式:', mode)
    logInfo('[viduRoute] 图片数量:', images.length)

    let endpoint: string
    let requestData: any = {
      prompt: params.prompt,
      duration: params.duration || 5,
      resolution: params.resolution || '1080p',
      seed: params.seed,
      movement_amplitude: params.movementAmplitude || 'auto',
      bgm: params.bgm || false
    }

    switch (mode) {
      case 'text-image-to-video':
        // 文/图生视频：根据是否有图片选择端点
        if (images.length > 0) {
          endpoint = '/async/vidu-q1-img2video'
          requestData.images = [images[0]] // 只取第一张图片
          // 图生视频不支持 aspect_ratio 和 style
          logInfo('', '[viduRoute] 使用图生视频接口')
        } else {
          endpoint = '/async/vidu-q1-text2video'
          requestData.aspect_ratio = params.aspectRatio || '16:9'
          requestData.style = params.style || 'general'
          logInfo('', '[viduRoute] 使用文生视频接口')
        }
        break

      case 'start-end-frame':
        // 首尾帧：需要2张图片
        if (images.length < 2) {
          throw new Error('首尾帧模式需要至少2张图片')
        }
        endpoint = '/async/vidu-q1-startend2video'
        requestData.images = [images[0], images[1]] // 取前两张作为首尾帧
        // 首尾帧不支持 aspect_ratio 和 style
        logInfo('', '[viduRoute] 使用首尾帧接口')
        break

      case 'reference-to-video':
        // 参考生视频：需要1-7张图片且prompt必须
        if (images.length < 1 || images.length > 7) {
          throw new Error('参考生视频模式需要1-7张图片')
        }
        if (!params.prompt || params.prompt.trim() === '') {
          throw new Error('参考生视频模式必须提供文本提示词')
        }
        endpoint = '/async/vidu-q1-reference2video'
        requestData.images = images.slice(0, 7) // 最多取7张
        requestData.aspect_ratio = params.aspectRatio || '16:9'
        // 参考生视频不支持 style
        logInfo('', '[viduRoute] 使用参考生视频接口')
        break

      default:
        throw new Error(`Unsupported video mode: ${mode}`)
    }

    return { endpoint, requestData }
  }
}
