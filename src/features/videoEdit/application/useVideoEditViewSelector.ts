import { useRef, useSyncExternalStore } from 'react'
import { subscribeVideoEditView } from './videoEditService'

/**
 * 按所选值订阅剪辑视图。视图通知随播放头每帧发出，整份订阅会让只关心入出点、工具这类字段的组件跟着逐帧重绘；
 * 这里每次通知只重算所选值，与上一次相等时交回同一份快照，React 不重绘。
 *
 * 内容、选择与工具的发布（publishVideoEdit）同样会发视图通知；依赖文档内容的组件把 videoEditRevision() 放进所选值，
 * 就能在这些发布时更新，而不跟着播放头逐帧更新。
 * select 在每次通知时都会调用，不能抛错，也不要做重计算。
 */
export function useVideoEditViewSelector<T>(select: () => T, equal: (previous: T, next: T) => boolean = Object.is): T {
  const cache = useRef<{ value: T }>()
  const snapshot = (): T => {
    const next = select(); const cached = cache.current
    if (cached && equal(cached.value, next)) return cached.value
    cache.current = { value: next }
    return next
  }
  return useSyncExternalStore(subscribeVideoEditView, snapshot)
}

/** 所选值是一组字段时用的比较：逐项 Object.is。 */
export function sameVideoEditViewFields(previous: readonly unknown[], next: readonly unknown[]): boolean {
  return previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]))
}
