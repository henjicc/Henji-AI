/**
 * Provider Handler 抽象基类
 *
 * 使用模板方法模式定义统一的生成流程
 * 子类只需实现特定的预处理和后处理逻辑
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { ModelDefinition } from '@/core/types'
import { RequestBuilder } from '@/core/request/RequestBuilder'
import { saveImageFromUrl, saveVideoFromUrl, saveAudioFromUrl } from '@/utils/save'
import {
  GenerateResult,
  ProviderConfig,
  PollingConfig,
  ProgressStatus,
  SaveMediaOptions,
} from './types'
import {
  ProviderError,
  ProviderErrorCode,
  createApiKeyMissingError,
  createPollingTimeoutError,
  createInvalidResponseError,
} from './errors'
import {
  readLocalFile,
  blobToBase64,
  dataURItoBlob,
  getFalApiKey,
  sleep,
  isLocalPath,
  isDataURI,
} from './utils'

/**
 * ProviderHandler 抽象基类
 *
 * 提供统一的生成流程和通用工具方法
 */
export abstract class ProviderHandler {
  /** Provider 名称 */
  protected readonly providerName: string

  /** API 基础 URL */
  protected readonly baseURL: string

  /** API 密钥 */
  protected readonly apiKey: string

  /** Axios 实例 */
  protected readonly client: AxiosInstance

  /** 请求构建器 */
  protected readonly requestBuilder: RequestBuilder

  /** 是否启用调试日志 */
  protected readonly debug: boolean

  /**
   * 构造函数
   *
   * @param providerName - Provider 名称
   * @param baseURL - API 基础 URL
   * @param apiKey - API 密钥
   * @param config - 额外配置
   */
  constructor(
    providerName: string,
    baseURL: string,
    apiKey: string,
    config?: Partial<ProviderConfig>
  ) {
    this.providerName = providerName
    this.baseURL = baseURL
    this.apiKey = apiKey
    this.debug = config?.options?.debug || false

    // 验证 API 密钥
    if (!apiKey) {
      throw createApiKeyMissingError(providerName)
    }

    // 创建 Axios 实例
    this.client = axios.create({
      baseURL,
      timeout: config?.timeout || 120000, // 默认 120 秒
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    })

    // 创建请求构建器
    this.requestBuilder = new RequestBuilder()

    this.log('Provider initialized', { providerName, baseURL })
  }

  /**
   * 主流程：生成媒体内容（模板方法）
   *
   * 这是所有 Provider 的统一入口，定义了标准流程：
   * 1. 构建请求参数
   * 2. 预处理（子类实现）
   * 3. 执行 API 调用
   * 4. 后处理（子类实现）
   * 5. 保存媒体文件
   *
   * @param model - 模型定义
   * @param params - 用户参数
   * @returns Promise<生成结果>
   */
  async generate(
    model: ModelDefinition,
    params: Record<string, any>
  ): Promise<GenerateResult> {
    this.log('Starting generation', { modelId: model.meta.id, params })

    try {
      // 步骤1: 使用 RequestBuilder 构建请求（支持异步 builder）
      const request = await this.requestBuilder.build(model.meta.id, params, {
        debug: this.debug,
      })

      // 步骤2: 供应商特定的预处理（文件上传、格式转换等）
      const preprocessedParams = await this.preprocessRequest(model, {
        ...params,
        ...request.body,
      })

      // 步骤3: 执行 API 调用
      // 🚀 输出最终发送的请求数据（始终显示，不受 debug 影响）
      console.log(`🚀 [${this.providerName}] Final API Request:`, {
        endpoint: request.url,
        body: this.summarizeRequestBody(preprocessedParams)
      })

      const response = await this.execute(request.url, preprocessedParams)

      this.log('API response received', { response })

      // 步骤4: 供应商特定的后处理（轮询、数据提取等）
      const finalResponse = await this.postprocessResponse(response, model)

      this.log('Response postprocessed', { finalResponse })

      // 步骤5: 保存媒体文件到本地
      const result = await this.saveMedia(finalResponse, model.meta.type as any)

      this.log('Generation completed', { result })

      return result
    } catch (error) {
      this.log('Generation failed', { error })
      throw ProviderError.fromError(error, this.providerName)
    }
  }

  /**
   * 预处理请求参数（抽象方法，子类必须实现）
   *
   * 在此阶段处理：
   * - 文件上传（本地文件 -> 远程 URL）
   * - 参数格式转换
   * - 默认值填充
   *
   * @param model - 模型定义
   * @param params - 原始参数
   * @returns Promise<处理后的参数>
   */
  protected abstract preprocessRequest(
    model: ModelDefinition,
    params: Record<string, any>
  ): Promise<Record<string, any>>

  /**
   * 后处理 API 响应（抽象方法，子类必须实现）
   *
   * 在此阶段处理：
   * - 异步任务轮询
   * - 响应数据提取
   * - 错误处理
   *
   * @param response - API 原始响应
   * @param model - 模型定义
   * @returns Promise<最终响应数据>
   */
  protected abstract postprocessResponse(
    response: any,
    model: ModelDefinition
  ): Promise<any>

  /**
   * 执行 POST 请求
   *
   * @param endpoint - API 端点（相对路径或绝对 URL）
   * @param data - 请求体数据
   * @param config - Axios 配置（可选）
   * @returns Promise<响应数据>
   */
  protected async execute(
    endpoint: string,
    data: any,
    config?: AxiosRequestConfig
  ): Promise<any> {
    try {
      const response = await this.client.post(endpoint, data, config)
      return response.data
    } catch (error: any) {
      throw new ProviderError(
        `API request failed: ${error.message}`,
        this.providerName,
        ProviderErrorCode.API_REQUEST_FAILED,
        {
          endpoint,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
        }
      )
    }
  }

  /**
   * 执行 GET 请求
   *
   * @param endpoint - API 端点
   * @param config - Axios 配置（可选）
   * @returns Promise<响应数据>
   */
  protected async get(
    endpoint: string,
    config?: AxiosRequestConfig
  ): Promise<any> {
    try {
      const response = await this.client.get(endpoint, config)
      return response.data
    } catch (error: any) {
      throw new ProviderError(
        `API request failed: ${error.message}`,
        this.providerName,
        ProviderErrorCode.API_REQUEST_FAILED,
        {
          endpoint,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
        }
      )
    }
  }

  /**
   * 轮询任务状态（通用实现）
   *
   * @param taskId - 任务 ID
   * @param config - 轮询配置
   * @param checkStatus - 状态检查函数
   * @returns Promise<最终结果>
   */
  protected async pollTaskStatus<T>(
    taskId: string,
    config: PollingConfig,
    checkStatus: (taskId: string) => Promise<ProgressStatus>
  ): Promise<T> {
    const { interval, maxAttempts, expectedAttempts } = config
    let attempts = 0

    this.log('Starting polling', { taskId, config })

    while (attempts < maxAttempts) {
      attempts++

      try {
        const status = await checkStatus(taskId)

        this.log('Polling status', {
          taskId,
          attempt: attempts,
          status: status.status,
          progress: status.progress,
        })

        // 任务完成
        if (status.status === 'COMPLETED') {
          this.log('Task completed', { taskId, attempts })
          return status.result as T
        }

        // 任务失败
        if (status.status === 'FAILED') {
          throw new ProviderError(
            status.error || 'Task failed',
            this.providerName,
            ProviderErrorCode.TASK_FAILED,
            { taskId, status }
          )
        }

        // 等待下一次轮询
        await sleep(interval)
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error
        }
        // 非致命错误，继续轮询
        this.log('Polling error, retrying', { error })
      }
    }

    // 超时
    throw createPollingTimeoutError(this.providerName, attempts, maxAttempts)
  }

  /**
   * 保存媒体文件到本地
   *
   * @param response - API 响应数据
   * @param type - 媒体类型
   * @returns Promise<生成结果>
   */
  protected async saveMedia(
    response: any,
    type: 'image' | 'video' | 'audio'
  ): Promise<GenerateResult> {
    try {
      // 从响应中提取 URL
      const url = this.extractMediaUrl(response)

      if (!url) {
        throw createInvalidResponseError(
          this.providerName,
          response,
          'No media URL found in response'
        )
      }

      // 根据类型选择对应的保存函数
      let filePath: string

      if (type === 'image') {
        const { fullPath } = await saveImageFromUrl(url)
        filePath = fullPath
      } else if (type === 'video') {
        const { fullPath } = await saveVideoFromUrl(url)
        filePath = fullPath
      } else if (type === 'audio') {
        const { fullPath } = await saveAudioFromUrl(url)
        filePath = fullPath
      } else {
        throw new Error(`Unsupported media type: ${type}`)
      }

      this.log('媒体文件已保存到本地', { url, filePath })

      return {
        url,
        filePath,
        status: 'completed',
        metadata: response,
      }
    } catch (error) {
      throw ProviderError.fromError(error, this.providerName)
    }
  }

  /**
   * 从响应中提取媒体 URL（子类可覆盖）
   *
   * @param response - API 响应
   * @returns 媒体 URL
   */
  protected extractMediaUrl(response: any): string {
    // 通用逻辑：检查常见字段
    return (
      response?.url ||
      response?.video_url ||
      response?.image_url ||
      response?.audio_url ||
      response?.output ||
      response?.data?.url ||
      response?.result?.url ||
      ''
    )
  }

  /**
   * 读取本地文件为 Blob
   *
   * @param path - 文件路径
   * @returns Promise<Blob>
   */
  protected async readLocalFile(path: string): Promise<Blob> {
    return readLocalFile(path)
  }

  /**
   * Blob 转 Base64
   *
   * @param blob - Blob 对象
   * @returns Promise<Base64 字符串>
   */
  protected async blobToBase64(blob: Blob): Promise<string> {
    return blobToBase64(blob)
  }

  /**
   * Data URI 转 Blob
   *
   * @param dataURI - Data URI 字符串
   * @returns Blob 对象
   */
  protected dataURItoBlob(dataURI: string): Blob {
    return dataURItoBlob(dataURI)
  }

  /**
   * 获取 Fal API 密钥
   *
   * @returns Fal API 密钥
   */
  protected getFalApiKey(): string {
    return getFalApiKey()
  }

  /**
   * 记录日志
   *
   * @param message - 日志消息
   * @param data - 附加数据
   */
  protected log(message: string, data?: any): void {
    if (this.debug) {
      console.log(`[${this.providerName}]`, message, data || '')
    }
  }

  /**
   * 摘要化请求体（用于日志输出）
   * 将 base64 图片数据替换为摘要信息，避免日志过长
   *
   * @param body - 请求体
   * @returns 摘要化后的请求体
   */
  protected summarizeRequestBody(body: Record<string, any>): Record<string, any> {
    const summarized: Record<string, any> = {}

    // 定义不需要在 API 请求日志中显示的内部字段
    const internalFields = [
      'editStateFile',
      'uploadedFilePaths',
      'uploadedVideoFilePaths',
      'sourceFile',
      'maskFile',
    ]

    for (const [key, value] of Object.entries(body)) {
      // 1. 过滤 undefined 值（这些通常不会被 JSON.stringify 发送）
      if (value === undefined) {
        continue
      }

      // 2. 过滤已知的内部字段
      if (internalFields.includes(key)) {
        continue
      }

      if (Array.isArray(value)) {
        // 处理数组（可能是图片数组）
        summarized[key] = value.map((item) => {
          if (typeof item === 'string' && item.startsWith('data:')) {
            // base64 数据，显示摘要
            const mimeMatch = item.match(/^data:([^;]+);/)
            const mimeType = mimeMatch ? mimeMatch[1] : 'unknown'
            const base64Part = item.split(',')[1] || ''
            const sizeKB = Math.round((base64Part.length * 3) / 4 / 1024)
            return `[BASE64 ${mimeType} ~${sizeKB}KB]`
          }
          return item
        })
      } else if (typeof value === 'string' && value.startsWith('data:')) {
        // 单个 base64 数据
        const mimeMatch = value.match(/^data:([^;]+);/)
        const mimeType = mimeMatch ? mimeMatch[1] : 'unknown'
        const base64Part = value.split(',')[1] || ''
        const sizeKB = Math.round((base64Part.length * 3) / 4 / 1024)
        summarized[key] = `[BASE64 ${mimeType} ~${sizeKB}KB]`
      } else {
        summarized[key] = value
      }
    }

    return summarized
  }

  /**
   * 格式化错误
   *
   * @param error - 原始错误
   * @returns ProviderError
   */
  protected formatError(error: any): ProviderError {
    return ProviderError.fromError(error, this.providerName)
  }
}
