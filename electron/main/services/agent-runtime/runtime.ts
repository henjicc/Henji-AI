import { randomUUID } from 'node:crypto'
import { webContents, type WebContents } from 'electron'

import {
  agentRuntimeEventPayloadSchema,
  type AgentStartRunRequest,
  type AgentStartRunResult,
} from '../../../../src/core/assistant/runtimeContracts'
import type { AgentRunState } from '../../../../src/core/assistant/events'
import type { AgentEvent } from '../../../../src/core/assistant/events'
import type {
  FrontendToolOperation,
  HostCommandResult,
  HostContextSnapshot,
} from '../../../../src/core/assistant/hostContracts'
import {
  cancelAssistantFrontendTool,
  createFrontendToolRequest,
  getAssistantHostContext,
  requestAssistantFrontendTool,
} from '../assistant/frontend-tool-bridge'
import { runModelStep } from '../llm/sdk/runtime'
import { cancelLlmTask } from '../llm/task-registry'
import { AgentRunner } from './runner/runner'
import { createBuiltinAgentToolRegistry } from './tools/builtin'
import { AgentToolGateway } from './tools/gateway'

interface AgentRunRecord {
  runner: AgentRunner
  ownerWebContentsId: number
  rendererSessionId: string
  threadId: string
}

export class AgentRuntimeService {
  private readonly runs = new Map<string, AgentRunRecord>()
  private readonly activeByThread = new Map<string, string>()
  private readonly registry = createBuiltinAgentToolRegistry((operation, context) => (
    this.invokeFrontend(operation, context)
  ))
  private readonly gateway = new AgentToolGateway({
    registry: this.registry,
    getHostContext: (runId) => this.getRunHostContext(runId),
  })

  startRun(owner: WebContents, request: AgentStartRunRequest): AgentStartRunResult {
    const hostContext = getAssistantHostContext(owner.id)
    if (!hostContext?.uiReady) throw new Error('[host_not_ready] 宿主界面尚未就绪')
    const activeRunId = this.activeByThread.get(request.threadId)
    if (activeRunId) {
      const active = this.runs.get(activeRunId)?.runner.getState()
      if (active && !['completed', 'failed', 'cancelled'].includes(active.status)) {
        throw new Error(`[thread_busy] thread ${request.threadId} 已有活动运行 ${activeRunId}`)
      }
    }

    const runId = randomUUID()
    const runner = new AgentRunner({
      runId,
      request,
      dependencies: {
        registry: this.registry,
        gateway: this.gateway,
        getHostContext: (targetRunId) => this.getRunHostContext(targetRunId),
        runModelStep,
        cancelModelStep: cancelLlmTask,
        onEvent: (event) => this.sendEvent(owner.id, hostContext.rendererSessionId, runId, event),
        onTerminal: () => {
          if (this.activeByThread.get(request.threadId) === runId) this.activeByThread.delete(request.threadId)
        },
      },
    })
    this.runs.set(runId, {
      runner,
      ownerWebContentsId: owner.id,
      rendererSessionId: hostContext.rendererSessionId,
      threadId: request.threadId,
    })
    this.activeByThread.set(request.threadId, runId)
    return { runId, state: runner.start() }
  }

  cancelRun(owner: WebContents, runId: string, reason: string): AgentRunState {
    return this.requireOwnedRun(owner, runId).runner.cancel(reason)
  }

  pauseRun(owner: WebContents, runId: string): AgentRunState {
    return this.requireOwnedRun(owner, runId).runner.pause()
  }

  resumeRun(owner: WebContents, runId: string): AgentRunState {
    return this.requireOwnedRun(owner, runId).runner.resume()
  }

  respondApproval(owner: WebContents, runId: string, approvalId: string, decision: 'approve' | 'reject'): AgentRunState {
    return this.requireOwnedRun(owner, runId).runner.respondApproval(approvalId, decision)
  }

  getRunState(owner: WebContents, runId: string): AgentRunState {
    return this.requireOwnedRun(owner, runId).runner.getState()
  }

  private requireOwnedRun(owner: WebContents, runId: string): AgentRunRecord {
    const record = this.runs.get(runId)
    const currentContext = getAssistantHostContext(owner.id)
    if (
      !record
      || record.ownerWebContentsId !== owner.id
      || !currentContext
      || currentContext.rendererSessionId !== record.rendererSessionId
    ) {
      throw new Error('[run_not_owned] 运行不存在、渲染会话已变化或无权访问')
    }
    return record
  }

  private getRunHostContext(runId: string): HostContextSnapshot | null {
    const record = this.runs.get(runId)
    if (!record) return null
    const context = getAssistantHostContext(record.ownerWebContentsId)
    return context?.rendererSessionId === record.rendererSessionId ? context : null
  }

  private async invokeFrontend(
    operation: FrontendToolOperation,
    context: { runId: string; toolCallId: string; signal: AbortSignal }
  ): Promise<HostCommandResult> {
    const record = this.runs.get(context.runId)
    if (!record) throw new Error('[run_not_found] Agent run not found')
    const sender = webContents.fromId(record.ownerWebContentsId)
    if (!sender || sender.isDestroyed()) throw new Error('[renderer_gone] Renderer is unavailable')
    const callId = randomUUID()
    const onAbort = (): void => { cancelAssistantFrontendTool(callId, 'Agent 工具调用已取消') }
    context.signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await requestAssistantFrontendTool(sender, createFrontendToolRequest({
        runId: context.runId,
        toolCallId: context.toolCallId,
        callId,
        idempotencyKey: `${context.runId}:${context.toolCallId}`,
        deadline: Date.now() + 60_000,
        operation,
      }))
    } finally {
      context.signal.removeEventListener('abort', onAbort)
    }
  }

  private sendEvent(
    webContentsId: number,
    rendererSessionId: string,
    runId: string,
    event: AgentEvent
  ): void {
    const target = webContents.fromId(webContentsId)
    const context = getAssistantHostContext(webContentsId)
    if (!target || target.isDestroyed() || context?.rendererSessionId !== rendererSessionId) return
    target.send('assistant:agent:event', agentRuntimeEventPayloadSchema.parse({ runId, event }))
  }
}

let runtimeService: AgentRuntimeService | null = null

export function getAgentRuntimeService(): AgentRuntimeService {
  runtimeService ??= new AgentRuntimeService()
  return runtimeService
}
