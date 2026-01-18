import axios, { AxiosInstance } from 'axios'
import { readFile } from '@tauri-apps/plugin-fs'
import {
  BaseAdapter,
  GenerateImageParams,
  GenerateVideoParams,
  GenerateAudioParams,
  ImageResult,
  VideoResult,
  AudioResult,
  TaskStatus
} from '../base/BaseAdapter'
import { PPIO_CONFIG } from './config'
import { findRoute } from './models'
import { PPIOStatusHandler } from './statusHandler'
import { parseImageResponse, parseAudioResponse } from './parsers'
import { logError, logInfo } from '../../utils/errorLogger'

/**
 * 派欧云适配器
 * 重构后的模块化版本
 */
export class PPIOAdapter extends BaseAdapter {
  private apiClient: AxiosInstance
  private statusHandler: PPIOStatusHandler

  constructor(apiKey: string) {
    super('PPIO')
    this.apiClient = axios.create({
      baseURL: PPIO_CONFIG.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    })
    this.statusHandler = new PPIOStatusHandler(this.apiClient, this)
  }

  private async resolveToBlobOrUrl(pathOrUrl: string): Promise<string | Blob> {
    if (!pathOrUrl) return pathOrUrl
    if (pathOrUrl.startsWith('http') && !pathOrUrl.includes('asset.localhost') && !pathOrUrl.includes('tauri.localhost')) {
      return pathOrUrl
    }
    if (pathOrUrl.startsWith('data:')) {
      return pathOrUrl
    }

    // Local file handling
    let filePath = pathOrUrl
    if (filePath.startsWith('asset:') || filePath.startsWith('tauri:') || filePath.includes('localhost')) {
      try {
        const url = new URL(filePath)
        filePath = decodeURIComponent(url.pathname)
        // Ensure absolute path logic if needed
      } catch (e) {
        // use as is
      }
    }

    // Read file
    const data = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() || 'dat'
    let mime = 'application/octet-stream'
    if (['jpg', 'jpeg'].includes(ext)) mime = 'image/jpeg'
    if (ext === 'png') mime = 'image/png'
    if (ext === 'webp') mime = 'image/webp'
    if (ext === 'mp4') mime = 'video/mp4'
    if (ext === 'webm') mime = 'video/webm'
    if (ext === 'mp3') mime = 'audio/mpeg'
    if (ext === 'wav') mime = 'audio/wav'

    return new Blob([data], { type: mime })
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      // 0. 处理文件上传 (使用通用上传服务)
      let finalParams = { ...params }
      const imagesNeedUpload = params.images && params.images.length > 0 && params.images.some(img =>
        img.startsWith('data:') || img.startsWith('asset:') || img.startsWith('tauri:') || img.startsWith('/')
      )

      if (imagesNeedUpload) {
        try {
          const { UploadService } = await import('../../services/upload/UploadService')
          const uploadService = UploadService.getInstance()
          this.log('开始处理图片上传 (provider: ' + uploadService.getCurrentProvider() + ')...')

          // Convert all local files/base64 to uploadable format
          const filesToUpload = await Promise.all(params.images!.map(img => this.resolveToBlobOrUrl(img)))
          const uploadedUrls = await uploadService.uploadFiles(filesToUpload)

          finalParams.images = uploadedUrls
          // 同时更新 imageUrls 兼容旧代码
          finalParams.imageUrls = uploadedUrls

          this.log('图片上传完成:', uploadedUrls)
        } catch (error) {
          this.log('图片上传失败:', error)
          throw new Error(`图片上传失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // 1. 查找路由
      const route = findRoute(finalParams.model)
      if (!route || !route.buildImageRequest) {
        throw new Error(`Unsupported image model: ${finalParams.model}`)
      }

      // 2. 构建请求
      const { endpoint, requestData } = await route.buildImageRequest(finalParams)

      // 3. 发送请求
      const response = await this.apiClient.post(endpoint, requestData)

      // 4. 解析响应
      return parseImageResponse(response.data)
    } catch (error) {
      throw this.handleError(error)
    }
  }

  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    try {
      // 输出日志方便调试
      logInfo('[PPIOAdapter] generateVideo 调用参数:', params)

      // 0. 处理文件上传 (使用通用上传服务)
      let finalParams = { ...params }
      const hasImages = params.images && params.images.length > 0
      const hasVideo = !!params.video

      const imagesNeedUpload = hasImages && params.images!.some(img =>
        img.startsWith('data:') || img.startsWith('asset:') || img.startsWith('tauri:') || img.startsWith('/')
      )
      const videoNeedsUpload = hasVideo && (
        (typeof params.video === 'string' && (params.video.startsWith('data:') || params.video.startsWith('asset:') || params.video.startsWith('tauri:') || params.video.startsWith('/')))
        // Or if it's not a string (Blob/File) - logic below handles conversion
      )

      if (imagesNeedUpload || videoNeedsUpload) {
        try {
          const { UploadService } = await import('../../services/upload/UploadService')
          const uploadService = UploadService.getInstance()
          this.log('开始处理文件上传 (provider: ' + uploadService.getCurrentProvider() + ')...')

          // 上传图片
          if (hasImages && imagesNeedUpload) {
            const filesToUpload = await Promise.all(params.images!.map(img => this.resolveToBlobOrUrl(img)))
            const uploadedUrls = await uploadService.uploadFiles(filesToUpload)
            finalParams.images = uploadedUrls
            this.log('图片上传完成:', uploadedUrls)
          }

          // 上传视频
          if (hasVideo && videoNeedsUpload && typeof params.video === 'string') {
            const fileToUpload = await this.resolveToBlobOrUrl(params.video)
            const videoUrl = await uploadService.uploadFile(fileToUpload)
            finalParams.video = videoUrl
            this.log('视频上传完成:', videoUrl)
          }

        } catch (error) {
          this.log('文件上传失败:', error)
          throw new Error(`文件上传失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // 1. 查找路由
      const route = findRoute(finalParams.model)
      if (!route || !route.buildVideoRequest) {
        throw new Error(`Unsupported video model: ${finalParams.model}`)
      }

      // 2. 构建请求
      const { endpoint, requestData } = await route.buildVideoRequest(finalParams)

      logInfo('[PPIOAdapter] API端点:', endpoint)
      logInfo('[PPIOAdapter] 请求数据:', requestData)

      // 3. 发送请求
      const response = await this.apiClient.post(endpoint, requestData)

      logInfo('[PPIOAdapter] API响应:', response.data)

      if (!response.data.task_id) {
        throw new Error('No task ID returned from API')
      }

      const taskId = response.data.task_id

      logInfo('[PPIOAdapter] ✅ 任务创建成功，taskId:', taskId)

      // 4. 如果提供了进度回调，在 Adapter 内部轮询
      if (finalParams.onProgress) {
        // 【关键修复】立即通过 onProgress 回调传递 taskId，让 App 层尽早保存
        finalParams.onProgress({
          status: 'TASK_CREATED',
          taskId: taskId,
          message: '任务已创建，开始轮询...'
        })

        logInfo('[PPIOAdapter] 开始内部轮询，taskId:', taskId)
        const result = await this.statusHandler.pollTaskStatus(taskId, finalParams.model, finalParams.onProgress)
        // 【修改】确保返回结果包含 taskId，用于超时恢复
        logInfo('[PPIOAdapter] 📦 轮询完成，返回结果:', {
          status: result.status,
          hasUrl: !!result.url,
          taskId: taskId
        })
        return {
          ...result,
          taskId: taskId
        }
      }

      // 5. 否则返回 taskId，让 App 层控制轮询
      return {
        taskId: taskId,
        status: 'TASK_STATUS_QUEUED'
      }
    } catch (error) {
      logError('[PPIOAdapter] generateVideo 错误:', error)
      if (axios.isAxiosError(error) && error.response) {
        logError('[PPIOAdapter] 错误响应数据:', error.response.data)
      }
      throw this.handleError(error)
    }
  }

  async generateAudio(params: GenerateAudioParams): Promise<AudioResult> {
    try {
      // 1. 查找路由
      const route = findRoute(params.model)
      if (!route || !route.buildAudioRequest) {
        throw new Error(`Unsupported audio model: ${params.model}`)
      }

      // 2. 构建请求
      const { endpoint, requestData } = await route.buildAudioRequest(params)

      logInfo('[PPIOAdapter] generateAudio 请求', { endpoint, requestData })

      // 3. 发送请求
      const response = await this.apiClient.post(endpoint, requestData)

      logInfo('[PPIOAdapter] generateAudio 响应', response.data)

      // 4. 解析响应
      const audioResult = await parseAudioResponse(response.data)

      // 5. 保存到本地
      try {
        const savedResult = await this.saveMediaLocally(audioResult.url, 'audio')
        return {
          url: savedResult.url,
          filePath: savedResult.filePath
        }
      } catch (e) {
        this.log('音频本地保存失败，回退为远程URL', e)
        return audioResult
      }
    } catch (error) {
      logError('[PPIOAdapter] generateAudio 错误:', error)
      if (axios.isAxiosError(error) && error.response) {
        logError('[PPIOAdapter] 错误响应数据:', error.response.data)
      }
      throw this.handleError(error)
    }
  }

  async checkStatus(taskId: string): Promise<TaskStatus> {
    try {
      return await this.statusHandler.checkStatus(taskId)
    } catch (error) {
      logError('[PPIOAdapter] checkStatus 错误:', error)
      throw this.handleError(error)
    }
  }

  /**
   * 轮询任务状态直到完成（Adapter 内部轮询）
   * 委托给 statusHandler 处理
   */
  async pollTaskStatus(
    taskId: string,
    modelId: string,
    onProgress?: (status: any) => void
  ): Promise<VideoResult> {
    return this.statusHandler.pollTaskStatus(taskId, modelId, onProgress)
  }

  /**
   * 继续轮询任务（用于超时恢复）
   */
  async continuePolling(
    modelId: string,
    taskId: string,
    onProgress?: (status: any) => void
  ): Promise<VideoResult> {
    logInfo('[PPIOAdapter] 继续轮询任务:', { taskId, modelId })
    return this.statusHandler.pollTaskStatus(taskId, modelId, onProgress)
  }

  private handleError(error: any): Error {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status
        const data = error.response.data
        const message = (data && (data.message || data.error || data.reason)) || error.response.statusText || 'Bad Request'
        const details = typeof data === 'object' ? JSON.stringify(data) : String(data)
        return new Error(`API Error ${status}: ${message}${details ? ` | ${details}` : ''}`)
      } else if (error.request) {
        return new Error('Network error: No response received from server')
      }
    }
    return new Error(`Unexpected error: ${error.message || 'Unknown error'}`)
  }
}
