/**
 * Fal 适配器主文件（重构版）
 * 职责：路由请求到对应的 Handler
 */

import { BaseAdapter } from '../base/BaseAdapter'
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
   * 生成媒体内容
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
   * 轮询任务状态
   */
  async poll(taskId: string, modelType: string): Promise<any> {
    try {
      const handler = this.getHandler(modelType)

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
   * 获取模型类型
   */
  private getModelType(modelId: string): 'image' | 'video' | 'audio' {
    // 根据模型 ID 判断类型
    if (modelId.includes('image') || modelId.includes('flux') || modelId.includes('stable-diffusion')) {
      return 'image'
    }
    if (modelId.includes('video') || modelId.includes('kling') || modelId.includes('sora')) {
      return 'video'
    }
    if (modelId.includes('audio') || modelId.includes('speech') || modelId.includes('music')) {
      return 'audio'
    }
    // 默认为图像
    return 'image'
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

  /**
   * 更新 API Key
   */
  updateApiKey(apiKey: string): void {
    this.apiKey = apiKey
    this.imageHandler = new ImageHandler(apiKey)
    this.videoHandler = new VideoHandler(apiKey)
    this.audioHandler = new AudioHandler(apiKey)
  }
}
