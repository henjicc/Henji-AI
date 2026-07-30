import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentRouteDecision } from '../context/types'
import { createMainLogger } from '../../logging'
import type { AgentToolRegistry } from '../tools/registry'
import { verifyAgentCompletion } from './result-verifier'

const logger = createMainLogger('main.agent_runtime')

interface CompletionCoordinatorOptions {
  runId: string
  registry: AgentToolRegistry
  emit: (event: AgentEventInput) => void
}

export type CompletionDecision =
  | {
      kind: 'accepted'
      clarificationRequired: boolean
      summary: string
    }
  | {
      kind: 'repair'
      summary: string
      message: string
    }

export class AgentCompletionCoordinator {
  private correctionUsed = false

  constructor(private readonly options: CompletionCoordinatorOptions) {}

  evaluate(
    route: AgentRouteDecision,
    finalText: string,
    observations: AgentToolObservation[]
  ): CompletionDecision {
    const verification = verifyAgentCompletion({
      route,
      finalText,
      observations,
      registry: this.options.registry,
    })
    this.options.emit({
      type: 'VerificationCompleted',
      passed: verification.passed,
      summary: verification.summary,
      evidence: verification.evidence,
    })
    logger.info('Agent 结果验证完成', {
      event: verification.passed
        ? 'agent_verification.completed'
        : 'agent_verification.failed',
      requestId: this.options.runId,
      context: {
        intent: route.intent,
        passed: verification.passed,
        evidenceCount: verification.evidence.length,
      },
    })
    if (verification.passed) {
      return {
        kind: 'accepted',
        clarificationRequired: verification.clarificationRequired,
        summary: verification.summary,
      }
    }
    if (this.correctionUsed) {
      throw new Error(
        `[VERIFICATION_REPAIR_FAILED] 最终答复经一次修正后仍与工具事实不一致：${verification.summary}`
      )
    }
    this.correctionUsed = true
    return {
      kind: 'repair',
      summary: verification.summary,
      message: [
        '[最终答复事实修正]',
        `验证结果：${verification.summary}`,
        '这是唯一一次自动修正机会。必须只依据已有工具事实修正答复；若证据不足，应明确说明无法确认，不得声称操作成功。',
      ].join('\n'),
    }
  }
}
