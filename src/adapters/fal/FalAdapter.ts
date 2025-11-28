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
} from '../base/BaseAdapter'
import { FAL_CONFIG } from './config'
import { findRoute } from './models'
import { FalQueueHandler } from './queueHandler'
import { FalStatusHandler } from './statusHandler'
import { parseImageResponse } from './parsers'

/**
 * Fal 适配器
 * 重构后的模块化版本
 */
export class FalAdapter extends BaseAdapter {
  private apiClient: AxiosInstance
  private syncApiClient: AxiosInstance
  private queueHandler: FalQueueHandler
  private statusHandler: FalStatusHandler

  constructor(apiKey: string) {
    super('fal')
    // 队列模式客户端
    this.apiClient = axios.create({
      baseURL: FAL_CONFIG.baseURL,
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    // 同步模式客户端
    this.syncApiClient = axios.create({
      baseURL: 'https://fal.run',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    this.queueHandler = new FalQueueHandler(this.apiClient, this)
    this.statusHandler = new FalStatusHandler(this.apiClient, this)
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      // 1. 查找路由
      // 同时支持model和model_id参数，以兼容不同的调用方式
      const modelId = params.model_id || params.model || 'nano-banana'
      const route = findRoute(modelId)
      if (!route || !route.buildImageRequest) {
        throw new Error(`Unsupported image model: ${modelId}`)
      }

      // 2. 构建请求
      const { submitPath, modelId: routeModelId, requestData } = route.buildImageRequest(params)

      console.log('[FalAdapter] 提交请求:', {
        submitPath,
        modelId: routeModelId,
        syncMode: requestData.sync_mode,
        requestData: {
          ...requestData,
          image_urls: requestData.image_urls ? `[${requestData.image_urls.length} images]` : undefined
        }
      })

      // 3. 检查是否为同步模式
      if (requestData.sync_mode === true) {
        // 同步模式：使用 fal.run 端点直接获取结果
        console.log('[FalAdapter] 使用同步模式 (https://fal.run)')

        // 移除 sync_mode 参数，因为它不是 API 参数
        const { sync_mode, ...cleanRequestData } = requestData

        const response = await this.syncApiClient.post(submitPath, cleanRequestData)
        console.log('[FalAdapter] 同步请求响应:', response.data)

        // 直接解析响应数据
        const result = await parseImageResponse(response.data)
        return {
          ...result,
          status: 'completed'
        }
      } else {
        // 队列模式：提交到队列并轮询
        console.log('[FalAdapter] 使用队列模式 (https://queue.fal.run)')
        const requestId = await this.queueHandler.submitImageTask(submitPath, requestData)
        console.log('[FalAdapter] 请求已提交到队列:', { request_id: requestId, submitPath, modelId: routeModelId })

        // 轮询状态直到完成
        return await this.queueHandler.pollImageStatus(routeModelId, requestId, params.onProgress)
      }
    } catch (error) {
      console.error('[FalAdapter] generateImage 错误:', error)
      if (axios.isAxiosError(error) && error.response) {
        console.error('[FalAdapter] 错误响应数据:', error.response.data)
      }
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
    console.log('[FalAdapter] 继续查询:', { modelId, requestId })
    return await this.queueHandler.pollImageStatus(modelId, requestId, onProgress)
  }

  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    try {
      console.log('[FalAdapter] generateVideo 调用参数:', params)

      // 1. 查找路由
      const route = findRoute('veo3.1')
      if (!route || !route.buildVideoRequest) {
        throw new Error('Unsupported video model')
      }

      // 2. 构建请求
      const { endpoint, modelId, requestData } = await route.buildVideoRequest(params)

      console.log('[FalAdapter] 提交视频生成请求:', {
        endpoint,
        modelId,
        requestData: {
          ...requestData,
          image_url: requestData.image_url ? 'Image URL provided' : undefined,
          image_urls: requestData.image_urls ? `[${requestData.image_urls.length} images]` : undefined
        }
      })

      // 3. 提交到队列
      const requestId = await this.queueHandler.submitVideoTask(endpoint, requestData)

      console.log('[FalAdapter] 视频生成请求已提交:', { request_id: requestId, modelId })

      // 4. 如果提供了onProgress回调，开始轮询
      if (params.onProgress) {
        return await this.queueHandler.pollVideoStatus(modelId, requestId, params.onProgress)
      }

      // 5. 否则返回taskId
      return {
        taskId: `${modelId}:${requestId}`,
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

  async generateAudio(_params: GenerateAudioParams): Promise<AudioResult> {
    throw new Error('Audio generation is not supported by this provider')
  }

  async checkStatus(taskId: string): Promise<TaskStatus> {
    try {
      return await this.statusHandler.checkStatus(taskId)
    } catch (error) {
      console.error('[FalAdapter] checkStatus 错误:', error)
      throw this.handleError(error)
    }
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
