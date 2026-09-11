import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { OperationRecord } from '../../../../../src/core/assistant/operations'
import { projectExecutionFacts, type ExecutionFactsProjection } from '../../../../../src/core/assistant/executionFacts'
import type { AgentObservedEffect } from '../../../../../src/core/assistant/observedEffect'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_runtime')

interface CompletionCoordinatorOptions {
  runId: string
  emit: (event: AgentEventInput) => void
  onProjection?: (projection: ExecutionFactsProjection) => void
  inheritedEffects?: AgentObservedEffect[]
}

export interface CompletionDecision {
  kind: 'accepted'
  summary: string
  projection: ExecutionFactsProjection
}

/** 广播整项任务的执行事实和未解决验证；不裁决模型措辞或要求改写答复。 */
export class AgentCompletionCoordinator {
  constructor(private readonly options: CompletionCoordinatorOptions) {}

  project(observations: AgentToolObservation[], records: OperationRecord[] = []): ExecutionFactsProjection {
    const inherited: AgentToolObservation[] = !records.length && this.options.inheritedEffects?.length ? [{
      source: { toolName: 'persisted_execution_facts', toolVersion: 1, toolCallId: 'inherited-execution-facts' },
      trust: 'untrusted_observation', dataClasses: ['C1'], summary: '既有运行保存的执行事实', output: null,
      effects: this.options.inheritedEffects,
    }] : []
    const projection = projectExecutionFacts(records, [...inherited, ...observations])
    this.options.onProjection?.(projection)
    return projection
  }

  evaluate(observations: AgentToolObservation[], records: OperationRecord[] = []): CompletionDecision {
    const projection = this.project(observations, records)
    this.options.emit({
      type: 'VerificationCompleted', passed: projection.passed,
      summary: projection.summary, evidence: projection.evidence.slice(0, 8), facts: projection.facts,
    })
    logger.info('Agent 整轮结果验证完成', {
      event: projection.passed ? 'agent_verification.completed' : 'agent_verification.failed',
      requestId: this.options.runId,
      context: { completion: projection.facts.completion, verificationStatus: projection.facts.verificationStatus,
        unresolvedCount: projection.facts.unresolved.length, operationCount: records.length },
    })
    return { kind: 'accepted', summary: projection.summary, projection }
  }
}
