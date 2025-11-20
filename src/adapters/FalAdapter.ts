import axios, { AxiosInstance } from 'axios'
import {
    MediaGeneratorAdapter,
    GenerateImageParams,
    GenerateVideoParams,
    GenerateAudioParams,
    ImageResult,
    VideoResult,
    AudioResult,
    TaskStatus
} from './base/BaseAdapter'

export class FalAdapter implements MediaGeneratorAdapter {
    name = 'fal'
    private apiClient: AxiosInstance

    constructor(apiKey: string) {
        this.apiClient = axios.create({
            baseURL: 'https://fal.run',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            }
        })
    }

    async generateImage(params: GenerateImageParams): Promise<ImageResult> {
        try {
            // 智能路由：根据是否有图片选择端点
            const hasImages = params.images && params.images.length > 0
            const endpoint = hasImages ? '/fal-ai/nano-banana/edit' : '/fal-ai/nano-banana'

            const requestData: any = {
                prompt: params.prompt
            }

            // 添加可选参数
            if (params.num_images !== undefined) {
                requestData.num_images = params.num_images
            }

            // aspect_ratio: 只有在不是 'auto' 时才发送
            // 虽然文档说图生图支持 'auto'，但实际 API 不接受，让 API 自动处理即可
            if (params.aspect_ratio !== undefined && params.aspect_ratio !== 'auto') {
                requestData.aspect_ratio = params.aspect_ratio
            }

            // 处理图生图：添加 image_urls
            if (hasImages) {
                // 转换 base64 为 data URI（如果需要）
                requestData.image_urls = params.images!.map(img => {
                    if (typeof img === 'string') {
                        // 如果已经是 data URI，直接使用；否则包装为 data URI
                        return img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
                    }
                    return img
                })
            }

            console.log('[FalAdapter] generateImage 调用参数:', { endpoint, requestData: { ...requestData, image_urls: hasImages ? `[${requestData.image_urls.length} images]` : undefined } })

            // 使用同步请求
            const response = await this.apiClient.post(endpoint, requestData)

            console.log('[FalAdapter] API响应:', response.data)

            // 处理响应
            if (response.data.images && response.data.images.length > 0) {
                const imageUrls = response.data.images.map((img: any) => img.url)
                return {
                    url: imageUrls.join('|||'), // 多图用分隔符连接
                    createdAt: new Date()
                }
            } else {
                throw new Error('No images returned from API')
            }
        } catch (error) {
            console.error('[FalAdapter] generateImage 错误:', error)
            if (axios.isAxiosError(error) && error.response) {
                console.error('[FalAdapter] 错误响应数据:', error.response.data)
            }
            throw this.handleError(error)
        }
    }

    // 占位方法（Nano Banana 不支持视频）
    async generateVideo(_params: GenerateVideoParams): Promise<VideoResult> {
        throw new Error('Video generation is not supported by this provider')
    }

    async generateAudio(_params: GenerateAudioParams): Promise<AudioResult> {
        throw new Error('Audio generation is not supported by this provider')
    }

    async checkStatus(_taskId: string): Promise<TaskStatus> {
        throw new Error('Task status checking is not supported by this provider')
    }

    private handleError(error: any): Error {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                const status = error.response.status
                const data = error.response.data

                // fal 的错误格式
                if (data && data.detail && Array.isArray(data.detail)) {
                    const firstError = data.detail[0]
                    const message = firstError.msg || 'Unknown error'
                    const type = firstError.type || 'unknown'
                    return new Error(`fal API Error (${type}): ${message}`)
                }

                const message = (data && (data.message || data.error)) || error.response.statusText || 'Bad Request'
                return new Error(`fal API Error ${status}: ${message}`)
            } else if (error.request) {
                return new Error('Network error: No response received from fal server')
            }
        }
        return new Error(`Unexpected error: ${error.message || 'Unknown error'}`)
    }
}
