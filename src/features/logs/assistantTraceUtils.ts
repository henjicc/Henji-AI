import type {
  AgentTraceDetail,
  AgentTraceDetailResult,
  AgentTraceStepSummary,
} from '@/core/assistant/trace'
import type { ModelStepMessage } from '@henjicc/ai-sdk'

export interface AgentTraceDiff {
  systemChanged: boolean
  previousSystem: string
  currentSystem: string
  messages: {
    unchangedPrefix: number
    unchangedSuffix: number
    changed: Array<{ index: number; previous: ModelStepMessage; current: ModelStepMessage }>
    added: ModelStepMessage[]
    removed: ModelStepMessage[]
  }
  tools: {
    added: string[]
    removed: string[]
    changed: string[]
    unchanged: string[]
  }
  settingChanges: string[]
  providerOptionChanges: string[]
  contextChanges: string[]
  tokenDelta: {
    input: number
    output: number
    reasoning: number
    total: number
  }
}

export function formatTraceTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString('zh-CN')
}

export function formatTraceDuration(value: number | undefined): string {
  if (value === undefined) return '运行中'
  if (value < 1_000) return `${value}ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round((value % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

export function getTraceStepLabel(step: AgentTraceStepSummary): string {
  if (step.kind === 'router') return '路由判断'
  if (step.kind === 'primary' && step.turn) return `第 ${step.turn} 轮`
  if (step.kind === 'summarizer') return '上下文摘要'
  if (step.kind === 'fallback') return '回退模型'
  return step.stepId
}

export function buildTraceCurl(detail: AgentTraceDetail): string {
  const request = detail.httpRequest
  if (!request) return '# 没有捕获到最终 HTTP 请求'
  const parts = [`curl -X ${request.method.toUpperCase()} '${escapeShellSingleQuote(request.url)}'`]
  for (const [key, value] of Object.entries(request.headers)) {
    parts.push(`  -H '${escapeShellSingleQuote(`${key}: ${value}`)}'`)
  }
  if (request.body !== null) {
    parts.push(`  --data '${escapeShellSingleQuote(JSON.stringify(request.body))}'`)
  }
  return parts.join(' \\\n')
}

export function buildAgentTraceDiff(
  previous: AgentTraceDetailResult,
  current: AgentTraceDetailResult
): AgentTraceDiff | null {
  if (!previous.detail || !current.detail) return null
  const previousDetail = previous.detail
  const currentDetail = current.detail
  const previousSystem = previousDetail.logicalRequest.system ?? ''
  const currentSystem = currentDetail.logicalRequest.system ?? ''
  const previousMessages = previousDetail.logicalRequest.messages
  const currentMessages = currentDetail.logicalRequest.messages
  const unchangedPrefix = commonMessagePrefix(previousMessages, currentMessages)
  const unchangedSuffix = commonMessageSuffix(previousMessages, currentMessages, unchangedPrefix)
  const changed: AgentTraceDiff['messages']['changed'] = []
  const previousMiddle = previousMessages.slice(
    unchangedPrefix,
    previousMessages.length - unchangedSuffix
  )
  const currentMiddle = currentMessages.slice(
    unchangedPrefix,
    currentMessages.length - unchangedSuffix
  )
  const paired = Math.min(previousMiddle.length, currentMiddle.length)
  for (let index = 0; index < paired; index += 1) {
    if (messageFingerprint(previousMiddle[index]) !== messageFingerprint(currentMiddle[index])) {
      changed.push({
        index: unchangedPrefix + index,
        previous: previousMiddle[index],
        current: currentMiddle[index],
      })
    }
  }

  const previousTools = toolsByName(previousDetail.logicalRequest.tools)
  const currentTools = toolsByName(currentDetail.logicalRequest.tools)
  const previousNames = new Set(previousTools.keys())
  const currentNames = new Set(currentTools.keys())
  const sharedNames = [...currentNames].filter((name) => previousNames.has(name))

  return {
    systemChanged: previousSystem !== currentSystem,
    previousSystem,
    currentSystem,
    messages: {
      unchangedPrefix,
      unchangedSuffix,
      changed,
      added: currentMiddle.slice(paired),
      removed: previousMiddle.slice(paired),
    },
    tools: {
      added: [...currentNames].filter((name) => !previousNames.has(name)),
      removed: [...previousNames].filter((name) => !currentNames.has(name)),
      changed: sharedNames.filter((name) => stableString(previousTools.get(name)) !== stableString(currentTools.get(name))),
      unchanged: sharedNames.filter((name) => stableString(previousTools.get(name)) === stableString(currentTools.get(name))),
    },
    settingChanges: diffObjectPaths(
      previousDetail.logicalRequest.settings,
      currentDetail.logicalRequest.settings,
      'settings'
    ),
    providerOptionChanges: diffObjectPaths(
      previousDetail.logicalRequest.providerOptions,
      currentDetail.logicalRequest.providerOptions,
      'providerOptions'
    ),
    contextChanges: diffObjectPaths(
      previousDetail.logicalRequest.context,
      currentDetail.logicalRequest.context,
      'context'
    ),
    tokenDelta: {
      input: tokenValue(current.summary.usage.inputTokens) - tokenValue(previous.summary.usage.inputTokens),
      output: tokenValue(current.summary.usage.outputTokens) - tokenValue(previous.summary.usage.outputTokens),
      reasoning: tokenValue(current.summary.usage.reasoningTokens) - tokenValue(previous.summary.usage.reasoningTokens),
      total: tokenValue(current.summary.usage.totalTokens) - tokenValue(previous.summary.usage.totalTokens),
    },
  }
}

function commonMessageSuffix(
  previous: ModelStepMessage[],
  current: ModelStepMessage[],
  prefixLength: number
): number {
  const limit = Math.min(previous.length, current.length) - prefixLength
  let offset = 0
  while (
    offset < limit
    && messageFingerprint(previous[previous.length - 1 - offset])
      === messageFingerprint(current[current.length - 1 - offset])
  ) {
    offset += 1
  }
  return offset
}

function commonMessagePrefix(previous: ModelStepMessage[], current: ModelStepMessage[]): number {
  const limit = Math.min(previous.length, current.length)
  let index = 0
  while (index < limit && messageFingerprint(previous[index]) === messageFingerprint(current[index])) index += 1
  return index
}

function messageFingerprint(message: ModelStepMessage): string {
  return `${message.role}:${stableString(message.content)}`
}

function toolsByName(value: unknown): Map<string, unknown> {
  const tools = Array.isArray(value) ? value : []
  const map = new Map<string, unknown>()
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string') continue
    map.set(tool.name, tool)
  }
  return map
}

function diffObjectPaths(previous: unknown, current: unknown, root: string): string[] {
  const changes: string[] = []
  walkDiff(previous, current, root, changes, 0)
  return changes.slice(0, 100)
}

function walkDiff(previous: unknown, current: unknown, path: string, output: string[], depth: number): void {
  if (output.length >= 100 || stableString(previous) === stableString(current)) return
  if (depth >= 6 || !isRecord(previous) || !isRecord(current)) {
    output.push(path)
    return
  }
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  for (const key of keys) walkDiff(previous[key], current[key], `${path}.${key}`, output, depth + 1)
}

function stableString(value: unknown): string {
  try {
    return JSON.stringify(sortValue(value))
  } catch {
    return String(value)
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]))
}

function tokenValue(value: number | null): number {
  return value ?? 0
}

function escapeShellSingleQuote(value: string): string {
  return value.replace(/'/g, `'"'"'`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
