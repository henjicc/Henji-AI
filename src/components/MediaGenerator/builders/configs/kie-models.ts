/**
 * KIE 模型配置
 */

import { ModelConfig, BuildContext } from '../core/types'

/**
 * KIE 图片上传处理器
 * 用于保存上传图片的本地路径，以便历史记录恢复和重新编辑
 *
 * 注意：KIE 模型需要先上传图片到 KIE CDN，这个处理在 KIEAdapter 中完成
 * 这里只负责保存本地文件路径用于历史记录
 */
const kieImageUploadHandler = {
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
 * KIE Nano Banana Pro 配置
 */
export const kieNanoBananaProConfig: ModelConfig = {
  id: 'kie-nano-banana-pro',
  type: 'image',
  provider: 'kie',

  paramMapping: {
    aspect_ratio: {
      source: ['kieNanoBananaAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    resolution: {
      source: ['kieNanoBananaResolution', 'resolution'],
      defaultValue: '2K'
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 8,  // KIE 支持最多 8 张图片
      mode: 'multiple',
      paramKey: 'image_input',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieNanoBananaProAliasConfig: ModelConfig = {
  ...kieNanoBananaProConfig,
  id: 'nano-banana-pro-kie'
}

/**
 * KIE Grok Imagine 配置
 */
export const kieGrokImagineConfig: ModelConfig = {
  id: 'kie-grok-imagine',
  type: 'image',
  provider: 'kie',

  paramMapping: {
    aspect_ratio: {
      source: ['kieGrokImagineAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    }
  },

  features: {
    // Grok Imagine 不支持图片上传，仅支持文本生成图片
    // 因此不需要 smartMatch 和 imageUpload 功能
  }
}

// 导出别名配置（支持短名称）
export const kieGrokImagineAliasConfig: ModelConfig = {
  ...kieGrokImagineConfig,
  id: 'grok-imagine-kie'
}

/**
 * KIE Z-Image 配置
 */
export const kieZImageConfig: ModelConfig = {
  id: 'kie-z-image',
  type: 'image',
  provider: 'kie',

  paramMapping: {
    aspect_ratio: {
      source: ['kieZImageAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    }
  },

  features: {
    // Z-Image 不支持图片上传，仅支持文本生成图片
    // 因此不需要 smartMatch 和 imageUpload 功能
  }
}

// 导出别名配置（支持短名称）
export const kieZImageAliasConfig: ModelConfig = {
  ...kieZImageConfig,
  id: 'z-image-kie'
}

/**
 * KIE Grok Imagine 视频配置
 */
export const kieGrokImagineVideoConfig: ModelConfig = {
  id: 'kie-grok-imagine-video',
  type: 'video',
  provider: 'kie',

  paramMapping: {
    aspect_ratio: {
      source: ['kieGrokImagineVideoAspectRatio', 'aspectRatio'],
      defaultValue: '2:3'
    },
    mode: {
      source: ['kieGrokImagineVideoMode', 'mode'],
      defaultValue: 'normal'
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,  // Grok Imagine 视频最多支持 1 张图片
      mode: 'single',
      paramKey: 'image_urls',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieGrokImagineVideoAliasConfig: ModelConfig = {
  ...kieGrokImagineVideoConfig,
  id: 'grok-imagine-video-kie'
}

/**
 * KIE Kling V2.6 视频配置
 */
export const kieKlingV26Config: ModelConfig = {
  id: 'kie-kling-v2-6',
  type: 'video',
  provider: 'kie',

  paramMapping: {
    kieKlingV26Mode: {
      source: ['kieKlingV26Mode', 'mode'],
      defaultValue: 'text-image-to-video'
    },
    kieKlingV26Resolution: {
      source: ['kieKlingV26Resolution', 'resolution'],
      defaultValue: '720p'
    },
    kieKlingV26CharacterOrientation: {
      source: ['kieKlingV26CharacterOrientation', 'characterOrientation'],
      defaultValue: 'video'
    },
    aspect_ratio: {
      source: ['kieKlingV26AspectRatio', 'aspectRatio'],
      defaultValue: '16:9'
    },
    duration: {
      source: ['kieKlingV26Duration', 'duration'],
      defaultValue: '5'
    },
    enable_audio: {
      source: ['kieKlingV26EnableAudio', 'enableAudio'],
      defaultValue: false
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,  // Kling V2.6 最多支持 1 张图片
      mode: 'single',
      paramKey: 'image_urls',  // 注意：API 使用 image_urls（复数，数组格式）
      convertToBlob: false  // KIE 适配器会处理上传
    },
    videoUpload: {
      enabled: true,
      maxVideos: 1,  // 动作控制模式需要 1 个参考视频
      paramKey: 'video',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieKlingV26AliasConfig: ModelConfig = {
  ...kieKlingV26Config,
  id: 'kling-v2-6-kie'
}

/**
 * KIE Seedream 4.5 配置
 */
export const kieSeedream45Config: ModelConfig = {
  id: 'kie-seedream-4.5',
  type: 'image',
  provider: 'kie',

  paramMapping: {
    aspect_ratio: {
      source: ['kieSeedreamAspectRatio', 'aspectRatio'],
      defaultValue: '1:1'
    },
    quality: {
      source: ['kieSeedreamQuality', 'quality'],
      defaultValue: '2K',
      // 质量映射：UI 显示 2K/4K，API 需要 basic/high
      transform: (value: string) => {
        if (value === '2K') return 'basic'
        if (value === '4K') return 'high'
        return 'basic'  // 默认值
      }
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'aspect_ratio',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 14,  // KIE Seedream 4.5 支持最多 14 张图片
      mode: 'multiple',
      paramKey: 'image_urls',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieSeedream45AliasConfig: ModelConfig = {
  ...kieSeedream45Config,
  id: 'seedream-4.5-kie'
}

/**
 * KIE Seedream 4.0 配置
 */
export const kieSeedream40Config: ModelConfig = {
  id: 'kie-seedream-4.0',
  type: 'image',
  provider: 'kie',

  paramMapping: {
    image_size: {
      source: ['kieSeedream40AspectRatio', 'aspectRatio'],
      defaultValue: '1:1',
      // 转换比例格式到 API 参数格式
      // 例如：'16:9' → 'landscape_16_9', '9:16' → 'portrait_16_9', '1:1' → 'square_hd'
      transform: (value: string) => {
        // 1:1 使用 square_hd
        if (value === '1:1') return 'square_hd'

        // 解析比例
        const [w, h] = value.split(':').map(Number)
        const ratio = w / h

        // 判断方向：横向 (landscape) 或竖向 (portrait)
        const prefix = ratio > 1 ? 'landscape' : 'portrait'

        // 映射比例到 API 格式
        if (value === '4:3' || value === '3:4') return `${prefix}_4_3`
        if (value === '3:2' || value === '2:3') return `${prefix}_3_2`
        if (value === '16:9' || value === '9:16') return `${prefix}_16_9`
        if (value === '21:9') return 'landscape_21_9'

        // 默认返回 square_hd
        return 'square_hd'
      }
    },
    image_resolution: {
      source: ['kieSeedream40Resolution', 'resolution'],
      defaultValue: '2K'
      // 注意：不需要 transform，直接传递 2K/4K
    },
    max_images: {
      source: ['kieSeedream40MaxImages', 'maxImages'],
      defaultValue: 1
    }
  },

  features: {
    smartMatch: {
      enabled: true,
      paramKey: 'image_size',
      defaultRatio: '1:1'
    },
    imageUpload: {
      enabled: true,
      maxImages: 10,  // KIE Seedream 4.0 支持最多 10 张输入图片
      mode: 'multiple',
      paramKey: 'image_urls',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieSeedream40AliasConfig: ModelConfig = {
  ...kieSeedream40Config,
  id: 'seedream-4.0-kie'
}

/**
 * KIE Hailuo 2.3 图生视频配置
 */
export const kieHailuo23Config: ModelConfig = {
  id: 'kie-hailuo-2-3',
  type: 'video',
  provider: 'kie',

  paramMapping: {
    mode: {
      source: ['kieHailuo23Mode', 'mode'],
      defaultValue: 'standard'
    },
    duration: {
      source: ['kieHailuo23Duration', 'duration'],
      defaultValue: 6
    },
    resolution: {
      source: ['kieHailuo23Resolution', 'resolution'],
      defaultValue: '768P'
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,  // Hailuo 2.3 最多支持 1 张图片
      mode: 'single',
      paramKey: 'image_url',  // 注意：API 使用 image_url（单数）
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieHailuo23AliasConfig: ModelConfig = {
  ...kieHailuo23Config,
  id: 'hailuo-2-3-kie'
}

/**
 * KIE Hailuo 02 配置
 */
export const kieHailuo02Config: ModelConfig = {
  id: 'kie-hailuo-02',
  type: 'video',
  provider: 'kie',

  paramMapping: {
    duration: {
      source: ['kieHailuo02Duration', 'duration'],
      defaultValue: 6
    },
    resolution: {
      source: ['kieHailuo02Resolution', 'resolution'],
      defaultValue: '768P'
    },
    prompt_optimizer: {
      source: ['kieHailuo02PromptOptimizer', 'prompt_optimizer'],
      defaultValue: true
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 2,  // Hailuo 02 最多支持 2 张图片
      mode: 'multiple',
      paramKey: 'image_url',  // 第一张图片使用 image_url，第二张使用 end_image_url
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieHailuo02AliasConfig: ModelConfig = {
  ...kieHailuo02Config,
  id: 'hailuo-02-kie'
}

/**
 * KIE Seedance V3 (即梦视频 3.0) 配置
 *
 * 功能：
 * - 文生视频（0张图片）
 * - 图生视频（1张图片）
 * - 首尾帧（2张图片）
 *
 * 版本：
 * - Lite: bytedance/v1-lite-text-to-video, bytedance/v1-lite-image-to-video
 * - Pro: bytedance/v1-pro-text-to-video, bytedance/v1-pro-image-to-video
 * - Pro Fast: bytedance/v1-pro-fast-image-to-video (仅图生视频)
 */
export const kieSeedanceV3Config: ModelConfig = {
  id: 'kie-seedance-v3',
  type: 'video',
  provider: 'kie',

  paramMapping: {
    aspect_ratio: {
      source: ['kieSeedanceV3AspectRatio', 'aspectRatio'],
      defaultValue: '16:9'
    },
    resolution: {
      source: ['kieSeedanceV3Resolution', 'resolution'],
      defaultValue: '720p'
    },
    duration: {
      source: ['kieSeedanceV3Duration', 'duration'],
      defaultValue: '5'
    },
    camera_fixed: {
      source: ['kieSeedanceV3CameraFixed', 'cameraFixed'],
      defaultValue: false
    },
    // Note: version and fast_mode are not API parameters
    // They are used for endpoint selection in the adapter
    version: {
      source: ['kieSeedanceV3Version', 'version'],
      defaultValue: 'lite'
    },
    fast_mode: {
      source: ['kieSeedanceV3FastMode', 'fastMode'],
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
      maxImages: 1,  // 最多支持 1 张图片（不支持首尾帧）
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieSeedanceV3AliasConfig: ModelConfig = {
  ...kieSeedanceV3Config,
  id: 'seedance-v3-kie'
}

/**
 * KIE Sora 2 配置
 */
export const kieSora2Config: ModelConfig = {
  id: 'kie-sora-2',
  type: 'video',
  provider: 'kie',

  paramMapping: {
    mode: {
      source: ['kieSora2Mode', 'mode'],
      defaultValue: 'standard'
    },
    aspect_ratio: {
      source: ['kieSora2AspectRatio', 'aspectRatio'],
      defaultValue: '16:9',
      // 转换比例格式到 API 格式
      // UI: '16:9', '9:16', 'smart' → API: 'landscape', 'portrait'
      transform: (value: string) => {
        // 重要：不要转换 'smart'，让 handleSmartMatch 处理它
        if (value === 'smart') return value
        if (value === '16:9') return 'landscape'
        if (value === '9:16') return 'portrait'
        // 如果已经是 API 格式,直接返回
        if (value === 'landscape' || value === 'portrait') return value
        // 默认返回 landscape
        return 'landscape'
      }
    },
    duration: {
      source: ['kieSora2Duration', 'duration'],
      defaultValue: '10'
    },
    quality: {
      source: ['kieSora2Quality', 'quality'],
      defaultValue: 'standard'
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
      maxImages: 1,  // Sora 2 最多支持 1 张图片
      mode: 'single',
      paramKey: 'image_urls',
      convertToBlob: false  // KIE 适配器会处理上传
    }
  },

  customHandlers: kieImageUploadHandler
}

// 导出别名配置（支持短名称）
export const kieSora2AliasConfig: ModelConfig = {
  ...kieSora2Config,
  id: 'sora-2-kie'
}
