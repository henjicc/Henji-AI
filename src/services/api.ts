import axios, { AxiosInstance, AxiosError } from 'axios'
import { AdapterFactory, AdapterConfig } from '../adapters'
import { MediaGeneratorAdapter } from '../adapters/base/BaseAdapter'

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
    
    const fullConfig: AdapterConfig = {
      ...config,
      apiKey: this.apiKey
    }
    
    this.adapter = AdapterFactory.createAdapter(fullConfig)
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
        error.response.data?.message || 'Request failed',
        error.response.status,
        error.response.data
      )
    }
    throw new Error('Network error')
  }
)

export default apiClient