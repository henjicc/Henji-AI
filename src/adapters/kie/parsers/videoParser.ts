import { VideoResult } from '@/adapters/base/BaseAdapter'
import type { KIEAdapter } from '../KIEAdapter'

/**
 * 解析 KIE 视频响应
 * @param responseData - KIE API 返回的 resultJson 解析后的数据
 * @param adapter - KIEAdapter 实例
 */
export const parseVideoResponse = async (
  responseData: any,
  adapter: KIEAdapter
): Promise<VideoResult> => {
  // KIE 返回格式: { resultUrls: ["url1"] }
  if (responseData.resultUrls && Array.isArray(responseData.resultUrls)) {
    const urls = responseData.resultUrls

    if (urls.length === 0) {
      throw new Error('API 未返回任何视频')
    }

    // 保存视频到本地
    try {
      const videoUrl = urls[0]  // Grok Imagine 视频只返回一个视频
      const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')

      return {
        url: savedResult.url,
        filePath: savedResult.filePath,
        status: 'completed'
      }
    } catch (e) {
      adapter['log']('视频本地保存失败，回退为远程 URL', e)

      // 回退：使用远程 URL
      return {
        url: urls[0],
        status: 'completed'
      }
    }
  }

  throw new Error('API 未返回视频 URL')
}
