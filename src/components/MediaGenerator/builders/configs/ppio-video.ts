/**
 * PPIO 视频模型配置
 */

import { ModelConfig } from '../core/types'

/**
 * Seedance V1 配置（派欧云）
 * 支持 seedance-v1, seedance-v1-lite, seedance-v1-pro
 */
export const seedanceV1Config: ModelConfig = {
  id: 'seedance-v1',
  type: 'video',
  provider: 'ppio',

  paramMapping: {
    resolution: 'ppioSeedanceV1Resolution',
    aspectRatio: {
      source: 'ppioSeedanceV1AspectRatio',
      defaultValue: '16:9'
    },
    duration: {
      source: ['ppioSeedanceV1VideoDuration', 'videoDuration'],
      defaultValue: 5
    },
    cameraFixed: 'ppioSeedanceV1CameraFixed',
    seedanceVariant: {
      source: 'ppioSeedanceV1Variant',
      condition: (ctx) => ctx.selectedModel === 'seedance-v1'
    }
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
      convertToBlob: false  // PPIO 需要特殊处理，在 customHandlers 中处理
    }
  },

  customHandlers: {
    afterBuild: async (options, context) => {
      // PPIO 特殊的图片处理逻辑
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths

        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []
        const paths: string[] = []

        // 处理第一张图片
        const first = context.uploadedImages[0]
        options.images = [first]

        const p0 = uploadedFilePaths[0]
        if (p0) {
          paths.push(p0)
        } else {
          const blob1 = await dataUrlToBlob(first)
          const saved1 = await saveUploadImage(blob1, 'persist', { maxDimension: 6000 })
          paths.push(saved1.fullPath)
        }

        // 处理第二张图片（如果有）
        if (context.uploadedImages.length > 1) {
          const last = context.uploadedImages[1]
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
  }
}

/**
 * Seedance V1 Lite 配置
 */
export const seedanceV1LiteConfig: ModelConfig = {
  ...seedanceV1Config,
  id: 'seedance-v1-lite'
}

/**
 * Seedance V1 Pro 配置
 */
export const seedanceV1ProConfig: ModelConfig = {
  ...seedanceV1Config,
  id: 'seedance-v1-pro'
}

/**
 * Vidu Q1 配置（派欧云）
 * 支持三种模式：text-image-to-video, start-end-frame, reference-to-video
 */
export const viduQ1Config: ModelConfig = {
  id: 'vidu-q1',
  type: 'video',
  provider: 'ppio',

  paramMapping: {
    mode: 'ppioViduQ1Mode',
    duration: {
      source: ['ppioViduQ1VideoDuration', 'videoDuration']
    },
    movementAmplitude: 'ppioViduQ1MovementAmplitude',
    bgm: 'ppioViduQ1Bgm'
  },

  features: {
    modeSwitch: {
      modeParamKey: 'ppioViduQ1Mode',
      configs: {
        'text-image-to-video': {
          paramMapping: {
            aspectRatio: {
              source: 'ppioViduQ1AspectRatio',
              condition: (ctx) => ctx.uploadedImages.length === 0
            },
            style: {
              source: 'ppioViduQ1Style',
              condition: (ctx) => ctx.uploadedImages.length === 0
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
          }
        },
        'start-end-frame': {
          features: {
            imageUpload: {
              enabled: true,
              maxImages: 2,
              mode: 'multiple',
              paramKey: 'images',
              convertToBlob: false
            }
          }
        },
        'reference-to-video': {
          paramMapping: {
            aspectRatio: 'ppioViduQ1AspectRatio'
          },
          features: {
            smartMatch: {
              enabled: true,
              paramKey: 'aspectRatio',
              defaultRatio: '16:9'
            },
            imageUpload: {
              enabled: true,
              maxImages: 7,
              mode: 'multiple',
              paramKey: 'images',
              convertToBlob: false
            }
          }
        }
      }
    }
  },

  customHandlers: {
    validateParams: (params) => {
      const mode = params.ppioViduQ1Mode
      const imageCount = (params as any).uploadedImages?.length || 0

      if (mode === 'start-end-frame' && imageCount < 2) {
        throw new Error('首尾帧模式需要至少2张图片')
      }
      if (mode === 'reference-to-video' && (imageCount < 1 || imageCount > 7)) {
        throw new Error('参考生视频模式需要1-7张图片')
      }
    },
    afterBuild: async (options, context) => {
      // PPIO 特殊的图片处理逻辑
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths

        const mode = context.params.ppioViduQ1Mode
        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []
        const paths: string[] = []

        let maxImages = 1
        if (mode === 'start-end-frame') maxImages = 2
        if (mode === 'reference-to-video') maxImages = 7

        const images = context.uploadedImages.slice(0, maxImages)
        options.images = images

        for (let i = 0; i < images.length; i++) {
          if (uploadedFilePaths[i]) {
            paths.push(uploadedFilePaths[i])
          } else {
            const blob = await dataUrlToBlob(images[i])
            const saved = await saveUploadImage(blob, 'persist')
            paths.push(saved.fullPath)
          }
        }

        options.uploadedFilePaths = paths
        setUploadedFilePaths(paths)
      }
    }
  }
}

/**
 * Kling 2.5 Turbo 配置（派欧云）
 */
export const kling25TurboConfig: ModelConfig = {
  id: 'kling-2.5-turbo',
  type: 'video',
  provider: 'ppio',

  paramMapping: {
    duration: {
      source: ['ppioKling25VideoDuration', 'videoDuration']
    },
    cfgScale: 'ppioKling25CfgScale',
    modelscopeNegativePrompt: 'videoNegativePrompt',
    aspectRatio: 'ppioKling25AspectRatio'
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
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths

        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []
        const image = context.uploadedImages[0]
        options.images = [image]

        if (uploadedFilePaths[0]) {
          options.uploadedFilePaths = [uploadedFilePaths[0]]
        } else {
          const blob = await dataUrlToBlob(image)
          const saved = await saveUploadImage(blob, 'persist')
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
    }
  }
}

/**
 * Minimax Hailuo 2.3 配置（派欧云）
 */
export const minimaxHailuo23Config: ModelConfig = {
  id: 'minimax-hailuo-2.3',
  type: 'video',
  provider: 'ppio',

  paramMapping: {
    duration: {
      source: ['ppioHailuo23VideoDuration', 'videoDuration'],
      defaultValue: 6
    },
    resolution: {
      source: ['ppioHailuo23VideoResolution', 'videoResolution'],
      defaultValue: '768P'
    },
    promptExtend: 'ppioHailuo23EnablePromptExpansion',
    hailuoFast: {
      source: 'ppioHailuo23FastMode',
      condition: (ctx) => ctx.uploadedImages.length > 0
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
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths

        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []
        const image = context.uploadedImages[0]
        options.images = [image]

        if (uploadedFilePaths[0]) {
          options.uploadedFilePaths = [uploadedFilePaths[0]]
        } else {
          const blob = await dataUrlToBlob(image)
          const saved = await saveUploadImage(blob, 'persist')
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
    }
  }
}

/**
 * Pixverse V4.5 配置（派欧云）
 */
export const pixverseV45Config: ModelConfig = {
  id: 'pixverse-v4.5',
  type: 'video',
  provider: 'ppio',

  paramMapping: {
    duration: {
      source: ['ppioPixverseV45VideoDuration', 'videoDuration']
    },
    resolution: 'ppioPixverseV45Resolution',
    negativePrompt: 'videoNegativePrompt',
    seed: 'seed'
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
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths

        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []
        const image = context.uploadedImages[0]
        options.images = [image]

        if (uploadedFilePaths[0]) {
          options.uploadedFilePaths = [uploadedFilePaths[0]]
        } else {
          const blob = await dataUrlToBlob(image)
          const saved = await saveUploadImage(blob, 'persist')
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
    }
  }
}

/**
 * Wan 2.5 Preview 配置（派欧云）
 */
export const wan25PreviewConfig: ModelConfig = {
  id: 'wan-2.5-preview',
  type: 'video',
  provider: 'ppio',

  paramMapping: {
    duration: {
      source: ['ppioWan25VideoDuration', 'videoDuration']
    },
    aspectRatio: 'ppioWan25AspectRatio'
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
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = (context.params as any).setUploadedFilePaths

        const uploadedFilePaths = (context.params as any).uploadedFilePaths || []
        const image = context.uploadedImages[0]
        options.images = [image]

        if (uploadedFilePaths[0]) {
          options.uploadedFilePaths = [uploadedFilePaths[0]]
        } else {
          const blob = await dataUrlToBlob(image)
          const saved = await saveUploadImage(blob, 'persist')
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
    }
  }
}

/**
 * Seedream 4.0 配置（派欧云）
 */
export const seedream40Config: ModelConfig = {
  id: 'seedream-4.0',
  type: 'image',
  provider: 'ppio',

  paramMapping: {
    aspectRatio: 'aspectRatio',
    resolutionQuality: 'resolutionQuality',
    customWidth: 'customWidth',
    customHeight: 'customHeight',
    isManualInput: 'isManualInput',
    maxImages: 'maxImages',
    seed: 'seed',
    guidanceScale: 'guidanceScale'
  },

  customHandlers: {
    afterBuild: async (options, context) => {
      const params = context.params

      // 处理图片上传（PPIO 图片模型需要转换为 blob 并保存）
      if (context.uploadedImages.length > 0) {
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
        const setUploadedFilePaths = params.setUploadedFilePaths
        const uploadedFilePaths = params.uploadedFilePaths || []

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

      // 处理分辨率计算
      if (params.aspectRatio && params.aspectRatio !== 'custom') {
        const { getActualResolution, calculateSmartResolution } = await import('../../utils/resolutionUtils')
        const quality = params.resolutionQuality === '2K' ? '2K' : '4K'

        if (context.uploadedImages.length > 0) {
          try {
            const smartSize = await calculateSmartResolution(context.uploadedImages[0], quality)
            options.size = smartSize
          } catch (error) {
            const size = getActualResolution(params.aspectRatio, quality)
            options.size = size
          }
        } else {
          const size = getActualResolution(params.aspectRatio, quality)
          options.size = size
        }
      } else if (params.customWidth && params.customHeight) {
        options.size = `${params.customWidth}x${params.customHeight}`
      }

      // Seedream 4.0 特殊参数
      if (params.maxImages > 1) {
        options.sequential_image_generation = 'auto'
        options.max_images = params.maxImages
      } else {
        options.sequential_image_generation = 'disabled'
      }
      options.watermark = false
    }
  }
}
