import {
  AGENT_CONTRACT_VERSION, frontendToolRequestSchema, frontendToolResultSchema,
  type FrontendToolRequest, type FrontendToolResult, type ApplicationCapabilityResult,
} from '@/core/assistant/hostContracts'
import type { CapabilityExecutionContext } from '../applicationCapabilities/handlerTypes'
import type { ApplicationExecutionPreparation } from '@/core/application-control/transactions'

interface ExecutionCoordinatorDependencies {
  rendererSessionId: string
  acknowledge: (request: FrontendToolRequest, preparation?: ApplicationExecutionPreparation) => Promise<void>
  complete: (result: FrontendToolResult) => Promise<void>
  execute: (request: FrontendToolRequest, context: CapabilityExecutionContext) => Promise<ApplicationCapabilityResult>
  reportError: (error: unknown, request: FrontendToolRequest, stage: 'execute' | 'receipt') => void
}

/** 宿主执行与回执协调器；React 只负责连接事件和订阅。重传只重发回执。 */
export class FrontendToolExecutionCoordinator {
  private readonly active = new Map<string, { controller: AbortController; result: Promise<ApplicationCapabilityResult> }>()
  private readonly calls = new Map<string, string>()
  private readonly inputs = new Map<string, string>()
  private readonly cancelled = new Set<string>()
  private readonly completed = new Map<string, ApplicationCapabilityResult>()
  private readonly pendingReceipts = new Map<string, { request: FrontendToolRequest; result: FrontendToolResult }>()
  private readonly sending = new Set<string>()
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly dependencies: ExecutionCoordinatorDependencies) {}

  async receive(raw: FrontendToolRequest): Promise<void> {
    if (this.disposed) return
    const request = frontendToolRequestSchema.parse(raw)
    const input = JSON.stringify(request.operation)
    const previousInput = this.inputs.get(request.idempotencyKey)
    if (previousInput && previousInput !== input) throw new Error('OPERATION_CONFLICT: 原操作不能绑定新输入')
    this.inputs.set(request.idempotencyKey, input)
    this.calls.set(request.callId, request.idempotencyKey)
    const retained = this.pendingReceipts.get(request.callId)
    if (retained) { await this.deliver(retained); return }
    await this.dependencies.acknowledge(request)
    let result = this.completed.get(request.idempotencyKey)
    if (!result) {
      let active = this.active.get(request.idempotencyKey)
      if (!active) {
        const controller = new AbortController()
        // 先注册执行身份再进入执行器；同步抛错也保留为同一未知尝试。
        const execution = Promise.resolve().then(() => this.disposed || controller.signal.aborted || this.cancelled.has(request.callId)
          ? Promise.resolve<ApplicationCapabilityResult>({ ok: false,
            error: { code: 'ABORTED', message: '请求在开始执行前已取消', recoverable: true } })
          : request.deadline <= Date.now()
          ? Promise.resolve<ApplicationCapabilityResult>({ ok: false,
            error: { code: 'DEADLINE_EXCEEDED', message: '请求在开始执行前已过期', recoverable: true } })
          : this.dependencies.execute(request, { signal: controller.signal,
            operationId: request.operationId, requestId: request.runId, taskId: request.toolCallId,
            ...(request.operationId ? { recordExecutionPreparation: (preparation: ApplicationExecutionPreparation) =>
              this.dependencies.acknowledge(request, preparation) } : {}),
          }))
        active = { controller, result: execution }
        this.active.set(request.idempotencyKey, active)
      }
      try {
        result = await active.result
        this.completed.set(request.idempotencyKey, result)
        this.active.delete(request.idempotencyKey)
      } catch (error) {
        this.dependencies.reportError(error, request, 'execute')
        throw error
      }
    }
    const receipt = { request, result: frontendToolResultSchema.parse({
      schemaVersion: AGENT_CONTRACT_VERSION, runId: request.runId, toolCallId: request.toolCallId,
      callId: request.callId, idempotencyKey: request.idempotencyKey,
      rendererSessionId: this.dependencies.rendererSessionId, completedAt: new Date().toISOString(), result,
    }) }
    this.pendingReceipts.set(request.callId, receipt)
    await this.deliver(receipt)
  }

  cancel(callId: string): void {
    this.cancelled.add(callId)
    const key = this.calls.get(callId)
    if (key) this.active.get(key)?.controller.abort()
  }

  async flushReceipts(): Promise<void> {
    await Promise.all([...this.pendingReceipts.values()].map((receipt) => this.deliver(receipt)))
  }

  private async deliver(receipt: { request: FrontendToolRequest; result: FrontendToolResult }): Promise<void> {
    const { callId, idempotencyKey } = receipt.request
    if (this.sending.has(callId)) return
    this.sending.add(callId)
    try {
      await this.dependencies.complete(receipt.result)
      this.pendingReceipts.delete(callId)
      this.calls.delete(callId)
      this.cancelled.delete(callId)
      // 只有主进程已确认的回执才允许从内存缓存淘汰。
      for (const key of this.completed.keys()) {
        if (this.completed.size <= 300) break
        if (![...this.pendingReceipts.values()].some((item) => item.request.idempotencyKey === key)) {
          this.completed.delete(key)
          this.inputs.delete(key)
        }
      }
    } catch (error) {
      this.dependencies.reportError(error, receipt.request, 'receipt')
      if (!this.disposed && !this.retryTimer) this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined
        void this.flushReceipts()
      }, 5_000)
      // 原业务结果仍保留；回执传输失败不能再次执行写入。
      this.completed.set(idempotencyKey, receipt.result.result)
    } finally {
      this.sending.delete(callId)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    for (const operation of this.active.values()) operation.controller.abort()
    // 执行器的迟到结果仍走 deliver；退出仅停止新执行与定时重传。
  }
}
