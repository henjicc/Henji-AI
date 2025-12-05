import { saveUploadImage, saveUploadVideo, dataUrlToBlob } from '@/utils/save'

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
  uploadedVideoFilePaths: string[]
  setUploadedVideoFilePaths: (paths: string[]) => void

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

  // Seedance（派欧云）
  seedanceVariant: 'lite' | 'pro'
  seedanceResolution: string
  seedanceAspectRatio: string
  seedanceCameraFixed: boolean

  // Seedance v1（Fal）
  seedanceMode?: 'text-to-video' | 'image-to-video' | 'reference-to-video'
  seedanceVersion?: 'lite' | 'pro'
  seedanceFastMode?: boolean

  // Veo 3.1
  veoMode: string
  veoAspectRatio: string
  veoResolution: string
  veoEnhancePrompt: boolean
  veoGenerateAudio: boolean
  veoAutoFix: boolean
  veoFastMode: boolean

  // Kling Video O1
  klingMode?: string
  klingAspectRatio?: string
  klingKeepAudio?: boolean
  klingElements?: any[]
  uploadedVideos?: string[]  // 视频缩略图（用于 UI）
  uploadedVideoFiles?: File[]  // 视频 File 对象（延迟读取）

  // Kling v2.6 Pro
  klingV26AspectRatio?: string
  klingV26GenerateAudio?: boolean
  klingV26CfgScale?: number

  // Sora 2
  soraMode?: string
  soraAspectRatio?: string
  soraResolution?: string

  // LTX-2
  mode?: string  // LTX-2 模式
  ltxResolution?: string
  ltxFps?: number
  ltxGenerateAudio?: boolean
  ltxFastMode?: boolean
  ltxRetakeDuration?: number
  ltxRetakeStartTime?: number
  ltxRetakeMode?: string

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
  resolutionBaseSize: number

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
    setUploadedFilePaths,
    uploadedVideoFilePaths,
    setUploadedVideoFilePaths
  } = params

  // 图片模型处理（排除 nano-banana 系列、bytedance-seedream-v4/v4.5 和 fal-ai-z-image-turbo）
  if (currentModel?.type === 'image' &&
      selectedModel !== 'nano-banana' &&
      selectedModel !== 'nano-banana-pro' &&
      selectedModel !== 'fal-ai-nano-banana' &&
      selectedModel !== 'fal-ai-nano-banana-pro' &&
      selectedModel !== 'bytedance-seedream-v4' &&
      selectedModel !== 'bytedance-seedream-v4.5' &&
      selectedModel !== 'fal-ai-bytedance-seedream-v4' &&
      selectedModel !== 'fal-ai-bytedance-seedream-v4.5' &&
      selectedModel !== 'fal-ai-z-image-turbo' &&
      selectedModel !== 'fal-ai-kling-image-o1' &&
      selectedModel !== 'kling-o1') {
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
        // ⚠️ 派欧云即梦模型（seedream-4.0）使用专用算法，其他模型使用通用算法
        if (selectedModel === 'seedream-4.0') {
          // 派欧云即梦专用算法：宽高比 [1/16, 16]，最大 4096×4096
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

    // Seedream 4.0 (派欧云) 特殊参数
    // ⚠️ 重要：派欧云即梦模型使用专用分辨率计算，不使用基数系统
    // 分辨率约束：
    // - 宽高比范围：[1/16, 16]
    // - 最大总像素：严格不超过 4096×4096 = 16,777,216 像素
    // - 2K模式：目标 2048×2048 = 4,194,304 像素
    // - 4K模式：目标 4096×4096 = 16,777,216 像素
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

  // Seedance v1 系列（派欧云）
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

  // Bytedance Seedance v1（Fal）
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-bytedance-seedance-v1' || selectedModel === 'bytedance-seedance-v1')) {
    options.seedanceMode = params.seedanceMode
    options.seedanceVersion = params.seedanceVersion
    options.seedanceAspectRatio = params.seedanceAspectRatio
    options.seedanceResolution = params.seedanceResolution
    options.videoDuration = params.videoDuration
    options.seedanceCameraFixed = params.seedanceCameraFixed
    options.seedanceFastMode = params.seedanceFastMode

    // 处理图片上传
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

    console.log('[optionsBuilder] Bytedance Seedance v1 参数:', {
      mode: options.seedanceMode,
      version: options.seedanceVersion,
      aspectRatio: options.seedanceAspectRatio,
      resolution: options.seedanceResolution,
      duration: options.videoDuration,
      cameraFixed: options.seedanceCameraFixed,
      fastMode: options.seedanceFastMode,
      images: options.images?.length || 0
    })
  }

  // Veo 3.1
  else if (currentModel?.type === 'video' && (selectedModel === 'veo3.1' || selectedModel === 'fal-ai-veo-3.1')) {
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

  // Sora 2
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-sora-2' || selectedModel === 'sora-2')) {
    options.soraMode = params.soraMode
    options.duration = params.videoDuration
    options.soraAspectRatio = params.soraAspectRatio
    options.soraResolution = params.soraResolution

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

  // LTX-2
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-ltx-2' || selectedModel === 'ltx-2')) {
    options.mode = params.mode || 'text-to-video'
    options.ltxResolution = params.ltxResolution
    options.ltxFps = params.ltxFps
    options.ltxGenerateAudio = params.ltxGenerateAudio
    options.ltxFastMode = params.ltxFastMode

    // 视频编辑模式的特殊参数
    if (options.mode === 'retake-video') {
      options.duration = params.ltxRetakeDuration || 5  // 视频编辑模式使用专用时长
      options.ltxRetakeStartTime = params.ltxRetakeStartTime
      options.ltxRetakeMode = params.ltxRetakeMode

      // 处理视频上传：保存到 Uploads 目录并记录路径
      if (params.uploadedVideoFiles && params.uploadedVideoFiles.length > 0) {
        const videoFile = params.uploadedVideoFiles[0]
        const paths: string[] = [...params.uploadedVideoFilePaths]

        // 如果还没有保存过，保存视频文件
        if (!paths[0]) {
          const saved = await saveUploadVideo(videoFile, 'persist')
          paths[0] = saved.fullPath
        }

        setUploadedVideoFilePaths(paths)
        options.uploadedVideoFilePaths = paths

        // 将 File 对象转换为 base64（仅用于 API 请求，不保存到历史记录）
        const videoDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve(e.target?.result as string)
          reader.onerror = reject
          reader.readAsDataURL(videoFile)
        })
        options.videos = [videoDataUrl]
      }
    }
    // 文生视频和图生视频模式：使用通用时长
    else {
      options.duration = params.videoDuration || 6

      // 图生视频模式：处理图片上传
      if (options.mode === 'image-to-video' && uploadedImages.length > 0) {
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

    console.log('[optionsBuilder] LTX-2 参数:', {
      mode: options.mode,
      duration: options.duration,
      resolution: options.ltxResolution,
      fps: options.ltxFps,
      generateAudio: options.ltxGenerateAudio,
      fastMode: options.ltxFastMode,
      hasImages: options.images?.length || 0,
      hasVideos: options.videos?.length || 0
    })
  }

  // Kling Video O1
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-kling-video-o1' || selectedModel === 'kling-video-o1')) {
    options.mode = params.klingMode || 'image-to-video'
    options.duration = params.videoDuration
    options.aspectRatio = params.klingAspectRatio
    options.keepAudio = params.klingKeepAudio

    // 处理图片上传
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

    // 处理视频上传（如果有）：保存到 Uploads 目录并记录路径
    if (params.uploadedVideoFiles && params.uploadedVideoFiles.length > 0) {
      const videoFile = params.uploadedVideoFiles[0]
      const paths: string[] = [...params.uploadedVideoFilePaths]

      // 如果还没有保存过，保存视频文件
      if (!paths[0]) {
        const saved = await saveUploadVideo(videoFile, 'persist')
        paths[0] = saved.fullPath
      }

      setUploadedVideoFilePaths(paths)
      options.uploadedVideoFilePaths = paths

      // 将 File 对象转换为 base64（仅用于 API 请求，不保存到历史记录）
      const videoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as string)
        reader.onerror = reject
        reader.readAsDataURL(videoFile)
      })
      options.videos = [videoDataUrl]
    }

    // 处理 Elements（如果有）
    if (params.klingElements && params.klingElements.length > 0) {
      options.elements = params.klingElements
    }
  }

  // Kling Video v2.6 Pro
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-kling-video-v2.6-pro' || selectedModel === 'kling-video-v2.6-pro')) {
    options.duration = params.videoDuration
    options.aspectRatio = params.klingV26AspectRatio
    options.klingV26GenerateAudio = params.klingV26GenerateAudio
    options.klingV26CfgScale = params.klingV26CfgScale

    // 处理图片上传
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

    console.log('[optionsBuilder] Kling v2.6 Pro 参数:', {
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      generateAudio: options.klingV26GenerateAudio,
      cfgScale: options.klingV26CfgScale,
      images: options.images?.length || 0
    })
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
  else if (currentModel?.type === 'image' && (selectedModel === 'nano-banana' || selectedModel === 'fal-ai-nano-banana')) {
    options.num_images = params.numImages

    // 保存原始的 aspect_ratio 参数（用于历史记录恢复）
    let finalAspectRatio = params.aspectRatio

    // 如果是 'smart'，执行智能匹配
    if (params.aspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        finalAspectRatio = matches.aspectRatio || params.aspectRatio
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
  else if (currentModel?.type === 'image' && (selectedModel === 'nano-banana-pro' || selectedModel === 'fal-ai-nano-banana-pro')) {
    options.model_id = 'nano-banana-pro'
    options.num_images = params.numImages

    // 如果是 'smart'，执行智能匹配
    if (params.aspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        options.aspect_ratio = matches.aspectRatio || params.aspectRatio
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

  // ByteDance Seedream v4/v4.5 (fal.ai 即梦模型)
  // ⚠️ 重要：此模型使用即梦专用分辨率计算，不使用基数系统（baseSize）
  // 分辨率约束：
  // - 宽高比范围：[1/3, 3]
  // - 最大总像素：6000×6000 = 36,000,000 像素
  // - 2K模式：目标 2048×2048 = 4,194,304 像素，尽可能接近且不小于此值
  // - 4K模式：目标 4096×4096 = 16,777,216 像素，尽可能接近且不小于此值
  else if (currentModel?.type === 'image' && (selectedModel === 'bytedance-seedream-v4' || selectedModel === 'bytedance-seedream-v4.5' || selectedModel === 'fal-ai-bytedance-seedream-v4' || selectedModel === 'fal-ai-bytedance-seedream-v4.5')) {
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
      // ⚠️ 使用即梦专用智能分辨率算法（calculateSeedreamSmartResolution）
      // 此算法会根据质量模式（2K/4K）和原图比例计算最优分辨率
      const smartSize = await params.calculateSeedreamSmartResolution(uploadedImages[0])
      const [w, h] = smartSize.split('x').map(Number)
      width = w
      height = h
      console.log('[optionsBuilder] bytedance-seedream-v4 智能模式:', { smartSize, width, height })
    }
    // 如果不是智能模式，根据宽高比调整尺寸
    else if (params.selectedResolution !== 'smart') {
      const [wRatio, hRatio] = params.selectedResolution.split(':').map(Number)

      // ⚠️ 重要：这里的计算逻辑必须与 UniversalResolutionSelector 中的即梦计算器保持一致
      // 不能使用基数系统（baseSize），而是直接从质量模式的目标像素开始计算
      const targetPixels = params.resolutionQuality === '2K' ? 4194304 : 16777216
      const aspectRatio = wRatio / hRatio

      // 计算能达到目标像素数的理想尺寸
      const targetHeight = Math.sqrt(targetPixels / aspectRatio)
      const targetWidth = targetHeight * aspectRatio

      width = Math.round(targetWidth)
      height = Math.round(targetHeight)

      // 确保不小于目标像素数
      let currentPixels = width * height
      const maxAllowedPixels = Math.min(targetPixels * 1.05, 36000000)

      while (currentPixels < targetPixels && currentPixels < maxAllowedPixels) {
        const withExtraWidth = (width + 1) * height
        const withExtraHeight = width * (height + 1)

        if (withExtraWidth <= maxAllowedPixels && withExtraHeight <= maxAllowedPixels) {
          if (Math.abs(withExtraWidth - targetPixels) < Math.abs(withExtraHeight - targetPixels)) {
            width += 1
            currentPixels = withExtraWidth
          } else {
            height += 1
            currentPixels = withExtraHeight
          }
        } else if (withExtraWidth <= maxAllowedPixels) {
          width += 1
          currentPixels = withExtraWidth
        } else if (withExtraHeight <= maxAllowedPixels) {
          height += 1
          currentPixels = withExtraHeight
        } else {
          break
        }
      }

      console.log('[optionsBuilder] bytedance-seedream-v4 预设比例模式:', {
        selectedResolution: params.selectedResolution,
        质量模式: params.resolutionQuality,
        目标像素: targetPixels,
        width,
        height,
        实际像素: width * height,
        利用率: `${((width * height / targetPixels) * 100).toFixed(2)}%`
      })

      // 如果有自定义输入，使用自定义尺寸（仅在非智能模式下生效）
      // ⚠️ 注意：自定义尺寸会覆盖上面的计算结果，用户需要自己确保符合约束
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

  // Kling Image O1
  else if (currentModel?.type === 'image' && (selectedModel === 'fal-ai-kling-image-o1' || selectedModel === 'kling-o1')) {
    options.num_images = params.numImages

    // 如果是 'auto'，执行智能匹配
    if (params.aspectRatio === 'auto' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        options.aspect_ratio = matches.aspectRatio || params.aspectRatio
        console.log('[optionsBuilder] Kling O1 Smart matched aspect_ratio:', options.aspect_ratio)
      } catch (error) {
        console.error('[optionsBuilder] Kling O1 Smart match failed:', error)
        options.aspect_ratio = params.aspectRatio
      }
    } else {
      options.aspect_ratio = params.aspectRatio
    }

    options.resolution = params.resolution

    // 处理上传的图片
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

    console.log('[optionsBuilder] Kling Image O1 参数:', {
      num_images: options.num_images,
      aspect_ratio: options.aspect_ratio,
      resolution: options.resolution,
      images: options.images?.length || 0
    })
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
    // 默认值（Z-Image-Turbo 使用基于基数的动态计算，不需要预设尺寸）
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
    selectedModel === 'Qwen/Qwen-Image' ||
    selectedModel === 'Qwen/Qwen-Image-Edit-2509' ||
    selectedModel === 'black-forest-labs/FLUX.1-Krea-dev' ||
    selectedModel === 'MusePublic/14_ckpt_SD_XL' ||
    selectedModel === 'MusePublic/majicMIX_realistic' ||
    selectedModel === 'modelscope-custom'
  )) {
    // 处理分辨率：从 imageSize (宽高比) 和 customWidth/customHeight 转换为 widthxheight 格式
    let width = 1024
    let height = 1024

    // 检查自定义模型是否支持图片编辑
    const isCustomModelWithImageEditing = selectedModel === 'modelscope-custom' && (() => {
      if (!params.modelscopeCustomModel) return false
      try {
        const stored = localStorage.getItem('modelscope_custom_models')
        if (stored) {
          const models = JSON.parse(stored)
          const currentModel = models.find((m: any) => m.id === params.modelscopeCustomModel)
          return currentModel?.modelType?.imageEditing === true
        }
      } catch (e) {
        console.error('Failed to check custom model type:', e)
      }
      return false
    })()

    // Qwen-Image-Edit-2509 使用专用计算器
    if (selectedModel === 'Qwen/Qwen-Image-Edit-2509') {
      // 智能模式：根据上传的第一张图片保持原图比例计算分辨率
      if (params.imageSize === 'smart' && uploadedImages.length > 0) {
        const { smartMatchQwenResolution } = await import('@/utils/qwenResolutionCalculator')
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          img.src = uploadedImages[0]
        })
        const resolution = smartMatchQwenResolution(img.width, img.height)
        width = resolution.width
        height = resolution.height
      }
      // 比例格式（如 "4:3"），使用 Qwen 专用计算器
      else if (params.imageSize && params.imageSize.includes(':')) {
        const [w, h] = params.imageSize.split(':').map(Number)
        if (!isNaN(w) && !isNaN(h)) {
          const { calculateQwenResolution } = await import('@/utils/qwenResolutionCalculator')
          const size = calculateQwenResolution(w, h)
          width = size.width
          height = size.height
        }
      }
      // 最后才使用 customWidth 和 customHeight（用户手动输入的自定义尺寸）
      else if (params.customWidth && params.customHeight) {
        width = parseInt(params.customWidth)
        height = parseInt(params.customHeight)
      }
    }
    // 自定义模型支持图片编辑：使用带边界限制的计算器
    else if (isCustomModelWithImageEditing) {
      // 智能模式：根据上传的第一张图片保持原图比例计算分辨率
      if (params.imageSize === 'smart' && uploadedImages.length > 0) {
        const { smartMatchQwenResolution } = await import('@/utils/qwenResolutionCalculator')
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          img.src = uploadedImages[0]
        })
        const resolution = smartMatchQwenResolution(img.width, img.height)
        width = resolution.width
        height = resolution.height
      }
      // 比例格式（如 "4:3"），使用带边界限制的计算器
      else if (params.imageSize && params.imageSize.includes(':')) {
        const [w, h] = params.imageSize.split(':').map(Number)
        if (!isNaN(w) && !isNaN(h)) {
          const { calculateResolutionWithBounds } = await import('@/utils/resolutionCalculator')
          const baseSize = params.resolutionBaseSize || 1440
          const size = calculateResolutionWithBounds(baseSize, w, h, 64, 2048)
          width = size.width
          height = size.height
        }
      }
      // 最后才使用 customWidth 和 customHeight
      else if (params.customWidth && params.customHeight) {
        width = parseInt(params.customWidth)
        height = parseInt(params.customHeight)
      }
    }
    // 其他魔搭模型使用基数系统（带边界限制）
    else {
      // 优先使用 customWidth 和 customHeight（这些值已经由 UI 根据基数计算好了）
      if (params.customWidth && params.customHeight) {
        width = parseInt(params.customWidth)
        height = parseInt(params.customHeight)
      }
      // 如果没有自定义宽高，但 imageSize 是比例格式（如 "4:3"），使用基数动态计算（带边界限制）
      else if (params.imageSize && params.imageSize.includes(':')) {
        const [w, h] = params.imageSize.split(':').map(Number)
        if (!isNaN(w) && !isNaN(h)) {
          const { calculateResolutionWithBounds } = await import('@/utils/resolutionCalculator')
          const baseSize = params.resolutionBaseSize || 1440
          const size = calculateResolutionWithBounds(baseSize, w, h, 64, 2048)
          width = size.width
          height = size.height
        }
      }
    }

    // 设置分辨率（魔搭API格式：widthxheight）
    options.width = width
    options.height = height

    // 设置其他参数
    options.steps = params.steps

    // Z-Image-Turbo 不使用 guidance 参数，其他模型才设置
    if (selectedModel !== 'Tongyi-MAI/Z-Image-Turbo' && params.guidance !== undefined) {
      options.guidance = params.guidance
    }

    if (params.negativePrompt) {
      options.negativePrompt = params.negativePrompt
    }

    // 设置 model 参数
    // 对于预设模型，直接使用 selectedModel（如 "Tongyi-MAI/Z-Image-Turbo"）
    // 对于自定义模型，使用用户选择的 modelscopeCustomModel
    if (selectedModel === 'modelscope-custom') {
      if (!params.modelscopeCustomModel) {
        throw new Error('请先选择或添加自定义模型')
      }
      options.model = params.modelscopeCustomModel
    } else {
      // 预设模型直接使用 selectedModel 作为 model 参数
      options.model = selectedModel
    }

    // 处理图片编辑：上传图片到 fal CDN（Qwen-Image-Edit-2509 和支持图片编辑的自定义模型）
    if ((selectedModel === 'Qwen/Qwen-Image-Edit-2509' || isCustomModelWithImageEditing) && uploadedImages.length > 0) {
      // 上传图片到 fal CDN
      // 注意：这里不需要在 optionsBuilder 中上传，因为 ModelscopeAdapter 会自动处理
      // 我们只需要设置 images 参数，适配器会检测并上传
      options.images = uploadedImages

      // 保存本地文件路径（用于重新编辑）
      const paths = [...uploadedFilePaths]
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

    console.log('[optionsBuilder] 魔搭模型参数:', {
      selectedModel,
      imageSize: params.imageSize,
      customWidth: params.customWidth,
      customHeight: params.customHeight,
      resolutionBaseSize: params.resolutionBaseSize,
      最终分辨率: `${width}x${height}`,
      steps: options.steps,
      guidance: options.guidance,
      model: options.model,
      isCustomModelWithImageEditing,
      imageUrls: options.imageUrls?.length || 0
    })

    // 注意：魔搭模型不设置 size 字段（用于显示），只设置 width 和 height（用于 API）
    // 这样在生成过程中不会显示尺寸，等生成完成后从实际文件中提取真实尺寸
  }

  return options
}
