import { restoreNativeErrorName } from '@/core/nativeErrors'

type AnyFunction = (...args: unknown[]) => unknown

function wrapCall(fn: AnyFunction, owner: object): AnyFunction {
  return (...args: unknown[]): unknown => {
    let result: unknown
    try {
      result = fn.apply(owner, args)
    } catch (error) {
      throw restoreNativeErrorName(error)
    }
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).catch((error: unknown) => { throw restoreNativeErrorName(error) })
    }
    return result
  }
}

function wrapDomain(domain: object): object {
  const wrapped: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(domain))) {
    if ('value' in descriptor && typeof descriptor.value === 'function') {
      Object.defineProperty(wrapped, key, { ...descriptor, value: wrapCall(descriptor.value as AnyFunction, domain) })
    } else {
      Object.defineProperty(wrapped, key, descriptor)
    }
  }
  return wrapped
}

/**
 * 每个平台能力调用失败时还原桌面桥丢掉的错误名（src/core/nativeErrors.ts）：渲染层按 name 判断的
 * DocumentNotFoundError、重名、版本冲突等分支才能在真实应用里生效（重要记录 020）。
 */
export function withNativeErrorNames<T extends object>(platform: T): T {
  const wrapped: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(platform))) {
    const value = 'value' in descriptor ? descriptor.value : undefined
    if (value && typeof value === 'object') Object.defineProperty(wrapped, key, { ...descriptor, value: wrapDomain(value as object) })
    else if (typeof value === 'function') Object.defineProperty(wrapped, key, { ...descriptor, value: wrapCall(value as AnyFunction, platform) })
    else Object.defineProperty(wrapped, key, descriptor)
  }
  return wrapped as T
}
