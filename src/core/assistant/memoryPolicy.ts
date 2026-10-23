import { getAssistantUserInstructionsWarnings } from './userInstructions'

/** 凭据、注入和完整日志检查由三层所有写入与导入共同使用。 */
export function assertMemoryContentSafe(content: string): void {
  const warnings = getAssistantUserInstructionsWarnings(content)
  if (warnings.includes('可能包含敏感凭据')) throw new Error('MEMORY_SENSITIVE：不能保存密钥、令牌或密码。')
  if (warnings.includes('包含无法覆盖的安全或审批规则')) throw new Error('MEMORY_INJECTION：记忆不能覆盖安全、权限或审批规则。')
  if (/(?:^|\n)\s*(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\[(?:error|warn|info|debug|trace)\])|完整日志|原始日志|整份文件|完整文件|完整提示词|full log|entire file|full prompt/i.test(content)) throw new Error('MEMORY_OVERSHARING：请只记录一句偏好或事实，不保存完整日志、文件或提示词。')
}
