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
 * KIE Seedance V3 (即梦视频 3.0) 视频模型路由
 *
 * 特点：
 * - 支持文生视频和图生视频（根据图片数量自动切换）
 * - 最多支持 1 张图片（不支持首尾帧）
 * - 支持 Lite 和 Pro 版本
 * - Pro 版本的图生视频支持快速模式（Fast）
 *
 * 端点选择逻辑：
 * - 0张图片：文生视频
 *   - Lite: bytedance/v1-lite-text-to-video
 *   - Pro: bytedance/v1-pro-text-to-video
 * - 1张图片：图生视频
 *   - Lite: bytedance/v1-lite-image-to-video
 *   - Pro (非快速): bytedance/v1-pro-image-to-video
 *   - Pro (快速): bytedance/v1-pro-fast-image-to-video
 */
export const kieSeedanceV3Route: KIEModelRoute = {
  matches: (modelId: string) =>
    modelId === 'kie-seedance-v3' ||
    modelId === 'seedance-v3-kie',

  buildVideoRequest: (params: GenerateVideoParams) => {
    const images = params.images || []
    const prompt = params.prompt || ''

    // 获取版本和快速模式参数
    const version = (params as any).version || 'lite'
    const fastMode = (params as any).fast_mode !== undefined ? (params as any).fast_mode : true

    // 获取其他参数
    const aspectRatio = params.aspect_ratio || '16:9'

    // 验证和转换分辨率值（确保是有效的值）
    let resolution = params.resolution || '720p'
    const validResolutions = ['480p', '720p', '1080p']
    if (!validResolutions.includes(resolution)) {
      // 如果分辨率值无效（如 '2K', '4K' 等），使用默认值
      resolution = '720p'
    }

    const duration = params.duration || '5'
    const cameraFixed = (params as any).camera_fixed !== undefined ? (params as any).camera_fixed : false

    // 确定使用的模型端点
    let model: string
    if (images.length === 0) {
      // 文生视频
      if (version === 'pro') {
        model = 'bytedance/v1-pro-text-to-video'
      } else {
        model = 'bytedance/v1-lite-text-to-video'
      }
    } else {
      // 图生视频（1-2张图片）
      if (version === 'pro') {
        // Pro 版本：根据快速模式选择端点
        if (fastMode) {
          model = 'bytedance/v1-pro-fast-image-to-video'
        } else {
          model = 'bytedance/v1-pro-image-to-video'
        }
      } else {
        // Lite 版本
        model = 'bytedance/v1-lite-image-to-video'
      }
    }

    // 构建请求数据
    const requestData: any = {
      model: model,
      input: {
        prompt: prompt
      }
    }

    // 添加宽高比参数（仅文生视频需要，且过滤掉 'smart'）
    if (images.length === 0 && aspectRatio !== 'smart') {
      requestData.input.aspect_ratio = aspectRatio
    }

    // 添加分辨率参数
    requestData.input.resolution = resolution

    // 添加时长参数（转换为字符串）
    requestData.input.duration = String(duration)

    // 添加固定相机参数（仅非快速模式支持）
    // Pro Fast 端点不支持 camera_fixed 参数
    if (!(version === 'pro' && fastMode && images.length > 0)) {
      requestData.input.camera_fixed = cameraFixed
    }

    // 添加图片参数（图生视频，最多1张）
    if (images.length > 0) {
      requestData.input.image_url = images[0]
    }

    // 添加安全检查参数（始终设置为 false）
    requestData.input.enable_safety_checker = false

    // 注意：不添加 seed 参数（根据要求）

    return { requestData }
  }
}
