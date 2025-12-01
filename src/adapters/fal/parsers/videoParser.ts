import { VideoResult } from '@/adapters/base/BaseAdapter'
import { BaseAdapter } from '@/adapters/base/BaseAdapter'

/**
 * 解析 Fal 视频响应
 */
export const parseVideoResponse = async (
  responseData: any,
  adapter: BaseAdapter
): Promise<VideoResult> => {
  // 官方 SDK 返回的结构：{ data: { video: { url: "..." } }, requestId: "..." }
  // 或旧的队列 API 结构：{ video: { url: "..." } }

  // 优先检查官方 SDK 格式
  const data = responseData.data || responseData

  if (data.video) {
    const videoUrl = data.video.url
    let result: VideoResult = {
      url: videoUrl,
      status: 'COMPLETED'
    }

    // 使用基类的保存方法
    try {
      const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')
      result.url = savedResult.url
      ; (result as any).filePath = savedResult.filePath
    } catch (e) {
      adapter['log']('视频本地保存失败，回退为远程URL', e)
    }

    return result
  }

  throw new Error('No video returned from queue')
}
