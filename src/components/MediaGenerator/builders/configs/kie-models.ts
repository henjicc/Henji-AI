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
