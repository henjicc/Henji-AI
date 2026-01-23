/**
 * GenerationService - 统一的媒体生成服务
 *
 * 职责：
 * - 自动路由到正确的 Provider
 * - 管理 API 密钥
 * - 缓存 Provider 实例
 * - 统一错误处理
 *
 * 使用单例模式，全局只有一个实例
 */

import { registry } from '@/core/ModelRegistry'
import {
  ProviderHandler,
  GenerateResult,
  ProgressStatus,
  ProviderError,
  ProviderErrorCode,
} from '@/core/providers/base'
import { PPIOProvider } from '@/core/providers/PPIOProvider'

/**
 * GenerationService 单例类
 */
export class GenerationService {
  /** Provider 实例缓存 */
  private providers: Map<string, ProviderHandler>

  /** 单例实例 */
  private static instance: GenerationService | null = null

  /**
   * 私有构造函数（单例模式）
   */
  private constructor() {
    this.providers = new Map()
    // this.log('GenerationService initialized')
  }

  /**
   * 获取单例实例
   *
   * @returns GenerationService 实例
   */
  static getInstance(): GenerationService {
    if (!GenerationService.instance) {
      GenerationService.instance = new GenerationService()
    }
    return GenerationService.instance
  }

  /**
   * 统一生成接口
   *
   * 自动路由到正确的 Provider 并执行生成
   *
   * @param modelId - 模型 ID
   * @param params - 生成参数
   * @param onProgress - 进度回调（可选）
   * @returns Promise<生成结果>
   */
  async generate(
    modelId: string,
    params: Record<string, any>,
    onProgress?: (status: ProgressStatus) => void
  ): Promise<GenerateResult> {
    this.log('Starting generation', { modelId, params })

    try {
      // 1. 从 ModelRegistry 获取模型定义
      const model = registry.getModel(modelId)
      if (!model) {
        throw new Error(`Model not found: ${modelId}`)
      }

      this.log('Model found', {
        modelId,
        provider: model.meta.provider,
        type: model.meta.type,
      })

      // 2. 获取对应的 Provider
      const provider = this.getProvider(model.meta.provider)

      this.log('Provider obtained', { provider: model.meta.provider })

      // 3. 调用 Provider 的 generate 方法
      const result = await provider.generate(model, params)

      this.log('Generation completed', { modelId, result })

      return result
    } catch (error) {
      this.handleError(error, modelId)
    }
  }

  /**
   * 生成图片（语义化方法）
   *
   * @param modelId - 模型 ID
   * @param params - 生成参数
   * @returns Promise<生成结果>
   */
  async generateImage(
    modelId: string,
    params: Record<string, any>
  ): Promise<GenerateResult> {
    return this.generate(modelId, params)
  }

  /**
   * 生成视频（语义化方法）
   *
   * @param modelId - 模型 ID
   * @param params - 生成参数
   * @returns Promise<生成结果>
   */
  async generateVideo(
    modelId: string,
    params: Record<string, any>
  ): Promise<GenerateResult> {
    return this.generate(modelId, params)
  }

  /**
   * 生成音频（语义化方法）
   *
   * @param modelId - 模型 ID
   * @param params - 生成参数
   * @returns Promise<生成结果>
   */
  async generateAudio(
    modelId: string,
    params: Record<string, any>
  ): Promise<GenerateResult> {
    return this.generate(modelId, params)
  }

  /**
   * 获取或创建 Provider 实例
   *
   * 使用懒加载 + 缓存策略
   *
   * @param providerName - Provider 名称
   * @returns ProviderHandler 实例
   */
  private getProvider(providerName: string): ProviderHandler {
    // 检查缓存
    if (this.providers.has(providerName)) {
      this.log('Provider found in cache', { provider: providerName })
      return this.providers.get(providerName)!
    }

    this.log('Creating new provider instance', { provider: providerName })

    // 创建新的 Provider
    const provider = this.initializeProvider(providerName)
    this.providers.set(providerName, provider)

    return provider
  }

  /**
   * 初始化 Provider 实例
   *
   * 根据 provider 名称创建对应的实例
   *
   * @param providerName - Provider 名称
   * @returns ProviderHandler 实例
   */
  private initializeProvider(providerName: string): ProviderHandler {
    // 获取 API Key
    const apiKey = this.getApiKey(providerName)
    if (!apiKey) {
      throw new ProviderError(
        `API密钥未配置，请在设置中添加 ${providerName} 的 API 密钥`,
        providerName,
        ProviderErrorCode.API_KEY_MISSING
      )
    }

    // 根据 provider 名称创建对应的实例
    switch (providerName) {
      case 'ppio':
        return new PPIOProvider(apiKey)

      case 'fal':
        // TODO: 任务05 中实现
        throw new Error(
          'FalProvider not implemented yet. Will be implemented in task 05.'
        )
      // return new FalProvider(apiKey)

      case 'kie':
        // TODO: 任务06 中实现
        throw new Error(
          'KIEProvider not implemented yet. Will be implemented in task 06.'
        )
      // return new KIEProvider(apiKey)

      case 'modelscope':
        // TODO: 任务06 中实现（如需要）
        throw new Error(
          'ModelscopeProvider not implemented yet. Will be implemented in task 06.'
        )
      // return new ModelscopeProvider(apiKey)

      default:
        throw new Error(`Unsupported provider: ${providerName}`)
    }
  }

  /**
   * 获取 API 密钥
   *
   * @param provider - Provider 名称
   * @returns API 密钥或 null
   */
  private getApiKey(provider: string): string | null {
    // 使用下划线格式的密钥名（与旧系统保持一致）：{provider}_api_key
    const key = `${provider}_api_key`
    return localStorage.getItem(key)
  }

  /**
   * 设置 API 密钥
   *
   * @param provider - Provider 名称
   * @param apiKey - API 密钥
   */
  setApiKey(provider: string, apiKey: string): void {
    // 使用下划线格式的密钥名（与旧系统保持一致）：{provider}_api_key
    const key = `${provider}_api_key`
    localStorage.setItem(key, apiKey)

    this.log('API key updated', { provider })

    // 清除缓存的 Provider 实例，下次使用时会重新创建
    if (this.providers.has(provider)) {
      this.providers.delete(provider)
      this.log('Provider cache cleared', { provider })
    }
  }

  /**
   * 验证 API 密钥是否已配置
   *
   * @param provider - Provider 名称
   * @returns 是否已配置
   */
  validateApiKey(provider: string): boolean {
    return !!this.getApiKey(provider)
  }

  /**
   * 获取所有已配置的 Provider
   *
   * @returns Provider 名称数组
   */
  getConfiguredProviders(): string[] {
    const providers = ['ppio', 'fal', 'kie', 'modelscope']
    return providers.filter((p) => this.validateApiKey(p))
  }

  /**
   * 清除 Provider 缓存
   *
   * @param provider - Provider 名称（可选，不指定则清除所有）
   */
  clearProviderCache(provider?: string): void {
    if (provider) {
      this.providers.delete(provider)
      this.log('Provider cache cleared', { provider })
    } else {
      this.providers.clear()
      this.log('All provider caches cleared')
    }
  }

  /**
   * 错误处理
   *
   * @param error - 错误对象
   * @param modelId - 模型 ID
   */
  private handleError(error: any, modelId: string): never {
    // 如果已经是 ProviderError，直接抛出
    if (error instanceof ProviderError) {
      console.error(
        `[GenerationService] Provider error for ${modelId}:`,
        error.toJSON()
      )
      throw error
    }

    // 包装为通用错误
    console.error(`[GenerationService] Error for ${modelId}:`, error)
    const message = error?.message || String(error)
    throw new Error(`Generation failed for ${modelId}: ${message}`)
  }

  /**
   * 日志输出
   *
   * @param message - 日志消息
   * @param data - 附加数据
   */
  private log(message: string, data?: any): void {
    // 开发环境下输出日志
    if (import.meta.env.DEV) {
      console.log(`[GenerationService]`, message, data || '')
    }
  }

  /**
   * 重置服务（主要用于测试）
   */
  static reset(): void {
    if (GenerationService.instance) {
      GenerationService.instance.providers.clear()
      GenerationService.instance = null
    }
  }
}

/**
 * 导出单例实例的便捷访问方式
 */
export const generationService = GenerationService.getInstance()
