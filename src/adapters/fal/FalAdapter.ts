import { fal } from '@fal-ai/client'
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
} from '../base/BaseAdapter'
import { getEstimatedPolls } from './config'
import { findRoute } from './models'
import { parseImageResponse, parseVideoResponse } from './parsers'
import { calculateProgress } from '@/utils/progress'
import { logError, logInfo } from '../../utils/errorLogger'

/**
 * Fal 适配器
 * 使用官方 @fal-ai/client SDK
 */
export class FalAdapter extends BaseAdapter {
  private pollCount: number = 0

  constructor(apiKey: string) {
    super('fal')
    // 配置官方 fal 客户端
    fal.config({
      credentials: apiKey
    })
  }

  /**
   * 将 data URI 转换为 Blob
   * @param dataUri - data URI 字符串
   * @returns Blob 对象
   */
  private dataURItoBlob(dataUri: string): Blob {
    // 提取 MIME 类型和 base64 数据
    const arr = dataUri.split(',')
    const mimeMatch = arr[0].match(/:(.*?);/)
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }

    return new Blob([u8arr], { type: mime })
  }

  /**
   * 上传单个图片到 fal CDN（如果需要）
   * @param image - 图片（可能是 base64 data URI 或 URL）
   * @returns fal CDN URL
   */
  private async uploadImageToFalCDN(image: string): Promise<string> {
    // 1. 如果已经是 HTTP/HTTPS URL，直接返回
    if (image.startsWith('http://') || image.startsWith('https://')) {
      this.log('图片已是 URL，跳过上传', image.substring(0, 50) + '...')
      return image
    }

    // 2. 如果是 base64 data URI，转换为 Blob 后上传到 fal CDN
    if (image.startsWith('data:')) {
      try {
        this.log('检测到 base64 图片，开始上传到 fal CDN...')
        // 转换为 Blob 以保留正确的 MIME 类型
        const blob = this.dataURItoBlob(image)
        const url = await fal.storage.upload(blob)
        this.log('上传成功，获得 URL:', url)
        return url
      } catch (error) {
        this.log('上传失败，回退到 base64', error)
        // 上传失败时，回退到原始 base64
        return image
      }
    }

    // 3. 如果是纯 base64 字符串（没有 data: 前缀），添加前缀后上传
    try {
      this.log('检测到纯 base64 字符串，添加前缀后上传...')
      const dataUri = `data:image/jpeg;base64,${image}`
      // 转换为 Blob 以保留正确的 MIME 类型
      const blob = this.dataURItoBlob(dataUri)
      const url = await fal.storage.upload(blob)
      this.log('上传成功，获得 URL:', url)
      return url
    } catch (error) {
      this.log('上传失败，回退到 base64', error)
      // 上传失败时，添加前缀后返回
      return `data:image/jpeg;base64,${image}`
    }
  }

  /**
   * 批量上传图片到 fal CDN
   * @param images - 图片数组
   * @returns fal CDN URL 数组
   */
  private async uploadImagesToFalCDN(images: string[]): Promise<string[]> {
    if (!images || images.length === 0) {
      return []
    }

    this.log(`准备上传 ${images.length} 张图片到 fal CDN...`)

    // 并行上传所有图片
    const uploadedUrls = await Promise.all(
      images.map((img, index) => {
        this.log(`上传第 ${index + 1}/${images.length} 张图片...`)
        return this.uploadImageToFalCDN(img)
      })
    )

    this.log(`所有图片上传完成，共 ${uploadedUrls.length} 张`)
    return uploadedUrls
  }

  /**
   * 上传单个视频到 fal CDN（如果需要）
   * @param video - 视频（可能是 base64 data URI 或 URL）
   * @returns fal CDN URL
   */
  private async uploadVideoToFalCDN(video: string | File): Promise<string> {
    // 1. 如果是 File 对象，直接上传到 fal CDN
    if (video instanceof File) {
      try {
        this.log('检测到 File 对象，开始上传到 fal CDN...', {
          name: video.name,
          size: video.size,
          type: video.type
        })
        const url = await fal.storage.upload(video)
        this.log('视频上传成功，获得 URL:', url)
        return url
      } catch (error) {
        this.log('视频上传失败', error)
        throw new Error('视频上传失败，请重试')
      }
    }

    // 2. 如果已经是 HTTP/HTTPS URL，直接返回
    if (video.startsWith('http://') || video.startsWith('https://')) {
      this.log('视频已是 URL，跳过上传', video.substring(0, 50) + '...')
      return video
    }

    // 3. 如果是 base64 data URI，转换为 Blob 后上传到 fal CDN
    if (video.startsWith('data:')) {
      try {
        this.log('检测到 base64 视频，开始上传到 fal CDN...')
        // 转换为 Blob 以保留正确的 MIME 类型
        const blob = this.dataURItoBlob(video)
        const url = await fal.storage.upload(blob)
        this.log('视频上传成功，获得 URL:', url)
        return url
      } catch (error) {
        this.log('视频上传失败', error)
        throw new Error('视频上传失败，请重试')
      }
    }

    // 4. 其他情况，抛出错误
    throw new Error('不支持的视频格式')
  }

  /**
   * 批量上传视频到 fal CDN
   * @param videos - 视频数组（支持 string 或 File 对象）
   * @returns fal CDN URL 数组
   */
  private async uploadVideosToFalCDN(videos: (string | File)[]): Promise<string[]> {
    if (!videos || videos.length === 0) {
      return []
    }

    this.log(`准备上传 ${videos.length} 个视频到 fal CDN...`)

    // 并行上传所有视频
    const uploadedUrls = await Promise.all(
      videos.map((video, index) => {
        this.log(`上传第 ${index + 1}/${videos.length} 个视频...`)
        return this.uploadVideoToFalCDN(video)
      })
    )

    this.log(`所有视频上传完成，共 ${uploadedUrls.length} 个`)
    return uploadedUrls
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      // 1. 如果有图片，先上传到 fal CDN（不修改原始 params）
      let uploadedImages: string[] = []

      // 检查 params.images（多图模式）
      if (params.images && params.images.length > 0) {
        uploadedImages = await this.uploadImagesToFalCDN(params.images)
      }
      // 检查 params.image_url（单图模式）
      else if ((params as any).image_url) {
        const imageUrl = (params as any).image_url
        uploadedImages = await this.uploadImagesToFalCDN([imageUrl])
      }

      // 2. 查找路由
      const modelId = params.model_id || params.model || 'nano-banana'
      const route = findRoute(modelId)
      if (!route || !route.buildImageRequest) {
        throw new Error(`Unsupported image model: ${modelId}`)
      }

      // 3. 构建请求（使用上传后的图片 URL）
      const requestParams = uploadedImages.length > 0
        ? { ...params, images: uploadedImages }
        : params
      const { submitPath, modelId: routeModelId, requestData } = await route.buildImageRequest(requestParams)

      // 构建日志对象，只包含有值的字段
      const logRequestData: any = { ...requestData }
      if (requestData.image_urls) {
        logRequestData.image_urls = `[${requestData.image_urls.length} images]`
      }

      logInfo('[FalAdapter] 提交请求:', {
        submitPath,
        modelId: routeModelId,
        syncMode: requestData.sync_mode,
        requestData: logRequestData
      })

      // 3. 检查是否为同步模式
      if (requestData.sync_mode === true) {
        // 同步模式：使用 fal.run 直接获取结果
        logInfo('', '[FalAdapter] 使用同步模式')

        // 移除 sync_mode 参数，因为它不是 API 参数
        const { sync_mode, ...cleanRequestData } = requestData

        const result = await fal.run(submitPath, {
          input: cleanRequestData
        })
        logInfo('[FalAdapter] 同步请求响应:', result)

        // 直接解析响应数据
        const parsedResult = await parseImageResponse(result)
        return {
          ...parsedResult,
          status: 'completed'
        }
      } else {
        // 队列模式：使用 fal.subscribe 自动轮询
        logInfo('', '[FalAdapter] 使用队列模式')
        this.pollCount = 0
        let capturedRequestId: string | undefined

        const result = await fal.subscribe(submitPath, {
          input: requestData,
          logs: true,
          onQueueUpdate: (update: any) => {
            if (params.onProgress) {
              this.pollCount++

              // 【关键修复】捕获 request_id 并立即通知 App 层
              if (update.request_id && !capturedRequestId) {
                capturedRequestId = update.request_id
                params.onProgress({
                  status: 'TASK_CREATED',
                  requestId: update.request_id,
                  modelId: routeModelId,
                  message: '任务已创建，开始轮询...'
                })
                logInfo('[FalAdapter] 🆔 图片任务已创建，requestId:', update.request_id)
              }

              const progress = this.calculateProgress(update, routeModelId)
              const message = this.getStatusMessage(update)

              logInfo('[FalAdapter] 进度更新:', {
                status: update.status,
                queue_position: update.queue_position,
                pollCount: this.pollCount,
                progress,
                message
              })

              params.onProgress({
                status: update.status as any,
                queue_position: update.queue_position,
                message,
                progress
              })
            }
          }
        })

        logInfo('[FalAdapter] 队列请求完成:', result)

        // 解析响应数据
        const parsedResult = await parseImageResponse(result)
        return {
          ...parsedResult,
          status: 'completed'
        }
      }
    } catch (error) {
      logError('[FalAdapter] generateImage 错误:', error)
      throw this.handleError(error)
    }
  }

  /**
   * 继续轮询（用于超时恢复）
   */
  async continuePolling(
    modelId: string,
    requestId: string,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<ImageResult> {
    logInfo('[FalAdapter] 继续查询:', { modelId, requestId })

    try {
      this.pollCount = 0

      // 【修复】使用 queue.status 轮询状态，而不是 subscribe
      // 因为 subscribe 需要原始输入参数，而我们在超时后已经丢失了
      const pollStatus = async (): Promise<ImageResult> => {
        const statusResponse = await fal.queue.status(modelId, {
          requestId: requestId,
          logs: true
        })

        this.pollCount++
        logInfo('[FalAdapter] 恢复轮询状态:', {
          status: statusResponse.status,
          pollCount: this.pollCount
        })

        // 如果已完成，获取结果
        if (statusResponse.status === 'COMPLETED') {
          const result = await fal.queue.result(modelId, {
            requestId: requestId
          })
          logInfo('[FalAdapter] 恢复查询完成:', result)
          const parsedResult = await parseImageResponse(result)
          return {
            ...parsedResult,
            status: 'completed'
          }
        }

        // 如果还在进行中，通知进度并继续轮询
        if (statusResponse.status === 'IN_PROGRESS' || statusResponse.status === 'IN_QUEUE') {
          const progress = this.calculateProgress(statusResponse, modelId)
          const message = this.getStatusMessage(statusResponse)

          if (onProgress) {
            onProgress({
              status: statusResponse.status as any,
              queue_position: (statusResponse as any).queue_position,
              message,
              progress
            })
          }

          // 等待后继续轮询
          await new Promise(resolve => setTimeout(resolve, 3000))
          return pollStatus()
        }

        // 其他状态（失败等）
        throw new Error(`Task failed with status: ${statusResponse.status}`)
      }

      return await pollStatus()
    } catch (error) {
      logError('[FalAdapter] continuePolling 错误:', error)
      throw this.handleError(error)
    }
  }

  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    try {
      logInfo('[FalAdapter] generateVideo 调用参数:', params)

      // 1. 如果有图片，先上传到 fal CDN（不修改原始 params）
      let uploadedImages: string[] = []

      // 检查 params.images（多图模式）
      if (params.images && params.images.length > 0) {
        uploadedImages = await this.uploadImagesToFalCDN(params.images)
      }
      // 检查 params.image_url（单图模式）
      else if ((params as any).image_url) {
        const imageUrl = (params as any).image_url
        uploadedImages = await this.uploadImagesToFalCDN([imageUrl])
      }

      // 2. 如果有视频，先上传到 fal CDN（不修改原始 params）
      let uploadedVideos: string[] = []
      if (params.videos && params.videos.length > 0) {
        uploadedVideos = await this.uploadVideosToFalCDN(params.videos)
      }

      // 3. 查找路由
      const route = findRoute(params.model)
      if (!route || !route.buildVideoRequest) {
        throw new Error(`Unsupported video model: ${params.model}`)
      }

      // 4. 构建请求（使用上传后的图片和视频 URL）
      const requestParams = {
        ...params,
        ...(uploadedImages.length > 0 && { images: uploadedImages }),
        ...(uploadedVideos.length > 0 && { videos: uploadedVideos })
      }
      const { endpoint, modelId, requestData } = await route.buildVideoRequest(requestParams)

      // 构建日志对象，只包含有值的字段
      const logRequestData: any = { ...requestData }
      if (requestData.image_url) {
        logRequestData.image_url = 'Image URL provided'
      }
      if (requestData.image_urls) {
        logRequestData.image_urls = `[${requestData.image_urls.length} images]`
      }

      logInfo('[FalAdapter] 提交视频生成请求:', {
        endpoint,
        modelId,
        requestData: logRequestData
      })

      // 3. 如果提供了 onProgress 回调，使用 subscribe 自动轮询
      if (params.onProgress) {
        this.pollCount = 0
        let capturedRequestId: string | undefined

        const result = await fal.subscribe(endpoint, {
          input: requestData,
          logs: true,
          onQueueUpdate: (update: any) => {
            this.pollCount++
            // 【新增】捕获 request_id 用于超时恢复
            if (update.request_id && !capturedRequestId) {
              capturedRequestId = update.request_id
              // 【关键修复】立即通知 App 层保存 requestId
              params.onProgress!({
                status: 'TASK_CREATED',
                requestId: update.request_id,
                modelId: modelId,
                message: '任务已创建，开始轮询...'
              })
              logInfo('[FalAdapter] 🆔 任务已创建，requestId:', update.request_id)
            }

            const progress = this.calculateProgress(update, modelId)
            const message = this.getStatusMessage(update)

            logInfo('[FalAdapter] 视频生成进度更新:', {
              status: update.status,
              queue_position: update.queue_position,
              pollCount: this.pollCount,
              progress,
              message
            })

            params.onProgress!({
              status: update.status as any,
              queue_position: update.queue_position,
              message,
              progress
            })
          }
        })

        logInfo('[FalAdapter] 视频生成完成:', result)

        // 解析响应数据
        const parsedResult = await parseVideoResponse(result, this)
        // 【修改】确保返回结果包含 requestId 和 modelId，用于超时恢复
        return {
          ...parsedResult,
          requestId: capturedRequestId || (result as any).request_id,
          modelId: modelId
        }
      }

      // 4. 否则只提交任务，返回 taskId
      const { request_id } = await fal.queue.submit(endpoint, {
        input: requestData
      })

      logInfo('[FalAdapter] 视频生成请求已提交:', { request_id, modelId })

      return {
        taskId: `${modelId}:${request_id}`,
        status: 'QUEUED'
      }
    } catch (error) {
      logError('[FalAdapter] generateVideo 错误:', error)
      throw this.handleError(error)
    }
  }

  async generateAudio(_params: GenerateAudioParams): Promise<AudioResult> {
    throw new Error('Audio generation is not supported by this provider')
  }

  async checkStatus(taskId: string): Promise<TaskStatus> {
    try {
      // 解析 taskId
      const [modelId, requestId] = taskId.split(':')
      if (!modelId || !requestId) {
        throw new Error('Invalid taskId format. Expected "modelId:requestId"')
      }

      logInfo('[FalAdapter] 检查状态:', { modelId, requestId })

      // 使用官方 SDK 查询状态
      const statusResponse = await fal.queue.status(modelId, {
        requestId: requestId,
        logs: true
      })

      logInfo('[FalAdapter] 状态响应:', statusResponse)

      // 如果状态是 COMPLETED，获取结果
      if (statusResponse.status === 'COMPLETED') {
        const result = await fal.queue.result(modelId, {
          requestId: requestId
        })

        const parsedResult = await parseVideoResponse(result, this)

        return {
          taskId,
          status: 'TASK_STATUS_SUCCEED',
          result: parsedResult as VideoResult
        }
      }

      // 转换其他状态为统一格式
      let unifiedStatus: string
      const currentStatus = statusResponse.status as string

      if (currentStatus === 'IN_QUEUE' || currentStatus === 'IN_PROGRESS') {
        unifiedStatus = 'TASK_STATUS_PROCESSING'
      } else if (currentStatus === 'FAILED') {
        unifiedStatus = 'TASK_STATUS_FAILED'
      } else {
        unifiedStatus = currentStatus
      }

      return {
        taskId,
        status: unifiedStatus as any,
        result: undefined
      }
    } catch (error) {
      logError('[FalAdapter] checkStatus 错误:', error)
      throw this.handleError(error)
    }
  }

  /**
   * 计算进度（基于轮询次数）
   */
  private calculateProgress(update: any, modelId: string): number {
    if (update.status === 'IN_QUEUE') {
      return 5
    } else if (update.status === 'IN_PROGRESS') {
      // 基于轮询次数计算进度
      const estimatedPolls = getEstimatedPolls(modelId)
      const progress = calculateProgress(this.pollCount, estimatedPolls)
      // 确保进度在 10-95 之间
      return Math.max(10, Math.min(95, progress))
    } else if (update.status === 'COMPLETED') {
      return 100
    }
    return 0
  }

  /**
   * 获取状态消息
   */
  private getStatusMessage(update: any): string {
    if (update.status === 'IN_QUEUE') {
      return update.queue_position !== undefined
        ? `排队中... 前面还有 ${update.queue_position} 个请求`
        : '排队中...'
    }
    if (update.status === 'IN_PROGRESS') {
      // 尝试从 logs 中提取有用信息
      if (update.logs && update.logs.length > 0) {
        const latestLog = update.logs[update.logs.length - 1]
        if (latestLog?.message) {
          return latestLog.message
        }
      }
      return '正在生成...'
    }
    return '完成'
  }

  /**
   * 错误处理
   */
  private handleError(error: any): Error {
    logError(`[${this.name}] 错误详情:`, error)

    // 处理官方 SDK 的错误格式
    if (error.body?.detail) {
      // fal API 错误格式
      if (Array.isArray(error.body.detail)) {
        const firstError = error.body.detail[0]
        const message = firstError.msg || 'Unknown error'
        const type = firstError.type || 'unknown'
        return new Error(`fal API Error (${type}): ${message}`)
      }
      return new Error(`fal API Error: ${error.body.detail}`)
    }

    if (error.message) {
      return new Error(`fal Error: ${error.message}`)
    }

    return new Error(`Unexpected error: ${JSON.stringify(error)}`)
  }
}
