import { ImageResult } from '@/adapters/base/BaseAdapter'

/**
 * 解析派欧云图片响应
 */
export const parseImageResponse = async (
  responseData: any
): Promise<ImageResult> => {
  if (responseData.images && responseData.images.length > 0) {
    // 返回所有图片URL，用分隔符连接
    return {
      url: responseData.images.join('|||'),
      createdAt: new Date()
    }
  }

  throw new Error('No image returned from API')
}
