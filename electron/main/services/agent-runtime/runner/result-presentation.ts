import { randomUUID } from 'node:crypto'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { runHenjiScriptOutputSchema } from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import { taskPolicyForbiddenEffects, type TaskExecutionPolicy } from '../../../../../src/core/assistant/taskExecutionPolicy'
import type { AgentToolGateway } from '../tools/gateway'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'

/** 结果只取正式已验证回执；未解决脚本不能被最后一次读取掩盖。 */
export function chooseResultToPresent(observations: readonly AgentToolObservation[]) {
  const effects = observations.flatMap((observation) => {
    const script = ['run_henji_script', 'resume_henji_script'].includes(observation.source.toolName)
      ? runHenjiScriptOutputSchema.safeParse(observation.output) : null
    return (observation.effects ?? []).map((effect) => ({
      effect, verified: effect.verified || Boolean(script?.success && script.data.verification.passed),
    }))
  })
  const scripts = observations.filter((observation) => ['run_henji_script', 'resume_henji_script'].includes(observation.source.toolName))
  if (scripts.some((observation) => {
    const parsed = runHenjiScriptOutputSchema.safeParse(observation.output)
    return !parsed.success || !parsed.data.verification.passed
  })) return null
  for (const { effect, verified } of [...effects].reverse()) {
    if (effect.effect === 'navigate') return null // 模型已经选择并展示了结果。
    if (['observe', 'delete'].includes(effect.effect) || !verified) continue
    const ref = effect.targetRefs.at(-1)
    if (ref) return { ref, propertyIds: effect.propertyIds }
  }
  return null
}

export async function presentConfirmedResult(input: {
  runId: string; threadId: string; approvalMode: AgentApprovalMode; signal: AbortSignal
  observations: readonly AgentToolObservation[]; policy: TaskExecutionPolicy
  gateway: AgentToolGateway; getHost: () => HostContextSnapshot | null
  markAttempted: () => void
}): Promise<void> {
  if (input.policy.resultPresented || taskPolicyForbiddenEffects(input.policy).has('navigate')) return
  if (!input.getHost()?.navigation || !input.policy.navigationBaseline) return
  const target = chooseResultToPresent(input.observations)
  if (!target) return
  input.markAttempted()
  const request = {
    runId: input.runId, threadId: input.threadId, approvalMode: input.approvalMode,
    explicitUserIntent: false, signal: input.signal,
  }
  const result = await input.gateway.execute({
    ...request, toolCallId: `present-result:${randomUUID()}`, toolName: 'focus_application_entity',
    expectedRevisions: input.getHost()?.scopeRevisions,
    input: { ...target, presentation: 'surface' },
  })
  if (result.status !== 'completed') throw new Error('[RESULT_PRESENTATION_FAILED] 结果已保留，展示操作未完成')
}
