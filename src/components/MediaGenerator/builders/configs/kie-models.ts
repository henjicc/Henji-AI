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
