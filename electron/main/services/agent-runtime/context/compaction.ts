import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'

function messageText(message: ModelStepMessage): string {
  if (typeof message.content === 'string') return message.content
  try {
    return JSON.stringify(message.content)
  } catch {
    return '[无法序列化的历史消息]'
  }
}

function toolCallIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) toolCallIds(item, ids)
    return ids
  }
  if (!value || typeof value !== 'object') return ids
  for (const [key, item] of Object.entries(value)) {
    if (key === 'toolCallId' && typeof item === 'string') ids.add(item)
    else toolCallIds(item, ids)
  }
  return ids
}

function includeToolPairBoundary(
  conversation: ModelStepMessage[],
  startIndex: number
): number {
  const first = conversation[startIndex]
  if (!first || first.role !== 'tool') return startIndex
  const resultIds = toolCallIds(first.content)
  if (resultIds.size === 0) return startIndex
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const message = conversation[index]
    if (message.role !== 'assistant') continue
    const requestIds = toolCallIds(message.content)
    if ([...resultIds].some((id) => requestIds.has(id))) return index
  }
  return startIndex
}

export function estimateModelMessagesTokens(messages: ModelStepMessage[], toolsJson = ''): number {
  const characters = messages.reduce((total, message) => total + messageText(message).length + message.role.length, 0)
  return Math.ceil((characters + toolsJson.length) / 4)
}

export function compactConversationMessages(
  conversation: ModelStepMessage[],
  recentLimit = 10,
  workingSummary?: AgentWorkingSummary
): ModelStepMessage[] {
  const safeConversation = conversation.filter((message) => message.role !== 'system')
  if (safeConversation.length <= recentLimit) return safeConversation
  const requestedStart = Math.max(0, safeConversation.length - recentLimit)
  const recentStart = includeToolPairBoundary(safeConversation, requestedStart)
  const older = safeConversation.slice(0, recentStart)
  const recent = safeConversation.slice(recentStart)
  const summary: ModelStepMessage = {
    role: 'user',
    content: [
      '[STRUCTURED_WORKING_SUMMARY trust=untrusted_history]',
      JSON.stringify(workingSummary ?? {
        version: 'agent-working-summary/fallback',
        omittedMessageCount: older.length,
        omittedRoles: older.reduce<Record<string, number>>((counts, message) => ({
          ...counts,
          [message.role]: (counts[message.role] ?? 0) + 1,
        }), {}),
        note: '旧消息内容已按预算省略；不得从本摘要推断动作已经执行。',
      }),
      '[END_STRUCTURED_WORKING_SUMMARY]',
    ].join('\n'),
  }
  return [summary, ...recent]
}
