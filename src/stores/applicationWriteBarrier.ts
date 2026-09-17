import type { StateCreator, StoreMutatorIdentifier } from 'zustand'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'

/** 同时覆盖领域 action、直接 setState 与撤销中间件；界面状态仍可更新。 */
export function withApplicationWriteBarrier<T, M extends [StoreMutatorIdentifier, unknown][] = []>(
  creator: StateCreator<T, [], M>, keys: readonly (keyof T)[],
): StateCreator<T, [], M> {
  return (set, get, api) => {
    const checkedSet: typeof set = (update, replace) => {
      const previous = get()
      const next = typeof update === 'function' ? (update as (state: T) => T | Partial<T>)(previous) : update
      if (keys.some((key) => (replace || Object.prototype.hasOwnProperty.call(next, key)) && next[key] !== previous[key])) {
        assertApplicationWritesAllowed()
      }
      if (replace) set(next as T, true)
      else set(next)
    }
    api.setState = checkedSet
    return creator(checkedSet, get, api)
  }
}
