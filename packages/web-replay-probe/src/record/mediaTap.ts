import type { BoundaryKind } from '../protocol'
import { nowUs, type EventQueue } from './events'

const NETWORK_INITIATORS = new Set(['fetch', 'xmlhttprequest', 'beacon'])

function isHttp(url: string): boolean { return /^https?:/i.test(url) }
function sameOrigin(url: string): boolean { try { return new URL(url, location.href).origin === location.origin } catch { return false } }

/**
 * Same-origin static resources become the replay site; cross-origin ones (favicons, search
 * images, CSS images) are fetched by Henji from the recorded URL. Image elements also report
 * whether they loaded, because a failed favicon renders a different fallback.
 */
export function installMediaTap(queue: EventQueue, isActive: () => boolean): { sameOriginUrls: () => string[] } {
  const own = new Set<string>([location.href.split('#')[0]])
  const external = new Set<string>()
  try { performance.setResourceTimingBufferSize(100000) } catch { /* optional */ }
  const take = (entry: PerformanceResourceTiming): void => {
    if (!isActive() || NETWORK_INITIATORS.has(entry.initiatorType) || !isHttp(entry.name)) return
    if (sameOrigin(entry.name)) { own.add(entry.name.split('#')[0]); return }
    if (external.has(entry.name)) return
    external.add(entry.name)
    queue.emit({ kind: 'external', t: Math.round(entry.startTime * 1000), url: entry.name, initiator: entry.initiatorType })
  }
  for (const entry of performance.getEntriesByType('resource')) take(entry as PerformanceResourceTiming)
  new PerformanceObserver(list => { for (const entry of list.getEntries()) take(entry as PerformanceResourceTiming) }).observe({ type: 'resource', buffered: true })

  const imageResult = (outcome: 'load' | 'error') => (event: Event): void => {
    const img = event.target
    if (!isActive() || !(img instanceof HTMLImageElement)) return
    const url = img.currentSrc || img.src
    if (!isHttp(url) || sameOrigin(url)) return
    queue.emit({ kind: 'external', t: nowUs(), url, initiator: 'img', outcome, width: img.naturalWidth || undefined, height: img.naturalHeight || undefined })
  }
  document.addEventListener('load', imageResult('load'), true)
  document.addEventListener('error', imageResult('error'), true)
  return { sameOriginUrls: () => [...own] }
}

/** Calls that bypass the probe are reported live; replay refuses them. */
export function installBoundaryTap(queue: EventQueue, isActive: () => boolean): void {
  const report = (boundary: BoundaryKind, detail: string): void => { if (isActive()) queue.emit({ kind: 'boundary', t: nowUs(), boundary, detail }) }
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    report('xhr', `${method} ${String(url)}`)
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof open
  const wrapCtor = <T extends new (...args: never[]) => object>(name: 'WebSocket' | 'EventSource' | 'Worker' | 'SharedWorker', boundary: BoundaryKind): void => {
    const Original = (window as unknown as Record<string, T | undefined>)[name]
    if (!Original) return
    const Wrapped = new Proxy(Original, {
      construct(target, args: unknown[]) {
        const protocols = args[1]
        const viteHmr = name === 'WebSocket' && (protocols === 'vite-hmr' || (Array.isArray(protocols) && protocols.includes('vite-hmr')))
        if (!viteHmr) report(boundary, String(args[0]))
        return Reflect.construct(target, args)
      },
    })
    ;(window as unknown as Record<string, unknown>)[name] = Wrapped
  }
  wrapCtor('WebSocket', 'websocket')
  wrapCtor('EventSource', 'eventsource')
  wrapCtor('Worker', 'worker')
  wrapCtor('SharedWorker', 'worker')
}
