/**
 * 参数工具函数
 *
 * 提供嵌套参数值的获取和设置功能
 */

/**
 * 设置嵌套参数值
 *
 * 使用不可变更新方式设置嵌套对象的值
 *
 * @param obj - 原始对象
 * @param path - 嵌套路径（如 'resolution.quality'）
 * @param value - 新值
 * @returns 更新后的新对象
 *
 * @example
 * ```typescript
 * const obj = { resolution: { quality: '1080P' } }
 * const newObj = setNestedValue(obj, 'resolution.quality', '4K')
 * // newObj = { resolution: { quality: '4K' } }
 * // obj 保持不变
 * ```
 */
export function setNestedValue(
  obj: Record<string, any>,
  path: string,
  value: any
): Record<string, any> {
  // 如果路径不包含 '.'，直接设置
  if (!path.includes('.')) {
    return {
      ...obj,
      [path]: value
    }
  }

  const keys = path.split('.')
  const result = { ...obj }
  let current: any = result

  // 遍历路径，创建新对象
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = { ...(current[key] || {}) }
    current = current[key]
  }

  // 设置最终值
  current[keys[keys.length - 1]] = value

  return result
}

/**
 * 获取嵌套参数值
 *
 * @param obj - 对象
 * @param path - 嵌套路径（如 'resolution.quality'）
 * @returns 值，如果路径不存在则返回 undefined
 *
 * @example
 * ```typescript
 * const obj = { resolution: { quality: '1080P' } }
 * const value = getNestedValue(obj, 'resolution.quality')
 * // value = '1080P'
 *
 * const missing = getNestedValue(obj, 'missing.path')
 * // missing = undefined
 * ```
 */
export function getNestedValue(
  obj: Record<string, any>,
  path: string
): any {
  // 如果路径不包含 '.'，直接获取
  if (!path.includes('.')) {
    return obj[path]
  }

  const keys = path.split('.')
  let current = obj

  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = current[key]
  }

  return current
}

/**
 * 批量设置嵌套参数值
 *
 * @param obj - 原始对象
 * @param updates - 更新映射（键可以是嵌套路径）
 * @returns 更新后的新对象
 *
 * @example
 * ```typescript
 * const obj = { a: 1, b: { c: 2 } }
 * const newObj = batchSetNestedValues(obj, {
 *   'a': 10,
 *   'b.c': 20,
 *   'd': 30
 * })
 * // newObj = { a: 10, b: { c: 20 }, d: 30 }
 * ```
 */
export function batchSetNestedValues(
  obj: Record<string, any>,
  updates: Record<string, any>
): Record<string, any> {
  let result = obj

  for (const [path, value] of Object.entries(updates)) {
    result = setNestedValue(result, path, value)
  }

  return result
}

/**
 * 检查路径是否存在
 *
 * @param obj - 对象
 * @param path - 嵌套路径
 * @returns 路径是否存在
 */
export function hasNestedPath(
  obj: Record<string, any>,
  path: string
): boolean {
  return getNestedValue(obj, path) !== undefined
}
