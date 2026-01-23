/**
 * ParamCleaner - 参数清理工具
 *
 * 用于清理导出参数中的冗余数据
 */

import type { ParamDef } from '../types'
import type { CleanOptions } from './types'

/**
 * 参数清理器类
 */
export class ParamCleaner {
  /**
   * 清理参数
   *
   * @param params - 原始参数
   * @param options - 清理选项
   * @param schema - 参数 Schema（用于移除默认值）
   * @returns 清理后的参数
   */
  clean(
    params: Record<string, any>,
    options: CleanOptions = {},
    schema?: ParamDef[]
  ): Record<string, any> {
    let result = { ...params }

    // 1. 移除默认值
    if (options.removeDefaults && schema) {
      result = this.removeDefaults(result, schema)
    }

    // 2. 移除空值
    if (options.removeEmpty) {
      result = this.removeEmpty(result)
    }

    // 3. 移除敏感信息
    if (options.removeSensitive) {
      result = this.removeSensitive(result)
    }

    // 4. 移除 Base64 数据
    if (options.removeBase64) {
      result = this.removeBase64(result)
    }

    return result
  }

  /**
   * 移除默认值
   *
   * @param params - 参数对象
   * @param schema - 参数 Schema
   * @returns 移除默认值后的参数
   */
  removeDefaults(params: Record<string, any>, schema: ParamDef[]): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      const paramDef = schema.find((p) => p.id === key)

      if (!paramDef) {
        // 没有定义的参数，保留
        result[key] = value
        continue
      }

      // 获取默认值
      const defaultValue = this.getDefaultValue(paramDef)

      // 如果值不等于默认值，保留
      if (!this.isEqual(value, defaultValue)) {
        result[key] = value
      }
    }

    return result
  }

  /**
   * 移除空值
   *
   * @param params - 参数对象
   * @returns 移除空值后的参数
   */
  removeEmpty(params: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      // 跳过 null, undefined, 空字符串, 空数组
      if (
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      ) {
        continue
      }

      result[key] = value
    }

    return result
  }

  /**
   * 移除敏感信息
   *
   * @param params - 参数对象
   * @returns 移除敏感信息后的参数
   */
  removeSensitive(params: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}
    const sensitiveKeys = ['apiKey', 'api_key', 'token', 'password', 'secret']

    for (const [key, value] of Object.entries(params)) {
      // 检查键名是否包含敏感词
      const isSensitive = sensitiveKeys.some((sensitiveKey) =>
        key.toLowerCase().includes(sensitiveKey.toLowerCase())
      )

      if (isSensitive) {
        result[key] = '***REDACTED***'
      } else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * 移除 Base64 数据
   *
   * @param params - 参数对象
   * @returns 移除 Base64 数据后的参数
   */
  removeBase64(params: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && this.isBase64(value)) {
        result[key] = '[Base64 Data Removed]'
      } else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * 获取参数默认值
   *
   * @param paramDef - 参数定义
   * @returns 默认值
   */
  private getDefaultValue(paramDef: ParamDef): any {
    if ('defaultValue' in paramDef) {
      return paramDef.defaultValue
    }
    return undefined
  }

  /**
   * 判断两个值是否相等
   *
   * @param a - 值 A
   * @param b - 值 B
   * @returns 是否相等
   */
  private isEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== typeof b) return false

    // 数组比较
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((item, index) => this.isEqual(item, b[index]))
    }

    // 对象比较
    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a)
      const keysB = Object.keys(b)
      if (keysA.length !== keysB.length) return false
      return keysA.every((key) => this.isEqual(a[key], b[key]))
    }

    return false
  }

  /**
   * 判断字符串是否为 Base64
   *
   * @param str - 字符串
   * @returns 是否为 Base64
   */
  private isBase64(str: string): boolean {
    // 检查是否为 data URL
    if (str.startsWith('data:')) {
      return true
    }

    // 检查是否为纯 Base64（长度大于 100 且符合 Base64 格式）
    if (str.length > 100) {
      const base64Regex = /^[A-Za-z0-9+/=]+$/
      return base64Regex.test(str)
    }

    return false
  }
}
