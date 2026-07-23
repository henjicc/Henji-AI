import {
  agentMemoryProposalSchema,
  type AgentMemoryProposal,
} from '../../../../src/core/assistant/memory'
import { getAssistantUserInstructionsWarnings } from '../../../../src/core/assistant/userInstructions'

export interface AgentMemoryPolicyResult {
  proposal: AgentMemoryProposal
  sensitivity: 'C0' | 'C1'
  conflictKey: string
}

function normalizeConflictKey(proposal: AgentMemoryProposal): string {
  if (proposal.conflictKey) return proposal.conflictKey.trim().toLowerCase()
  return `${proposal.kind}:${proposal.content.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120)}`
}

export function evaluateAgentMemoryProposal(input: unknown): AgentMemoryPolicyResult {
  const proposal = agentMemoryProposalSchema.parse(input)
  const content = proposal.content.trim()
  if (getAssistantUserInstructionsWarnings(content).includes('可能包含敏感凭据')) {
    throw new Error('[memory_sensitive] 记忆候选可能包含密钥、令牌或密码，已拒绝保存')
  }
  if (
    /(?:^|\n)\s*(?:\d{4}-\d{2}-\d{2}|\[\w+\])?.{0,20}(?:error|warn|info|debug|trace)\b/i.test(content)
    || /(?:完整日志|原始日志|整份文件|完整文件|完整提示词|full log|entire file|full prompt)/i.test(content)
    || /[A-Za-z]:\\[^\r\n]{20,}|file:\/\/[^\s]+/i.test(content)
  ) {
    throw new Error('[memory_oversharing] 记忆候选包含完整日志、文件、路径或提示词内容，已拒绝保存')
  }
  if (getAssistantUserInstructionsWarnings(content).includes('包含无法覆盖的安全或审批规则')) {
    throw new Error('[memory_injection] 记忆候选试图覆盖安全、权限或审批规则，已拒绝保存')
  }
  return {
    proposal: { ...proposal, content },
    sensitivity: /\b(?:邮箱|电话|姓名|地址|账号|email|phone|address|account)\b/i.test(content)
      ? 'C1'
      : 'C0',
    conflictKey: normalizeConflictKey(proposal),
  }
}
