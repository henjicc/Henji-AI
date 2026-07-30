import type { WebContents } from 'electron'

import {
  agentExternalWaitRegisterSchema,
  type AgentCancelExternalWaitRequest,
  type AgentExternalWaitRecord,
  type GenerationStatusReportRequest,
} from '../../../../src/core/assistant/externalWait'
import { agentRunStateSchema, type AgentRunState } from '../../../../src/core/assistant/events'
import type {
  AgentStartRunRequest,
  AgentStartRunResult,
} from '../../../../src/core/assistant/runtimeContracts'
import type { AgentWorkingSummary } from '../../../../src/core/assistant/workingContext'
import { getAssistantHostContext } from '../assistant/frontend-tool-bridge'
import { AgentExternalWaitCoordinator } from './external-wait-coordinator'
import { invokeAgentFrontendTool } from './host-bridge'
import type { AgentPersistenceStore } from './persistence/store'

interface AgentExternalWaitRuntimeOptions {
  persistence: AgentPersistenceStore
  hasActiveThread: (threadId: string) => boolean
  startContinuation: (
    owner: WebContents,
    request: AgentStartRunRequest,
    parentRunId: string,
    recoveryContext: AgentWorkingSummary | undefined
  ) => Promise<AgentStartRunResult>
}

export class AgentExternalWaitRuntime {
  private readonly coordinator: AgentExternalWaitCoordinator

  constructor(private readonly options: AgentExternalWaitRuntimeOptions) {
    this.coordinator = new AgentExternalWaitCoordinator({
      persistence: options.persistence,
      hasActiveThread: options.hasActiveThread,
      startContinuation: options.startContinuation,
      cancelGeneration: (owner, wait) => this.cancelGeneration(owner, wait),
    })
  }

  register(raw: unknown): ReturnType<AgentExternalWaitCoordinator['register']> {
    return this.coordinator.register(agentExternalWaitRegisterSchema.parse(raw))
  }

  report(owner: WebContents, request: GenerationStatusReportRequest): Promise<void> {
    return this.coordinator.report(owner, request)
  }

  async cancel(
    owner: WebContents,
    request: AgentCancelExternalWaitRequest
  ): Promise<AgentRunState> {
    const wait = await this.coordinator.cancel(owner, request)
    const state = this.options.persistence.loadState(wait.sourceRunId)
    if (!state) throw new Error('[run_not_found] 外部等待的源运行不存在')
    const cancelled = agentRunStateSchema.parse({
      ...state,
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    })
    this.options.persistence.saveState(cancelled)
    this.options.persistence.cancelCurrentTaskMessages(
      wait.sourceRunId,
      '外部等待已取消，未消费的当前任务补充已取消'
    )
    return cancelled
  }

  sourceSettled(owner: WebContents, sourceRunId: string): Promise<void> {
    return this.coordinator.sourceSettled(owner, sourceRunId)
  }

  resumeThread(owner: WebContents, threadId: string): Promise<void> {
    return this.coordinator.resumeThread(owner, threadId)
  }

  dispose(): void {
    this.coordinator.dispose()
  }

  private async cancelGeneration(
    owner: WebContents,
    wait: AgentExternalWaitRecord
  ): Promise<void> {
    const host = getAssistantHostContext(owner.id)
    if (!host) throw new Error('[host_not_ready] 宿主界面尚未就绪')
    const result = await invokeAgentFrontendTool({
      kind: 'command',
      command: {
        name: 'cancel_generation_task',
        input: { taskId: wait.taskId, reason: '用户取消外部等待并同时取消生成' },
        expectedRevisions: { generation: host.scopeRevisions.generation },
      },
    }, {
      runId: wait.sourceRunId,
      toolCallId: `external-wait-cancel:${wait.waitId}`,
      signal: new AbortController().signal,
    }, () => ({
      ownerWebContentsId: owner.id,
      rendererSessionId: host.rendererSessionId,
      threadId: wait.threadId,
    }))
    if (!result.ok) throw new Error(result.error.message)
  }
}
