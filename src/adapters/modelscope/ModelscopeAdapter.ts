import axios, { AxiosInstance } from 'axios'
import {
  BaseAdapter,
  GenerateImageParams,
  ImageResult
} from '../base/BaseAdapter'
import { MODELSCOPE_CONFIG } from './config'
import { findRoute } from './models'
import { parseImageResponse } from './parsers'

export class ModelscopeAdapter extends BaseAdapter {
  private apiClient: AxiosInstance

  constructor(apiKey: string) {
    super('ModelScope')
    this.apiClient = axios.create({
      baseURL: MODELSCOPE_CONFIG.baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      // 1. 查找路由
      const route = findRoute(params.model)
      if (!route || !route.buildImageRequest) {
        throw new Error(`Unsupported ModelScope model: ${params.model}`)
      }

      // 2. 构建请求
      const { endpoint, requestData } = route.buildImageRequest(params)

      this.log('发送魔搭API请求:', { endpoint, requestData })

      // 3. 发送请求（不使用自定义请求头，避免 CORS 问题）
      const response = await this.apiClient.post(endpoint, requestData)

      this.log('魔搭API响应:', response.data)

      // 4. 解析响应（返回 taskId）
      const result = parseImageResponse(response.data)

      // 5. 如果有进度回调，开始轮询
      if (result.taskId && params.onProgress) {
        return await this.pollTaskStatus(result.taskId, params.onProgress)
      }

      return result
    } catch (error) {
      console.error('[ModelscopeAdapter] generateImage 错误:', error)
      if (axios.isAxiosError(error) && error.response) {
        console.error('[ModelscopeAdapter] 错误响应数据:', error.response.data)
      }
      throw this.formatError(error)
    }
  }

  async checkStatus(taskId: string): Promise<any> {
    try {
      const response = await this.apiClient.get(`${MODELSCOPE_CONFIG.statusEndpoint}/${taskId}`)
      return response.data
    } catch (error) {
      console.error('[ModelscopeAdapter] checkStatus 错误:', error)
      throw this.formatError(error)
    }
  }

  async pollTaskStatus(taskId: string, onProgress?: any): Promise<ImageResult> {
    const { pollUntilComplete } = await import('@/utils/polling')
    const { getExpectedPolls } = await import('@/utils/modelConfig')

    // 魔搭API默认预期轮询次数
    const estimatedPolls = getExpectedPolls('modelscope-default') || 40

    const result = await pollUntilComplete<ImageResult>({
      checkFn: async () => {
        const status = await this.checkStatus(taskId)

        // 如果任务完成，返回图片URL
        if (status.task_status === 'SUCCEED' && status.output_images) {
          const urls = status.output_images
          return {
            status: 'SUCCEED',
            result: {
              url: Array.isArray(urls) && urls.length > 1 ? urls.join('|||') : urls[0],
              status: 'COMPLETED'
            }
          }
        }

        return {
          status: status.task_status,
          result: undefined
        }
      },
      isComplete: (status) => status === 'SUCCEED',
      isFailed: (status) => status === 'FAILED',
      onProgress: (progress, status) => {
        if (onProgress) {
          onProgress({
            status: status as any,
            progress,
            message: this.getStatusMessage(status)
          })
        }
      },
      interval: MODELSCOPE_CONFIG.pollInterval,
      maxAttempts: MODELSCOPE_CONFIG.maxPollAttempts,
      estimatedAttempts: estimatedPolls
    })

    return result
  }

  private getStatusMessage(status: string): string {
    const messages: Record<string, string> = {
      'QUEUED': '排队中...',
      'RUNNING': '生成中...',
      'SUCCEED': '完成',
      'FAILED': '失败'
    }
    return messages[status] || '处理中...'
  }
}
