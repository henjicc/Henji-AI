import { agentToolObservationSchema } from '../../../../../src/core/assistant/toolContracts'
import type { AgentToolDefinition } from './types'
import { assertJsonWithinLimits, resolveOutputLimits, summarizeSafeText } from './security'
import { AgentToolGatewayError } from './gateway-support'

/** 主进程回执和 utility 模型观察共用同一解析，禁止各自推测 Effect。 */
export function createToolObservation(definition: AgentToolDefinition, input: unknown, output: unknown, toolCallId: string) {
  assertJsonWithinLimits(output, resolveOutputLimits(definition.outputLimitProfile))
  const parsed = definition.outputSchema.parse(output)
  const dataClasses = definition.dataClasses(parsed)
  if (dataClasses.includes('C3')) throw new AgentToolGatewayError('PERMISSION_DENIED', '工具结果包含 C3 秘密数据，禁止进入操作记录及 Agent 上下文')
  return agentToolObservationSchema.parse({
    source: { toolName: definition.name, toolVersion: definition.version, toolCallId },
    trust: 'untrusted_observation', dataClasses,
    summary: summarizeSafeText(definition.summarize(parsed)), output: parsed,
    effects: definition.resolveObservedEffects?.(input, parsed) ?? definition.capability?.resolveObservedEffects?.(input, parsed) ?? [],
    undo: definition.undo?.(parsed),
  })
}
