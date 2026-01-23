/**
 * 错误处理工具
 * 职责：处理 Fal API 错误
 */

export class FalApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any
  ) {
    super(message)
    this.name = 'FalApiError'
  }
}

/**
 * 处理 API 错误
 */
export function handleApiError(error: any): FalApiError {
  if (error instanceof FalApiError) {
    return error
  }

  if (error.response) {
    const statusCode = error.response.status
    const message = error.response.data?.message || error.message || 'API request failed'
    return new FalApiError(message, statusCode, error.response.data)
  }

  if (error.request) {
    return new FalApiError('Network error: No response received', undefined, error.request)
  }

  return new FalApiError(error.message || 'Unknown error occurred')
}

/**
 * 判断是否为速率限制错误
 */
export function isRateLimitError(error: FalApiError): boolean {
  return error.statusCode === 429
}

/**
 * 判断是否为认证错误
 */
export function isAuthError(error: FalApiError): boolean {
  return error.statusCode === 401 || error.statusCode === 403
}

/**
 * 获取用户友好的错误消息
 */
export function getUserFriendlyErrorMessage(error: FalApiError): string {
  if (isRateLimitError(error)) {
    return '请求过于频繁，请稍后再试'
  }

  if (isAuthError(error)) {
    return 'API 密钥无效或已过期，请检查设置'
  }

  if (error.statusCode === 400) {
    return '请求参数错误，请检查输入'
  }

  if (error.statusCode === 500) {
    return '服务器错误，请稍后再试'
  }

  return error.message || '未知错误'
}
