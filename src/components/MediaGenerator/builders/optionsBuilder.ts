import { saveUploadImage, dataUrlToBlob } from '@/utils/save'

/**
 * 生成选项构建器
 * 将原本 handleGenerate 中 370+ 行的选项构建逻辑提取出来
 */

interface BuildOptionsParams {
  currentModel: any
  selectedModel: string
  uploadedImages: string[]
  uploadedFilePaths: string[]
  setUploadedFilePaths: (paths: string[]) => void

  // 图片参数
  selectedResolution: string
  resolutionQuality: '2K' | '4K'
  customWidth: string
  customHeight: string
  isManualInput: boolean
  maxImages: number
  numImages: number
  aspectRatio: string
  resolution: string

  // 视频参数
  videoDuration: number
  videoAspectRatio: string
  videoResolution: string
  videoNegativePrompt: string
  videoSeed?: number

  // Vidu
  viduMode: string
  viduStyle: string
  viduMovementAmplitude: string
  viduBgm: boolean
  viduAspectRatio: string

  // Kling
  klingCfgScale: number

  // Hailuo
  hailuoFastMode: boolean
  minimaxEnablePromptExpansion: boolean

  // PixVerse
  pixFastMode: boolean
  pixStyle?: string

  // Wan
  wanSize: string
  wanResolution: string
  wanPromptExtend: boolean
  wanAudio: boolean

  // Seedance
  seedanceVariant: 'lite' | 'pro'
  seedanceResolution: string
  seedanceAspectRatio: string
  seedanceCameraFixed: boolean

  // Veo 3.1
  veoMode: string
  veoAspectRatio: string
  veoResolution: string
  veoEnhancePrompt: boolean
  veoGenerateAudio: boolean
  veoAutoFix: boolean
  veoFastMode: boolean

  // 音频
  audioSpeed: number
  audioEmotion: string
  voiceId: string
  audioSpec: 'hd' | 'turbo'
  audioVol: number
  audioPitch: number
  audioSampleRate: number
  audioBitrate: number
  audioFormat: string
  audioChannel: number
  latexRead: boolean
  textNormalization: boolean
  languageBoost: string

  // Z-Image-Turbo
  imageSize: string
  numInferenceSteps: number
  enablePromptExpansion: boolean
  acceleration: string

  // 魔搭
  steps: number
  guidance: number
  negativePrompt: string
  modelscopeCustomModel: string

  // 工具函数
  calculateSmartResolution: (imageDataUrl: string) => Promise<string>
  calculateSeedreamSmartResolution: (imageDataUrl: string) => Promise<string>
  calculatePPIOSeedreamSmartResolution: (imageDataUrl: string) => Promise<string>
}

export const buildGenerateOptions = async (params: BuildOptionsParams): Promise<any> => {
  const options: any = {}
  const {
    currentModel,
    selectedModel,
    uploadedImages,
    uploadedFilePaths,
    setUploadedFilePaths
  } = params

  // 图片模型处理（排除 nano-banana 系列、bytedance-seedream-v4 和 fal-ai-z-image-turbo）
  if (currentModel?.type === 'image' && selectedModel !== 'nano-banana' && selectedModel !== 'nano-banana-pro' && selectedModel !== 'bytedance-seedream-v4' && selectedModel !== 'fal-ai-z-image-turbo') {
    if (uploadedImages.length > 0) {
      options.images = uploadedImages
      const paths: string[] = [...uploadedFilePaths]
      for (let i = 0; i < uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }

    // 分辨率处理
    if (params.selectedResolution === 'smart') {
      if (uploadedImages.length > 0) {
        // 即梦模型使用专用算法，其他模型使用通用算法
        if (selectedModel === 'seedream-4.0') {
          const smartSize = await params.calculatePPIOSeedreamSmartResolution(uploadedImages[0])
          options.size = smartSize
        } else {
          const smartSize = await params.calculateSmartResolution(uploadedImages[0])
          options.size = smartSize
        }
      } else {
        options.size = params.resolutionQuality === '2K' ? '2048x2048' : '4096x4096'
      }
    } else if (params.customWidth && params.customHeight && !params.isManualInput) {
      options.size = `${params.customWidth}x${params.customHeight}`
    } else if (params.isManualInput && params.customWidth && params.customHeight) {
      options.size = `${params.customWidth}x${params.customHeight}`
    }

    // Seedream 4.0 特殊参数
    if (selectedModel === 'seedream-4.0') {
      if (params.maxImages > 1) {
        options.sequential_image_generation = 'auto'
        options.max_images = params.maxImages
      } else {
        options.sequential_image_generation = 'disabled'
      }
      options.watermark = false
    }
  }

  // Vidu Q1 视频模型
  if (currentModel?.type === 'video' && selectedModel === 'vidu-q1') {
    options.mode = params.viduMode
    options.duration = 5
    options.movementAmplitude = params.viduMovementAmplitude
    options.bgm = params.viduBgm

    if (params.viduMode === 'text-image-to-video') {
      if (uploadedImages.length > 0) {
        options.images = [uploadedImages[0]]
        const p0 = uploadedFilePaths[0]
        if (p0) {
          options.uploadedFilePaths = [p0]
        } else {
          const blob = await dataUrlToBlob(uploadedImages[0])
          const saved = await saveUploadImage(blob, 'persist')
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
      if (uploadedImages.length === 0) {
        options.aspectRatio = params.viduAspectRatio
        options.style = params.viduStyle
      }
    } else if (params.viduMode === 'start-end-frame') {
      if (uploadedImages.length < 2) {
        throw new Error('首尾帧模式需要至少2张图片')
      }
      options.images = uploadedImages.slice(0, 2)
      const existing = uploadedFilePaths.slice(0, 2)
      const paths: string[] = [...existing]
      for (let i = 0; i < options.images.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(options.images[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      options.uploadedFilePaths = paths
      setUploadedFilePaths(paths)
    } else if (params.viduMode === 'reference-to-video') {
      if (uploadedImages.length < 1 || uploadedImages.length > 7) {
        throw new Error('参考生视频模式需要1-7张图片')
      }
      options.images = uploadedImages.slice(0, 7)
      const existing = uploadedFilePaths.slice(0, 7)
      const paths: string[] = [...existing]
      for (let i = 0; i < options.images.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(options.images[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      options.uploadedFilePaths = paths
      setUploadedFilePaths(paths)
      options.aspectRatio = params.viduAspectRatio
    }
  }

  // Kling 2.5 Turbo
  else if (currentModel?.type === 'video' && selectedModel === 'kling-2.5-turbo') {
    options.duration = params.videoDuration
    options.cfgScale = params.klingCfgScale
    options.negativePrompt = params.videoNegativePrompt
    if (uploadedImages.length === 0) {
      options.aspectRatio = params.videoAspectRatio
    } else {
      options.images = [uploadedImages[0]]
      const p0 = uploadedFilePaths[0]
      if (p0) {
        options.uploadedFilePaths = [p0]
      } else {
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob, 'persist')
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
      }
    }
  }

  // Hailuo 2.3
  else if (currentModel?.type === 'video' && selectedModel === 'minimax-hailuo-2.3') {
    options.duration = params.videoDuration || 6
    options.resolution = params.videoResolution || '768P'
    options.promptExtend = params.minimaxEnablePromptExpansion
    if (uploadedImages.length > 0) {
      options.images = [uploadedImages[0]]
      const p0 = uploadedFilePaths[0]
      if (p0) {
        options.uploadedFilePaths = [p0]
      } else {
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob, 'persist')
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
      }
      options.hailuoFast = params.hailuoFastMode
    }
  }

  // Hailuo 02
  else if (currentModel?.type === 'video' && selectedModel === 'minimax-hailuo-02') {
    options.duration = params.videoDuration || 6
    options.resolution = params.videoResolution || '768P'
    options.promptExtend = params.minimaxEnablePromptExpansion
    if (uploadedImages.length > 0) {
      const take = Math.min(uploadedImages.length, 2)
      options.images = uploadedImages.slice(0, take)
      const existing = uploadedFilePaths.slice(0, take)
      const paths: string[] = [...existing]
      for (let i = 0; i < options.images.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(options.images[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      options.uploadedFilePaths = paths
      setUploadedFilePaths(paths)
    }
  }

  // PixVerse v4.5
  else if (currentModel?.type === 'video' && selectedModel === 'pixverse-v4.5') {
    options.resolution = params.videoResolution
    options.negativePrompt = params.videoNegativePrompt
    options.fastMode = params.pixFastMode
    options.style = params.pixStyle
    if (uploadedImages.length === 0) {
      options.aspectRatio = params.videoAspectRatio
    } else {
      options.images = [uploadedImages[0]]
      const p0 = uploadedFilePaths[0]
      if (p0) {
        options.uploadedFilePaths = [p0]
      } else {
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob, 'persist')
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
      }
    }
    if (params.videoSeed !== undefined) options.seed = params.videoSeed
  }

  // Wan 2.5 Preview
  else if (currentModel?.type === 'video' && selectedModel === 'wan-2.5-preview') {
    options.duration = params.videoDuration
    options.promptExtend = params.wanPromptExtend
    options.audio = params.wanAudio
    if (uploadedImages.length > 0) {
      options.images = [uploadedImages[0]]
      const p0 = uploadedFilePaths[0]
      if (p0) {
        options.uploadedFilePaths = [p0]
      } else {
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob, 'persist', { maxDimension: 2000 })
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
      }
      options.resolution = params.wanResolution
    } else {
      options.size = params.wanSize
    }
    options.negativePrompt = params.videoNegativePrompt
  }

  // Seedance v1 系列
  else if (currentModel?.type === 'video' && (selectedModel === 'seedance-v1' || selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro')) {
    options.resolution = params.seedanceResolution
    options.aspectRatio = params.seedanceAspectRatio
    options.duration = params.videoDuration
    options.cameraFixed = params.seedanceCameraFixed
    if (selectedModel === 'seedance-v1') {
      options.seedanceVariant = params.seedanceVariant
    }
    if (uploadedImages.length > 0) {
      const first = uploadedImages[0]
      options.images = [first]
      const paths: string[] = []
      const p0 = uploadedFilePaths[0]
      if (p0) {
        paths.push(p0)
      } else {
        const blob1 = await dataUrlToBlob(first)
        const saved1 = await saveUploadImage(blob1, 'persist', { maxDimension: 6000 })
        paths.push(saved1.fullPath)
      }
      if (uploadedImages.length > 1) {
        const last = uploadedImages[1]
        options.lastImage = last
        const p1 = uploadedFilePaths[1]
        if (p1) {
          paths.push(p1)
        } else {
          const blob2 = await dataUrlToBlob(last)
          const saved2 = await saveUploadImage(blob2, 'persist', { maxDimension: 6000 })
          paths.push(saved2.fullPath)
        }
      }
      options.uploadedFilePaths = paths
      setUploadedFilePaths(paths)
    }
  }

  // Veo 3.1
  else if (currentModel?.type === 'video' && selectedModel === 'veo3.1') {
    options.mode = params.veoMode
    options.duration = params.videoDuration
    options.aspectRatio = params.veoAspectRatio
    options.resolution = params.veoResolution
    options.veoEnhancePrompt = params.veoEnhancePrompt
    options.veoGenerateAudio = params.veoGenerateAudio
    options.veoAutoFix = params.veoAutoFix
    options.fastMode = params.veoFastMode

    if (uploadedImages.length > 0) {
      options.images = uploadedImages
      const paths: string[] = [...uploadedFilePaths]
      for (let i = 0; i < uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }
  }

  // 音频模型
  else if (currentModel?.type === 'audio') {
    options.speed = params.audioSpeed
    options.emotion = params.audioEmotion
    options.voiceId = params.voiceId
    options.output_format = 'url'
    options.spec = params.audioSpec
    options.vol = params.audioVol
    options.pitch = params.audioPitch
    options.sample_rate = params.audioSampleRate
    options.bitrate = params.audioBitrate
    options.format = params.audioFormat
    options.channel = params.audioChannel
    options.latex_read = params.latexRead
    options.text_normalization = params.textNormalization
    options.language_boost = params.languageBoost
  }

  // Nano Banana
  else if (currentModel?.type === 'image' && selectedModel === 'nano-banana') {
    options.num_images = params.numImages

    // 保存原始的 aspect_ratio 参数（用于历史记录恢复）
    let finalAspectRatio = params.aspectRatio

    // 如果是 'smart'，执行智能匹配
    if (params.aspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        finalAspectRatio = matches.aspect_ratio || params.aspectRatio
        console.log('[optionsBuilder] Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Smart match failed:', error)
        finalAspectRatio = params.aspectRatio
      }
    }

    // 传递给 API 的是最终的比例值
    options.aspect_ratio = finalAspectRatio
    console.log('[optionsBuilder] Nano Banana - aspect_ratio:', options.aspect_ratio)
    if (uploadedImages.length > 0) {
      options.images = uploadedImages
      const paths: string[] = [...uploadedFilePaths]
      for (let i = 0; i < uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }
  }

  // Nano Banana Pro
  else if (currentModel?.type === 'image' && selectedModel === 'nano-banana-pro') {
    options.model_id = 'nano-banana-pro'
    options.num_images = params.numImages

    // 如果是 'smart'，执行智能匹配
    if (params.aspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        options.aspect_ratio = matches.aspect_ratio || params.aspectRatio
        console.log('[optionsBuilder] Smart matched aspect_ratio:', options.aspect_ratio)
      } catch (error) {
        console.error('[optionsBuilder] Smart match failed:', error)
        options.aspect_ratio = params.aspectRatio
      }
    } else {
      options.aspect_ratio = params.aspectRatio
    }

    options.resolution = params.resolution
    if (uploadedImages.length > 0) {
      options.images = uploadedImages
      const paths: string[] = [...uploadedFilePaths]
      for (let i = 0; i < uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }
  }

  // ByteDance Seedream v4
  else if (currentModel?.type === 'image' && selectedModel === 'bytedance-seedream-v4') {
    options.numImages = params.numImages

    // 分辨率处理
    let width = 2048
    let height = 2048

    // 根据分辨率质量设置默认尺寸
    if (params.resolutionQuality === '4K') {
      width = 4096
      height = 4096
    }

    // 智能模式：使用即梦专用算法精确匹配原图比例
    if (params.selectedResolution === 'smart' && uploadedImages.length > 0) {
      // 使用即梦专用智能分辨率算法
      const smartSize = await params.calculateSeedreamSmartResolution(uploadedImages[0])
      const [w, h] = smartSize.split('x').map(Number)
      width = w
      height = h
      console.log('[optionsBuilder] bytedance-seedream-v4 智能模式:', { smartSize, width, height })
    }
    // 如果不是智能模式，根据宽高比调整尺寸
    else if (params.selectedResolution !== 'smart') {
      const [wRatio, hRatio] = params.selectedResolution.split(':').map(Number)
      if (wRatio > hRatio) {
        // 横屏
        height = Math.round(width * (hRatio / wRatio))
      } else {
        // 竖屏或正方形
        width = Math.round(height * (wRatio / hRatio))
      }
      console.log('[optionsBuilder] bytedance-seedream-v4 预设比例模式:', { selectedResolution: params.selectedResolution, width, height })

      // 如果有自定义输入，使用自定义尺寸（仅在非智能模式下生效）
      if (params.customWidth && params.customHeight) {
        width = parseInt(params.customWidth)
        height = parseInt(params.customHeight)
        console.log('[optionsBuilder] bytedance-seedream-v4 自定义尺寸:', { width, height })
      }
    }
    // 智能模式但没有上传图片，使用默认尺寸（已在上面设置）

    console.log('[optionsBuilder] bytedance-seedream-v4 最终分辨率:', { width, height, imageSize: `${width}*${height}` })
    options.imageSize = `${width}*${height}`

    // 处理上传的图片 - 使用 uploadedImages 参数名以匹配适配器
    if (uploadedImages.length > 0) {
      options.uploadedImages = uploadedImages
      options.images = uploadedImages  // 同时设置 images 以便历史记录显示
      const paths: string[] = [...uploadedFilePaths]
      for (let i = 0; i < uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }
  }

  // Z-Image-Turbo
  else if (currentModel?.type === 'image' && selectedModel === 'fal-ai-z-image-turbo') {
    // 处理 imageSize：根据 customWidth 和 customHeight 生成最终的尺寸字符串
    let finalImageSize: string

    // 优先使用 customWidth 和 customHeight（无论 imageSize 是什么）
    if (params.customWidth && params.customHeight) {
      const width = parseInt(params.customWidth)
      const height = parseInt(params.customHeight)
      if (!isNaN(width) && !isNaN(height)) {
        finalImageSize = `${width}*${height}`
      } else {
        // 如果解析失败，使用默认值 1:1 = 1440*1440
        finalImageSize = '1440*1440'
      }
    }
    // 如果没有自定义宽高，但 imageSize 是比例格式（如 "4:3"），使用预设尺寸
    else if (params.imageSize && params.imageSize.includes(':')) {
      const { presetSizes } = await import('@/models/fal-ai-z-image-turbo')
      const size = presetSizes[params.imageSize]

      if (size) {
        finalImageSize = `${size.width}*${size.height}`
      } else {
        // 如果找不到预设，使用默认值
        finalImageSize = '1440*1440'
      }
    }
    // 默认值
    else {
      finalImageSize = '1440*1440'
    }

    options.imageSize = finalImageSize
    options.numInferenceSteps = params.numInferenceSteps
    options.numImages = params.numImages
    options.enablePromptExpansion = params.enablePromptExpansion
    options.acceleration = params.acceleration

    console.log('[optionsBuilder] Z-Image-Turbo 分辨率:', {
      原始imageSize: params.imageSize,
      customWidth: params.customWidth,
      customHeight: params.customHeight,
      最终imageSize: finalImageSize
    })

    // 处理上传的图片
    if (uploadedImages.length > 0) {
      options.uploadedImages = uploadedImages
      options.images = uploadedImages  // 同时设置 images 以便历史记录显示
      const paths: string[] = [...uploadedFilePaths]
      for (let i = 0; i < uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }
      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }
  }

  // 魔搭模型（预设模型和自定义模型）
  else if (currentModel?.type === 'image' && (
    selectedModel === 'Tongyi-MAI/Z-Image-Turbo' ||
    selectedModel === 'MusePublic/Qwen-image' ||
    selectedModel === 'black-forest-labs/FLUX.1-Krea-dev' ||
    selectedModel === 'MusePublic/14_ckpt_SD_XL' ||
    selectedModel === 'MusePublic/majicMIX_realistic' ||
    selectedModel === 'modelscope-custom'
  )) {
    // 处理分辨率：从 imageSize (宽高比) 和 customWidth/customHeight 转换为 widthxheight 格式
    let width = 1024
    let height = 1024

    // 优先使用 customWidth 和 customHeight
    if (params.customWidth && params.customHeight) {
      width = parseInt(params.customWidth)
      height = parseInt(params.customHeight)
    }
    // 如果没有自定义宽高，但 imageSize 是比例格式（如 "4:3"），使用预设尺寸
    else if (params.imageSize && params.imageSize.includes(':')) {
      const { modelscopePresetSizes } = await import('@/models/modelscope-common')
      const size = modelscopePresetSizes[params.imageSize]

      if (size) {
        width = size.width
        height = size.height
      }
    }

    // 设置分辨率（魔搭API格式：widthxheight）
    options.width = width
    options.height = height

    // 设置其他参数
    options.steps = params.steps
    options.guidance = params.guidance
    if (params.negativePrompt) {
      options.negativePrompt = params.negativePrompt
    }

    // 对于自定义模型，需要设置实际的 model 值
    if (selectedModel === 'modelscope-custom') {
      if (!params.modelscopeCustomModel) {
        throw new Error('请先选择或添加自定义模型')
      }
      options.model = params.modelscopeCustomModel
    }

    console.log('[optionsBuilder] 魔搭模型参数:', {
      selectedModel,
      imageSize: params.imageSize,
      customWidth: params.customWidth,
      customHeight: params.customHeight,
      最终分辨率: `${width}x${height}`,
      steps: options.steps,
      guidance: options.guidance,
      model: options.model
    })
  }

  return options
}
