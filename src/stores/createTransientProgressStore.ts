import { create, type StoreApi, type UseBoundStore } from 'zustand'

export interface TransientProgressActions<T> {
  set: (id: string, value: T | null) => void
  clear: (ids: Iterable<string>) => void
  clearAll: () => void
}

interface TransientProgressOptions<T, State> {
  initialState: (actions: TransientProgressActions<T>) => State
  getEntry: (state: State, id: string) => T | undefined
  entries: (state: State) => Iterable<readonly [string, T]>
  patch: (entries: ReadonlyMap<string, T>) => Partial<State>
  equals?: (current: T, next: T) => boolean
  normalize?: (value: T) => T
}

/** 生命周期和相等短路唯一实现；适配器只负责现有 Record/Map 字段与动作名的投影。 */
export function createTransientProgressStore<T, State extends object>(options: TransientProgressOptions<T, State>): { store: UseBoundStore<StoreApi<State>>; useEntry: (id: string | null) => T | undefined } {
  const equals = options.equals ?? Object.is
  const store = create<State>((set, get) => {
    const clear = (ids: Iterable<string>): void => {
      const state = get()
      const entries = new Map(options.entries(state))
      let changed = false
      for (const id of ids) changed = entries.delete(id) || changed
      if (changed) set(options.patch(entries))
    }
    return options.initialState({
      set: (id, value) => {
        if (value === null) { clear([id]); return }
        const next = options.normalize ? options.normalize(value) : value
        const state = get()
        const current = options.getEntry(state, id)
        if (current !== undefined && equals(current, next)) return
        const entries = new Map(options.entries(state))
        entries.set(id, next)
        set(options.patch(entries))
      },
      clear,
      clearAll: () => {
        if (!new Map(options.entries(get())).size) return
        set(options.patch(new Map()))
      },
    })
  })
  function useEntry(id: string | null): T | undefined {
    return store(state => id === null ? undefined : options.getEntry(state, id))
  }
  return { store, useEntry }
}
