import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * 获取图片的宽高比
 */
async function getImageAspectRatio(imageUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // 检查是否是 data URL
    if (imageUrl.startsWith('data:')) {
      const img = new Image()
      img.onload = () => {
        resolve(img.width / img.height)
      }
      img.onerror = reject
      img.src = imageUrl
    } else {
      // 对于远程 URL，创建 Image 对象
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        resolve(img.width / img.height)
      }
      img.onerror = reject
      img.src = imageUrl
    }
  })
}

/**
 * 匹配最适合的预设宽高比
 */
function matchAspectRatio(aspectRatio: number): string {
  // 预设的宽高比选项
  const presetRatios = [
    { value: '16:9', ratio: 16 / 9 },
    { value: '9:16', ratio: 9 / 16 },
    { value: '1:1', ratio: 1 / 1 }
  ]

  // 找到最接近的预设宽高比
  let closestRatio = presetRatios[0]
  let minDiff = Math.abs(aspectRatio - closestRatio.ratio)

  for (const preset of presetRatios) {
    const diff = Math.abs(aspectRatio - preset.ratio)
    if (diff < minDiff) {
      minDiff = diff
      closestRatio = preset
    }
  }

  return closestRatio.value
}

/**
 * Fal.ai Veo 3.1 模型路由
 */
export const falAiVeo31Route = {
  // 模型ID识别
  matches: (modelId: string) => modelId.includes('veo3.1') || modelId.includes('veo-3.1'),

  // 构建视频生成请求
  buildVideoRequest: async (params: GenerateVideoParams) => {
    const { prompt, mode = 'text-image-to-video', images = [], duration = 8 } = params
    const hasImages = images.length > 0
    const isFastMode = params.fastMode || false

    // 根据模式和图片数量选择API端点
    let endpoint: string
    const modelId = 'fal-ai/veo3.1' // 轮询时使用不带subpath的modelId

    if (mode === 'start-end-frame') {
      // 首尾帧模式
      if (images.length < 2) {
        throw new Error('首尾帧模式需要至少2张图片')
      }
      endpoint = isFastMode
        ? 'fal-ai/veo3.1/fast/first-last-frame-to-video'
        : 'fal-ai/veo3.1/first-last-frame-to-video'
    } else if (mode === 'reference-to-video') {
      // 参考生视频模式
      if (images.length === 0) {
        throw new Error('参考生视频模式需要至少1张图片')
      }
      endpoint = 'fal-ai/veo3.1/reference-to-video'
    } else {
      // 文/图生视频模式
      if (hasImages) {
        // 图生视频
        endpoint = isFastMode
          ? 'fal-ai/veo3.1/fast/image-to-video'
          : 'fal-ai/veo3.1/image-to-video'
      } else {
        // 文生视频
        endpoint = isFastMode
          ? 'fal-ai/veo3.1/fast'
          : 'fal-ai/veo3.1'
      }
    }

    // 构建请求数据
    const requestData: any = {
      prompt,
      duration: `${duration}s`
    }

    // 添加可选参数
    // 优先使用veo特定的宽高比和分辨率参数
    let veoAspectRatio = params.veoAspectRatio || params.aspectRatio

    // 如果宽高比为auto，根据上传的第一张图片计算宽高比
    if (veoAspectRatio === 'auto' && hasImages) {
      try {
        // 获取第一张图片的宽高比
        const firstImageUrl = images[0]
        const aspectRatio = await getImageAspectRatio(firstImageUrl)

        // 匹配最适合的预设宽高比
        veoAspectRatio = matchAspectRatio(aspectRatio)
        console.log(`[veoRoute] 自动计算宽高比: ${aspectRatio.toFixed(2)}，匹配预设: ${veoAspectRatio}`)
      } catch (error) {
        console.error('[veoRoute] 计算图片宽高比失败:', error)
        // 如果计算失败，使用默认宽高比
        veoAspectRatio = '16:9'
      }
    }

    if (veoAspectRatio && veoAspectRatio !== 'auto') {
      requestData.aspect_ratio = veoAspectRatio
    }

    const veoResolution = params.veoResolution || params.resolution
    if (veoResolution) {
      requestData.resolution = veoResolution
    }

    if (params.veoEnhancePrompt !== undefined) {
      requestData.enhance_prompt = params.veoEnhancePrompt
    }

    if (params.veoGenerateAudio !== undefined) {
      requestData.generate_audio = params.veoGenerateAudio
    }

    if (params.veoAutoFix !== undefined) {
      requestData.auto_fix = params.veoAutoFix
    }

    // 处理图片
    if (hasImages) {
      if (mode === 'start-end-frame') {
        // 首尾帧模式：使用first_frame_url和last_frame_url
        requestData.first_frame_url = images[0]
        requestData.last_frame_url = images[1]
      } else if (mode === 'reference-to-video') {
        // 参考生视频模式：使用image_urls
        requestData.image_urls = images
      } else {
        // 文/图生视频模式：使用image_url
        requestData.image_url = images[0]
      }
    }

    return { endpoint, modelId, requestData }
  }
}
