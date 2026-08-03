import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import { estimateAgentTextTokens } from '../../../../../src/core/assistant/tokenEstimate'

export const AGENT_CONTEXT_RESERVE_TOKENS = 16_384
export const AGENT_KEEP_RECENT_TOKENS = 20_000

function messageText(message: ModelStepMessage): string {
  if (typeof message.content === 'string') return message.content
  try {
    return JSON.stringify(message.content)
  } catch {
    return '[无法序列化的历史消息]'
  }
}

function existingSemanticSummary(messages: ModelStepMessage[]): ModelStepMessage | undefined {
  return messages.find((message) => (
    message.role === 'user'
    && typeof message.content === 'string'
    && message.content.includes('[SESSION_SEMANTIC_SUMMARY trust=untrusted_history]')
    && message.content.includes('[END_SESSION_SEMANTIC_SUMMARY]')
  ))
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

function safeRecentStart(conversation: ModelStepMessage[], requestedStart: number): number {
  let start = includeToolPairBoundary(conversation, requestedStart)
  if (start > 0 && conversation[start - 1]?.role === 'tool') {
    start = includeToolPairBoundary(conversation, start - 1)
  }
  while (start > 0 && conversation[start]?.role === 'tool') {
    start = includeToolPairBoundary(conversation, start)
    if (conversation[start]?.role === 'tool') start -= 1
  }
  return Math.max(0, start)
}

export function findRecentConversationStart(
  conversation: ModelStepMessage[],
  keepRecentTokens = AGENT_KEEP_RECENT_TOKENS
): number {
  let tokens = 0
  let start = conversation.length
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const messageTokens = estimateModelMessagesTokens([conversation[index]])
    if (tokens > 0 && tokens + messageTokens > keepRecentTokens) break
    tokens += messageTokens
    start = index
    if (tokens >= keepRecentTokens) break
  }
  return safeRecentStart(conversation, start)
}

function retainOversizedMessageSuffix(
  message: ModelStepMessage,
  keepRecentTokens: number
): ModelStepMessage {
  if (message.role !== 'user' && message.role !== 'assistant') return message
  if (typeof message.content !== 'string') return message
  const content = message.content
  if (estimateModelMessagesTokens([message]) <= keepRecentTokens) return message
  let low = 0
  let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const suffix = content.slice(content.length - middle)
    if (estimateModelMessagesTokens([{ ...message, content: suffix }]) <= keepRecentTokens) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return {
    role: message.role,
    content: [
      '[SPLIT_TURN_SUFFIX]',
      '同一条长消息的早期部分已进入压缩摘要；以下为必须原样保留的后缀。',
      content.slice(content.length - low),
    ].join('\n'),
  }
}

export function estimateModelMessagesTokens(messages: ModelStepMessage[], toolsJson = ''): number {
  const text = messages.map((message) => `${message.role}:${messageText(message)}`).join('\n') + toolsJson
  return estimateAgentTextTokens(text)
}

export function compactConversationMessages(
  conversation: ModelStepMessage[],
  keepRecentTokens = AGENT_KEEP_RECENT_TOKENS,
  workingSummary?: AgentWorkingSummary
): ModelStepMessage[] {
  const safeConversation = conversation.filter((message) => message.role !== 'system')
  const recentStart = findRecentConversationStart(safeConversation, keepRecentTokens)
  if (recentStart === 0) {
    if (safeConversation.length !== 1) return safeConversation
    const retained = retainOversizedMessageSuffix(safeConversation[0], keepRecentTokens)
    if (retained === safeConversation[0]) return safeConversation
    return [{
      role: 'user',
      content: [
        '[STRUCTURED_WORKING_SUMMARY trust=untrusted_history]',
        JSON.stringify(workingSummary ?? {
          version: 'agent-working-summary/fallback',
          note: '同一条长消息的早期部分已省略；不得据此推断动作已经执行。',
        }),
        '[END_STRUCTURED_WORKING_SUMMARY]',
      ].join('\n'),
    }, retained]
  }
  const older = safeConversation.slice(0, recentStart)
  const recent = safeConversation.slice(recentStart)
  const summary: ModelStepMessage = existingSemanticSummary(older) ?? {
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
