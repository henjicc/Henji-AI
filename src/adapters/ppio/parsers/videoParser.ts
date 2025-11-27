import { VideoResult } from '@/adapters/base/BaseAdapter'
import { BaseAdapter } from '@/adapters/base/BaseAdapter'

/**
 * 解析派欧云视频响应
 */
export const parseVideoResponse = async (
  responseData: any,
  adapter: BaseAdapter
): Promise<VideoResult> => {
  if (responseData.videos && responseData.videos.length > 0) {
    const videoUrl = responseData.videos[0].video_url

    // 使用基类的保存方法
    try {
      const savedResult = await adapter['saveMediaLocally'](videoUrl, 'video')
      return {
        url: savedResult.url,
        filePath: savedResult.filePath,
        status: 'TASK_STATUS_SUCCEEDED'
      }
    } catch (e) {
      adapter['log']('视频本地保存失败，回退为远程URL', e)
      return {
        url: videoUrl,
        status: 'TASK_STATUS_SUCCEEDED'
      }
    }
  }

  throw new Error('No video returned from API')
}
