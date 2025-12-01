import { ImageResult } from '@/adapters/base/BaseAdapter'

/**
 * 解析 Fal 图片响应
 */
export const parseImageResponse = async (
  responseData: any
): Promise<ImageResult> => {
  // 官方 SDK 返回的结构：{ data: { images: [...] }, requestId: "..." }
  // 或旧的队列 API 结构：{ images: [...], description: "..." }

  // 优先检查官方 SDK 格式
  const data = responseData.data || responseData

  if (data.images && data.images.length > 0) {
    const imageUrls = data.images.map((img: any) => img.url)
    return {
      url: imageUrls.join('|||'),
      createdAt: new Date()
    }
  }

  throw new Error('No images returned from queue')
}
