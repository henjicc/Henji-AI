import { ImageResult } from '@/adapters/base/BaseAdapter'

/**
 * 解析 Fal 图片响应
 */
export const parseImageResponse = async (
  responseData: any
): Promise<ImageResult> => {
  // 队列API返回的结构：{ images: [...], description: "..." }
  if (responseData.images && responseData.images.length > 0) {
    const imageUrls = responseData.images.map((img: any) => img.url)
    return {
      url: imageUrls.join('|||'),
      createdAt: new Date()
    }
  }

  throw new Error('No images returned from queue')
}
