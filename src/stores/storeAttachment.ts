import { useStore, type StoreApi, type UseBoundStore } from 'zustand'

/** UI attachment delegates to an owned domain store; captured actions keep their original owner. */
export function createStoreAttachment<T>(initial: StoreApi<T>) {
  let target = initial
  const listeners = new Set<(state: T, previous: T) => void>()
  const publish = (state: T, previous: T) => { for (const listener of listeners) listener(state, previous) }
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
  const useAttachedStore: UseBoundStore<StoreApi<T>> = Object.assign(
    <U = T>(selector: (state: T) => U = state => state as unknown as U) => useStore(api, selector), api,
  )
  return {
    useAttachedStore,
    getStore: () => target,
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
