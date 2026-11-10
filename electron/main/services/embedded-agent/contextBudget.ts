import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'

type AgentMessage = AgentSession['messages'][number]
const CONTEXT_BUDGET_ERROR = '当前对话和已加载工具超出所选模型的上下文预算。请新建对话并只加载本次所需工具，或切换更大上下文的模型；已有操作不会重新执行。'

/** 多模型预算估算，不是计费分词：ASCII 单词按三字符、标点逐个；非 ASCII BMP 码点计 1，辅助平面码点计 2。 */
export function estimateContextTokens(text: string): number {
  let tokens = 0
  for (const part of text.matchAll(/[a-zA-Z0-9_]+|[\t\n\v\f\r ]+|[^a-zA-Z0-9_\t\n\v\f\r ]/gu)) {
    const value = part[0]
    tokens += value.charCodeAt(0) <= 0x7f && /^[a-zA-Z0-9_\s]/.test(value) ? Math.ceil(value.length / 3)
      : Array.from(value).reduce((sum, character) => sum + (character.codePointAt(0)! > 0xffff ? 2 : 1), 0)
  }
  return tokens
}

function messageTokens(message: AgentMessage, attachmentTokens: (text: string) => number = () => 0): number {
  const textTokens = (text: string): number => estimateContextTokens(text) + attachmentTokens(text)
  if ('content' in message) {
    if (typeof message.content === 'string') return 16 + textTokens(message.content)
    return 16 + message.content.reduce((sum, part) => sum + (part.type === 'image' ? 4096
      : textTokens(part.type === 'text' ? part.text : JSON.stringify(part))), 0)
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
    facts[key] = !['data', 'message', 'recovery'].includes(key) || estimateContextTokens(encoded) <= 180 ? record[key]
      : { omitted: true, ...(Array.isArray(record[key]) ? { count: record[key].length } : {}) }
  }
  return facts
}

function minimalProjection(text: string, reference: string): { facts: Record<string, unknown>; hasMore: true; reference: string; read: string } {
  try {
    const previous = JSON.parse(text) as { hasMore?: unknown; reference?: unknown; read?: unknown }
    if (previous.hasMore === true && typeof previous.reference === 'string' && previous.read) reference = previous.reference
  } catch { /* 普通文本没有已有续读引用。 */ }
  return { facts: factSummary(text), hasMore: true, reference, read: 'read_assistant_context' }
}

export function projectText(text: string, reference: string, budget: number): string {
  if (estimateContextTokens(text) <= budget) return text
  const minimum = minimalProjection(text, reference)
  const { facts } = minimum
  reference = minimum.reference
  // 续读从摘录结束处接着读，不再从头重复已给出的内容
  const wrap = (excerpt: string) => JSON.stringify({ facts, hasMore: true, reference,
    read: { name: 'read_assistant_context', reference, offset: excerpt.length }, excerpt })
  if (estimateContextTokens(wrap('')) > budget) {
    for (const key of ['data', 'message', 'recovery']) if (key in facts) facts[key] = { omitted: true }
    const compact = JSON.stringify(minimum)
    if (estimateContextTokens(compact) > budget) throw new Error(CONTEXT_BUDGET_ERROR)
    return compact
  }
  return wrap(fitText(text, excerpt => estimateContextTokens(wrap(excerpt)) <= budget))
}

/**
 * 发给模型前只去掉过时的宿主快照：工具结果、技能原文都原样给，不按条截断。
 * 历史真的超出窗口由 Pi 的自动压缩处理（总结较早的对话）；这里只在超出时先让出最旧的界面快照，
 * 最新快照始终保留。单条结果超过窗口一半的，在产生时已转成摘录加可续读引用（archiveToolResult）。
 */
export function budgetContext(messages: AgentMessage[], input: {
  contextWindow: number; maxOutputTokens: number; instructions: string; tools: ToolDefinition[]; attachmentTokens?: (text: string) => number
}): AgentMessage[] {
  const fixed = estimateContextTokens(input.instructions) + estimateContextTokens(JSON.stringify(input.tools.map(tool => ({
    name: tool.name, description: tool.description, parameters: tool.parameters,
  }))))
  const projected = [...messages]
  let available = input.contextWindow - fixed - input.maxOutputTokens
    - projected.reduce((sum, message) => sum + messageTokens(message, input.attachmentTokens), 0)
  while (available < 0) {
    const contexts = projected.flatMap((message, index) => message.role === 'custom' && message.customType === 'henji-context' ? [index] : [])
    if (contexts.length < 2) break
    const [removed] = projected.splice(contexts[0], 1)
    available += messageTokens(removed, input.attachmentTokens)
    // 被淘汰快照可能承载长文本全文；剩余快照恢复其自足版本，避免“同前文”悬空。
    for (let index = 0; index < projected.length; index++) {
      const message = projected[index]
      if (message.role !== 'custom' || message.customType !== 'henji-context') continue
      const full = (message.details as { fullContextContent?: string } | undefined)?.fullContextContent
      if (full && full !== message.content) {
        const restored = { ...message, content: full }
        available -= messageTokens(restored, input.attachmentTokens) - messageTokens(message, input.attachmentTokens)
        projected[index] = restored
      }
    }
  }
  // 较早的内容（含本轮较早的工具往返）超窗由 Pi 压缩；只有最后一次回复之后新进来的这一批自己就装不下时，
  // 压缩无从下手，发出去必然失败，直接说明
  if (available < 0) {
    const lastAssistant = projected.map(message => message.role).lastIndexOf('assistant')
    const pending = projected.slice(lastAssistant + 1).reduce((sum, message) => sum + messageTokens(message, input.attachmentTokens), 0)
    if (fixed + input.maxOutputTokens + pending > input.contextWindow) throw new Error(CONTEXT_BUDGET_ERROR)
  }
  return projected
}

/** 单条工具结果（含技能原文）不超过窗口的一半就原样进上下文 */
export function singleResultTokenLimit(contextWindow: number): number {
  return Math.max(4000, Math.floor(contextWindow / 2))
}

/** 超出上限的结果只留事实与一小段摘录，其余按页续读；页不能大到两页就撑满窗口 */
export const PROJECTED_EXCERPT_TOKENS = 4000
export function contextPageTokenLimit(contextWindow: number): number {
  return Math.max(2000, Math.min(16000, Math.floor(contextWindow / 8)))
}
