import crypto from 'node:crypto'
import { session as electronSession, type WebContents } from 'electron'
import { serveWebSourceFile, WEB_SOURCE_ORIGIN } from './site'

/** 分区拥有唯一 webRequest 监听；实时页与录制槽必须经过同一入口。 */
export class WebSourceSession {
  readonly partition: string
  private readonly session: Electron.Session
  private storage = 'empty'
  private failure?: string
  private readonly observers = new Map<number, () => void>()

  constructor(root: string) {
    this.partition = `web-source-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 24)}`
    this.session = electronSession.fromPartition(this.partition)
    this.session.protocol.handle('https', request => new URL(request.url).origin === WEB_SOURCE_ORIGIN
      ? serveWebSourceFile(root, request) : this.session.fetch(request, { bypassCustomProtocolHandlers: true }))
    this.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    // 省略过滤器覆盖所有协议，含 ws/wss、重定向和 Worker 发起的请求；不记录 URL 或凭据。
    this.session.webRequest.onBeforeRequest((details, callback) => {
      this.observeRequest(details.url)
      callback({})
    })
    this.session.cookies.on('changed', () => this.storageChanged())
    this.session.serviceWorkers.on('registration-completed', () => this.invalidate('service-worker'))
  }

  get reason(): string | undefined { return this.failure }
  get storageSignature(): string { return this.storage }
  private storageChanged(): void { this.storage = crypto.randomUUID() }
  invalidate(reason: string): void { this.failure ??= reason; this.storageChanged() }

  observeRequest(value: string): void {
    const url = new URL(value)
    if (url.origin === WEB_SOURCE_ORIGIN || url.protocol === 'data:' ||
      value === 'about:blank' || (url.protocol === 'blob:' && url.origin === WEB_SOURCE_ORIGIN)) return
    this.invalidate('external-request')
  }

  /** 在载入作者页面前订阅；协议能力失效只禁用缓存，不影响实时网页。 */
  async observe(contents: WebContents): Promise<void> {
    if (this.observers.has(contents.id)) return
    const debuggerApi = contents.debugger
    const message = (_event: Electron.Event, method: string): void => {
      if (method.startsWith('DOMStorage.domStorage') || /^Storage\.(?:indexedDB|cacheStorage|storageBucket)/.test(method)) this.storageChanged()
    }
    const detached = (): void => { this.invalidate('storage-observer-lost'); cleanup() }
    const cleanup = (): void => {
      debuggerApi.removeListener('message', message)
      debuggerApi.removeListener('detach', detached)
      this.observers.delete(contents.id)
    }
    this.observers.set(contents.id, cleanup)
    debuggerApi.on('message', message)
    debuggerApi.on('detach', detached)
    try {
      await debuggerApi.sendCommand('DOMStorage.enable')
      await debuggerApi.sendCommand('Storage.trackIndexedDBForOrigin', { origin: WEB_SOURCE_ORIGIN })
      await debuggerApi.sendCommand('Storage.trackCacheStorageForOrigin', { origin: WEB_SOURCE_ORIGIN })
    } catch { this.invalidate('storage-observer-unavailable') }
  }

  release(contents: WebContents): void { this.observers.get(contents.id)?.() }

  /** CDP 事件不能证明 OPFS 内容不变；有此类存储时保留实时路径。 */
  async validate(contents: WebContents): Promise<boolean> {
    if (this.failure || contents.isDestroyed() || !this.observers.has(contents.id)) return false
    try {
      const usage = await contents.debugger.sendCommand('Storage.getUsageAndQuota', { origin: WEB_SOURCE_ORIGIN }) as { usageBreakdown: Array<{ storageType: string; usage: number }> }
      if (usage.usageBreakdown.some(item => item.usage > 0 && !['indexeddb', 'cache_storage', 'local_storage'].includes(item.storageType))) {
        this.invalidate('unobserved-storage'); return false
      }
      if (Object.keys(this.session.serviceWorkers.getAllRunning()).length) { this.invalidate('service-worker'); return false }
      return !this.failure
    } catch { this.invalidate('storage-observer-unavailable'); return false }
  }
}

const sessions = new Map<string, WebSourceSession>()
export function webSourceSession(root: string): WebSourceSession {
  let value = sessions.get(root)
  if (!value) { value = new WebSourceSession(root); sessions.set(root, value) }
  return value
}
