import { BUILTIN_APPLICATION_CAPABILITIES } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { randomUUID } from 'node:crypto'
import { applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import { z } from 'zod'
import { EXTERNAL_APPLICATION_CAPABILITIES } from '../../../../src/core/application-control/externalCapabilityPolicy'
import type { HostContextSnapshot } from '../../../../src/core/application-control/hostContracts'
import { externalWritableEntityTypes, type LocalDomainSurface, type LocalHostRegistration, type LocalHostRegistrationInput, type LocalHostReply, type LocalHostRequest, type LocalTool } from '../../../../src/core/application-control/localHostContracts'
import type { ApplicationOperationCoordinator } from './operationCoordinator'
import type { OperationRecord } from './operationStore'

export interface LocalHostTransport { send(channel: string, payload: unknown): void }
type Pending = { callerId: string; rendererEpoch: string; committed: boolean; resolve(value: Record<string, unknown>): void; reject(error: Error): void; cleanup(): void }

export class ApplicationHostBridge {
  private host: { registration: LocalHostRegistration; transport: LocalHostTransport } | undefined
  private pending = new Map<string, Pending>()
  private attachmentSequence = -1
  private context?: HostContextSnapshot
  private listeners = new Set<() => void>()
  getContext(): HostContextSnapshot | undefined { return this.context }
  publishContext(context: HostContextSnapshot): void { this.context = context; this.changed() }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(): void { for (const listener of this.listeners) listener() }
  constructor(private readonly assertAuthorized: (callerId: string) => void, private readonly operations?: ApplicationOperationCoordinator) {}
  get rendererEpoch(): string { return this.host?.registration.rendererEpoch ?? '' }
  get ready(): boolean { return this.host?.registration.ready === true }
  tools(): LocalTool[] { return EXTERNAL_APPLICATION_CAPABILITIES.all.map(definition => ({
    id: definition.id as LocalTool['id'], version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }),
  })) }
  /** 按域发现的数据面；由渲染宿主从反射注册表派生后随注册送来，主进程不维护第二份。 */
  domains(): LocalDomainSurface[] { return this.ready ? this.host!.registration.domains : [] }
  /**
   * 公开业务写入范围。宿主没有送来派生结果时返回空集——**失败方向是拒绝**，
   * 不退回任何前缀白名单，否则"忘了派生"会静默变成"放行全部"。
   */
  writableEntityTypes(): ReadonlySet<string> { return new Set(externalWritableEntityTypes(this.domains())) }
  register(input: LocalHostRegistrationInput, transport: LocalHostTransport): void {
    if (input.attachmentSequence < this.attachmentSequence) return
    const registration = input
    this.attachmentSequence = registration.attachmentSequence
    if (this.host?.registration.rendererEpoch !== registration.rendererEpoch || !registration.ready) this.disconnect()
    this.host = { registration, transport }
    this.changed()
  }
  disconnect(): void {
    this.cancelPending()
    this.host = undefined
    this.context = undefined
    this.changed()
  }
  cancelPending(callerIds?: ReadonlySet<string>): void {
    for (const [id, pending] of this.pending) {
      if (callerIds && !callerIds.has(pending.callerId)) continue
      this.operations?.interrupted(id, pending.rendererEpoch)
      this.host?.transport.send('application:host:cancel', id)
      pending.reject(new Error('应用页面正在重新连接，请稍后重试。'))
      pending.cleanup()
      this.pending.delete(id)
    }
  }
  revoke(callerId: string): void {
    this.host?.transport.send('application:host:revoke', callerId)
    for (const [id, pending] of this.pending) if (pending.callerId === callerId) {
      this.operations?.interrupted(id, pending.rendererEpoch)
      this.host?.transport.send('application:host:cancel', id)
      pending.reject(new Error('连接授权已撤销。'))
      pending.cleanup()
      this.pending.delete(id)
    }
  }
  /** 模型回合结束只释放等待；显式撤销授权使用 revoke。 */
  releaseCaller(callerId: string): void {
    for (const [id, pending] of this.pending) if (pending.callerId === callerId) {
      pending.cleanup()
      pending.reject(new Error('调用已结束，请通过原操作标识查询结果。'))
      if (!pending.committed) {
        this.host?.transport.send('application:host:cancel', id)
        this.pending.delete(id)
      }
    }
  }
  complete(reply: LocalHostReply): void {
    // 即使 HTTP 已断线/授权已撤销，已发生的执行事实仍须入账；不再向撤销者披露。
    this.operations?.complete(reply)
    const pending = this.pending.get(reply.requestId)
    if (!pending || pending.rendererEpoch !== reply.rendererEpoch || this.host?.registration.rendererEpoch !== reply.rendererEpoch) return
    try { this.assertAuthorized(pending.callerId); pending.resolve(reply.result) }
    catch (error) { pending.reject(error instanceof Error ? error : new Error('连接不可用。')) }
    pending.cleanup()
    this.pending.delete(reply.requestId)
  }
  execute(callerId: string, capabilityId: LocalHostRequest['capabilityId'], input: Record<string, unknown>, signal: AbortSignal,
    options: { operation?: OperationRecord; recoveryVerification?: OperationRecord['recoveryVerification']; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean } = {}): Promise<Record<string, unknown>> {
    this.assertAuthorized(callerId)
    if (!this.ready || !this.host) return Promise.reject(new Error('应用尚未就绪，请稍后重试。'))
    if (signal.aborted) return Promise.reject(new Error('请求已取消。'))
    if (this.pending.size >= 8) return Promise.reject(new Error('应用正忙，请稍后重试。'))
    const host = this.host
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        this.pending.get(requestId)?.cleanup()
        // 等待者退出不取消已派发修改；保留执行关联以处理宿主断开和迟到回执。
        if (!options.operation) {
          host.transport.send('application:host:cancel', requestId)
          this.pending.delete(requestId)
        }
        reject(new Error('读取已取消或等待超时，请重新查询。'))
      }
      const timer = setTimeout(cancel, Math.max(30_000, (BUILTIN_APPLICATION_CAPABILITIES.find(item => item.id === capabilityId)?.timeoutMs ?? 0) + 1_000))
      signal.addEventListener('abort', cancel, { once: true })
      this.pending.set(requestId, { callerId, rendererEpoch: host.registration.rendererEpoch, committed: Boolean(options.operation), resolve, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel) } })
      try {
        this.assertAuthorized(callerId)
        if (options.operation) this.operations?.dispatched(options.operation, requestId, host.registration.rendererEpoch)
        host.transport.send('application:host:request', { requestId, rendererEpoch: host.registration.rendererEpoch, callerId, capabilityId, input,
          allowWrites: options.allowWrites, allowDestructive: options.allowDestructive, allowPaid: options.allowPaid,
          operationId: options.operation ? applicationInvocationId(callerId, options.operation.operationId) : undefined, expectedRevisions: options.operation?.expectedRevisions,
          recoveryVerification: options.operation?.recoveryVerification ?? options.recoveryVerification } satisfies LocalHostRequest)
      } catch (error) {
        this.operations?.interrupted(requestId, host.registration.rendererEpoch)
        this.pending.get(requestId)?.cleanup()
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }
}
