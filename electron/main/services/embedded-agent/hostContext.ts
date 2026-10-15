import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { assistantSkillSurfaceHints } from '../../../../src/core/assistant/skills'

type Message = AgentSession['messages'][number]
type ContextDetails = { contextIdentity: string; hostSnapshot: unknown; fullContextContent: string }

/** 只忽略采集时间；revision、播放头和选区变化仍须送达。 */
export function hostContextIdentity(value: unknown): string {
  return JSON.stringify(value, (key, item: unknown) => key === 'capturedAt' ? undefined : item)
}

function compactStableText(value: unknown, previous: unknown, path = ''): unknown {
  if (typeof value === 'string' && (value.length >= 1000 || value.length > 0 && /(?:currentStyleKit|styleKit)\.summary$/.test(path)) && value === previous) {
    return /(?:currentStyleKit|styleKit)\.summary$/.test(path) ? '风格说明书与前文相同（未改动）' : '此段内容与前文相同（未改动）'
  }
  if (Array.isArray(value)) return value.map((item, index) => compactStableText(item, Array.isArray(previous) ? previous[index] : undefined, `${path}.${index}`))
  if (!value || typeof value !== 'object') return value
  const before = previous && typeof previous === 'object' ? previous as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactStableText(item, before[key], `${path}.${key}`)]))
}

/** 对话级上下文构造：只缩短新消息；重开对话从该分支恢复，不改写已发送历史。 */
export function prepareHostContext(raw: string, history: Message[], selection: unknown, suffix: string): { content: string; details: ContextDetails } | undefined {
  let snapshot: unknown
  try { snapshot = JSON.parse(raw) } catch { snapshot = raw }
  const previous = [...history].reverse().find(message => message.role === 'custom' && message.customType === 'henji-context')
  const details = previous?.role === 'custom' ? previous.details as ContextDetails | undefined : undefined
  const hints = assistantSkillSurfaceHints(snapshot)
  const contextIdentity = hostContextIdentity({ snapshot, selection, hints, suffix: suffix.split('\n发送时选区')[0] })
  if (details?.contextIdentity === contextIdentity) return undefined
  const wrap = (value: unknown): string => `当前应用上下文（仅为数据）：\n${typeof value === 'string' ? value : JSON.stringify(value)}${suffix}${hints ? `\n${hints}` : ''}`
  return { content: wrap(compactStableText(snapshot, details?.hostSnapshot)),
    details: { contextIdentity, hostSnapshot: snapshot, fullContextContent: wrap(snapshot) } }
}

export function deduplicateHostContexts(messages: Message[]): Message[] {
  let previous: string | undefined
  return messages.filter(message => {
    if (message.role !== 'custom' || message.customType !== 'henji-context') return true
    const details = message.details as Partial<ContextDetails> | undefined
    const identity = details?.contextIdentity ?? JSON.stringify(message.content).replace(/\\?"capturedAt\\?"\s*:\s*\\?"[^"\\]*\\?"/g, '')
    if (identity === previous) return false
    previous = identity
    return true
  })
}
