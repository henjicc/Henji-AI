/**
 * Fal 模型配置（视频和图片）
 */

import { ModelConfig, BuildContext } from '../core/types'

/**
 * 通用的本地文件路径保存处理器
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
 */
export const falVeo31Config: ModelConfig = {
  id: 'veo3.1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falVeo31VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'falVeo31AspectRatio',
      defaultValue: '16:9'
    }
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Bytedance Seedream V4/V4.5 配置（视频模型）
 */
export const falSeedreamV4Config: ModelConfig = {
  id: 'bytedance-seedream-v4',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falSeedreamV4VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'falSeedreamV4AspectRatio',
      defaultValue: '16:9'
    }
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Bytedance Seedance V1 配置（视频模型）
 */
export const falSeedanceV1Config: ModelConfig = {
  id: 'bytedance-seedance-v1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    seedanceMode: 'falSeedanceV1Mode',
    seedanceVersion: 'falSeedanceV1Version',
    aspect_ratio: {
      source: 'ppioSeedanceV1AspectRatio',
      defaultValue: '16:9'
    },
    duration: {
      source: ['falSeedanceV1VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    camera_fixed: 'ppioSeedanceV1CameraFixed',
    fast_mode: {
      source: 'falSeedanceV1FastMode',
      defaultValue: true
    }
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
    aspect_ratio: {
      source: ['falZImageTurboAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    seed: 'seed',
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
 */
export const falKlingVideoO1Config: ModelConfig = {
  id: 'kling-video-o1',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falKlingVideoO1VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'falKlingVideoO1AspectRatio',
      defaultValue: '16:9'
    },
    negative_prompt: 'videoNegativePrompt'
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Kling Video V2.6 Pro 配置（视频模型）
 */
export const falKlingV26ProConfig: ModelConfig = {
  id: 'kling-video-v2.6-pro',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falKlingV26ProVideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'falKlingV26ProAspectRatio',
      defaultValue: '16:9'
    },
    cfg_scale: 'falKlingV26ProCfgScale',
    negative_prompt: 'videoNegativePrompt'
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Sora 2 配置（视频模型）
 */
export const falSora2Config: ModelConfig = {
  id: 'sora-2',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falSora2VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'falSora2AspectRatio',
      defaultValue: '16:9'
    },
    loop: 'falSora2Loop'
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal LTX 2 配置（视频模型）
 */
export const falLtx2Config: ModelConfig = {
  id: 'ltx-2',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falLtx2VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'falLtx2AspectRatio',
      defaultValue: '16:9'
    },
    num_inference_steps: 'falLtx2NumInferenceSteps',
    guidance_scale: 'falLtx2GuidanceScale'
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Vidu Q2 配置（视频模型）
 */
export const falViduQ2Config: ModelConfig = {
  id: 'vidu-q2',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falViduQ2VideoDuration', 'videoDuration'],
      defaultValue: 4
    },
    aspect_ratio: {
      source: 'falViduQ2AspectRatio',
      defaultValue: '16:9'
    }
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Pixverse V5.5 配置（视频模型）
 */
export const falPixverseV55Config: ModelConfig = {
  id: 'pixverse-v5.5',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falPixverse55VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    aspect_ratio: {
      source: 'falPixverse55AspectRatio',
      defaultValue: '16:9'
    },
    negative_prompt: 'videoNegativePrompt',
    seed: 'seed'
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

  customHandlers: commonImageUploadHandler
}

/**
 * Fal Wan 2.5 Preview 配置（视频模型）
 */
export const falWan25Config: ModelConfig = {
  id: 'wan-25-preview',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falWan25VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    wanAspectRatio: 'falWan25AspectRatio',
    wanResolution: 'falWan25Resolution',
    wanPromptExpansion: 'falWan25PromptExpansion'
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
