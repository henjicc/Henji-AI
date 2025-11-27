import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * Seedance V1 模型路由
 */
export const seedanceV1Route = {
  // 模型ID识别
  matches: (modelId: string) =>
    modelId === 'seedance-v1-lite' ||
    modelId === 'seedance-v1-pro' ||
    modelId === 'seedance-v1',

  // 构建视频生成请求
  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const resolution = params.resolution || '720p'
    const aspect = params.aspectRatio || '16:9'
    const duration = params.duration || 5
    const camera_fixed = params.cameraFixed || false

    let endpoint: string
    let requestData: any

    // 确定变体（lite 或 pro）
    let variant = 'lite'
    if (params.model === 'seedance-v1-pro') {
      variant = 'pro'
    } else if (params.model === 'seedance-v1' && (params as any).seedanceVariant) {
      variant = (params as any).seedanceVariant === 'pro' ? 'pro' : 'lite'
    }

    if (images.length > 0) {
      // 图生视频
      endpoint = `/async/seedance-v1-${variant}-i2v`
      requestData = {
        prompt: params.prompt,
        image: images[0],
        resolution,
        aspect_ratio: aspect,
        camera_fixed,
        seed: -1,
        duration
      }

      // 添加 last_image 参数（如果提供）
      if (params.lastImage || (params as any).lastImage) {
        requestData.last_image = params.lastImage || (params as any).lastImage
      }
    } else {
      // 文生视频
      endpoint = `/async/seedance-v1-${variant}-t2v`
      requestData = {
        prompt: params.prompt,
        resolution,
        aspect_ratio: aspect,
        duration,
        camera_fixed,
        seed: -1
      }
    }

    return { endpoint, requestData }
  }
}
