import axios, { AxiosInstance } from 'axios'
import {
    BaseAdapter,
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

export class FalAdapter extends BaseAdapter {
    private apiClient: AxiosInstance

    constructor(apiKey: string) {
        super('fal') // 调用基类构造函数
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

    async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
        try {
            const { prompt, mode = 'text-image-to-video', images = [], duration = 8 } = params
            const hasImages = images.length > 0
            const isFastMode = params.fastMode || false
            
            // 根据模式和图片数量选择API端点
            let endpoint: string
            let modelId: string
            
            if (mode === 'start-end-frame') {
                // 首尾帧模式
                if (images.length < 2) {
                    throw new Error('首尾帧模式需要至少2张图片')
                }
                endpoint = isFastMode 
                    ? 'fal-ai/veo3.1/fast/first-last-frame-to-video' 
                    : 'fal-ai/veo3.1/first-last-frame-to-video'
                modelId = 'fal-ai/veo3.1' // 轮询时使用不带subpath的modelId
            } else if (mode === 'reference-to-video') {
                // 参考生视频模式
                if (images.length === 0) {
                    throw new Error('参考生视频模式需要至少1张图片')
                }
                endpoint = 'fal-ai/veo3.1/reference-to-video'
                modelId = 'fal-ai/veo3.1' // 轮询时使用不带subpath的modelId
            } else {
                // 文/图生视频模式
                if (hasImages) {
                    // 图生视频
                    endpoint = isFastMode 
                        ? 'fal-ai/veo3.1/fast/image-to-video' 
                        : 'fal-ai/veo3.1/image-to-video'
                } else {
                    // 文生视频
                    endpoint = isFastMode 
                        ? 'fal-ai/veo3.1/fast' 
                        : 'fal-ai/veo3.1'
                }
                modelId = 'fal-ai/veo3.1' // 轮询时使用不带subpath的modelId
            }

            // 构建请求数据
            const requestData: any = {
                prompt,
                duration: `${duration}s`
            }

            // 添加可选参数
            // 优先使用veo特定的宽高比和分辨率参数
            let veoAspectRatio = params.veoAspectRatio || params.aspectRatio
            
            // 如果宽高比为auto，根据上传的第一张图片计算宽高比
            if (veoAspectRatio === 'auto' && hasImages) {
                try {
                    // 获取第一张图片的宽高比
                    const firstImageUrl = images[0]
                    const aspectRatio = await this.getImageAspectRatio(firstImageUrl)
                    
                    // 匹配最适合的预设宽高比
                    veoAspectRatio = this.matchAspectRatio(aspectRatio)
                    console.log(`[FalAdapter] 自动计算宽高比: ${aspectRatio.toFixed(2)}，匹配预设: ${veoAspectRatio}`)
                } catch (error) {
                    console.error('[FalAdapter] 计算图片宽高比失败:', error)
                    // 如果计算失败，使用默认宽高比
                    veoAspectRatio = '16:9'
                }
            }
            
            if (veoAspectRatio && veoAspectRatio !== 'auto') {
                requestData.aspect_ratio = veoAspectRatio
            }
            
            const veoResolution = params.veoResolution || params.resolution
            if (veoResolution) {
                requestData.resolution = veoResolution
            }
            
            if (params.veoEnhancePrompt !== undefined) {
                requestData.enhance_prompt = params.veoEnhancePrompt
            }
            
            if (params.veoGenerateAudio !== undefined) {
                requestData.generate_audio = params.veoGenerateAudio
            }
            
            if (params.veoAutoFix !== undefined) {
                requestData.auto_fix = params.veoAutoFix
            }

            // 处理图片
            if (hasImages) {
                if (mode === 'start-end-frame') {
                    // 首尾帧模式：使用first_frame_url和last_frame_url
                    requestData.first_frame_url = images[0]
                    requestData.last_frame_url = images[1]
                } else if (mode === 'reference-to-video') {
                    // 参考生视频模式：使用image_urls
                    requestData.image_urls = images
                } else {
                    // 文/图生视频模式：使用image_url
                    requestData.image_url = images[0]
                }
            }

            console.log('[FalAdapter] 提交视频生成请求:', {
                endpoint,
                modelId,
                requestData: {
                    ...requestData,
                    image_url: hasImages ? 'Image URL provided' : undefined,
                    image_urls: requestData.image_urls ? `[${requestData.image_urls.length} images]` : undefined
                }
            })

            // 提交到队列
            const submitResponse = await this.apiClient.post(`/${endpoint}`, requestData)
            const { request_id } = submitResponse.data

            console.log('[FalAdapter] 视频生成请求已提交:', { request_id, modelId })

            // 如果提供了onProgress回调，开始轮询
            if (params.onProgress) {
                return await this.pollVideoStatus(modelId, request_id, params.onProgress)
            }

            // 否则返回taskId
            return {
                taskId: `${modelId}:${request_id}`,
                status: 'QUEUED'
            }
        } catch (error) {
            console.error('[FalAdapter] generateVideo 错误:', error)
            if (axios.isAxiosError(error) && error.response) {
                console.error('[FalAdapter] 错误响应数据:', error.response.data)
            }
            throw this.handleError(error)
        }
    }

    private async pollVideoStatus(
        modelId: string,
        requestId: string,
        onProgress: (status: ProgressStatus) => void
    ): Promise<VideoResult> {
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

                console.log('[FalAdapter] 视频生成状态更新:', {
                    status,
                    queue_position,
                    attempts,
                    progress,
                    logs: logs?.length || 0
                })

                // 调用进度回调
                onProgress({
                    status,
                    queue_position,
                    message: this.getStatusMessage(status, queue_position, logs),
                    progress
                })

                if (status === 'COMPLETED') {
                    // 获取最终结果
                    return await this.getVideoQueueResult(modelId, requestId)
                }

                // 根据状态调整轮询间隔
                const delay = status === 'IN_QUEUE' ? 2000 : 1000
                await this.sleep(delay)
                attempts++
            } catch (error) {
                console.error('[FalAdapter] 视频状态轮询错误:', error)
                throw error
            }
        }

        // 超时但不抛出错误，返回timeout状态
        console.warn('[FalAdapter] 视频生成轮询超时，任务仍在处理中')
        return {
            taskId: `${modelId}:${requestId}`,
            status: 'timeout'
        }
    }

    private async getVideoQueueResult(
        modelId: string,
        requestId: string
    ): Promise<VideoResult> {
        const resultUrl = `/${modelId}/requests/${requestId}`

        try {
            const response = await this.apiClient.get(resultUrl)

            this.log('获取视频队列结果:', response.data)

            // 队列API返回的结构：{ video: { url: "..." } }
            if (response.data.video) {
                const videoUrl = response.data.video.url
                let result: VideoResult = {
                    url: videoUrl,
                    status: 'COMPLETED'
                }

                // 使用基类的保存方法
                const savedResult = await this.saveMediaLocally(videoUrl, 'video')
                result.url = savedResult.url
                ; (result as any).filePath = savedResult.filePath

                return result
            } else {
                throw new Error('No video returned from queue')
            }
        } catch (error) {
            // 队列任务完成，但模型执行出错（例如 422 错误）
            this.log('获取视频结果时出错:', error)
            if (axios.isAxiosError(error) && error.response) {
                this.log('视频结果错误响应:', error.response.data)
                // 使用 handleError 解析错误
                throw this.handleError(error)
            }
            throw error
        }
    }

    async generateAudio(_params: GenerateAudioParams): Promise<AudioResult> {
        throw new Error('Audio generation is not supported by this provider')
    }

    async checkStatus(taskId: string): Promise<TaskStatus> {
        // 注意：taskId格式为 "modelId:requestId"
        const [modelId, requestId] = taskId.split(':')
        if (!modelId || !requestId) {
            throw new Error('Invalid taskId format. Expected "modelId:requestId"')
        }

        const statusUrl = `/${modelId}/requests/${requestId}/status`
        const response = await this.apiClient.get(statusUrl)
        const { status } = response.data

        // 如果状态是 COMPLETED，直接获取结果
        if (status === 'COMPLETED') {
            const resultResponse = await this.apiClient.get(`/${modelId}/requests/${requestId}`)
            const { video } = resultResponse.data
            
            return {
                taskId,
                status: 'TASK_STATUS_SUCCEED', // 转换为统一的状态格式
                result: {
                    url: video.url
                } as VideoResult
            }
        }

        // 转换其他状态为统一格式
        let unifiedStatus: string
        switch (status) {
            case 'IN_QUEUE':
            case 'IN_PROGRESS':
                unifiedStatus = 'TASK_STATUS_PROCESSING'
                break
            case 'FAILED':
                unifiedStatus = 'TASK_STATUS_FAILED'
                break
            default:
                unifiedStatus = status as string
        }

        return {
            taskId,
            status: unifiedStatus as any,
            result: undefined
        }
    }

    private getEstimatedAttempts(modelId: string): number {
        // 注意：先检查 pro 版本，因为它也包含 'nano-banana' 字符串
        if (modelId.includes('nano-banana-pro')) return 30
        if (modelId.includes('nano-banana')) return 10
        if (modelId.includes('flux')) return 60
        if (modelId.includes('veo3.1')) return 60 // Veo 3.1 视频生成预计轮询次数
        return 40 // 默认值
    }
    
    /**
     * 获取图片的宽高比
     * @param imageUrl 图片URL
     * @returns 宽高比（width/height）
     */
    private async getImageAspectRatio(imageUrl: string): Promise<number> {
        return new Promise((resolve, reject) => {
            // 检查是否是 data URL
            if (imageUrl.startsWith('data:')) {
                const img = new Image()
                img.onload = () => {
                    resolve(img.width / img.height)
                }
                img.onerror = reject
                img.src = imageUrl
            } else {
                // 对于远程 URL，使用 axios 获取图片数据
                this.apiClient.get(imageUrl, { responseType: 'blob' })
                    .then(response => {
                        const img = new Image()
                        img.onload = () => {
                            resolve(img.width / img.height)
                        }
                        img.onerror = reject
                        img.src = URL.createObjectURL(response.data)
                    })
                    .catch(reject)
            }
        })
    }
    
    /**
     * 匹配最适合的预设宽高比
     * @param aspectRatio 实际宽高比（width/height）
     * @returns 匹配的预设宽高比
     */
    private matchAspectRatio(aspectRatio: number): string {
        // 预设的宽高比选项
        const presetRatios = [
            { value: '16:9', ratio: 16/9 },
            { value: '9:16', ratio: 9/16 },
            { value: '1:1', ratio: 1/1 }
        ]
        
        // 找到最接近的预设宽高比
        let closestRatio = presetRatios[0]
        let minDiff = Math.abs(aspectRatio - closestRatio.ratio)
        
        for (const preset of presetRatios) {
            const diff = Math.abs(aspectRatio - preset.ratio)
            if (diff < minDiff) {
                minDiff = diff
                closestRatio = preset
            }
        }
        
        return closestRatio.value
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
