import { AxiosInstance } from 'axios'
import { FAL_CONFIG, getEstimatedPolls } from './config'
import { ProgressStatus, ImageResult, VideoResult } from '../base/BaseAdapter'
import { parseImageResponse, parseVideoResponse } from './parsers'
import { calculateProgress } from '@/utils/progress'

/**
 * Fal 队列处理器
 * 负责队列任务的提交、轮询和结果获取
 */
export class FalQueueHandler {
  constructor(
    private apiClient: AxiosInstance,
    private adapter: any
  ) {}

  /**
   * 提交图片生成任务到队列
   */
  async submitImageTask(
    submitPath: string,
    requestData: any
  ): Promise<string> {
    console.log('[FalQueueHandler] 提交图片生成任务:', { submitPath, requestData })

    const response = await this.apiClient.post(`/${submitPath}`, requestData)
    const { request_id } = response.data

    console.log('[FalQueueHandler] 任务已提交:', { request_id })
    return request_id
  }

  /**
   * 提交视频生成任务到队列
   */
  async submitVideoTask(
    endpoint: string,
    requestData: any
  ): Promise<string> {
    console.log('[FalQueueHandler] 提交视频生成任务:', { endpoint, requestData })

    const response = await this.apiClient.post(`/${endpoint}`, requestData)
    const { request_id } = response.data

    console.log('[FalQueueHandler] 视频任务已提交:', { request_id })
    return request_id
  }

  /**
   * 轮询图片生成任务状态
   */
  async pollImageStatus(
    modelId: string,
    requestId: string,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<ImageResult> {
    const statusUrl = `/${modelId}/requests/${requestId}/status`
    const maxAttempts = FAL_CONFIG.maxPollAttempts
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await this.apiClient.get(statusUrl)
        const { status, queue_position, logs } = statusResponse.data

        // 计算进度
        const progress = this.calculateProgress(status, attempts, modelId)

        console.log('[FalQueueHandler] 图片生成状态更新:', {
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
          const result = await this.getImageResult(modelId, requestId)
          return {
            ...result,
            status: 'completed'
          }
        }

        // 根据状态调整轮询间隔
        const delay = status === 'IN_QUEUE'
          ? FAL_CONFIG.queuePollInterval
          : FAL_CONFIG.pollInterval
        await this.sleep(delay)
        attempts++
      } catch (error) {
        console.error('[FalQueueHandler] 图片状态轮询错误:', error)
        throw error
      }
    }

    // 超时但不抛出错误，返回 timeout 状态
    console.warn('[FalQueueHandler] 图片生成轮询超时，任务仍在处理中')
    return {
      url: '',
      createdAt: new Date(),
      status: 'timeout',
      requestId: requestId,
      modelId: modelId,
      message: '等待超时，任务依然在处理中'
    }
  }

  /**
   * 轮询视频生成任务状态
   */
  async pollVideoStatus(
    modelId: string,
    requestId: string,
    onProgress: (status: ProgressStatus) => void
  ): Promise<VideoResult> {
    const statusUrl = `/${modelId}/requests/${requestId}/status`
    const maxAttempts = FAL_CONFIG.maxPollAttempts
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await this.apiClient.get(statusUrl)
        const { status, queue_position, logs } = statusResponse.data

        // 计算进度
        const progress = this.calculateProgress(status, attempts, modelId)

        console.log('[FalQueueHandler] 视频生成状态更新:', {
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
          return await this.getVideoResult(modelId, requestId)
        }

        // 根据状态调整轮询间隔
        const delay = status === 'IN_QUEUE'
          ? FAL_CONFIG.queuePollInterval
          : FAL_CONFIG.pollInterval
        await this.sleep(delay)
        attempts++
      } catch (error) {
        console.error('[FalQueueHandler] 视频状态轮询错误:', error)
        throw error
      }
    }

    // 超时但不抛出错误，返回timeout状态
    console.warn('[FalQueueHandler] 视频生成轮询超时，任务仍在处理中')
    return {
      taskId: `${modelId}:${requestId}`,
      status: 'timeout'
    }
  }

  /**
   * 获取图片生成结果
   */
  private async getImageResult(
    modelId: string,
    requestId: string
  ): Promise<ImageResult> {
    const resultUrl = `/${modelId}/requests/${requestId}`

    try {
      const response = await this.apiClient.get(resultUrl)
      console.log('[FalQueueHandler] 获取图片结果:', response.data)
      return parseImageResponse(response.data)
    } catch (error) {
      console.error('[FalQueueHandler] 获取图片结果时出错:', error)
      throw error
    }
  }

  /**
   * 获取视频生成结果
   */
  private async getVideoResult(
    modelId: string,
    requestId: string
  ): Promise<VideoResult> {
    const resultUrl = `/${modelId}/requests/${requestId}`

    try {
      const response = await this.apiClient.get(resultUrl)
      this.adapter.log('获取视频结果:', response.data)
      return parseVideoResponse(response.data, this.adapter)
    } catch (error) {
      this.adapter.log('获取视频结果时出错:', error)
      throw error
    }
  }

  /**
   * 计算进度
   */
  private calculateProgress(
    status: string,
    attempts: number,
    modelId: string
  ): number {
    if (status === 'IN_QUEUE') {
      return 5
    } else if (status === 'IN_PROGRESS') {
      const estimatedAttempts = getEstimatedPolls(modelId)
      return calculateProgress(attempts, estimatedAttempts)
    } else if (status === 'COMPLETED') {
      return 100
    }
    return 0
  }

  /**
   * 获取状态消息
   */
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

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
