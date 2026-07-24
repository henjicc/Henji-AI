import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type {
  AgentMemoryContextEntry,
  AgentMemoryRetrievalQuery,
  AgentMemoryRetrievalResult,
} from '../../../../../src/core/assistant/memory'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import { createMainLogger } from '../../logging'
import type { AgentRouteDecision } from '../context/types'

const logger = createMainLogger('main.agent_memory_context')

type RetrieveMemory = (
  query: AgentMemoryRetrievalQuery,
  signal: AbortSignal
) => Promise<AgentMemoryRetrievalResult>

function stepSignals(summary: AgentWorkingSummary | undefined): string[] {
  if (!summary) return []
  return [
    summary.activeStep?.toolName,
    ...summary.failedSteps.slice(-2).map((step) => step.toolName),
    ...summary.completedSteps.slice(-2).map((step) => step.toolName),
    summary.recovery.toolCategory,
  ].flatMap((value) => value ? [value] : [])
}

export class AgentMemoryContextProvider {
  private current: AgentMemoryContextEntry[]
  private lastSignature = ''

  constructor(
    private readonly runId: string,
    fallback: AgentMemoryContextEntry[],
    private readonly retrieveMemory?: RetrieveMemory
  ) {
    this.current = fallback.slice(0, 10)
  }

  async retrieve(input: {
    goal: string
    snapshot: HostContextSnapshot
    route: AgentRouteDecision
    summary?: AgentWorkingSummary
    signal: AbortSignal
  }): Promise<AgentMemoryContextEntry[]> {
    if (!this.retrieveMemory) return this.current
    const query: AgentMemoryRetrievalQuery = {
      goal: input.goal,
      workspaceId: input.snapshot.workspace.id,
      projectId: input.snapshot.project.id,
      intent: input.route.intent,
      toolDomains: input.route.toolDomains,
      stepSignals: stepSignals(input.summary),
      limit: 6,
    }
    const signature = JSON.stringify(query)
    if (signature === this.lastSignature) return this.current
    this.lastSignature = signature
    try {
      const result = await this.retrieveMemory(query, input.signal)
      this.current = result.entries
      logger.debug('Agent 运行时记忆已按需刷新', {
        event: 'agent_memory_context.refresh.completed',
        requestId: this.runId,
        context: {
          count: result.entries.length,
          consideredCount: result.consideredCount,
          excludedCount: result.excludedCount,
          truncated: result.truncated,
          exclusionReasons: result.exclusionReasons,
          intent: input.route.intent,
        },
      })
    } catch (error) {
      logger.warn('Agent 运行时记忆召回失败，继续使用上次安全结果', {
        event: 'agent_memory_context.refresh.failed',
        requestId: this.runId,
        context: { intent: input.route.intent, fallbackCount: this.current.length },
        error,
      })
    }
    return this.current
  }
}
