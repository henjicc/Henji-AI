/**
 * 上下文构建器
 *
 * 从参数中提取上下文信息，供端点选择器使用
 */

import type { SelectContext } from './EndpointSelector'

/**
 * 上下文构建器类
 *
 * 负责从参数中提取上下文信息，如上传的图片、视频等
 */
export class ContextBuilder {
  /**
   * 构建选择上下文
   *
   * @param params - 参数对象
   * @param customContext - 自定义上下文
   * @returns 选择上下文
   *
   * @example
   * ```typescript
   * const context = ContextBuilder.build({
   *   images: ['url1', 'url2'],
   *   videos: ['url3']
   * })
   * // {
   * //   uploadedImages: ['url1', 'url2'],
   * //   uploadedVideos: ['url3'],
   * //   hasImage: true,
   * //   hasVideo: true
   * // }
   * ```
   */
  static build(
    params: DynamicValueMap,
    customContext: DynamicValueMap = {}
  ): SelectContext {
    const context: SelectContext = { ...customContext }

    // 提取上传的图片
    if (params.images && Array.isArray(params.images) && params.images.length > 0) {
      context.uploadedImages = params.images
      context.hasImage = true
    } else if (params.image && typeof params.image === 'string') {
      context.uploadedImages = [params.image]
      context.hasImage = true
    } else {
      context.hasImage = false
    }

    // 提取上传的视频
    if (params.videos && Array.isArray(params.videos) && params.videos.length > 0) {
      context.uploadedVideos = params.videos
      context.hasVideo = true
    } else if (params.video && typeof params.video === 'string') {
      context.uploadedVideos = [params.video]
      context.hasVideo = true
    } else {
      context.hasVideo = false
    }

    return context
  }
}
