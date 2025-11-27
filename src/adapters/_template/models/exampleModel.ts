/**
 * 示例模型路由
 * 
 * 使用说明:
 * 1. 复制此文件并重命名为实际模型名
 * 2. 修改 matches 函数中的模型ID
 * 3. 根据API文档实现 buildRequest
 */

import { ModelRoute } from '../types'
import { GenerateImageParams, GenerateVideoParams } from '../../base/BaseAdapter'

export const exampleModelRoute: ModelRoute = {
    /**
     * 判断是否匹配该模型
     */
    matches: (modelId: string) => {
        return modelId === 'example-model-id'  // 修改为实际模型ID
    },

    /**
     * 构建API请求
     */
    buildRequest: (params) => {
        // 根据参数类型判断是图片/视频/音频生成
        if ('images' in params || params.model.includes('image')) {
            // 图片生成示例
            const imageParams = params as GenerateImageParams

            return {
                endpoint: '/image/generate',  // 修改为实际端点
                requestData: {
                    prompt: imageParams.prompt,
                    // 根据API文档添加其他参数
                    num_images: imageParams.num_images || 1,
                    size: imageParams.size,
                    // ...
                }
            }
        } else if ('duration' in params || params.model.includes('video')) {
            // 视频生成示例
            const videoParams = params as GenerateVideoParams

            // 检查是否有图片上传
            const hasImages = videoParams.images && videoParams.images.length > 0

            return {
                endpoint: hasImages ? '/video/image-to-video' : '/video/text-to-video',
                requestData: {
                    prompt: videoParams.prompt,
                    duration: videoParams.duration || 5,
                    ...(hasImages && videoParams.images ? { image: videoParams.images[0] } : {}),
                    // ...
                }
            }
        }

        // 音频生成类似处理
        return {
            endpoint: '/default',
            requestData: { prompt: params.prompt }
        }
    }
}
