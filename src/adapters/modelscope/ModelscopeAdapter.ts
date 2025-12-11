import { invoke } from '@tauri-apps/api/core'
import {
  BaseAdapter,
  GenerateImageParams,
  GenerateVideoParams,
  GenerateAudioParams,
  ImageResult,
  VideoResult,
  AudioResult
} from '../base/BaseAdapter'
import { MODELSCOPE_CONFIG } from './config'
import { findRoute } from './models'

interface ModelscopeTaskResponse {
  task_id: string
  request_id: string
}

interface ModelscopeTaskStatus {
  task_status: string
  output_images?: string[]
  request_id: string
}

export class ModelscopeAdapter extends BaseAdapter {
  private apiKey: string
  private falApiKey?: string

  constructor(apiKey: string, falApiKey?: string) {
    super('ModelScope')
    this.apiKey = apiKey
    this.falApiKey = falApiKey
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    // 1. 如果有图片且需要上传到 CDN，使用 fal 上传
    if (params.images && params.images.length > 0 && !params.imageUrls) {
      if (this.falApiKey) {
        try {
          this.log('检测到图片，开始上传到 fal CDN...')
          const { uploadMultipleToFalCDN } = await import('@/utils/falUpload')

          const uploadedUrls = await uploadMultipleToFalCDN(params.images, this.falApiKey)
          params.imageUrls = uploadedUrls
          this.log('图片上传完成，获得 URL:', uploadedUrls)
        } catch (error) {
          this.log('图片上传失败，将尝试直接使用原始图片:', error)
          // 上传失败时，不设置 imageUrls，让模型路由决定如何处理
        }
      } else {
        this.log('未配置 fal API key，跳过图片上传')
      }
    }

    // 2. 查找路由
    const route = findRoute(params.model)
    if (!route || !route.buildImageRequest) {
      throw new Error(`Unsupported ModelScope model: ${params.model}`)
    }

    // 3. 构建请求
    const { requestData } = route.buildImageRequest(params)

    try {
      this.log('发送魔搭API请求（通过后端）:', requestData)

      // 3. 通过 Tauri 后端发送异步请求
      const response = await invoke<ModelscopeTaskResponse>('modelscope_submit_task', {
        apiKey: this.apiKey,
        request: requestData
      })

      this.log('魔搭API响应:', response)

      // 4. 开始轮询任务状态
      return await this.pollTaskStatus(response.task_id, params.onProgress)
    } catch (error) {
      console.error('[ModelscopeAdapter] generateImage 错误:', error)
      console.error('[ModelscopeAdapter] 请求数据:', JSON.stringify(requestData, null, 2))
      throw this.formatError(error)
    }
  }

  async generateVideo(_params: GenerateVideoParams): Promise<VideoResult> {
    throw new Error('ModelScope adapter does not support video generation yet')
  }

  async generateAudio(_params: GenerateAudioParams): Promise<AudioResult> {
    throw new Error('ModelScope adapter does not support audio generation yet')
  }

  async checkStatus(taskId: string): Promise<any> {
    try {
      // 通过 Tauri 后端查询任务状态
      const response = await invoke<ModelscopeTaskStatus>('modelscope_check_status', {
        apiKey: this.apiKey,
        taskId: taskId
      })
      return response
    } catch (error) {
      console.error('[ModelscopeAdapter] checkStatus 错误:', error)
      throw this.formatError(error)
    }
  }

  async pollTaskStatus(taskId: string, onProgress?: any): Promise<ImageResult> {
    const { pollUntilComplete } = await import('@/utils/polling')

    // 魔搭API预期轮询次数设置为6
    // PENDING和PROCESSING状态都会计入次数
    const estimatedPolls = 6

    const result = await pollUntilComplete<ImageResult>({
      checkFn: async () => {
        const status = await this.checkStatus(taskId)

        // 记录完整的状态响应，便于调试
        this.log('任务状态查询结果:', status)

        // 如果任务完成，返回图片URL
        if (status.task_status === 'SUCCEED' && status.output_images) {
          const urls = status.output_images
          const combinedUrl = Array.isArray(urls) && urls.length > 1 ? urls.join('|||') : urls[0]

          // 保存图片到本地
          try {
            this.log('开始保存图片到本地...')
            const savedResult = await this.saveMediaLocally(combinedUrl, 'image')
            this.log('图片保存成功:', savedResult)

            return {
              status: 'SUCCEED',
              result: {
                url: savedResult.url,
                filePath: savedResult.filePath,
                status: 'completed'
              }
            }
          } catch (error) {
            this.log('图片保存失败，使用远程URL:', error)
            return {
              status: 'SUCCEED',
              result: {
                url: combinedUrl,
                status: 'completed'
              }
            }
          }
        }

        // 如果任务失败，记录详细错误信息
        if (status.task_status === 'FAILED') {
          console.error('[ModelscopeAdapter] 任务失败，完整响应:', JSON.stringify(status, null, 2))
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
