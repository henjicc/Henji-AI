import type { WebContents } from 'electron'

import {
  agentCancelQueuedMessageRequestSchema,
  agentEnqueueMessageRequestSchema,
  agentQueuedMessagePayloadSchema,
  type AgentCancelQueuedMessageRequest,
  type AgentEnqueueMessageRequest,
  type AgentEnqueueMessageResult,
  type AgentSessionEntry,
} from '../../../../src/core/assistant/session'
import type { AgentRunState } from '../../../../src/core/assistant/events'
import type {
  AgentStartRunRequest,
  AgentStartRunResult,
} from '../../../../src/core/assistant/runtimeContracts'
import type { AgentWorkingSummary } from '../../../../src/core/assistant/workingContext'
import { createMainLogger } from '../logging'
import type { AgentRuntimeManager } from '../agent-runtime-manager/manager'
import type { AgentPersistenceStore } from './persistence/store'

const logger = createMainLogger('main.agent_message_queue')
const terminalStatuses = new Set<AgentRunState['status']>(['completed', 'failed', 'cancelled'])

interface QueueRunRecord {
  threadId: string
  state: AgentRunState
}

interface AgentMessageQueueCoordinatorOptions {
  persistence: AgentPersistenceStore
  manager: AgentRuntimeManager
  commitControlState: (runId: string, state: AgentRunState) => AgentRunState
  startContinuation: (
    owner: WebContents,
    request: AgentStartRunRequest,
    parentRunId: string,
    recoveryContext: AgentWorkingSummary | undefined
  ) => Promise<AgentStartRunResult>
  hasActiveThread: (threadId: string) => boolean
}

export class AgentMessageQueueCoordinator {
  private readonly continuingThreads = new Set<string>()

  constructor(private readonly options: AgentMessageQueueCoordinatorOptions) {}

  async enqueue(
    record: QueueRunRecord,
    raw: AgentEnqueueMessageRequest
  ): Promise<AgentEnqueueMessageResult> {
    const input = agentEnqueueMessageRequestSchema.parse(raw)
    if (record.threadId !== input.threadId) {
      throw new Error('[QUEUE_THREAD_MISMATCH] 消息不属于当前会话')
    }
    if (terminalStatuses.has(record.state.status)) {
      throw new Error('[QUEUE_RUN_SETTLED] 已结束的任务不能再接收排队消息')
    }
    if (input.mode !== 'clarification') return this.options.persistence.enqueueMessage(input)
    if (record.state.status !== 'waiting_user' || !record.state.waitingClarificationId) {
      throw new Error('[CLARIFICATION_NOT_WAITING] 当前运行没有等待用户回答')
    }
    if (input.waitId !== record.state.waitingClarificationId) {
      throw new Error('[CLARIFICATION_WAIT_MISMATCH] 回答不属于当前澄清问题')
    }
    const queued = this.options.persistence.enqueueMessage(input)
    const payload = agentQueuedMessagePayloadSchema.parse(queued.entry.payload)
    if (queued.deduplicated && payload.status !== 'accepted') return queued
    const consumed = this.options.persistence.updateQueuedMessageStatus(
      queued.entry.entryId, 'accepted', 'consumed', undefined, input.runId
    )
    if (!consumed) throw new Error('[QUEUE_STATUS_CONFLICT] 澄清回答已被处理')
    try {
      const state = await this.options.manager.respondClarification(
        input.runId,
        input.waitId,
        input.content
      )
      this.options.commitControlState(input.runId, state)
      return { entry: consumed, deduplicated: queued.deduplicated }
    } catch (error) {
      this.options.persistence.updateQueuedMessageStatus(
        consumed.entryId, 'consumed', 'failed', '澄清回答未能送达运行进程'
      )
      throw error
    }
  }

  cancel(record: QueueRunRecord, raw: AgentCancelQueuedMessageRequest): AgentSessionEntry {
    const input = agentCancelQueuedMessageRequestSchema.parse(raw)
    if (record.threadId !== input.threadId) {
      throw new Error('[QUEUE_THREAD_MISMATCH] 消息不属于当前会话')
    }
    return this.options.persistence.cancelQueuedMessage(input)
  }

  async resume(owner: WebContents, threadId: string): Promise<void> {
    if (this.options.hasActiveThread(threadId) || this.continuingThreads.has(threadId)) return
    const parentRunId = this.options.persistence.findAcceptedAfterTaskRun(threadId)
    if (!parentRunId) return
    const state = this.options.persistence.loadState(parentRunId)
    if (state) await this.start(owner, parentRunId, state, false)
  }

  async settle(
    owner: WebContents,
    parentRunId: string,
    parentState: AgentRunState
  ): Promise<void> {
    await this.start(owner, parentRunId, parentState, true)
  }

  private async start(
    owner: WebContents,
    parentRunId: string,
    parentState: AgentRunState,
    markFailedOnError: boolean
  ): Promise<void> {
    const sourceRequest = this.options.persistence.loadRequest(parentRunId)
    const followUps = this.options.persistence.listAfterTaskMessages(parentRunId)
    if (!sourceRequest || followUps.length === 0) return
    const threadId = sourceRequest.threadId
    if (this.continuingThreads.has(threadId)) return
    this.continuingThreads.add(threadId)
    try {
      const goal = followUps.map((entry) => (
        agentQueuedMessagePayloadSchema.parse(entry.payload).content
      )).join('\n\n')
      const started = await this.options.startContinuation(
        owner, { ...sourceRequest, goal }, parentRunId, parentState.workingSummary
      )
      for (const entry of followUps) {
        this.options.persistence.updateQueuedMessageStatus(
          entry.entryId, 'accepted', 'consumed', undefined, started.runId
        )
      }
    } catch (error) {
      if (markFailedOnError) {
        for (const entry of followUps) {
          this.options.persistence.updateQueuedMessageStatus(
            entry.entryId, 'accepted', 'failed', '后续任务未能启动'
          )
        }
      }
      logger.error('Agent 后续任务启动失败', {
        event: 'agent_session.queue.after_task.failed', requestId: parentRunId, error,
      })
    } finally {
      this.continuingThreads.delete(threadId)
    }
  }
}
