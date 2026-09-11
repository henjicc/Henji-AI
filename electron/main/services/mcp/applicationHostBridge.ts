import { randomUUID } from 'node:crypto'
import type { LocalHostRegistration, LocalHostReply, LocalHostRequest, LocalTool } from '../../../../src/core/application-control/localHostContracts'

export interface LocalHostTransport { send(channel: string, payload: unknown): void }
type Pending = { callerId: string; sessionId: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void; cleanup(): void }

export class ApplicationHostBridge {
  private host: { registration: LocalHostRegistration; transport: LocalHostTransport } | undefined
  private pending = new Map<string, Pending>()
  private generation = -1
  constructor(private readonly assertAuthorized: (callerId: string) => void) {}
  get ready(): boolean { return this.host?.registration.ready === true }
  tools(): LocalTool[] { return this.ready ? this.host!.registration.tools : [] }
  register(registration: LocalHostRegistration, transport: LocalHostTransport): void {
    if (registration.generation < this.generation) return
    this.generation = registration.generation
    if (this.host?.registration.sessionId !== registration.sessionId || !registration.ready) this.disconnect()
    this.host = { registration, transport }
  }
  disconnect(): void {
    this.cancelPending()
    this.host = undefined
  }
  cancelPending(): void {
    for (const [id, pending] of this.pending) {
      this.host?.transport.send('mcp:host:cancel', id)
      pending.reject(new Error('应用页面正在重新连接，请稍后重试。'))
      pending.cleanup()
    }
    this.pending.clear()
  }
  revoke(callerId: string): void {
    this.host?.transport.send('mcp:host:revoke', callerId)
    for (const [id, pending] of this.pending) if (pending.callerId === callerId) {
      this.host?.transport.send('mcp:host:cancel', id)
      pending.reject(new Error('连接授权已撤销。'))
      pending.cleanup()
      this.pending.delete(id)
    }
  }
  complete(reply: LocalHostReply): void {
    const pending = this.pending.get(reply.requestId)
    if (!pending || pending.sessionId !== reply.sessionId || this.host?.registration.sessionId !== reply.sessionId) return
    try { this.assertAuthorized(pending.callerId); pending.resolve(reply.result) }
    catch (error) { pending.reject(error instanceof Error ? error : new Error('连接不可用。')) }
    pending.cleanup()
    this.pending.delete(reply.requestId)
  }
  execute(callerId: string, capabilityId: LocalHostRequest['capabilityId'], input: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    this.assertAuthorized(callerId)
    if (!this.ready || !this.host) return Promise.reject(new Error('应用尚未就绪，请稍后重试。'))
    if (signal.aborted) return Promise.reject(new Error('请求已取消。'))
    if (this.pending.size >= 8) return Promise.reject(new Error('应用正忙，请稍后重试。'))
    const host = this.host
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        host.transport.send('mcp:host:cancel', requestId)
        this.pending.get(requestId)?.cleanup()
        this.pending.delete(requestId)
        reject(new Error('读取已取消或等待超时，请重新查询。'))
      }
      const timer = setTimeout(cancel, 30_000)
      signal.addEventListener('abort', cancel, { once: true })
      this.pending.set(requestId, { callerId, sessionId: host.registration.sessionId, resolve, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel) } })
      try {
        this.assertAuthorized(callerId)
        host.transport.send('mcp:host:request', { requestId, sessionId: host.registration.sessionId, callerId, capabilityId, input } satisfies LocalHostRequest)
      } catch (error) {
        this.pending.get(requestId)?.cleanup()
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }
}
