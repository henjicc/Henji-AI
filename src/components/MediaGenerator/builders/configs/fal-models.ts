/**
 * Fal 模型配置（视频和图片）
 */

import { ModelConfig, BuildContext } from '../core/types'

/**
 * 通用的图片上传处理器
 * 用于保存上传图片的本地路径，以便历史记录恢复和重新编辑
 *
 * 注意：Fal 模型在 API 调用时使用 data URL，但仍需要保存本地文件路径用于历史记录
 */
const commonImageUploadHandler = {
  afterBuild: async (options: Record<string, any>, context: BuildContext) => {
    if (context.uploadedImages.length === 0) {
      return
    }

    const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
    const setUploadedFilePaths = (context.params as any).setUploadedFilePaths
    const uploadedFilePaths = (context.params as any).uploadedFilePaths || []

    // 重要：立即设置图片数据到 options 中（用于历史记录实时显示）
    // 必须在保存图片之前设置，确保历史记录可以立即访问
    options.images = context.uploadedImages

    const paths: string[] = [...uploadedFilePaths]

    // 保存每张图片到本地，记录文件路径
    for (let i = 0; i < context.uploadedImages.length; i++) {
      if (!paths[i]) {
        const blob = await dataUrlToBlob(context.uploadedImages[i])
        const saved = await saveUploadImage(blob, 'persist')
        paths[i] = saved.fullPath
      }
    }

    setUploadedFilePaths(paths)
    options.uploadedFilePaths = paths
  }
}

/**
 * 通用的视频上传处理器
 * 不转换视频为 base64，直接传递 File 对象，延迟到适配器中转换和上传
 * 这样可以让历史记录立即显示，视频转换和上传在后台进行
 */
const commonVideoUploadHandler = {
  afterBuild: async (options: Record<string, any>, context: BuildContext) => {
    const params = context.params
    const uploadedVideoFiles = (params as any).uploadedVideoFiles || []

    if (uploadedVideoFiles.length === 0) {
      return
    }

    const { saveUploadVideo } = await import('@/utils/save')
    const setUploadedVideoFilePaths = (params as any).setUploadedVideoFilePaths
    const uploadedVideoFilePaths = (params as any).uploadedVideoFilePaths || []
    const uploadedVideos = (params as any).uploadedVideos || []

    // 重要：立即设置视频缩略图到 options 中（用于历史记录实时显示）
    // 必须在处理视频之前设置，确保历史记录可以立即访问
    if (uploadedVideos.length > 0) {
      options.uploadedVideos = uploadedVideos
    }

    console.log('[commonVideoUploadHandler] 开始处理视频...', {
      count: uploadedVideoFiles.length
    })

    // 只保存视频文件到本地，不转换为 base64（避免阻塞历史记录显示）
    const paths: string[] = [...uploadedVideoFilePaths]

    for (let i = 0; i < uploadedVideoFiles.length; i++) {
      const file = uploadedVideoFiles[i]
      console.log(`[commonVideoUploadHandler] 处理第 ${i + 1}/${uploadedVideoFiles.length} 个视频...`, {
        name: file.name,
        size: file.size,
        type: file.type
      })

      // 如果还没有保存过，保存视频文件到本地（用于历史记录恢复）
      if (!paths[i]) {
        const saved = await saveUploadVideo(file, 'persist')
        paths[i] = saved.fullPath
        console.log(`[commonVideoUploadHandler] 视频已保存到本地:`, saved.fullPath)
      }
    }

    // 直接传递 File 对象数组到 options（适配器会检测并转换为 base64，然后上传到 Fal CDN）
    // 注意：File 对象不会被保存到 history.json（会在 sanitization 时被删除）
    options.videos = uploadedVideoFiles

    // 保存视频文件路径（用于历史记录恢复）
    setUploadedVideoFilePaths(paths)
    options.uploadedVideoFilePaths = paths

    console.log('[commonVideoUploadHandler] 视频文件路径已保存，File 对象已传递给适配器')
  }
}

/**
 * 通用的媒体上传处理器（图片 + 视频）
 * 组合图片和视频上传功能，用于需要同时支持两者的模型
 */
const commonMediaUploadHandler = {
  afterBuild: async (options: Record<string, any>, context: BuildContext) => {
    // 先处理图片上传
    await commonImageUploadHandler.afterBuild(options, context)
    // 再处理视频上传
    await commonVideoUploadHandler.afterBuild(options, context)
  }
}

/**
 * Nano Banana 配置（Fal 图片模型）
 */
export const nanoBananaConfig: ModelConfig = {
  id: 'nano-banana',
  type: 'image',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: ['falNanoBananaNumImages', 'numImages'],
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['falNanoBananaAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed',
    guidance_scale: 'guidanceScale',
    num_inference_steps: 'numInferenceSteps',
    enable_safety_checker: 'enableSafetyChecker'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Nano Banana Pro 配置（Fal 图片模型）
 */
export const nanoBananaProConfig: ModelConfig = {
  ...nanoBananaConfig,
  id: 'nano-banana-pro',
  paramMapping: {
    num_images: {
      source: ['falNanoBananaProNumImages', 'numImages'],
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['falNanoBananaProAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed',
    guidance_scale: 'guidanceScale',
    num_inference_steps: 'numInferenceSteps',
    enable_safety_checker: 'enableSafetyChecker'
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Veo 3.1 配置（视频模型）
 * 支持文生视频、图生视频、首尾帧、参考生视频四种模式
 */
export const falVeo31Config: ModelConfig = {
  id: 'veo3.1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 模式参数（决定端点）
    mode: {
      source: 'falVeo31Mode',
      defaultValue: 'text-image-to-video'
    },
    // 时长参数
    duration: {
      source: ['falVeo31VideoDuration', 'videoDuration'],
      defaultValue: 8
    },
    // 宽高比参数（路由期望 veoAspectRatio）
    veoAspectRatio: {
      source: 'falVeo31AspectRatio',
      defaultValue: '16:9'
    },
    // 分辨率参数
    veoResolution: {
      source: 'falVeo31Resolution',
      defaultValue: '1080p'
    },
    // 增强提示词
    veoEnhancePrompt: 'falVeo31EnhancePrompt',
    // 生成音频
    veoGenerateAudio: 'falVeo31GenerateAudio',
    // 自动修复
    veoAutoFix: 'falVeo31AutoFix',
    // 快速模式（决定是否使用 fast 端点）
    fastMode: 'falVeo31FastMode'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'veoAspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,  // 支持首尾帧模式（2张图片）
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Seedream 专用图片上传和分辨率计算处理器
 */
const falSeedreamImageUploadHandler = {
  afterBuild: async (options: Record<string, any>, context: BuildContext) => {
    const params = context.params

    // 1. 处理图片上传（保存本地文件路径）
    if (context.uploadedImages.length > 0) {
      const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
      const setUploadedFilePaths = (params as any).setUploadedFilePaths
      const uploadedFilePaths = (params as any).uploadedFilePaths || []

      // 重要：立即设置图片数据到 options 中（用于历史记录实时显示）
      options.images = context.uploadedImages

      const paths: string[] = [...uploadedFilePaths]

      for (let i = 0; i < context.uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(context.uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }

      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }

    // 2. 处理分辨率计算
    // 只在有分辨率参数时才执行计算，避免不必要的延迟
    const selectedResolution = params.selectedResolution
    if (!selectedResolution) {
      return // 没有分辨率参数，直接返回
    }

    // 使用 try-catch 包裹整个分辨率计算逻辑，确保即使出错也不会影响图片上传
    try {
      const quality = params.resolutionQuality === '2K' ? '2K' : '4K'

      if (selectedResolution === 'smart') {
        // 智能匹配模式
        if (context.uploadedImages.length > 0) {
          const { calculateSeedreamSmartResolution } = await import('../../utils/resolutionUtils')
          try {
            const smartSize = await calculateSeedreamSmartResolution(context.uploadedImages[0], quality)
            // Fal 使用 "width*height" 格式（注意是 '*' 而不是 'x'）
            options.imageSize = smartSize.replace('x', '*')
          } catch (error) {
            console.error('[Fal Seedream] Smart resolution calculation failed:', error)
            // 失败时使用默认比例
            const { getActualResolution } = await import('../../utils/resolutionUtils')
            const defaultSize = getActualResolution('1:1', quality)
            if (defaultSize) {
              options.imageSize = defaultSize.replace('x', '*')
            }
          }
        } else {
          // 没有图片时，智能模式默认使用 1:1
          const { getActualResolution } = await import('../../utils/resolutionUtils')
          const defaultSize = getActualResolution('1:1', quality)
          if (defaultSize) {
            options.imageSize = defaultSize.replace('x', '*')
          }
        }
      } else if (selectedResolution === 'custom') {
        // 自定义尺寸模式
        if (params.customWidth && params.customHeight) {
          options.imageSize = `${params.customWidth}*${params.customHeight}`
        }
      } else if (selectedResolution) {
        // 具体比例模式（如 '1:1', '16:9' 等）
        const { getActualResolution } = await import('../../utils/resolutionUtils')
        const size = getActualResolution(selectedResolution, quality)
        if (size) {
          options.imageSize = size.replace('x', '*')
        }
      }
    } catch (error) {
      console.error('[Fal Seedream] Resolution calculation error:', error)
      // 分辨率计算失败不应该影响图片上传和其他功能
    }
  }
}

/**
 * Fal Bytedance Seedream V4 配置（图片模型）
 * 注意：虽然是图片模型，但暂时保持 type: 'video' 以兼容历史记录显示逻辑
 */
export const falSeedreamV4Config: ModelConfig = {
  id: 'bytedance-seedream-v4',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: 'falSeedream40NumImages',
      defaultValue: 1
    },
    aspect_ratio: {
      source: 'aspectRatio',
      defaultValue: '16:9'
    }
    // imageSize 由 customHandlers 中的分辨率计算逻辑处理
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: falSeedreamImageUploadHandler
}

/**
 * Fal Bytedance Seedream V4.5 配置（图片模型）
 * 注意：虽然是图片模型，但暂时保持 type: 'video' 以兼容历史记录显示逻辑
 */
export const falSeedreamV45Config: ModelConfig = {
  id: 'bytedance-seedream-v4.5',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: 'falSeedream40NumImages',
      defaultValue: 1
    },
    aspect_ratio: {
      source: 'aspectRatio',
      defaultValue: '16:9'
    }
    // imageSize 由 customHandlers 中的分辨率计算逻辑处理
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: falSeedreamImageUploadHandler
}

/**
 * Fal Bytedance Seedance V1 配置（视频模型）
 * 支持 Lite 和 Pro 版本，支持文生视频、图生视频、参考生视频三种模式
 */
export const falSeedanceV1Config: ModelConfig = {
  id: 'bytedance-seedance-v1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 模式参数（决定端点）
    seedanceMode: {
      source: 'falSeedanceV1Mode',
      defaultValue: 'text-to-video'
    },
    // 版本参数（决定端点：lite 或 pro）
    seedanceVersion: {
      source: 'falSeedanceV1Version',
      defaultValue: 'lite'
    },
    // 宽高比参数（路由期望 seedanceAspectRatio）
    seedanceAspectRatio: {
      source: 'ppioSeedanceV1AspectRatio',
      defaultValue: '16:9'
    },
    // 时长参数（路由期望 videoDuration）
    videoDuration: {
      source: ['falSeedanceV1VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    // 分辨率参数（路由期望 seedanceResolution）
    seedanceResolution: {
      source: 'ppioSeedanceV1Resolution',
      defaultValue: '720p'
    },
    // 固定相机参数（路由期望 seedanceCameraFixed）
    seedanceCameraFixed: {
      source: 'ppioSeedanceV1CameraFixed',
      defaultValue: false
    },
    // 快速模式参数（路由期望 seedanceFastMode）
    seedanceFastMode: {
      source: 'falSeedanceV1FastMode',
      defaultValue: true
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'seedanceAspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,  // 支持首尾帧模式（2张图片）
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Z-Image Turbo 配置（图片模型）
 */
export const falZImageTurboConfig: ModelConfig = {
  id: 'fal-ai-z-image-turbo',
  type: 'image',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: ['falZImageTurboNumImages', 'numImages'],
      defaultValue: 1
    },
    falZImageTurboNumInferenceSteps: {
      source: 'falZImageTurboNumInferenceSteps',
      defaultValue: 8
    },
    falZImageTurboEnablePromptExpansion: {
      source: 'falZImageTurboEnablePromptExpansion',
      defaultValue: false
    },
    falZImageTurboAcceleration: {
      source: 'falZImageTurboAcceleration',
      defaultValue: 'none'
    },
    seed: 'seed'
  },

  customHandlers: {
    afterBuild: async (options, context) => {
      const params = context.params

      // 处理分辨率：从 customWidth 和 customHeight 组合成 width*height 格式
      let finalImageSize: string

      if (params.customWidth && params.customHeight) {
        const width = parseInt(params.customWidth as string)
        const height = parseInt(params.customHeight as string)
        if (!isNaN(width) && !isNaN(height)) {
          finalImageSize = `${width}*${height}`
        } else {
          finalImageSize = '1440*1440'
        }
      } else {
        finalImageSize = '1440*1440'
      }

      // 设置到 options 中，适配器会从这里读取
      options.falZImageTurboImageSize = finalImageSize

      console.log('[falZImageTurboConfig] 分辨率处理:', {
        customWidth: params.customWidth,
        customHeight: params.customHeight,
        finalImageSize
      })
    }
  }
}

/**
 * Fal Kling Image O1 配置（图片模型）
 */
export const falKlingImageO1Config: ModelConfig = {
  id: 'fal-ai-kling-image-o1',
  type: 'image',
  provider: 'fal',

  paramMapping: {
    num_images: {
      source: ['falKlingImageO1NumImages', 'numImages'],
      defaultValue: 1
    },
    aspect_ratio: {
      source: ['falKlingImageO1AspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed',
    negative_prompt: 'negativePrompt'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Kling Video O1 配置（视频模型）
 * 支持 4 种模式：图生视频、参考生视频、视频编辑、视频参考
 */
export const falKlingVideoO1Config: ModelConfig = {
  id: 'kling-video-o1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 模式参数（决定端点）
    mode: {
      source: 'falKlingVideoO1Mode',
      defaultValue: 'image-to-video'
    },
    // 时长参数
    duration: {
      source: ['falKlingVideoO1VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    // 宽高比参数（仅部分模式使用）
    aspectRatio: {
      source: 'falKlingVideoO1AspectRatio',
      defaultValue: '16:9'
    },
    // 保留音频参数（仅视频模式使用）
    keepAudio: {
      source: 'falKlingVideoO1KeepAudio',
      defaultValue: false
    },
    // Elements 参数（参考生视频模式）
    elements: 'falKlingVideoO1Elements',
    // 负面提示词
    negative_prompt: 'videoNegativePrompt'
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,
      paramKey: 'videos'
    }
  },

  customHandlers: commonMediaUploadHandler
}

/**
 * Fal Kling Video V2.6 Pro 配置（视频模型）
 * 支持文生视频和图生视频，自动根据是否有图片选择端点
 */
export const falKlingV26ProConfig: ModelConfig = {
  id: 'kling-video-v2.6-pro',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 时长参数
    duration: {
      source: ['falKlingV26ProVideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    // 宽高比参数（仅文生视频使用，路由期望 aspectRatio）
    aspectRatio: {
      source: 'falKlingV26ProAspectRatio',
      defaultValue: '16:9'
    },
    // CFG Scale 参数（仅文生视频使用，路由期望 klingV26CfgScale）
    klingV26CfgScale: {
      source: 'falKlingV26ProCfgScale',
      defaultValue: 0.5
    },
    // 音频生成参数（路由期望 klingV26GenerateAudio）
    klingV26GenerateAudio: {
      source: 'falKlingV26ProGenerateAudio',
      defaultValue: true
    },
    // 负面提示词
    negative_prompt: 'videoNegativePrompt'
  },

  features: {
    // 禁用智能匹配（schema 明确指定 smartMatch: false）
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Sora 2 配置（视频模型）
 * 支持文生视频和图生视频，标准版和专业版
 */
export const falSora2Config: ModelConfig = {
  id: 'sora-2',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 模式参数（决定端点：standard 或 pro）
    soraMode: {
      source: 'falSora2Mode',
      defaultValue: 'standard'
    },
    // 时长参数
    duration: {
      source: ['falSora2VideoDuration', 'videoDuration'],
      defaultValue: 4
    },
    // 宽高比参数（路由期望 soraAspectRatio）
    soraAspectRatio: {
      source: 'falSora2AspectRatio',
      defaultValue: '16:9'
    },
    // 分辨率/质量参数（720p/1080p）
    soraResolution: {
      source: 'falSora2Resolution',
      defaultValue: '720p'
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'soraAspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Fal LTX 2 配置（视频模型）
 * 支持文生视频、图生视频、视频编辑三种模式
 */
export const falLtx2Config: ModelConfig = {
  id: 'ltx-2',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 模式参数（决定端点）
    mode: {
      source: 'falLtx2Mode',
      defaultValue: 'text-to-video'
    },
    // 时长参数（根据模式选择不同的源）
    duration: {
      source: ['falLtx2RetakeDuration', 'falLtx2VideoDuration', 'videoDuration'],
      defaultValue: 6
    },
    // 分辨率参数（文生视频和图生视频）
    ltxResolution: {
      source: 'falLtx2Resolution',
      defaultValue: '1080p'
    },
    // 帧率参数
    ltxFps: {
      source: 'falLtx2Fps',
      defaultValue: 25
    },
    // 生成音频参数
    ltxGenerateAudio: {
      source: 'falLtx2GenerateAudio',
      defaultValue: true
    },
    // 快速模式参数（决定是否使用 fast 端点）
    ltxFastMode: {
      source: 'falLtx2FastMode',
      defaultValue: true
    },
    // 视频编辑模式的开始时间
    ltxRetakeStartTime: {
      source: 'falLtx2RetakeStartTime',
      defaultValue: 0
    },
    // 视频编辑模式的编辑类型
    ltxRetakeMode: {
      source: 'falLtx2RetakeMode',
      defaultValue: 'replace_audio_and_video'
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,
      paramKey: 'videos'
    }
  },

  customHandlers: commonMediaUploadHandler
}

/**
 * Fal Vidu Q2 配置（视频模型）
 * 支持文生视频、图生视频、参考生视频、视频延长四种模式
 */
export const falViduQ2Config: ModelConfig = {
  id: 'vidu-q2',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 模式参数（决定端点）
    viduQ2Mode: {
      source: 'falViduQ2Mode',
      defaultValue: 'text-to-video'
    },
    // 时长参数（路由期望 falViduQ2VideoDuration）
    falViduQ2VideoDuration: {
      source: ['falViduQ2VideoDuration', 'videoDuration'],
      defaultValue: 4
    },
    // 宽高比参数（路由期望 viduQ2AspectRatio）
    viduQ2AspectRatio: {
      source: 'falViduQ2AspectRatio',
      defaultValue: '16:9'
    },
    // 分辨率参数（路由期望 viduQ2Resolution）
    viduQ2Resolution: {
      source: 'falViduQ2Resolution',
      defaultValue: '720p'
    },
    // 运动幅度参数（路由期望 viduQ2MovementAmplitude）
    viduQ2MovementAmplitude: {
      source: 'falViduQ2MovementAmplitude',
      defaultValue: 'auto'
    },
    // 背景音乐参数（路由期望 viduQ2Bgm）
    viduQ2Bgm: {
      source: 'falViduQ2Bgm',
      defaultValue: false
    },
    // 快速模式参数（路由期望 viduQ2FastMode）
    viduQ2FastMode: {
      source: 'falViduQ2FastMode',
      defaultValue: true
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'viduQ2AspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 7,  // 支持参考生视频模式（最多7张图片）
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,
      paramKey: 'videos'
    }
  },

  customHandlers: commonMediaUploadHandler
}

/**
 * Fal Pixverse V5.5 配置（视频模型）
 * 支持文生视频、图生视频、首尾帧三种模式（自动根据图片数量选择）
 */
export const falPixverseV55Config: ModelConfig = {
  id: 'pixverse-v5.5',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 时长参数（路由期望 falPixverse55VideoDuration）
    falPixverse55VideoDuration: {
      source: ['falPixverse55VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    // 宽高比参数（路由期望 pixverseAspectRatio）
    pixverseAspectRatio: {
      source: 'falPixverse55AspectRatio',
      defaultValue: '16:9'
    },
    // 分辨率参数（路由期望 pixverseResolution）
    pixverseResolution: {
      source: 'falPixverse55Resolution',
      defaultValue: '720p'
    },
    // 风格参数（路由期望 pixverseStyle）
    pixverseStyle: {
      source: 'falPixverse55Style',
      defaultValue: 'none'
    },
    // 思考模式参数（路由期望 pixverseThinkingType）
    pixverseThinkingType: {
      source: 'falPixverse55ThinkingType',
      defaultValue: 'auto'
    },
    // 生成音频参数（路由期望 pixverseGenerateAudio）
    pixverseGenerateAudio: 'falPixverse55GenerateAudio',
    // 多镜头参数（路由期望 pixverseMultiClip）
    pixverseMultiClip: 'falPixverse55MultiClip'
    // 注意：路由明确不使用 negative_prompt 和 seed
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'pixverseAspectRatio',
      defaultRatio: '16:9'
    },
    imageUpload: {
      enabled: true,
      maxImages: 2,  // 支持首尾帧模式（2张图片）
      mode: 'multiple',
      paramKey: 'images',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Wan 2.5 Preview 配置（视频模型）
 * 支持文生视频和图生视频，自动根据是否有图片选择端点
 */
export const falWan25Config: ModelConfig = {
  id: 'wan-25-preview',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 时长参数
    duration: {
      source: ['falWan25VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    // 宽高比参数（仅文生视频使用）
    wanAspectRatio: {
      source: 'falWan25AspectRatio',
      defaultValue: '16:9'
    },
    // 分辨率参数（路由期望 wanResolution）
    wanResolution: {
      source: 'falWan25Resolution',
      defaultValue: '1080p'
    },
    // 提示词扩展参数
    wanPromptExpansion: {
      source: 'falWan25PromptExpansion',
      defaultValue: true
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'images',
      convertToBlob: false
    }
  },

  customHandlers: {
    afterBuild: async (options, context) => {
      if (context.uploadedImages.length === 0) {
        return
      }

      // 保存本地文件路径（用于历史记录恢复和重新编辑）
      const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
      const setUploadedFilePaths = (context.params as any).setUploadedFilePaths
      const uploadedFilePaths = (context.params as any).uploadedFilePaths || []

      const paths: string[] = [...uploadedFilePaths]

      for (let i = 0; i < context.uploadedImages.length; i++) {
        if (!paths[i]) {
          const blob = await dataUrlToBlob(context.uploadedImages[i])
          const saved = await saveUploadImage(blob, 'persist')
          paths[i] = saved.fullPath
        }
      }

      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths

      // Wan 2.5 使用 images 数组格式
      if (options.images) {
        options.images = [options.images]
      }
    }
  }
}

/**
 * Fal MiniMax Hailuo 2.3 配置（视频模型）
 * 支持 Standard/Pro 版本，文生视频、图生视频、快速模式
 */
export const falHailuo23Config: ModelConfig = {
  id: 'minimax-hailuo-2.3-fal',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    // 时长参数（Standard 支持 6s/10s，Pro 固定 6s）
    duration: {
      source: ['falHailuo23Duration', 'videoDuration'],
      defaultValue: '6'
    },
    // 提示词优化参数
    prompt_optimizer: {
      source: 'falHailuo23PromptOptimizer',
      defaultValue: true
    },
    // 分辨率参数（UI 显示，需要映射到 version）
    hailuoResolution: {
      source: 'falHailuo23Resolution',
      defaultValue: '768P'
    },
    // 版本参数（从分辨率映射而来，用于路由选择）
    // 768P -> standard, 1080P -> pro
    hailuoVersion: {
      source: 'falHailuo23Resolution',
      defaultValue: 'standard',
      transform: (value: string) => value === '1080P' ? 'pro' : 'standard'
    },
    // 快速模式参数（用于路由选择）
    hailuoFastMode: {
      source: 'falHailuo23FastMode',
      defaultValue: true
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}
