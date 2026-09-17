import { AsyncLocalStorage } from 'node:async_hooks'
import type { ServerEvent, ServerEventBus } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { EXTERNAL_PROTOCOL_VERSIONS } from '../../../../src/core/application-control/localHostContracts'

interface SubscriptionOwner {
  callerId: string
  uris: string[]
  signal: AbortSignal
}
interface Listener {
  owner: SubscriptionOwner
  send(event: ServerEvent): void
  controller: AbortController
  pending: Set<string>
}

/** SDK 仍负责订阅协议；此总线只限定每条流可接收的授权应用事件。 */
export class ApplicationResourceSubscriptions implements ServerEventBus {
  private context = new AsyncLocalStorage<SubscriptionOwner>()
  private listeners = new Set<Listener>()
  constructor(private readonly assertActive: (callerId: string) => void,
    private readonly authorize: (callerId: string, uri: string, signal: AbortSignal) => Promise<unknown>) {}

  async run<T>(callerId: string, body: unknown, signal: AbortSignal, dispatch: () => Promise<T>): Promise<T> {
    const envelope = z.object({ method: z.literal('subscriptions/listen'), params: z.object({
      _meta: z.object({ 'io.modelcontextprotocol/protocolVersion': z.literal(EXTERNAL_PROTOCOL_VERSIONS[0]) }).passthrough(),
    }).passthrough() }).passthrough().safeParse(body)
    const request = z.object({ method: z.string(), params: z.object({
      notifications: z.object({ resourceSubscriptions: z.array(z.string()).max(128).optional() }).passthrough().optional(),
    }).passthrough().optional() }).passthrough().safeParse(body)
    // 协议格式错误交给官方 handler；只有有效的订阅才需要额外领域授权。
    if (envelope.success && !request.success) throw new Error('INVALID_INPUT:资源订阅参数不合法或超过 128 项。')
    const uris = envelope.success && request.success && request.data.method === 'subscriptions/listen'
      ? [...new Set(request.data.params?.notifications?.resourceSubscriptions ?? [])] : []
    for (const uri of uris) await this.authorize(callerId, uri, signal)
    this.assertActive(callerId)
    return this.context.run({ callerId, uris, signal }, dispatch)
  }

  subscribe(send: (event: ServerEvent) => void): () => void {
    const owner = this.context.getStore()
    if (!owner) throw new Error('订阅缺少可信调用者。')
    const listener: Listener = { owner, send, controller: new AbortController(), pending: new Set() }
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener); listener.controller.abort() }
  }

  publish(event: ServerEvent): void {
    for (const listener of this.listeners) {
      if (!this.active(listener)) continue
      if (event.kind === 'resource_updated') {
        if (listener.owner.uris.includes(event.uri)) this.updated(listener, event.uri)
      } else {
        listener.send(event)
        if (event.kind === 'resources_list_changed') for (const uri of listener.owner.uris) this.updated(listener, uri)
      }
    }
  }

  private active(listener: Listener): boolean {
    if (!this.listeners.has(listener) || listener.owner.signal.aborted) return false
    try { this.assertActive(listener.owner.callerId); return true } catch { return false }
  }

  private updated(listener: Listener, uri: string): void {
    if (listener.pending.has(uri)) return
    listener.pending.add(uri)
    void this.authorize(listener.owner.callerId, uri, listener.controller.signal).then(() => {
      if (this.active(listener)) listener.send({ kind: 'resource_updated', uri })
    }).catch(() => {
      // 删除、权限变化或宿主未就绪不发送该资源的数据事件；目录事件仍允许重新发现。
    }).finally(() => { listener.pending.delete(uri) })
  }
}
