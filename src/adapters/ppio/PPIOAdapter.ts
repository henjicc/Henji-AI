import axios, { AxiosInstance } from 'axios'
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

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      // 1. 查找路由
      const route = findRoute(params.model)
      if (!route || !route.buildImageRequest) {
        throw new Error(`Unsupported image model: ${params.model}`)
      }

      // 2. 构建请求
      const { endpoint, requestData } = route.buildImageRequest(params)

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
      console.log('[PPIOAdapter] generateVideo 调用参数:', params)

      // 1. 查找路由
      const route = findRoute(params.model)
      if (!route || !route.buildVideoRequest) {
        throw new Error(`Unsupported video model: ${params.model}`)
      }

      // 2. 构建请求
      const { endpoint, requestData } = route.buildVideoRequest(params)

      console.log('[PPIOAdapter] API端点:', endpoint)
      console.log('[PPIOAdapter] 请求数据:', requestData)

      // 3. 发送请求
      const response = await this.apiClient.post(endpoint, requestData)

      console.log('[PPIOAdapter] API响应:', response.data)

      if (!response.data.task_id) {
        throw new Error('No task ID returned from API')
      }

      const taskId = response.data.task_id

      // 4. 如果提供了进度回调，在 Adapter 内部轮询
      if (params.onProgress) {
        console.log('[PPIOAdapter] 开始内部轮询，taskId:', taskId)
        return await this.statusHandler.pollTaskStatus(taskId, params.model, params.onProgress)
      }

      // 5. 否则返回 taskId，让 App 层控制轮询
      return {
        taskId: taskId,
        status: 'TASK_STATUS_QUEUED'
      }
    } catch (error) {
      console.error('[PPIOAdapter] generateVideo 错误:', error)
      if (axios.isAxiosError(error) && error.response) {
        console.error('[PPIOAdapter] 错误响应数据:', error.response.data)
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
      const { endpoint, requestData } = route.buildAudioRequest(params)

      console.log('[PPIOAdapter] generateAudio 请求', { endpoint, requestData })

      // 3. 发送请求
      const response = await this.apiClient.post(endpoint, requestData)

      console.log('[PPIOAdapter] generateAudio 响应', response.data)

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
      console.error('[PPIOAdapter] generateAudio 错误:', error)
      if (axios.isAxiosError(error) && error.response) {
        console.error('[PPIOAdapter] 错误响应数据:', error.response.data)
      }
      throw this.handleError(error)
    }
  }

  async checkStatus(taskId: string): Promise<TaskStatus> {
    try {
      return await this.statusHandler.checkStatus(taskId)
    } catch (error) {
      console.error('[PPIOAdapter] checkStatus 错误:', error)
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
