import { saveUploadImage, saveUploadVideo, dataUrlToBlob } from '@/utils/save'

/**
 * 生成选项构建器
 * 将原本 handleGenerate 中 370+ 行的选项构建逻辑提取出来
 */

export interface BuildOptionsParams {
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

  // Vidu Q1（派欧云）
  ppioViduQ1VideoDuration?: number
  ppioViduQ1Mode: string
  ppioViduQ1Style: string
  ppioViduQ1MovementAmplitude: string
  ppioViduQ1Bgm: boolean
  ppioViduQ1AspectRatio: string

  // Kling 2.5 Turbo（派欧云）
  ppioKling25CfgScale: number

  // Hailuo（派欧云）
  ppioHailuo23FastMode: boolean
  ppioHailuo23EnablePromptExpansion: boolean

  // PixVerse v4.5（派欧云）
  ppioPixverse45FastMode: boolean
  ppioPixverse45Style?: string

  // Wan 2.5（派欧云）
  ppioWan25Size: string
  ppioWan25PromptExtend: boolean
  ppioWan25Audio: boolean

  // Wan 2.5（Fal）
  falWan25AspectRatio?: string
  falWan25Resolution?: string
  falWan25PromptExpansion?: boolean

  // Seedance v1（派欧云）
  ppioSeedanceV1Variant: 'lite' | 'pro'
  ppioSeedanceV1Resolution: string
  ppioSeedanceV1AspectRatio: string
  ppioSeedanceV1CameraFixed: boolean

  // Seedance v1（Fal）
  falSeedanceV1Mode?: 'text-to-video' | 'image-to-video' | 'reference-to-video'
  falSeedanceV1Version?: 'lite' | 'pro'
  falSeedanceV1FastMode?: boolean

  // Veo 3.1（Fal）
  falVeo31Mode: string
  falVeo31AspectRatio: string
  falVeo31Resolution: string
  falVeo31EnhancePrompt: boolean
  falVeo31GenerateAudio: boolean
  falVeo31AutoFix: boolean
  falVeo31FastMode: boolean

  // Kling Video O1（Fal）
  falKlingVideoO1Mode?: string
  falKlingVideoO1AspectRatio?: string
  falKlingVideoO1KeepAudio?: boolean
  falKlingVideoO1Elements?: any[]
  falKlingVideoO1VideoDuration?: number
  uploadedVideos?: string[]  // 视频缩略图（用于 UI）
  uploadedVideoFiles?: File[]  // 视频 File 对象（延迟读取）

  // Kling v2.6 Pro（Fal）
  falKlingV26ProAspectRatio?: string
  falKlingV26ProGenerateAudio?: boolean
  falKlingV26ProCfgScale?: number

  // Sora 2（Fal）
  falSora2Mode?: string
  falSora2AspectRatio?: string
  falSora2Resolution?: string

  // LTX-2（Fal）
  falLtx2Mode?: string
  falLtx2Resolution?: string
  falLtx2Fps?: number
  falLtx2GenerateAudio?: boolean
  falLtx2FastMode?: boolean
  falLtx2RetakeDuration?: number
  falLtx2RetakeStartTime?: number
  falLtx2RetakeMode?: string

  // Vidu Q2（Fal）
  falViduQ2Mode?: string
  falViduQ2AspectRatio?: string
  falViduQ2Resolution?: string
  falViduQ2MovementAmplitude?: string
  falViduQ2Bgm?: boolean
  falViduQ2FastMode?: boolean

  // Pixverse V5.5（Fal）
  falPixverse55AspectRatio?: string
  falPixverse55Resolution?: string
  falPixverse55Style?: string
  falPixverse55ThinkingType?: string
  falPixverse55GenerateAudio?: boolean
  falPixverse55MultiClip?: boolean

  // 音频
  minimaxAudioSpeed: number
  minimaxAudioEmotion: string
  minimaxVoiceId: string
  minimaxAudioSpec: 'hd' | 'turbo'
  minimaxAudioVol: number
  minimaxAudioPitch: number
  minimaxAudioSampleRate: number
  minimaxAudioBitrate: number
  minimaxAudioFormat: string
  minimaxAudioChannel: number
  minimaxLatexRead: boolean
  minimaxTextNormalization: boolean
  minimaxLanguageBoost: string

  // Z-Image-Turbo
  modelscopeImageSize: string
  falZImageTurboNumInferenceSteps: number
  falZImageTurboEnablePromptExpansion: boolean
  falZImageTurboAcceleration: string

  // 魔搭
  modelscopeSteps: number
  modelscopeGuidance: number
  modelscopeNegativePrompt: string
  modelscopeCustomModel: string
  resolutionBaseSize: number

  // 模型特定参数 - 派欧云
  ppioKling25VideoDuration?: number
  ppioKling25VideoAspectRatio?: string
  ppioHailuo23VideoDuration?: number
  ppioHailuo23VideoResolution?: string
  ppioPixverse45VideoAspectRatio?: string
  ppioPixverse45VideoResolution?: string
  ppioWan25VideoDuration?: number
  ppioSeedanceV1VideoDuration?: number

  // 模型特定参数 - Fal
  falNanoBananaAspectRatio?: string
  falNanoBananaNumImages?: number
  falNanoBananaProAspectRatio?: string
  falNanoBananaProNumImages?: number
  falKlingImageO1AspectRatio?: string
  falKlingImageO1NumImages?: number
  falZImageTurboImageSize?: string
  falZImageTurboNumImages?: number
  falSeedream40NumImages?: number
  falSeedanceV1VideoDuration?: number
  falVeo31VideoDuration?: number
  falSora2VideoDuration?: number
  falLtx2VideoDuration?: number
  falViduQ2VideoDuration?: number
  falPixverse55VideoDuration?: number
  falKlingV26ProVideoDuration?: number
  falWan25VideoDuration?: number

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
    options.mode = params.ppioViduQ1Mode
    options.duration = params.ppioViduQ1VideoDuration ?? params.videoDuration
    options.movementAmplitude = params.ppioViduQ1MovementAmplitude
    options.bgm = params.ppioViduQ1Bgm

    if (params.ppioViduQ1Mode === 'text-image-to-video') {
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
        options.aspectRatio = params.ppioViduQ1AspectRatio
        options.style = params.ppioViduQ1Style
      }
    } else if (params.ppioViduQ1Mode === 'start-end-frame') {
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
    } else if (params.ppioViduQ1Mode === 'reference-to-video') {
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

      // 处理智能匹配
      let finalAspectRatio = params.ppioViduQ1AspectRatio
      if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
        const { getSmartMatchValues } = await import('@/models')
        try {
          const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
          const matchedValues = Object.values(matches)
          finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
          console.log('[optionsBuilder] Vidu Q1 Smart matched aspect_ratio:', finalAspectRatio)
        } catch (error) {
          console.error('[optionsBuilder] Vidu Q1 Smart match failed:', error)
          finalAspectRatio = '16:9'
        }
      }
      options.aspectRatio = finalAspectRatio
    }
  }

  // Kling 2.5 Turbo
  else if (currentModel?.type === 'video' && selectedModel === 'kling-2.5-turbo') {
    options.duration = params.ppioKling25VideoDuration ?? params.videoDuration
    options.cfgScale = params.ppioKling25CfgScale
    options.modelscopeNegativePrompt = params.videoNegativePrompt
    if (uploadedImages.length === 0) {
      options.aspectRatio = params.ppioKling25VideoAspectRatio ?? params.videoAspectRatio
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
    options.duration = params.ppioHailuo23VideoDuration ?? (params.videoDuration || 6)
    options.resolution = params.ppioHailuo23VideoResolution ?? (params.videoResolution || '768P')
    options.promptExtend = params.ppioHailuo23EnablePromptExpansion
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
      options.hailuoFast = params.ppioHailuo23FastMode
    }
  }

  // Hailuo 02（使用与 Hailuo 2.3 相同的参数）
  else if (currentModel?.type === 'video' && selectedModel === 'minimax-hailuo-02') {
    options.duration = params.ppioHailuo23VideoDuration ?? (params.videoDuration || 6)
    options.resolution = params.ppioHailuo23VideoResolution ?? (params.videoResolution || '768P')
    options.promptExtend = params.ppioHailuo23EnablePromptExpansion
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
    options.resolution = params.ppioPixverse45VideoResolution ?? params.videoResolution
    options.modelscopeNegativePrompt = params.videoNegativePrompt
    options.fastMode = params.ppioPixverse45FastMode
    options.style = params.ppioPixverse45Style
    if (uploadedImages.length === 0) {
      options.aspectRatio = params.ppioPixverse45VideoAspectRatio ?? params.videoAspectRatio
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

  // Wan 2.5 Preview（派欧云）
  else if (currentModel?.type === 'video' && selectedModel === 'wan-2.5-preview') {
    options.duration = params.ppioWan25VideoDuration ?? params.videoDuration
    options.promptExtend = params.ppioWan25PromptExtend
    options.audio = params.ppioWan25Audio
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
      options.resolution = params.falWan25Resolution
    } else {
      options.size = params.ppioWan25Size
    }
    options.modelscopeNegativePrompt = params.videoNegativePrompt
  }

  // Wan 2.5 Preview（Fal）
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-wan-25-preview' || selectedModel === 'wan-25-preview')) {
    options.duration = params.falWan25VideoDuration ?? (params.videoDuration || 5)

    // 处理智能匹配
    let finalAspectRatio = params.falWan25AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Wan 2.5 Preview Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Wan 2.5 Preview Smart match failed:', error)
        finalAspectRatio = '16:9'
      }
    }
    options.wanAspectRatio = finalAspectRatio

    options.wanResolution = params.falWan25Resolution
    options.wanPromptExpansion = params.falWan25PromptExpansion

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

    console.log('[optionsBuilder] Fal Wan 2.5 Preview 参数:', {
      duration: options.duration,
      wanAspectRatio: options.wanAspectRatio,
      wanResolution: options.wanResolution,
      wanPromptExpansion: options.wanPromptExpansion,
      images: options.images?.length || 0
    })
  }

  // Seedance v1 系列（派欧云）
  else if (currentModel?.type === 'video' && (selectedModel === 'seedance-v1' || selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro')) {
    options.resolution = params.ppioSeedanceV1Resolution

    // 处理智能匹配
    let finalAspectRatio = params.ppioSeedanceV1AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        // getSmartMatchValues返回的是 { paramId: value } 格式，提取第一个匹配的值
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Seedance V1 Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Seedance V1 Smart match failed:', error)
        finalAspectRatio = '16:9'  // 智能匹配失败时使用默认比例
      }
    }
    options.aspectRatio = finalAspectRatio

    options.duration = params.ppioSeedanceV1VideoDuration ?? params.videoDuration
    options.cameraFixed = params.ppioSeedanceV1CameraFixed
    if (selectedModel === 'seedance-v1') {
      options.seedanceVariant = params.ppioSeedanceV1Variant
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
    options.seedanceMode = params.falSeedanceV1Mode
    options.seedanceVersion = params.falSeedanceV1Version

    // 处理智能匹配
    let finalAspectRatio = params.ppioSeedanceV1AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        // getSmartMatchValues返回的是 { paramId: value } 格式，提取第一个匹配的值
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Fal Seedance V1 Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Fal Seedance V1 Smart match failed:', error)
        finalAspectRatio = '16:9'  // 智能匹配失败时使用默认比例
      }
    }
    options.seedanceAspectRatio = finalAspectRatio

    options.seedanceResolution = params.ppioSeedanceV1Resolution
    options.videoDuration = params.falSeedanceV1VideoDuration ?? params.videoDuration
    options.seedanceCameraFixed = params.ppioSeedanceV1CameraFixed
    options.seedanceFastMode = params.falSeedanceV1FastMode

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
    options.mode = params.falVeo31Mode
    options.duration = params.falVeo31VideoDuration ?? params.videoDuration

    // 处理智能匹配
    let finalAspectRatio = params.falVeo31AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Veo 3.1 Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Veo 3.1 Smart match failed:', error)
        finalAspectRatio = '16:9'
      }
    }
    options.aspectRatio = finalAspectRatio

    options.resolution = params.falVeo31Resolution
    options.veoEnhancePrompt = params.falVeo31EnhancePrompt
    options.veoGenerateAudio = params.falVeo31GenerateAudio
    options.veoAutoFix = params.falVeo31AutoFix
    options.fastMode = params.falVeo31FastMode

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
    options.soraMode = params.falSora2Mode
    options.duration = params.falSora2VideoDuration ?? params.videoDuration

    // 处理智能匹配
    let finalAspectRatio = params.falSora2AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Sora 2 Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Sora 2 Smart match failed:', error)
        finalAspectRatio = '16:9'
      }
    }
    options.soraAspectRatio = finalAspectRatio

    options.soraResolution = params.falSora2Resolution

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
    options.mode = params.falLtx2Mode || 'text-to-video'
    options.ltxResolution = params.falLtx2Resolution
    options.ltxFps = params.falLtx2Fps
    options.ltxGenerateAudio = params.falLtx2GenerateAudio
    options.ltxFastMode = params.falLtx2FastMode

    // 视频编辑模式的特殊参数
    if (options.mode === 'retake-video') {
      options.duration = params.falLtx2RetakeDuration || 5  // 视频编辑模式使用专用时长
      options.ltxRetakeStartTime = params.falLtx2RetakeStartTime
      options.ltxRetakeMode = params.falLtx2RetakeMode

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
      options.duration = params.falLtx2VideoDuration ?? (params.videoDuration || 6)

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
    options.mode = params.falKlingVideoO1Mode || 'image-to-video'
    options.duration = params.falKlingVideoO1VideoDuration ?? (params.videoDuration || 5)

    // 处理智能匹配
    let finalAspectRatio = params.falKlingVideoO1AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Kling Video O1 Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Kling Video O1 Smart match failed:', error)
        finalAspectRatio = '16:9'
      }
    }
    options.aspectRatio = finalAspectRatio

    options.keepAudio = params.falKlingVideoO1KeepAudio

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
    if (params.falKlingVideoO1Elements && params.falKlingVideoO1Elements.length > 0) {
      options.elements = params.falKlingVideoO1Elements
    }
  }

  // Kling Video v2.6 Pro
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-kling-video-v2.6-pro' || selectedModel === 'kling-video-v2.6-pro')) {
    options.duration = params.falKlingV26ProVideoDuration ?? params.videoDuration

    // 处理智能匹配
    let finalAspectRatio = params.falKlingV26ProAspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Kling v2.6 Pro Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Kling v2.6 Pro Smart match failed:', error)
        finalAspectRatio = '16:9'
      }
    }
    options.aspectRatio = finalAspectRatio

    options.klingV26GenerateAudio = params.falKlingV26ProGenerateAudio
    options.klingV26CfgScale = params.falKlingV26ProCfgScale

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

  // Vidu Q2
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2')) {
    options.viduQ2Mode = params.falViduQ2Mode || 'text-to-video'

    // 处理智能匹配
    let finalAspectRatio = params.falViduQ2AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Vidu Q2 Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Vidu Q2 Smart match failed:', error)
        finalAspectRatio = '16:9'
      }
    }
    options.viduQ2AspectRatio = finalAspectRatio

    options.viduQ2Resolution = params.falViduQ2Resolution || '720p'
    options.viduQ2MovementAmplitude = params.falViduQ2MovementAmplitude
    options.viduQ2Bgm = params.falViduQ2Bgm
    options.viduQ2FastMode = params.falViduQ2FastMode
    options.videoDuration = params.falViduQ2VideoDuration ?? (params.videoDuration || 4)

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

    // 处理视频上传（视频延长模式）
    if (params.uploadedVideoFiles && params.uploadedVideoFiles.length > 0 && options.viduQ2Mode === 'video-extension') {
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

    console.log('[optionsBuilder] Vidu Q2 参数:', {
      mode: options.viduQ2Mode,
      aspectRatio: options.viduQ2AspectRatio,
      resolution: options.viduQ2Resolution,
      duration: options.videoDuration,
      movementAmplitude: options.viduQ2MovementAmplitude,
      bgm: options.viduQ2Bgm,
      fastMode: options.viduQ2FastMode,
      images: options.images?.length || 0,
      videos: options.videos?.length || 0
    })
  }

  // Pixverse V5.5
  else if (currentModel?.type === 'video' && (selectedModel === 'fal-ai-pixverse-v5.5' || selectedModel === 'pixverse-v5.5')) {
    // 处理智能匹配
    let finalAspectRatio = params.falPixverse55AspectRatio
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '16:9'
        console.log('[optionsBuilder] Pixverse V5.5 Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Pixverse V5.5 Smart match failed:', error)
        finalAspectRatio = '16:9'
      }
    }
    options.pixverseAspectRatio = finalAspectRatio

    options.pixverseResolution = params.falPixverse55Resolution
    options.videoDuration = params.falPixverse55VideoDuration ?? (params.videoDuration || 5)
    options.pixverseStyle = params.falPixverse55Style
    options.pixverseThinkingType = params.falPixverse55ThinkingType
    options.pixverseGenerateAudio = params.falPixverse55GenerateAudio
    options.pixverseMultiClip = params.falPixverse55MultiClip

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

    console.log('[optionsBuilder] Pixverse V5.5 参数:', {
      aspectRatio: options.pixverseAspectRatio,
      resolution: options.pixverseResolution,
      duration: options.videoDuration,
      style: options.pixverseStyle,
      thinkingType: options.pixverseThinkingType,
      generateAudio: options.pixverseGenerateAudio,
      multiClip: options.pixverseMultiClip,
      images: options.images?.length || 0
    })
  }

  // 音频模型
  else if (currentModel?.type === 'audio') {
    options.speed = params.minimaxAudioSpeed
    options.emotion = params.minimaxAudioEmotion
    options.minimaxVoiceId = params.minimaxVoiceId
    options.output_format = 'url'
    options.spec = params.minimaxAudioSpec
    options.vol = params.minimaxAudioVol
    options.pitch = params.minimaxAudioPitch
    options.sample_rate = params.minimaxAudioSampleRate
    options.bitrate = params.minimaxAudioBitrate
    options.format = params.minimaxAudioFormat
    options.channel = params.minimaxAudioChannel
    options.latex_read = params.minimaxLatexRead
    options.text_normalization = params.minimaxTextNormalization
    options.language_boost = params.minimaxLanguageBoost
  }

  // Nano Banana
  else if (currentModel?.type === 'image' && (selectedModel === 'nano-banana' || selectedModel === 'fal-ai-nano-banana')) {
    options.num_images = params.falNanoBananaNumImages ?? params.numImages

    // 保存原始的 aspect_ratio 参数（用于历史记录恢复）
    let finalAspectRatio = params.falNanoBananaAspectRatio ?? params.aspectRatio

    // 如果是 'smart'，执行智能匹配
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        const matchedValues = Object.values(matches)
        finalAspectRatio = matchedValues.length > 0 ? matchedValues[0] as string : '1:1'
        console.log('[optionsBuilder] Nano Banana Smart matched aspect_ratio:', finalAspectRatio)
      } catch (error) {
        console.error('[optionsBuilder] Nano Banana Smart match failed:', error)
        finalAspectRatio = '1:1'
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
    options.num_images = params.falNanoBananaProNumImages ?? params.numImages

    // 使用模型特定参数或通用参数
    let finalAspectRatio = params.falNanoBananaProAspectRatio ?? params.aspectRatio

    // 如果是 'smart'，执行智能匹配
    if (finalAspectRatio === 'smart' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        options.aspect_ratio = matches.aspectRatio || finalAspectRatio
        console.log('[optionsBuilder] Smart matched aspect_ratio:', options.aspect_ratio)
      } catch (error) {
        console.error('[optionsBuilder] Smart match failed:', error)
        options.aspect_ratio = finalAspectRatio
      }
    } else {
      options.aspect_ratio = finalAspectRatio
    }

    options.resolution = (params as any).falNanoBananaProResolution ?? params.resolution
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
    options.numImages = params.falSeedream40NumImages ?? params.numImages

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

    console.log('[optionsBuilder] bytedance-seedream-v4 最终分辨率:', { width, height, modelscopeImageSize: `${width}*${height}` })
    options.modelscopeImageSize = `${width}*${height}`

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
    options.num_images = params.falKlingImageO1NumImages ?? params.numImages

    // 使用模型特定参数或通用参数
    let finalAspectRatio = params.falKlingImageO1AspectRatio ?? params.aspectRatio

    // 如果是 'auto'，执行智能匹配
    if (finalAspectRatio === 'auto' && uploadedImages.length > 0) {
      const { getSmartMatchValues } = await import('@/models')
      try {
        const matches = await getSmartMatchValues(selectedModel, uploadedImages[0], { uploadedImages })
        options.aspect_ratio = matches.aspectRatio || finalAspectRatio
        console.log('[optionsBuilder] Kling O1 Smart matched aspect_ratio:', options.aspect_ratio)
      } catch (error) {
        console.error('[optionsBuilder] Kling O1 Smart match failed:', error)
        options.aspect_ratio = finalAspectRatio
      }
    } else {
      options.aspect_ratio = finalAspectRatio
    }

    options.resolution = (params as any).falKlingImageO1Resolution ?? params.resolution

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

    options.modelscopeImageSize = finalImageSize
    options.falZImageTurboNumInferenceSteps = params.falZImageTurboNumInferenceSteps
    options.numImages = params.falZImageTurboNumImages ?? params.numImages
    options.falZImageTurboEnablePromptExpansion = params.falZImageTurboEnablePromptExpansion
    options.falZImageTurboAcceleration = params.falZImageTurboAcceleration

    console.log('[optionsBuilder] Z-Image-Turbo 分辨率:', {
      原始imageSize: params.modelscopeImageSize,
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
      if (params.modelscopeImageSize === 'smart' && uploadedImages.length > 0) {
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
      else if (params.modelscopeImageSize && params.modelscopeImageSize.includes(':')) {
        const [w, h] = params.modelscopeImageSize.split(':').map(Number)
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
      if (params.modelscopeImageSize === 'smart' && uploadedImages.length > 0) {
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
      else if (params.modelscopeImageSize && params.modelscopeImageSize.includes(':')) {
        const [w, h] = params.modelscopeImageSize.split(':').map(Number)
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
      else if (params.modelscopeImageSize && params.modelscopeImageSize.includes(':')) {
        const [w, h] = params.modelscopeImageSize.split(':').map(Number)
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
    options.modelscopeSteps = params.modelscopeSteps

    // Z-Image-Turbo 不使用 guidance 参数，其他模型才设置
    if (selectedModel !== 'Tongyi-MAI/Z-Image-Turbo' && params.modelscopeGuidance !== undefined) {
      options.modelscopeGuidance = params.modelscopeGuidance
    }

    if (params.modelscopeNegativePrompt) {
      options.modelscopeNegativePrompt = params.modelscopeNegativePrompt
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
      modelscopeImageSize: params.modelscopeImageSize,
      customWidth: params.customWidth,
      customHeight: params.customHeight,
      resolutionBaseSize: params.resolutionBaseSize,
      最终分辨率: `${width}x${height}`,
      modelscopeSteps: options.modelscopeSteps,
      modelscopeGuidance: options.modelscopeGuidance,
      model: options.model,
      isCustomModelWithImageEditing,
      imageUrls: options.imageUrls?.length || 0
    })

    // 注意：魔搭模型不设置 size 字段（用于显示），只设置 width 和 height（用于 API）
    // 这样在生成过程中不会显示尺寸，等生成完成后从实际文件中提取真实尺寸
  }

  return options
}
