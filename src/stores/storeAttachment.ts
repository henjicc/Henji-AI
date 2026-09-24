import { useStore, type StoreApi, type UseBoundStore } from 'zustand'

/** UI attachment delegates to an owned domain store; captured actions keep their original owner. */
export function createStoreAttachment<T>(initial: StoreApi<T>) {
  let target = initial
  const listeners = new Set<(state: T, previous: T) => void>()
  const viewListeners = new Set<(state: T, previous: T) => void>()
  let viewBatchDepth = 0
  let pendingView: { previous: T } | undefined
  const publishView = (state: T, previous: T) => {
    if (viewBatchDepth > 0) { pendingView ??= { previous }; return }
    for (const listener of viewListeners) listener(state, previous)
  }
  const publish = (state: T, previous: T) => {
    for (const listener of listeners) listener(state, previous)
    publishView(state, previous)
  }
  let unsubscribe = target.subscribe(publish)
  const api: StoreApi<T> = {
    getState: () => target.getState(),
    getInitialState: () => target.getInitialState(),
    setState: (state, replace) => {
      if (replace) target.setState(state as T | ((previous: T) => T), true)
      else target.setState(state, false)
    },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const viewApi: StoreApi<T> = {
    ...api,
    subscribe: listener => { viewListeners.add(listener); return () => { viewListeners.delete(listener) } },
  }
  const useAttachedStore: UseBoundStore<StoreApi<T>> = Object.assign(
    <U = T>(selector: (state: T) => U = state => state as unknown as U) => useStore(viewApi, selector), api,
  )
  return {
    useAttachedStore,
    getStore: () => target,
    /** 仅合并同步调用栈内的 React 通知；领域订阅、状态读取、历史与异步任务均不延迟。 */
    batchViewUpdates<R>(work: () => R): R {
      viewBatchDepth++
      try { return work() }
      finally {
        viewBatchDepth--
        if (viewBatchDepth === 0 && pendingView) {
          const { previous } = pendingView
          pendingView = undefined
          publishView(target.getState(), previous)
        }
      }
    },
    attach(store: StoreApi<T>) {
      if (target === store) return
      const previous = target.getState()
      unsubscribe()
      target = store
      unsubscribe = target.subscribe(publish)
      publish(target.getState(), previous)
    },
  }
}
