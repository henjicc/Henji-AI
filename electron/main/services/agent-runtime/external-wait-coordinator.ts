import type { WebContents } from 'electron'
import { webContents } from 'electron'

import {
  agentCancelExternalWaitRequestSchema,
  generationStatusReportRequestSchema,
  type AgentExternalWaitRecord,
  type AgentExternalWaitRegister,
  type GenerationStatusReportRequest,
} from '../../../../src/core/assistant/externalWait'
import { agentQueuedMessagePayloadSchema } from '../../../../src/core/assistant/session'
import type {
  AgentStartRunRequest,
  AgentStartRunResult,
} from '../../../../src/core/assistant/runtimeContracts'
import type { AgentWorkingSummary } from '../../../../src/core/assistant/workingContext'
import { createMainLogger } from '../logging'
import type { AgentPersistenceStore } from './persistence/store'

const logger = createMainLogger('main.agent_external_wait')

interface ExternalWaitCoordinatorOptions {
  persistence: AgentPersistenceStore
  hasActiveThread: (threadId: string) => boolean
  startContinuation: (
    owner: WebContents,
    request: AgentStartRunRequest,
    parentRunId: string,
    recoveryContext: AgentWorkingSummary | undefined
  ) => Promise<AgentStartRunResult>
  cancelGeneration: (
    owner: WebContents,
    wait: AgentExternalWaitRecord
  ) => Promise<void>
}

export class AgentExternalWaitCoordinator {
  private readonly ownersByThread = new Map<string, number>()
  private readonly resuming = new Set<string>()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(private readonly options: ExternalWaitCoordinatorOptions) {
    this.timer = setInterval(() => { void this.scanExpired() }, 30_000)
    this.timer.unref()
  }

  register(input: AgentExternalWaitRegister): AgentExternalWaitRecord {
    return this.options.persistence.externalWait.register(input)
  }

  async report(owner: WebContents, raw: GenerationStatusReportRequest): Promise<void> {
    const request = generationStatusReportRequestSchema.parse(raw)
    const inserted = this.options.persistence.externalWait.recordStatus(request.event)
    const waits = this.options.persistence.externalWait.claimReady(request.event.taskId)
    for (const wait of waits) this.ownersByThread.set(wait.threadId, owner.id)
    logger.info('生成任务状态事件已接收', {
      event: 'agent_external_wait.status.received', taskId: request.event.taskId,
      context: { status: request.event.status, inserted, claimed: waits.length },
    })
    await Promise.all(waits.map((wait) => this.resume(owner, wait)))
  }

  async sourceSettled(owner: WebContents, sourceRunId: string): Promise<void> {
    const waits = this.options.persistence.externalWait.claimReady()
      .filter((wait) => wait.sourceRunId === sourceRunId)
    for (const wait of waits) {
      this.ownersByThread.set(wait.threadId, owner.id)
      await this.resume(owner, wait)
    }
  }

  async resumeThread(owner: WebContents, threadId: string): Promise<void> {
    this.ownersByThread.set(threadId, owner.id)
    this.options.persistence.externalWait.claimExpired()
    this.options.persistence.externalWait.claimReady()
    const waits = this.options.persistence.externalWait.listClaimed(threadId)
    for (const wait of waits) await this.resume(owner, wait)
  }

  async cancel(
    owner: WebContents,
    raw: { schemaVersion: 'agent-runtime/v1'; waitId: string; cancelGeneration: boolean }
  ): Promise<AgentExternalWaitRecord> {
    const input = agentCancelExternalWaitRequestSchema.parse(raw)
    const wait = this.options.persistence.externalWait.get(input.waitId)
    if (!wait) throw new Error('[EXTERNAL_WAIT_NOT_FOUND] 外部等待不存在')
    if (input.cancelGeneration) await this.options.cancelGeneration(owner, wait)
    return this.options.persistence.externalWait.cancel(input.waitId)
  }

  dispose(): void {
    clearInterval(this.timer)
    this.ownersByThread.clear()
  }

  private async scanExpired(): Promise<void> {
    const waits = this.options.persistence.externalWait.claimExpired()
    for (const wait of waits) {
      const ownerId = this.ownersByThread.get(wait.threadId)
      const owner = ownerId === undefined ? null : webContents.fromId(ownerId)
      if (owner && !owner.isDestroyed()) await this.resume(owner, wait)
    }
  }

  private async resume(owner: WebContents, wait: AgentExternalWaitRecord): Promise<void> {
    if (this.resuming.has(wait.waitId)) return
    if (this.options.hasActiveThread(wait.threadId)) {
      this.options.persistence.externalWait.release(wait.waitId, '同一会话仍有活动任务，稍后重试')
      return
    }
    const sourceRequest = this.options.persistence.loadRequest(wait.sourceRunId)
    const sourceState = this.options.persistence.loadState(wait.sourceRunId)
    if (!sourceRequest || !sourceState || !wait.lastObservedStatus) {
      this.options.persistence.externalWait.release(wait.waitId, '源运行或终态事实暂不可用')
      return
    }
    this.resuming.add(wait.waitId)
    try {
      const supplements = this.options.persistence.listCurrentTaskMessages(wait.sourceRunId)
      const extra = supplements.map((entry) => (
        agentQueuedMessagePayloadSchema.parse(entry.payload).content
      ))
      const goal = [
        `生成任务 ${wait.taskId} 已报告状态 ${wait.lastObservedStatus}。`,
        '这是一次自动续接：必须先读取该任务的权威状态并据此回答；不得再次创建或提交生成任务。',
        ...extra.map((content) => `用户在等待期间补充：${content}`),
      ].join('\n')
      const started = await this.options.startContinuation(owner, {
        ...sourceRequest,
        goal,
        // 自动续接是新的自然 Agent 循环，不继承源运行的“剩余轮次”。
        // 若调用方曾显式传入停止策略，则重新应用该策略，而不是折算剩余额度。
        budget: sourceRequest.budget,
        externalContinuation: {
          waitId: wait.waitId,
          sourceRunId: wait.sourceRunId,
          taskId: wait.taskId,
          observedStatus: wait.lastObservedStatus,
          sourceTotalTokens: sourceState.usage.totalTokens,
          sourceKnownCostUsd: sourceState.usage.knownCostUsd,
        },
      }, wait.sourceRunId, sourceState.workingSummary)
      if (!this.options.persistence.externalWait.consume(wait.waitId, started.runId)) {
        throw new Error('[EXTERNAL_WAIT_CONSUME_CONFLICT] 外部等待已被其他续接消费')
      }
      for (const entry of supplements) {
        this.options.persistence.updateQueuedMessageStatus(
          entry.entryId, 'accepted', 'consumed', undefined, started.runId
        )
      }
      this.options.persistence.retargetAfterTaskMessages(wait.sourceRunId, started.runId)
      logger.info('Agent 外部等待已唤醒关联子运行', {
        event: 'agent_external_wait.resumed', requestId: started.runId,
        taskId: wait.taskId, context: { waitId: wait.waitId, sourceRunId: wait.sourceRunId },
      })
    } catch (error) {
      this.options.persistence.externalWait.release(
        wait.waitId,
        error instanceof Error ? error.message : '外部等待续接失败'
      )
      logger.error('Agent 外部等待续接失败', {
        event: 'agent_external_wait.resume.failed', requestId: wait.sourceRunId,
        taskId: wait.taskId, error,
      })
    } finally {
      this.resuming.delete(wait.waitId)
    }
  }
}
