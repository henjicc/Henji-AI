/**
 * 视频响应解析器模板
 */

import { ResponseParser } from '../types'
import { VideoResult } from '../../base/BaseAdapter'

export const videoParser: ResponseParser<VideoResult> = {
    async parse(responseData: any, adapter: any): Promise<VideoResult> {
        // 示例: 同步返回视频URL
        if (responseData.video_url) {
            const videoUrl = responseData.video_url

            // 使用适配器基类的保存方法保存到本地
            try {
                const savedResult = await adapter.saveMediaLocally(videoUrl, 'video')
                return {
                    url: savedResult.url,
                    status: 'completed'
                }
            } catch (e) {
                adapter.log('视频保存失败,使用远程URL', e)
                return {
                    url: videoUrl,
                    status: 'completed'
                }
            }
        }

        throw new Error('No video found in response')
    }
}
