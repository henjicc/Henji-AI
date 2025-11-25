import axios, { AxiosInstance } from 'axios'
import {
    MediaGeneratorAdapter,
    GenerateImageParams,
    GenerateVideoParams,
    GenerateAudioParams,
    ImageResult,
    VideoResult,
    AudioResult,
    TaskStatus,
    ProgressStatus
} from './base/BaseAdapter'
import { calculateProgress } from '../utils/progress'

export class FalAdapter implements MediaGeneratorAdapter {
    name = 'fal'
    private apiClient: AxiosInstance

    constructor(apiKey: string) {
        this.apiClient = axios.create({
            baseURL: 'https://queue.fal.run',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json'
            }
        })
    }

    async generateImage(params: GenerateImageParams): Promise<ImageResult> {
        try {
            const hasImages = params.images && params.images.length > 0

            // 智能路由：根据 model_id 和是否有图片选择端点
            // submitPath: 提交请求的完整路径（包含subpath如/edit）
            // modelId: 查询状态/结果时使用的model_id（不含subpath）
            let submitPath: string
            let modelId: string

            if (params.model_id === 'nano-banana-pro') {
                modelId = 'fal-ai/nano-banana-pro'
                submitPath = hasImages ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro'
            } else {
                // 默认使用 nano-banana
                modelId = 'fal-ai/nano-banana'
                submitPath = hasImages ? 'fal-ai/nano-banana/edit' : 'fal-ai/nano-banana'
            }

            const requestData: any = {
                prompt: params.prompt
            }

            // 添加可选参数
            if (params.num_images !== undefined) {
                requestData.num_images = params.num_images
            }

            // aspect_ratio: 只有在不是 'auto' 时才发送
            if (params.aspect_ratio !== undefined && params.aspect_ratio !== 'auto') {
                requestData.aspect_ratio = params.aspect_ratio
            }

            // 添加 resolution 参数（仅 nano-banana-pro）
            if (params.resolution !== undefined) {
                requestData.resolution = params.resolution
            }

            // 处理图生图：添加 image_urls
            if (hasImages) {
                requestData.image_urls = params.images!.map(img => {
                    if (typeof img === 'string') {
                        return img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`
                    }
                    return img
                })
            }

            console.log('[FalAdapter] 提交队列请求:', {
                submitPath,
                modelId,
                requestData: {
                    ...requestData,
                    image_urls: hasImages ? `[${requestData.image_urls.length} images]` : undefined
                }
            })

            // 提交到队列（使用完整路径包含subpath）
            const submitResponse = await this.apiClient.post(`/${submitPath}`, requestData)
            const { request_id } = submitResponse.data

            console.log('[FalAdapter] 请求已提交到队列:', { request_id, submitPath, modelId })

            // 轮询状态直到完成（使用model_id，不含subpath）
            return await this.pollQueueStatus(modelId, request_id, params.onProgress)
        } catch (error) {
            console.error('[FalAdapter] generateImage 错误:', error)
            if (axios.isAxiosError(error) && error.response) {
                console.error('[FalAdapter] 错误响应数据:', error.response.data)
            }
            throw this.handleError(error)
        }
    }

    async continuePolling(
        modelId: string,
        requestId: string,
        onProgress?: (status: ProgressStatus) => void
    ): Promise<ImageResult> {
        console.log('[FalAdapter] 继续查询:', { modelId, requestId })
        // 直接调用 pollQueueStatus，重新开始轮询
        return await this.pollQueueStatus(modelId, requestId, onProgress)
    }

    private async pollQueueStatus(
        modelId: string,
        requestId: string,
        onProgress?: (status: ProgressStatus) => void
    ): Promise<ImageResult> {
        const statusUrl = `/${modelId}/requests/${requestId}/status`
        const maxAttempts = 120  // 最多轮询2分钟
        let attempts = 0

        while (attempts < maxAttempts) {
            try {
                const statusResponse = await this.apiClient.get(statusUrl)
                const { status, queue_position, logs } = statusResponse.data

                // 计算进度
                let progress = 0
                const estimatedAttempts = this.getEstimatedAttempts(modelId)

                if (status === 'IN_QUEUE') {
                    progress = 5
                } else if (status === 'IN_PROGRESS') {
                    // 使用统一的进度计算逻辑
                    progress = calculateProgress(attempts, estimatedAttempts)
                } else if (status === 'COMPLETED') {
                    progress = 100
                }

                console.log('[FalAdapter] 状态更新:', {
                    status,
                    queue_position,
                    attempts,
                    progress,
                    logs: logs?.length || 0
                })

                // 调用进度回调
                if (onProgress) {
                    onProgress({
                        status,
                        queue_position,
                        message: this.getStatusMessage(status, queue_position, logs),
                        progress
                    })
                }

                if (status === 'COMPLETED') {
                    // 获取最终结果
                    const result = await this.getQueueResult(modelId, requestId)
                    return {
                        ...result,
                        status: 'completed'
                    }
                }

                // 根据状态调整轮询间隔
                const delay = status === 'IN_QUEUE' ? 2000 : 1000
                await this.sleep(delay)
                attempts++
            } catch (error) {
                console.error('[FalAdapter] 状态轮询错误:', error)
                throw error
            }
        }

        // 超时但不抛出错误，返回 timeout 状态
        console.warn('[FalAdapter] 轮询超时，任务仍在处理中')
        return {
            url: '',
            createdAt: new Date(),
            status: 'timeout',
            requestId: requestId,
            modelId: modelId,
            message: '等待超时，任务依然在处理中'
        }
    }

    private async getQueueResult(
        modelId: string,
        requestId: string
    ): Promise<ImageResult> {
        const resultUrl = `/${modelId}/requests/${requestId}`

        try {
            const response = await this.apiClient.get(resultUrl)

            console.log('[FalAdapter] 获取队列结果:', response.data)

            // 队列API返回的结构：{ images: [...], description: "..." }
            // 注意：不是 response.response.images，而是直接 response.images
            if (response.data.images && response.data.images.length > 0) {
                const imageUrls = response.data.images.map((img: any) => img.url)
                return {
                    url: imageUrls.join('|||'),
                    createdAt: new Date()
                }
            } else {
                throw new Error('No images returned from queue')
            }
        } catch (error) {
            // 队列任务完成，但模型执行出错（例如 422 错误）
            console.error('[FalAdapter] 获取结果时出错:', error)
            if (axios.isAxiosError(error) && error.response) {
                console.error('[FalAdapter] 结果错误响应:', error.response.data)
                // 使用 handleError 解析错误
                throw this.handleError(error)
            }
            throw error
        }
    }

    private getStatusMessage(
        status: string,
        queuePosition?: number,
        logs?: any[]
    ): string {
        if (status === 'IN_QUEUE') {
            return queuePosition !== undefined
                ? `排队中... 前面还有 ${queuePosition} 个请求`
                : '排队中...'
        }
        if (status === 'IN_PROGRESS') {
            // 尝试从logs中提取有用信息
            if (logs && logs.length > 0) {
                const latestLog = logs[logs.length - 1]
                if (latestLog?.message) {
                    return latestLog.message
                }
            }
            return '正在生成...'
        }
        return '完成'
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
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

    private getEstimatedAttempts(modelId: string): number {
        // 注意：先检查 pro 版本，因为它也包含 'nano-banana' 字符串
        if (modelId.includes('nano-banana-pro')) return 30
        if (modelId.includes('nano-banana')) return 10
        if (modelId.includes('flux')) return 60
        return 40 // 默认值
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
