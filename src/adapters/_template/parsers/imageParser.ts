/**
 * 图片响应解析器模板
 * 
 * 使用说明:
 * 根据API的实际响应格式调整解析逻辑
 */

import { ResponseParser } from '../types'
import { ImageResult } from '../../base/BaseAdapter'

export const imageParser: ResponseParser<ImageResult> = {
    async parse(responseData: any, _adapter: any): Promise<ImageResult> {
        // 示例1: 直接返回图片URL
        if (responseData.image_url) {
            return {
                url: responseData.image_url,
                createdAt: new Date()
            }
        }

        // 示例2: 返回图片数组
        if (responseData.images && Array.isArray(responseData.images)) {
            // 如果是多张图片,用分隔符连接
            const urls = responseData.images.map((img: any) => img.url || img.image_url)
            return {
                url: urls.join('|||'),
                createdAt: new Date()
            }
        }

        // 示例3: Base64图片
        if (responseData.base64_image) {
            return {
                url: `data:image/png;base64,${responseData.base64_image}`,
                base64Data: responseData.base64_image,
                createdAt: new Date()
            }
        }

        throw new Error('No image found in response')
    }
}
