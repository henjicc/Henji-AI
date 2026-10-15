import { BUILTIN_APPLICATION_CAPABILITIES } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { randomUUID } from 'node:crypto'
import { applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import { z } from 'zod'
import { EXTERNAL_APPLICATION_CAPABILITIES } from '../../../../src/core/application-control/externalCapabilityPolicy'
import type { HostContextSnapshot } from '../../../../src/core/application-control/hostContracts'
import { externalWritableEntityTypes, type LocalDomainSurface, type LocalHostRegistration, type LocalHostRegistrationInput, type LocalHostReply, type LocalHostRequest, type LocalTool } from '../../../../src/core/application-control/localHostContracts'
import type { ApplicationOperationCoordinator } from './operationCoordinator'
import type { OperationRecord } from './operationStore'
import { approvePaidOperation, handleUiPaidApproval } from './paidApprovalPolicy'
import type { PaidApprovalDecision, PaidApprovalRequest } from '../../../../src/core/application-control/paidApproval'

export interface LocalHostTransport { send(channel: string, payload: unknown): void }
type Pending = { callerId: string; rendererEpoch: string; committed: boolean; waiting: boolean; allowPaid: boolean; paidRequest?: PaidApprovalRequest; resolve(value: Record<string, unknown>): void; reject(error: Error): void; cleanup(): void }

class ApplicationHostDisconnectedError extends Error {}

export class ApplicationHostNotReadyError extends Error {
  readonly retryAfterMs = 1000
  readonly notExecuted = true
  constructor() { super('APPLICATION_NOT_READY:应用正在重新连接，请稍后重试。') }
}

export class ApplicationHostBridge {
  private host: { registration: LocalHostRegistration; transport: LocalHostTransport } | undefined
  private pending = new Map<string, Pending>()
  private attachmentSequence = -1
  private context?: HostContextSnapshot
  private listeners = new Set<(kind: 'context' | 'catalog') => void>()
  getContext(): HostContextSnapshot | undefined { return this.context }
  publishContext(context: HostContextSnapshot): void { this.context = context; this.changed('context') }
  onChange(listener: (kind: 'context' | 'catalog') => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(kind: 'context' | 'catalog' = 'catalog'): void { for (const listener of this.listeners) listener(kind) }
  private waitUntilReady(callerId: string, signal: AbortSignal, deadline: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', aborted) }
      const aborted = () => { cleanup(); reject(new Error('请求已取消。')) }
      const check = () => {
        try { this.assertAuthorized(callerId) } catch (error) { cleanup(); reject(error); return }
        if (this.ready) { cleanup(); resolve() }
      }
      const unsubscribe = this.onChange(check)
      const timer = setTimeout(() => { cleanup(); reject(new ApplicationHostNotReadyError()) }, Math.max(0, deadline - Date.now()))
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
      else check()
    })
  }
  constructor(private readonly assertAuthorized: (callerId: string) => void, private readonly operations?: ApplicationOperationCoordinator) {}
  get rendererEpoch(): string { return this.host?.registration.rendererEpoch ?? '' }
  get ready(): boolean { return this.host?.registration.ready === true }
  publishReviews(open?: { operationId: string; callerId: string }): void {
    if (this.ready) this.host?.transport.send('application:host:reviews', { items: this.operations?.pendingReviews() ?? [], ...(open ? { open } : {}) })
  }
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
    // 同一渲染进程内“未就绪→就绪”的切换会先发未就绪注册；它与上下文发布走不同通道，到达顺序不定。
    // 只有换了渲染进程才清掉上下文，否则先到的新上下文会被清空，之后没有变化就不会再发布。
    if (this.host?.registration.rendererEpoch !== registration.rendererEpoch) this.disconnect()
    else if (!registration.ready) this.cancelPending()
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
      pending.reject(new ApplicationHostDisconnectedError('应用页面正在重新连接，请稍后重试。'))
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
      pending.waiting = false
      if (!pending.committed) {
        this.host?.transport.send('application:host:cancel', id)
        this.pending.delete(id)
      }
    }
  }
  complete(reply: LocalHostReply): void | PaidApprovalDecision {
    if (reply.uiPaidApproval) {
      if (this.rendererEpoch !== reply.rendererEpoch || !this.operations) throw new Error('应用付费授权会话已结束。')
      return handleUiPaidApproval(this.operations.store, reply)
    }
    if (reply.progress) {
      const pending = this.pending.get(reply.requestId)
      if (!pending || pending.rendererEpoch !== reply.rendererEpoch || this.rendererEpoch !== reply.rendererEpoch) throw new Error('确认所属的应用会话已结束。')
      this.assertAuthorized(pending.callerId)
      if (reply.progress.phase === 'paid_approval') {
        const record = this.operations?.store.byRequest(reply.requestId, reply.rendererEpoch)
        if (!record || !this.operations) throw new Error('付费操作账本不可用。')
        const { request, consent } = reply.progress
        if (consent && (record.state !== 'awaiting_user_confirmation' || !pending.paidRequest || JSON.stringify(pending.paidRequest) !== JSON.stringify(request))) throw new Error('付费确认与原请求不一致。')
        if (consent && (!record.confirmation || record.confirmation.expiresAt === null || record.confirmation.expiresAt <= Date.now())) throw new Error('付费确认已过期。')
        if (!consent && record.state !== 'executing') throw new Error('付费操作当前不可执行。')
        // Generation amounts come from the official preparation result in the main-process ledger.
        const official = request.category === 'generation' && record.paidGenerationEstimate !== undefined
          ? { ...request, estimatedCny: record.paidGenerationEstimate } : request
        const decision = approvePaidOperation(this.operations.store, record, official, pending.allowPaid, consent)
        pending.paidRequest = decision.decision === 'ask' && !consent ? request : undefined
        return decision
      }
      this.operations?.complete(reply)
      // Release the network/model waiter while retaining invocation ownership for revoke/disconnect.
      pending.cleanup()
      pending.waiting = false
      if (reply.progress.phase === 'awaiting_user_confirmation') pending.resolve({ ok: false, executionState: reply.progress.phase, confirmation: reply.progress.confirmation })
      return
    }
    // 即使 HTTP 已断线/授权已撤销，已发生的执行事实仍须入账；不再向撤销者披露。
    this.operations?.complete(reply)
    const pending = this.pending.get(reply.requestId)
    if (!pending || pending.rendererEpoch !== reply.rendererEpoch || this.host?.registration.rendererEpoch !== reply.rendererEpoch) return
    try {
      this.assertAuthorized(pending.callerId)
      // 只在交付读取副本时补代次，原操作回执及持久账本保持原样。
      pending.resolve(pending.committed ? reply.result : { ...reply.result, revisionEpoch: reply.rendererEpoch })
    }
    catch (error) { pending.reject(error instanceof Error ? error : new Error('连接不可用。')) }
    pending.cleanup()
    this.pending.delete(reply.requestId)
  }
  async execute(callerId: string, capabilityId: LocalHostRequest['capabilityId'], input: Record<string, unknown>, signal: AbortSignal,
    options: { reviewTarget?: boolean; operation?: OperationRecord; recoveryVerification?: OperationRecord['recoveryVerification']; recoveryOperation?: LocalHostRequest['recoveryOperation']; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean } = {}): Promise<Record<string, unknown>> {
    const readOnly = !options.operation && BUILTIN_APPLICATION_CAPABILITIES.find(item => item.id === capabilityId)?.readOnly === true
    // 只读才可重新派发；写操作的未知执行事实仍交给原账本恢复。
    let reconnectDeadline: number | undefined
    for (;;) {
      if (!this.ready && readOnly) reconnectDeadline ??= Date.now() + 10_000
      try { return await this.dispatch(callerId, capabilityId, input, signal, options, reconnectDeadline) }
      catch (error) {
        if (!(error instanceof ApplicationHostDisconnectedError) || !readOnly) throw error
        reconnectDeadline ??= Date.now() + 10_000
        if (Date.now() >= reconnectDeadline) throw new ApplicationHostNotReadyError()
        await this.waitUntilReady(callerId, signal, reconnectDeadline)
      }
    }
  }
  private async dispatch(callerId: string, capabilityId: LocalHostRequest['capabilityId'], input: Record<string, unknown>, signal: AbortSignal,
    options: { reviewTarget?: boolean; operation?: OperationRecord; recoveryVerification?: OperationRecord['recoveryVerification']; recoveryOperation?: LocalHostRequest['recoveryOperation']; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean }, reconnectDeadline?: number): Promise<Record<string, unknown>> {
    this.assertAuthorized(callerId)
    if (!this.ready || !this.host) {
      const readOnly = BUILTIN_APPLICATION_CAPABILITIES.find(item => item.id === capabilityId)?.readOnly === true
      if (options.operation || !readOnly) throw new ApplicationHostNotReadyError()
      await this.waitUntilReady(callerId, signal, reconnectDeadline ?? Date.now() + 10_000)
      this.assertAuthorized(callerId)
      if (!this.ready || !this.host) throw new ApplicationHostNotReadyError()
    }
    if (signal.aborted) return Promise.reject(new Error('请求已取消。'))
    if ([...this.pending.values()].filter(pending => pending.waiting).length >= 8) return Promise.reject(new Error('应用正忙，请稍后重试。'))
    const host = this.host
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        this.pending.get(requestId)?.cleanup()
        const pending = this.pending.get(requestId)
        if (pending) pending.waiting = false
        // 等待者退出不取消已派发修改；保留执行关联以处理宿主断开和迟到回执。
        if (!options.operation) {
          host.transport.send('application:host:cancel', requestId)
          this.pending.delete(requestId)
        }
        reject(new Error('读取已取消或等待超时，请重新查询。'))
      }
      const timer = setTimeout(cancel, Math.max(30_000, (BUILTIN_APPLICATION_CAPABILITIES.find(item => item.id === capabilityId)?.timeoutMs ?? 0) + 1_000))
      signal.addEventListener('abort', cancel, { once: true })
      this.pending.set(requestId, { callerId, rendererEpoch: host.registration.rendererEpoch, committed: Boolean(options.operation), waiting: true, allowPaid: options.allowPaid === true, resolve, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel) } })
      try {
        this.assertAuthorized(callerId)
        if (options.operation) this.operations?.dispatched(options.operation, requestId, host.registration.rendererEpoch)
        host.transport.send('application:host:request', { requestId, rendererEpoch: host.registration.rendererEpoch, callerId, capabilityId, input,
          allowWrites: options.allowWrites, allowDestructive: options.allowDestructive, allowPaid: options.allowPaid,
          operationId: options.operation ? applicationInvocationId(callerId, options.operation.operationId) : undefined, expectedRevisions: options.operation?.expectedRevisions,
          paidGenerationEstimate: options.operation?.paidGenerationEstimate,
          reviewTarget: options.reviewTarget, recoveryVerification: options.operation?.recoveryVerification ?? options.recoveryVerification, recoveryOperation: options.operation?.recoveryOperation ?? options.recoveryOperation } satisfies LocalHostRequest)
      } catch (error) {
        this.operations?.interrupted(requestId, host.registration.rendererEpoch)
        this.pending.get(requestId)?.cleanup()
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }
}
