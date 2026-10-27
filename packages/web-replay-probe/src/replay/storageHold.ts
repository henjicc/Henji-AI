/**
 * IndexedDB answers on the real clock. While a request or transaction is open, page time holds still
 * (like browser virtual time pausing for pending fetches), so what the page reads back lands at the
 * same page time however fast or slow the replay runs.
 */
export function holdIndexedDb(hold: (work: Promise<unknown>) => unknown): void {
  if (typeof indexedDB === 'undefined') return
  const settled = (target: EventTarget, events: string[]): Promise<void> => new Promise(resolve => {
    const done = (): void => { for (const type of events) target.removeEventListener(type, done); resolve() }
    for (const type of events) target.addEventListener(type, done)
  })
  const track = (request: unknown): void => {
    if (request instanceof IDBRequest) hold(settled(request, ['success', 'error']))
  }
  const wrap = (proto: object, names: string[]): void => {
    const methods = proto as Record<string, unknown>
    for (const name of names) {
      const original = methods[name]
      if (typeof original !== 'function') continue
      methods[name] = function (this: unknown, ...args: unknown[]) {
        const result = (original as (...a: unknown[]) => unknown).apply(this, args)
        track(result)
        return result
      }
    }
  }
  wrap(IDBFactory.prototype, ['open', 'deleteDatabase'])
  wrap(IDBObjectStore.prototype, ['add', 'put', 'get', 'getKey', 'getAll', 'getAllKeys', 'count', 'delete', 'clear', 'openCursor', 'openKeyCursor'])
  wrap(IDBIndex.prototype, ['get', 'getKey', 'getAll', 'getAllKeys', 'count', 'openCursor', 'openKeyCursor'])
  // A cursor answers on its original request again.
  for (const name of ['continue', 'advance', 'continuePrimaryKey'] as const) {
    const original = IDBCursor.prototype[name] as (...args: unknown[]) => void
    if (typeof original !== 'function') continue
    ;(IDBCursor.prototype as unknown as Record<string, unknown>)[name] = function (this: IDBCursor, ...args: unknown[]) {
      original.apply(this, args)
      track(this.request)
    }
  }
  const transaction = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
    const tx = transaction.apply(this, args)
    hold(settled(tx, ['complete', 'abort', 'error']))
    return tx
  }
}
