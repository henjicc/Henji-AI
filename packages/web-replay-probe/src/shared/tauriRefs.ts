/**
 * Finds the callback ids a Tauri invoke passes to the host: event `handler` numbers and channels
 * (`Channel` objects serialize to `__CHANNEL__:<id>`). The order is stable for the same arguments.
 */
const CHANNEL = /^__CHANNEL__:(\d+)$/

export function callbackRefs(args: unknown, registered: ReadonlySet<number>): number[] {
  const out: number[] = []
  const visit = (value: unknown, key: string | undefined, depth: number): void => {
    if (depth > 6 || value === null || value === undefined) return
    if (typeof value === 'number') { if ((key === 'handler' || key === 'callback' || key === 'onEvent') && registered.has(value)) out.push(value); return }
    if (typeof value === 'string') { const m = CHANNEL.exec(value); if (m && registered.has(Number(m[1]))) out.push(Number(m[1])); return }
    if (typeof value !== 'object') return
    const toJSON = (value as { toJSON?: () => unknown }).toJSON
    if (typeof toJSON === 'function' && !(value instanceof Date)) { visit(toJSON.call(value), key, depth + 1); return }
    if (Array.isArray(value)) { value.forEach(v => visit(v, undefined, depth + 1)); return }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return
    for (const [k, v] of Object.entries(value)) visit(v, k, depth + 1)
  }
  visit(args, undefined, 0)
  return out
}

export interface TauriInternals {
  invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>
  transformCallback: (callback?: (payload: unknown) => void, once?: boolean) => number
  [key: string]: unknown
}
