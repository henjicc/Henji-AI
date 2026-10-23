import { PROBE_PROTOCOL_VERSION, PROBE_VERSION, type AppInfo, type HenjiMessage, type HostKind, type ProbeEnvironment } from '../protocol'
import { bytesToWire } from '../shared/body'
import { encodeValue } from '../shared/codec'
import type { LocatorOptions } from '../shared/locator'
import { SESSION_KEY, snapshotStorage } from '../shared/storage'
import { HenjiConnection } from './connection'
import { EventQueue, nowUs } from './events'
import { createTauriIpcTap, installClipboardTap, installRandomTap } from './hostTap'
import { installInputTap } from './inputTap'
import { installBoundaryTap, installMediaTap } from './mediaTap'
import { installWindowFetchTap, recordFetch, type FetchLike } from './networkTap'

export function hostKind(): HostKind {
  if ('__TAURI_INTERNALS__' in window) return 'tauri'
  return /Electron\//.test(navigator.userAgent) ? 'electron' : 'web'
}

export function environment(): ProbeEnvironment {
  return {
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent,
  }
}

function usedFonts(): string[] {
  const families = new Set<string>()
  document.fonts.forEach(f => { if (f.status === 'loaded') families.add(f.family.replace(/^["']|["']$/g, '')) })
  for (const el of [document.body, ...document.body.querySelectorAll('*')].slice(0, 4000)) {
    for (const name of getComputedStyle(el).fontFamily.split(',')) families.add(name.trim().replace(/^["']|["']$/g, ''))
  }
  return [...families].filter(Boolean).sort()
}

export interface RecorderOptions { app: AppInfo; port: number; locator: LocatorOptions }

/**
 * Idle until Henji says start: then it marks the tab, reloads, and records from the first module.
 * While recording, every boundary call still reaches the real world; the probe only copies results.
 */
export class Recorder {
  private connection: HenjiConnection
  private session: string | null = sessionStorage.getItem(SESSION_KEY)
  private queue: EventQueue | null = null
  private active = false
  private flushRandom: () => void = () => {}
  private sameOriginUrls: () => string[] = () => []
  private readonly originalFetch: FetchLike = window.fetch.bind(window)

  constructor(private readonly options: RecorderOptions) {
    this.connection = new HenjiConnection(options.port, window.WebSocket)
    this.connection.onOpen = () => this.connection.sendNow({ type: 'hello', protocol: PROBE_PROTOCOL_VERSION, probeVersion: PROBE_VERSION, app: options.app, host: hostKind(), env: environment(), ...(this.session ? { session: this.session } : {}) })
    this.connection.onMessage = message => this.handle(message)
    if (this.session) this.begin(this.session)
    this.connection.connect()
  }

  get recording(): boolean { return this.active }

  fetch(inner: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return this.active && this.queue ? recordFetch(this.queue, 'seam', inner, input, init) : inner(input, init)
  }

  action(name: string, detail?: unknown): void {
    if (!this.active || !this.queue) return
    this.queue.emitLater(nowUs(), async () => ({ kind: 'action', t: 0, name, ...(detail === undefined ? {} : { detail: await encodeValue(detail) }) }))
  }

  private handle(message: HenjiMessage): void {
    if (message.type === 'ping') this.connection.sendNow({ type: 'pong', id: message.id, now: performance.now() })
    else if (message.type === 'start' && !this.session) { sessionStorage.setItem(SESSION_KEY, message.session); location.reload() }
    else if (message.type === 'stop' && message.session === this.session) void this.end()
  }

  /** Runs synchronously inside the first module, before any app module reads storage. */
  private begin(session: string): void {
    const storage = snapshotStorage()
    const isActive = (): boolean => this.active
    const queue = new EventQueue(events => this.connection.send({ type: 'events', session, events }))
    this.queue = queue
    this.active = true
    // A tap that fails is reported and skipped: the probe must never break the app it records.
    const safely = <T>(name: string, install: () => T, fallback: T): T => {
      try { return install() } catch (error) {
        queue.emit({ kind: 'boundary', t: nowUs(), boundary: 'other', detail: `探针无法接管${name}：${String((error as Error)?.message ?? error)}` })
        return fallback
      }
    }
    const ipcHook = safely('Tauri 宿主调用', () => createTauriIpcTap(queue, isActive), null)
    safely('网络请求', () => installWindowFetchTap(queue, isActive, ipcHook), undefined)
    this.flushRandom = safely('随机数', () => installRandomTap(queue, isActive), () => {})
    safely('剪贴板', () => installClipboardTap(queue, isActive), undefined)
    safely('输入事件', () => installInputTap(queue, isActive, this.options.locator), undefined)
    this.sameOriginUrls = safely('前端资源', () => installMediaTap(queue, isActive).sameOriginUrls, () => [location.href])
    safely('其他外部调用', () => installBoundaryTap(queue, isActive), undefined)
    setInterval(() => this.flushRandom(), 100)
    this.connection.send({ type: 'started', session, wallAtZeroMs: Date.now() - performance.now(), env: environment() })
    storage.then(
      snapshot => this.connection.send({ type: 'storage', session, snapshot }),
      error => this.connection.send({ type: 'error', session, message: `页面存储读取失败：${String(error)}` }),
    )
  }

  private async end(): Promise<void> {
    const session = this.session
    const queue = this.queue
    if (!session || !queue) return
    this.flushRandom()
    this.active = false
    await queue.drain()
    queue.dispose()
    let resources = 0
    for (const url of this.sameOriginUrls()) {
      try {
        const response = await this.originalFetch(url, { cache: 'force-cache' })
        const body = bytesToWire(new Uint8Array(await response.arrayBuffer()))
        this.connection.send({ type: 'resource', session, url, status: response.status, contentType: response.headers.get('content-type') ?? '', body })
        resources += 1
      } catch (error) {
        this.connection.send({ type: 'error', session, message: `前端资源读取失败：${url} ${String(error)}` })
      }
    }
    this.connection.send({ type: 'stopped', session, resources, fonts: usedFonts() })
    sessionStorage.removeItem(SESSION_KEY)
    this.session = null
    this.queue = null
  }
}
