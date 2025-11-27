import { VideoResult } from '@/adapters/base/BaseAdapter'
import { BaseAdapter } from '@/adapters/base/BaseAdapter'

/**
 * 解析 Fal 视频响应
 */
export const parseVideoResponse = async (
  responseData: any,
  adapter: BaseAdapter
): Promise<VideoResult> => {
  // 队列API返回的结构：{ video: { url: "..." } }
  if (responseData.video) {
    const videoUrl = responseData.video.url
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
