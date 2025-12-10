import { ImageResult } from '@/adapters/base/BaseAdapter'
import type { KIEAdapter } from '../KIEAdapter'

/**
 * 解析 KIE 图片响应
 * @param responseData - KIE API 返回的 resultJson 解析后的数据
 * @param adapter - KIEAdapter 实例
 */
export const parseImageResponse = async (
  responseData: any,
  adapter: KIEAdapter
): Promise<ImageResult> => {
  // KIE 返回格式: { resultUrls: ["url1", "url2", ...] }
  if (responseData.resultUrls && Array.isArray(responseData.resultUrls)) {
    const urls = responseData.resultUrls

    if (urls.length === 0) {
      throw new Error('API 未返回任何图片')
    }

    // 保存所有图片到本地
    try {
      const savedResults = await Promise.all(
        urls.map(url => adapter['saveMediaLocally'](url, 'image'))
      )

      // 如果是单图，返回单个结果
      if (savedResults.length === 1) {
        return {
          url: savedResults[0].url,
          filePath: savedResults[0].filePath,
          status: 'COMPLETED'
        }
      }

      // 如果是多图，用 ||| 分隔 URL 和 filePath
      const combinedUrls = savedResults.map(r => r.url).join('|||')
      const combinedPaths = savedResults.map(r => r.filePath).join('|||')

      return {
        url: combinedUrls,
        filePath: combinedPaths,
        status: 'COMPLETED'
      }
    } catch (e) {
      adapter['log']('图片本地保存失败，回退为远程 URL', e)

      // 回退：使用远程 URL
      if (urls.length === 1) {
        return {
          url: urls[0],
          status: 'COMPLETED'
        }
      }

      return {
        url: urls.join('|||'),
        status: 'COMPLETED'
      }
    }
  }

  throw new Error('API 未返回图片 URL')
}
