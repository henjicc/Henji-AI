import type { CodeParameterValue } from './parameterTypes'

/** Immutable leaf update for font preview and nested parameter controls. A stale
 * row/path must fail instead of constructing a different record accidentally. */
export function replaceParameterPath(value: CodeParameterValue, path: readonly string[], next: CodeParameterValue): CodeParameterValue {
  const replace = (current: unknown, offset: number): unknown => {
    if (offset === path.length) return next
    const key = path[offset]
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) throw new Error('参数内容已改变，请重新选择。')
    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length || String(index) !== key) throw new Error('数据项已改变，请重新选择。')
      const result = [...current]; result[index] = replace(current[index], offset + 1); return result
    }
    return { ...current, [key]: replace((current as Record<string, unknown>)[key], offset + 1) }
  }
  return replace(value, 0) as CodeParameterValue
}
