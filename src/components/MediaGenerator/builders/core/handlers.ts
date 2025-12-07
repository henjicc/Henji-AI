/**
 * 配置驱动架构 - 通用处理器
 */

import { getSmartMatchValues } from '../../../../models'
import { BuildContext, SmartMatchConfig, ImageUploadConfig, VideoUploadConfig } from './types'

/**
 * 处理智能匹配
 */
export async function handleSmartMatch(
  options: Record<string, any>,
  config: SmartMatchConfig,
  context: BuildContext
): Promise<void> {
  if (!config.enabled || context.uploadedImages.length === 0) {
    return
  }

  try {
    // 调用智能匹配函数
    const matches = await getSmartMatchValues(
      context.selectedModel,
      context.uploadedImages[0],
      context.params
    )

    // 提取匹配的值
    const matchedValues = Object.values(matches)
    if (matchedValues.length > 0) {
      // 使用匹配的值
      options[config.paramKey] = matchedValues[0]
    } else {
      // 使用默认值
      options[config.paramKey] = config.defaultRatio
    }
  } catch (error) {
    console.error('[Smart Match] Failed:', error)
    // 失败时使用默认值
    options[config.paramKey] = config.defaultRatio
  }
}

/**
 * 将 Data URL 转换为 Blob
 */
async function dataURLtoBlob(dataURL: string): Promise<Blob> {
  const response = await fetch(dataURL)
  return await response.blob()
}

/**
 * 处理图片上传
 */
export async function handleImageUpload(
  options: Record<string, any>,
  config: ImageUploadConfig,
  context: BuildContext
): Promise<void> {
  if (!config.enabled || context.uploadedImages.length === 0) {
    return
  }

  const paramKey = config.paramKey || 'image_url'

  if (config.mode === 'single') {
    // 单图模式
    const image = context.uploadedImages[0]
    if (config.convertToBlob) {
      options[paramKey] = await dataURLtoBlob(image)
    } else {
      options[paramKey] = image
    }
  } else {
    // 多图模式
    const images = context.uploadedImages.slice(0, config.maxImages)
    if (config.convertToBlob) {
      options[paramKey] = await Promise.all(images.map(img => dataURLtoBlob(img)))
    } else {
      options[paramKey] = images
    }
  }
}

/**
 * 处理视频上传
 */
export async function handleVideoUpload(
  options: Record<string, any>,
  config: VideoUploadConfig,
  context: BuildContext
): Promise<void> {
  if (!config.enabled || !context.uploadedVideos || context.uploadedVideos.length === 0) {
    return
  }

  const paramKey = config.paramKey || 'video_url'
  const video = context.uploadedVideos[0]

  if (config.convertToBlob) {
    options[paramKey] = await dataURLtoBlob(video)
  } else {
    options[paramKey] = video
  }
}

/**
 * 从上下文中获取参数值（支持回退）
 */
export function getParamValue(
  source: string | string[],
  context: BuildContext
): any {
  if (typeof source === 'string') {
    return context.params[source]
  }

  // 数组形式：尝试每个 key，返回第一个非 undefined 的值
  for (const key of source) {
    const value = context.params[key]
    if (value !== undefined) {
      return value
    }
  }

  return undefined
}
