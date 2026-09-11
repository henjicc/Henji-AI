import {
  taskPolicyForbiddenEffects, type TaskExecutionPolicy, type TaskPolicyEffect,
} from '../../../../../src/core/assistant/taskExecutionPolicy'
import type { AgentToolDefinition } from './types'
import { AgentToolGatewayError } from './gateway-support'

function operationEffects(definition: AgentToolDefinition, input: unknown): TaskPolicyEffect[] {
  // 解释器本身不修改业务，其每一步均回到此 Gateway；预检另校验整段展开后的 IR。
  if (['run_henji_script', 'resume_henji_script', 'ask_user'].includes(definition.name)) return []
  if (definition.name === 'change_application_entities' && input && typeof input === 'object' && 'changes' in input
    && Array.isArray(input.changes)) {
    return input.changes.map((change: { kind: string }) => (
      change.kind === 'create_items' ? 'create' : change.kind === 'remove_items' ? 'delete' : 'update'
    ))
  }
  const effects = definition.capability?.control.impacts.map((impact) => impact.effect)
  return effects?.length ? effects : [definition.readOnly ? 'observe' : 'execute']
}

export function assertTaskPolicyAllows(
  policy: TaskExecutionPolicy | undefined, definition: AgentToolDefinition, input: unknown,
): void {
  if (!policy) return // 非助手的领域 harness 保留独立调用契约；正式 Runner 在任何工具前安装策略。
  const forbidden = taskPolicyForbiddenEffects(policy)
  const blocked = operationEffects(definition, input).find((effect) => forbidden.has(effect))
  if (!blocked) return
  throw new AgentToolGatewayError('PERMISSION_DENIED',
    `当前用户任务策略禁止 ${blocked}，${definition.name} 尚未执行。`
    + (policy.intent === 'ambiguous' ? `请用 ask_user 澄清：${policy.clarification || '是否允许修改应用数据？'}`
      : '请按用户限制改写脚本；需要扩大任务范围时先使用 ask_user，不能用重新发现或续跑绕过限制。'))
}
