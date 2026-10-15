import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'

type AgentMessage = AgentSession['messages'][number]
export const CONTEXT_BUDGET_ERROR = '当前对话和已加载工具超出所选模型的上下文预算。请新建对话并只加载本次所需工具，或切换更大上下文的模型；已有操作不会重新执行。'

export const SKILL_RESULT_TOKEN_BUDGET = 16000
export function isSkillResult(toolName: string, details?: unknown): boolean {
  return toolName === 'load_assistant_skill' || Boolean(details && typeof details === 'object' && 'skillContent' in details && details.skillContent === true)
}

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

export function messageTokens(message: AgentMessage, attachmentTokens: (text: string) => number = () => 0): number {
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
  const wrap = (excerpt: string) => JSON.stringify({ facts, hasMore: true, reference,
    read: { name: 'read_assistant_context', reference, offset: 0 }, excerpt })
  if (estimateContextTokens(wrap('')) > budget) {
    for (const key of ['data', 'message', 'recovery']) if (key in facts) facts[key] = { omitted: true }
    const compact = JSON.stringify(minimum)
    if (estimateContextTokens(compact) > budget) throw new Error(CONTEXT_BUDGET_ERROR)
    return compact
  }
  return wrap(fitText(text, excerpt => estimateContextTokens(wrap(excerpt)) <= budget))
}

/** 只投影模型上下文，原始 Pi 消息与错误事实留在会话中，不改业务回执或重放工具。 */
export function budgetContext(messages: AgentMessage[], input: {
  contextWindow: number; maxOutputTokens: number; instructions: string; tools: ToolDefinition[]; attachmentTokens?: (text: string) => number
}): AgentMessage[] {
  const fixed = estimateContextTokens(input.instructions) + estimateContextTokens(JSON.stringify(input.tools.map(tool => ({
    name: tool.name, description: tool.description, parameters: tool.parameters,
  }))))
  const remaining = input.contextWindow - fixed - input.maxOutputTokens - Math.max(1024, Math.ceil(input.contextWindow * 0.05))
  let lastUser = -1
  messages.forEach((message, index) => { if (message.role === 'user') lastUser = index })
  const parts: Array<{ part: { type: 'text'; text: string }; original: string; reference: string }> = []
  const skills: typeof parts = []
  // 先保底所有事实。历史消息次序不变；当前轮的资料分页原样保留。
  const projected = messages.map((message, messageIndex) => message.role !== 'toolResult' ? message : { ...message,
    content: message.content.map((part, index) => {
      if (part.type !== 'text' || (messageIndex > lastUser && message.toolName === 'read_assistant_context' && !isSkillResult(message.toolName, message.details))) return part
      const reference = `tool:${resultId(message)}:${index}`
      if (isSkillResult(message.toolName, message.details)) {
        const next = { ...part }
        skills.push({ part: next, original: part.text, reference })
        return next
      }
      const minimum = JSON.stringify(minimalProjection(part.text, reference))
      const next = { ...part, text: estimateContextTokens(minimum) < estimateContextTokens(part.text) ? minimum : part.text }
      parts.push({ part: next, original: part.text, reference })
      return next
    }),
  })
  let available = remaining - projected.reduce((sum, message) => sum + messageTokens(message, input.attachmentTokens), 0)
  // 先压缩普通结果，再淘汰最旧宿主快照；最新快照始终保留。
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
  // 只有其他可压缩内容都已让出预算，才从最旧技能原文回退到可续读投影。
  for (const { part, original, reference } of skills) {
    if (available >= 0) break
    const cost = estimateContextTokens(part.text)
    const minimum = JSON.stringify(minimalProjection(original, reference))
    const budget = Math.max(estimateContextTokens(minimum), cost + available)
    part.text = projectText(original, reference, budget)
    available += cost - estimateContextTokens(part.text)
  }
  if (available < 0) throw new Error(CONTEXT_BUDGET_ERROR)
  // 最新结果先拿正文预算；旧结果保留事实与引用，窗口不足时不再平均稀释最新写入。
  for (const { part, original, reference } of parts.reverse()) {
    const minimumCost = estimateContextTokens(part.text)
    const budget = Math.min(4000, minimumCost + available)
    if (budget <= minimumCost) continue
    const expanded = projectText(original, reference, budget)
    available -= estimateContextTokens(expanded) - minimumCost
    part.text = expanded
  }
  return projected
}

function resultId(message: Extract<AgentMessage, { role: 'toolResult' }>): string {
  const details = message.details as { resultId?: unknown } | undefined
  return typeof details?.resultId === 'string' ? details.resultId : message.toolCallId
}
