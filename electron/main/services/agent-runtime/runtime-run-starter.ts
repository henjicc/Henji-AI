import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'

import type { AgentEvent, AgentRunState } from '../../../../src/core/assistant/events'
import type {
  AgentStartRunRequest,
  AgentStartRunResult,
} from '../../../../src/core/assistant/runtimeContracts'
import type { AgentWorkingSummary } from '../../../../src/core/assistant/workingContext'
import { getAssistantHostContext } from '../assistant/frontend-tool-bridge'
import type { AgentRuntimeManager } from '../agent-runtime-manager/manager'
import type { AgentMemoryStore } from '../assistant/memory-store'
import type { AgentPersistenceStore } from './persistence/store'
import { createInitialAgentRunState } from './runner/initial-state'
import { prepareWorkingSummaryForRetry } from './runner/working-summary'
import { validateAgentRunAttachments } from './runner/attachment-context'

export interface AgentRunRecord {
  ownerWebContentsId: number
  rendererSessionId: string
  threadId: string
  state: AgentRunState
  events: AgentEvent[]
}

interface RuntimeRunStarterOptions {
  owner: WebContents
  request: AgentStartRunRequest
  parentRunId: string | null
  recoveryContext: AgentWorkingSummary | undefined
  runs: Map<string, AgentRunRecord>
  activeByThread: Map<string, string>
  persistence: AgentPersistenceStore
  memory: AgentMemoryStore
  manager: AgentRuntimeManager
}

export async function startRuntimeRun(
  options: RuntimeRunStarterOptions
): Promise<AgentStartRunResult> {
  const hostContext = getAssistantHostContext(options.owner.id)
  if (!hostContext?.uiReady) throw new Error('[host_not_ready] 宿主界面尚未就绪')
  await validateAgentRunAttachments(options.request)
  const activeRunId = options.activeByThread.get(options.request.threadId)
  if (activeRunId) {
    const active = options.runs.get(activeRunId)?.state
    if (active && !['completed', 'failed', 'cancelled'].includes(active.status)) {
      throw new Error(`[thread_busy] thread ${options.request.threadId} 已有活动运行 ${activeRunId}`)
    }
  }

  const preparedRecoveryContext = options.recoveryContext
    ? prepareWorkingSummaryForRetry(
        options.recoveryContext,
        hostContext.scopeRevisions,
        options.recoveryContext.artifactRefs.filter((ref) => (
          Boolean(options.persistence.loadArtifact(ref))
        ))
      )
    : undefined
  const runId = randomUUID()
  const initialState = createInitialAgentRunState(runId, options.request, preparedRecoveryContext)
  options.runs.set(runId, {
    ownerWebContentsId: options.owner.id,
    rendererSessionId: hostContext.rendererSessionId,
    threadId: options.request.threadId,
    state: initialState,
    events: [],
  })
  options.activeByThread.set(options.request.threadId, runId)
  options.persistence.createRun(runId, options.request, initialState, options.parentRunId)
  try {
    const projection = options.persistence.projectConversation(options.request.threadId, runId)
    const memoryContext = options.memory.retrieve(
      options.request.goal,
      hostContext.workspace.id,
      hostContext.project.id
    )
    const state = await options.manager.startRun(
      runId,
      options.request,
      hostContext,
      memoryContext,
      projection.messages,
      projection.sourceSequences,
      preparedRecoveryContext
    )
    const record = options.runs.get(runId)
    if (record) record.state = state
    return { runId, state }
  } catch (error) {
    options.activeByThread.delete(options.request.threadId)
    const failed = options.persistence.markRunRecoveryRequired(
      runId,
      'Agent 独立运行进程未能确认启动；为避免重复副作用，需要由用户确认后重试'
    )
    const record = options.runs.get(runId)
    if (failed && record) record.state = failed
    throw error
  }
}
