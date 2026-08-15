import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_runtime')

interface CompletionCoordinatorOptions {
  runId: string
  emit: (event: AgentEventInput) => void
}

export interface CompletionDecision {
  kind: 'accepted'
  summary: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * 从最后一次 Henji Script 执行里取出正式验证结论。
 *
 * 这份 `verification` 由解释器产出：每一次 create/update/remove 都从正式状态源读回并逐属性
 * 比对（`HenjiScriptService.verifyEntityCall`），不符即抛 SCRIPT_VERIFICATION_FAILED。
 * 它是"世界上到底发生了什么"的唯一权威，而不是对模型措辞的评价。
 */
function scriptVerification(
  observations: AgentToolObservation[]
): { passed: boolean; summary: string; evidence: string[] } | null {
  for (const observation of [...observations].reverse()) {
    if (observation.source.toolName !== 'run_henji_script') continue
    const verification = asRecord(asRecord(observation.output)?.verification)
    if (!verification) continue
    const evidence = Array.isArray(verification.evidence)
      ? verification.evidence.filter((item): item is string => typeof item === 'string')
      : []
    return {
      passed: verification.passed === true,
      summary: typeof verification.summary === 'string'
        ? verification.summary
        : 'Henji Script 已返回正式验证结论。',
      evidence: evidence.slice(-8),
    }
  }
  return null
}

/**
 * 广播本次运行的验证结论，但**不裁决模型**。
 *
 * 这里曾经是一整套对最终答复措辞的正则审判：`explainsFailure` 检查中文答复里有没有出现
 * 「无法/失败/未找到/…」这 10 个词之一，命不中就判 `passed:false`，触发一轮强制修正；
 * 第二次仍命不中就抛 VERIFICATION_REPAIR_FAILED，让一次真实工作已经完成的运行整体失败。
 * 同类的还有 `claimsSuccess`、`deniesNavigation`——全是拿正则读模型的散文。
 *
 * 它检查的是词汇量，不是诚实度：模型完全可以写出准确但用词不同的说明而被误判，
 * 代价是多烧一整个模型回合，甚至把成功的运行判死。
 *
 * 现在事实层交给工具回执——`run_henji_script` 的 `verification` 来自解释器对真相源的逐步
 * 回读；语义层交给模型自己和用户。协调器只负责如实广播，永远接受最终答复。
 */
export class AgentCompletionCoordinator {
  constructor(private readonly options: CompletionCoordinatorOptions) {}

  evaluate(observations: AgentToolObservation[]): CompletionDecision {
    const verification = scriptVerification(observations)
    const passed = verification?.passed ?? true
    const summary = verification?.summary
      ?? '本轮没有应用写入，无需结构化验证。'
    this.options.emit({
      type: 'VerificationCompleted',
      passed,
      summary,
      evidence: verification?.evidence ?? [],
    })
    logger.info('Agent 结果验证完成', {
      event: passed ? 'agent_verification.completed' : 'agent_verification.failed',
      requestId: this.options.runId,
      context: {
        passed,
        hasScriptVerification: verification !== null,
        evidenceCount: verification?.evidence.length ?? 0,
      },
    })
    return { kind: 'accepted', summary }
  }
}
