import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { ServerEvent, ServerEventBus } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { EXTERNAL_PROTOCOL_VERSIONS } from '../../../../src/core/application-control/localHostContracts'

interface SubscriptionOwner {
  callerId: string
  uris: string[]
  signal: AbortSignal
  resources: Map<string, ResourceState>
}
interface ResourceState { fingerprint: string; scopes: string[] }
interface Listener {
  owner: SubscriptionOwner
  send(event: ServerEvent): void
  controller: AbortController
  pending: Set<string>
  dirty: Set<string>
  timer?: ReturnType<typeof setTimeout>
}

function resourceState(value: unknown): ResourceState {
  const result = z.object({ contents: z.array(z.object({ text: z.string().optional() }).passthrough()) }).safeParse(value)
  const scopes = new Set<string>()
  const contents = result.success ? result.data.contents.map(content => {
    if (!content.text) return content
    let data: unknown
    try { data = JSON.parse(content.text) } catch { return content }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return content
    const record = { ...data } as Record<string, unknown>
    const revisions = z.record(z.string(), z.number()).safeParse(record.revisions)
    if (revisions.success) Object.keys(revisions.data).forEach(scope => scopes.add(scope))
    // 授权读取的时间和基线 ID 每次不同，不代表资源内容变化。
    delete record.capturedAt; delete record.baselineId
    return { ...content, text: record }
  }) : value
  return { fingerprint: createHash('sha256').update(JSON.stringify(contents)).digest('hex'), scopes: [...scopes] }
}

/** SDK 仍负责订阅协议；此总线只限定每条流可接收的授权应用事件。 */
export class ApplicationResourceSubscriptions implements ServerEventBus {
  private context = new AsyncLocalStorage<SubscriptionOwner>()
  private listeners = new Set<Listener>()
  private revisions: Record<string, number> = {}
  private resourceRevisions: Record<string, number> = {}
  constructor(private readonly assertActive: (callerId: string) => void,
    private readonly authorize: (callerId: string, uri: string, signal: AbortSignal) => Promise<unknown>) {}

  async run<T>(callerId: string, body: unknown, signal: AbortSignal, dispatch: () => Promise<T>): Promise<T> {
    const envelope = z.object({ method: z.literal('subscriptions/listen'), params: z.object({
      _meta: z.object({ 'io.modelcontextprotocol/protocolVersion': z.literal(EXTERNAL_PROTOCOL_VERSIONS[0]) }).passthrough(),
    }).passthrough() }).passthrough().safeParse(body)
    const request = z.object({ method: z.string(), params: z.object({
      notifications: z.object({ resourceSubscriptions: z.array(z.string()).optional() }).passthrough().optional(),
    }).passthrough().optional() }).passthrough().safeParse(body)
    // 协议格式错误交给官方 handler；只有有效的订阅才需要额外领域授权。
    if (envelope.success && !request.success) throw new Error('INVALID_INPUT:资源订阅参数不合法。')
    const uris = envelope.success && request.success && request.data.method === 'subscriptions/listen'
      ? [...new Set(request.data.params?.notifications?.resourceSubscriptions ?? [])] : []
    const resources = new Map<string, ResourceState>()
    for (const uri of uris) resources.set(uri, resourceState(await this.authorize(callerId, uri, signal)))
    this.assertActive(callerId)
    return this.context.run({ callerId, uris, signal, resources }, dispatch)
  }

  subscribe(send: (event: ServerEvent) => void): () => void {
    const owner = this.context.getStore()
    if (!owner) throw new Error('订阅缺少可信调用者。')
    const listener: Listener = { owner, send, controller: new AbortController(), pending: new Set(), dirty: new Set() }
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener); clearTimeout(listener.timer); listener.controller.abort() }
  }

  publish(event: ServerEvent): void {
    for (const listener of this.listeners) {
      if (!this.active(listener)) continue
      if (event.kind === 'resource_updated') {
        if (listener.owner.uris.includes(event.uri)) this.updated(listener, event.uri)
      } else {
        listener.send(event)
      }
    }
  }

  publishTo(callerId: string, event: ServerEvent): void {
    for (const listener of this.listeners) if (listener.owner.callerId === callerId && this.active(listener)) {
      if (event.kind === 'resource_updated') {
        if (listener.owner.uris.includes(event.uri)) this.updated(listener, event.uri)
      } else listener.send(event)
    }
  }

  contextChanged(revisions: Record<string, number>, resourceRevisions: Record<string, number> = {}): void {
    const changed = new Set(Object.keys(revisions).filter(scope => scope !== 'navigation' && scope !== 'surface' && revisions[scope] !== (this.revisions[scope] ?? 0)))
    for (const scope of Object.keys(resourceRevisions)) if (resourceRevisions[scope] !== (this.resourceRevisions[scope] ?? 0)) changed.add(scope)
    this.revisions = { ...revisions }
    this.resourceRevisions = { ...resourceRevisions }
    if (!changed.size) return
    for (const listener of this.listeners) for (const uri of listener.owner.uris) {
      const scopes = listener.owner.resources.get(uri)?.scopes ?? []
      if (!scopes.length || scopes.some(scope => changed.has(scope))) this.updated(listener, uri)
    }
  }

  /** 宿主目录/代次变更需要核验订阅；仅内容或版本变化才发 updated。 */
  refresh(): void { for (const listener of this.listeners) for (const uri of listener.owner.uris) this.updated(listener, uri) }

  private active(listener: Listener): boolean {
    if (!this.listeners.has(listener) || listener.owner.signal.aborted) return false
    try { this.assertActive(listener.owner.callerId); return true } catch { return false }
  }

  private updated(listener: Listener, uri: string): void {
    if (!this.active(listener)) return
    listener.dirty.add(uri)
    this.schedule(listener)
  }

  private schedule(listener: Listener): void {
    if (listener.timer || !this.active(listener)) return
    listener.timer = setTimeout(() => {
      listener.timer = undefined
      if (!this.active(listener)) return
      for (const uri of listener.dirty) {
        if (listener.pending.has(uri)) continue
        listener.dirty.delete(uri); listener.pending.add(uri)
        void this.authorize(listener.owner.callerId, uri, listener.controller.signal).then(value => {
          if (!this.active(listener)) return
          const current = resourceState(value)
          const previous = listener.owner.resources.get(uri)
          listener.owner.resources.set(uri, current)
          if (current.fingerprint !== previous?.fingerprint) listener.send({ kind: 'resource_updated', uri })
        }).catch(() => {
          // 删除、权限变化或宿主未就绪不发送数据事件；目录事件允许重新发现。
        }).finally(() => {
          listener.pending.delete(uri)
          if (listener.dirty.size) this.schedule(listener)
        })
      }
    }, 250)
  }
}
