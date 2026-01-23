/**
 * Fal 适配器（重构版 + 兼容层）
 * 职责：路由请求到对应的 Handler，并提供向后兼容的 API
 */

import { BaseAdapter, GenerateImageParams, GenerateVideoParams, GenerateAudioParams, ImageResult, VideoResult, AudioResult, TaskStatus } from '../base/BaseAdapter'
import { ImageHandler } from './handlers/ImageHandler'
import { VideoHandler } from './handlers/VideoHandler'
import { AudioHandler } from './handlers/AudioHandler'
import { handleApiError, getUserFriendlyErrorMessage } from './utils/errorHandler'

export class FalAdapter extends BaseAdapter {
  private imageHandler: ImageHandler
  private videoHandler: VideoHandler
  private audioHandler: AudioHandler

  constructor(apiKey: string) {
    super('fal', apiKey)
    this.imageHandler = new ImageHandler(apiKey)
    this.videoHandler = new VideoHandler(apiKey)
    this.audioHandler = new AudioHandler(apiKey)
  }

  /**
   * 生成媒体内容（新 API）
   */
  async generate(params: any): Promise<any> {
    try {
      const modelType = this.getModelType(params.model)
      const handler = this.getHandler(modelType)

      if (!handler) {
        throw new Error(`Unsupported model type: ${modelType}`)
      }

      return await handler.generate(params)
    } catch (error) {
      const apiError = handleApiError(error)
      const friendlyMessage = getUserFriendlyErrorMessage(apiError)
      throw new Error(friendlyMessage)
    }
  }

  /**
   * 轮询任务状态（新 API）
   */
  async poll(taskId: string, modelType: string): Promise<any> {
    try {
      const handler = this.getHandler(modelType as any)

      if (!handler) {
        throw new Error(`Unsupported model type: ${modelType}`)
      }

      return await handler.poll(taskId)
    } catch (error) {
      const apiError = handleApiError(error)
      const friendlyMessage = getUserFriendlyErrorMessage(apiError)
      throw new Error(friendlyMessage)
    }
  }

  /**
   * 更新 API Key（新 API）
   */
  updateApiKey(apiKey: string): void {
    this.apiKey = apiKey
    this.imageHandler = new ImageHandler(apiKey)
    this.videoHandler = new VideoHandler(apiKey)
    this.audioHandler = new AudioHandler(apiKey)
  }

  // ==================== 兼容层 ====================

  /**
   * 生成图片（兼容旧 API）
   * @deprecated 使用 generate() 替代
   */
  async generateImage(params: GenerateImageParams): Promise<ImageResult> {
    return this.generate(params) as Promise<ImageResult>
  }

  /**
   * 生成视频（兼容旧 API）
   * @deprecated 使用 generate() 替代
   */
  async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
    return this.generate(params) as Promise<VideoResult>
  }

  /**
   * 生成音频（兼容旧 API）
   * @deprecated 使用 generate() 替代
   */
  async generateAudio(params: GenerateAudioParams): Promise<AudioResult> {
    return this.generate(params) as Promise<AudioResult>
  }

  /**
   * 检查任务状态（兼容旧 API）
   * @deprecated 使用 poll() 替代
   */
  async checkStatus(taskId: string): Promise<TaskStatus> {
    const modelType = this.getModelTypeFromTaskId(taskId)
    return this.poll(taskId, modelType) as Promise<TaskStatus>
  }

  /**
   * 继续轮询（兼容旧 API）
   * @deprecated 使用 poll() 替代
   */
  async continuePolling(
    modelId: string,
    requestId: string,
    onProgress?: (status: any) => void
  ): Promise<ImageResult> {
    const taskId = `${modelId}:${requestId}`
    return this.poll(taskId, 'image') as Promise<ImageResult>
  }

  // ==================== 私有方法 ====================

  /**
   * 获取模型类型
   */
  private getModelType(modelId: string): 'image' | 'video' | 'audio' {
    // 根据模型 ID 判断类型
    if (modelId.includes('image') || modelId.includes('flux') || modelId.includes('stable-diffusion') || modelId.includes('nano-banana')) {
      return 'image'
    }
    if (modelId.includes('video') || modelId.includes('kling') || modelId.includes('sora') || modelId.includes('hailuo')) {
      return 'video'
    }
    if (modelId.includes('audio') || modelId.includes('speech') || modelId.includes('music')) {
      return 'audio'
    }
    // 默认为图像
    return 'image'
  }

  /**
   * 从 taskId 中获取模型类型
   */
  private getModelTypeFromTaskId(taskId: string): string {
    const [modelId] = taskId.split(':')
    return this.getModelType(modelId)
  }

  /**
   * 获取对应的 Handler
   */
  private getHandler(modelType: 'image' | 'video' | 'audio') {
    switch (modelType) {
      case 'image':
        return this.imageHandler
      case 'video':
        return this.videoHandler
      case 'audio':
        return this.audioHandler
      default:
        return null
    }
  }
}
