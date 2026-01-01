import axios, { AxiosInstance, AxiosError } from 'axios'
import { AdapterFactory, AdapterConfig, AdapterType } from '../adapters'
import { MediaGeneratorAdapter, ImageResult, VideoResult, AudioResult } from '../adapters/base/BaseAdapter'
import { logInfo } from '../utils/errorLogger'

export class ApiService {
  private adapter: MediaGeneratorAdapter | null = null
  private apiKey: string = ''

  setApiKey(apiKey: string) {
    this.apiKey = apiKey
  }

  initializeAdapter(config: Omit<AdapterConfig, 'apiKey'>) {
    if (!this.apiKey) {
      throw new Error('API key is not set')
    }

    // 如果是魔搭适配器，尝试获取 fal API key 用于文件上传
    let falApiKey: string | undefined
    if (config.type === 'modelscope') {
      falApiKey = localStorage.getItem('fal_api_key') || undefined
      if (falApiKey) {
        logInfo('', '[ApiService] 魔搭适配器将使用 fal API key 进行文件上传')
      }
    }

    const fullConfig: AdapterConfig = {
      ...config,
      apiKey: this.apiKey,
      falApiKey
    }

    this.adapter = AdapterFactory.createAdapter(fullConfig)
    logInfo('[ApiService] 适配器已初始化', fullConfig)
  }

  async generateImage(prompt: string, model: string, options?: any) {
    if (!this.adapter) {
      throw new Error('Adapter is not initialized')
    }

    return this.adapter.generateImage({
      prompt,
      model,
      ...options
    })
  }

  async generateVideo(prompt: string, model: string, options?: any) {
    if (!this.adapter) {
      throw new Error('Adapter is not initialized')
    }

    return this.adapter.generateVideo({
      prompt,
      model,
      ...options
    })
  }

  async generateAudio(text: string, model: string, options?: any) {
    if (!this.adapter) {
      throw new Error('Adapter is not initialized')
    }

    logInfo('[ApiService] generateAudio 调用', { text, model, options })
    return this.adapter.generateAudio({
      text,
      model,
      ...options
    })
  }

  async checkTaskStatus(taskId: string) {
    if (!this.adapter) {
      throw new Error('Adapter is not initialized')
    }

    return this.adapter.checkStatus(taskId)
  }

  getAdapter(): MediaGeneratorAdapter | null {
    return this.adapter
  }

  /**
   * 创建独立适配器（供节点式界面、工具箱等使用）
   * 不影响全局适配器状态
   */
  createAdapter(config: Omit<AdapterConfig, 'apiKey'> & { apiKey?: string }): MediaGeneratorAdapter {
    const apiKey = config.apiKey || localStorage.getItem(`${config.type}_api_key`) || ''
    if (!apiKey) {
      throw new Error(`API key for ${config.type} is not set`)
    }

    // 如果是魔搭适配器，尝试获取 fal API key 用于文件上传
    let falApiKey: string | undefined
    if (config.type === 'modelscope') {
      falApiKey = localStorage.getItem('fal_api_key') || undefined
    }

    return AdapterFactory.createAdapter({
      ...config,
      apiKey,
      falApiKey
    })
  }

  /**
   * 一次性调用（自动选择适配器）
   * 适用于节点式工作流等场景
   */
  async generateWithModel(
    type: 'image' | 'video' | 'audio',
    params: {
      provider: AdapterType
      model: string
      prompt?: string
      text?: string
      onProgress?: (status: any) => void
      [key: string]: any
    }
  ): Promise<ImageResult | VideoResult | AudioResult> {
    const adapter = this.createAdapter({
      type: params.provider,
      modelName: params.model
    })

    const { provider, model, prompt, text, ...restParams } = params

    switch (type) {
      case 'image':
        return adapter.generateImage({
          ...restParams,
          prompt: prompt || '',
          model
        })
      case 'video':
        return adapter.generateVideo({
          ...restParams,
          prompt: prompt || '',
          model
        })
      case 'audio':
        return adapter.generateAudio({
          ...restParams,
          text: text || '',
          model
        })
    }
  }
}

// 创建全局API服务实例
export const apiService = new ApiService()

// API错误类
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public data?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Axios拦截器用于统一错误处理
const apiClient: AxiosInstance = axios.create({
  timeout: 30000
})

apiClient.interceptors.response.use(
  response => response,
  (error: AxiosError) => {
    if (error.response) {
      throw new ApiError(
        (error.response.data as any)?.message || 'Request failed',
        error.response.status,
        error.response.data
      )
    }
    throw new Error('Network error')
  }
)

export default apiClient
