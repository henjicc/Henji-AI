import { randomUUID } from 'node:crypto'
import { externalWritableEntityTypes, type LocalDomainSurface, type LocalHostRegistration, type LocalHostRegistrationInput, type LocalHostReply, type LocalHostRequest, type LocalTool } from '../../../../src/core/application-control/localHostContracts'
import type { McpOperationCoordinator } from './operationCoordinator'
import type { OperationRecord } from './operationStore'

export interface LocalHostTransport { send(channel: string, payload: unknown): void }
type Pending = { callerId: string; sessionId: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void; cleanup(): void }

export class ApplicationHostBridge {
  private host: { registration: LocalHostRegistration; transport: LocalHostTransport } | undefined
  private pending = new Map<string, Pending>()
  private generation = -1
  constructor(private readonly assertAuthorized: (callerId: string) => void, private readonly operations?: McpOperationCoordinator) {}
  get sessionId(): string { return this.host?.registration.sessionId ?? '' }
  get ready(): boolean { return this.host?.registration.ready === true }
  tools(): LocalTool[] { return this.ready ? this.host!.registration.tools : [] }
  /** 按域发现的数据面；由渲染宿主从反射注册表派生后随注册送来，主进程不维护第二份。 */
  domains(): LocalDomainSurface[] { return this.ready ? this.host!.registration.domains : [] }
  /**
   * 公开业务写入范围。宿主没有送来派生结果时返回空集——**失败方向是拒绝**，
   * 不退回任何前缀白名单，否则"忘了派生"会静默变成"放行全部"。
   */
  writableEntityTypes(): ReadonlySet<string> { return new Set(externalWritableEntityTypes(this.domains())) }
  register(input: LocalHostRegistrationInput, transport: LocalHostTransport): void {
    if (input.generation < this.generation) return
    // 旧形状的注册（没有 domains）仍然接受：只是没有按域发现，也一个实体都不放行通用写入。
    const registration = { ...input, domains: input.domains ?? [] } as LocalHostRegistration
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
      this.operations?.interrupted(id, pending.sessionId)
      this.host?.transport.send('mcp:host:cancel', id)
      pending.reject(new Error('应用页面正在重新连接，请稍后重试。'))
      pending.cleanup()
    }
    this.pending.clear()
  }
  revoke(callerId: string): void {
    this.host?.transport.send('mcp:host:revoke', callerId)
    for (const [id, pending] of this.pending) if (pending.callerId === callerId) {
      this.operations?.interrupted(id, pending.sessionId)
      this.host?.transport.send('mcp:host:cancel', id)
      pending.reject(new Error('连接授权已撤销。'))
      pending.cleanup()
      this.pending.delete(id)
    }
  }
  complete(reply: LocalHostReply): void {
    // 即使 HTTP 已断线/授权已撤销，已发生的执行事实仍须入账；不再向撤销者披露。
    this.operations?.complete(reply)
    const pending = this.pending.get(reply.requestId)
    if (!pending || pending.sessionId !== reply.sessionId || this.host?.registration.sessionId !== reply.sessionId) return
    try { this.assertAuthorized(pending.callerId); pending.resolve(reply.result) }
    catch (error) { pending.reject(error instanceof Error ? error : new Error('连接不可用。')) }
    pending.cleanup()
    this.pending.delete(reply.requestId)
  }
  execute(callerId: string, capabilityId: LocalHostRequest['capabilityId'], input: Record<string, unknown>, signal: AbortSignal,
    options: { operation?: OperationRecord; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean } = {}): Promise<Record<string, unknown>> {
    this.assertAuthorized(callerId)
    if (!this.ready || !this.host) return Promise.reject(new Error('应用尚未就绪，请稍后重试。'))
    if (signal.aborted) return Promise.reject(new Error('请求已取消。'))
    if (this.pending.size >= 8) return Promise.reject(new Error('应用正忙，请稍后重试。'))
    const host = this.host
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        this.operations?.interrupted(requestId, host.registration.sessionId)
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
        if (options.operation) this.operations?.dispatched(options.operation, requestId, host.registration.sessionId)
        host.transport.send('mcp:host:request', { requestId, sessionId: host.registration.sessionId, callerId, capabilityId, input,
          allowWrites: options.allowWrites, allowDestructive: options.allowDestructive, allowPaid: options.allowPaid, operationId: options.operation?.operationId, expectedRevisions: options.operation?.expectedRevisions,
          recoveryVerification: options.operation?.recoveryVerification } satisfies LocalHostRequest)
      } catch (error) {
        this.operations?.interrupted(requestId, host.registration.sessionId)
        this.pending.get(requestId)?.cleanup()
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }
}
