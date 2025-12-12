import axios, { AxiosInstance } from 'axios'
import {
  BaseAdapter,
  GenerateImageParams,
  GenerateVideoParams,
  GenerateAudioParams,
  ImageResult,
  VideoResult,
  AudioResult
} from '../base/BaseAdapter'
import { KIE_CONFIG } from './config'
import { findRoute } from './models'
import { parseImageResponse, parseVideoResponse } from './parsers'
import { logInfo } from '../../utils/errorLogger'

export class KIEAdapter extends BaseAdapter {
  private apiClient: AxiosInstance
  private uploadClient: AxiosInstance

  constructor(apiKey: string) {
    super('KIE')
    this.apiClient = axios.create({
      baseURL: KIE_CONFIG.baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    this.uploadClient = axios.create({
      baseURL: KIE_CONFIG.uploadBaseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    })
  }

  /**
   * 将 data URL 转换为 Blob（不使用 fetch，兼容 Tauri 生产环境）
   */
  private dataURLtoBlob(dataURL: string): Blob {
    const parts = dataURL.split(',')
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg'
    const bstr = atob(parts[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  }

  /**
   * 上传图片到 KIE CDN
   */
  private async uploadImageToKIE(imageDataUrl: string): Promise<string> {
    try {
      this.log('开始上传图片到 KIE CDN...')

      // 将 data URL 转换为 Blob（不使用 fetch，避免 Tauri 生产环境限制）
      const blob = this.dataURLtoBlob(imageDataUrl)
      this.log(`图片转换为 Blob 成功，大小: ${blob.size} bytes`)

      // 创建 FormData
      const formData = new FormData()
      formData.append('file', blob, 'image.jpg')
      formData.append('uploadPath', 'henji-uploads')

      this.log('开始发送上传请求到:', KIE_CONFIG.uploadBaseURL + KIE_CONFIG.fileUploadEndpoint)

      // 上传到 KIE CDN
      const uploadResponse = await this.uploadClient.post(
        KIE_CONFIG.fileUploadEndpoint,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      )

      this.log('上传响应状态:', uploadResponse.status)
      this.log('上传响应数据:', JSON.stringify(uploadResponse.data, null, 2))

      // 检查响应格式 - 优先使用 fileUrl，如果不存在则使用 downloadUrl
      if (uploadResponse.data && uploadResponse.data.data) {
        const fileUrl = uploadResponse.data.data.fileUrl || uploadResponse.data.data.downloadUrl
        if (fileUrl) {
          this.log('图片上传成功:', fileUrl)
          return fileUrl
        }
      }

      // 如果响应格式不符合预期，输出完整响应以便调试
      this.log('上传响应格式不符合预期，完整响应:', uploadResponse.data)
      throw new Error('上传响应中未找到文件 URL')
    } catch (error: any) {
      this.log('图片上传失败:', error.message || error)
      if (error.response) {
        this.log('错误响应状态:', error.response.status)
        this.log('错误响应数据:', error.response.data)
      }
      throw new Error(`图片上传到 KIE CDN 失败: ${error.message || error}`)
    }
  }

  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    try {
      const route = findRoute(params.model)
      if (!route || !route.buildImageRequest) {
        throw new Error(`不支持的图片模型: ${params.model}`)
      }

      // 如果有图片，先上传到 KIE CDN
      let uploadedImageUrls: string[] = []
      if (params.images && params.images.length > 0) {
        this.log('开始上传图片到 KIE CDN...')
        uploadedImageUrls = await Promise.all(
          params.images.map(img => this.uploadImageToKIE(img))
        )
        this.log('所有图片上传完成:', uploadedImageUrls)
      }

      // 构建请求（传入上传后的 URL）
      const { requestData } = route.buildImageRequest({
        ...params,
        images: uploadedImageUrls
      })

      // 构建日志对象，对图片 URL 做简化处理
      const logRequestData: any = { ...requestData }
      if (requestData.input?.image_input && Array.isArray(requestData.input.image_input)) {
        logRequestData.input = {
          ...requestData.input,
          image_input: `[${requestData.input.image_input.length} images]`
        }
      }

      logInfo('[KIEAdapter] 提交请求:', {
        endpoint: KIE_CONFIG.createTaskEndpoint,
        model: requestData.model,
        requestData: logRequestData
      })

      // 创建任务
      const response = await this.apiClient.post(
        KIE_CONFIG.createTaskEndpoint,
        requestData
      )

      if (response.data.code !== 200) {
        throw new Error(response.data.msg || '创建任务失败')
      }

      const taskId = response.data.data?.taskId
      if (!taskId) {
        throw new Error('响应中未找到任务 ID')
      }

      this.log('任务创建成功:', taskId)

      // 如果提供了进度回调，内部轮询
      if (params.onProgress) {
        return await this.pollTaskStatus(taskId, params.model, params.onProgress)
      }

      // 否则返回 taskId
      return {
        taskId: taskId,
        url: ''
      }
    } catch (error: any) {
      this.log('生成图片失败:', error.message || error)
      throw error
    }
  }

  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    try {
      const route = findRoute(params.model)
      if (!route || !route.buildVideoRequest) {
        throw new Error(`不支持的视频模型: ${params.model}`)
      }

      // 如果有图片，先上传到 KIE CDN
      let uploadedImageUrls: string[] = []
      if (params.images && params.images.length > 0) {
        this.log('开始上传图片到 KIE CDN...')
        // Grok Imagine 视频最多支持 1 张图片
        const imagesToUpload = params.images.slice(0, 1)
        uploadedImageUrls = await Promise.all(
          imagesToUpload.map(img => this.uploadImageToKIE(img))
        )
        this.log('所有图片上传完成:', uploadedImageUrls)
      }

      // 构建请求（传入上传后的 URL）
      const { requestData } = route.buildVideoRequest({
        ...params,
        images: uploadedImageUrls
      })

      // 构建日志对象，对图片 URL 做简化处理
      const logRequestData: any = { ...requestData }
      if (requestData.input?.image_urls && Array.isArray(requestData.input.image_urls)) {
        logRequestData.input = {
          ...requestData.input,
          image_urls: `[${requestData.input.image_urls.length} images]`
        }
      }

      logInfo('[KIEAdapter] 提交视频请求:', {
        endpoint: KIE_CONFIG.createTaskEndpoint,
        model: requestData.model,
        requestData: logRequestData
      })

      // 创建任务
      const response = await this.apiClient.post(
        KIE_CONFIG.createTaskEndpoint,
        requestData
      )

      if (response.data.code !== 200) {
        throw new Error(response.data.msg || '创建任务失败')
      }

      const taskId = response.data.data?.taskId
      if (!taskId) {
        throw new Error('响应中未找到任务 ID')
      }

      this.log('视频任务创建成功:', taskId)

      // 如果提供了进度回调，内部轮询
      if (params.onProgress) {
        return await this.pollVideoTaskStatus(taskId, params.model, params.onProgress)
      }

      // 否则返回 taskId
      return {
        taskId: taskId,
        url: ''
      }
    } catch (error: any) {
      this.log('生成视频失败:', error.message || error)
      throw error
    }
  }

  async generateAudio(_params: GenerateAudioParams): Promise<AudioResult> {
    throw new Error('KIE adapter does not support audio generation yet')
  }

  async checkStatus(taskId: string): Promise<any> {
    const response = await this.apiClient.get(KIE_CONFIG.statusEndpoint, {
      params: { taskId }
    })

    if (response.data.code !== 200) {
      throw new Error(response.data.msg || '查询任务状态失败')
    }

    return response.data.data
  }

  /**
   * 轮询任务状态直到完成
   */
  async pollTaskStatus(
    taskId: string,
    modelId: string,
    onProgress?: any
  ): Promise<ImageResult> {
    const { pollUntilComplete } = await import('@/utils/polling')
    const { getExpectedPolls } = await import('@/utils/modelConfig')

    const estimatedPolls = getExpectedPolls(modelId)

    let pollCount = 0

    const result = await pollUntilComplete<ImageResult>({
      checkFn: async () => {
        pollCount++
        const statusData = await this.checkStatus(taskId)

        // 映射 KIE 状态到标准状态
        const status = this.mapKIEStatus(statusData.state)

        this.log(`[轮询 ${pollCount}/${estimatedPolls}] 任务状态:`, {
          taskId,
          kieState: statusData.state,
          status,
          createTime: statusData.createTime,
          updateTime: statusData.updateTime
        })

        // 如果成功，解析结果
        if (status === 'COMPLETED' && statusData.resultJson) {
          this.log('任务完成，解析结果...')
          const resultData = JSON.parse(statusData.resultJson)
          const imageResult = await parseImageResponse(resultData, this)
          return { status, result: imageResult }
        }

        // 如果失败，返回错误信息
        if (status === 'FAILED') {
          this.log('任务失败:', statusData.failMsg)
          throw new Error(statusData.failMsg || '任务失败')
        }

        return { status, result: undefined }
      },
      isComplete: (status) => status === 'COMPLETED',
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
      interval: KIE_CONFIG.pollInterval,
      maxAttempts: KIE_CONFIG.maxPollAttempts,
      estimatedAttempts: estimatedPolls
    })

    return result
  }

  /**
   * 轮询视频任务状态直到完成
   */
  async pollVideoTaskStatus(
    taskId: string,
    modelId: string,
    onProgress?: any
  ): Promise<VideoResult> {
    const { pollUntilComplete } = await import('@/utils/polling')
    const { getExpectedPolls } = await import('@/utils/modelConfig')

    const estimatedPolls = getExpectedPolls(modelId)

    let pollCount = 0

    const result = await pollUntilComplete<VideoResult>({
      checkFn: async () => {
        pollCount++
        const statusData = await this.checkStatus(taskId)

        // 映射 KIE 状态到标准状态
        const status = this.mapKIEStatus(statusData.state)

        this.log(`[视频轮询 ${pollCount}/${estimatedPolls}] 任务状态:`, {
          taskId,
          kieState: statusData.state,
          status,
          createTime: statusData.createTime,
          updateTime: statusData.updateTime
        })

        // 如果成功，解析结果
        if (status === 'COMPLETED' && statusData.resultJson) {
          this.log('视频任务完成，解析结果...')
          const resultData = JSON.parse(statusData.resultJson)
          const videoResult = await parseVideoResponse(resultData, this)
          return { status, result: videoResult }
        }

        // 如果失败，返回错误信息
        if (status === 'FAILED') {
          this.log('视频任务失败:', statusData.failMsg)
          throw new Error(statusData.failMsg || '视频任务失败')
        }

        return { status, result: undefined }
      },
      isComplete: (status) => status === 'COMPLETED',
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
      interval: KIE_CONFIG.pollInterval,
      maxAttempts: KIE_CONFIG.maxPollAttempts,
      estimatedAttempts: estimatedPolls
    })

    return result
  }

  /**
   * 映射 KIE 状态到标准状态
   */
  private mapKIEStatus(kieState: string): string {
    const statusMap: Record<string, string> = {
      'waiting': 'QUEUED',
      'queuing': 'QUEUED',
      'generating': 'PROCESSING',
      'success': 'COMPLETED',
      'fail': 'FAILED'
    }
    return statusMap[kieState] || 'PROCESSING'
  }

  private getStatusMessage(status: string): string {
    const messages: Record<string, string> = {
      'QUEUED': '排队中...',
      'PROCESSING': '生成中...',
      'COMPLETED': '完成',
      'FAILED': '失败'
    }
    return messages[status] || '处理中...'
  }
}
