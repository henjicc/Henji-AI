/**
 * Provider 错误处理
 *
 * 定义统一的错误类型和错误码
 */

/**
 * Provider 错误码枚举
 */
export enum ProviderErrorCode {
  /** API密钥缺失 */
  API_KEY_MISSING = 'API_KEY_MISSING',
  /** API请求失败 */
  API_REQUEST_FAILED = 'API_REQUEST_FAILED',
  /** 文件上传失败 */
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  /** 轮询超时 */
  POLLING_TIMEOUT = 'POLLING_TIMEOUT',
  /** 无效的响应格式 */
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  /** 本地文件读取失败 */
  FILE_READ_FAILED = 'FILE_READ_FAILED',
  /** 参数验证失败 */
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  /** 任务失败 */
  TASK_FAILED = 'TASK_FAILED',
  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 未知错误 */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Provider 错误类
 *
 * 统一的错误处理类，包含错误码、Provider名称和详细信息
 */
export class ProviderError extends Error {
  /** 错误名称 */
  public readonly name = 'ProviderError'

  /** Provider名称 */
  public readonly provider: string

  /** 错误码 */
  public readonly code: ProviderErrorCode

  /** 错误详情 */
  public readonly details?: DynamicValue

  /** 时间戳 */
  public readonly timestamp: Date

  /**
   * 创建Provider错误
   *
   * @param message - 错误消息
   * @param provider - Provider名称
   * @param code - 错误码
   * @param details - 详细信息（可选）
   */
  constructor(
    message: string,
    provider: string,
    code: ProviderErrorCode,
    details?: DynamicValue
  ) {
    super(message)
    this.provider = provider
    this.code = code
    this.details = details
    this.timestamp = new Date()

    // 保持正确的原型链
    Object.setPrototypeOf(this, ProviderError.prototype)
  }

  /**
   * 转换为JSON格式
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      provider: this.provider,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    }
  }

  /**
   * 转换为用户友好的消息
   */
  toUserMessage(): string {
    const baseMessage = `[${this.provider}] ${this.message}`

    switch (this.code) {
      case ProviderErrorCode.API_KEY_MISSING:
        return `${baseMessage}\n请在设置中配置 ${this.provider} 的 API 密钥`
      case ProviderErrorCode.POLLING_TIMEOUT:
        return `${baseMessage}\n任务执行时间过长，请稍后查看历史记录`
      case ProviderErrorCode.UPLOAD_FAILED:
        return `${baseMessage}\n文件上传失败，请检查文件格式和大小`
      case ProviderErrorCode.NETWORK_ERROR:
        return `${baseMessage}\n网络连接失败，请检查网络设置`
      default:
        return baseMessage
    }
  }

  /**
   * 从通用错误创建ProviderError
   *
   * @param error - 原始错误
   * @param provider - Provider名称
   * @param defaultCode - 默认错误码
   */
  static fromError(
    error: DynamicValue,
    provider: string,
    defaultCode: ProviderErrorCode = ProviderErrorCode.UNKNOWN_ERROR
  ): ProviderError {
    if (error instanceof ProviderError) {
      return error
    }

    const message = error?.message || String(error)
    const details = {
      originalError: error,
      stack: error?.stack,
    }

    // 根据错误类型推断错误码
    let code = defaultCode
    if (message.includes('timeout')) {
      code = ProviderErrorCode.POLLING_TIMEOUT
    } else if (message.includes('network') || message.includes('fetch')) {
      code = ProviderErrorCode.NETWORK_ERROR
    } else if (message.includes('upload')) {
      code = ProviderErrorCode.UPLOAD_FAILED
    }

    return new ProviderError(message, provider, code, details)
  }
}

/**
 * 创建API密钥缺失错误
 */
export function createApiKeyMissingError(provider: string): ProviderError {
  return new ProviderError(
    `API密钥未配置`,
    provider,
    ProviderErrorCode.API_KEY_MISSING
  )
}

/**
 * 创建轮询超时错误
 */
export function createPollingTimeoutError(
  provider: string,
  attempts: number,
  maxAttempts: number
): ProviderError {
  return new ProviderError(
    `轮询超时：已尝试 ${attempts}/${maxAttempts} 次`,
    provider,
    ProviderErrorCode.POLLING_TIMEOUT,
    { attempts, maxAttempts }
  )
}

/**
 * 创建无效响应错误
 */
export function createInvalidResponseError(
  provider: string,
  response: DynamicValue,
  reason?: string
): ProviderError {
  return new ProviderError(
    reason || '响应格式无效',
    provider,
    ProviderErrorCode.INVALID_RESPONSE,
    { response }
  )
}
