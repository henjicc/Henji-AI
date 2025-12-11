/**
 * 安全地输出错误信息，隐藏敏感数据（如 API key）
 *
 * 日志输出策略：
 * - 开发环境：始终输出日志
 * - 生产环境：仅在测试模式启用时输出日志
 */

/**
 * 判断是否应该输出日志
 * @returns true 表示应该输出日志，false 表示不输出
 */
function shouldLog(): boolean {
  // 开发环境始终输出日志
  if (import.meta.env.DEV) {
    return true
  }

  // 生产环境：检查测试模式是否启用
  try {
    const stored = localStorage.getItem('henji_test_mode')
    if (stored) {
      const state = JSON.parse(stored)
      return state.enabled === true
    }
    return false
  } catch {
    // 如果无法访问 localStorage（例如在某些受限环境中），默认不输出
    return false
  }
}

/**
 * 隐藏 API key，只显示前4位和后4位
 */
function maskApiKey(key: string): string {
  if (!key || key.length <= 8) {
    return '***'
  }
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`
}

/**
 * 递归地清理对象中的敏感信息
 */
function sanitizeObject(obj: any, depth: number = 0): any {
  // 防止无限递归
  if (depth > 5) return '[深度限制]'

  if (obj === null || obj === undefined) return obj

  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1))
  }

  // 处理对象
  if (typeof obj === 'object') {
    const sanitized: any = {}

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase()

      // 检查是否是敏感字段
      if (lowerKey.includes('apikey') ||
          lowerKey.includes('api_key') ||
          lowerKey.includes('authorization') ||
          lowerKey.includes('token') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('password')) {

        // 如果是 Authorization header，提取并隐藏 token
        if (typeof value === 'string') {
          if (value.startsWith('Bearer ')) {
            const token = value.substring(7)
            sanitized[key] = `Bearer ${maskApiKey(token)}`
          } else {
            sanitized[key] = maskApiKey(value)
          }
        } else {
          sanitized[key] = '***'
        }
      } else {
        // 递归处理嵌套对象
        sanitized[key] = sanitizeObject(value, depth + 1)
      }
    }

    return sanitized
  }

  return obj
}

/**
 * 安全地格式化错误对象，隐藏敏感信息
 */
export function sanitizeError(error: any): any {
  if (!error) return error

  // 如果是字符串，直接返回
  if (typeof error === 'string') return error

  // 如果是 Error 对象
  if (error instanceof Error) {
    const sanitized: any = {
      name: error.name,
      message: error.message,
      stack: error.stack
    }

    // 处理 axios 错误
    if ('config' in error) {
      sanitized.config = sanitizeObject((error as any).config)
    }

    if ('response' in error) {
      const response = (error as any).response
      sanitized.response = {
        status: response?.status,
        statusText: response?.statusText,
        data: sanitizeObject(response?.data),
        headers: sanitizeObject(response?.headers)
      }
    }

    if ('request' in error) {
      // request 对象通常很大，只保留关键信息
      sanitized.request = '[Request Object]'
    }

    return sanitized
  }

  // 其他对象
  return sanitizeObject(error)
}

/**
 * 安全地输出错误到控制台
 * 开发环境始终输出，生产环境仅在测试模式启用时输出
 */
export function logError(prefix: string, error: any): void {
  if (!shouldLog()) return
  const sanitized = sanitizeError(error)
  console.error(prefix, sanitized)
}

/**
 * 安全地输出警告到控制台
 * 开发环境始终输出，生产环境仅在测试模式启用时输出
 */
export function logWarning(prefix: string, data: any): void {
  if (!shouldLog()) return
  const sanitized = sanitizeObject(data)
  console.warn(prefix, sanitized)
}

/**
 * 安全地输出日志到控制台
 * 开发环境始终输出，生产环境仅在测试模式启用时输出
 */
export function logInfo(prefix: string, data: any): void {
  if (!shouldLog()) return
  const sanitized = sanitizeObject(data)
  console.log(prefix, sanitized)
}
