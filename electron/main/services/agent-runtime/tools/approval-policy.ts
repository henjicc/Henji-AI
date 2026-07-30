import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentDataClass, AgentToolRisk } from '../../../../../src/core/assistant/toolContracts'

export type AgentToolAuthorizationDecision = 'auto_allowed' | 'approval_required' | 'denied'

export interface AgentToolAuthorizationInput {
  mode: AgentApprovalMode
  risk: AgentToolRisk
  readOnly: boolean
  destructive: boolean
  dataClasses: AgentDataClass[]
  explicitUserIntent?: boolean
}

/**
 * 将界面审批模式收敛为唯一、可测试的安全矩阵。
 * C2/C3 是数据边界，优先级高于用户选择的便捷模式。
 */
export function decideToolAuthorization(
  input: AgentToolAuthorizationInput
): AgentToolAuthorizationDecision {
  if (
    input.risk === 'R4'
    || (input.risk === 'R0' && input.destructive)
    || input.dataClasses.includes('C3')
  ) return 'denied'
  if (input.dataClasses.includes('C2')) return 'approval_required'

  if (input.mode === 'full_access') {
    return input.risk === 'R3' ? 'approval_required' : 'auto_allowed'
  }

  if (input.mode === 'assistant_decides') {
    if (input.risk === 'R3') return 'approval_required'
    if (input.risk === 'R2' && (!input.readOnly || input.destructive)) {
      return 'approval_required'
    }
    if (
      input.risk === 'R1'
      && (!input.readOnly || input.destructive)
      && (!input.explicitUserIntent || input.destructive)
    ) return 'approval_required'
    return 'auto_allowed'
  }

  if (input.risk === 'R2' || input.risk === 'R3') return 'approval_required'
  if (input.risk === 'R1' && (!input.readOnly || input.destructive)) {
    return 'approval_required'
  }
  return 'auto_allowed'
}
