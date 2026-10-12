import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'

type AgentMessage = AgentSession['messages'][number]

/** 多模型预算估算，不是计费分词：ASCII 单词按三字符，标点逐个，非 ASCII 按 UTF-8 字节保守计。 */
export function estimateContextTokens(text: string): number {
  let tokens = 0
  for (const part of text.matchAll(/[a-zA-Z0-9_]+|\s+|[^a-zA-Z0-9_\s]/gu)) {
    const value = part[0]
    tokens += /^[a-zA-Z0-9_\s]/.test(value) ? Math.ceil(value.length / 3) : Buffer.byteLength(value, 'utf8')
  }
  return tokens
}

export function messageTokens(message: AgentMessage): number {
  if ('content' in message) {
    if (typeof message.content === 'string') return 16 + estimateContextTokens(message.content)
    return 16 + message.content.reduce((sum, part) => sum + (part.type === 'image' ? 4096
      : estimateContextTokens(part.type === 'text' ? part.text : JSON.stringify(part))), 0)
  }
  return 16 + estimateContextTokens(JSON.stringify(message))
}

/** 截在 Unicode 字符边界；结果必须连同 JSON 信封一起计量。 */
export function fitText(text: string, accepts: (text: string) => boolean): string {
  let low = 0; let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (accepts(text.slice(0, middle))) low = middle
    else high = middle - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1])) low--
  return text.slice(0, low)
}

function factSummary(text: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(text) } catch { return { format: 'text', characters: text.length } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { format: 'json', characters: text.length }
  const root = value as Record<string, unknown>
  const record = root.facts && typeof root.facts === 'object' && !Array.isArray(root.facts)
    ? root.facts as Record<string, unknown> : root
  const facts: Record<string, unknown> = {}
  // 保留执行/保存/验证/恢复事实，不推断成功；完整内容始终可从同一会话续读。
  for (const key of ['ok', 'executionState', 'operationId', 'verificationState', 'persistenceState', 'message', 'error', 'recovery', 'data']) {
    if (record[key] === undefined) continue
    const encoded = JSON.stringify(record[key])
    facts[key] = estimateContextTokens(encoded) <= 180 ? record[key]
      : { omitted: true, ...(Array.isArray(record[key]) ? { count: record[key].length } : {}) }
  }
  return facts
}

export function projectText(text: string, reference: string, budget: number): string {
  if (estimateContextTokens(text) <= budget) return text
  try {
    const previous = JSON.parse(text) as { hasMore?: unknown; reference?: unknown; read?: unknown }
    if (previous.hasMore === true && typeof previous.reference === 'string' && previous.read) reference = previous.reference
  } catch { /* 普通文本没有已有续读引用。 */ }
  const facts = factSummary(text)
  const wrap = (excerpt: string) => JSON.stringify({ facts, hasMore: true, reference,
    read: { name: 'read_assistant_context', reference, offset: 0 }, excerpt })
  if (estimateContextTokens(wrap('')) > budget) {
    return JSON.stringify({ hasMore: true, reference, read: 'read_assistant_context', summary: '结果超出本轮预算，需分页读取；尚不能据此判定完成。' })
  }
  return wrap(fitText(text, excerpt => estimateContextTokens(wrap(excerpt)) <= budget))
}

/** 只投影模型上下文，原始 Pi 消息与错误事实留在会话中，不改业务回执或重放工具。 */
export function budgetContext(messages: AgentMessage[], input: {
  contextWindow: number; maxOutputTokens: number; instructions: string; tools: ToolDefinition[]
}): AgentMessage[] {
  const fixed = estimateContextTokens(input.instructions) + estimateContextTokens(JSON.stringify(input.tools.map(tool => ({
    name: tool.name, description: tool.description, parameters: tool.parameters,
  }))))
  const remaining = input.contextWindow - fixed - input.maxOutputTokens - Math.max(1024, Math.ceil(input.contextWindow * 0.05))
  const textParts = messages.flatMap(message => message.role === 'toolResult' ? message.content.filter(part => part.type === 'text') : [])
  const nonResult = messages.reduce((sum, message) => sum + (message.role === 'toolResult'
    ? 16 + message.content.filter(part => part.type === 'image').length * 4096 : messageTokens(message)), 0)
  // 每个结果首段最多 4000 估算 token；按实际剩余窗口平分，后续分页不是产品数量上限。
  const perPart = Math.min(4000, Math.floor((remaining - nonResult) / Math.max(1, textParts.length)) - 32)
  const projected = messages.map(message => message.role !== 'toolResult' ? message : { ...message,
    content: message.content.map((part, index) => part.type !== 'text' ? part : { ...part,
      text: projectText(part.text, `tool:${resultId(message)}:${index}`, perPart) }),
  })
  if (projected.reduce((sum, message) => sum + messageTokens(message), 0) > remaining) {
    throw new Error('当前对话和已加载工具超出所选模型的上下文预算。请新建对话并只加载本次所需工具，或切换更大上下文的模型；已有操作不会重新执行。')
  }
  return projected
}

function resultId(message: Extract<AgentMessage, { role: 'toolResult' }>): string {
  const details = message.details as { resultId?: unknown } | undefined
  return typeof details?.resultId === 'string' ? details.resultId : message.toolCallId
}
